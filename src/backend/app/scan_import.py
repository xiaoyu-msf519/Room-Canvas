"""Content identity and minimal input inventory for any App scan folder."""
import hashlib
import json
from pathlib import Path
import uuid

from .scans import read_json, safe_path

MAX_BUNDLE_BYTES = 300 * 1024 * 1024


def find_bundle(directory: Path) -> Path:
    manifests = list(directory.rglob("manifest.json"))
    if len(manifests) != 1:
        raise ValueError("请选择包含唯一 manifest.json 的 App 输出目录")
    return manifests[0].parent


def bundle_inventory(bundle: Path) -> tuple[str, str, list[str]]:
    manifest = read_json(bundle / "manifest.json")
    source = read_json(bundle / "scene.json")
    cameras = read_json(bundle / "cameras.json")
    scan_id = str(uuid.UUID(manifest["id"]))
    if source.get("scanId", "").lower() != scan_id or manifest.get("status") != "complete":
        raise ValueError("扫描包未完成或 scanId 不一致")
    if manifest.get("schemaVersion") != "roomcanvas.scan.v1" or source.get("schemaVersion") != "roomcanvas.scene.v1":
        raise ValueError("不支持的扫描协议")
    required = {"manifest.json", "scene.json", "cameras.json"}
    optional = set()
    for camera in cameras:
        required.add(camera["imagePath"])
        depth = camera.get("depth") or {}
        optional.update(value for key, value in depth.items() if key in ("depthPath", "confidencePath") and value)
    for obj in source["objects"]:
        # Missing furniture crops become per-object review states, not a failed room.
        optional.update(crop["imagePath"] for crop in obj.get("crops", []))
    digest = hashlib.sha256()
    # Inventory/raw exports can change without changing any reconstructable data.
    identity = {"scan": scan_id, "scene": source, "cameras": cameras,
                "createdAt": manifest.get("createdAt"), "orientation": manifest.get("orientation")}
    digest.update(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode())
    paths = []
    total = 0
    for relative in sorted(required | optional):
        path = safe_path(bundle, relative)
        if not path.is_file():
            if relative in required:
                raise ValueError(f"扫描包缺少文件: {relative}")
            digest.update((relative + ":missing").encode())
            continue
        if relative not in ("manifest.json", "scene.json", "cameras.json") and path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".f32", ".u8"):
            raise ValueError("扫描资源必须为图片或原生深度文件")
        total += path.stat().st_size
        if total > MAX_BUNDLE_BYTES:
            raise ValueError("所需扫描数据不能超过 300 MB")
        paths.append(relative)
        if relative not in ("manifest.json", "scene.json", "cameras.json"):
            digest.update(relative.encode())
            with path.open("rb") as file:
                while chunk := file.read(1024 * 1024):
                    digest.update(chunk)
    return scan_id, digest.hexdigest(), paths
