"""Task scheduler for Archive-35.

Huey task definitions with cron schedules.
Daily pipeline at 06:00, posting at 10/14/18, summary at 20:00.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from huey import crontab

logger = logging.getLogger(__name__)


def _create_huey():
    """Create the Huey instance with fallback to MemoryHuey."""
    huey_db = os.environ.get("HUEY_DB_PATH", "data/huey.db")
    use_memory = os.environ.get("HUEY_IMMEDIATE", "").lower() == "true"

    if use_memory:
        from huey import MemoryHuey
        return MemoryHuey("archive35")

    try:
        from huey import SqliteHuey
        Path(huey_db).parent.mkdir(parents=True, exist_ok=True)
        return SqliteHuey("archive35", filename=huey_db, immediate=False)
    except Exception:
        from huey import MemoryHuey
        return MemoryHuey("archive35")


huey = _create_huey()


@huey.periodic_task(crontab(hour="6", minute="0"))
def daily_pipeline_task() -> dict:
    """Run the full daily pipeline at 06:00 UTC."""
    from src.pipeline.daily import run_daily_pipeline

    logger.info("Cron: Starting daily pipeline")
    return run_daily_pipeline(dry_run=False)


@huey.periodic_task(crontab(hour="10,14,18", minute="0"))
def posting_task() -> int:
    """Post approved content at 10:00, 14:00, 18:00 UTC."""
    from src.agents.social import post_approved_batch
    from src.config import get_settings
    from src.db import get_initialized_connection

    logger.info("Cron: Starting posting batch")
    settings = get_settings()
    conn = get_initialized_connection(settings.db_path)

    try:
        posted = post_approved_batch(
            conn,
            api_key=settings.late_api_key if settings.has_late_api_key() else None,
            max_posts=5,
        )
        return posted
    finally:
        conn.close()


@huey.periodic_task(crontab(hour="*", minute="0"))
def expire_content_task() -> int:
    """Check for expired content every hour."""
    from src.config import get_settings
    from src.db import get_initialized_connection
    from src.telegram.queue import expire_old_content

    logger.info("Cron: Checking for expired content")
    settings = get_settings()
    conn = get_initialized_connection(settings.db_path)

    try:
        return expire_old_content(conn)
    finally:
        conn.close()


@huey.periodic_task(crontab(hour="20", minute="0"))
def daily_summary_task() -> dict:
    """Send daily summary at 20:00 UTC."""
    from src.config import get_settings
    from src.db import get_initialized_connection
    from src.safety.audit import query, total_cost
    from src.telegram.queue import get_queue_stats

    logger.info("Cron: Generating daily summary")
    settings = get_settings()
    conn = get_initialized_connection(settings.db_path)

    try:
        stats = get_queue_stats(conn)
        cost = total_cost(conn)
        recent = query(conn, limit=10)

        return {
            "queue_stats": stats,
            "total_cost": cost,
            "recent_actions": len(recent),
        }
    finally:
        conn.close()


# Task registration info for documentation
SCHEDULE = {
    "daily_pipeline": "06:00 UTC — Full daily cycle",
    "posting": "10:00, 14:00, 18:00 UTC — Post approved content",
    "expire_content": "Every hour — Expire unapproved content",
    "daily_summary": "20:00 UTC — Daily summary to Telegram",
}
