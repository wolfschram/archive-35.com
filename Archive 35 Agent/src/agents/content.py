"""Content Agent for Archive-35.

Generates platform-specific content (captions, descriptions, listings)
using Claude Sonnet. Creates 2-3 variants per platform with 48h expiry.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from src.safety.audit import log as audit_log
from src.safety.rate_limiter import check_limit, record_usage

logger = logging.getLogger(__name__)

PLATFORMS = ["pinterest", "instagram", "etsy"]
VARIANTS_PER_PLATFORM = 2
EXPIRY_HOURS = 48

# Platform-specific prompts
PLATFORM_PROMPTS = {
    "pinterest": """Write a Pinterest pin description for this fine art photograph.
Include: evocative description (2-3 sentences), 5 relevant hashtags.
Style: inspirational, aspirational, home-decor focused.
Output JSON: {"body": "...", "tags": ["tag1", "tag2", ...]}""",

    "instagram": """Write an Instagram caption for this fine art photograph.
Include: storytelling opener, emotional connection, call to action, 10 hashtags.
Style: authentic, artistic, conversational.
Output JSON: {"body": "...", "tags": ["tag1", "tag2", ...]}""",

    "etsy": """Write an Etsy listing description for this fine art photograph print.
Include: SEO-rich title, detailed description (print quality, paper, story),
13 tags optimized for Etsy search.
Output JSON: {"title": "...", "body": "...", "tags": ["tag1", ..., "tag13"]}""",
}


def _build_context(
    photo_row: sqlite3.Row,
    provenance: Optional[str] = None,
) -> str:
    """Build context string from photo metadata for the content prompt."""
    parts = []
    if photo_row["vision_tags"]:
        tags = json.loads(photo_row["vision_tags"])
        parts.append(f"Visual tags: {', '.join(tags)}")
    if photo_row["vision_mood"]:
        parts.append(f"Mood: {photo_row['vision_mood']}")
    if photo_row["vision_composition"]:
        parts.append(f"Composition: {photo_row['vision_composition']}")
    if photo_row["collection"]:
        parts.append(f"Collection: {photo_row['collection']}")
    if provenance:
        parts.append(f"Story: {provenance}")
    return "\n".join(parts)


def _parse_content_response(text: str) -> dict:
    """Parse JSON response from content generation."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[1:-1])

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Failed to parse content response as JSON")
        return {"body": text, "tags": []}


def generate_content(
    conn: sqlite3.Connection,
    photo_id: str,
    platform: str,
    provenance: Optional[str] = None,
    client: Optional[Any] = None,
    model: str = "claude-sonnet-4-5-20250929",
    variant: int = 1,
) -> Optional[str]:
    """Generate content for a single platform variant.

    Args:
        conn: Active database connection.
        photo_id: Photo ID to generate content for.
        platform: Target platform (pinterest, instagram, etsy).
        provenance: Optional brand story text.
        client: Anthropic client (None = create stub content).
        model: Claude model to use.
        variant: Variant number (1, 2, or 3).

    Returns:
        Content ID if created, None if failed.
    """
    # Get photo data
    photo = conn.execute(
        "SELECT * FROM photos WHERE id = ?",
        (photo_id,),
    ).fetchone()

    if not photo:
        logger.error("Photo %s not found", photo_id)
        return None

    # Build prompt context
    context = _build_context(photo, provenance)
    prompt = PLATFORM_PROMPTS.get(platform, PLATFORM_PROMPTS["pinterest"])
    full_prompt = f"Photo context:\n{context}\n\n{prompt}"

    body = ""
    tags_json = "[]"
    cost = 0.0

    if client and check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=5.0):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=1000,
                messages=[{"role": "user", "content": full_prompt}],
            )
            result = _parse_content_response(response.content[0].text)
            body = result.get("body", "")
            tags = result.get("tags", [])
            tags_json = json.dumps(tags)
            cost = 0.003  # Estimate for Sonnet
            record_usage(conn, "anthropic", cost_usd=cost)
        except Exception as e:
            logger.error("Content generation failed: %s", e)
            return None
    else:
        # Stub content for testing without API key
        body = f"[Stub] Beautiful {photo['vision_mood'] or 'fine art'} photograph"
        if photo["collection"]:
            body += f" from the {photo['collection']} collection"
        tags_list = json.loads(photo["vision_tags"]) if photo["vision_tags"] else ["fineart"]
        tags_json = json.dumps(tags_list[:13])

    # Create content record
    content_id = str(uuid4())
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=EXPIRY_HOURS)

    conn.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags,
            variant, status, created_at, expires_at, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
        (
            content_id,
            photo_id,
            platform,
            "listing" if platform == "etsy" else "caption",
            body,
            tags_json,
            variant,
            now.isoformat(),
            expires.isoformat(),
            provenance,
        ),
    )
    conn.commit()

    audit_log(conn, "content", "generate", {
        "content_id": content_id,
        "photo_id": photo_id,
        "platform": platform,
        "variant": variant,
        "has_api": client is not None,
    }, cost_usd=cost)

    logger.info("Generated %s content for %s (variant %d)", platform, photo_id[:12], variant)
    return content_id


def generate_all_platforms(
    conn: sqlite3.Connection,
    photo_id: str,
    provenance: Optional[str] = None,
    client: Optional[Any] = None,
    model: str = "claude-sonnet-4-5-20250929",
    platforms: Optional[list[str]] = None,
    variants: int = VARIANTS_PER_PLATFORM,
) -> list[str]:
    """Generate content for all platforms and variants.

    Args:
        conn: Active database connection.
        photo_id: Photo ID.
        provenance: Optional brand story.
        client: Anthropic client.
        model: Claude model.
        platforms: List of platforms (defaults to all).
        variants: Number of variants per platform.

    Returns:
        List of content IDs created.
    """
    target_platforms = platforms or PLATFORMS
    content_ids = []

    for platform in target_platforms:
        for v in range(1, variants + 1):
            cid = generate_content(
                conn, photo_id, platform, provenance, client, model, variant=v,
            )
            if cid:
                content_ids.append(cid)

    logger.info(
        "Generated %d content items for photo %s",
        len(content_ids),
        photo_id[:12],
    )
    return content_ids
