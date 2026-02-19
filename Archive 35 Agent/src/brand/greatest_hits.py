"""Greatest Hits manager for Archive-35.

Tracks approved content that performed well and manages
automatic reposting with configurable cooldown periods.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

DEFAULT_REPOST_COOLDOWN_DAYS = 14
DEFAULT_MIN_PERFORMANCE_SCORE = 5.0


def add_to_greatest_hits(
    conn: sqlite3.Connection,
    content_id: str,
    platform: str,
    performance_score: Optional[float] = None,
) -> str:
    """Add approved content to the Greatest Hits rotation.

    Args:
        conn: Active database connection.
        content_id: Content ID from the content table.
        platform: Platform this content is for.
        performance_score: Engagement metric (if available).

    Returns:
        Greatest Hits entry ID.
    """
    gh_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """INSERT INTO greatest_hits
           (id, content_id, platform, times_posted, last_posted_at,
            performance_score, eligible)
           VALUES (?, ?, ?, 1, ?, ?, 1)""",
        (gh_id, content_id, platform, now, performance_score),
    )
    conn.commit()

    logger.info("Added to Greatest Hits: %s (%s)", content_id[:12], platform)
    return gh_id


def update_performance(
    conn: sqlite3.Connection,
    content_id: str,
    performance_score: float,
) -> None:
    """Update the performance score for a Greatest Hits entry.

    Args:
        conn: Active database connection.
        content_id: Content ID to update.
        performance_score: New engagement metric.
    """
    conn.execute(
        "UPDATE greatest_hits SET performance_score = ? WHERE content_id = ?",
        (performance_score, content_id),
    )
    conn.commit()


def record_repost(
    conn: sqlite3.Connection,
    content_id: str,
) -> None:
    """Record that content was reposted.

    Args:
        conn: Active database connection.
        content_id: Content ID that was reposted.
    """
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """UPDATE greatest_hits
           SET times_posted = times_posted + 1, last_posted_at = ?
           WHERE content_id = ?""",
        (now, content_id),
    )
    conn.commit()


def get_repost_candidates(
    conn: sqlite3.Connection,
    platform: str,
    count: int = 5,
    cooldown_days: int = DEFAULT_REPOST_COOLDOWN_DAYS,
    min_score: float = DEFAULT_MIN_PERFORMANCE_SCORE,
) -> list[dict]:
    """Get content eligible for reposting.

    Returns content that:
    - Is marked eligible
    - Hasn't been posted within the cooldown period
    - Meets minimum performance score (if scores are set)
    - Is for the requested platform

    Args:
        conn: Active database connection.
        platform: Target platform.
        count: Max number of candidates to return.
        cooldown_days: Minimum days since last post.
        min_score: Minimum performance score to qualify.

    Returns:
        List of Greatest Hits entries as dicts.
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=cooldown_days)
    ).isoformat()

    rows = conn.execute(
        """SELECT gh.*, c.body, c.tags
           FROM greatest_hits gh
           JOIN content c ON gh.content_id = c.id
           WHERE gh.platform = ?
             AND gh.eligible = 1
             AND (gh.last_posted_at IS NULL OR gh.last_posted_at < ?)
             AND (gh.performance_score IS NULL OR gh.performance_score >= ?)
           ORDER BY gh.performance_score DESC NULLS LAST
           LIMIT ?""",
        (platform, cutoff, min_score, count),
    ).fetchall()

    return [dict(row) for row in rows]


def set_eligible(
    conn: sqlite3.Connection,
    content_id: str,
    eligible: bool = True,
) -> None:
    """Set whether content is eligible for reposting.

    Args:
        conn: Active database connection.
        content_id: Content ID.
        eligible: Whether it can be reposted.
    """
    conn.execute(
        "UPDATE greatest_hits SET eligible = ? WHERE content_id = ?",
        (1 if eligible else 0, content_id),
    )
    conn.commit()
