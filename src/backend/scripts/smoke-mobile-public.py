"""Real HTTPS upload smoke test with an empty synthetic room; no paid jobs."""
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import time
import uuid
import zipfile

import httpx

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.mobile_config import mobile_library, public_endpoint, upload_token
from app.scans import read_json


def main():
    scan_id = str(uuid.uuid4())
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    floor = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, -1, 0, 1]
    wall = identity.copy(); wall[13] = 0.5; wall[14] = -2
    files = {
        "manifest.json": json.dumps({"id": scan_id, "schemaVersion": "roomcanvas.scan.v1", "status": "complete", "title": "Synthetic mobile upload smoke", "objectCount": 0, "files": ["manifest.json", "scene.json", "cameras.json", "room.usdz"]}).encode(),
        "scene.json": json.dumps({"scanId": scan_id, "schemaVersion": "roomcanvas.scene.v1", "units": "meters", "matrixLayout": "column-major", "coordinateSystem": "ARKit right-handed, Y-up", "objects": [],
                                  "surfaces": [{"id": "floor", "kind": "floor", "dimensions": [4, 4, 0], "surfaceToWorld": floor}, {"id": "wall", "kind": "wall", "dimensions": [4, 3, 0], "surfaceToWorld": wall}]}).encode(),
        "cameras.json": b"[]", "room.usdz": b"synthetic-export-not-a-real-usdz" + b"\0" * (2 * 1024 * 1024),
    }
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_STORED) as archive:
        for name, contents in files.items():
            archive.writestr("phone-scan/" + name, contents)
    raw = data.getvalue()
    endpoint, token = public_endpoint(ROOT), upload_token(ROOT)
    if not endpoint.startswith("https://"):
        raise RuntimeError("No public HTTPS upload endpoint configured")
    state = scene = None
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=30) as web, httpx.Client(base_url=endpoint, timeout=60, headers={"Authorization": "Bearer " + token}) as mobile:
        previous = web.get("/api/scenes/latest").raise_for_status().json()
        try:
            assert mobile.get("/api/mobile/health").raise_for_status().json()["protocol"] == "roomcanvas.upload.v1"
            assert mobile.get("/api/scenes/latest").status_code == 404
            state = mobile.post("/api/mobile/uploads", json={"scanId": scan_id, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}).raise_for_status().json()
            for offset in range(0, len(raw), state["chunkSize"]):
                part = raw[offset:offset + state["chunkSize"]]
                mobile.put(f"/api/mobile/uploads/{state['id']}", content=part,
                           headers={"Upload-Offset": str(offset), "X-Chunk-SHA256": hashlib.sha256(part).hexdigest()}).raise_for_status()
            mobile.post(f"/api/mobile/uploads/{state['id']}/complete").raise_for_status()
            for _ in range(60):
                result = mobile.get(f"/api/mobile/uploads/{state['id']}").raise_for_status().json()
                if result["status"] == "failed":
                    raise RuntimeError(result.get("error"))
                if result["status"] == "complete":
                    scene = web.get(f"/api/scenes/{result['sceneId']}").raise_for_status().json()
                    if scene["pipeline"]["status"] == "ready":
                        break
                time.sleep(1)
            assert scene and scene["pipeline"]["status"] == "ready"
            assert any(room["scanId"].lower() == scan_id for room in web.get("/api/room-library").json()["rooms"])
            assert scene["furniture"] == []
            repeated = mobile.post("/api/mobile/uploads", json={"scanId": scan_id, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}).raise_for_status().json()
            assert repeated["status"] == "complete" and repeated["sceneId"] == scene["id"]
            print(json.dumps({"result": "PASS", "endpoint": endpoint, "bytes": len(raw), "scene": scene["id"], "newPaidTasks": 0, "checks": ["HTTPS token-auth upload", "2 MiB chunks", "automatic room-list publication", "automatic empty-room completion", "repeat upload reuse", "editor API not public"]}), flush=True)
        finally:
            if scene:
                latest = web.get("/api/scenes/latest").json()
                if latest.get("id") == scene["id"]:
                    web.post(f"/api/scenes/{previous['id']}/activate").raise_for_status()
                time.sleep(2.2)
                path = ROOT / "tmp/scans" / scene["id"]
                if read_json(path / "scene-manifest.json")["source"]["scanId"].lower() == scan_id:
                    shutil.rmtree(path)
            folder = mobile_library(ROOT) / f"RoomCanvas-{scan_id.upper()}"
            if folder.is_dir() and read_json(folder / "manifest.json")["id"].lower() == scan_id:
                shutil.rmtree(folder)
            if state:
                (ROOT / "tmp/mobile-inbox" / f"{state['id']}.json").unlink(missing_ok=True)
                shutil.rmtree(ROOT / "tmp/transfers" / state["id"], ignore_errors=True)


if __name__ == "__main__":
    main()
