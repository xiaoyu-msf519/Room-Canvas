"""Check lowest original-wall alignment and cached-scene migration without new jobs."""
import asyncio
from copy import deepcopy
from pathlib import Path
import sys
import uuid

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.main import app
from app.scans import adapt_scan, matrix, read_json


def without_ceiling_height(scene):
    result = deepcopy(scene)
    ceiling = next(surface for surface in result["room"]["surfaces"] if surface.get("id") == "room-ceiling")
    ceiling["position"][1] = 0
    ceiling.pop("heightAlignment", None)
    return result


async def verify():
    # ASGITransport does not run startup, so no generation jobs are resumed.
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://verification") as client:
        for name in ("ScanDemoResult", "ScanDemoWithDirectionResult", "ScanDemoWallResult"):
            bundle = ROOT / "reference/ToCodex" / name
            source = read_json(bundle / "scene.json")
            scene_id = uuid.uuid5(uuid.NAMESPACE_URL, str(bundle.resolve())).hex
            adapted = adapt_scan(bundle, scene_id)
            offset = adapted["source"]["worldOffset"][1]
            tops = [matrix(surface["surfaceToWorld"])[1, 3] + matrix(surface["surfaceToWorld"])[1, 1] * surface["dimensions"][1] / 2 + offset
                    for surface in source["surfaces"] if surface["kind"] == "wall"]
            ceiling = next(surface for surface in adapted["room"]["surfaces"] if surface["kind"] == "ceiling")
            np.testing.assert_allclose(ceiling["position"][1], min(tops), atol=1e-7)
            assert ceiling["heightAlignment"] == "lowest-wall-top"
            cached_path = ROOT / "tmp/scans" / scene_id / "scene-manifest.json"
            if cached_path.is_file():
                before = read_json(cached_path)
                if any(surface.get("id") == "room-ceiling" for surface in before["room"]["surfaces"]):
                    response = await client.get(f"/api/scenes/{scene_id}")
                    response.raise_for_status()
                    after = read_json(cached_path)
                    assert without_ceiling_height(before) == without_ceiling_height(after), "Migration altered unrelated geometry or model jobs"
                    migrated = next(surface for surface in after["room"]["surfaces"] if surface["kind"] == "ceiling")
                    np.testing.assert_allclose(migrated["position"][1], min(tops), atol=1e-7)
                    assert migrated["heightAlignment"] == "lowest-wall-top"
            print(f"PASS: {name}, ceiling={min(tops):.4f}m; lowest original wall; existing ceilings migrate without changing geometry/model jobs")


asyncio.run(verify())
