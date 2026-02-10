#!/usr/bin/env python3
"""
generate_thumbnail.py — Create 800px thumbnails from watermarked previews.

Usage:
    python generate_thumbnail.py [--folder /path/to/09_Licensing]

Reads watermarked/ directory, resizes to max 800px on longest edge,
saves to thumbnails/.
"""

import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("ERROR: Pillow not installed. Run: pip install Pillow")


def load_config(base):
    with open(base / "_config.json") as f:
        return json.load(f)


def generate_thumbnails(base_path):
    base = Path(base_path)
    cfg = load_config(base)
    thumb_cfg = cfg["thumbnail"]
    watermarked_dir = base / "watermarked"
    output_dir = base / "thumbnails"

    if not watermarked_dir.exists():
        sys.exit(f"ERROR: watermarked folder not found at {watermarked_dir}")

    files = sorted(watermarked_dir.glob("A35-*.jpg"))
    created = 0
    skipped = 0

    for f in files:
        catalog_id = f.stem
        output_file = output_dir / f"{catalog_id}.jpg"

        if output_file.exists():
            skipped += 1
            continue

        try:
            img = Image.open(f)
            w, h = img.size
            max_px = thumb_cfg["max_px"]

            if max(w, h) > max_px:
                ratio = max_px / max(w, h)
                img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

            img.save(output_file, "JPEG", quality=thumb_cfg["quality"])
            out_w, out_h = img.size
            size_kb = output_file.stat().st_size // 1024
            print(f"  ✓ {catalog_id}  {out_w}x{out_h}  {size_kb}KB")
            created += 1

        except Exception as e:
            print(f"  ERROR {catalog_id}: {e}")

    print(f"\n✓ Thumbnails: {created} created, {skipped} existing")


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    print(f"Generating thumbnails ...")
    generate_thumbnails(folder)
