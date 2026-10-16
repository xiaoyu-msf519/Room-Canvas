from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
image = Image.new("RGB", (1024, 1024), "#007a73")
draw = ImageDraw.Draw(image)
draw.line([(260, 335), (512, 190), (764, 335), (764, 650), (512, 805), (260, 650), (260, 335)], fill="white", width=42, joint="curve")
draw.line([(260, 335), (512, 485), (764, 335)], fill="white", width=32, joint="curve")
draw.line([(512, 485), (512, 805)], fill="white", width=32)
draw.rectangle((355, 535, 439, 630), fill="#ffce69")
draw.line([(355, 630), (355, 677)], fill="#ffce69", width=16)
image.save(root / "RoomCanvas/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
