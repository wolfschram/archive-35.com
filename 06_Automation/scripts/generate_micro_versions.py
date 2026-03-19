#!/usr/bin/env python3
"""Generate down-converted images for micro-license delivery.
Web tier: max 2400px, quality 90
Commercial tier: max 4000px, quality 92
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
IMAGES_DIR = ROOT / "images"
CATALOG_FILE = ROOT / "data" / "micro-licensing-catalog.json"
OUTPUT_WEB = ROOT / "09_Licensing" / "micro_delivery" / "web"
OUTPUT_COMMERCIAL = ROOT / "09_Licensing" / "micro_delivery" / "commercial"

OUTPUT_WEB.mkdir(parents=True, exist_ok=True)
OUTPUT_COMMERCIAL.mkdir(parents=True, exist_ok=True)


def resize_image(source, output, max_size, quality):
    """Resize using Pillow with LANCZOS resampling."""
    img = Image.open(source)
    w, h = img.size

    if max(w, h) <= max_size:
        img.save(output, "JPEG", quality=quality)
        return True

    if w >= h:
        new_w = max_size
        new_h = int(h * max_size / w)
    else:
        new_h = max_size
        new_w = int(w * max_size / h)

    img = img.resize((new_w, new_h), Image.LANCZOS)
    img.save(output, "JPEG", quality=quality)
    return True


def main():
    catalog = json.loads(CATALOG_FILE.read_text())
    images = catalog.get("images", [])

    processed = 0
    skipped = 0
    missing = 0
    errors = 0

    for entry in images:
        image_id = entry.get("id", "")
        collection = entry.get("collection", "")
        filename = entry.get("filename", "")

        if not filename or not collection:
            missing += 1
            continue

        # Source path: images/{collection}/{filename}-full.jpg
        source = IMAGES_DIR / collection / f"{filename}-full.jpg"
        if not source.exists():
            # Fallback: try without -full suffix
            source = IMAGES_DIR / collection / f"{filename}.jpg"
        if not source.exists():
            missing += 1
            if missing <= 5:
                print(f"  Missing source: {collection}/{filename}")
            continue

        web_out = OUTPUT_WEB / f"{image_id}.jpg"
        commercial_out = OUTPUT_COMMERCIAL / f"{image_id}.jpg"

        # Skip if both already exist
        if web_out.exists() and commercial_out.exists():
            skipped += 1
            continue

        try:
            if not web_out.exists():
                resize_image(source, web_out, 2400, 90)
            if not commercial_out.exists():
                resize_image(source, commercial_out, 4000, 92)
            processed += 1
            if processed % 100 == 0:
                print(f"  Processed {processed}...")
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  Error {image_id}: {e}")

    print(f"\nDone: {processed} processed, {skipped} skipped, {missing} missing source, {errors} errors")
    print(f"Web: {len(list(OUTPUT_WEB.glob('*.jpg')))} files")
    print(f"Commercial: {len(list(OUTPUT_COMMERCIAL.glob('*.jpg')))} files")


if __name__ == "__main__":
    main()
