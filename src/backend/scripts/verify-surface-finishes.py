"""Core RGB-D paint checks; all generated fixtures/cache stay under tmp/."""
from copy import deepcopy
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scans import adapt_scan, write_json
from app.surface_materials import apply_finishes, estimate_finishes

identity = np.eye(4)
wall_pose = identity.copy()
wall_pose[2, 3] = -2
box_pose = identity.copy()
box_pose[2, 3] = -1
color = [92, 142, 177]
(ROOT / "tmp").mkdir(exist_ok=True)
with TemporaryDirectory(dir=ROOT / "tmp", prefix="verify-finishes-") as folder:
    bundle = Path(folder)
    source = {"surfaces": [{"id": "test-wall", "kind": "wall", "dimensions": [3, 3, 0], "surfaceToWorld": wall_pose.flatten(order="F").tolist()}],
              "objects": [{"dimensions": [0.5, 0.5, 0.2], "objectToWorld": box_pose.flatten(order="F").tolist()}]}
    write_json(bundle / "scene.json", source)
    cameras = []
    for index in range(3):
        image = np.full((200, 200, 3), color, dtype=np.uint8)
        image[70:130, 70:130] = [220, 45, 30]
        Image.fromarray(image).save(bundle / f"frame{index}.png")
        depth = np.full((100, 100), 2, dtype="<f4")
        depth[35:65, 35:65] = 1
        depth.tofile(bundle / f"depth{index}.f32")
        cameras.append({"id": f"frame{index}", "imagePath": f"frame{index}.png", "trackingState": "normal", "sharpness": 1,
                        "cameraToWorld": identity.flatten(order="F").tolist(), "nativeImageWidth": 200, "nativeImageHeight": 200,
                        "intrinsics": [80, 0, 0, 0, 80, 0, 100, 100, 1], "nativePixelToSavedPixel": np.eye(3).flatten(order="F").tolist(),
                        "depth": {"depthPath": f"depth{index}.f32", "width": 100, "height": 100,
                                  "format": "float32-little-endian, tightly packed rows, meters", "alignment": "native camera image orientation; scale intrinsics to depth resolution"}})
    # Frames are sampled in groups of three; nine records give three views.
    write_json(bundle / "cameras.json", [camera for camera in cameras for _ in range(3)])
    estimated = estimate_finishes(bundle)
    assert estimated["test-wall"]["baseColor"] == "#5c8eb1", "Foreground colour leaked into paint"
    test_scene = {"room": {"surfaces": [{"id": "test-wall-0", "kind": "wall"}, {"id": "test-wall-1", "kind": "wall"}]}}
    cache = bundle / "cache.json"
    apply_finishes(test_scene, bundle, cache)
    assert test_scene["room"]["surfaces"][0]["finish"] == test_scene["room"]["surfaces"][1]["finish"]
    with patch("app.surface_materials.estimate_finishes", side_effect=AssertionError("Cache missed")):
        apply_finishes(test_scene, bundle, cache)
    write_json(bundle / "cameras.json", cameras[:1])
    assert estimate_finishes(bundle) == {}, "Single-view paint should keep fallback"
    cameras[0]["imagePath"] = "../../outside.png"
    write_json(bundle / "cameras.json", cameras)
    rejected = {"room": {"surfaces": []}}
    apply_finishes(rejected, bundle, cache)
    assert rejected["finishRecovery"]["status"] == "unavailable", "Escaping RGB path accepted"

for name in ("ScanDemoWithDirectionResult", "ScanDemoResult"):
    bundle = ROOT / "reference/ToCodex" / name
    scene = adapt_scan(bundle, "finish-verification")
    before = deepcopy(scene)
    cache = ROOT / "tmp/finish-experiments" / name / "cache.json"
    apply_finishes(scene, bundle, cache)
    assert scene["finishRecovery"]["status"] == "complete"
    painted = [surface for surface in scene["room"]["surfaces"] if "finish" in surface]
    assert any(surface["kind"] == "floor" for surface in painted)
    assert any(surface["kind"] == "wall" for surface in painted)
    assert all(surface["finish"]["frameCount"] >= 3 and surface["finish"]["coverage"] >= 0.08 for surface in painted)
    for surface in scene["room"]["surfaces"]:
        surface.pop("finish", None)
    scene.pop("finishRecovery")
    assert scene == before, "Appearance recovery modified geometry/models/poses"
    print(f"PASS: {name}, {len(painted)} painted panels; geometry, colliders, cameras and furniture unchanged")
print("PASS: foreground rejection, split-wall consistency, sparse-view fallback, cache reuse, path containment")

if "--live" in sys.argv:
    import httpx
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=120) as client:
        before = client.get("/api/scenes/latest").raise_for_status().json()
        after = client.post("/api/scans/demo").raise_for_status().json()
        assert before["id"] == after["id"], "Demo switched scenes"
        assert after["finishRecovery"]["status"] == "complete"
        assert any(surface.get("finish") for surface in after["room"]["surfaces"])
        for manifest in (before, after):
            manifest.pop("finishRecovery", None)
            for surface in manifest["room"]["surfaces"]:
                surface.pop("finish", None)
        assert before == after, "Applying finishes changed existing scene/model data"
        print("PASS: live demo API changed appearance only; all existing job IDs/model URLs and scene data retained")
