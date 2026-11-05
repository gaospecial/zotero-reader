from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "artifacts" / "zr-app-icon-source.png"
OUTPUT = ROOT / "artifacts" / "zr-app-icon.png"

image = Image.open(SOURCE).convert("RGB")
if image.size != (1024, 1024):
    raise ValueError(f"Expected a 1024x1024 source, got {image.size}")

pixels = np.array(image).astype(np.float32)
y, x = np.ogrid[:1024, :1024]
corner = (x < 140) & (y > 910)
channel_range = pixels.max(axis=2) - pixels.min(axis=2)
neutral_mark = corner & (channel_range < 24) & (pixels.mean(axis=2) > 24)
red, green, blue = pixels[..., 0], pixels[..., 1], pixels[..., 2]
colored_mark = corner & (red > 28) & (red > green * 0.42) & (green > blue * 0.45)
watermark = neutral_mark | colored_mark
for _ in range(2):
    watermark |= np.roll(watermark, 1, axis=0) | np.roll(watermark, -1, axis=0)
    watermark |= np.roll(watermark, 1, axis=1) | np.roll(watermark, -1, axis=1)
watermark &= (x < 145) & (y > 905)

for _ in range(600):
    neighbors = (
        np.roll(pixels, 1, axis=0)
        + np.roll(pixels, -1, axis=0)
        + np.roll(pixels, 1, axis=1)
        + np.roll(pixels, -1, axis=1)
    ) / 4
    pixels[watermark] = neighbors[watermark]

cleaned_rgb = Image.fromarray(pixels.astype(np.uint8), "RGB")
hsv = np.array(cleaned_rgb.convert("HSV")).copy()
hue = hsv[..., 0].astype(np.float32)
blue_tones = (hue >= 95) & (hue <= 190) & (hsv[..., 1] > 45)
hsv[..., 0][blue_tones] = np.clip(3 + (190 - hue[blue_tones]) * 0.065, 0, 12).astype(np.uint8)
cleaned = Image.fromarray(hsv, "HSV").convert("RGB").convert("RGBA")

scale = 4
mask = Image.new("L", (1024 * scale, 1024 * scale), 0)
draw = ImageDraw.Draw(mask)
draw.rounded_rectangle(
    (3 * scale, 3 * scale, 1020 * scale, 1020 * scale),
    radius=224 * scale,
    fill=255,
)
mask = mask.resize((1024, 1024), Image.Resampling.LANCZOS)
cleaned.putalpha(mask)
cleaned.save(OUTPUT, optimize=True)
print(OUTPUT)
