"""Inspect calibrated single-object masks without calling image-to-3D."""
import argparse
from pathlib import Path
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scan_crops import prepare_furniture_crop, CropNeedsReview
from app.scans import read_json

parser = argparse.ArgumentParser()
parser.add_argument("bundle", type=Path)
args = parser.parse_args()
bundle = args.bundle.resolve()
# Use a cached copy; never write prepared images into the user's input bundle.
import shutil
destination = ROOT / "tmp/crop-experiments" / bundle.name
shutil.copytree(bundle, destination, dirs_exist_ok=True)
source = read_json(destination / "scene.json")
preview = Image.new("RGB", (320 * len(source["objects"]), 400), "#e7e9eb")
draw = ImageDraw.Draw(preview)
for index, obj in enumerate(source["objects"]):
    x = index * 320
    draw.text((x + 8, 8), f"{obj['category']} {obj['id'][:8]}", fill="black")
    try:
        selection = prepare_furniture_crop(destination, obj["id"], destination / "prepared")
        with Image.open(destination / selection["imagePath"]) as image:
            image.thumbnail((300, 330))
            preview.paste(image, (x + 10, 50), image)
        print({"id": obj["id"], **selection})
    except CropNeedsReview as error:
        draw.text((x + 8, 50), "Needs another view", fill="red")
        print({"id": obj["id"], "needsReview": str(error)})
preview.save(destination / "comparison.png")
print(destination / "comparison.png")
