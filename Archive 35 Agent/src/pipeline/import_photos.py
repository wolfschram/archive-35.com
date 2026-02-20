"""Photo import pipeline for Archive-35.

Scans portfolio directories for original photos, hashes for dedup,
extracts EXIF data, and stores metadata references in the database.

Architecture:
- Photos stay in place (01_Portfolio/) — NO copies made
- Database stores absolute paths as references
- Collection = portfolio folder name (e.g., "Valley_of_Fire")
- Only imports from originals/ subfolder (skips web/ thumbs/full variants)
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

# Allow large panoramas — Wolf shoots 200M+ pixel panos
Image.MAX_IMAGE_PIXELS = 300_000_000

from src.safety.audit import log as audit_log
from src.safety.ledger import can_execute, record_action

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}

# Skip these files/patterns during import
SKIP_PATTERNS = {"-thumb.", "-full.", ".ds_store", "thumbs.db"}


def _hash_file(path: Path) -> str:
    """Compute SHA256 hash of a file's contents."""
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()


def _extract_exif(img: Image.Image) -> dict:
    """Extract FULL EXIF data from a PIL Image, including sub-IFDs.

    Uses _getexif() to get ALL tags including:
    - DateTimeOriginal (actual shot date, not Lightroom export date)
    - LensModel, LensMake
    - ISOSpeedRatings, FNumber, ExposureTime, FocalLength
    - GPSInfo (latitude, longitude)

    Falls back to getexif() if _getexif() unavailable.
    """
    exif_data = {}

    # _getexif() returns ALL tags including sub-IFDs in a flat dict
    try:
        raw = img._getexif()
    except (AttributeError, Exception):
        raw = None

    if not raw:
        # Fallback to basic getexif()
        basic = img.getexif()
        if basic:
            raw = dict(basic.items())

    if not raw:
        return exif_data

    for tag_id, value in raw.items():
        tag_name = TAGS.get(tag_id, str(tag_id))

        # Handle GPS sub-dict
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
            # Also extract lat/lon as top-level convenience fields
            try:
                lat_ref = gps.get("GPSLatitudeRef", "N")
                lon_ref = gps.get("GPSLongitudeRef", "E")
                lat_dms = gps.get("GPSLatitude")
                lon_dms = gps.get("GPSLongitude")
                if lat_dms and lon_dms:
                    lat = _dms_to_decimal(lat_dms, lat_ref)
                    lon = _dms_to_decimal(lon_dms, lon_ref)
                    if lat is not None and lon is not None:
                        exif_data["GPSLatitude"] = round(lat, 6)
                        exif_data["GPSLongitude"] = round(lon, 6)
            except Exception:
                pass
            continue

        # Skip large binary blobs
        if isinstance(value, bytes) and len(value) > 200:
            continue

        try:
            json.dumps(value)
            exif_data[tag_name] = value
        except (TypeError, ValueError):
            exif_data[tag_name] = str(value)

    return exif_data


def _dms_to_decimal(dms, ref: str) -> float | None:
    """Convert GPS DMS (degrees, minutes, seconds) to decimal degrees."""
    try:
        if isinstance(dms, (list, tuple)) and len(dms) == 3:
            d, m, s = [float(x) for x in dms]
            decimal = d + m / 60 + s / 3600
            if ref in ("S", "W"):
                decimal = -decimal
            return decimal
    except (ValueError, TypeError):
        pass
    return None


def _should_skip(path: Path) -> bool:
    """Check if file should be skipped (thumbs, web variants, system files)."""
    name_lower = path.name.lower()
    return any(pattern in name_lower for pattern in SKIP_PATTERNS)


def _get_collection_name(photo_path: Path, portfolio_root: Path) -> Optional[str]:
    """Get portfolio folder name as collection.

    Given: /Users/.../01_Portfolio/Valley_of_Fire/originals/IMG_001.jpg
    Returns: "Valley_of_Fire"

    Walks up from the photo to find the direct child of portfolio_root.
    """
    try:
        relative = photo_path.relative_to(portfolio_root)
        # First part of the relative path is the portfolio folder
        parts = relative.parts
        if len(parts) >= 2:
            return parts[0]
    except ValueError:
        pass
    return None


def import_photo(
    conn: sqlite3.Connection,
    photo_path: Path,
    collection: Optional[str] = None,
) -> Optional[str]:
    """Import a single photo into the database.

    Stores absolute path as reference — no copies made.

    Args:
        conn: Active database connection.
        photo_path: Path to the photo file.
        collection: Portfolio/collection name.

    Returns:
        Photo ID (hash) if imported, None if skipped (duplicate).
    """
    if photo_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        return None

    if _should_skip(photo_path):
        return None

    # Hash for dedup
    file_hash = _hash_file(photo_path)

    # Check if already imported — check DB directly AND ledger
    existing = conn.execute("SELECT id FROM photos WHERE id = ?", (file_hash,)).fetchone()
    if existing:
        logger.debug("Skipping duplicate (already in DB): %s", photo_path.name)
        return None
    if not can_execute(conn, "import", "photos", file_hash):
        logger.debug("Skipping duplicate (ledger): %s", photo_path.name)
        return None

    try:
        img = Image.open(photo_path)
        width, height = img.size
        exif = _extract_exif(img)

        # Store path relative to repo root for portability (Mac/VM)
        resolved = photo_path.resolve()
        # Try to make it relative to repo root (parent of Archive 35 Agent)
        repo_root = Path(__file__).resolve().parent.parent.parent.parent
        try:
            rel_path = str(resolved.relative_to(repo_root))
        except ValueError:
            rel_path = str(resolved)
        now = datetime.now(timezone.utc).isoformat()

        conn.execute(
            """INSERT INTO photos
               (id, filename, path, imported_at, width, height,
                exif_json, collection)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                file_hash,
                photo_path.name,
                rel_path,
                now,
                width,
                height,
                json.dumps(exif) if exif else None,
                collection,
            ),
        )
        conn.commit()

        record_action(conn, "import", "photos", file_hash)

        audit_log(conn, "pipeline", "import_photo", {
            "filename": photo_path.name,
            "hash": file_hash,
            "size": f"{width}x{height}",
            "collection": collection,
        })

        logger.info("Imported: %s [%s] → %s", photo_path.name, collection, file_hash[:12])
        return file_hash

    except Exception as e:
        logger.error("Failed to import %s: %s", photo_path.name, e)
        audit_log(conn, "pipeline", "import_photo_failed", {
            "filename": photo_path.name,
            "error": str(e),
        }, success=False)
        return None


def import_directory(
    conn: sqlite3.Connection,
    directory: str | Path,
    output_dir: Optional[Path] = None,
) -> list[str]:
    """Import original photos from portfolio directories.

    Expected structure:
        01_Portfolio/
            Valley_of_Fire/
                originals/   ← imports from here
                    IMG_001.jpg
                web/         ← skipped (these are generated derivatives)
                    IMG_001-thumb.jpg
                    IMG_001-full.jpg

    If a portfolio folder has no originals/ subfolder, imports directly
    from the portfolio folder (but still skips -thumb/-full variants).

    Args:
        conn: Active database connection.
        directory: Root portfolio directory (e.g., 01_Portfolio).

    Returns:
        List of imported photo IDs.
    """
    dir_path = Path(directory).resolve()
    if not dir_path.exists():
        logger.warning("Import directory does not exist: %s", dir_path)
        return []

    imported = []

    # Iterate portfolio folders (direct children of the root)
    for portfolio_dir in sorted(dir_path.iterdir()):
        if not portfolio_dir.is_dir():
            continue

        collection = portfolio_dir.name

        # Prefer originals/ subfolder, fall back to portfolio root
        originals_dir = portfolio_dir / "originals"
        scan_dir = originals_dir if originals_dir.exists() else portfolio_dir

        # Only scan files in this directory (not recursive into web/ etc.)
        # unless there's no originals folder, then we need to be selective
        if originals_dir.exists():
            # Scan only originals/ — these are the source-of-truth files
            scan_files = sorted(scan_dir.iterdir())
        else:
            # No originals/ folder — scan portfolio dir but skip web/ subfolder
            scan_files = sorted(
                f for f in portfolio_dir.rglob("*")
                if f.is_file() and "web" not in f.parts
            )

        for photo_path in scan_files:
            if not photo_path.is_file():
                continue
            photo_id = import_photo(conn, photo_path, collection=collection)
            if photo_id:
                imported.append(photo_id)

        if imported:
            logger.info("  %s: scanned %s", collection, scan_dir.name)

    logger.info("Imported %d photos from %s", len(imported), directory)
    return imported
