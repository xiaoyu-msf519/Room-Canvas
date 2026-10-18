"""Deterministic structural example, persistence and no generation boundary calls."""
import asyncio
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import httpx
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.example_layout import create_example_layout
from app.scan_routes import register_scan_routes
from app.scans import write_json
from app.example_layout import TEMPLATE_ID


async def verify():
    assert create_example_layout("fixture") == create_example_layout("fixture")
    with TemporaryDirectory(dir=ROOT / "tmp", prefix="example-layout-") as directory:
        root = Path(directory)
        def forbidden(*args, **kwargs):
            raise AssertionError("A structural example must never invoke furniture generation")
        app = FastAPI()
        register_scan_routes(app, root, forbidden, forbidden)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://example") as client:
            first = await client.post("/api/room-library/examples/three-bedroom")
            assert first.status_code == 201
            scene = first.json()
            assert scene["furniture"] == [] and scene["cameras"] == []
            assert scene["pipeline"]["autoReconstruct"] is False
            windows = scene["room"]["layout"]["windows"]
            assert len(windows) == 7 and all("outer-" in window["wallId"] for window in windows)
            assert {window["zoneId"] for window in windows} == {"living", "master", "bedroom-2", "bedroom-3", "bath-ensuite"}
            high = next(window for window in windows if window["zoneId"] == "bath-ensuite")
            assert high["privacy"] and abs(high["position"][1] - high["size"][1] / 2 - 1.8) < 1e-8
            assert scene["room"] == create_example_layout(scene["id"])["room"]
            assert all("finish" not in surface and "modelUrl" not in surface for surface in scene["room"]["surfaces"])
            assert len({surface["id"] for surface in scene["room"]["surfaces"]}) == len(scene["room"]["surfaces"])
            assert (await client.get("/api/scenes/latest")).json()["id"] == scene["id"]
            rooms = (await client.get("/api/room-library")).json()["rooms"]
            assert len(rooms) == 1 and rooms[0]["id"] == scene["id"] and rooms[0]["objectCount"] == 0
            again = (await client.post("/api/room-library/examples/three-bedroom")).json()
            assert again["id"] != scene["id"] and again["room"] == scene["room"]
            assert (await client.post(f"/api/scenes/{scene['id']}/reconstruct")).status_code == 409
            assert (await client.get(f"/api/scenes/{scene['id']}/cache")).status_code == 409
        restarted = FastAPI()
        register_scan_routes(restarted, root, forbidden, forbidden)
        await restarted.router.startup()
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restarted), base_url="http://example") as client:
                rooms = (await client.get("/api/room-library")).json()["rooms"]
                assert len(rooms) == 2
                loaded = (await client.post(f"/api/room-library/{scene['id']}/load")).raise_for_status().json()
                assert loaded["furniture"] == [] and loaded["room"] == scene["room"]
                assert (await client.get("/api/scenes/latest")).json()["id"] == scene["id"]
                assert (await client.get(f"/api/scenes/{scene['id']}")).json()["pipeline"]["status"] == "ready"
                legacy = {"id": "legacyexample", "source": {"kind": "example-layout", "templateId": "three-bedroom-two-bath-v1"}, "room": {"surfaces": []}}
                write_json(root / "tmp/scans/legacyexample/scene-manifest.json", legacy)
                migrated = (await client.get("/api/scenes/legacyexample")).raise_for_status().json()
                assert migrated["id"] == legacy["id"] and migrated["source"]["templateId"] == TEMPLATE_ID
                assert len(migrated["room"]["layout"]["windows"]) == 7 and migrated["furniture"] == []
                assert (await client.post("/api/room-library/legacyexample/load")).json()["id"] == legacy["id"]
            await asyncio.sleep(0.02)
        finally:
            await restarted.router.shutdown()
    print("PASS: deterministic structural geometry, independent scene IDs, empty furniture/materials, room listing, restart/reload, and no generation/cache pipeline calls.")
    print("PASS: seven exterior windows, private ensuite high window, and legacy example upgrade without duplicate room IDs.")


asyncio.run(verify())
