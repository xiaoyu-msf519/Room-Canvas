"""Create a clean handoff archive; no tools, local scans, certificates, or build output."""
from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
destination = root / "dist/RoomCanvas-iOS-Source.zip"
destination.parent.mkdir(exist_ok=True)
excluded = {".tools", "dist", "__pycache__", ".pytest_cache", "DerivedData", "build", "xcuserdata", ".git"}
files = sorted(path for path in root.rglob("*") if path.is_file() and not any(part in excluded for part in path.relative_to(root).parts))
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, "RoomCanvas/" + file.relative_to(root).as_posix())
with zipfile.ZipFile(destination) as archive:
    bad = archive.testzip()
    if bad:
        raise RuntimeError(f"Archive CRC failure: {bad}")
print(f"Archive: {destination}")
print(f"Files: {len(files)}")
print(f"Bytes: {destination.stat().st_size}")
print(f"SHA256: {hashlib.sha256(destination.read_bytes()).hexdigest()}")
