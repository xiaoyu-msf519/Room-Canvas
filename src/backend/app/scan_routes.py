from __future__ import annotations

import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .scans import adapt_scan, read_json, safe_path, write_json

MAX_BUNDLE_BYTES = 300 * 1024 * 1024


def register_scan_routes(app: FastAPI, root: Path, start_generation, read_generation) -> None:
    scenes_root = root / "tmp" / "scans"
    scenes_root.mkdir(parents=True, exist_ok=True)

    def scene_path(scene_id: str) -> Path:
        if not scene_id.isalnum():
            raise HTTPException(404, "场景不存在")
        return scenes_root / scene_id / "scene-manifest.json"

    def load(scene_id: str) -> dict:
        path = scene_path(scene_id)
        if not path.is_file():
            raise HTTPException(404, "场景不存在")
        return read_json(path)

    def save_scene(bundle: Path, scene_id: str) -> dict:
        try:
            scene = adapt_scan(bundle, scene_id)
        except (ValueError, KeyError, TypeError, OSError) as error:
            raise HTTPException(422, f"扫描包结构不正确: {error}") from error
        write_json(scene_path(scene_id), scene)
        write_json(scenes_root / "latest.json", {"id": scene_id})
        return scene

    def refresh(scene: dict) -> dict:
        for item in scene["furniture"]:
            job = read_generation(item.get("jobId", ""))
            if job:
                item.update(generationStatus=job.status, stageMessage=job.stage_message, error=job.error)
                if job.status == "succeeded":
                    item.update(modelUrl=job.model_url, editModelUrl=job.edit_model_url)
        return scene

    @app.post("/api/scans/demo")
    async def import_demo() -> dict:
        bundle = root / "reference" / "ToCodex" / "ScanDemoWithDirectionResult"
        if not bundle.is_dir():
            bundle = root / "reference" / "ToCodex" / "ScanDemoResult"
        if not bundle.is_dir():
            raise HTTPException(404, "本机未找到 ScanDemoResult")
        # Stable ID makes repeated imports reuse the same generated models.
        scene_id = uuid.uuid5(uuid.NAMESPACE_URL, str(bundle.resolve())).hex
        if scene_path(scene_id).is_file():
            existing = load(scene_id)
            # Re-adapt once when the scanner contract gains derived geometry
            # such as the synthesized ceiling. Preserve every paid model job.
            if not any(surface.get("kind") == "ceiling" for surface in existing["room"].get("surfaces", [])):
                destination = scene_path(scene_id).parent / "bundle"
                rebuilt = save_scene(destination, scene_id)
                old_by_id = {item["id"]: item for item in existing["furniture"]}
                for item in rebuilt["furniture"]:
                    old = old_by_id.get(item["id"])
                    if old:
                        for key in ("jobId", "generationStatus", "modelUrl", "editModelUrl", "stageMessage", "error"):
                            if key in old: item[key] = old[key]
                write_json(scene_path(scene_id), rebuilt)
                existing = rebuilt
            write_json(scenes_root / "latest.json", {"id": scene_id})
            return refresh(existing)
        destination = scenes_root / scene_id / "bundle"
        destination.mkdir(parents=True, exist_ok=True)
        for name in ("manifest.json", "scene.json", "cameras.json"):
            shutil.copy2(bundle / name, destination / name)
        if (bundle / "heading.json").is_file():
            shutil.copy2(bundle / "heading.json", destination / "heading.json")
        # Keep source images/poses available without duplicating the depth cache.
        for name in ("objects", "frames", "surfaces"):
            shutil.copytree(bundle / name, destination / name, dirs_exist_ok=True)
        return save_scene(destination, scene_id)

    @app.post("/api/scans", status_code=201)
    async def upload_scan(files: list[UploadFile] = File(...)) -> dict:
        scene_id = uuid.uuid4().hex
        destination = scenes_root / scene_id / "bundle"
        destination.mkdir(parents=True, exist_ok=True)
        total = 0
        try:
            for upload in files:
                path = safe_path(destination, upload.filename or "upload")
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("wb") as output:
                    while chunk := await upload.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_BUNDLE_BYTES:
                            raise HTTPException(413, "扫描包不能超过 300 MB")
                        output.write(chunk)
                if len(files) == 1 and path.suffix.lower() == ".zip":
                    with zipfile.ZipFile(path) as archive:
                        if len(archive.infolist()) > 5000 or sum(i.file_size for i in archive.infolist()) > MAX_BUNDLE_BYTES:
                            raise HTTPException(413, "解压后的扫描包过大")
                        for info in archive.infolist():
                            target = safe_path(destination, info.filename)
                            if info.is_dir():
                                target.mkdir(parents=True, exist_ok=True)
                            else:
                                target.parent.mkdir(parents=True, exist_ok=True)
                                with archive.open(info) as source, target.open("wb") as output:
                                    shutil.copyfileobj(source, output)
            manifests = list(destination.rglob("manifest.json"))
            if len(manifests) != 1:
                raise ValueError("必须包含唯一的 manifest.json")
            bundle = manifests[0].parent
            # Record the nested bundle root for resource and reconstruction paths.
            scene = save_scene(bundle, scene_id)
            scene["bundleSubdir"] = bundle.relative_to(destination).as_posix()
            write_json(scene_path(scene_id), scene)
            return scene
        except (ValueError, zipfile.BadZipFile) as error:
            raise HTTPException(422, str(error)) from error

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
        scene = load(scene_id)
        bundle = scene_path(scene_id).parent / "bundle" / scene.get("bundleSubdir", "")
        try:
            path = safe_path(bundle, relative)
        except ValueError as error:
            raise HTTPException(404, "资源不存在") from error
        if not path.is_file() or path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            raise HTTPException(404, "资源不存在")
        return FileResponse(path)

    def reconstruct(scene: dict, item: dict) -> None:
        current = read_generation(item.get("jobId", ""))
        if current and current.status != "failed":
            return
        if not item["crops"]:
            item.update(generationStatus="failed", error="没有可用裁剪图")
            return
        bundle = scene_path(scene["id"]).parent / "bundle" / scene.get("bundleSubdir", "")
        crop = safe_path(bundle, item["crops"][0]["imagePath"])
        width, height, depth = item["size"]
        prompt = f"A single {item['category']}. Reconstruct only the target central {item['category']} inside the crop. Do not merge, duplicate, or reconstruct any neighboring or partially visible furniture, especially visually similar adjacent chairs. Exclude background, floor, walls, and neighboring furniture. Upright, Y-up."
        content_type = "image/png" if crop.suffix.lower() == ".png" else "image/jpeg"
        job = start_generation(item["id"], item["name"], crop, content_type, width*1000, depth*1000, height*1000, prompt)
        item.update(jobId=job.job_id, generationStatus=job.status)

    @app.post("/api/scenes/{scene_id}/reconstruct", status_code=202)
    async def reconstruct_scene(scene_id: str) -> dict:
        scene = load(scene_id)
        for item in scene["furniture"]:
            reconstruct(scene, item)
        write_json(scene_path(scene_id), scene)
        return refresh(scene)

    @app.post("/api/scenes/{scene_id}/furniture/{furniture_id}/reconstruct", status_code=202)
    async def reconstruct_one(scene_id: str, furniture_id: str) -> dict:
        scene = load(scene_id)
        item = next((i for i in scene["furniture"] if i["id"] == furniture_id), None)
        if not item:
            raise HTTPException(404, "家具不存在")
        reconstruct(scene, item)
        write_json(scene_path(scene_id), scene)
        return refresh(scene)
