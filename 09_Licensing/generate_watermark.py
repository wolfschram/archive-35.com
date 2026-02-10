#!/usr/bin/env python3
"""
generate_watermark.py — Create watermarked preview images from originals.

Usage:
    python generate_watermark.py [--folder /path/to/09_Licensing]

Reads metadata/*.json to find originals, resizes to max 3000px,
applies tiled diagonal "ARCHIVE-35 | PREVIEW ONLY" watermark at 30% opacity,
saves to watermarked/.
"""

import json
import math
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageEnhance
except ImportError:
    sys.exit("ERROR: Pillow not installed. Run: pip install Pillow")


def load_config(base):
    with open(base / "_config.json") as f:
        return json.load(f)


def get_font(size):
    """Try to load a clean sans-serif font, fall back to default."""
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def apply_watermark(img, text, opacity):
    """Apply tiled diagonal watermark text across the image."""
    w, h = img.size

    # Create transparent overlay
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Scale font to image — roughly 2.5% of image width
    font_size = max(24, int(w * 0.025))
    font = get_font(font_size)

    # Measure text
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Tile spacing
    x_gap = int(tw * 1.6)
    y_gap = int(th * 5)

    # Alpha value
    alpha = int(255 * opacity)

    # Draw tiled at 30-degree angle
    angle = -30
    # We need to cover the full diagonal, so extend the tiling area
    diag = int(math.sqrt(w * w + h * h))
    tile_overlay = Image.new("RGBA", (diag * 2, diag * 2), (0, 0, 0, 0))
    tile_draw = ImageDraw.Draw(tile_overlay)

    y = -diag
    while y < diag * 2:
        x = -diag
        row_offset = (y // y_gap) % 2 * (x_gap // 2)  # stagger rows
        while x < diag * 2:
            tile_draw.text(
                (x + row_offset, y),
                text,
                fill=(255, 255, 255, alpha),
                font=font,
            )
            x += x_gap
        y += y_gap

    # Rotate the tile overlay
    tile_rotated = tile_overlay.rotate(angle, expand=False, resample=Image.BICUBIC)

    # Crop to image size from center
    cx, cy = tile_rotated.size[0] // 2, tile_rotated.size[1] // 2
    left = cx - w // 2
    top = cy - h // 2
    tile_cropped = tile_rotated.crop((left, top, left + w, top + h))

    # Composite
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    watermarked = Image.alpha_composite(img, tile_cropped)
    return watermarked.convert("RGB")


def generate_watermarks(base_path):
    base = Path(base_path)
    cfg = load_config(base)
    wm_cfg = cfg["watermark"]
    metadata_dir = base / "metadata"
    originals_dir = base / "originals"
    output_dir = base / "watermarked"

    if not metadata_dir.exists():
        sys.exit(f"ERROR: metadata folder not found at {metadata_dir}")

    meta_files = sorted(metadata_dir.glob("A35-*.json"))
    created = 0
    skipped = 0

    for mf in meta_files:
        with open(mf) as f:
            meta = json.load(f)

        catalog_id = meta["catalog_id"]
        original_file = originals_dir / meta["original_filename"]
        output_file = output_dir / f"{catalog_id}.jpg"

        if output_file.exists():
            skipped += 1
            continue

        if not original_file.exists():
            print(f"  SKIP {catalog_id}: original not found ({meta['original_filename']})")
            continue

        try:
            img = Image.open(original_file)

            # Resize to max preview size
            max_px = wm_cfg["max_preview_px"]
            w, h = img.size
            if max(w, h) > max_px:
                ratio = max_px / max(w, h)
                img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

            # Apply watermark
            watermarked = apply_watermark(img, wm_cfg["text"], wm_cfg["opacity"])

            # Save
            watermarked.save(output_file, "JPEG", quality=wm_cfg["quality"])
            out_w, out_h = watermarked.size
            size_kb = output_file.stat().st_size // 1024
            print(f"  ✓ {catalog_id}  {out_w}x{out_h}  {size_kb}KB")
            created += 1

        except Exception as e:
            print(f"  ERROR {catalog_id}: {e}")

    print(f"\n✓ Watermarks: {created} created, {skipped} existing")


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    print(f"Generating watermarked previews ...")
    generate_watermarks(folder)
