"""Prove scan-local model recovery after all runtime state is removed, without billing."""
import asyncio
import importlib.util
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace

import httpx
import numpy as np
from fastapi import FastAPI
from PIL import Image
import trimesh

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scan_routes import register_scan_routes
from app.scan_cache import CACHE_FOLDER, cache_resources
from app.scan_import import bundle_inventory
from app.scans import read_json, write_json

spec = importlib.util.spec_from_file_location("auto_fixture", Path(__file__).with_name("verify-auto-scan.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


async def verify():
    with TemporaryDirectory(dir=ROOT / "tmp", prefix="portable-cache-") as temporary:
        root = Path(temporary)
        folder = root / "reference/ToCodex/room/original-name"
        target_id = fixtures.fixture(folder, False)
        models = root / "tmp/models"
        models.mkdir(parents=True)
        mesh = trimesh.creation.box(extents=[1.2, 1.4, 0.6])
        mesh.visual = trimesh.visual.TextureVisuals(uv=np.zeros((len(mesh.vertices), 2)), image=Image.new("RGB", (8, 8), "red"))
        (models / "textured.glb").write_bytes(trimesh.Scene(mesh).export(file_type="glb"))
        jobs, calls = {}, []
        def generate(*args, idempotency_key):
            calls.append(idempotency_key)
            job = SimpleNamespace(job_id=idempotency_key, status="succeeded", stage_message="done", error=None,
                                  model_url="/api/assets/textured.glb", edit_model_url="/api/assets/textured.glb")
            jobs[job.job_id] = job
            return job

        def create_app():
            app = FastAPI()
            register_scan_routes(app, root, generate, jobs.get)
            return app

        async def load_room(client):
            catalog = (await client.get("/api/room-library")).raise_for_status().json()["rooms"]
            assert len(catalog) == 1
            response = await client.post(f"/api/room-library/{catalog[0]['id']}/load")
            response.raise_for_status()
            scene_id = response.json()["id"]
            for _ in range(400):
                scene = (await client.get(f"/api/scenes/{scene_id}")).raise_for_status().json()
                if scene["pipeline"]["preparation"] in ("complete", "failed"):
                    return scene
                await asyncio.sleep(0.02)
            raise AssertionError("Room did not finish")

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test") as client:
            scene = await load_room(client)
            cache_file = folder / CACHE_FOLDER / "cache.json"
            for _ in range(200):
                if cache_file.is_file() and any(item["status"] == "succeeded" for item in read_json(cache_file)["furniture"]):
                    break
                await asyncio.sleep(0.02)
            cache = read_json(cache_file)
            assert next(item for item in cache["furniture"] if item["id"] == target_id)["status"] == "succeeded"
            assert len(calls) == 1
            assert not any(secret in cache_file.read_text(encoding="utf-8") for secret in ("subscription_key", "task_uuid", "api_key", "Bearer"))
            exported = (await client.get(f"/api/scenes/{scene['id']}/cache")).raise_for_status()
            assert exported.content[:2] == b"PK"
            await asyncio.sleep(0.1)
        renamed = folder.with_name("renamed-folder")
        folder.rename(renamed)
        folder = renamed
        shutil.rmtree(root / "tmp")
        jobs.clear()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test") as client:
            restored = await load_room(client)
            item = next(item for item in restored["furniture"] if item["id"] == target_id)
            assert len(calls) == 1 and item["generationStatus"] == "succeeded" and restored["cache"]["restored"]
            assert (root / "tmp/models" / item["modelUrl"].rsplit("/", 1)[-1]).read_bytes()[:4] == b"glTF"
            _, _, original_files = bundle_inventory(folder)
            files = original_files + cache_resources(folder)
            uploads = [("files", ("moved/" + relative, (folder / relative).read_bytes())) for relative in files]
            response = await client.post("/api/scans", files=uploads)
            response.raise_for_status()
            assert response.json()["id"] == restored["id"] and len(calls) == 1
            await asyncio.sleep(0.2)
        # A missing runtime job and an incomplete portable task must not be
        # interpreted as permission to submit it a second time.
        shutil.rmtree(root / "tmp")
        cache = read_json(folder / CACHE_FOLDER / "cache.json")
        entry = next(item for item in cache["furniture"] if item["id"] == target_id)
        entry["status"] = "generating"
        write_json(folder / CACHE_FOLDER / "cache.json", cache)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test") as client:
            interrupted = await load_room(client)
            assert next(item for item in interrupted["furniture"] if item["id"] == target_id)["generationStatus"] == "failed"
            assert len(calls) == 1
            await asyncio.sleep(0.1)
        shutil.rmtree(root / "tmp")
        entry["status"] = "succeeded"
        write_json(folder / CACHE_FOLDER / "cache.json", cache)
        model = folder / CACHE_FOLDER / entry["model"]["file"]
        data = bytearray(model.read_bytes())
        data[-1] ^= 1
        model.write_bytes(data)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test") as client:
            corrupt = await load_room(client)
            assert next(item for item in corrupt["furniture"] if item["id"] == target_id)["generationStatus"] == "failed"
            assert len(calls) == 1
            await asyncio.sleep(0.1)
        print("PASS: room library, automatic scan-local cache, models after runtime deletion/folder rename, cache-bearing reupload, no keys, ZIP export; incomplete or corrupted caches cannot duplicate billing")


asyncio.run(verify())
