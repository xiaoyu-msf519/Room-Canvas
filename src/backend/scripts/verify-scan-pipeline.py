"""Focused checks against the authorized real scan bundle and local API."""
import asyncio
import io
import json
from pathlib import Path
import sys
import zipfile

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scans import adapt_scan, matrix, safe_path

BUNDLE = ROOT / "reference/ToCodex/ScanDemoResult"


async def verify():
    scene = adapt_scan(BUNDLE, "verification")
    raw = json.loads((BUNDLE / "scene.json").read_text(encoding="utf-8"))
    assert len(scene["furniture"]) == 7 and len(scene["cameras"]) == 118
    assert len([surface for surface in scene["room"]["surfaces"] if surface["kind"] == "floor"]) == 1
    offset = np.asarray(scene["source"]["worldOffset"])
    for original, converted in zip(raw["objects"], scene["furniture"]):
        np.testing.assert_allclose(converted["position"], matrix(original["objectToWorld"])[:3, 3]+offset)
        np.testing.assert_allclose(converted["size"], original["dimensions"])
        assert abs(np.linalg.norm(converted["rotation"])-1) < 1e-6
        assert converted["cropUrl"].endswith(original["crops"][0]["imagePath"])
    for original, converted in zip(json.loads((BUNDLE / "cameras.json").read_text()), scene["cameras"]):
        np.testing.assert_allclose(matrix(converted["cameraToWorld"])[:3, 3], matrix(original["cameraToWorld"])[:3, 3]+offset)

    # Door centers must not lie in the reconstructed wall collider volume.
    from trimesh.transformations import quaternion_matrix
    for door in (surface for surface in raw["surfaces"] if surface["kind"] == "door"):
        center = matrix(door["surfaceToWorld"])[:3, 3] + offset
        for wall in scene["room"]["colliders"]:
            x, y, z, w = wall["rotation"]
            rotation = quaternion_matrix([w, x, y, z])[:3, :3]
            local = rotation.T @ (center - np.asarray(wall["position"]))
            assert not np.all(np.abs(local) < np.asarray(wall["size"])/2-1e-4), "Door blocked by wall"
    try:
        safe_path(BUNDLE, "../../API.md")
        raise AssertionError("Traversal accepted")
    except ValueError:
        pass

    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=120) as client:
        # Test the same API the iOS app and browser will use, including a nested ZIP root.
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for file in BUNDLE.rglob("*"):
                if file.is_file() and file.suffix in (".json", ".jpg"):
                    output.write(file, "ScanDemoResult/" + file.relative_to(BUNDLE).as_posix())
        response = await client.post("/api/scans", files={"files": ("scan.zip", archive.getvalue(), "application/zip")})
        response.raise_for_status()
        imported = response.json()
        assert len(imported["furniture"]) == 7
        crop = await client.get(imported["furniture"][0]["cropUrl"])
        assert crop.status_code == 200 and crop.content[:2] == b"\xff\xd8"
        frame = await client.get(imported["cameras"][0]["imageUrl"])
        assert frame.status_code == 200
        bad = io.BytesIO()
        with zipfile.ZipFile(bad, "w") as output:
            output.writestr("../escape.json", "{}")
        rejected = await client.post("/api/scans", files={"files": ("bad.zip", bad.getvalue(), "application/zip")})
        assert rejected.status_code == 422
        # Restore the real demo as the default. This reuses its existing jobs/models.
        response = await client.post("/api/scans/demo")
        response.raise_for_status()
        actual = response.json()
        jobs_before = [item.get("jobId") for item in actual["furniture"]]
        if all(jobs_before):
            repeated = await client.post(f"/api/scenes/{actual['id']}/reconstruct")
            repeated.raise_for_status()
            assert jobs_before == [item["jobId"] for item in repeated.json()["furniture"]], "Duplicate paid tasks created"
        print(f"PASS: real scan, 7 OBBs, 118 poses, door openings, ZIP upload, image routes, traversal rejection, task deduplication; scene={actual['id']}")


asyncio.run(verify())
