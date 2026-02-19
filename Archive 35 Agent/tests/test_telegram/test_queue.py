"""Tests for the approval queue manager."""

import pytest

from src.db import get_initialized_connection
from src.telegram.queue import (
    bundle_for_telegram,
    expire_old_content,
    get_pending_content,
    get_queue_stats,
)


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    c = get_initialized_connection(db_path)

    c.execute(
        "INSERT INTO photos (id, filename, path, imported_at, collection) VALUES (?, ?, ?, ?, ?)",
        ("photo1", "test.jpg", "/test.jpg", "2026-02-18T00:00:00Z", "ICE"),
    )

    # 5 pending items
    for i in range(5):
        c.execute(
            """INSERT INTO content
               (id, photo_id, platform, content_type, body, tags, status,
                created_at, expires_at, variant)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (f"c{i}", "photo1", "pinterest" if i < 3 else "instagram",
             "caption", f"Content {i}", '["tag"]', "pending",
             "2026-02-18T00:00:00Z", "2026-02-20T00:00:00Z", i + 1),
        )

    # 1 expired item (expires_at in the past)
    c.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags, status,
            created_at, expires_at, variant)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("expired1", "photo1", "pinterest", "caption",
         "Old content", '["old"]', "pending",
         "2020-01-01T00:00:00Z", "2020-01-03T00:00:00Z", 1),
    )
    c.commit()
    return c


def test_get_pending_content(conn):
    """Should return pending items."""
    items = get_pending_content(conn)
    assert len(items) >= 5


def test_get_pending_content_limit(conn):
    """Should respect the limit parameter."""
    items = get_pending_content(conn, limit=2)
    assert len(items) == 2


def test_expire_old_content(conn):
    """Should expire content past its window."""
    expired = expire_old_content(conn)
    assert expired >= 1

    row = conn.execute("SELECT status FROM content WHERE id = 'expired1'").fetchone()
    assert row["status"] == "expired"


def test_queue_stats(conn):
    """Should return correct statistics."""
    stats = get_queue_stats(conn)
    assert stats["total"] >= 6
    assert "pending" in stats["by_status"]


def test_bundle_for_telegram(conn):
    """Should return a batch and expire old content."""
    bundle = bundle_for_telegram(conn, batch_size=10)
    # expired1 should be expired, so only 5 pending remain
    assert len(bundle) == 5


def test_bundle_respects_batch_size(conn):
    """Should limit the batch size."""
    bundle = bundle_for_telegram(conn, batch_size=2)
    assert len(bundle) == 2


def test_expire_doesnt_touch_approved(conn):
    """Approved content should not be expired."""
    conn.execute(
        "UPDATE content SET status = 'approved', expires_at = '2020-01-01T00:00:00Z' WHERE id = 'c0'"
    )
    conn.commit()

    expire_old_content(conn)

    row = conn.execute("SELECT status FROM content WHERE id = 'c0'").fetchone()
    assert row["status"] == "approved"  # Should still be approved
