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


@huey.periodic_task(crontab(hour="3,16,20", minute="0"))
def instagram_post_task() -> dict:
    """Post to Instagram 3x/day: 8am, 12pm, 7pm PST (16:00, 20:00, 03:00 UTC)."""
    from src.agents.instagram_agent import post_next_image
    from src.config import get_settings
    from src.db import get_initialized_connection

    logger.info("Cron: Instagram auto-post")
    settings = get_settings()
    conn = get_initialized_connection(settings.db_path)

    try:
        client = None
        if settings.has_anthropic_key():
            import anthropic
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        if not client:
            logger.warning("No Anthropic key — skipping Instagram post")
            return {"error": "no_api_key"}
        return post_next_image(conn, client)
    except Exception as e:
        logger.error("Instagram post task failed: %s", e)
        return {"error": str(e)}
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


@huey.periodic_task(crontab(hour="7", minute="0"))
def daily_email_briefing():
    """Run email briefing every morning at 7 AM UTC."""
    from src.agents.email_briefing_agent import run_briefing

    logger.info("Cron: Running daily email briefing")
    return run_briefing(days_back=1)


@huey.periodic_task(crontab(hour="*/6", minute="15"))
def etsy_token_refresh():
    """Auto-refresh Etsy token if expiring within 2 hours."""
    from src.integrations.etsy import get_credentials, has_valid_token, refresh_access_token

    logger.info("Cron: Checking Etsy token expiry")
    try:
        creds = get_credentials()
        if not creds.get("refresh_token"):
            return {"refreshed": False, "reason": "no refresh token"}

        # Check if token expires within 2 hours
        expires = creds.get("token_expires", "")
        if expires:
            from datetime import datetime, timedelta, timezone

            try:
                exp_dt = datetime.fromisoformat(expires)
                threshold = datetime.now(timezone.utc) + timedelta(hours=2)
                if exp_dt > threshold:
                    return {"refreshed": False, "reason": "token still valid"}
            except (ValueError, TypeError):
                pass

        # Token is expired or expiring soon — refresh
        if not has_valid_token() or (expires and exp_dt <= threshold):
            result = refresh_access_token()
            if "error" in result:
                logger.error("Etsy token refresh failed: %s", result["error"])
                return {"error": result["error"]}
            logger.info("Etsy token refreshed automatically")
            return {"refreshed": True}

        return {"refreshed": False, "reason": "token still valid"}
    except Exception as e:
        logger.error("Etsy token refresh failed: %s", e)
        return {"error": str(e)}


@huey.periodic_task(crontab(hour="*/12", minute="30"))
def instagram_token_refresh():
    """Auto-refresh Instagram token if expiring within 7 days."""
    logger.info("Cron: Checking Instagram token expiry")
    try:
        from src.integrations.instagram import get_credentials, refresh_token

        creds = get_credentials()
        token = creds.get("access_token")
        expires = creds.get("token_expires")
        if not token:
            return {"refreshed": False, "reason": "no token"}
        if expires:
            from datetime import datetime, timedelta, timezone

            try:
                exp_dt = datetime.fromisoformat(expires)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if exp_dt > datetime.now(timezone.utc) + timedelta(days=7):
                    return {"refreshed": False, "reason": "token valid for 7+ days"}
            except (ValueError, TypeError):
                pass
        result = refresh_token()
        if result.get("success"):
            logger.info("Instagram token refreshed")
            return {"refreshed": True}
        return {"refreshed": False, "error": str(result)}
    except Exception as e:
        logger.error("Instagram token refresh failed: %s", e)
        return {"error": str(e)}


# Task registration info for documentation
SCHEDULE = {
    "daily_pipeline": "06:00 UTC — Full daily cycle",
    "posting": "10:00, 14:00, 18:00 UTC — Post approved content",
    "instagram_post": "16:00, 20:00, 03:00 UTC (8am, 12pm, 7pm PST) — Instagram auto-post",
    "expire_content": "Every hour — Expire unapproved content",
    "daily_summary": "20:00 UTC — Daily summary to Telegram",
    "email_briefing": "07:00 UTC — Scan all inboxes, generate prioritized briefing",
    "etsy_token_refresh": "Every 6 hours — Check and refresh Etsy API token",
    "instagram_token_refresh": "Every 12 hours — Check and refresh Instagram token",
}
