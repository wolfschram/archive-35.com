#!/usr/bin/env python3
"""
generate_watermark.py — Create copy-protected preview images from originals.

Usage:
    python generate_watermark.py [--folder /path/to/09_Licensing] [--force]

PROTECTION STRATEGY (invisible — no ugly text overlays):
  1. Resize to max 2000px (screen-only resolution)
  2. Aggressive JPEG compression (quality 45) — looks fine on screen, useless for print
  3. Strip ALL EXIF/metadata — no camera info, GPS, or other data leaks
  4. Slight Gaussian blur (radius 0.5) — imperceptible on screen, degrades print sharpness
  5. Combine with client-side protections in licensing.html:
     - Canvas-based rendering (blocks right-click save)
     - Blob URLs (no direct image URL to copy)
     - image-protection.js (blocks drag, long-press)
     - C2PA credentials on originals prove ownership

Result: Beautiful clean preview that looks premium → but the actual file is
low-quality, metadata-stripped, slightly softened JPEG with zero commercial value.
"""

import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("ERROR: Pillow not installed. Run: pip install Pillow")

# Allow ultra-large panoramic images (up to 500MP)
Image.MAX_IMAGE_PIXELS = 500_000_000

# Preview protection settings (for grid/modal view — invisible protection)
PREVIEW_MAX_PX = 2000       # Max dimension — enough for screen, not for print
PREVIEW_QUALITY = 45         # Aggressive compression — looks OK on screen, garbage for print
PREVIEW_BLUR_RADIUS = 0.5   # Slight softening — imperceptible on screen, kills print sharpness

# Zoom preview settings (for hover-reveal fullscreen view)
# High enough to showcase sharpness on 4K/5K monitors — still not original quality
# The hover-reveal stripe only shows ~180px band at a time, so screenshots are useless
ZOOM_MAX_PX = 8000           # Up to 8K on long edge — shows incredible detail in reveal stripe
ZOOM_QUALITY = 82            # Good enough to showcase sharpness, not good enough for print at full size
ZOOM_BLUR_RADIUS = 0         # No blur — let them see the crisp detail that makes this photography special


def load_config(base):
    with open(base / "_config.json") as f:
        return json.load(f)


def generate_clean_preview(img):
    """
    Generate a visually clean but commercially useless preview.
    No watermark text — protection is invisible.
    """
    w, h = img.size

    # 1. Resize to screen-only resolution
    if max(w, h) > PREVIEW_MAX_PX:
        ratio = PREVIEW_MAX_PX / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    # 2. Strip to RGB (removes alpha, ICC profiles when re-saved)
    if img.mode != "RGB":
        img = img.convert("RGB")

    # 3. Slight Gaussian blur — imperceptible on screen, kills fine detail for print
    img = img.filter(ImageFilter.GaussianBlur(radius=PREVIEW_BLUR_RADIUS))

    return img


def generate_zoom_preview(img):
    """
    Generate a higher-quality zoom preview WITH visible watermark.
    Good enough to showcase sharpness — not good enough for commercial use.
    """
    w, h = img.size

    # 1. Resize to zoom resolution (bigger than grid preview)
    if max(w, h) > ZOOM_MAX_PX:
        ratio = ZOOM_MAX_PX / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    # 2. Strip to RGB
    if img.mode != "RGB":
        img = img.convert("RGB")

    # 3. NO blur — let them see the quality

    # 4. Apply visible watermark
    try:
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)
        w, h = img.size

        # Calculate font size based on image dimensions
        font_size = max(w // 16, 40)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
        except (OSError, IOError):
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
            except (OSError, IOError):
                font = ImageFont.load_default()

        # Diagonal repeating watermark
        import math
        step_y = max(h // 4, 150)
        step_x = max(w // 3, 200)
        for y in range(-h, h * 2, step_y):
            for x in range(-w, w * 2, step_x):
                # Create a temporary image for rotated text
                txt_img = Image.new("RGBA", (font_size * 8, font_size * 2), (0, 0, 0, 0))
                txt_draw = ImageDraw.Draw(txt_img)
                txt_draw.text((10, 10), "ARCHIVE-35", fill=(255, 255, 255, 28), font=font)
                txt_img = txt_img.rotate(30, expand=True, resample=Image.BICUBIC)
                try:
                    img.paste(txt_img, (x, y), txt_img)
                except (ValueError, Exception):
                    pass
    except ImportError:
        pass  # No watermark if PIL doesn't support it

    return img


def generate_watermarks(base_path, force=False, zoom=False):
    """
    Generate preview images.
    Default: clean invisible-protection previews in watermarked/
    zoom=True: higher-quality visible-watermark previews in zoom/
    Set force=True to regenerate ALL previews.
    """
    base = Path(base_path)
    cfg = load_config(base)
    metadata_dir = base / "metadata"
    originals_dir = base / "originals"
    if zoom:
        output_dir = base / "zoom"
        quality = ZOOM_QUALITY
    else:
        output_dir = base / "watermarked"  # Keep same folder name for compatibility
        quality = PREVIEW_QUALITY

    if not metadata_dir.exists():
        sys.exit(f"ERROR: metadata folder not found at {metadata_dir}")

    meta_files = sorted(metadata_dir.glob("A35-*.json"))
    created = 0
    skipped = 0

    for mf in meta_files:
        with open(mf) as f:
            meta = json.load(f)

        catalog_id = meta["catalog_id"]
        # Use source_path from metadata if available (for external source folders)
        src_dir = Path(meta["source_path"]) if "source_path" in meta else originals_dir
        original_file = src_dir / meta["original_filename"]
        output_file = output_dir / f"{catalog_id}.jpg"

        if output_file.exists() and not force:
            # Check if original was re-edited (newer mtime = needs regen)
            if original_file.exists() and original_file.stat().st_mtime > output_file.stat().st_mtime:
                print(f"  UPDATE {catalog_id}: original is newer than preview")
            else:
                skipped += 1
                continue

        if not original_file.exists():
            print(f"  SKIP {catalog_id}: original not found ({meta['original_filename']})")
            continue

        try:
            img = Image.open(original_file)

            # Generate preview based on mode
            if zoom:
                preview = generate_zoom_preview(img)
            else:
                preview = generate_clean_preview(img)

            # Save with appropriate compression and NO metadata
            preview.save(
                output_file,
                "JPEG",
                quality=quality,
                optimize=True,
                # Do NOT pass exif — this strips all metadata
            )

            out_w, out_h = preview.size
            size_kb = output_file.stat().st_size // 1024
            print(f"  ✓ {catalog_id}  {out_w}x{out_h}  {size_kb}KB  (clean preview)")
            created += 1

        except Exception as e:
            print(f"  ERROR {catalog_id}: {e}")

    action = "Regenerated" if force else "Created"
    print(f"\n✓ Previews: {created} {action.lower()}, {skipped} existing")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate copy-protected preview images")
    parser.add_argument("folder", nargs="?", default=os.path.dirname(os.path.abspath(__file__)),
                        help="Path to 09_Licensing directory")
    parser.add_argument("--force", action="store_true",
                        help="Regenerate ALL previews (replace existing)")
    parser.add_argument("--zoom", action="store_true",
                        help="Generate zoom previews (higher quality, visible watermark) in zoom/ folder")
    args = parser.parse_args()
    if args.zoom:
        print(f"Generating ZOOM previews (higher quality, visible watermark) ...")
    else:
        print(f"Generating clean previews (invisible protection) ...")
    generate_watermarks(args.folder, force=args.force, zoom=args.zoom)
