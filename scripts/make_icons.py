"""Generate the packaged Chrome extension icons from vector-like Pillow shapes."""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)

SIZE = 512
image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((18, 18, 494, 494), radius=125, fill="#D8FC81")
draw.ellipse((92, 92, 420, 420), outline="#548465", width=23)
draw.ellipse((130, 78, 382, 434), outline="#265B4F", width=15)
draw.polygon([(205, 162), (205, 350), (355, 256)], fill="#17302C")

for size in (16, 32, 48, 128):
    image.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f"icon-{size}.png")
