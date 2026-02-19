"""Per-API rate limiting with daily budget caps.

Tracks call counts and costs per API. Auto-resets at midnight UTC.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone


def _today_str() -> str:
    """Return today's date as ISO string (UTC)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _ensure_api_exists(
    conn: sqlite3.Connection,
    api_name: str,
    daily_call_limit: int = 1000,
    daily_cost_limit_usd: float = 5.0,
) -> None:
    """Insert a rate_limits row if it doesn't exist yet."""
    existing = conn.execute(
        "SELECT api_name FROM rate_limits WHERE api_name = ?",
        (api_name,),
    ).fetchone()

    if not existing:
        conn.execute(
            """INSERT INTO rate_limits
               (api_name, calls_today, cost_today_usd,
                daily_call_limit, daily_cost_limit_usd, last_reset)
               VALUES (?, 0, 0.0, ?, ?, ?)""",
            (api_name, daily_call_limit, daily_cost_limit_usd, _today_str()),
        )
        conn.commit()


def _maybe_reset(conn: sqlite3.Connection, api_name: str) -> None:
    """Reset counters if the day has changed since last reset."""
    row = conn.execute(
        "SELECT last_reset FROM rate_limits WHERE api_name = ?",
        (api_name,),
    ).fetchone()

    if row and row["last_reset"] != _today_str():
        conn.execute(
            """UPDATE rate_limits
               SET calls_today = 0, cost_today_usd = 0.0, last_reset = ?
               WHERE api_name = ?""",
            (_today_str(), api_name),
        )
        conn.commit()


def check_limit(
    conn: sqlite3.Connection,
    api_name: str,
    daily_call_limit: int = 1000,
    daily_cost_limit_usd: float = 5.0,
) -> bool:
    """Check if an API call is within rate limits.

    Auto-creates the rate limit entry if it doesn't exist.
    Auto-resets counters at midnight UTC.

    Args:
        conn: Active database connection.
        api_name: Name of the API to check.
        daily_call_limit: Max calls per day (used on first creation).
        daily_cost_limit_usd: Max spend per day (used on first creation).

    Returns:
        True if the call is allowed, False if limit reached.
    """
    _ensure_api_exists(conn, api_name, daily_call_limit, daily_cost_limit_usd)
    _maybe_reset(conn, api_name)

    row = conn.execute(
        """SELECT calls_today, cost_today_usd,
                  daily_call_limit, daily_cost_limit_usd
           FROM rate_limits WHERE api_name = ?""",
        (api_name,),
    ).fetchone()

    if row["calls_today"] >= row["daily_call_limit"]:
        return False
    if row["cost_today_usd"] >= row["daily_cost_limit_usd"]:
        return False

    return True


def record_usage(
    conn: sqlite3.Connection,
    api_name: str,
    cost_usd: float = 0.0,
) -> None:
    """Record an API call and its cost.

    Args:
        conn: Active database connection.
        api_name: Name of the API.
        cost_usd: Cost of this call in USD.
    """
    _ensure_api_exists(conn, api_name)
    _maybe_reset(conn, api_name)

    conn.execute(
        """UPDATE rate_limits
           SET calls_today = calls_today + 1,
               cost_today_usd = cost_today_usd + ?
           WHERE api_name = ?""",
        (cost_usd, api_name),
    )
    conn.commit()


def get_usage(
    conn: sqlite3.Connection,
    api_name: str,
) -> dict:
    """Get current usage stats for an API.

    Returns:
        Dict with calls_today, cost_today_usd, limits, and last_reset.
    """
    _ensure_api_exists(conn, api_name)
    _maybe_reset(conn, api_name)

    row = conn.execute(
        "SELECT * FROM rate_limits WHERE api_name = ?",
        (api_name,),
    ).fetchone()

    return dict(row)
