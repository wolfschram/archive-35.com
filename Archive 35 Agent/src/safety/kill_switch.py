"""Kill switch for Archive-35.

Global and per-platform emergency stop. Checks global first,
then per-platform scope. Any active kill switch blocks execution.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Optional


def is_active(
    conn: sqlite3.Connection,
    scope: str = "global",
) -> bool:
    """Check if a kill switch is active.

    Checks the global kill switch first. If checking a platform-specific
    scope, also checks global — if either is active, returns True.

    Args:
        conn: Active database connection.
        scope: Scope to check ("global", "pinterest", "instagram", etc.).

    Returns:
        True if execution should be blocked.
    """
    # Always check global first
    row = conn.execute(
        "SELECT active FROM kill_switch WHERE scope = 'global'",
    ).fetchone()
    if row and row["active"] == 1:
        return True

    # If checking a specific platform, also check that scope
    if scope != "global":
        row = conn.execute(
            "SELECT active FROM kill_switch WHERE scope = ?",
            (scope,),
        ).fetchone()
        if row and row["active"] == 1:
            return True

    return False


def activate(
    conn: sqlite3.Connection,
    scope: str = "global",
    reason: str = "",
    activated_by: str = "system",
) -> None:
    """Activate a kill switch.

    Args:
        conn: Active database connection.
        scope: Scope to activate ("global", "pinterest", etc.).
        reason: Why the kill switch was activated.
        activated_by: Who activated it (e.g., "wolf", "system", "budget").
    """
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """INSERT INTO kill_switch (scope, active, activated_at, activated_by, reason)
           VALUES (?, 1, ?, ?, ?)
           ON CONFLICT(scope) DO UPDATE SET
               active = 1,
               activated_at = excluded.activated_at,
               activated_by = excluded.activated_by,
               reason = excluded.reason""",
        (scope, now, activated_by, reason),
    )
    conn.commit()


def deactivate(
    conn: sqlite3.Connection,
    scope: str = "global",
) -> None:
    """Deactivate a kill switch.

    Args:
        conn: Active database connection.
        scope: Scope to deactivate.
    """
    conn.execute(
        """UPDATE kill_switch
           SET active = 0, activated_at = NULL, activated_by = NULL, reason = NULL
           WHERE scope = ?""",
        (scope,),
    )
    conn.commit()


def get_status(
    conn: sqlite3.Connection,
) -> list[dict]:
    """Get the status of all kill switches.

    Returns:
        List of dicts with scope, active, reason, etc.
    """
    rows = conn.execute("SELECT * FROM kill_switch ORDER BY scope").fetchall()
    return [dict(row) for row in rows]
