"""Re-extract full EXIF from photography/ source images and update the DB.

Fixes the initial import which only captured basic IFD0 tags (missing
DateTimeOriginal, LensModel, ISO, GPS, etc.)

Run from Agent root:
    python3 scripts/reextract_exif.py
"""

import json
import sqlite3
import sys
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

PHOTOGRAPHY_DIR = Path(__file__).parent.parent.parent / "photography"
DB_PATH = Path(__file__).parent.parent / "data" / "archive35.db"


def dms_to_decimal(dms, ref):
    try:
        if isinstance(dms, (list, tuple)) and len(dms) == 3:
            d, m, s = [float(x) for x in dms]
            decimal = d + m / 60 + s / 3600
            if ref in ("S", "W"):
                decimal = -decimal
            return round(decimal, 6)
    except (ValueError, TypeError):
        pass
    return None


def extract_full_exif(img_path):
    """Extract full EXIF including sub-IFDs."""
    try:
        img = Image.open(img_path)
    except Exception as e:
        return None, str(e)

    exif_data = {}
    try:
        raw = img._getexif()
    except Exception:
        raw = None

    if not raw:
        return exif_data, None

    for tag_id, value in raw.items():
        tag_name = TAGS.get(tag_id, str(tag_id))

        if tag_name == "GPSInfo" and isinstance(value, dict):
            gps = {}
            for gps_id, gps_val in value.items():
                gps_tag = GPSTAGS.get(gps_id, str(gps_id))
                try:
                    json.dumps(gps_val)
                    gps[gps_tag] = gps_val
                except (TypeError, ValueError):
                    gps[gps_tag] = str(gps_val)
            exif_data["GPSInfo"] = gps
            try:
                lat_ref = gps.get("GPSLatitudeRef", "N")
                lon_ref = gps.get("GPSLongitudeRef", "E")
                lat_dms = gps.get("GPSLatitude")
                lon_dms = gps.get("GPSLongitude")
                if lat_dms and lon_dms:
                    lat = dms_to_decimal(lat_dms, lat_ref)
                    lon = dms_to_decimal(lon_dms, lon_ref)
                    if lat is not None:
                        exif_data["GPSLatitude"] = lat
                    if lon is not None:
                        exif_data["GPSLongitude"] = lon
            except Exception:
                pass
            continue

        if isinstance(value, bytes) and len(value) > 200:
            continue

        try:
            json.dumps(value)
            exif_data[tag_name] = value
        except (TypeError, ValueError):
            exif_data[tag_name] = str(value)

    return exif_data, None


def main():
    if not PHOTOGRAPHY_DIR.exists():
        print(f"ERROR: photography/ not found at {PHOTOGRAPHY_DIR}")
        sys.exit(1)

    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row

    # Get all photos from DB
    photos = db.execute("SELECT id, filename, path, collection FROM photos").fetchall()
    print(f"Found {len(photos)} photos in DB")

    updated = 0
    errors = 0
    no_match = 0
    had_original = 0
    gained_fields = {"DateTimeOriginal": 0, "LensModel": 0, "ISOSpeedRatings": 0, "GPSLatitude": 0}

    for photo in photos:
        filename = photo["filename"]
        collection = photo["collection"] or ""

        # Try to find the file in photography/
        # Collection names in DB may have trailing _ or different casing
        found_path = None
        for gallery_dir in PHOTOGRAPHY_DIR.iterdir():
            if not gallery_dir.is_dir():
                continue
            candidate = gallery_dir / filename
            if candidate.exists():
                found_path = candidate
                break

        if not found_path:
            no_match += 1
            continue

        # Extract full EXIF
        exif, err = extract_full_exif(found_path)
        if err:
            errors += 1
            continue

        if not exif:
            continue

        # Check what we gained
        old_exif_str = photo["path"]  # Not useful, let's check DB
        old_exif_row = db.execute("SELECT exif_json FROM photos WHERE id = ?", (photo["id"],)).fetchone()
        old_exif = json.loads(old_exif_row["exif_json"]) if old_exif_row and old_exif_row["exif_json"] else {}

        for field in gained_fields:
            if field in exif and field not in old_exif:
                gained_fields[field] += 1

        if "DateTimeOriginal" in exif:
            had_original += 1

        # Also update the path to point to photography/ source
        new_path = str(found_path.resolve())

        # Update DB
        db.execute(
            "UPDATE photos SET exif_json = ?, path = ? WHERE id = ?",
            (json.dumps(exif), new_path, photo["id"]),
        )
        updated += 1

    db.commit()
    db.close()

    print(f"\nResults:")
    print(f"  Updated: {updated}")
    print(f"  Errors:  {errors}")
    print(f"  No file: {no_match}")
    print(f"  Has DateTimeOriginal: {had_original}")
    print(f"\nNew fields gained:")
    for field, count in gained_fields.items():
        print(f"  {field}: +{count} photos")


if __name__ == "__main__":
    main()
