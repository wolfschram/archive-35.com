"""Telegram approval handlers for Archive-35.

Inline keyboard handlers for: Approve / Edit / Reject / Defer.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Optional

from aiogram import Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from src.safety.audit import log as audit_log

logger = logging.getLogger(__name__)
approval_router = Router()

# Callback data format: action:content_id
APPROVE_PREFIX = "approve:"
REJECT_PREFIX = "reject:"
DEFER_PREFIX = "defer:"
EDIT_PREFIX = "edit:"


def build_approval_keyboard(content_id: str) -> InlineKeyboardMarkup:
    """Build an inline keyboard for content approval.

    Args:
        content_id: Content ID to build buttons for.

    Returns:
        InlineKeyboardMarkup with approve/reject/edit/defer buttons.
    """
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="✅ Approve",
                callback_data=f"{APPROVE_PREFIX}{content_id}",
            ),
            InlineKeyboardButton(
                text="✏️ Edit",
                callback_data=f"{EDIT_PREFIX}{content_id}",
            ),
        ],
        [
            InlineKeyboardButton(
                text="❌ Reject",
                callback_data=f"{REJECT_PREFIX}{content_id}",
            ),
            InlineKeyboardButton(
                text="⏭️ Defer",
                callback_data=f"{DEFER_PREFIX}{content_id}",
            ),
        ],
    ])


def format_approval_message(content_row: sqlite3.Row) -> str:
    """Format a content item for Telegram display.

    Args:
        content_row: Row from the content table.

    Returns:
        Formatted message string.
    """
    platform_emoji = {
        "pinterest": "📌",
        "instagram": "📸",
        "etsy": "🛒",
    }
    emoji = platform_emoji.get(content_row["platform"], "📄")

    tags = json.loads(content_row["tags"]) if content_row["tags"] else []
    tags_str = ", ".join(tags[:5])
    if len(tags) > 5:
        tags_str += f" +{len(tags) - 5} more"

    return (
        f"{emoji} **{content_row['platform'].title()}** "
        f"(variant {content_row['variant']})\n\n"
        f"{content_row['body']}\n\n"
        f"🏷️ {tags_str}\n"
        f"⏰ Expires: {content_row['expires_at'][:16] if content_row['expires_at'] else 'N/A'}"
    )


def handle_approve(
    conn: sqlite3.Connection,
    content_id: str,
) -> str:
    """Process an approval action.

    Args:
        conn: Active database connection.
        content_id: Content ID to approve.

    Returns:
        Status message.
    """
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE content SET status = 'approved', approved_at = ? WHERE id = ?",
        (now, content_id),
    )
    conn.commit()

    audit_log(conn, "telegram", "approve", {"content_id": content_id})
    return f"✅ Content approved and queued for posting"


def handle_reject(
    conn: sqlite3.Connection,
    content_id: str,
    reason: str = "Rejected via Telegram",
) -> str:
    """Process a rejection action.

    Args:
        conn: Active database connection.
        content_id: Content ID to reject.
        reason: Rejection reason.

    Returns:
        Status message.
    """
    conn.execute(
        "UPDATE content SET status = 'rejected' WHERE id = ?",
        (content_id,),
    )
    conn.commit()

    audit_log(conn, "telegram", "reject", {
        "content_id": content_id,
        "reason": reason,
    })
    return f"❌ Content rejected: {reason}"


def handle_defer(
    conn: sqlite3.Connection,
    content_id: str,
) -> str:
    """Process a defer action (re-queue for tomorrow).

    Args:
        conn: Active database connection.
        content_id: Content ID to defer.

    Returns:
        Status message.
    """
    audit_log(conn, "telegram", "defer", {"content_id": content_id})
    return "⏭️ Content deferred to next review cycle"


def handle_edit(
    conn: sqlite3.Connection,
    content_id: str,
) -> str:
    """Process an edit request (prompts for corrections).

    Args:
        conn: Active database connection.
        content_id: Content ID to edit.

    Returns:
        Status message with instructions.
    """
    audit_log(conn, "telegram", "edit_requested", {"content_id": content_id})
    return (
        "✏️ Edit mode. Reply to this message with your corrections.\n"
        "The content will be regenerated with your feedback."
    )
