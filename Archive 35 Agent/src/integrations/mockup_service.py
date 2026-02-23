"""Mockup Service integration for Archive-35 Agent.

⚠️ PROTECTED FILE — Risk: HIGH
Dependencies: Mockup Service (localhost:8036), compositor.js, matcher.js
Side effects: Generates branded mockup images for social posting
Read first: CONSTRAINTS.md (ports), LESSONS_LEARNED.md #033
Consumers: social.py (posting pipeline), content.py (caption generation), api.py

Bridges the Agent's social posting pipeline with the Mockup Service.
Handles: mockup generation requests, batch processing, compatibility queries.

The Mockup Service runs on port 8036 and is started via Studio IPC.
This module communicates with it via HTTP to:
  1. Query photo-template compatibility (which photos fit which rooms)
  2. Generate branded mockups for specific platforms (Instagram, Pinterest, Etsy)
  3. Batch-generate social-ready mockups with Archive-35.com branding
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

MOCKUP_BASE = "http://localhost:8036"
DEFAULT_TIMEOUT = 60.0  # seconds — compositing can be slow


def is_available() -> bool:
    """Check if the Mockup Service is running and healthy."""
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{MOCKUP_BASE}/health")
            return resp.status_code == 200
    except Exception:
        return False


def get_compatibility_stats() -> dict:
    """Get photo-template compatibility statistics.

    Returns:
        Dict with totalPhotos, coverage, distribution, templateUtilization, etc.
    """
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(f"{MOCKUP_BASE}/match/stats")
        resp.raise_for_status()
        return resp.json()


def get_smart_pairs(
    max_per_photo: int = 2,
    fit_type: str = "good",
) -> list[dict]:
    """Get optimal photo-template pairs for batch generation.

    Args:
        max_per_photo: Maximum templates per photo (default 2).
        fit_type: Minimum fit quality: 'exact', 'good', 'stretched'.

    Returns:
        List of {photoId, photoPath, templateId, score, fitType} pairs.
    """
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            f"{MOCKUP_BASE}/match/pairs",
            params={"maxPerPhoto": max_per_photo, "fitType": fit_type},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("pairs", [])


def generate_social_mockup(
    template_id: str,
    photo_path: str,
    platform: str = "instagram",
    print_size: str = "24x36",
    skip_branding: bool = False,
) -> bytes:
    """Generate a single branded mockup for social posting.

    Args:
        template_id: Room template ID from templates.json.
        photo_path: Path to the art photo (absolute or relative to repo root).
        platform: Target platform (instagram, pinterest, etsy, web-full, web-thumb).
        print_size: Print size string (e.g., "24x36").
        skip_branding: If True, don't add Archive-35.com logo overlay.

    Returns:
        JPEG bytes of the branded mockup.
    """
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        resp = client.post(
            f"{MOCKUP_BASE}/preview/social",
            json={
                "templateId": template_id,
                "photoPath": photo_path,
                "platform": platform,
                "printSize": print_size,
                "skipBranding": skip_branding,
            },
        )
        resp.raise_for_status()
        return resp.content


def generate_social_batch(
    pairs: list[dict],
    platform: str = "instagram",
    output_dir: str = "mockups/social",
) -> dict:
    """Generate a batch of branded mockups for social posting.

    Args:
        pairs: List of {templateId, photoPath, printSize} dicts.
        platform: Target platform.
        output_dir: Directory to write output files (relative to repo root).

    Returns:
        Dict with totalPairs, succeeded, failed, results.
    """
    with httpx.Client(timeout=300.0) as client:  # 5 min for batches
        resp = client.post(
            f"{MOCKUP_BASE}/preview/social/batch",
            json={
                "pairs": pairs,
                "platform": platform,
                "outputDir": output_dir,
            },
        )
        resp.raise_for_status()
        return resp.json()


def refresh_compatibility_matrix() -> dict:
    """Force-refresh the cached compatibility matrix.

    Call this after adding new templates or photos.

    Returns:
        Dict with refreshed, photoCount, templateCount.
    """
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(f"{MOCKUP_BASE}/match/refresh")
        resp.raise_for_status()
        return resp.json()


def get_branding_config() -> dict:
    """Get current branding overlay configuration.

    Returns:
        Dict with logoExists, iconExists, platform configs.
    """
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(f"{MOCKUP_BASE}/branding/config")
        resp.raise_for_status()
        return resp.json()


# --- Database helpers for tracking mockup content ---

def save_mockup_content(
    conn: sqlite3.Connection,
    photo_id: str,
    template_id: str,
    platform: str,
    image_path: str,
    caption: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> str:
    """Save a generated mockup to the content queue for social posting.

    Creates a content row that the social posting agent can pick up.

    Args:
        conn: Active database connection.
        photo_id: Source photo identifier.
        template_id: Room template used.
        platform: Target platform (instagram, pinterest, etsy).
        image_path: Local path to the generated mockup JPEG.
        caption: Pre-generated caption (optional, can be generated later).
        tags: Hashtags/keywords for the post.

    Returns:
        Content ID of the saved entry.
    """
    content_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """INSERT OR IGNORE INTO mockup_content
           (id, photo_id, template_id, platform, image_path,
            caption, tags, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
        (
            content_id,
            photo_id,
            template_id,
            platform,
            image_path,
            caption,
            str(tags) if tags else None,
            now,
        ),
    )
    conn.commit()
    logger.info(
        "Saved mockup content %s for %s/%s → %s",
        content_id[:12], photo_id, template_id, platform,
    )
    return content_id


def ensure_mockup_tables(conn: sqlite3.Connection) -> None:
    """Create mockup-related database tables if they don't exist.

    Safe to call multiple times (uses IF NOT EXISTS).
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS mockup_content (
            id TEXT PRIMARY KEY,
            photo_id TEXT NOT NULL,
            template_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            image_path TEXT NOT NULL,
            caption TEXT,
            tags TEXT,
            status TEXT DEFAULT 'pending',
            posted_at TEXT,
            created_at TEXT NOT NULL,
            error TEXT
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_mockup_content_status
        ON mockup_content(status, platform)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_mockup_content_photo
        ON mockup_content(photo_id, template_id)
    """)
    conn.commit()
    logger.debug("Mockup content tables ensured")
