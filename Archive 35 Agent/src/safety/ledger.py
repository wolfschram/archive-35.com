"""Idempotency ledger for Archive-35.

Hash-based deduplication to prevent duplicate side-effects
(double posts, duplicate listings, repeat emails).
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4


def _hash_action(action_type: str, target: str, content: str) -> str:
    """Generate a SHA256 hash for an action to detect duplicates.

    Args:
        action_type: Type of action (post, list, email).
        target: Target platform and ID.
        content: Content body or identifier.

    Returns:
        SHA256 hex digest string.
    """
    raw = f"{action_type}:{target}:{content}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def can_execute(
    conn: sqlite3.Connection,
    action_type: str,
    target: str,
    content: str,
) -> bool:
    """Check if an action can be executed (hasn't been done before).

    Args:
        conn: Active database connection.
        action_type: Type of action (post, list, email).
        target: Target platform and ID.
        content: Content body or identifier.

    Returns:
        True if the action is new and can proceed, False if duplicate.
    """
    action_hash = _hash_action(action_type, target, content)
    row = conn.execute(
        "SELECT status FROM actions_ledger WHERE action_hash = ?",
        (action_hash,),
    ).fetchone()

    if row is None:
        return True

    # Allow retry if previous attempt failed
    return row["status"] == "failed"


def record_action(
    conn: sqlite3.Connection,
    action_type: str,
    target: str,
    content: str,
    content_id: Optional[str] = None,
    status: str = "executed",
    cost_usd: float = 0.0,
    error: Optional[str] = None,
) -> str:
    """Record an action in the ledger.

    Args:
        conn: Active database connection.
        action_type: Type of action (post, list, email).
        target: Target platform and ID.
        content: Content body or identifier.
        content_id: Optional reference to content table.
        status: Action status (pending, executed, failed, rolled_back).
        cost_usd: Cost of the action in USD.
        error: Error message if failed.

    Returns:
        The action ID (UUID).
    """
    action_hash = _hash_action(action_type, target, content)
    action_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()

    executed_at = now if status == "executed" else None

    # Upsert using ON CONFLICT to avoid TOCTOU race conditions
    try:
        conn.execute(
            """INSERT INTO actions_ledger
               (id, action_hash, action_type, target, content_id,
                status, created_at, executed_at, cost_usd, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(action_hash) DO UPDATE SET
                 status = excluded.status,
                 executed_at = excluded.executed_at,
                 cost_usd = excluded.cost_usd,
                 error = excluded.error""",
            (
                action_id,
                action_hash,
                action_type,
                target,
                content_id,
                status,
                now,
                executed_at,
                cost_usd,
                error,
            ),
        )
    except sqlite3.IntegrityError:
        # Fallback: hash collision or concurrent insert — update existing row
        conn.execute(
            """UPDATE actions_ledger
               SET status = ?, executed_at = ?, cost_usd = ?, error = ?
               WHERE action_hash = ?""",
            (status, executed_at, cost_usd, error, action_hash),
        )

    conn.commit()
    return action_id


def get_action_by_hash(
    conn: sqlite3.Connection,
    action_type: str,
    target: str,
    content: str,
) -> Optional[sqlite3.Row]:
    """Look up an action by its computed hash.

    Returns:
        The action row if found, None otherwise.
    """
    action_hash = _hash_action(action_type, target, content)
    return conn.execute(
        "SELECT * FROM actions_ledger WHERE action_hash = ?",
        (action_hash,),
    ).fetchone()
