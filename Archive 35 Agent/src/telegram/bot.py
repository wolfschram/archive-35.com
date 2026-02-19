"""Telegram bot for Archive-35.

aiogram 3.x bot with webhook/polling support.
Commands: /status, /kill, /resume
"""

from __future__ import annotations

import logging
from typing import Optional

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import Message

from src.db import get_initialized_connection
from src.safety.audit import log as audit_log, total_cost
from src.safety.kill_switch import activate, deactivate, get_status, is_active
from src.safety.rate_limiter import get_usage

logger = logging.getLogger(__name__)
router = Router()


def create_bot(token: str) -> tuple[Bot, Dispatcher]:
    """Create and configure the Telegram bot.

    Args:
        token: Telegram bot token from BotFather.

    Returns:
        Tuple of (Bot, Dispatcher).
    """
    bot = Bot(token=token)
    dp = Dispatcher()
    dp.include_router(router)
    return bot, dp


@router.message(Command("status"))
async def cmd_status(message: Message) -> None:
    """Show system health status."""
    try:
        conn = get_initialized_connection()

        # Kill switch status
        switches = get_status(conn)
        active_switches = [s for s in switches if s["active"] == 1]

        # Rate limiter status
        api_usage = {}
        for api_name in ["anthropic", "late_api"]:
            try:
                usage = get_usage(conn, api_name)
                api_usage[api_name] = usage
            except Exception:
                pass

        # Cost tracking
        today_cost = total_cost(conn)

        # Build status message
        lines = ["📊 **Archive-35 Status**\n"]

        if active_switches:
            lines.append("🔴 **KILL SWITCHES ACTIVE:**")
            for s in active_switches:
                lines.append(f"  • {s['scope']}: {s['reason']}")
        else:
            lines.append("🟢 All systems operational")

        lines.append(f"\n💰 Today's spend: ${today_cost:.4f}")

        for api, usage in api_usage.items():
            lines.append(
                f"📡 {api}: {usage['calls_today']}/{usage['daily_call_limit']} calls, "
                f"${usage['cost_today_usd']:.4f}/${usage['daily_cost_limit_usd']:.2f}"
            )

        # Pending content count
        pending = conn.execute(
            "SELECT COUNT(*) as cnt FROM content WHERE status = 'pending'"
        ).fetchone()
        lines.append(f"\n📋 Pending approval: {pending['cnt']} items")

        conn.close()
        await message.answer("\n".join(lines), parse_mode="Markdown")

    except Exception as e:
        logger.error("Status command failed: %s", e)
        await message.answer(f"❌ Status check failed: {e}")


@router.message(Command("kill"))
async def cmd_kill(message: Message) -> None:
    """Activate global kill switch."""
    try:
        conn = get_initialized_connection()
        reason = "Manual kill via Telegram"

        # Check for platform-specific kill
        text = message.text or ""
        parts = text.split(maxsplit=1)
        scope = "global"
        if len(parts) > 1:
            scope = parts[1].strip().lower()
            reason = f"Manual kill for {scope} via Telegram"

        activate(conn, scope, reason=reason, activated_by="wolf_telegram")
        audit_log(conn, "telegram", "kill_switch", {
            "scope": scope,
            "reason": reason,
        })
        conn.close()

        await message.answer(f"🔴 Kill switch activated: **{scope}**\nReason: {reason}", parse_mode="Markdown")
    except Exception as e:
        await message.answer(f"❌ Kill failed: {e}")


@router.message(Command("resume"))
async def cmd_resume(message: Message) -> None:
    """Deactivate kill switch."""
    try:
        conn = get_initialized_connection()

        text = message.text or ""
        parts = text.split(maxsplit=1)
        scope = "global"
        if len(parts) > 1:
            scope = parts[1].strip().lower()

        deactivate(conn, scope)
        audit_log(conn, "telegram", "resume", {"scope": scope})
        conn.close()

        await message.answer(f"🟢 Kill switch deactivated: **{scope}**", parse_mode="Markdown")
    except Exception as e:
        await message.answer(f"❌ Resume failed: {e}")


async def start_polling(token: str) -> None:
    """Start the bot in polling mode.

    Args:
        token: Telegram bot token.
    """
    bot, dp = create_bot(token)
    logger.info("Starting Telegram bot in polling mode...")
    await dp.start_polling(bot)
