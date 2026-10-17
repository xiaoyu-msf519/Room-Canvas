from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from .scan_crops import prepare_furniture_crop, CropNeedsReview
from .scan_import import MAX_BUNDLE_BYTES, bundle_inventory, find_bundle
from .scan_cache import CACHE_FOLDER, MAX_CACHE_BYTES, cache_index, cache_resources, restore_cache, save_cache
from .scans import adapt_scan, read_json, safe_path, write_json
from .surface_materials import apply_finishes


def register_scan_routes(app: FastAPI, root: Path, start_generation, read_generation) -> None:
    scenes_root = root / "tmp/scans"
    scenes_root.mkdir(parents=True, exist_ok=True)
    import_lock = asyncio.Lock()
    processing: dict[str, asyncio.Task] = {}
    cache_workers: dict[str, asyncio.Task] = {}
    cache_locks: dict[str, asyncio.Lock] = {}
    library_root = Path(os.getenv("ROOMCANVAS_LIBRARY_DIR", str(root / "reference/ToCodex/room"))).resolve()
    models_root = root / "tmp/models"

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

    async def snapshot_targets(scene: dict) -> None:
        targets_path = scene_path(scene["id"]).parent / "cache-targets.json"
        if not targets_path.is_file():
            return
        async with cache_locks.setdefault(scene["id"], asyncio.Lock()):
            for target in read_json(targets_path):
                bundle = Path(target).resolve()
                if not bundle.is_relative_to(library_root) or not (bundle / "manifest.json").is_file():
                    continue
                await asyncio.to_thread(save_cache, scene, bundle, models_root)

    def monitor_cache(scene_id: str) -> None:
        if scene_id in cache_workers and not cache_workers[scene_id].done():
            return
        async def run():
            previous = None
            while True:
                scene = refresh(load(scene_id))
                signature = json.dumps({"furniture": scene["furniture"], "pipeline": scene.get("pipeline"), "finishes": scene.get("finishRecovery")}, sort_keys=True)
                if signature != previous:
                    try:
                        await snapshot_targets(scene)
                    except (OSError, ValueError, KeyError):
                        stored = load(scene_id)
                        stored["cache"] = {"warning": "扫描目录缓存写入失败，请检查目录权限与磁盘空间"}
                        write_json(scene_path(scene_id), stored)
                    previous = signature
                if scene.get("pipeline", {}).get("status") != "processing":
                    return
                await asyncio.sleep(2)
        task = asyncio.create_task(run())
        cache_workers[scene_id] = task
        task.add_done_callback(lambda finished: cache_workers.pop(scene_id, None) if cache_workers.get(scene_id) is finished else None)

    async def process_scene(scene_id: str, retry_ids: set[str]) -> None:
        try:
            scene = load(scene_id)
            scene["pipeline"].update(preparation="running", error=None)
            write_json(scene_path(scene_id), scene)
            bundle = bundle_path(scene)
            if not (scene.get("cache", {}).get("restored") and scene.get("finishRecovery", {}).get("status") == "complete"):
                await asyncio.to_thread(apply_finishes, scene, bundle, scene_path(scene_id).parent / "surface-finishes.json")
            write_json(scene_path(scene_id), scene)
            if scene["pipeline"].get("autoReconstruct"):
                for furniture_id in [item["id"] for item in scene["furniture"]]:
                    scene = load(scene_id)
                    item = next(item for item in scene["furniture"] if item["id"] == furniture_id)
                    current = read_generation(item.get("jobId", ""))
                    retry = furniture_id in retry_ids
                    if item.get("generationStatus") == "succeeded" and item.get("modelUrl") and item.get("editModelUrl"):
                        continue
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
                        # Persist an in-flight marker beside the scan before a
                        # provider request. Losing tmp must not trigger a new bill.
                        try:
                            await snapshot_targets(scene)
                        except (OSError, ValueError, KeyError):
                            item.update(generationStatus="failed", stageMessage="扫描目录缓存写入失败", error="请检查扫描目录权限、缓存完整性及磁盘空间；尚未提交图生 3D")
                            write_json(scene_path(scene_id), scene)
                            continue
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
        monitor_cache(scene_id)

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
            elif pipeline:
                monitor_cache(scene["id"])

    async def adopt(bundle: Path, auto: bool, cache_target: Path | None = None) -> dict:
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
                else:
                    scene_id = uuid.uuid5(uuid.NAMESPACE_URL, f"roomcanvas.scan:{scan_id}").hex
                    scene = await asyncio.to_thread(adapt_scan, bundle, scene_id)
                    destination = scene_path(scene_id).parent / "bundle"
                    for relative in files:
                        target = safe_path(destination, relative)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        await asyncio.to_thread(shutil.copy2, safe_path(bundle, relative), target)
                    scene["importFingerprint"] = fingerprint
                await asyncio.to_thread(restore_cache, scene, bundle, models_root, read_generation)
                write_json(scene_path(scene["id"]), scene)
                if cache_target is not None:
                    targets_path = scene_path(scene["id"]).parent / "cache-targets.json"
                    targets = read_json(targets_path) if targets_path.is_file() else []
                    target = str(cache_target.resolve())
                    if target not in targets:
                        targets.append(target)
                        write_json(targets_path, targets)
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

    def library_entries() -> list[tuple[dict, Path]]:
        entries = []
        if not library_root.is_dir():
            return entries
        for manifest_path in library_root.rglob("manifest.json"):
            bundle = manifest_path.parent.resolve()
            if not bundle.is_relative_to(library_root) or CACHE_FOLDER in bundle.parts:
                continue
            relative = bundle.relative_to(library_root).as_posix()
            try:
                metadata = read_json(manifest_path)
                cached = cache_index(bundle)
                completed = sum(item.get("status") == "succeeded" for item in (cached or {}).get("furniture", []))
                entry = {"id": hashlib.sha256(relative.encode()).hexdigest()[:24], "folder": relative, "title": metadata.get("title", relative),
                         "scanId": metadata["id"], "status": metadata.get("status"), "objectCount": metadata.get("objectCount", 0),
                         "cachedModels": completed, "hasCache": cached is not None, "createdAt": metadata.get("createdAt", "")}
                entries.append((entry, bundle))
            except (OSError, ValueError, KeyError):
                entries.append(({"id": hashlib.sha256(relative.encode()).hexdigest()[:24], "folder": relative, "title": relative,
                                 "status": "invalid", "objectCount": 0, "cachedModels": 0, "hasCache": False}, bundle))
        return sorted(entries, key=lambda entry: entry[0].get("createdAt", ""), reverse=True)

    @app.get("/api/room-library")
    async def room_library() -> dict:
        return {"rooms": [entry for entry, _ in await asyncio.to_thread(library_entries)]}

    @app.post("/api/room-library/{room_id}/load")
    async def load_library_room(room_id: str, auto_reconstruct: bool = True) -> dict:
        entry = next(((entry, bundle) for entry, bundle in await asyncio.to_thread(library_entries) if entry["id"] == room_id), None)
        if entry is None:
            raise HTTPException(404, "房间不存在")
        metadata, bundle = entry
        if metadata["status"] != "complete":
            raise HTTPException(422, "这份 App 扫描未完成或缓存无效，不能自动建房")
        return await adopt(bundle, auto_reconstruct, cache_target=bundle)

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
                        if total > MAX_BUNDLE_BYTES + MAX_CACHE_BYTES:
                            raise HTTPException(413, "扫描数据和模型缓存超过大小限制")
                        output.write(chunk)
                if len(files) == 1 and path.suffix.lower() == ".zip":
                    with zipfile.ZipFile(path) as archive:
                        if len(archive.infolist()) > 5000 or sum(info.file_size for info in archive.infolist()) > MAX_BUNDLE_BYTES + MAX_CACHE_BYTES:
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

    @app.post("/api/scenes/{scene_id}/activate")
    async def activate_scene(scene_id: str) -> dict:
        scene = load(scene_id)
        write_json(scenes_root / "latest.json", {"id": scene_id})
        return refresh(scene)

    @app.get("/api/scenes/{scene_id}/cache")
    async def download_scene_cache(scene_id: str) -> FileResponse:
        scene = refresh(load(scene_id))
        if not scene.get("importFingerprint"):
            _, fingerprint, _ = await asyncio.to_thread(bundle_inventory, bundle_path(scene))
            scene["importFingerprint"] = fingerprint
        destination = root / "tmp/cache-exports" / uuid.uuid4().hex
        await asyncio.to_thread(save_cache, scene, destination, models_root)
        archive_path = destination / "roomcanvas-cache.zip"
        def archive():
            with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_STORED) as output:
                for relative in cache_resources(destination):
                    output.write(safe_path(destination, relative), relative)
        await asyncio.to_thread(archive)
        return FileResponse(archive_path, filename="roomcanvas-cache.zip", background=BackgroundTask(shutil.rmtree, destination, ignore_errors=True))

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
