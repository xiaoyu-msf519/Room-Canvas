"""Compare RGB-D finish estimates on real photos, without changing scan geometry."""
import argparse
import json
from pathlib import Path
import sys
from time import perf_counter

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.surface_materials import estimate_finishes

parser = argparse.ArgumentParser()
parser.add_argument("bundle")
parser.add_argument("--output", required=True)
args = parser.parse_args()
destination = Path(args.output)
destination.mkdir(parents=True, exist_ok=True)
diagnostics = {}
start = perf_counter()
materials = estimate_finishes(Path(args.bundle), diagnostics)
elapsed = perf_counter() - start
preview = Image.new("RGB", (1000, 92 + len(diagnostics) * 110), "#edf0f1")
draw = ImageDraw.Draw(preview)
draw.text((14, 12), "Real scan: planar RGB-D finish experiments (no geometry changes)", fill="#17232a")
draw.text((14, 40), "Raw projected pixels | Depth+furniture filtered | Multi-view robust finish", fill="#17232a")
for index, (surface_id, data) in enumerate(diagnostics.items()):
    y = 80 + index * 110
    draw.text((14, y), f"{data['kind']} {surface_id[:8]}  {data['rawCount']} -> {data['filteredCount']} samples", fill="#17232a")
    for column, key in enumerate(["rawColors", "filteredColors"]):
        colors = data.pop(key)
        if len(colors):
            # Swatches retain colour distribution, not a fake spatial texture.
            array = np.resize(colors, (24, 80, 3))
            preview.paste(Image.fromarray(array).resize((300, 65)), (14 + column * 320, y + 24))
    material = data["material"]
    rgb = material["baseColor"] if material else "#b3bac0"
    draw.rectangle((654, y + 24, 950, y + 89), fill=rgb)
    draw.text((665, y + 30), rgb if material else "insufficient views: keep fallback", fill="#17232a")
    best = data.pop("best")
    composite = data.pop("composite")
    nx, ny = data["shape"]
    if best:
        spatial = Image.new("RGB", (1320, 560), "#edf0f1")
        annotations = ImageDraw.Draw(spatial)
        annotations.text((10, 10), f"{data['kind']} {surface_id}  best: {best['frameId']}  coverage: {data['coverage']:.1%}", fill="#17232a")
        spatial.paste(best["photo"], (10, 50))
        for column, (label, grid) in enumerate([("Raw projection", best["rawGrid"]), ("Occlusion filtered", best["filteredGrid"]), ("Multi-view median", composite)]):
            annotations.text((390 + column * 310, 35), label, fill="#17232a")
            plane = Image.fromarray(grid.reshape(ny, nx, 3)[::-1])
            plane.thumbnail((295, 460))
            plane = plane.resize((295, max(20, min(460, int(295 * ny / nx)))))
            spatial.paste(plane, (390 + column * 310, 65))
        spatial.save(destination / f"projection-{surface_id[:8]}.png")
preview.save(destination / "finish-comparison.png")
(destination / "diagnostics.json").write_text(json.dumps({"elapsedSeconds": elapsed, "materials": materials, "surfaces": diagnostics}, indent=2), encoding="utf-8")
print(json.dumps({"elapsedSeconds": elapsed, "materials": materials, "diagnostics": str(destination / "diagnostics.json")}))
