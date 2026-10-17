"""Mobile protocol -> validated library publication -> automatic editor pipeline."""
import asyncio
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import zipfile

from fastapi import FastAPI
import httpx

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scan_routes import register_scan_routes
from app.upload_gateway import CHUNK_BYTES, UploadStore, create_app
from app.mobile_ingest import extract_bundle
from app.scans import read_json

spec = importlib.util.spec_from_file_location("fixture", Path(__file__).with_name("verify-auto-scan.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


async def verify():
    with TemporaryDirectory(dir=ROOT / "tmp", prefix="mobile-verify-") as temporary:
        root = Path(temporary)
        source = root / "phone-output"
        fixtures.fixture(source, True)
        (source / "room.usdz").write_bytes(b"retained-native-export" + b"\0" * CHUNK_BYTES)
        scan_id = read_json(source / "manifest.json")["id"]
        def zipped(prefix):
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w", zipfile.ZIP_STORED) as archive:
                for file in source.rglob("*"):
                    if file.is_file():
                        archive.write(file, prefix + file.relative_to(source).as_posix())
            return data.getvalue()
        raw = zipped("phone/")
        token = "test-upload-token-" + "a" * 32
        gateway = create_app(root, token)
        editor = FastAPI()
        jobs, calls = {}, []
        def generate(*args, idempotency_key):
            if idempotency_key not in jobs:
                calls.append(idempotency_key)
                jobs[idempotency_key] = SimpleNamespace(job_id=idempotency_key, status="succeeded", error=None, stage_message="test",
                                                        model_url="/api/assets/test.glb", edit_model_url="/api/assets/test-edit.glb")
            return jobs[idempotency_key]
        register_scan_routes(editor, root, generate, jobs.get)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=gateway), base_url="http://mobile", headers={"Authorization": "Bearer " + token}) as mobile, \
                   httpx.AsyncClient(transport=httpx.ASGITransport(app=editor), base_url="http://editor") as web:
            unauthenticated = await mobile.get("/api/mobile/health", headers={"Authorization": "wrong"})
            assert unauthenticated.status_code == 401
            assert (await mobile.get("/api/scenes/latest")).status_code == 404
            assert (await mobile.get("/api/generations")).status_code == 404
            async def create(raw):
                response = await mobile.post("/api/mobile/uploads", json={"scanId": scan_id, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
                response.raise_for_status()
                return response.json()
            async def append(state, data, offset):
                return await mobile.put(f"/api/mobile/uploads/{state['id']}", content=data,
                                        headers={"Upload-Offset": str(offset), "X-Chunk-SHA256": hashlib.sha256(data).hexdigest()})
            state = await create(raw)
            assert (await mobile.post(f"/api/mobile/uploads/{state['id']}/complete")).status_code == 409
            first = raw[:CHUNK_BYTES]
            assert (await append(state, first, 0)).status_code == 200
            assert (await append(state, first, 0)).status_code == 409
            with (gateway.state.store.directory(state["id"]) / "scan.zip.part").open("ab") as file:
                file.write(b"unacknowledged tail")
            assert UploadStore(root).load(state["id"])["offset"] == CHUNK_BYTES
            resumed = await create(raw)
            assert resumed["offset"] == CHUNK_BYTES
            for offset in range(CHUNK_BYTES, len(raw), CHUNK_BYTES):
                assert (await append(state, raw[offset:offset + CHUNK_BYTES], offset)).status_code == 200
            response = await mobile.post(f"/api/mobile/uploads/{state['id']}/complete")
            assert response.status_code == 202
            await editor.state.consume_mobile_uploads()
            final = (await mobile.get(f"/api/mobile/uploads/{state['id']}")).json()
            assert final["status"] == "complete" and final["sceneId"]
            assert read_json(gateway.state.store.directory(state["id"]) / "state.json")["status"] == "complete", "Completed transfer retained an active quota reservation"
            for _ in range(200):
                scene = (await web.get(f"/api/scenes/{final['sceneId']}")).raise_for_status().json()
                if scene["pipeline"]["preparation"] == "complete":
                    break
                await asyncio.sleep(0.03)
            assert scene["pipeline"]["completed"] == 2 and len(calls) == 2
            assert scene["source"]["orientation"]["northAngleDegrees"] == 270
            rooms = (await web.get("/api/room-library")).json()["rooms"]
            assert len(rooms) == 1 and rooms[0]["scanId"].lower() == scan_id.lower()
            image = await web.get(scene["furniture"][0]["cropUrl"])
            assert image.status_code == 200 and image.content[:8] == b"\x89PNG\r\n\x1a\n"
            stored = next((root / "reference/ToCodex/room").rglob("room.usdz"))
            assert stored.read_bytes() == (source / "room.usdz").read_bytes()
            assert (await create(raw))["status"] == "complete"
            await mobile.post(f"/api/mobile/uploads/{state['id']}/complete")
            await editor.state.consume_mobile_uploads()
            assert len(calls) == 2
            # A different ZIP envelope must also reuse the same scan/model jobs.
            other_raw = zipped("renamed/")
            other = await create(other_raw)
            for offset in range(0, len(other_raw), CHUNK_BYTES):
                assert (await append(other, other_raw[offset:offset + CHUNK_BYTES], offset)).status_code == 200
            await mobile.post(f"/api/mobile/uploads/{other['id']}/complete")
            await editor.state.consume_mobile_uploads()
            repeated = (await mobile.get(f"/api/mobile/uploads/{other['id']}")).json()
            assert repeated["sceneId"] == final["sceneId"] and len(calls) == 2
            bad = root / "bad.zip"
            with zipfile.ZipFile(bad, "w") as archive:
                archive.writestr("../escape.txt", "bad")
            try:
                extract_bundle(bad, root / "unsafe")
                raise AssertionError("Archive traversal accepted")
            except ValueError:
                pass
            await asyncio.sleep(0.2)
        print("PASS: token auth/upload-only isolation; chunk hashes/offset/lost-ack resume; whole ZIP validation; phone->room library->automatic model pipeline; source exports/depth/north retained; repeat/renamed ZIP reuses jobs; zero real Rodin calls")


asyncio.run(verify())
