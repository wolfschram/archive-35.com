"""Tests for the Greatest Hits manager."""

import pytest

from src.brand.greatest_hits import (
    add_to_greatest_hits,
    get_repost_candidates,
    record_repost,
    set_eligible,
    update_performance,
)
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    c = get_initialized_connection(db_path)

    # Insert test photo and content
    c.execute(
        "INSERT INTO photos (id, filename, path, imported_at) VALUES (?, ?, ?, ?)",
        ("photo1", "test.jpg", "/test.jpg", "2026-02-18T00:00:00Z"),
    )

    for i in range(5):
        c.execute(
            """INSERT INTO content
               (id, photo_id, platform, content_type, body, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (f"content_{i}", "photo1", "pinterest", "caption",
             f"Caption {i}", "2026-02-18T00:00:00Z"),
        )
    c.commit()
    return c


def test_add_to_greatest_hits(conn):
    """Should add content and return an ID."""
    gh_id = add_to_greatest_hits(conn, "content_0", "pinterest", performance_score=8.0)
    assert isinstance(gh_id, str)
    assert len(gh_id) == 36


def test_get_repost_candidates(conn):
    """Should return eligible candidates."""
    # Add 5 items with different scores
    for i in range(5):
        add_to_greatest_hits(conn, f"content_{i}", "pinterest", performance_score=float(i + 3))

    # Set last_posted_at to old date so they're past cooldown
    conn.execute("UPDATE greatest_hits SET last_posted_at = '2020-01-01T00:00:00Z'")
    conn.commit()

    candidates = get_repost_candidates(conn, "pinterest", count=3, min_score=5.0)
    assert len(candidates) == 3
    # Should be ordered by score descending
    scores = [c["performance_score"] for c in candidates]
    assert scores == sorted(scores, reverse=True)


def test_mark_high_performing(conn):
    """Should only return items meeting minimum score."""
    add_to_greatest_hits(conn, "content_0", "pinterest", performance_score=3.0)
    add_to_greatest_hits(conn, "content_1", "pinterest", performance_score=8.0)

    # Set old dates
    conn.execute("UPDATE greatest_hits SET last_posted_at = '2020-01-01T00:00:00Z'")
    conn.commit()

    candidates = get_repost_candidates(conn, "pinterest", min_score=5.0)
    assert len(candidates) == 1
    assert candidates[0]["performance_score"] == 8.0


def test_cooldown_period(conn):
    """Content posted recently should not be eligible."""
    add_to_greatest_hits(conn, "content_0", "pinterest", performance_score=9.0)
    # last_posted_at is set to now by add_to_greatest_hits

    candidates = get_repost_candidates(conn, "pinterest", cooldown_days=14)
    assert len(candidates) == 0


def test_set_eligible(conn):
    """Should be able to mark content as ineligible."""
    add_to_greatest_hits(conn, "content_0", "pinterest")
    set_eligible(conn, "content_0", eligible=False)

    conn.execute("UPDATE greatest_hits SET last_posted_at = '2020-01-01T00:00:00Z'")
    conn.commit()

    candidates = get_repost_candidates(conn, "pinterest", min_score=0)
    assert len(candidates) == 0


def test_record_repost_increments(conn):
    """record_repost should increment times_posted."""
    add_to_greatest_hits(conn, "content_0", "pinterest")
    record_repost(conn, "content_0")

    row = conn.execute(
        "SELECT times_posted FROM greatest_hits WHERE content_id = 'content_0'"
    ).fetchone()
    assert row["times_posted"] == 2


def test_update_performance(conn):
    """Should update the performance score."""
    add_to_greatest_hits(conn, "content_0", "pinterest", performance_score=5.0)
    update_performance(conn, "content_0", 9.5)

    row = conn.execute(
        "SELECT performance_score FROM greatest_hits WHERE content_id = 'content_0'"
    ).fetchone()
    assert row["performance_score"] == 9.5
