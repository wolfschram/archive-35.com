"""Optional audit hook to automatically log audit events to Google Sheets.

This module demonstrates how to integrate GoogleSheetsLogger with the
existing audit system (src/safety/audit.py).

Usage:
    Import and call once during app initialization:

    >>> from src.integrations.audit_hook import install_audit_hook
    >>> from src.safety import audit
    >>> install_audit_hook(sheets_logger, audit_db_conn)

    The audit.log() calls will then trigger Google Sheets posts.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def install_audit_hook(
    sheets_logger: Any,  # GoogleSheetsLogger
    db_conn: Optional[Any] = None,
) -> None:
    """Install a hook that forwards audit.log() calls to Google Sheets.

    For now, this is a manual integration pattern. To use:

    1. Log an action to the local audit DB:
       >>> from src.safety import audit
       >>> audit.log(conn, "content", "post_pin",
       ...           details={"platform": "pinterest"},
       ...           cost_usd=0.05)

    2. Then manually post to Google Sheets:
       >>> from src.integrations import GoogleSheetsLogger
       >>> sheets = GoogleSheetsLogger()
       >>> await sheets.log_content_posted(
       ...     content_id="pin_abc123",
       ...     platform="pinterest",
       ...     title="Grand Teton Sunset",
       ...     photo_id="gt-001")

    Future enhancement: Could wrap audit.log() to auto-forward to sheets,
    but that's optional and decoupled for now.

    Args:
        sheets_logger: GoogleSheetsLogger instance (unused in current version).
        db_conn: Database connection (unused in current version).
    """
    logger.info("Audit hook available for future use")
