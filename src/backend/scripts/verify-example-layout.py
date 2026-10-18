"""Deterministic structural example, persistence and no generation boundary calls."""
import asyncio
from collections import Counter
from itertools import combinations
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


def box_bounds(surface):
    width, height, depth = surface["size"]
    if abs(surface["rotation"][1]) > 0.5:
        width, depth = depth, width
    return [(surface["position"][axis] - size / 2, surface["position"][axis] + size / 2) for axis, size in enumerate((width, height, depth))]


def verify_structure(scene):
    room, layout = scene["room"], scene["room"]["layout"]
    zones, windows, doors = layout["zones"], layout["windows"], layout["doorways"]
    assert Counter(zone["kind"] for zone in zones) == {"bedroom": 3, "living": 1, "bathroom": 2, "kitchen": 1, "foyer": 1, "balcony": 2}
    for a, b in combinations(zones, 2):
        assert min(a["rect"][2], b["rect"][2]) - max(a["rect"][0], b["rect"][0]) <= 1e-7 or min(a["rect"][3], b["rect"][3]) - max(a["rect"][1], b["rect"][1]) <= 1e-7, "Room floor polygons overlap"
    outline = layout["boundary"]
    area = abs(sum(point[0] * outline[(index + 1) % len(outline)][2] - outline[(index + 1) % len(outline)][0] * point[2] for index, point in enumerate(outline))) / 2
    assert len(outline) >= 8 and abs(area - sum(zone["area"] for zone in zones)) < 1e-6
    bounding_area = (max(p[0] for p in outline) - min(p[0] for p in outline)) * (max(p[2] for p in outline) - min(p[2] for p in outline))
    assert area < bounding_area * 0.9, "Footprint is still rectangular"
    turns = []
    for index, point in enumerate(outline):
        before, after = outline[index - 1], outline[(index + 1) % len(outline)]
        turns.append((point[0] - before[0]) * (after[2] - point[2]) - (point[2] - before[2]) * (after[0] - point[0]))
    assert min(turns) < 0 < max(turns), "Footprint needs real concave corners"
    walls = [surface for surface in room["surfaces"] if surface["kind"] == "wall"]
    wall_bounds = [(wall["id"], box_bounds(wall)) for wall in walls]
    for (a_id, a), (b_id, b) in combinations(wall_bounds, 2):
        overlaps = [min(a[axis][1], b[axis][1]) - max(a[axis][0], b[axis][0]) for axis in range(3)]
        assert not all(overlap > 1e-7 for overlap in overlaps), f"Wall solids overlap: {a_id}, {b_id}"
    surfaces = {surface["id"]: surface for surface in room["surfaces"]}
    faces = {face["id"]: face for wall in walls for face in wall["wallFaces"].values()}
    assert len(faces) == len(walls) * 2
    referenced = set()
    for zone in zones:
        assert surfaces[zone["floorSurfaceId"]]["zoneId"] == zone["id"]
        assert surfaces[zone["ceilingSurfaceId"]]["zoneId"] == zone["id"]
        assert zone["wallSurfaceIds"] and len(zone["wallGroupIds"]) == len(set(zone["wallGroupIds"]))
        assert set(zone["wallGroupIds"]) == {faces[face_id]["editGroupId"] for face_id in zone["wallSurfaceIds"]}
        assert all(faces[face_id]["zoneId"] == zone["id"] for face_id in zone["wallSurfaceIds"])
        assert not referenced.intersection(zone["wallSurfaceIds"]), "Rooms share an editable wall-surface ID"
        referenced.update(zone["wallSurfaceIds"])
        if zone["kind"] in ("bedroom", "kitchen"):
            assert any(window["zoneId"] == zone["id"] for window in windows), "Bedroom/kitchen has no exterior window"
    foyer = next(zone for zone in zones if zone["kind"] == "foyer")
    assert foyer["rect"][0] == 0 and foyer["rect"][3] == 6
    assert not any(window["zoneId"] == foyer["id"] for window in windows)
    assert any(set(door["connects"]) == {"outside", "foyer"} for door in doors)
    assert any(set(door["connects"]) == {"foyer", "living"} for door in doors)
    balconies = [zone for zone in zones if zone["kind"] == "balcony"]
    for balcony in balconies:
        glass = [window for window in windows if window["zoneId"] == balcony["id"]]
        assert len(glass) == 3 and all(window["enclosure"] and window["size"][1] > 2.5 for window in glass)
        glass_sides = set()
        for window in glass:
            x, _, z = window["position"]
            for side, position, boundary in (("west", x, balcony["rect"][0]), ("east", x, balcony["rect"][2]), ("north", z, balcony["rect"][1]), ("south", z, balcony["rect"][3])):
                if abs(position - boundary) < 1e-7:
                    glass_sides.add(side)
        assert len(glass_sides) == 3
    assert any(set(door["connects"]) == {"living", "balcony-north"} for door in doors)
    assert any(set(door["connects"]) == {"bedroom-3", "balcony-south"} for door in doors)
    # Check enclosure at the sill, eye and wall-top levels, excluding declared
    # openings. This catches gaps introduced by junction trimming.
    opening_bounds = [box_bounds(opening) for opening in doors + windows]
    def contains(bounds, point):
        return all(bounds[axis][0] - 1e-7 <= point[axis] <= bounds[axis][1] + 1e-7 for axis in range(3))
    for zone in zones:
        x0, z0, x1, z1 = zone["rect"]
        for axis, fixed, start, end in ((0, z0, x0, x1), (0, z1, x0, x1), (2, x0, z0, z1), (2, x1, z0, z1)):
            steps = round((end - start) * 10)
            for step in range(steps + 1):
                value = start + (end - start) * step / steps
                for height in (0.04, 1.5, 2.75):
                    point = [value, height, fixed] if axis == 0 else [fixed, height, value]
                    if any(contains(bounds, point) for bounds in opening_bounds):
                        continue
                    assert any(contains(bounds, point) for _, bounds in wall_bounds), f"Unsealed wall boundary in {zone['id']} at {point}"
    assert scene["furniture"] == [] and scene["cameras"] == []
    print(f"PASS: {len(outline)}-corner concave outline, {area:.2f}m2, {len(walls)} non-overlapping wall solids, {len(zones)} independent surfaces, kitchen/bedroom windows, two glazed balconies and a windowless foyer.")


async def verify():
    assert create_example_layout("fixture") == create_example_layout("fixture")
    verify_structure(create_example_layout("fixture"))
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
            floors = [surface for surface in scene["room"]["surfaces"] if surface["kind"] == "floor"]
            assert len({surface["editGroupId"] for surface in floors}) == len(scene["room"]["layout"]["zones"])
            partitions = [surface for surface in scene["room"]["surfaces"] if surface.get("wallFaces") and surface["wallFaces"]["positive"]["zoneId"] != surface["wallFaces"]["negative"]["zoneId"]]
            assert partitions and all(surface["wallFaces"]["positive"]["editGroupId"] != surface["wallFaces"]["negative"]["editGroupId"] for surface in partitions)
            windows = scene["room"]["layout"]["windows"]
            assert len(windows) == 14
            assert {window["zoneId"] for window in windows} == {"living", "master", "bedroom-2", "bedroom-3", "bath-ensuite", "bath-shared", "kitchen", "balcony-north", "balcony-south"}
            high = next(window for window in windows if window["zoneId"] == "bath-ensuite")
            assert high["privacy"] and abs(high["position"][1] - high["size"][1] / 2 - 1.8) < 1e-8
            assert scene["room"] == create_example_layout(scene["id"])["room"]
            assert all("finish" not in surface and "modelUrl" not in surface for surface in scene["room"]["surfaces"])
            assert len({surface["id"] for surface in scene["room"]["surfaces"]}) == len(scene["room"]["surfaces"])
            assert (await client.get("/api/scenes/latest")).json()["id"] == scene["id"]
            rooms = (await client.get("/api/room-library")).json()["rooms"]
            assert len(rooms) == 1 and rooms[0]["id"] == scene["id"] and rooms[0]["objectCount"] == 0
            again = (await client.post("/api/room-library/examples/three-bedroom")).json()
            assert again["id"] != scene["id"]
            geometry = lambda value: [(surface["kind"], surface["position"], surface["size"], surface["rotation"], surface.get("polygonCorners")) for surface in value["room"]["surfaces"]]
            assert geometry(again) == geometry(scene) and again["room"]["layout"]["boundary"] == scene["room"]["layout"]["boundary"]
            assert not {surface["id"] for surface in again["room"]["surfaces"]}.intersection(surface["id"] for surface in scene["room"]["surfaces"])
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
                assert len(migrated["room"]["layout"]["windows"]) == 14 and migrated["furniture"] == []
                assert (await client.post("/api/room-library/legacyexample/load")).json()["id"] == legacy["id"]
            await asyncio.sleep(0.02)
        finally:
            await restarted.router.shutdown()
    print("PASS: deterministic structural geometry, independent scene IDs, empty furniture/materials, room listing, restart/reload, and no generation/cache pipeline calls.")
    print("PASS: exterior bedroom/kitchen windows, two glazed balconies, private bathroom windows, and legacy upgrade without duplicate room IDs.")


asyncio.run(verify())
