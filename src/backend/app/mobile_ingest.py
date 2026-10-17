"""Publish a validated mobile ZIP to the room library and queue editor ingestion."""
import shutil
import stat
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from .mobile_config import mobile_library
from .scan_import import bundle_inventory, find_bundle
from .scans import adapt_scan, read_json, safe_path, write_json

MAX_SCAN_BYTES = 2 * 1024**3


def extract_bundle(archive_path: Path, destination: Path) -> Path:
    names = set()
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(info.file_size for info in entries) > MAX_SCAN_BYTES:
            raise ValueError("扫描包文件过多或解压后超过 2 GiB")
        for info in entries:
            name = info.filename.replace("\\", "/")
            parts = PurePosixPath(name).parts
            if not parts or name.startswith("/") or any(part in ("..", ".") or ":" in part for part in parts) or "\x00" in name or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError("扫描包包含不安全路径")
            if name.rstrip("/").casefold() in names:
                raise ValueError("扫描包包含重复路径")
            names.add(name.rstrip("/").casefold())
            target = safe_path(destination, name)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, target.open("xb") as output:
                    copied = 0
                    while chunk := source.read(1024 * 1024):
                        copied += len(chunk)
                        if copied > info.file_size:
                            raise ValueError("ZIP 条目长度不一致")
                        output.write(chunk)
    bundle = find_bundle(destination)
    metadata = read_json(bundle / "manifest.json")
    for relative in metadata.get("files", []):
        if not safe_path(bundle, relative).is_file():
            raise ValueError("扫描文件清单不完整")
    return bundle


def publish_zip(archive: Path, root: Path, transfer_id: str, expected_scan_id: str) -> None:
    staging = root / "tmp/mobile-staging" / uuid.uuid4().hex
    try:
        staging.mkdir(parents=True)
        bundle = extract_bundle(archive, staging)
        scan_id, fingerprint, _ = bundle_inventory(bundle, max_bytes=MAX_SCAN_BYTES)
        if scan_id != str(uuid.UUID(expected_scan_id)):
            raise ValueError("上传会话与扫描包 scanId 不一致")
        adapt_scan(bundle, "mobile-validation")
        library = mobile_library(root)
        library.mkdir(parents=True, exist_ok=True)
        # Reuse any matching source folder, not just our preferred mobile name.
        destination = library / f"RoomCanvas-{scan_id.upper()}"
        for path in library.rglob("manifest.json"):
            try:
                existing_id = str(read_json(path).get("id", "")).lower()
            except (OSError, ValueError, TypeError):
                continue
            if existing_id == scan_id:
                _, existing, _ = bundle_inventory(path.parent, max_bytes=MAX_SCAN_BYTES)
                if existing != fingerprint:
                    raise ValueError("同一 scanId 的采集内容不同，不能覆盖现有模型")
                destination = path.parent
                break
        else:
            if destination.exists():
                raise ValueError("接收目录已存在但不是完整的同一采集包")
            shutil.move(str(bundle), destination)
        write_json(root / "tmp/mobile-inbox" / f"{transfer_id}.json", {
            "status": "pending", "folder": destination.relative_to(library).as_posix(), "scanId": scan_id,
            "fingerprint": fingerprint, "sceneId": None,
        })
    finally:
        shutil.rmtree(staging, ignore_errors=True)
