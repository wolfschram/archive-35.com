#!/usr/bin/env python3
"""
scan_licensing_folder.py — Scan originals/, classify by resolution, generate metadata JSON.

Usage:
    python scan_licensing_folder.py [--folder /path/to/09_Licensing]

Reads all images from originals/, extracts EXIF + dimensions, classifies as
ULTRA / PREMIUM / STANDARD, writes per-image JSON to metadata/.
"""

import json
import os
import sys
import math
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    sys.exit("ERROR: Pillow not installed. Run: pip install Pillow")

# Allow ultra-large panoramic images (up to 500MP)
Image.MAX_IMAGE_PIXELS = 500_000_000

SUPPORTED_EXT = {".jpg", ".jpeg", ".tif", ".tiff", ".png", ".webp"}

# ─── helpers ───────────────────────────────────────────────────────
def load_config(base):
    with open(base / "_config.json") as f:
        return json.load(f)


def classify(width, cfg):
    """Return classification tier based on pixel width."""
    tiers = cfg["classification"]
    if width >= tiers["ULTRA"]["min_width"]:
        return "ULTRA"
    elif width >= tiers["PREMIUM"]["min_width"]:
        return "PREMIUM"
    elif width >= tiers["STANDARD"]["min_width"]:
        return "STANDARD"
    return None  # below minimum


def extract_exif(img):
    """Pull useful EXIF fields from a PIL Image."""
    exif_data = {}
    try:
        raw = img._getexif()
        if not raw:
            return exif_data
        for tag_id, value in raw.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag in ("Make", "Model", "LensModel", "DateTimeOriginal",
                       "FocalLength", "FNumber", "ISOSpeedRatings",
                       "ExposureTime", "ImageWidth", "ImageLength"):
                if isinstance(value, bytes):
                    try:
                        value = value.decode("utf-8", errors="replace")
                    except Exception:
                        value = str(value)
                exif_data[tag] = value
            elif tag == "GPSInfo":
                gps = {}
                for gps_id, gps_val in value.items():
                    gps_tag = GPSTAGS.get(gps_id, gps_id)
                    gps[gps_tag] = gps_val
                exif_data["GPSInfo"] = gps
    except Exception:
        pass
    return exif_data


def gps_to_decimal(gps_info):
    """Convert EXIF GPS to decimal lat/lon."""
    try:
        lat_ref = gps_info.get("GPSLatitudeRef", "N")
        lon_ref = gps_info.get("GPSLongitudeRef", "E")
        lat = gps_info["GPSLatitude"]
        lon = gps_info["GPSLongitude"]

        def to_dec(coords):
            d, m, s = [float(c) for c in coords]
            return d + m / 60 + s / 3600

        lat_dec = to_dec(lat) * (-1 if lat_ref == "S" else 1)
        lon_dec = to_dec(lon) * (-1 if lon_ref == "W" else 1)
        return {"lat": round(lat_dec, 6), "lon": round(lon_dec, 6)}
    except Exception:
        return None


def max_print_size(width, height, dpi):
    """Return max print dimensions in inches at given DPI."""
    return {
        "width_in": round(width / dpi, 1),
        "height_in": round(height / dpi, 1),
        "dpi": dpi,
    }


def generate_catalog_id(index):
    """A35-YYYYMMDD-XXXX"""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"A35-{today}-{index:04d}"


# ─── main ──────────────────────────────────────────────────────────
def scan(base_path, source_folder=None):
    """
    Scan images and classify them for licensing.

    Args:
        base_path: Path to 09_Licensing/ directory
        source_folder: Optional external folder to scan instead of originals/
                       (e.g., Photography/Large Scale Photography Stitch/)
    """
    base = Path(base_path)
    cfg = load_config(base)
    originals = Path(source_folder) if source_folder else base / "originals"
    metadata_dir = base / "metadata"
    catalog_path = base / "_catalog.json"

    if not originals.exists():
        sys.exit(f"ERROR: source folder not found at {originals}")

    # Load existing catalog
    catalog = {"version": "1.0", "last_updated": None, "images": []}
    if catalog_path.exists():
        with open(catalog_path) as f:
            catalog = json.load(f)

    existing_files = {img["original_filename"] for img in catalog["images"]}
    next_idx = len(catalog["images"]) + 1

    # ── Cross-reference guard ──────────────────────────────────────
    # Check gallery photos.json to avoid pulling portfolio images into licensing.
    # Images already on the website gallery should NOT be re-ingested here.
    gallery_filenames = set()
    gallery_json = base.parent / "data" / "photos.json"
    if gallery_json.exists():
        try:
            with open(gallery_json) as gf:
                gallery_data = json.load(gf)
            for photo in gallery_data.get("photos", []):
                # Gallery stores filename without extension
                fn = photo.get("filename", "")
                gallery_filenames.add(fn + ".jpg")
                gallery_filenames.add(fn + ".jpeg")
                gallery_filenames.add(fn + ".tif")
                gallery_filenames.add(fn + ".tiff")
                gallery_filenames.add(fn + ".png")
            print(f"  Gallery cross-ref loaded: {len(gallery_data.get('photos', []))} website photos")
        except Exception as e:
            print(f"  WARNING: Could not load gallery cross-ref: {e}")

    # Also check R2 bucket keys to avoid naming collisions
    # (handled at upload time, but good to flag early)

    files = sorted([
        f for f in originals.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXT
    ])

    new_count = 0
    skipped = 0
    below_min = 0
    gallery_dupes = 0

    for f in files:
        if f.name in existing_files:
            skipped += 1
            continue

        # Guard: skip images already in the website gallery
        if f.name in gallery_filenames:
            print(f"  ⚠ SKIP {f.name}: already in website gallery (use Gallery Ingest instead)")
            gallery_dupes += 1
            continue

        try:
            img = Image.open(f)
            width, height = img.size
        except Exception as e:
            print(f"  SKIP {f.name}: cannot open ({e})")
            continue

        classification = classify(width, cfg)
        if classification is None:
            print(f"  SKIP {f.name}: {width}x{height} below minimum 4000px")
            below_min += 1
            continue

        catalog_id = generate_catalog_id(next_idx)
        exif = extract_exif(img)
        gps = gps_to_decimal(exif.get("GPSInfo", {})) if "GPSInfo" in exif else None
        file_size = f.stat().st_size

        # Build metadata
        meta = {
            "catalog_id": catalog_id,
            "original_filename": f.name,
            "source_path": str(originals),  # where the original lives
            "title": "",  # user fills in later
            "description": "",
            "location": "",
            "classification": classification,
            "resolution": {"width": width, "height": height},
            "megapixels": round(width * height / 1_000_000, 1),
            "aspect_ratio": round(width / height, 3),
            "file_size_bytes": file_size,
            "file_size_mb": round(file_size / (1024 * 1024), 1),
            "color_space": img.mode,
            "format": img.format,
            "dpi": img.info.get("dpi", (300, 300)),
            "max_print_300dpi": max_print_size(width, height, 300),
            "max_print_150dpi": max_print_size(width, height, 150),
            "exif": {k: v for k, v in exif.items() if k != "GPSInfo"},
            "gps": gps,
            "pricing": cfg["pricing"],
            "license_count": 0,
            "licenses": [],
            "status": "available",
            "r2_keys": {
                "original": f"originals/{catalog_id}{f.suffix.lower()}",
                "preview": f"previews/{catalog_id}.jpg",
                "thumbnail": f"thumbnails/{catalog_id}.jpg",
            },
            "scanned_at": datetime.now(timezone.utc).isoformat(),
        }

        # Write per-image metadata
        meta_file = metadata_dir / f"{catalog_id}.json"
        with open(meta_file, "w") as mf:
            json.dump(meta, mf, indent=2, default=str)

        # Add to catalog (compact entry)
        catalog["images"].append({
            "catalog_id": catalog_id,
            "original_filename": f.name,
            "title": meta["title"],
            "classification": classification,
            "width": width,
            "height": height,
            "megapixels": meta["megapixels"],
            "file_size_mb": meta["file_size_mb"],
            "status": "available",
            "license_count": 0,
        })

        next_idx += 1
        new_count += 1
        badge = {"ULTRA": "🥇", "PREMIUM": "🥈", "STANDARD": "🥉"}[classification]
        print(f"  {badge} {catalog_id}  {classification:8s}  {width}x{height}  {meta['file_size_mb']}MB  {f.name}")

    # Save catalog
    catalog["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(catalog_path, "w") as cf:
        json.dump(catalog, cf, indent=2, default=str)

    if gallery_dupes > 0:
        print(f"\n⚠ {gallery_dupes} images skipped — already in website gallery (not licensing candidates)")
    print(f"\n✓ Scan complete: {new_count} new, {skipped} existing, {below_min} below minimum, {gallery_dupes} gallery dupes skipped")
    return catalog


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Scan and classify images for licensing")
    parser.add_argument("folder", nargs="?", default=os.path.dirname(os.path.abspath(__file__)),
                        help="Path to 09_Licensing directory")
    parser.add_argument("--source", help="External source folder (instead of originals/)")
    args = parser.parse_args()
    src = args.source or f"{args.folder}/originals"
    print(f"Scanning {src} ...")
    scan(args.folder, source_folder=args.source)
