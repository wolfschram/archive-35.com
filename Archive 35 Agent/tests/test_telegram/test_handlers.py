"""Tests for Telegram approval handlers."""

import pytest

from src.db import get_initialized_connection
from src.telegram.handlers import (
    build_approval_keyboard,
    handle_approve,
    handle_defer,
    handle_reject,
)


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    c = get_initialized_connection(db_path)

    c.execute(
        "INSERT INTO photos (id, filename, path, imported_at) VALUES (?, ?, ?, ?)",
        ("photo1", "test.jpg", "/test.jpg", "2026-02-18T00:00:00Z"),
    )
    c.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags, status, created_at, expires_at, variant)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("content1", "photo1", "pinterest", "caption",
         "Beautiful aurora", '["aurora"]', "pending",
         "2026-02-18T00:00:00Z", "2026-02-20T00:00:00Z", 1),
    )
    c.commit()
    return c


def test_build_approval_keyboard():
    """Should create a keyboard with 4 buttons."""
    kb = build_approval_keyboard("content1")
    # 2 rows × 2 buttons
    assert len(kb.inline_keyboard) == 2
    assert len(kb.inline_keyboard[0]) == 2
    assert len(kb.inline_keyboard[1]) == 2


def test_approve_changes_status(conn):
    """Approve should set status to 'approved'."""
    result = handle_approve(conn, "content1")
    assert "approved" in result.lower()

    row = conn.execute("SELECT status, approved_at FROM content WHERE id = 'content1'").fetchone()
    assert row["status"] == "approved"
    assert row["approved_at"] is not None


def test_reject_changes_status(conn):
    """Reject should set status to 'rejected'."""
    result = handle_reject(conn, "content1", reason="Poor quality")
    assert "rejected" in result.lower()

    row = conn.execute("SELECT status FROM content WHERE id = 'content1'").fetchone()
    assert row["status"] == "rejected"


def test_defer_returns_message(conn):
    """Defer should return a confirmation message."""
    result = handle_defer(conn, "content1")
    assert "deferred" in result.lower()


def test_keyboard_callback_data():
    """Keyboard buttons should have correct callback data."""
    kb = build_approval_keyboard("xyz123")
    approve_btn = kb.inline_keyboard[0][0]
    reject_btn = kb.inline_keyboard[1][0]
    assert approve_btn.callback_data == "approve:xyz123"
    assert reject_btn.callback_data == "reject:xyz123"
