"""Provenance generator for Archive-35.

Creates short, factual brand context from EXIF data and collection name.
NEVER fabricates stories, memories, or artistic descriptions — only uses
real metadata that exists in the photo.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _extract_camera_from_exif(exif: dict) -> Optional[str]:
    """Extract camera model from EXIF."""
    model = exif.get("Model", "")
    if model:
        # Clean up — remove redundant make prefix if model already includes it
        make = exif.get("Make", "")
        if make and model.startswith(make):
            return model.strip()
        if make:
            return f"{make} {model}".strip()
        return model.strip()
    return None


def _extract_date_from_exif(exif: dict) -> Optional[str]:
    """Extract capture date from EXIF — DateTimeOriginal FIRST, then DateTime."""
    # CRITICAL: DateTimeOriginal = actual shot date
    # DateTime = last modified (often Lightroom export date)
    date_str = exif.get("DateTimeOriginal") or exif.get("DateTime")
    if date_str and isinstance(date_str, str):
        try:
            parts = date_str.split(" ")[0].split(":")
            year = parts[0]
            month_num = int(parts[1])
            months = [
                "", "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
            ]
            return f"{months[month_num]} {year}"
        except (IndexError, ValueError):
            pass
    return None


def _extract_lens_from_exif(exif: dict) -> Optional[str]:
    """Extract lens model from EXIF."""
    lens = exif.get("LensModel", "")
    return lens.strip() if lens else None


def generate_provenance(
    exif_json: Optional[str] = None,
    collection: Optional[str] = None,
    vision_mood: Optional[str] = None,
    vision_tags: Optional[str] = None,
) -> str:
    """Generate a factual provenance string from real photo metadata.

    Only includes information that actually exists in the EXIF data.
    Never fabricates stories, expeditions, or artistic descriptions.

    Args:
        exif_json: Raw EXIF data as JSON string.
        collection: Collection/gallery name (e.g., "Iceland", "Tanzania").
        vision_mood: Mood from vision analysis.
        vision_tags: Tags from vision analysis as JSON string.

    Returns:
        A factual provenance string.
    """
    exif = json.loads(exif_json) if exif_json else {}
    parts = []

    # Collection name (use as-is — it's the gallery folder name)
    if collection:
        # Clean up underscores and capitalize nicely
        clean_name = collection.replace("_", " ").strip()
        parts.append(f"From the {clean_name} collection.")

    # Camera + lens
    camera = _extract_camera_from_exif(exif)
    lens = _extract_lens_from_exif(exif)
    if camera and lens:
        parts.append(f"Shot on {camera} with {lens}.")
    elif camera:
        parts.append(f"Shot on {camera}.")

    # Date — only the real shot date
    date = _extract_date_from_exif(exif)
    if date:
        parts.append(f"Captured {date}.")

    # Attribution
    parts.append("Fine art photography by Wolf Schram — archive-35.com.")

    return " ".join(parts)
