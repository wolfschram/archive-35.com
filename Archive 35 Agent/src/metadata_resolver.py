"""Archive-35 Unified Metadata Resolver.

Central metadata lookup for ALL export workflows (Etsy, CaFE, Instagram, etc.).
Checks sources in priority order, avoiding duplicate AI calls and token waste.

Resolution order (highest priority first):
  1. photos.json — Canonical, user-reviewed titles/descriptions/tags
  2. licensing-catalog.json — License-specific pricing and rights info
  3. Agent DB (photos table) — Vision analysis: mood, composition, marketability
  4. Agent DB (content_masters) — Previously generated platform content
  5. AI generation — Last resort, only for missing fields

Usage:
    from src.metadata_resolver import resolve_metadata

    meta = resolve_metadata("iceland-001", project_root=Path("/path/to/repo"))
    # Returns unified dict with all known fields + source tracking

⚠️ PROTECTED FILE — Risk: MEDIUM
Dependencies: photos.json, licensing-catalog.json, Agent DB
Side effects: None (read-only)
Read first: CLAUDE.md (metadata architecture section)
Consumers: cafe_export.py, etsy export, instagram, pinterest, compose
"""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

__all__ = ["resolve_metadata", "get_all_photo_ids", "get_photos_by_collection"]


def resolve_metadata(
    photo_id: str,
    project_root: Path,
    include_vision: bool = True,
    include_content: bool = False,
) -> dict:
    """Resolve all known metadata for a photo from every available source.

    Merges data from multiple sources in priority order. Later sources
    fill in missing fields but never overwrite existing values.

    Args:
        photo_id: Photo ID (e.g., "iceland-001", "tanzania-wolf-183")
        project_root: Archive-35.com repository root
        include_vision: Include Agent vision analysis (mood, composition, etc.)
        include_content: Include previously generated content_masters entries

    Returns:
        Unified metadata dict:
        {
          # From photos.json (Layer 1 — canonical)
          id, filename, title, description, location, tags, year,
          collection, collectionTitle, dimensions, thumbnail, full,

          # From licensing-catalog.json (Layer 1 — canonical)
          license_type, license_price, rights_info,

          # From Agent DB vision (Layer 2 — enrichment)
          mood, composition, marketability_score, vision_tags,

          # From Agent DB content_masters (Layer 2 — enrichment)
          etsy_title, etsy_description, instagram_caption,

          # Tracking
          _sources: list of source names that contributed data
          _resolved_at: ISO timestamp
        }

    Raises:
        ValueError: If photo not found in any source
    """
    from datetime import datetime, timezone

    merged = {"_sources": [], "_resolved_at": datetime.now(timezone.utc).isoformat()}

    # ── Layer 1: photos.json (canonical) ──
    photos_data = _load_from_photos_json(photo_id, project_root)
    if photos_data:
        _merge_into(merged, photos_data, "photos.json")

    # ── Layer 1: licensing-catalog.json ──
    licensing_data = _load_from_licensing_catalog(photo_id, project_root)
    if licensing_data:
        _merge_into(merged, licensing_data, "licensing-catalog")

    # ── Layer 2: Agent DB vision analysis ──
    if include_vision:
        vision_data = _load_from_agent_db_vision(photo_id, project_root)
        if vision_data:
            _merge_into(merged, vision_data, "agent-vision")

    # ── Layer 2: Agent DB content_masters ──
    if include_content:
        content_data = _load_from_agent_db_content(photo_id, project_root)
        if content_data:
            _merge_into(merged, content_data, "agent-content")

    # If we got nothing from any source, raise
    if not merged.get("_sources"):
        raise ValueError(f"Photo '{photo_id}' not found in any metadata source")

    # Ensure required fields have defaults
    merged.setdefault("id", photo_id)
    merged.setdefault("title", "Untitled")
    merged.setdefault("description", "")
    merged.setdefault("tags", [])
    merged.setdefault("year", None)
    merged.setdefault("collection", "")

    return merged


def get_all_photo_ids(project_root: Path) -> list[str]:
    """Return all photo IDs from photos.json."""
    photos_json = project_root / "data" / "photos.json"
    if not photos_json.exists():
        return []
    try:
        with open(photos_json) as f:
            data = json.load(f)
        return [p["id"] for p in data.get("photos", []) if "id" in p]
    except Exception as e:
        logger.warning("Failed to load photos.json: %s", e)
        return []


def get_photos_by_collection(project_root: Path, collection: str) -> list[dict]:
    """Return all photos from a specific collection."""
    photos_json = project_root / "data" / "photos.json"
    if not photos_json.exists():
        return []
    try:
        with open(photos_json) as f:
            data = json.load(f)
        return [p for p in data.get("photos", []) if p.get("collection") == collection]
    except Exception as e:
        logger.warning("Failed to load photos.json: %s", e)
        return []


# ── Private Source Loaders ────────────────────────────────────────


def _load_from_photos_json(photo_id: str, project_root: Path) -> Optional[dict]:
    """Load photo metadata from data/photos.json (canonical source)."""
    photos_json = project_root / "data" / "photos.json"
    if not photos_json.exists():
        # Try _site fallback
        photos_json = project_root / "_site" / "data" / "photos.json"

    if not photos_json.exists():
        return None

    try:
        with open(photos_json) as f:
            data = json.load(f)

        for photo in data.get("photos", []):
            if photo.get("id") == photo_id:
                return photo

    except Exception as e:
        logger.warning("Failed to read photos.json: %s", e)

    return None


def _load_from_licensing_catalog(photo_id: str, project_root: Path) -> Optional[dict]:
    """Load licensing metadata from data/licensing-catalog.json."""
    catalog_path = project_root / "data" / "licensing-catalog.json"
    if not catalog_path.exists():
        return None

    try:
        with open(catalog_path) as f:
            data = json.load(f)

        for photo in data.get("photos", []):
            if photo.get("id") == photo_id:
                # Map licensing-specific fields
                return {
                    "license_type": photo.get("license_type"),
                    "license_price": photo.get("price"),
                    "rights_info": photo.get("rights"),
                }

    except Exception as e:
        logger.warning("Failed to read licensing-catalog.json: %s", e)

    return None


def _load_from_agent_db_vision(photo_id: str, project_root: Path) -> Optional[dict]:
    """Load vision analysis from Agent SQLite DB."""
    db_path = project_root / "Archive 35 Agent" / "data" / "archive35.db"
    if not db_path.exists():
        return None

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute(
            """SELECT vision_mood, vision_composition, vision_marketability,
                      vision_tags, suggested_title
               FROM photos WHERE photo_id = ? LIMIT 1""",
            (photo_id,),
        )
        row = cursor.fetchone()
        conn.close()

        if row:
            vision_tags = []
            if row["vision_tags"]:
                try:
                    vision_tags = json.loads(row["vision_tags"])
                except (json.JSONDecodeError, TypeError):
                    vision_tags = [t.strip() for t in row["vision_tags"].split(",") if t.strip()]

            return {
                "mood": row["vision_mood"],
                "composition": row["vision_composition"],
                "marketability_score": row["vision_marketability"],
                "vision_tags": vision_tags,
                "suggested_title": row["suggested_title"],
            }

    except Exception as e:
        logger.debug("Agent DB vision lookup failed for %s: %s", photo_id, e)

    return None


def _load_from_agent_db_content(photo_id: str, project_root: Path) -> Optional[dict]:
    """Load previously generated content from Agent content_masters table."""
    db_path = project_root / "Archive 35 Agent" / "data" / "archive35.db"
    if not db_path.exists():
        return None

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute(
            """SELECT platform, title, body, tags
               FROM content_masters WHERE photo_id = ?
               ORDER BY created_at DESC""",
            (photo_id,),
        )
        rows = cursor.fetchall()
        conn.close()

        if rows:
            result = {}
            for row in rows:
                platform = row["platform"]
                prefix = platform.lower().replace(" ", "_")
                result[f"{prefix}_title"] = row["title"]
                result[f"{prefix}_body"] = row["body"]
                if row["tags"]:
                    try:
                        result[f"{prefix}_tags"] = json.loads(row["tags"])
                    except (json.JSONDecodeError, TypeError):
                        result[f"{prefix}_tags"] = row["tags"]
            return result

    except Exception as e:
        logger.debug("Agent DB content lookup failed for %s: %s", photo_id, e)

    return None


def _merge_into(target: dict, source: dict, source_name: str) -> None:
    """Merge source fields into target, only adding missing keys.

    This preserves priority ordering — earlier sources win.
    Internal keys (starting with _) from source are skipped.

    Args:
        target: Destination dict (modified in place)
        source: Source dict to merge from
        source_name: Name of this source (for tracking)
    """
    added = False
    for key, value in source.items():
        if key.startswith("_"):
            continue
        if value is None:
            continue
        if key not in target:
            target[key] = value
            added = True

    if added:
        target["_sources"].append(source_name)
