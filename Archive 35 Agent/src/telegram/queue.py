"""Approval queue manager for Archive-35.

Bundles pending content into Telegram messages.
Manages 48h expiry for unapproved content.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from src.safety.audit import log as audit_log

logger = logging.getLogger(__name__)

MAX_BATCH_SIZE = 15
EXPIRY_HOURS = 48


def get_pending_content(
    conn: sqlite3.Connection,
    limit: int = MAX_BATCH_SIZE,
) -> list[dict]:
    """Get pending content items for approval.

    Args:
        conn: Active database connection.
        limit: Maximum items to return.

    Returns:
        List of content items as dicts.
    """
    rows = conn.execute(
        """SELECT c.*, p.filename, p.collection
           FROM content c
           JOIN photos p ON c.photo_id = p.id
           WHERE c.status = 'pending'
           ORDER BY c.created_at ASC
           LIMIT ?""",
        (limit,),
    ).fetchall()

    return [dict(row) for row in rows]


def expire_old_content(
    conn: sqlite3.Connection,
) -> int:
    """Expire content that has passed its 48h window.

    Args:
        conn: Active database connection.

    Returns:
        Number of items expired.
    """
    now = datetime.now(timezone.utc).isoformat()

    cursor = conn.execute(
        """UPDATE content
           SET status = 'expired'
           WHERE status = 'pending'
             AND expires_at IS NOT NULL
             AND expires_at < ?""",
        (now,),
    )
    conn.commit()

    expired_count = cursor.rowcount
    if expired_count > 0:
        audit_log(conn, "queue", "expire_content", {
            "expired_count": expired_count,
        })
        logger.info("Expired %d content items", expired_count)

    return expired_count


def get_queue_stats(
    conn: sqlite3.Connection,
) -> dict[str, Any]:
    """Get queue statistics.

    Returns:
        Dict with counts by status and platform.
    """
    stats: dict[str, Any] = {}

    # By status
    rows = conn.execute(
        """SELECT status, COUNT(*) as cnt
           FROM content
           GROUP BY status"""
    ).fetchall()
    stats["by_status"] = {row["status"]: row["cnt"] for row in rows}

    # By platform (pending only)
    rows = conn.execute(
        """SELECT platform, COUNT(*) as cnt
           FROM content
           WHERE status = 'pending'
           GROUP BY platform"""
    ).fetchall()
    stats["pending_by_platform"] = {row["platform"]: row["cnt"] for row in rows}

    # Total
    total = conn.execute("SELECT COUNT(*) as cnt FROM content").fetchone()
    stats["total"] = total["cnt"]

    return stats


def bundle_for_telegram(
    conn: sqlite3.Connection,
    batch_size: int = MAX_BATCH_SIZE,
) -> list[dict]:
    """Get the next batch of content for Telegram review.

    Groups by photo so Wolf sees related content together.

    Args:
        conn: Active database connection.
        batch_size: Max items per batch.

    Returns:
        List of content items grouped by photo.
    """
    # First expire old content
    expire_old_content(conn)

    # Get pending content grouped by photo
    rows = conn.execute(
        """SELECT c.*, p.filename, p.collection
           FROM content c
           JOIN photos p ON c.photo_id = p.id
           WHERE c.status = 'pending'
           ORDER BY c.photo_id, c.platform, c.variant
           LIMIT ?""",
        (batch_size,),
    ).fetchall()

    return [dict(row) for row in rows]
