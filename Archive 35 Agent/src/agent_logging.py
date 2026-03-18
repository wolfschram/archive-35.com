"""Enhanced logging for Archive-35 agents.

Provides:
- Daily rotating text log files in logs/
- Append-only JSON decisions log
- Build log writer for overnight builds
- Log rotation (keep last 30 days)
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

BASE_DIR = Path(__file__).resolve().parents[1]
LOGS_DIR = BASE_DIR / "logs"
DATA_DIR = BASE_DIR / "data"
DECISIONS_LOG = LOGS_DIR / "decisions.json"
BUILD_LOG = DATA_DIR / "build_log.json"

LOGS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)

# Days to keep log files before rotation deletes them
LOG_RETENTION_DAYS = 30


def setup_daily_logging(log_level: int = logging.INFO) -> None:
    """Configure daily rotating log file + console output.

    Creates logs/agent_YYYY-MM-DD.log with daily rotation.
    Old logs beyond LOG_RETENTION_DAYS are automatically removed.
    """
    root_logger = logging.getLogger()

    # Avoid duplicate handlers if called multiple times
    for h in root_logger.handlers[:]:
        if isinstance(h, logging.handlers.TimedRotatingFileHandler):
            root_logger.removeHandler(h)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log_file = LOGS_DIR / f"agent_{today}.log"

    # TimedRotatingFileHandler rotates at midnight, keeps 30 backups
    file_handler = logging.handlers.TimedRotatingFileHandler(
        filename=str(log_file),
        when="midnight",
        interval=1,
        backupCount=LOG_RETENTION_DAYS,
        utc=True,
    )
    file_handler.setLevel(log_level)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))

    root_logger.addHandler(file_handler)
    root_logger.setLevel(log_level)

    # Run cleanup of old logs
    _cleanup_old_logs()


def _cleanup_old_logs() -> None:
    """Remove log files older than LOG_RETENTION_DAYS."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOG_RETENTION_DAYS)
    removed = 0
    for log_file in LOGS_DIR.glob("agent_*.log*"):
        try:
            mtime = datetime.fromtimestamp(
                os.path.getmtime(log_file), tz=timezone.utc
            )
            if mtime < cutoff:
                log_file.unlink()
                removed += 1
        except OSError:
            pass
    if removed:
        logger.info("Cleaned up %d old log files", removed)


def log_decision(
    component: str,
    action: str,
    decision: str,
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Append a decision entry to the JSON decisions log.

    Args:
        component: System component making the decision.
        action: What action was taken.
        decision: Why this decision was made.
        details: Optional extra context.
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "component": component,
        "action": action,
        "decision": decision,
    }
    if details:
        entry["details"] = details

    try:
        # Read existing entries
        entries: list[dict] = []
        if DECISIONS_LOG.exists():
            try:
                entries = json.loads(DECISIONS_LOG.read_text())
            except (json.JSONDecodeError, OSError):
                entries = []

        entries.append(entry)
        DECISIONS_LOG.write_text(json.dumps(entries, indent=2))
    except OSError as e:
        logger.error("Failed to write decisions log: %s", e)


def log_build(
    task: str,
    action: str,
    decision: str,
    result: str = "started",
) -> None:
    """Append an entry to data/build_log.json for overnight builds.

    Args:
        task: Task identifier (e.g., "Task 15").
        action: Description of what was done.
        decision: Reasoning behind the approach.
        result: One of "started", "success", "failed".
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "task": task,
        "action": action,
        "decision": decision,
        "result": result,
    }

    try:
        entries: list[dict] = []
        if BUILD_LOG.exists():
            try:
                entries = json.loads(BUILD_LOG.read_text())
            except (json.JSONDecodeError, OSError):
                entries = []

        entries.append(entry)
        BUILD_LOG.write_text(json.dumps(entries, indent=2))
    except OSError as e:
        logger.error("Failed to write build log: %s", e)


def get_daily_logs(date_str: Optional[str] = None) -> list[str]:
    """Read a day's log file and return lines.

    Args:
        date_str: Date in YYYY-MM-DD format. Defaults to today.

    Returns:
        List of log lines for that day.
    """
    if not date_str:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    log_file = LOGS_DIR / f"agent_{date_str}.log"
    if not log_file.exists():
        return []

    try:
        return log_file.read_text().splitlines()
    except OSError:
        return []


def get_available_log_dates() -> list[str]:
    """Return sorted list of dates that have log files.

    Returns:
        List of date strings like ["2026-03-15", "2026-03-16", ...].
    """
    dates = []
    for f in sorted(LOGS_DIR.glob("agent_*.log")):
        # Extract date from agent_YYYY-MM-DD.log
        name = f.stem  # agent_YYYY-MM-DD
        if name.startswith("agent_") and len(name) == 16:
            dates.append(name[6:])
    return dates
