from __future__ import annotations

import asyncio
import json
import os
import shutil
import struct
import uuid
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import httpx
import trimesh
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parents[3]
TMP_ROOT = ROOT / "tmp"
UPLOAD_ROOT = TMP_ROOT / "uploads"
JOB_ROOT = TMP_ROOT / "jobs"
MODEL_ROOT = TMP_ROOT / "models"
RODIN_BASE_URL = "https://api.hyper3d.com/api/v2"
MAX_IMAGE_BYTES = 15 * 1024 * 1024

for folder in (UPLOAD_ROOT, JOB_ROOT, MODEL_ROOT):
    folder.mkdir(parents=True, exist_ok=True)


@dataclass
class GenerationJob:
    job_id: str
    asset_id: str
    name: str
    status: str = "uploading"
    stage_message: str = "上传图片到安全后端…"
    width_mm: float = 0
    depth_mm: float = 0
    height_mm: float = 0
    model_url: str | None = None
    error: str | None = None
    subscription_key: str | None = field(default=None, repr=False)
    task_uuid: str | None = field(default=None, repr=False)

    def public(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.pop("subscription_key", None)
        payload.pop("task_uuid", None)
        return payload


app = FastAPI(title="RoomCanvas API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
jobs: dict[str, GenerationJob] = {}


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "rodin": "configured" if os.getenv("RODIN_API_KEY") else "missing_key"}


@app.post("/api/generations", status_code=202)
async def create_generation(
    image: UploadFile = File(...),
    asset_id: str = Form(...),
    name: str = Form("RoomCanvas asset"),
    width_mm: float = Form(...),
    depth_mm: float = Form(...),
    height_mm: float = Form(...),
) -> dict[str, Any]:
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="只支持图片上传")
    dimensions = (width_mm, depth_mm, height_mm)
    if not all(0 < value <= 100000 for value in dimensions):
        raise HTTPException(status_code=422, detail="尺寸必须为 0 到 100000 mm")

    job_id = uuid.uuid4().hex
    suffix = Path(image.filename or "upload.png").suffix.lower() or ".png"
    source_path = UPLOAD_ROOT / f"{job_id}{suffix}"
    total = 0
    with source_path.open("wb") as output:
        while chunk := await image.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_IMAGE_BYTES:
                source_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="图片不能超过 15 MB")
            output.write(chunk)

    job = GenerationJob(job_id, asset_id, name, width_mm=width_mm, depth_mm=depth_mm, height_mm=height_mm)
    jobs[job_id] = job
    _write_job(job)
    asyncio.create_task(_run_generation(job, source_path, image.content_type))
    return {"job_id": job_id, "status": job.status, "stage_message": job.stage_message}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id) or _read_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job.public()


@app.get("/api/assets/{asset_name}")
async def get_asset(asset_name: str) -> FileResponse:
    safe_name = Path(asset_name).name
    model_path = MODEL_ROOT / safe_name
    if model_path.suffix != ".glb" or not model_path.is_file():
        raise HTTPException(status_code=404, detail="模型不存在")
    return FileResponse(model_path, media_type="model/gltf-binary", filename=safe_name)


async def _run_generation(job: GenerationJob, source_path: Path, content_type: str) -> None:
    try:
        api_key = os.getenv("RODIN_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("后端未配置 RODIN_API_KEY，暂时无法调用 Rodin")

        job.status = "generating"
        job.stage_message = "Rodin 正在生成独立 3D 模型…"
        _write_job(job)
        submitted = await _submit_rodin(api_key, source_path, content_type)
        job.subscription_key = submitted["subscription_key"]
        job.task_uuid = submitted["task_uuid"]
        await _wait_for_rodin(job, api_key)

        job.status = "scaling"
        job.stage_message = "正在按输入毫米尺寸缩放 GLB…"
        _write_job(job)
        raw_path = await _download_rodin(api_key, job.task_uuid, job.job_id)
        scaled_path = MODEL_ROOT / f"{job.job_id}.glb"
        await asyncio.to_thread(_scale_glb, raw_path, scaled_path, job.width_mm, job.depth_mm, job.height_mm)
        job.status = "succeeded"
        job.stage_message = "生成完成，已按输入尺寸校准"
        job.model_url = f"/api/assets/{scaled_path.name}"
        _write_job(job)
    except Exception as error:  # The UI needs a terminal failure state for every task.
        job.status = "failed"
        job.stage_message = "生成未完成"
        job.error = str(error)
        _write_job(job)


async def _submit_rodin(api_key: str, source_path: Path, content_type: str) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    # Explicitly request a textured GLB. Rodin's default texture mode follows
    # the tier, but keeping it explicit prevents a future schema/default change
    # from producing an untextured mesh for furniture assets.
    data = {
        "tier": "Gen-2.5-Medium",
        "mesh_mode": "Raw",
        "quality": "medium",
        "geometry_file_format": "glb",
        "texture_mode": os.getenv("RODIN_TEXTURE_MODE", "high"),
    }
    verify_tls = os.getenv("RODIN_VERIFY_TLS", "1") != "0"
    async with httpx.AsyncClient(timeout=60, verify=verify_tls) as client:
        with source_path.open("rb") as source:
            response = await client.post(
                f"{RODIN_BASE_URL}/rodin",
                headers=headers,
                data=data,
                files={"images": (source_path.name, source, content_type)},
            )
        response.raise_for_status()
        payload = response.json()
    task_uuid = payload.get("uuid")
    subscription_key = (payload.get("jobs") or {}).get("subscription_key")
    if not task_uuid or not subscription_key:
        raise RuntimeError("Rodin 未返回有效任务标识")
    return {"task_uuid": task_uuid, "subscription_key": subscription_key}


async def _wait_for_rodin(job: GenerationJob, api_key: str) -> None:
    verify_tls = os.getenv("RODIN_VERIFY_TLS", "1") != "0"
    delay = 5
    deadline = asyncio.get_running_loop().time() + 20 * 60
    async with httpx.AsyncClient(timeout=60, verify=verify_tls) as client:
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(delay)
            response = await client.post(
                f"{RODIN_BASE_URL}/status",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"subscription_key": job.subscription_key},
            )
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "5")
                await asyncio.sleep(max(1, min(int(retry_after) if retry_after.isdigit() else 5, 60)))
                continue
            response.raise_for_status()
            payload = response.json()
            states = [item.get("status") for item in payload.get("jobs", [])]
            if "Failed" in states:
                raise RuntimeError(f"Rodin 任务失败: {payload}")
            if states and all(state == "Done" for state in states):
                return
            delay = min(delay + 5, 30)
    raise TimeoutError("Rodin 任务超过 20 分钟仍未完成")


async def _download_rodin(api_key: str, task_uuid: str | None, job_id: str) -> Path:
    if not task_uuid:
        raise RuntimeError("缺少 Rodin task_uuid")
    verify_tls = os.getenv("RODIN_VERIFY_TLS", "1") != "0"
    async with httpx.AsyncClient(timeout=120, verify=verify_tls) as client:
        response = await client.post(
            f"{RODIN_BASE_URL}/download",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"task_uuid": task_uuid},
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "json" in content_type:
            payload = response.json()
            download_url = _find_download_url(payload)
            if not download_url:
                raise RuntimeError("Rodin 下载响应中没有模型地址")
            response = await client.get(download_url)
            response.raise_for_status()
        raw_path = MODEL_ROOT / f"{job_id}-raw.bin"
        raw_path.write_bytes(response.content)

    if zipfile.is_zipfile(raw_path):
        extracted = MODEL_ROOT / f"{job_id}-raw.glb"
        with zipfile.ZipFile(raw_path) as archive:
            glb_names = [name for name in archive.namelist() if name.lower().endswith(".glb")]
            if not glb_names:
                raise RuntimeError("Rodin 下载包中没有 GLB")
            with archive.open(glb_names[0]) as source, extracted.open("wb") as target:
                shutil.copyfileobj(source, target)
        return extracted
    raw_path.rename(raw_path.with_suffix(".glb"))
    return raw_path.with_suffix(".glb")


def _find_download_url(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in {"url", "download_url", "model_url", "glb_url"} and isinstance(item, str) and item.startswith("http"):
                return item
            found = _find_download_url(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = _find_download_url(item)
            if found:
                return found
    return None


def _scale_glb(source_path: Path, target_path: Path, width_mm: float, depth_mm: float, height_mm: float) -> None:
    scene = trimesh.load(source_path, force="scene")
    bounds = scene.bounds
    extents = bounds[1] - bounds[0]
    if not all(extents > 1e-6):
        raise RuntimeError("GLB 几何尺寸无效，无法进行真实尺度校准")
    center = (bounds[0] + bounds[1]) / 2
    target = [width_mm / 1000, height_mm / 1000, depth_mm / 1000]
    scale = [target[0] / extents[0], target[1] / extents[1], target[2] / extents[2]]

    # Re-exporting a textured GLB through trimesh can drop embedded images.
    # Keep every original GLB chunk and add one wrapper node containing the
    # centering and scale transform, so geometry and texture references survive.
    raw = source_path.read_bytes()
    magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or declared_length != len(raw):
        raise RuntimeError("GLB 文件头无效")
    chunks: list[tuple[int, bytes]] = []
    offset = 12
    json_chunk_index = -1
    document: dict[str, Any] | None = None
    while offset < len(raw):
        chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        chunk = raw[offset:offset + chunk_length]
        offset += chunk_length
        chunks.append((chunk_type, chunk))
        if chunk_type == 0x4E4F534A:
            json_chunk_index = len(chunks) - 1
            document = json.loads(chunk.rstrip(b" \t\r\n").decode("utf-8"))
    if json_chunk_index < 0 or document is None:
        raise RuntimeError("GLB 缺少 JSON chunk")

    scenes = document.get("scenes") or []
    scene_index = int(document.get("scene", 0))
    if not scenes or scene_index >= len(scenes):
        raise RuntimeError("GLB 缺少有效场景")
    roots = list(scenes[scene_index].get("nodes", []))
    nodes = document.setdefault("nodes", [])
    wrapper_index = len(nodes)
    nodes.append({
        "name": "RoomCanvasRealScale",
        "children": roots,
        "translation": [float(-center[0] * scale[0]), float(-center[1] * scale[1]), float(-center[2] * scale[2])],
        "scale": [float(scale[0]), float(scale[1]), float(scale[2])],
    })
    scenes[scene_index]["nodes"] = [wrapper_index]
    encoded_json = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded_json += b" " * ((4 - len(encoded_json) % 4) % 4)
    chunks[json_chunk_index] = (0x4E4F534A, encoded_json)
    output = bytearray(struct.pack("<4sII", b"glTF", version, 0))
    for chunk_type, chunk in chunks:
        output.extend(struct.pack("<II", len(chunk), chunk_type))
        output.extend(chunk)
    struct.pack_into("<I", output, 8, len(output))
    target_path.write_bytes(output)


def _write_job(job: GenerationJob) -> None:
    (JOB_ROOT / f"{job.job_id}.json").write_text(json.dumps(job.public(), ensure_ascii=False, indent=2), encoding="utf-8")


def _read_job(job_id: str) -> GenerationJob | None:
    path = JOB_ROOT / f"{Path(job_id).name}.json"
    if not path.is_file():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    job = GenerationJob(**{key: value for key, value in payload.items() if key in GenerationJob.__dataclass_fields__})
    jobs[job_id] = job
    return job
