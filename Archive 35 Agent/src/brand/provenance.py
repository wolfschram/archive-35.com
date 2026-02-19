"""Provenance generator for Archive-35.

Creates 2-3 sentence brand stories from EXIF data and collection context.
Each photo gets a unique narrative connecting the image to Wolf's journey.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Story bank: collection code → context snippets
STORY_BANK = {
    "ICE": {
        "location": "Iceland",
        "memories": [
            "Captured during a winter expedition across Iceland's volcanic landscape",
            "Found along the Diamond Beach where glacial ice meets black sand",
            "Discovered on a midnight drive through Iceland's highland interior",
        ],
    },
    "TOK": {
        "location": "Tokyo",
        "memories": [
            "Shot in the neon-lit corridors of Shinjuku after midnight",
            "Captured during the cherry blossom season in Tokyo's hidden gardens",
            "Found in the quiet backstreets of Yanaka, old Tokyo's last neighborhood",
        ],
    },
    "LON": {
        "location": "London",
        "memories": [
            "Captured along the South Bank during a winter fog",
            "Found in the early morning light of Borough Market",
            "Shot from the Millennium Bridge at golden hour",
        ],
    },
    "NYC": {
        "location": "New York",
        "memories": [
            "Captured from a Brooklyn rooftop at sunset",
            "Found in the early morning calm of Central Park",
            "Shot through the steam rising from Manhattan's streets",
        ],
    },
    "BER": {
        "location": "Berlin",
        "memories": [
            "Captured along the remnants of the Wall in winter light",
            "Found in the industrial beauty of Kreuzberg's canal district",
            "Shot during a quiet Sunday morning at Tempelhof Field",
        ],
    },
}

# Generic stories for unknown collections
GENERIC_MEMORIES = [
    "Captured during one of Wolf's journeys across 55+ countries",
    "Found in that fleeting moment when light and place align",
    "Discovered on an expedition driven by the restless eye",
]


def _extract_location_from_exif(exif: dict) -> Optional[str]:
    """Try to extract a location description from EXIF GPS data."""
    gps = exif.get("GPSInfo")
    if not gps:
        return None
    # GPS data is complex — just note that it exists
    return "with original GPS coordinates preserved"


def _extract_camera_from_exif(exif: dict) -> Optional[str]:
    """Extract camera model from EXIF."""
    make = exif.get("Make", "")
    model = exif.get("Model", "")
    if model:
        return f"{make} {model}".strip()
    return None


def _extract_date_from_exif(exif: dict) -> Optional[str]:
    """Extract capture date from EXIF."""
    date_str = exif.get("DateTime") or exif.get("DateTimeOriginal")
    if date_str and isinstance(date_str, str):
        # Format: "2024:01:15 14:30:00" → "January 2024"
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


def generate_provenance(
    exif_json: Optional[str] = None,
    collection: Optional[str] = None,
    vision_mood: Optional[str] = None,
    vision_tags: Optional[str] = None,
) -> str:
    """Generate a 2-3 sentence brand story for a photograph.

    Args:
        exif_json: Raw EXIF data as JSON string.
        collection: Collection code (e.g., "ICE", "TOK").
        vision_mood: Mood from vision analysis.
        vision_tags: Tags from vision analysis as JSON string.

    Returns:
        A provenance story string (2-3 sentences).
    """
    exif = json.loads(exif_json) if exif_json else {}

    # Get collection-specific context
    collection_upper = (collection or "").upper()
    story_data = STORY_BANK.get(collection_upper)

    # Build the story
    parts = []

    # Opening: collection-specific or generic memory
    if story_data:
        import random
        memory = random.choice(story_data["memories"])
        parts.append(memory + ".")
    else:
        import random
        parts.append(random.choice(GENERIC_MEMORIES) + ".")

    # Middle: camera and date context
    camera = _extract_camera_from_exif(exif)
    date = _extract_date_from_exif(exif)
    if camera and date:
        parts.append(f"Shot on {camera} in {date}.")
    elif camera:
        parts.append(f"Shot on {camera}.")
    elif date:
        parts.append(f"Captured in {date}.")

    # Closing: mood and artistic intent
    if vision_mood:
        mood_closings = {
            "serene": "A meditation on stillness and light.",
            "dramatic": "Raw energy frozen in a single frame.",
            "contemplative": "An invitation to pause and reflect.",
            "moody": "Where shadow meets emotion.",
            "vibrant": "Life captured at its most vivid.",
            "melancholic": "Beauty found in quiet solitude.",
            "ethereal": "A moment suspended between reality and dream.",
        }
        closing = mood_closings.get(
            vision_mood.lower(),
            f"A {vision_mood} moment from The Restless Eye collection.",
        )
        parts.append(closing)
    else:
        parts.append("Part of The Restless Eye collection by Wolf.")

    return " ".join(parts)
