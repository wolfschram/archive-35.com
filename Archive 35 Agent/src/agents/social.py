"""Social posting agent for Archive-35.

Posts approved content to Pinterest and Instagram via Late API.
Includes idempotency, randomized timing, and exponential backoff.
"""

from __future__ import annotations

import json
import logging
import random
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from src.safety.audit import log as audit_log
from src.safety.kill_switch import is_active
from src.safety.ledger import can_execute, record_action
from src.safety.rate_limiter import check_limit, record_usage

logger = logging.getLogger(__name__)

LATE_API_BASE = "https://api.late.app/v1"
MAX_RETRIES = 3
BASE_BACKOFF = 2.0  # seconds


def _randomized_delay(min_seconds: float = 30, max_seconds: float = 300) -> float:
    """Generate a random delay for natural posting cadence."""
    return random.uniform(min_seconds, max_seconds)


def _post_via_late_api(
    platform: str,
    content_body: str,
    tags: list[str],
    api_key: str,
    image_url: Optional[str] = None,
) -> dict:
    """Post content via the Late API.

    Args:
        platform: Target platform (pinterest, instagram).
        content_body: Post body text.
        tags: Hashtags/tags.
        api_key: Late API key.
        image_url: URL of the image to post.

    Returns:
        API response as dict.

    Raises:
        httpx.HTTPStatusError: On API errors.
    """
    payload = {
        "platform": platform,
        "content": content_body,
        "tags": tags,
    }
    if image_url:
        payload["image_url"] = image_url

    with httpx.Client(timeout=30) as client:
        response = client.post(
            f"{LATE_API_BASE}/post",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        return response.json()


def post_content(
    conn: sqlite3.Connection,
    content_id: str,
    api_key: Optional[str] = None,
    dry_run: bool = False,
) -> bool:
    """Post a single content item to its target platform.

    Checks: kill switch, rate limits, idempotency.
    Retries with exponential backoff on failure.

    Args:
        conn: Active database connection.
        content_id: Content ID to post.
        api_key: Late API key (None = dry run).
        dry_run: If True, simulate posting without API call.

    Returns:
        True if posted successfully, False otherwise.
    """
    # Fetch content
    row = conn.execute(
        "SELECT * FROM content WHERE id = ?",
        (content_id,),
    ).fetchone()

    if not row:
        logger.error("Content %s not found", content_id)
        return False

    platform = row["platform"]
    body = row["body"]

    # Kill switch check
    if is_active(conn, platform):
        logger.warning("Kill switch active for %s, skipping", platform)
        audit_log(conn, "social", "post_blocked", {
            "content_id": content_id,
            "reason": "kill_switch",
        })
        return False

    # Rate limit check
    if not check_limit(conn, "late_api", daily_call_limit=50, daily_cost_limit_usd=1.0):
        logger.warning("Late API rate limit reached, skipping")
        return False

    # Idempotency check
    post_target = f"{platform}:{content_id}"
    if not can_execute(conn, "post", post_target, body):
        logger.info("Content %s already posted to %s", content_id[:12], platform)
        return False

    # Parse tags
    tags = json.loads(row["tags"]) if row["tags"] else []

    if dry_run or not api_key:
        # Simulate posting
        logger.info("[DRY RUN] Would post to %s: %s...", platform, body[:50])
        record_action(conn, "post", post_target, body, content_id=content_id)
        _mark_posted(conn, content_id)
        audit_log(conn, "social", "post_dry_run", {
            "content_id": content_id,
            "platform": platform,
        })
        return True

    # Post with retries
    for attempt in range(MAX_RETRIES):
        try:
            result = _post_via_late_api(platform, body, tags, api_key)
            record_action(
                conn, "post", post_target, body,
                content_id=content_id, cost_usd=0.0,
            )
            _mark_posted(conn, content_id)
            record_usage(conn, "late_api")
            audit_log(conn, "social", "post_success", {
                "content_id": content_id,
                "platform": platform,
                "api_response": result,
            })
            logger.info("Posted to %s: %s", platform, content_id[:12])
            return True

        except Exception as e:
            wait = BASE_BACKOFF * (2 ** attempt) + random.uniform(0, 1)
            logger.warning(
                "Post attempt %d failed: %s. Retrying in %.1fs",
                attempt + 1, e, wait,
            )
            if attempt < MAX_RETRIES - 1:
                time.sleep(wait)

    # All retries failed
    record_action(
        conn, "post", post_target, body,
        content_id=content_id, status="failed", error="Max retries exceeded",
    )
    audit_log(conn, "social", "post_failed", {
        "content_id": content_id,
        "platform": platform,
    }, success=False)
    return False


def _mark_posted(conn: sqlite3.Connection, content_id: str) -> None:
    """Update content status to reflect posting."""
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE content SET status = 'approved', posted_at = ? WHERE id = ?",
        (now, content_id),
    )
    conn.commit()


def post_approved_batch(
    conn: sqlite3.Connection,
    api_key: Optional[str] = None,
    dry_run: bool = False,
    max_posts: int = 10,
) -> int:
    """Post all approved content that hasn't been posted yet.

    Args:
        conn: Active database connection.
        api_key: Late API key.
        dry_run: Simulate without API calls.
        max_posts: Maximum posts in this batch.

    Returns:
        Number of items successfully posted.
    """
    rows = conn.execute(
        """SELECT id FROM content
           WHERE status = 'approved' AND posted_at IS NULL
           ORDER BY created_at ASC
           LIMIT ?""",
        (max_posts,),
    ).fetchall()

    posted = 0
    for row in rows:
        if post_content(conn, row["id"], api_key, dry_run):
            posted += 1

    logger.info("Batch posting complete: %d/%d posted", posted, len(rows))
    return posted
