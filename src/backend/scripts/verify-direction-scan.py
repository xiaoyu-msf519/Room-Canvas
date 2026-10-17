"""Audit the authorized directional scan and the running Web scene without submitting jobs."""
import json
import math
from pathlib import Path
import sys
from unittest.mock import patch

import httpx
import numpy as np
from pygeomag import GeoMag

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scans import adapt_scan, matrix
from app.heading import correct_magnetic_north

BUNDLE = ROOT / "reference/ToCodex/ScanDemoWithDirectionResult"
read = lambda name: json.loads((BUNDLE / name).read_text(encoding="utf-8"))
manifest, raw, heading, cameras = [read(name) for name in ("manifest.json", "scene.json", "heading.json", "cameras.json")]
assert manifest["id"] == raw["scanId"]
assert raw["orientation"] == manifest["orientation"] == heading["orientation"]
assert len(cameras) == 104 and len(raw["objects"]) == 7
assert len([surface for surface in raw["surfaces"] if surface["kind"] == "wall"]) == 10
assert len(heading["samples"]) == 170
max_delay = 0
max_error = 0
directions = []
for sample in heading["samples"]:
    max_delay = max(max_delay, abs(sample["arTimestamp"] - sample["motionTimestamp"]))
    transform = matrix(sample["portraitCameraToWorld"])[:3, :3] @ np.asarray(sample["northReferenceToDevice"]).reshape((3, 3), order="F")
    np.testing.assert_allclose(transform.T @ transform, np.eye(3), atol=1e-5)
    assert transform[1, 2] > 0.96, "Paired sensor gravity axes disagree"
    direction = transform[:, 0].copy()
    direction[1] = 0
    direction /= np.linalg.norm(direction)
    max_error = max(max_error, float(np.linalg.norm(direction - sample["northInWorld"])))
    directions.append(direction)
assert max_delay <= 0.2 and max_error < 1e-5
weights = [1 / max(3, sample["headingAccuracyDegrees"]) ** 2 for sample in heading["samples"]]
mean = np.average(directions, axis=0, weights=weights)
mean /= np.linalg.norm(mean)
np.testing.assert_allclose(mean, raw["orientation"]["northInWorld"], atol=1e-5)
np.testing.assert_allclose(np.cross(raw["orientation"]["northInWorld"], [0, 1, 0]), raw["orientation"]["eastInWorld"], atol=1e-5)
np.testing.assert_allclose(np.asarray(raw["orientation"]["northInWorld"]) + raw["orientation"]["southInWorld"], 0, atol=1e-5)

# Published pygeomag WMM2025 reference and correction sign independent of Shanghai.
assert abs(GeoMag(coefficients_file="wmm/WMM_2025.COF").calculate(glat=47.6205, glon=-122.3493, alt=0, time=2025.25).d - 15.065629638512593) < 1e-8
for declination in [-20, 20]:
    angle = math.radians(declination)
    synthetic = {"reference": "magnetic-north", "northInWorld": [math.sin(angle), 0, -math.cos(angle)], "location": {"latitude": 31, "longitude": 121}}
    with patch("app.heading.GeoMag") as model:
        model.return_value.calculate.return_value.d = declination
        model.return_value.calculate.return_value.calculate_uncertainty.return_value.d = 0.3
        correct_magnetic_north(synthetic, "2026-10-17T00:00:00Z")
    np.testing.assert_allclose(synthetic["northInWorld"], [0, 0, -1], atol=1e-8)

scene = adapt_scan(BUNDLE, "verification")
assert len([surface for surface in scene["room"]["surfaces"] if surface["kind"] == "ceiling"]) == 1
ceiling = next(surface for surface in scene["room"]["surfaces"] if surface["kind"] == "ceiling")
assert ceiling["position"][1] > 1
orientation = scene["source"]["orientation"]
assert orientation["reference"] == "true-north" and orientation["sourceReference"] == "magnetic-north"
assert -7 < orientation["correction"]["declinationDegrees"] < -6
offset = np.asarray(scene["source"]["worldOffset"])
for source, converted in zip(raw["objects"], scene["furniture"]):
    np.testing.assert_allclose(converted["position"], matrix(source["objectToWorld"])[:3, 3] + offset)
    np.testing.assert_allclose(converted["size"], source["dimensions"])
for source, converted in zip(cameras, scene["cameras"]):
    np.testing.assert_allclose(matrix(converted["cameraToWorld"])[:3, 3], matrix(source["cameraToWorld"])[:3, 3] + offset)
for bad_date in [None, "invalid", "2032-01-01T00:00:00Z"]:
    fallback = {"reference": "magnetic-north", "northInWorld": [0, 0, -1], "location": {"latitude": 31, "longitude": 121}}
    correct_magnetic_north(fallback, bad_date)
    assert fallback["reference"] == "magnetic-north"

with httpx.Client(base_url="http://127.0.0.1:8000", timeout=30) as client:
    actual = client.get("/api/scenes/latest").raise_for_status().json()
    assert actual["source"]["scanId"] == manifest["id"]
    np.testing.assert_allclose(actual["source"]["orientation"]["northInWorld"], orientation["northInWorld"])
    assert len(actual["furniture"]) == 7
    for item in actual["furniture"]:
        assert client.get(item["cropUrl"]).status_code == 200
    assert client.get(actual["cameras"][0]["imageUrl"]).status_code == 200
print(json.dumps({"result": "PASS", "pairedSamples": len(directions), "maxSensorDelaySeconds": max_delay,
                  "maxPairVectorError": max_error, "walls": len(scene["room"]["colliders"]),
                  "declinationDegrees": orientation["correction"]["declinationDegrees"],
                  "northAngleDegrees": orientation["northAngleDegrees"],
                  "sceneId": actual["id"]}))
