"""Tests for the social posting agent."""

import pytest

from src.agents.social import post_approved_batch, post_content
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    c = get_initialized_connection(db_path)

    # Insert photo + content
    c.execute(
        "INSERT INTO photos (id, filename, path, imported_at) VALUES (?, ?, ?, ?)",
        ("photo1", "test.jpg", "/test.jpg", "2026-02-18T00:00:00Z"),
    )
    c.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        ("content1", "photo1", "pinterest", "caption",
         "Beautiful landscape", '["landscape", "art"]', "approved", "2026-02-18T00:00:00Z"),
    )
    c.commit()
    return c


def test_dry_run_post(conn):
    """Dry run should succeed without API key."""
    result = post_content(conn, "content1", dry_run=True)
    assert result is True

    row = conn.execute("SELECT posted_at FROM content WHERE id = 'content1'").fetchone()
    assert row["posted_at"] is not None


def test_idempotency_prevents_double_post(conn):
    """Should not post the same content twice."""
    first = post_content(conn, "content1", dry_run=True)
    second = post_content(conn, "content1", dry_run=True)
    assert first is True
    assert second is False  # Blocked by idempotency


def test_kill_switch_blocks_post(conn):
    """Kill switch should prevent posting."""
    from src.safety.kill_switch import activate
    activate(conn, "pinterest", reason="test")

    result = post_content(conn, "content1", dry_run=True)
    assert result is False


def test_nonexistent_content(conn):
    """Should return False for missing content."""
    result = post_content(conn, "nonexistent", dry_run=True)
    assert result is False


def test_batch_posting(conn):
    """Should post all approved content in a batch."""
    # Add more approved content
    for i in range(3):
        conn.execute(
            """INSERT INTO content
               (id, photo_id, platform, content_type, body, tags, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (f"batch_{i}", "photo1", "instagram", "caption",
             f"Batch caption {i}", '["art"]', "approved", "2026-02-18T00:00:00Z"),
        )
    conn.commit()

    posted = post_approved_batch(conn, dry_run=True)
    assert posted == 4  # content1 + 3 batch items
