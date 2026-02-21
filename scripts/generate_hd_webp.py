#!/usr/bin/env python3
"""
generate_hd_webp.py — Generate HD WebP images for 4K display sharpness

PURPOSE:
  The current web images are 2000px max (JPEG). On 4K/Retina displays (DPR 2),
  the lightbox needs ~4200 device pixels but only has 2000px to work with,
  causing visible softness. This script creates a third image tier:

  CURRENT:
    -thumb.jpg  = 400px  (grid thumbnails)
    -full.jpg   = 2000px (CoverFlow hero, standard displays)

  NEW:
    -hd.webp    = 3500px (lightbox on high-DPI displays)

  WebP at 3500px ≈ same file size as JPEG at 2000px thanks to ~40% better
  compression, so bandwidth impact is near-zero when loaded on demand.

USAGE:
  # Single collection (proof of concept):
  python3 scripts/generate_hd_webp.py --collection iceland

  # All collections:
  python3 scripts/generate_hd_webp.py --all

  # Dry run (no files created):
  python3 scripts/generate_hd_webp.py --all --dry-run

SOURCE:
  Reads originals from photography/{collection}/*.jpg
  Writes HD WebP to images/{slug}/*-hd.webp

REQUIRES:
  pip install Pillow --break-system-packages
"""

import os
import sys
import json
import argparse
import time
import gc
from pathlib import Path

# Allow large originals (some are 8000x12000+ = 178M pixels)
# These are legitimate high-res photography, not decompression bombs
import PIL.Image
PIL.Image.MAX_IMAGE_PIXELS = 300_000_000  # 300MP limit

# Add repo root to path
REPO_ROOT = Path(__file__).resolve().parent.parent
PHOTOGRAPHY_DIR = REPO_ROOT / "photography"
IMAGES_DIR = REPO_ROOT / "images"
PHOTOS_JSON = REPO_ROOT / "data" / "photos.json"

# HD image settings
HD_MAX_PIXELS = 3500       # Max long edge in pixels
HD_WEBP_QUALITY = 85       # WebP quality (85 = high quality, good compression)
HD_SUFFIX = "-hd.webp"     # File suffix for HD images


def slugify(folder_name):
    """Convert Photography folder name to web slug (matching existing convention)."""
    return folder_name.strip().lower().replace(' ', '-').replace('_', '-')


def get_collection_map():
    """Build mapping from photography folder → images slug using photos.json."""
    if not PHOTOS_JSON.exists():
        print(f"WARNING: {PHOTOS_JSON} not found, using slugified folder names")
        return {}

    with open(PHOTOS_JSON) as f:
        data = json.load(f)
    photos = data.get('photos', data) if isinstance(data, dict) else data

    # Map: original filename (without extension) → collection slug
    file_to_collection = {}
    for p in photos:
        full_path = p.get('full', '')
        if full_path:
            # "images/iceland/WOLF4775-full.jpg" → filename="WOLF4775", collection="iceland"
            parts = full_path.split('/')
            if len(parts) >= 3:
                collection = parts[1]  # "iceland"
                filename = parts[2].replace('-full.jpg', '')  # "WOLF4775"
                file_to_collection[filename] = collection

    return file_to_collection


def find_original(photo_stem, photography_folders):
    """Find the original file in Photography/ for a given photo stem."""
    for folder in photography_folders:
        for ext in ['.jpg', '.JPG', '.jpeg', '.JPEG', '.tif', '.TIF']:
            candidate = folder / f"{photo_stem}{ext}"
            if candidate.exists():
                return candidate
    return None


def process_collection(collection_slug, dry_run=False):
    """Generate HD WebP images for one collection."""
    from PIL import Image

    images_folder = IMAGES_DIR / collection_slug
    if not images_folder.exists():
        print(f"  SKIP: {images_folder} not found")
        return 0, 0, 0

    # Find all -full.jpg files in this collection
    full_images = sorted(images_folder.glob("*-full.jpg"))
    if not full_images:
        print(f"  SKIP: No -full.jpg files in {collection_slug}")
        return 0, 0, 0

    # Find matching Photography source folders
    photo_folders = []
    for d in PHOTOGRAPHY_DIR.iterdir():
        if d.is_dir() and slugify(d.name) == collection_slug:
            photo_folders.append(d)
    # Also check exact name matches
    for d in PHOTOGRAPHY_DIR.iterdir():
        if d.is_dir() and d not in photo_folders:
            if d.name.strip().lower().replace(' ', '-').replace('_', '-') == collection_slug:
                photo_folders.append(d)

    if not photo_folders:
        print(f"  WARNING: No Photography source folder found for '{collection_slug}'")
        print(f"  Falling back to upscaling from -full.jpg (2000px → 3500px won't help)")
        # We could still try, but upscaling won't improve quality
        return 0, 0, len(full_images)

    created = 0
    skipped = 0
    failed = 0
    total_bytes = 0

    for full_path in full_images:
        # "WOLF4775-full.jpg" → "WOLF4775"
        stem = full_path.stem.replace('-full', '')
        hd_path = images_folder / f"{stem}{HD_SUFFIX}"

        # Skip if already exists
        if hd_path.exists():
            skipped += 1
            continue

        # Find original in Photography/
        original = find_original(stem, photo_folders)
        if not original:
            # Try with spaces and other variations
            for folder in photo_folders:
                candidates = list(folder.glob(f"{stem}*"))
                if candidates:
                    original = candidates[0]
                    break

        if not original:
            print(f"    MISS: {stem} — no original found in Photography/")
            failed += 1
            continue

        if dry_run:
            print(f"    WOULD CREATE: {hd_path.name} from {original.name}")
            created += 1
            continue

        try:
            with Image.open(original) as img:
                # Convert to RGB if necessary (some originals are CMYK)
                if img.mode not in ('RGB', 'RGBA'):
                    img = img.convert('RGB')

                # Resize to max 3500px on long edge
                w, h = img.size
                if max(w, h) <= HD_MAX_PIXELS:
                    # Original is smaller than target — use as-is
                    ratio = 1.0
                else:
                    ratio = HD_MAX_PIXELS / max(w, h)

                new_w = int(w * ratio)
                new_h = int(h * ratio)

                if ratio < 1.0:
                    img = img.resize((new_w, new_h), Image.LANCZOS)

                # Save as WebP
                img.save(str(hd_path), 'WEBP', quality=HD_WEBP_QUALITY, method=4)

                file_size = hd_path.stat().st_size
                total_bytes += file_size
                created += 1

                if created % 10 == 0:
                    print(f"    [{created}] {hd_path.name} — {new_w}x{new_h} — {file_size//1024}KB")

            # Free memory after each large image
            gc.collect()

        except Exception as e:
            print(f"    ERROR: {stem} — {e}")
            failed += 1

    return created, skipped, failed, total_bytes


def main():
    parser = argparse.ArgumentParser(description='Generate HD WebP images for 4K displays')
    parser.add_argument('--collection', type=str, help='Process single collection slug (e.g., "iceland")')
    parser.add_argument('--all', action='store_true', help='Process all collections')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be created without creating files')
    args = parser.parse_args()

    if not args.collection and not args.all:
        parser.print_help()
        sys.exit(1)

    # Verify Pillow is available
    try:
        from PIL import Image
        print(f"Pillow version: {Image.__version__}")
    except ImportError:
        print("ERROR: Pillow not installed. Run: pip install Pillow --break-system-packages")
        sys.exit(1)

    print(f"HD WebP Generator — {HD_MAX_PIXELS}px @ Q{HD_WEBP_QUALITY}")
    print(f"Photography source: {PHOTOGRAPHY_DIR}")
    print(f"Output directory: {IMAGES_DIR}")
    if args.dry_run:
        print("*** DRY RUN — no files will be created ***")
    print()

    start = time.time()
    total_created = 0
    total_skipped = 0
    total_failed = 0
    total_bytes = 0

    if args.collection:
        collections = [args.collection]
    else:
        # Get all collection slugs from images/ directory
        collections = sorted([
            d.name for d in IMAGES_DIR.iterdir()
            if d.is_dir() and not d.name.startswith('.')
        ])

    for slug in collections:
        print(f"[{slug}]")
        result = process_collection(slug, dry_run=args.dry_run)
        if len(result) == 4:
            c, s, f, b = result
            total_created += c
            total_skipped += s
            total_failed += f
            total_bytes += b
        elif len(result) == 3:
            c, s, f = result
            total_created += c
            total_skipped += s
            total_failed += f
        print(f"  Created: {c}, Skipped: {s}, Failed: {f}")

    elapsed = time.time() - start
    print(f"\n{'='*50}")
    print(f"DONE in {elapsed:.1f}s")
    print(f"  Created: {total_created}")
    print(f"  Skipped: {total_skipped} (already exist)")
    print(f"  Failed:  {total_failed}")
    if total_bytes > 0:
        print(f"  Total size: {total_bytes/1024/1024:.1f} MB")
        print(f"  Avg size:   {total_bytes/max(total_created,1)/1024:.0f} KB")


if __name__ == '__main__':
    main()
