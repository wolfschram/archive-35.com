"""Photo import pipeline for Archive-35.

Scans a directory for images, hashes them for dedup,
extracts EXIF data, resizes for API, and stores in the database.
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
from PIL.ExifTags import TAGS

from src.safety.audit import log as audit_log
from src.safety.ledger import can_execute, record_action

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}
MAX_EDGE = 1024  # Longest edge for API-ready resize


def _hash_file(path: Path) -> str:
    """Compute SHA256 hash of a file's contents."""
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()


def _extract_exif(img: Image.Image) -> dict:
    """Extract EXIF data from a PIL Image as a dict."""
    exif_data = {}
    raw_exif = img.getexif()
    if raw_exif:
        for tag_id, value in raw_exif.items():
            tag_name = TAGS.get(tag_id, str(tag_id))
            # Convert non-serializable types to strings
            try:
                json.dumps(value)
                exif_data[tag_name] = value
            except (TypeError, ValueError):
                exif_data[tag_name] = str(value)
    return exif_data


def _resize_for_api(img: Image.Image, max_edge: int = MAX_EDGE) -> Image.Image:
    """Resize image so longest edge is max_edge pixels.

    Returns original if already within bounds.
    """
    w, h = img.size
    if max(w, h) <= max_edge:
        return img

    if w >= h:
        new_w = max_edge
        new_h = int(h * (max_edge / w))
    else:
        new_h = max_edge
        new_w = int(w * (max_edge / h))

    return img.resize((new_w, new_h), Image.LANCZOS)


def _guess_collection(path: Path) -> Optional[str]:
    """Guess collection code from parent directory name.

    e.g., /photos/ICE/aurora.jpg → "ICE"
    """
    parent = path.parent.name.upper()
    if len(parent) <= 5 and parent.isalpha():
        return parent
    return None


def import_photo(
    conn: sqlite3.Connection,
    photo_path: Path,
    output_dir: Optional[Path] = None,
) -> Optional[str]:
    """Import a single photo into the database.

    Args:
        conn: Active database connection.
        photo_path: Path to the photo file.
        output_dir: Optional directory for resized copies.

    Returns:
        Photo ID (hash) if imported, None if skipped (duplicate).
    """
    if photo_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        logger.debug("Skipping unsupported file: %s", photo_path)
        return None

    # Hash for dedup
    file_hash = _hash_file(photo_path)

    # Check if already imported via ledger
    if not can_execute(conn, "import", "photos", file_hash):
        logger.debug("Skipping duplicate: %s", photo_path.name)
        return None

    # Open and process
    try:
        img = Image.open(photo_path)
        width, height = img.size
        exif = _extract_exif(img)
        collection = _guess_collection(photo_path)

        # Resize for API
        resized = _resize_for_api(img)
        if output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)
            resized.save(output_dir / photo_path.name, quality=90)

        now = datetime.now(timezone.utc).isoformat()

        # Insert into database
        conn.execute(
            """INSERT INTO photos
               (id, filename, path, imported_at, width, height,
                exif_json, collection)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                file_hash,
                photo_path.name,
                str(photo_path),
                now,
                width,
                height,
                json.dumps(exif) if exif else None,
                collection,
            ),
        )
        conn.commit()

        # Record in ledger
        record_action(conn, "import", "photos", file_hash)

        # Audit log
        audit_log(conn, "pipeline", "import_photo", {
            "filename": photo_path.name,
            "hash": file_hash,
            "size": f"{width}x{height}",
            "collection": collection,
        })

        logger.info("Imported: %s → %s", photo_path.name, file_hash[:12])
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
    """Import all supported photos from a directory.

    Args:
        conn: Active database connection.
        directory: Directory to scan for photos.
        output_dir: Optional directory for resized copies.

    Returns:
        List of imported photo IDs.
    """
    dir_path = Path(directory)
    if not dir_path.exists():
        logger.warning("Import directory does not exist: %s", dir_path)
        return []

    imported = []
    for photo_path in sorted(dir_path.rglob("*")):
        if photo_path.is_file():
            photo_id = import_photo(conn, photo_path, output_dir)
            if photo_id:
                imported.append(photo_id)

    logger.info("Imported %d photos from %s", len(imported), directory)
    return imported
