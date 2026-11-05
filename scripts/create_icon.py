from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
root.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (512, 512), "#A52A2A")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((78, 74, 434, 438), radius=68, fill="#F8F5EF")
font_path = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
font = ImageFont.truetype(font_path, 230)
draw.text((256, 260), "Z", font=font, fill="#A52A2A", anchor="mm")
for size in (32, 128, 256, 512):
    target = "icon.png" if size == 512 else f"{size}x{size}.png"
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / target)
image.resize((256, 256), Image.Resampling.LANCZOS).save(root / "128x128@2x.png")
