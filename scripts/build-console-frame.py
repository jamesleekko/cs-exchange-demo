"""Crop the selected console concept and remove its display glass.

Run: python3 scripts/build-console-frame.py
Requires Pillow, like the other texture build scripts in this repository.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public/console-frames/console-screen-foundry-cassette.png"
OUTPUT = ROOT / "public/console-frames/console-screen-foundry-cassette-cutout.png"

# Coordinates are measured against the 2048x1152 placement asset.
CROP_BOX = (624, 837, 1424, 1152)
SCREEN_POLYGON = ((210, 43), (590, 43), (658, 315), (142, 315))
SUPERSAMPLE = 4


def main():
    with Image.open(SOURCE) as source:
        frame = source.convert("RGBA").crop(CROP_BOX)

    width, height = frame.size
    keep_mask = Image.new("L", (width * SUPERSAMPLE, height * SUPERSAMPLE), 255)
    draw = ImageDraw.Draw(keep_mask)
    draw.polygon(
        [(x * SUPERSAMPLE, y * SUPERSAMPLE) for x, y in SCREEN_POLYGON],
        fill=0,
    )
    keep_mask = keep_mask.resize((width, height), Image.Resampling.LANCZOS)

    alpha = ImageChops.multiply(frame.getchannel("A"), keep_mask)
    frame.putalpha(alpha)
    frame.save(OUTPUT, "PNG", optimize=True)
    print(f"Wrote {OUTPUT} ({width}x{height}, RGBA)")


if __name__ == "__main__":
    main()
