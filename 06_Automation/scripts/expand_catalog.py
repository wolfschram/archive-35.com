#!/usr/bin/env python3
"""Expand licensing catalog from 166 to 1000+ images using the full photo library."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHOTOS_FILE = ROOT / "data" / "photos.json"
CATALOG_FILE = ROOT / "data" / "licensing-catalog.json"


def classify(width, height):
    longest = max(width or 0, height or 0)
    if longest >= 15000:
        return "ULTRA"
    elif longest >= 8000:
        return "PREMIUM"
    elif longest >= 4000:
        return "STANDARD"
    return None  # Too small for licensing


def generate_tiers(classification):
    base_prices = {"ULTRA": 350, "PREMIUM": 280, "STANDARD": 200}
    base = base_prices.get(classification, 200)
    return {
        "web_social": {"price": 2.50, "duration": "1 year"},
        "editorial": {"price": 5.00, "duration": "1 year"},
        "commercial_print": {"price": float(base), "duration": "2 years"},
        "billboard_ooh": {"price": float(base * 2), "duration": "1 year"},
        "hospitality": {"price": float(base * 3), "duration": "Perpetual"},
    }


def main():
    # Load photos
    photos = json.loads(PHOTOS_FILE.read_text())
    if isinstance(photos, dict):
        photo_list = photos.get("photos", [])
    else:
        photo_list = photos

    # Load existing catalog
    catalog = json.loads(CATALOG_FILE.read_text())
    existing_ids = set()
    existing_images = catalog.get("images", [])
    for img in existing_images:
        existing_ids.add(img.get("id", ""))

    # Expand
    added = 0
    for photo in photo_list:
        pid = photo.get("id", "")
        if pid in existing_ids:
            continue

        # Dimensions are nested in photos.json
        dims = photo.get("dimensions", {})
        width = dims.get("width", photo.get("width", 0))
        height = dims.get("height", photo.get("height", 0))
        classification = classify(width, height)
        if not classification:
            continue

        entry = {
            "id": pid,
            "title": photo.get("title", photo.get("filename", "")),
            "collection": photo.get("collection", ""),
            "filename": photo.get("filename", ""),
            "width": width,
            "height": height,
            "classification": classification,
            "tiers": generate_tiers(classification),
            "tags": photo.get("tags", []),
            "location": photo.get("location", ""),
            "status": "available",
        }
        existing_images.append(entry)
        existing_ids.add(pid)
        added += 1

    # Update catalog
    catalog["images"] = existing_images
    catalog["total_images"] = len(existing_images)

    # Count by classification
    counts = {}
    for img in existing_images:
        c = img.get("classification", "UNKNOWN")
        counts[c] = counts.get(c, 0) + 1

    tmp = CATALOG_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(catalog, indent=2))
    import os
    os.replace(str(tmp), str(CATALOG_FILE))  # atomic on same filesystem

    print(f"Catalog expanded: {added} images added")
    print(f"Total: {len(existing_images)} images")
    for c, n in sorted(counts.items()):
        print(f"  {c}: {n}")


if __name__ == "__main__":
    main()
