"""Audit logger for Archive-35.

Logs every action and its cost to the audit_log table.
Provides querying for cost analysis and debugging.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


def log(
    conn: sqlite3.Connection,
    component: str,
    action: str,
    details: Optional[dict[str, Any]] = None,
    cost_usd: float = 0.0,
    success: bool = True,
) -> Optional[int]:
    """Write an entry to the audit log.

    Non-blocking: catches and logs DB errors instead of raising.

    Args:
        conn: Active database connection.
        component: System component (e.g., "vision", "content", "social").
        action: Action performed (e.g., "analyze_photo", "post_pin").
        details: Optional dict of extra context (serialized to JSON).
        cost_usd: Cost of this action in USD.
        success: Whether the action succeeded.

    Returns:
        The audit log entry ID, or None if write failed.
    """
    now = datetime.now(timezone.utc).isoformat()
    details_json = json.dumps(details) if details else None

    try:
        cursor = conn.execute(
            """INSERT INTO audit_log
               (timestamp, component, action, details, cost_usd, success)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (now, component, action, details_json, cost_usd, 1 if success else 0),
        )
        conn.commit()
        return cursor.lastrowid
    except sqlite3.Error as e:
        logger.error("Audit log write failed: %s", e)
        return None


def query(
    conn: sqlite3.Connection,
    component: Optional[str] = None,
    action: Optional[str] = None,
    success_only: bool = False,
    limit: int = 100,
) -> list[dict]:
    """Query audit log entries with optional filters.

    Args:
        conn: Active database connection.
        component: Filter by component name.
        action: Filter by action name.
        success_only: If True, only return successful entries.
        limit: Max number of entries to return.

    Returns:
        List of audit log entries as dicts.
    """
    conditions = []
    params: list[Any] = []

    if component:
        conditions.append("component = ?")
        params.append(component)
    if action:
        conditions.append("action = ?")
        params.append(action)
    if success_only:
        conditions.append("success = 1")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)

    rows = conn.execute(
        f"SELECT * FROM audit_log {where} ORDER BY id DESC LIMIT ?",
        params,
    ).fetchall()

    return [dict(row) for row in rows]


def total_cost(
    conn: sqlite3.Connection,
    component: Optional[str] = None,
    since: Optional[str] = None,
) -> float:
    """Calculate total cost from audit log.

    Args:
        conn: Active database connection.
        component: Optional filter by component.
        since: Optional ISO timestamp to filter from.

    Returns:
        Total cost in USD.
    """
    conditions = []
    params: list[Any] = []

    if component:
        conditions.append("component = ?")
        params.append(component)
    if since:
        conditions.append("timestamp >= ?")
        params.append(since)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    row = conn.execute(
        f"SELECT COALESCE(SUM(cost_usd), 0) as total FROM audit_log {where}",
        params,
    ).fetchone()

    return row["total"]
