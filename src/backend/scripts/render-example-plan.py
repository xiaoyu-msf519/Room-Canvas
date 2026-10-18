"""Render a plan preview from the same structural manifest used by the Web."""
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.example_layout import HEIGHT, create_example_layout

scene = create_example_layout("plan-preview")
zones = scene["room"]["layout"]["zones"]
scale, margin, top = 64, 64, 90
minimum, maximum = scene["room"]["min"], scene["room"]["max"]
width = round((maximum[0] - minimum[0]) * scale + margin * 2)
height = round((maximum[2] - minimum[2]) * scale + top + 68)
image = Image.new("RGB", (width, height), "#fafcfd")
draw = ImageDraw.Draw(image)
font_file = "C:/Windows/Fonts/msyh.ttc"
font, small, title = (ImageFont.truetype(font_file, size) for size in (18, 14, 25))


def point(x, z):
    return margin + (x - minimum[0]) * scale, top + (z - minimum[2]) * scale


def rectangle(position, size, rotation):
    sx, _, sz = size
    if abs(rotation[1]) > 0.5:
        sx, sz = sz, sx
    x, _, z = position
    return (*point(x - sx / 2, z - sz / 2), *point(x + sx / 2, z + sz / 2))


colors = {"living": "#e5eee8", "bedroom": "#e6edf5", "bathroom": "#dff0f0", "kitchen": "#edf0e1", "foyer": "#ece8ed", "balcony": "#edf4f0"}
for zone in zones:
    x0, z0, x1, z1 = zone["rect"]
    draw.rectangle((*point(x0, z0), *point(x1, z1)), fill=colors[zone["kind"]])
for surface in scene["room"]["surfaces"]:
    if surface["kind"] == "wall" and surface["position"][1] - surface["size"][1] / 2 < 1.2 < surface["position"][1] + surface["size"][1] / 2:
        draw.rectangle(rectangle(surface["position"], surface["size"], surface["rotation"]), fill="#34424a")
for window in scene["room"]["layout"]["windows"]:
    draw.rectangle(rectangle(window["position"], [window["size"][0], window["size"][1], 0.07], window["rotation"]), fill="#2196b0")
for zone in zones:
    x, z = point(zone["center"][0], zone["center"][2])
    draw.text((x, z - 12), zone["name"], font=font, fill="#233842", anchor="mm")
    draw.text((x, z + 15), f"{zone['area']:g} m²", font=small, fill="#61737d", anchor="mm")
draw.text((margin, 24), "三室一厅两卫 · 厨房 · 玄关 · 封闭阳台", font=title, fill="#233842")
draw.text((margin, 59), f"固定布局 / {sum(zone['area'] for zone in zones):.2f} m² / 墙高 {HEIGHT:g} m / 蓝色为玻璃窗，空白为门洞", font=small, fill="#61737d")
draw.text((margin, height - 37), "平面来自实际生成数据，未包含家具或装修。", font=small, fill="#61737d")
output = ROOT / "tmp" / "example-layout-v4-plan.png"
output.parent.mkdir(parents=True, exist_ok=True)
image.save(output)
print(output)
