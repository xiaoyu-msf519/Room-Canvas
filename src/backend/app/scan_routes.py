from __future__ import annotations

import asyncio
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .scan_crops import prepare_furniture_crop, CropNeedsReview
from .scan_import import MAX_BUNDLE_BYTES, bundle_inventory, find_bundle
from .scans import adapt_scan, read_json, safe_path, write_json
from .surface_materials import apply_finishes


def register_scan_routes(app: FastAPI, root: Path, start_generation, read_generation) -> None:
    scenes_root = root / "tmp/scans"
    scenes_root.mkdir(parents=True, exist_ok=True)
    import_lock = asyncio.Lock()
    processing: dict[str, asyncio.Task] = {}

    def scene_path(scene_id: str) -> Path:
        if not scene_id.isalnum():
            raise HTTPException(404, "场景不存在")
        return scenes_root / scene_id / "scene-manifest.json"

    def bundle_path(scene: dict) -> Path:
        return safe_path(scene_path(scene["id"]).parent / "bundle", scene.get("bundleSubdir", ""))

    def load(scene_id: str) -> dict:
        path = scene_path(scene_id)
        if not path.is_file():
            raise HTTPException(404, "场景不存在")
        scene = read_json(path)
        ceiling = next((surface for surface in scene["room"]["surfaces"] if surface.get("id") == "room-ceiling"), None)
        if ceiling and ceiling.get("heightAlignment") != "lowest-wall-top":
            try:
                adapted = adapt_scan(bundle_path(scene), scene_id)
                replacement = next(surface for surface in adapted["room"]["surfaces"] if surface.get("id") == "room-ceiling")
            except (OSError, ValueError, KeyError, TypeError, StopIteration):
                return scene
            ceiling["position"][1] = replacement["position"][1]
            ceiling["heightAlignment"] = "lowest-wall-top"
            write_json(path, scene)
        return scene

    def refresh(scene: dict) -> dict:
        for item in scene["furniture"]:
            job = read_generation(item.get("jobId", ""))
            if job:
                item.update(generationStatus=job.status, stageMessage=job.stage_message, error=job.error)
                if job.status == "succeeded":
                    item.update(modelUrl=job.model_url, editModelUrl=job.edit_model_url)
        pipeline = scene.get("pipeline")
        if pipeline:
            states = [item.get("generationStatus", "pending") for item in scene["furniture"]]
            complete, failed, review = (states.count(status) for status in ("succeeded", "failed", "needs_review"))
            active = sum(states.count(status) for status in ("preparing", "queued", "generating", "scaling", "uploading"))
            status, message = "processing", "正在生成家具并按真实尺度回填"
            if pipeline.get("preparation") in ("pending", "running"):
                message = "正在恢复涂装并检查单件家具视角"
            elif pipeline.get("preparation") == "failed":
                status, message = "needs_attention", pipeline.get("error", "预处理未完成")
            elif complete == len(states):
                status, message = "ready", "房间已建成"
            elif not active:
                status, message = ("needs_attention", "部分家具需要补拍或重试") if failed or review else ("idle", "房间已导入，家具尚未生成")
            pipeline.update(status=status, stageMessage=message, completed=complete, failed=failed, needsReview=review, total=len(states))
        return scene

    async def process_scene(scene_id: str, retry_ids: set[str]) -> None:
        try:
            scene = load(scene_id)
            scene["pipeline"].update(preparation="running", error=None)
            write_json(scene_path(scene_id), scene)
            bundle = bundle_path(scene)
            await asyncio.to_thread(apply_finishes, scene, bundle, scene_path(scene_id).parent / "surface-finishes.json")
            write_json(scene_path(scene_id), scene)
            if scene["pipeline"].get("autoReconstruct"):
                for furniture_id in [item["id"] for item in scene["furniture"]]:
                    scene = load(scene_id)
                    item = next(item for item in scene["furniture"] if item["id"] == furniture_id)
                    current = read_generation(item.get("jobId", ""))
                    retry = furniture_id in retry_ids
                    if current and (current.status != "failed" or not retry):
                        continue
                    if item.get("generationStatus") in ("failed", "needs_review") and not retry:
                        continue
                    if retry:
                        item["generationRevision"] = item.get("generationRevision", 0) + 1
                    item.update(generationStatus="preparing", stageMessage="检查单件图与深度遮挡", error=None)
                    write_json(scene_path(scene_id), scene)
                    try:
                        selection = await asyncio.to_thread(prepare_furniture_crop, bundle, furniture_id, bundle / "prepared")
                        item["cropSelection"] = selection
                        item["cropUrl"] = f"/api/scenes/{scene_id}/files/{selection['imagePath']}"
                        item["reviewRequired"] = False
                        crop = safe_path(bundle, selection["imagePath"])
                        width, height, depth = item["size"]
                        prompt = f"One single {item['category']}, upright Y-up. Reconstruct only this object, including its own legs and supports. No adjacent furniture, duplicates, floor, walls or background."
                        job = start_generation(item["id"], item["name"], crop, "image/png", width * 1000, depth * 1000, height * 1000, prompt,
                                               idempotency_key=f"{scene_id}:{item['id']}:{item.get('generationRevision', 0)}")
                        item.update(jobId=job.job_id, generationStatus=job.status, stageMessage=job.stage_message)
                    except (CropNeedsReview, OSError, ValueError, KeyError, TypeError) as error:
                        item.update(generationStatus="needs_review", reviewRequired=True, stageMessage="需要补拍独立视角", error=str(error))
                    write_json(scene_path(scene_id), scene)
            scene = load(scene_id)
            scene["pipeline"]["preparation"] = "complete"
            write_json(scene_path(scene_id), scene)
        except Exception:
            scene = load(scene_id)
            scene["pipeline"].update(preparation="failed", error="预处理异常，请检查扫描资源后重试")
            write_json(scene_path(scene_id), scene)

    def schedule(scene: dict, auto: bool = True, retry_ids: set[str] | None = None) -> None:
        scene_id = scene["id"]
        if scene_id in processing and not processing[scene_id].done():
            return
        scene.setdefault("pipeline", {}).update(autoReconstruct=auto, preparation="pending")
        write_json(scene_path(scene_id), scene)
        task = asyncio.create_task(process_scene(scene_id, retry_ids or set()))
        processing[scene_id] = task
        task.add_done_callback(lambda finished: processing.pop(scene_id, None) if processing.get(scene_id) is finished else None)

    @app.on_event("startup")
    async def resume_scan_pipelines() -> None:
        for path in scenes_root.glob("*/scene-manifest.json"):
            try:
                scene = read_json(path)
            except (OSError, ValueError):
                continue
            pipeline = scene.get("pipeline", {})
            if pipeline.get("autoReconstruct") and pipeline.get("preparation") in ("pending", "running"):
                schedule(scene)

    async def adopt(bundle: Path, auto: bool) -> dict:
        async with import_lock:
            try:
                scan_id, fingerprint, files = await asyncio.to_thread(bundle_inventory, bundle)
                existing = None
                matching_scan = False
                for path in scenes_root.glob("*/scene-manifest.json"):
                    try:
                        candidate = read_json(path)
                    except (OSError, ValueError):
                        continue
                    if candidate.get("source", {}).get("scanId", "").lower() == scan_id:
                        matching_scan = True
                        prior = candidate.get("importFingerprint")
                        if not prior:
                            try:
                                _, prior, _ = await asyncio.to_thread(bundle_inventory, bundle_path(candidate))
                            except (OSError, ValueError, KeyError, TypeError):
                                continue
                        if prior == fingerprint:
                            existing = candidate
                            break
                if matching_scan and not existing:
                    raise HTTPException(409, "同一 scanId 的内容已变化。请从 App 导出完整的新扫描，避免覆盖既有模型。")
                if existing:
                    scene = load(existing["id"])
                    scene["importFingerprint"] = fingerprint
                    write_json(scene_path(scene["id"]), scene)
                else:
                    scene_id = uuid.uuid5(uuid.NAMESPACE_URL, f"roomcanvas.scan:{scan_id}").hex
                    scene = await asyncio.to_thread(adapt_scan, bundle, scene_id)
                    destination = scene_path(scene_id).parent / "bundle"
                    for relative in files:
                        target = safe_path(destination, relative)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        await asyncio.to_thread(shutil.copy2, safe_path(bundle, relative), target)
                    scene["importFingerprint"] = fingerprint
                    write_json(scene_path(scene_id), scene)
                write_json(scenes_root / "latest.json", {"id": scene["id"]})
                schedule(scene, auto)
                return refresh(load(scene["id"]))
            except (ValueError, KeyError, TypeError, OSError) as error:
                raise HTTPException(422, f"扫描包无效: {error}") from error

    @app.post("/api/scans/demo")
    async def import_demo() -> dict:
        # Compatibility shortcut: reload the latest user import. No room names,
        # local reference folders or sample-specific processing in the workflow.
        latest = scenes_root / "latest.json"
        if not latest.is_file():
            raise HTTPException(404, "请先导入 App 采集包")
        scene = load(read_json(latest)["id"])
        return refresh(scene)

    @app.post("/api/scans", status_code=201)
    async def upload_scan(files: list[UploadFile] = File(...), auto_reconstruct: bool = True) -> dict:
        incoming = root / "tmp/scan-imports" / uuid.uuid4().hex
        incoming.mkdir(parents=True, exist_ok=True)
        total = 0
        try:
            for upload in files:
                path = safe_path(incoming, upload.filename or "upload")
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("wb") as output:
                    while chunk := await upload.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_BUNDLE_BYTES:
                            raise HTTPException(413, "扫描包不能超过 300 MB")
                        output.write(chunk)
                if len(files) == 1 and path.suffix.lower() == ".zip":
                    with zipfile.ZipFile(path) as archive:
                        if len(archive.infolist()) > 5000 or sum(info.file_size for info in archive.infolist()) > MAX_BUNDLE_BYTES:
                            raise HTTPException(413, "解压后的扫描包过大")
                        for info in archive.infolist():
                            target = safe_path(incoming, info.filename)
                            if not info.is_dir():
                                target.parent.mkdir(parents=True, exist_ok=True)
                                with archive.open(info) as source, target.open("wb") as output:
                                    shutil.copyfileobj(source, output)
            return await adopt(find_bundle(incoming), auto_reconstruct)
        except (ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
            raise HTTPException(422, str(error)) from error
        finally:
            await asyncio.to_thread(shutil.rmtree, incoming, ignore_errors=True)
            for upload in files:
                await upload.close()

    @app.get("/api/scenes/latest")
    async def latest_scene() -> dict:
        latest = scenes_root / "latest.json"
        if not latest.is_file():
            raise HTTPException(404, "暂无扫描场景")
        return refresh(load(read_json(latest)["id"]))

    @app.get("/api/scenes/{scene_id}")
    async def get_scene(scene_id: str) -> dict:
        return refresh(load(scene_id))

    @app.get("/api/scenes/{scene_id}/files/{relative:path}")
    async def scan_file(scene_id: str, relative: str) -> FileResponse:
        try:
            path = safe_path(bundle_path(load(scene_id)), relative)
        except ValueError as error:
            raise HTTPException(404, "资源不存在") from error
        if not path.is_file() or path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            raise HTTPException(404, "资源不存在")
        return FileResponse(path)

    @app.post("/api/scenes/{scene_id}/reconstruct", status_code=202)
    async def reconstruct_scene(scene_id: str) -> dict:
        scene = refresh(load(scene_id))
        retry_ids = {item["id"] for item in scene["furniture"] if item.get("generationStatus") in ("failed", "needs_review")}
        schedule(scene, True, retry_ids)
        return refresh(load(scene_id))

    @app.post("/api/scenes/{scene_id}/furniture/{furniture_id}/reconstruct", status_code=202)
    async def reconstruct_one(scene_id: str, furniture_id: str) -> dict:
        scene = load(scene_id)
        if not any(item["id"] == furniture_id for item in scene["furniture"]):
            raise HTTPException(404, "家具不存在")
        schedule(scene, True, {furniture_id})
        return refresh(load(scene_id))
