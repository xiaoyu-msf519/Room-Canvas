"""Verify optional compass metadata without creating scenes or paid generation jobs."""
import copy
from pathlib import Path
import sys
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app import scans

BUNDLE = ROOT / "reference/ToCodex/ScanDemoResult"
orientation = {
    "reference": "true-north", "method": "paired-sensors", "northInWorld": [1, 0, 0],
    "accuracyDegrees": 8, "sampleCount": 24, "coherence": 0.99,
    "utcOffsetMinutes": 480, "location": {"latitude": 31.23, "longitude": 121.47},
}
converted = scans.adapt_orientation(orientation)
assert converted["northAngleDegrees"] == 90
assert converted["location"]["longitude"] == 121.47
assert scans.adapt_orientation({**orientation, "reference": "magnetic-north"}).get("northAngleDegrees") is None
assert scans.adapt_orientation(None) is None
for bad in [{"northInWorld": [0, 0, 0]}, {"northInWorld": [0, 1, 0]}, {"accuracyDegrees": 40},
            {"coherence": 0.1}, {"sampleCount": 2}, {"reference": "guessed"}]:
    try:
        scans.adapt_orientation({**orientation, **bad})
        raise AssertionError(f"Invalid heading was accepted: {bad}")
    except ValueError:
        pass

raw_read = scans.read_json
def read_with_heading(path):
    value = raw_read(path)
    if path.name == "scene.json":
        value["orientation"] = copy.deepcopy(orientation)
    return value

with patch.object(scans, "read_json", side_effect=read_with_heading):
    result = scans.adapt_scan(BUNDLE, "heading-test")
np.testing.assert_allclose(result["source"]["orientation"]["northInWorld"], [1, 0, 0])
original = scans.adapt_scan(BUNDLE, "heading-test")
assert original["source"]["orientation"] is None
assert result["room"] == original["room"], "Adding compass metadata moved the room"
assert result["furniture"] == original["furniture"], "Adding compass metadata moved furniture"
with patch.object(scans, "read_json", side_effect=lambda path: {**raw_read(path), "orientation": {**orientation, "northInWorld": [0, 0, 0]}} if path.name == "scene.json" else raw_read(path)):
    invalid = scans.adapt_scan(BUNDLE, "heading-test")
assert invalid["source"]["orientation"] is None
assert len(invalid["warnings"]) > len(original["warnings"])
print("PASS: true/magnetic north distinction, validation, 90-degree coordinate mapping, optional legacy metadata, invalid compass fallback, unchanged room/furniture geometry")
