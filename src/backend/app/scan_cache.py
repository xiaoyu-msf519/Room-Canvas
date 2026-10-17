"""Portable scan-local results: public states and self-contained models, no keys."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import struct
from pathlib import Path

from .scans import read_json, safe_path, write_json

CACHE_FOLDER = ".roomcanvas-cache"
CACHE_SCHEMA = "roomcanvas.cache.v1"
MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024


def model_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def cache_index(bundle: Path) -> dict | None:
    path = safe_path(bundle, f"{CACHE_FOLDER}/cache.json")
    if not path.is_file():
        if path.parent.is_dir() and any(path.parent.iterdir()):
            raise ValueError("扫描目录缓存索引缺失；不会自动重新生成")
        return None
    value = read_json(path)
    if not isinstance(value, dict) or value.get("schemaVersion") != CACHE_SCHEMA:
        raise ValueError("不支持的房间缓存版本；不会自动重新生成")
    records = value.get("furniture")
    if not isinstance(records, list) or any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in records):
        raise ValueError("房间缓存索引损坏；不会自动重新生成")
    for item in records:
        if item.get("status") not in ("pending", "preparing", "queued", "uploading", "generating", "scaling", "succeeded", "failed", "needs_review"):
            raise ValueError("缓存任务状态无效；不会自动重新生成")
        for key in ("model", "editModel"):
            descriptor = item.get(key)
            if descriptor is not None and (not isinstance(descriptor, dict) or not isinstance(descriptor.get("file"), str) or not isinstance(descriptor.get("sha256"), str)):
                raise ValueError("模型缓存记录无效；不会自动重新生成")
    return value


def cache_resources(bundle: Path) -> list[str]:
    cache = cache_index(bundle)
    if cache is None:
        return []
    files = [f"{CACHE_FOLDER}/cache.json"]
    for item in cache.get("furniture", []):
        for key in ("model", "editModel"):
            descriptor = item.get(key)
            if descriptor:
                relative = descriptor["file"]
                if not re.fullmatch(r"models/[a-f0-9]{64}\.glb", relative):
                    raise ValueError("缓存模型路径无效；不会自动重新生成")
                path = safe_path(bundle, f"{CACHE_FOLDER}/{relative}")
                if path.is_file():
                    files.append(f"{CACHE_FOLDER}/{relative}")
    return sorted(set(files))


def restore_cache(scene: dict, bundle: Path, models_root: Path, read_generation) -> bool:
    cache = cache_index(bundle)
    if cache is None:
        return False
    if cache.get("fingerprint") != scene.get("importFingerprint") or str(cache.get("scanId", "")).lower() != scene["source"]["scanId"].lower():
        raise ValueError("房间缓存与采集内容不一致；已停止自动生成，避免重复付费")
    records = {item["id"]: item for item in cache.get("furniture", [])}
    if len(records) != len(cache["furniture"]) or set(records) != {item["id"] for item in scene["furniture"]}:
        raise ValueError("房间缓存的家具索引不完整；不会自动重新生成")
    models_root.mkdir(parents=True, exist_ok=True)
    for item in scene["furniture"]:
        stored = records.get(item["id"])
        if not stored:
            continue
        current = read_generation(item.get("jobId", ""))
        model_paths = [safe_path(models_root, str(item.get(field, "")).rsplit("/", 1)[-1]) for field in ("modelUrl", "editModelUrl")]
        if ((current and current.status == "succeeded") or item.get("generationStatus") == "succeeded") and all(path.is_file() for path in model_paths):
            continue
        status = stored.get("status", "pending")
        if status == "succeeded":
            try:
                urls = {}
                for key, field in (("model", "modelUrl"), ("editModel", "editModelUrl")):
                    descriptor = stored[key]
                    relative, sha = descriptor["file"], descriptor["sha256"]
                    if not re.fullmatch(r"models/[a-f0-9]{64}\.glb", relative) or not re.fullmatch(r"[a-f0-9]{64}", sha):
                        raise ValueError("模型路径或校验值无效")
                    path = safe_path(bundle, f"{CACHE_FOLDER}/{relative}")
                    with path.open("rb") as file:
                        magic, version, size = struct.unpack("<4sII", file.read(12))
                        length, kind = struct.unpack("<II", file.read(8))
                        if kind != 0x4E4F534A or length > min(size, 32 * 1024 * 1024):
                            raise ValueError("GLB 元数据无效")
                        document = json.loads(file.read(length))
                    if not document.get("textures") or not document.get("images") or any("bufferView" not in image for image in document["images"]) or any(buffer.get("uri") for buffer in document.get("buffers", [])):
                        raise ValueError("模型缓存不是内嵌纹理的独立 GLB")
                    if magic != b"glTF" or version != 2 or size != path.stat().st_size or model_digest(path) != sha:
                        raise ValueError("模型缓存校验失败")
                    target = models_root / f"cache-{sha}.glb"
                    if not target.is_file() or target.stat().st_size != size:
                        shutil.copy2(path, target)
                    urls[field] = f"/api/assets/{target.name}"
                item.pop("jobId", None)
                item.update(**urls, generationStatus="succeeded", stageMessage="已从扫描目录缓存载入", error=None)
            except (OSError, ValueError, KeyError, struct.error):
                item.pop("jobId", None)
                item.update(generationStatus="failed", stageMessage="模型缓存缺失或损坏", error="缓存无法完整读取，已停止自动重新生成；请恢复缓存或明确重试")
        elif status in ("queued", "preparing", "uploading", "generating", "scaling"):
            job = read_generation(stored.get("jobId", ""))
            if job:
                item.update(jobId=job.job_id, generationStatus=job.status)
            elif not current:
                item.update(generationStatus="failed", stageMessage="原生成任务需核对", error="缓存记录了未完成任务，但本机任务记录已丢失；不会自动再次提交付费任务")
        elif status in ("failed", "needs_review") and not current:
            item.update(generationStatus=status, stageMessage=stored.get("stageMessage", "需检查缓存任务"), error=stored.get("error"))
    finishes = cache.get("finishes", {})
    for surface in scene["room"]["surfaces"]:
        finish = finishes.get(surface["id"])
        if finish and re.fullmatch(r"#[a-fA-F0-9]{6}", finish.get("baseColor", "")):
            surface["finish"] = finish
    if cache.get("finishRecovery"):
        scene["finishRecovery"] = cache["finishRecovery"]
    scene["cache"] = {"restored": True, "folder": CACHE_FOLDER}
    return True


def save_cache(scene: dict, bundle: Path, models_root: Path) -> None:
    output = safe_path(bundle, CACHE_FOLDER)
    output.mkdir(parents=True, exist_ok=True)
    previous = cache_index(bundle)
    if previous and previous.get("fingerprint") != scene.get("importFingerprint"):
        raise ValueError("缓存内容与当前扫描不一致")
    records = []
    for item in scene["furniture"]:
        record = {"id": item["id"], "status": item.get("generationStatus", "pending")}
        for key in ("jobId", "stageMessage"):
            if item.get(key):
                record[key] = item[key]
        if item.get("error"):
            record["error"] = "原处理未完成；请在原服务查看详情或补拍，缓存不会自动重新计费"
        if record["status"] == "succeeded":
            for key, field in (("model", "modelUrl"), ("editModel", "editModelUrl")):
                name = str(item.get(field, "")).rsplit("/", 1)[-1]
                path = safe_path(models_root, name)
                if not name or not path.is_file():
                    record["status"] = "failed"
                    record["error"] = "已有模型文件缺失；不会自动重新生成"
                    break
                # Reuse a completed entry when its immutable source URL matches.
                old = next((entry for entry in (previous or {}).get("furniture", []) if entry["id"] == item["id"]), {})
                descriptor = old.get(key)
                if not descriptor or descriptor.get("sourceName") != name or not safe_path(output, descriptor["file"]).is_file():
                    sha = model_digest(path)
                    relative = f"models/{sha}.glb"
                    target = safe_path(output, relative)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.is_file() or target.stat().st_size != path.stat().st_size:
                        temporary = target.with_suffix(".writing")
                        shutil.copy2(path, temporary)
                        temporary.replace(target)
                    descriptor = {"file": relative, "sha256": sha, "sourceName": name}
                record[key] = descriptor
        records.append(record)
    value = {"schemaVersion": CACHE_SCHEMA, "scanId": scene["source"]["scanId"], "fingerprint": scene["importFingerprint"],
             "furniture": records, "finishes": {surface["id"]: surface["finish"] for surface in scene["room"]["surfaces"] if surface.get("finish")},
             "finishRecovery": scene.get("finishRecovery")}
    write_json(output / "cache.json", value)
