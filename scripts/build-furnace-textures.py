"""Build compact, tileable WebP maps from an aged-metal source image.

Usage:
  python3 scripts/build-furnace-textures.py \
    output/imagegen/furnace-aged-metal-source.png \
    public/textures
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps


SIZE = 256
EDGE_BLEND = 36

SURFACE_PROFILES = {
    "aged": {"roughness_base": 150, "roughness_range": 0.35, "bump": 2.15},
    "blued": {"roughness_base": 145, "roughness_range": 0.34, "bump": 2.0},
    "olive": {"roughness_base": 178, "roughness_range": 0.27, "bump": 2.45},
    "ceramic": {"roughness_base": 188, "roughness_range": 0.23, "bump": 2.2},
}


def smoothstep(value):
    return value * value * (3 - 2 * value)


def blend_wrapped_edges(image):
    """Cross-fade opposite edge bands so the texture wraps without a seam."""
    pixels = image.load()
    width, height = image.size

    for offset in range(EDGE_BLEND):
        opposite = width - 1 - offset
        keep = 0.5 + 0.5 * smoothstep(offset / (EDGE_BLEND - 1))
        for y in range(height):
            left = pixels[offset, y]
            right = pixels[opposite, y]
            pixels[offset, y] = tuple(
                round(left[channel] * keep + right[channel] * (1 - keep))
                for channel in range(3)
            )
            pixels[opposite, y] = tuple(
                round(right[channel] * keep + left[channel] * (1 - keep))
                for channel in range(3)
            )

    for offset in range(EDGE_BLEND):
        opposite = height - 1 - offset
        keep = 0.5 + 0.5 * smoothstep(offset / (EDGE_BLEND - 1))
        for x in range(width):
            top = pixels[x, offset]
            bottom = pixels[x, opposite]
            pixels[x, offset] = tuple(
                round(top[channel] * keep + bottom[channel] * (1 - keep))
                for channel in range(3)
            )
            pixels[x, opposite] = tuple(
                round(bottom[channel] * keep + top[channel] * (1 - keep))
                for channel in range(3)
            )

    return image


def mix(first, second, amount):
    return round(first * (1 - amount) + second * amount)


def clamp(value):
    return max(0, min(255, round(value)))


def apply_surface_profile(tile, profile):
    if profile == "aged":
        return tile

    detail = ImageOps.autocontrast(ImageOps.grayscale(tile), cutoff=1)
    low_frequency = ImageOps.autocontrast(
        ImageOps.grayscale(tile).filter(ImageFilter.GaussianBlur(radius=8)),
        cutoff=1,
    )
    output = Image.new("RGB", tile.size)
    source_pixels = tile.load()
    detail_pixels = detail.load()
    low_pixels = low_frequency.load()
    output_pixels = output.load()

    for y in range(tile.height):
        for x in range(tile.width):
            value = detail_pixels[x, y] / 255
            low = low_pixels[x, y] / 255

            if profile == "blued":
                band = (
                    math.sin(math.tau * (3 * x + 2 * y) / SIZE)
                    + 0.55 * math.sin(math.tau * (x - 4 * y) / SIZE)
                ) / 1.55
                steel = 22 + value * 104
                warm = max(0, band) * 14
                violet = max(0, -band) * 13
                red = steel * 0.72 + warm + violet * 0.48
                green = steel * 0.79 + warm * 0.58
                blue = steel * 0.94 + violet + warm * 0.18
                output_pixels[x, y] = (
                    clamp(red), clamp(green), clamp(blue),
                )
                continue

            if profile == "olive":
                chip = max(0, (value - 0.66) / 0.34) ** 1.8 * 0.78
                grime = max(0, 0.42 - low) * 22
                paint = (
                    35 + value * 54 - grime,
                    44 + value * 63 - grime,
                    25 + value * 38 - grime * 0.7,
                )
                exposed = (
                    76 + value * 70,
                    82 + value * 70,
                    84 + value * 72,
                )
                output_pixels[x, y] = tuple(
                    clamp(mix(paint[channel], exposed[channel], chip))
                    for channel in range(3)
                )
                continue

            if profile == "ceramic":
                dark_chip = max(0, (0.2 - value) / 0.2) ** 2.2
                bright_chip = max(0, (value - 0.9) / 0.1) ** 2.8 * 0.55
                chip = min(0.9, dark_chip + bright_chip)
                soot = max(0, 0.48 - low) * 38
                coating = (
                    188 + value * 48 - soot,
                    190 + value * 46 - soot,
                    184 + value * 43 - soot * 0.85,
                )
                exposed = (
                    33 + value * 45,
                    39 + value * 47,
                    44 + value * 50,
                )
                output_pixels[x, y] = tuple(
                    clamp(mix(coating[channel], exposed[channel], chip))
                    for channel in range(3)
                )
                continue

            output_pixels[x, y] = source_pixels[x, y]

    return output


def build_maps(source_path, output_dir, prefix, profile):
    if profile not in SURFACE_PROFILES:
        raise ValueError(f"Unknown surface profile: {profile}")
    with Image.open(source_path) as source:
        source = source.convert("RGB")
        side = min(source.size)
        left = (source.width - side) // 2
        top = (source.height - side) // 2
        tile = source.crop((left, top, left + side, top + side))
        tile = tile.resize((SIZE, SIZE), Image.Resampling.LANCZOS)

    tile = blend_wrapped_edges(tile)
    gray = ImageOps.grayscale(tile)
    albedo = apply_surface_profile(tile, profile)
    settings = SURFACE_PROFILES[profile]

    roughness = ImageOps.autocontrast(ImageOps.invert(gray), cutoff=1)
    roughness = roughness.point(
        lambda value: round(
            settings["roughness_base"] + value * settings["roughness_range"]
        )
    )

    low_frequency = gray.filter(ImageFilter.GaussianBlur(radius=3.2))
    bump = ImageChops.subtract(gray, low_frequency, scale=1, offset=128)
    bump = ImageEnhance.Contrast(bump).enhance(settings["bump"])

    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        "albedo": output_dir / f"{prefix}-albedo.webp",
        "roughness": output_dir / f"{prefix}-roughness.webp",
        "bump": output_dir / f"{prefix}-bump.webp",
    }
    albedo.save(outputs["albedo"], "WEBP", quality=78, method=6)
    roughness.save(outputs["roughness"], "WEBP", quality=72, method=6)
    bump.save(outputs["bump"], "WEBP", quality=72, method=6)

    for kind, path in outputs.items():
        print(f"{kind.upper()}={path} ({path.stat().st_size} bytes)")


def main():
    if len(sys.argv) not in (3, 5):
        raise SystemExit(
            "Expected source image, output directory, and optional prefix/profile"
        )
    prefix = sys.argv[3] if len(sys.argv) == 5 else "furnace-aged-metal"
    profile = sys.argv[4] if len(sys.argv) == 5 else "aged"
    build_maps(
        Path(sys.argv[1]).resolve(),
        Path(sys.argv[2]).resolve(),
        prefix,
        profile,
    )


if __name__ == "__main__":
    main()
