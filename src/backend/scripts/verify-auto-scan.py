"""Exercise real folder/ZIP orchestration and RGB-D masks with a fake paid boundary."""
import asyncio
from copy import deepcopy
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import sys
import uuid
import zipfile

import httpx
import numpy as np
from PIL import Image
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scan_import import bundle_inventory
from app.scan_routes import register_scan_routes
from app.scans import read_json, write_json


def fixture(folder: Path, rotated: bool):
    folder.mkdir(parents=True)
    identity = np.eye(4)
    world = identity.copy()
    if rotated:
        world[:3, :3] = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]
        world[:3, 3] = [2.3, 0.4, -3.1]

    def pose(position, rotation=None):
        value = identity.copy()
        value[:3, 3] = position
        if rotation is not None:
            value[:3, :3] = rotation
        return (world @ value).flatten(order="F").tolist()

    scan_id = str(uuid.uuid4()).upper()
    objects = []
    colors = np.full((240, 320, 3), 230, dtype=np.uint8)
    depth = np.full((120, 160), 5, dtype="<f4")
    # A red target and a blue neighbour are both present in the input crop.
    for column in range(160):
        for row in range(120):
            x, y = ((column + 0.5) * 2 - 160) / 140 * 1.8, -((row + 0.5) * 2 - 120) / 140 * 1.8
            if abs(x) < 0.6 and abs(y) < 0.7:
                depth[row, column] = 1.8
                colors[row * 2:row * 2 + 2, column * 2:column * 2 + 2] = [205, 45, 35]
            elif abs(x - 1.9) < 0.35 and abs(y) < 0.7:
                depth[row, column] = 1.8
                colors[row * 2:row * 2 + 2, column * 2:column * 2 + 2] = [30, 60, 215]
    (folder / "frames").mkdir()
    (folder / "depth").mkdir()
    (folder / "objects").mkdir()
    Image.fromarray(colors).save(folder / "frames/view.jpg")
    Image.fromarray(colors[56:184, 105:300]).save(folder / "objects/target.png")
    depth.tofile(folder / "depth/view.f32")
    obj_id = str(uuid.uuid4())
    objects.append({"id": obj_id, "category": "chair", "dimensions": [1.2, 1.4, 0.6], "objectToWorld": pose([0, 0, -2.1]),
                    "crops": [{"frameId": "view", "imagePath": "objects/target.png", "rectanglePixels": [105, 56, 195, 128], "visibleFraction": 1, "score": 1}]})
    objects.append({"id": str(uuid.uuid4()), "category": "chair", "dimensions": [0.7, 1.4, 0.6], "objectToWorld": pose([1.9, 0, -2.1]), "crops": []})
    floor_rotation = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
    surfaces = [{"id": str(uuid.uuid4()), "kind": "floor", "dimensions": [6, 6, 0], "surfaceToWorld": pose([0, -1, -2], floor_rotation), "polygonCorners": [[-3, -3, 0], [3, -3, 0], [3, 3, 0], [-3, 3, 0]]}]
    for x, height in ((-3, 2.7), (3, 3.2)):
        surfaces.append({"id": str(uuid.uuid4()), "kind": "wall", "dimensions": [3, height, 0], "surfaceToWorld": pose([x, height / 2 - 1, -4])})
    orientation = {"reference": "true-north", "northInWorld": (world[:3, :3] @ [0, 0, -1]).tolist(), "sampleCount": 12,
                   "accuracyDegrees": 5, "coherence": 0.99, "location": {"latitude": 30, "longitude": 120}, "utcOffsetMinutes": 480}
    source = {"schemaVersion": "roomcanvas.scene.v1", "scanId": scan_id, "units": "meters", "matrixLayout": "column-major", "coordinateSystem": "ARKit right-handed, Y-up", "surfaces": surfaces, "objects": objects, "orientation": orientation}
    camera = {"id": "view", "imagePath": "frames/view.jpg", "imageWidth": 320, "imageHeight": 240, "nativeImageWidth": 320, "nativeImageHeight": 240,
              "cameraToWorld": world.flatten(order="F").tolist(), "intrinsics": [140, 0, 0, 0, 140, 0, 160, 120, 1], "nativePixelToSavedPixel": np.eye(3).flatten(order="F").tolist(),
              "trackingState": "normal", "sharpness": 1, "depth": {"width": 160, "height": 120, "depthPath": "depth/view.f32", "format": "float32-little-endian, tightly packed rows, meters", "alignment": "native camera image orientation; scale intrinsics to depth resolution"}}
    write_json(folder / "manifest.json", {"schemaVersion": "roomcanvas.scan.v1", "id": scan_id, "status": "complete", "createdAt": "2026-10-17T04:00:00Z"})
    write_json(folder / "scene.json", source)
    write_json(folder / "cameras.json", [camera])
    return obj_id


async def verify():
    (ROOT / "tmp").mkdir(exist_ok=True)
    with TemporaryDirectory(dir=ROOT / "tmp", prefix="auto-scan-") as directory:
        root = Path(directory)
        jobs, submissions = {}, []

        def start(asset, name, path, content_type, width, depth, height, prompt, *, idempotency_key):
            if idempotency_key in jobs:
                return jobs[idempotency_key]
            image = np.asarray(Image.open(path).convert("RGBA"))
            opaque = image[..., 3] > 127
            assert opaque.sum() > 100
            assert not np.any((image[..., 2] > image[..., 0] + 30) & opaque), "Neighbour colour leaked into generated image"
            assert content_type == "image/png"
            np.testing.assert_allclose([width, depth, height], [1200, 600, 1400])
            job = SimpleNamespace(job_id=idempotency_key, status="succeeded", stage_message="complete", error=None,
                                  model_url="/api/assets/textured.glb", edit_model_url="/api/assets/textured-edit.glb")
            jobs[idempotency_key] = job
            submissions.append(idempotency_key)
            return job

        app = FastAPI()
        register_scan_routes(app, root, start, jobs.get)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://tests", timeout=60) as client:
            async def wait(scene_id):
                for _ in range(300):
                    scene = (await client.get(f"/api/scenes/{scene_id}")).raise_for_status().json()
                    if scene["pipeline"]["preparation"] in ("complete", "failed"):
                        return scene
                    await asyncio.sleep(0.02)
                raise AssertionError("Automatic pipeline did not finish")

            for index in range(2):
                folder = root / f"unseen-layout-{index}"
                target = fixture(folder, bool(index))
                _, _, resources = bundle_inventory(folder)
                uploads = [("files", ("any-folder/" + relative, (folder / relative).read_bytes())) for relative in resources]
                response = await client.post("/api/scans", files=uploads)
                response.raise_for_status()
                scene = await wait(response.json()["id"])
                assert scene["pipeline"]["completed"] == 1 and scene["pipeline"]["needsReview"] == 1
                assert scene["pipeline"]["status"] == "needs_attention"
                item = next(item for item in scene["furniture"] if item["id"] == target)
                assert item["generationStatus"] == "succeeded" and item["modelUrl"] and item["editModelUrl"]
                np.testing.assert_allclose(item["position"], [0, 1, -0.1] if not index else [-0.1, 1, 0], atol=1e-6)
                ceiling = next(surface for surface in scene["room"]["surfaces"] if surface["kind"] == "ceiling")
                np.testing.assert_allclose(ceiling["position"][1], 2.7)
                assert scene["source"]["orientation"]["northAngleDegrees"] == (270 if index else 0)
                # A ZIP with a renamed outer folder has the same identity.
                archive = io.BytesIO()
                with zipfile.ZipFile(archive, "w") as output:
                    for relative in resources:
                        output.write(folder / relative, "renamed/" + relative)
                repeated = await client.post("/api/scans", files={"files": ("renamed.zip", archive.getvalue())})
                repeated.raise_for_status()
                assert repeated.json()["id"] == scene["id"]
                await wait(scene["id"])
                assert len(submissions) == index + 1, "Reimport created duplicate paid work"
                concurrent = await asyncio.gather(client.post("/api/scans", files=uploads), client.post("/api/scans", files=uploads))
                assert all(response.status_code == 201 and response.json()["id"] == scene["id"] for response in concurrent)
                await wait(scene["id"])
                assert len(submissions) == index + 1, "Concurrent imports duplicated paid work"
                job = jobs[item["jobId"]]
                job.status, job.error = "failed", "simulated provider failure"
                await client.post("/api/scans", files=uploads)
                failed = await wait(scene["id"])
                assert failed["pipeline"]["failed"] == 1 and failed["pipeline"]["needsReview"] == 1
                assert len(submissions) == index + 1, "Failed provider task was automatically charged again"
                job.status, job.error = "succeeded", None
                # Simulate crash after persisting the generation job but before
                # linking its ID to the furniture manifest, then restart pipeline.
                scene_path = root / "tmp/scans" / scene["id"] / "scene-manifest.json"
                stored = read_json(scene_path)
                stored_item = next(item for item in stored["furniture"] if item["id"] == target)
                stored_item.pop("jobId")
                stored_item["generationStatus"] = "preparing"
                stored["pipeline"]["preparation"] = "running"
                write_json(scene_path, stored)
                for callback in app.router.on_startup:
                    await callback()
                restored = await wait(scene["id"])
                assert len(submissions) == index + 1 and next(item for item in restored["furniture"] if item["id"] == target)["jobId"]
                changed = deepcopy(read_json(folder / "scene.json"))
                changed["objects"][0]["dimensions"][0] += 0.1
                modified = [(key, (path, json.dumps(changed).encode() if path.endswith("scene.json") else data)) for key, (path, data) in uploads]
                conflict = await client.post("/api/scans", files=modified)
                assert conflict.status_code == 409, "Changed data silently reused paid models"
                print(f"PASS: unseen layout {index}, folder->automatic RGB-D selection->generation->scale arguments->pose/north/ceiling; ZIP dedup, interrupted pipeline reuse, changed-content rejection")
            bad = io.BytesIO()
            with zipfile.ZipFile(bad, "w") as output:
                output.writestr("../outside.json", "{}")
            rejected = await client.post("/api/scans", files={"files": ("bad.zip", bad.getvalue())})
            assert rejected.status_code == 422
            empty = await client.post("/api/scans", files={"files": ("note.txt", b"not a scan")})
            assert empty.status_code == 422
            print("PASS: unknown/missing bundles and traversal rejected; zero real Rodin calls")
        from app import main as generation
        with patch.object(generation, "JOB_ROOT", root / "generation-jobs"), patch.object(generation, "jobs", {}), patch.object(generation, "schedule") as scheduled:
            (root / "generation-jobs").mkdir()
            first = generation.start_generation("asset", "test", Path("image.png"), "image/png", 1000, 500, 800, idempotency_key="scene:object:0")
            generation.jobs.clear()  # Simulate process-local cache loss.
            second = generation.start_generation("asset", "test", Path("image.png"), "image/png", 1000, 500, 800, idempotency_key="scene:object:0")
            assert first.job_id == second.job_id and scheduled.call_count == 1
        print("PASS: production generation entry persists/reuses a stable job ID without duplicate scheduling")


asyncio.run(verify())
