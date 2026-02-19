"""Content Variation Engine for Archive-35.

Allows Wolf to create variations of existing approved content without
generating entirely new content from scratch. Supports: platform adaptation,
copy refresh, A/B test variants, and seasonal adjustments.

Uses Claude for intelligent rewrites while maintaining image/message intent.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from src.safety.audit import log as audit_log
from src.safety.kill_switch import is_active as is_kill_switch_active
from src.safety.rate_limiter import check_limit, record_usage

logger = logging.getLogger(__name__)

# Platform-specific style guides for adaptation
PLATFORM_STYLES = {
    "pinterest": "inspirational, aspirational, home-decor focused, evocative",
    "instagram": "authentic, artistic, conversational, storytelling-driven",
    "etsy": "SEO-optimized, detailed, product-focused, practical benefits",
    "shopify": "conversion-focused, benefit-driven, urgency-aware, trust-building",
}

PLATFORM_LENGTHS = {
    "pinterest": {"body": 150, "tags": 5},
    "instagram": {"body": 300, "tags": 10},
    "etsy": {"body": 500, "tags": 13},
    "shopify": {"body": 200, "tags": 8},
}


def _get_content_by_id(
    conn: sqlite3.Connection,
    content_id: str,
) -> Optional[sqlite3.Row]:
    """Fetch a content record by ID."""
    return conn.execute(
        "SELECT * FROM content WHERE id = ?",
        (content_id,),
    ).fetchone()


def _get_photo_context(
    conn: sqlite3.Connection,
    photo_id: str,
) -> str:
    """Build context string from photo metadata."""
    photo = conn.execute(
        "SELECT * FROM photos WHERE id = ?",
        (photo_id,),
    ).fetchone()

    if not photo:
        return ""

    parts = []
    if photo["vision_tags"]:
        tags = json.loads(photo["vision_tags"])
        parts.append(f"Visual tags: {', '.join(tags)}")
    if photo["vision_mood"]:
        parts.append(f"Mood: {photo['vision_mood']}")
    if photo["vision_composition"]:
        parts.append(f"Composition: {photo['vision_composition']}")
    if photo["collection"]:
        parts.append(f"Collection: {photo['collection']}")

    return "\n".join(parts)


def _parse_variation_response(text: str) -> dict:
    """Parse JSON response from variation generation."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[1:-1])

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Failed to parse variation response as JSON")
        return {"body": text, "tags": []}


def create_variation(
    conn: sqlite3.Connection,
    content_id: str,
    changes: Optional[dict[str, Any]] = None,
    client: Optional[Any] = None,
) -> Optional[str]:
    """Create a variation of existing content with optional overrides.

    Args:
        conn: Active database connection.
        content_id: ID of the content to vary.
        changes: Dict with optional keys: title, body, tags, platform.
        client: Anthropic client for Claude calls.

    Returns:
        New content ID if successful, None otherwise.
    """
    if is_kill_switch_active(conn, "global"):
        logger.warning("Variation creation blocked by global kill switch")
        return None

    original = _get_content_by_id(conn, content_id)
    if not original:
        logger.error("Content %s not found", content_id)
        return None

    changes = changes or {}
    now = datetime.now(timezone.utc)

    # Use provided values or fall back to original
    new_body = changes.get("body", original["body"])
    new_platform = changes.get("platform", original["platform"])
    new_tags = changes.get("tags", original["tags"])

    variation_id = str(uuid4())
    expires = now + __import__("datetime").timedelta(hours=48)

    conn.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags,
            variant, status, created_at, expires_at, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
        (
            variation_id,
            original["photo_id"],
            new_platform,
            original["content_type"],
            new_body,
            new_tags,
            (original["variant"] or 1) + 1,
            now.isoformat(),
            expires.isoformat(),
            original["provenance"],
        ),
    )
    conn.commit()

    audit_log(conn, "variations", "create_variation", {
        "variation_id": variation_id,
        "source_content_id": content_id,
        "platform_changed": new_platform != original["platform"],
        "body_changed": new_body != original["body"],
    })

    logger.info("Created variation %s from content %s", variation_id[:12], content_id[:12])
    return variation_id


def adapt_platform(
    conn: sqlite3.Connection,
    content_id: str,
    target_platform: str,
    client: Optional[Any] = None,
    model: str = "claude-sonnet-4-5-20250929",
) -> Optional[str]:
    """Convert content from one platform to another.

    Uses Claude to rewrite caption for new platform's style and constraints.

    Args:
        conn: Active database connection.
        content_id: ID of content to adapt.
        target_platform: Target platform (pinterest, instagram, etsy, shopify).
        client: Anthropic client.
        model: Claude model to use.

    Returns:
        New content ID if successful, None otherwise.
    """
    if is_kill_switch_active(conn, "global"):
        logger.warning("Platform adaptation blocked by global kill switch")
        return None

    original = _get_content_by_id(conn, content_id)
    if not original:
        logger.error("Content %s not found", content_id)
        return None

    photo_context = _get_photo_context(conn, original["photo_id"])
    source_style = PLATFORM_STYLES.get(original["platform"], "professional")
    target_style = PLATFORM_STYLES.get(target_platform, "professional")
    target_length = PLATFORM_LENGTHS.get(target_platform, {}).get("body", 200)

    prompt = f"""Adapt this content from {original["platform"]} to {target_platform}.

Original content (style: {source_style}):
{original["body"]}

Photo context:
{photo_context}

Rewrite for {target_platform} style: {target_style}
Target body length: ~{target_length} words
Keep the same message intent and emotional core.
Output JSON: {{"body": "...", "tags": ["tag1", "tag2", ...]}}"""

    body = original["body"]
    tags = original["tags"]
    cost = 0.0

    if client and check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=5.0):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            result = _parse_variation_response(response.content[0].text)
            body = result.get("body", original["body"])
            tags_list = result.get("tags", [])
            tags = json.dumps(tags_list)
            cost = 0.003
            record_usage(conn, "anthropic", cost_usd=cost)
        except Exception as e:
            logger.error("Platform adaptation failed: %s", e)
            return None

    variation_id = str(uuid4())
    now = datetime.now(timezone.utc)
    expires = now + __import__("datetime").timedelta(hours=48)

    conn.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags,
            variant, status, created_at, expires_at, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
        (
            variation_id,
            original["photo_id"],
            target_platform,
            original["content_type"],
            body,
            tags,
            2,
            now.isoformat(),
            expires.isoformat(),
            original["provenance"],
        ),
    )
    conn.commit()

    audit_log(conn, "variations", "adapt_platform", {
        "variation_id": variation_id,
        "source_content_id": content_id,
        "source_platform": original["platform"],
        "target_platform": target_platform,
        "has_api": client is not None,
    }, cost_usd=cost)

    logger.info("Adapted %s from %s to %s", content_id[:12], original["platform"], target_platform)
    return variation_id


def refresh_copy(
    conn: sqlite3.Connection,
    content_id: str,
    client: Optional[Any] = None,
    model: str = "claude-sonnet-4-5-20250929",
) -> Optional[str]:
    """Rewrite caption to feel fresh while keeping intent and photo same.

    Args:
        conn: Active database connection.
        content_id: ID of content to refresh.
        client: Anthropic client.
        model: Claude model to use.

    Returns:
        New content ID if successful, None otherwise.
    """
    if is_kill_switch_active(conn, "global"):
        logger.warning("Copy refresh blocked by global kill switch")
        return None

    original = _get_content_by_id(conn, content_id)
    if not original:
        logger.error("Content %s not found", content_id)
        return None

    photo_context = _get_photo_context(conn, original["photo_id"])

    prompt = f"""Rewrite this {original["platform"]} caption to feel fresh and different,
but keep the same core message and emotional intent. Use different words, structure, and hooks.

Original:
{original["body"]}

Photo context:
{photo_context}

Rewrite as a fresh variation (same platform, same style).
Output JSON: {{"body": "...", "tags": ["tag1", "tag2", ...]}}"""

    body = original["body"]
    tags = original["tags"]
    cost = 0.0

    if client and check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=5.0):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            result = _parse_variation_response(response.content[0].text)
            body = result.get("body", original["body"])
            tags_list = result.get("tags", [])
            tags = json.dumps(tags_list)
            cost = 0.003
            record_usage(conn, "anthropic", cost_usd=cost)
        except Exception as e:
            logger.error("Copy refresh failed: %s", e)
            return None

    variation_id = str(uuid4())
    now = datetime.now(timezone.utc)
    expires = now + __import__("datetime").timedelta(hours=48)

    conn.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags,
            variant, status, created_at, expires_at, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
        (
            variation_id,
            original["photo_id"],
            original["platform"],
            original["content_type"],
            body,
            tags,
            (original["variant"] or 1) + 1,
            now.isoformat(),
            expires.isoformat(),
            original["provenance"],
        ),
    )
    conn.commit()

    audit_log(conn, "variations", "refresh_copy", {
        "variation_id": variation_id,
        "source_content_id": content_id,
        "platform": original["platform"],
        "has_api": client is not None,
    }, cost_usd=cost)

    logger.info("Refreshed copy for content %s", content_id[:12])
    return variation_id


def generate_ab_variants(
    conn: sqlite3.Connection,
    content_id: str,
    count: int = 2,
    client: Optional[Any] = None,
    model: str = "claude-sonnet-4-5-20250929",
) -> list[str]:
    """Generate A/B test variants with different hooks/angles.

    Args:
        conn: Active database connection.
        content_id: ID of content to generate variants from.
        count: Number of variants to create (default 2 for A/B).
        client: Anthropic client.
        model: Claude model to use.

    Returns:
        List of new content IDs created.
    """
    if is_kill_switch_active(conn, "global"):
        logger.warning("A/B variant generation blocked by global kill switch")
        return []

    original = _get_content_by_id(conn, content_id)
    if not original:
        logger.error("Content %s not found", content_id)
        return []

    photo_context = _get_photo_context(conn, original["photo_id"])
    variant_ids = []
    total_cost = 0.0

    hooks = [
        "emotional and storytelling-focused hook",
        "practical benefits and value-focused hook",
        "curiosity-driven and attention-grabbing hook",
    ][:count]

    for idx, hook_style in enumerate(hooks, 1):
        prompt = f"""Create a {original["platform"]} caption variation with a {hook_style}.

Original caption:
{original["body"]}

Photo context:
{photo_context}

Generate a fresh variation that leads with {hook_style}.
Keep the same platform style and message intent.
Output JSON: {{"body": "...", "tags": ["tag1", "tag2", ...]}}"""

        body = original["body"]
        tags = original["tags"]
        cost = 0.0

        if client and check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=5.0):
            try:
                response = client.messages.create(
                    model=model,
                    max_tokens=1000,
                    messages=[{"role": "user", "content": prompt}],
                )
                result = _parse_variation_response(response.content[0].text)
                body = result.get("body", original["body"])
                tags_list = result.get("tags", [])
                tags = json.dumps(tags_list)
                cost = 0.003
                record_usage(conn, "anthropic", cost_usd=cost)
                total_cost += cost
            except Exception as e:
                logger.error("A/B variant generation failed for variant %d: %s", idx, e)
                continue

        variation_id = str(uuid4())
        now = datetime.now(timezone.utc)
        expires = now + __import__("datetime").timedelta(hours=48)

        conn.execute(
            """INSERT INTO content
               (id, photo_id, platform, content_type, body, tags,
                variant, status, created_at, expires_at, provenance)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
            (
                variation_id,
                original["photo_id"],
                original["platform"],
                original["content_type"],
                body,
                tags,
                100 + idx,
                now.isoformat(),
                expires.isoformat(),
                original["provenance"],
            ),
        )
        conn.commit()
        variant_ids.append(variation_id)

    if variant_ids:
        audit_log(conn, "variations", "generate_ab_variants", {
            "variation_ids": variant_ids,
            "source_content_id": content_id,
            "count": len(variant_ids),
            "platform": original["platform"],
        }, cost_usd=total_cost)
        logger.info("Generated %d A/B variants for content %s", len(variant_ids), content_id[:12])

    return variant_ids


def suggest_seasonal(
    conn: sqlite3.Connection,
    content_id: str,
    season_or_event: str,
    client: Optional[Any] = None,
    model: str = "claude-sonnet-4-5-20250929",
) -> Optional[str]:
    """Adjust content for seasonal context (e.g., "winter vibes", "holiday gift guide").

    Args:
        conn: Active database connection.
        content_id: ID of content to adjust.
        season_or_event: Seasonal context (e.g., "winter", "Black Friday", "Valentine's Day").
        client: Anthropic client.
        model: Claude model to use.

    Returns:
        New content ID if successful, None otherwise.
    """
    if is_kill_switch_active(conn, "global"):
        logger.warning("Seasonal adjustment blocked by global kill switch")
        return None

    original = _get_content_by_id(conn, content_id)
    if not original:
        logger.error("Content %s not found", content_id)
        return None

    photo_context = _get_photo_context(conn, original["photo_id"])

    prompt = f"""Adapt this {original["platform"]} caption for {season_or_event} context.

Original caption:
{original["body"]}

Photo context:
{photo_context}

Rewrite to emphasize {season_or_event} themes and relevance while keeping the core image and message intact.
Make it feel timely and relevant to the season/event.
Output JSON: {{"body": "...", "tags": ["tag1", "tag2", ...]}}"""

    body = original["body"]
    tags = original["tags"]
    cost = 0.0

    if client and check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=5.0):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            result = _parse_variation_response(response.content[0].text)
            body = result.get("body", original["body"])
            tags_list = result.get("tags", [])
            tags = json.dumps(tags_list)
            cost = 0.003
            record_usage(conn, "anthropic", cost_usd=cost)
        except Exception as e:
            logger.error("Seasonal adjustment failed: %s", e)
            return None

    variation_id = str(uuid4())
    now = datetime.now(timezone.utc)
    expires = now + __import__("datetime").timedelta(hours=48)

    conn.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags,
            variant, status, created_at, expires_at, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)""",
        (
            variation_id,
            original["photo_id"],
            original["platform"],
            original["content_type"],
            body,
            tags,
            (original["variant"] or 1) + 1,
            now.isoformat(),
            expires.isoformat(),
            original["provenance"],
        ),
    )
    conn.commit()

    audit_log(conn, "variations", "suggest_seasonal", {
        "variation_id": variation_id,
        "source_content_id": content_id,
        "season_or_event": season_or_event,
        "platform": original["platform"],
        "has_api": client is not None,
    }, cost_usd=cost)

    logger.info("Seasonally adjusted content %s for %s", content_id[:12], season_or_event)
    return variation_id


def get_variation_history(
    conn: sqlite3.Connection,
    photo_id: str,
) -> list[dict]:
    """Show all variations created for a photo.

    Args:
        conn: Active database connection.
        photo_id: Photo ID to query.

    Returns:
        List of content records (as dicts) for this photo, sorted by creation time.
    """
    rows = conn.execute(
        """SELECT id, platform, content_type, body, tags, variant, status,
                  created_at, expires_at
           FROM content
           WHERE photo_id = ?
           ORDER BY created_at DESC""",
        (photo_id,),
    ).fetchall()

    return [dict(row) for row in rows]
