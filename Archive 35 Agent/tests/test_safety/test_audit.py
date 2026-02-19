"""Tests for the audit logger."""

import pytest

from src.db import get_initialized_connection
from src.safety.audit import log, query, total_cost


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


def test_log_returns_id(conn):
    """log() should return an integer ID."""
    entry_id = log(conn, "vision", "analyze_photo")
    assert isinstance(entry_id, int)
    assert entry_id > 0


def test_log_10_entries(conn):
    """Should be able to log and retrieve 10 entries."""
    for i in range(10):
        log(
            conn,
            component=f"comp_{i}",
            action=f"action_{i}",
            details={"index": i},
            cost_usd=0.01 * i,
        )

    entries = query(conn, limit=100)
    assert len(entries) == 10


def test_query_by_component(conn):
    """Query should filter by component."""
    log(conn, "vision", "analyze")
    log(conn, "content", "generate")
    log(conn, "vision", "batch")

    results = query(conn, component="vision")
    assert len(results) == 2
    assert all(r["component"] == "vision" for r in results)


def test_query_success_only(conn):
    """Query should filter by success flag."""
    log(conn, "vision", "ok", success=True)
    log(conn, "vision", "fail", success=False)

    results = query(conn, success_only=True)
    assert len(results) == 1
    assert results[0]["success"] == 1


def test_total_cost(conn):
    """total_cost should sum all costs."""
    log(conn, "vision", "a", cost_usd=0.10)
    log(conn, "vision", "b", cost_usd=0.20)
    log(conn, "content", "c", cost_usd=0.30)

    assert abs(total_cost(conn) - 0.60) < 0.001


def test_total_cost_by_component(conn):
    """total_cost should filter by component."""
    log(conn, "vision", "a", cost_usd=0.10)
    log(conn, "content", "b", cost_usd=0.20)

    assert abs(total_cost(conn, component="vision") - 0.10) < 0.001


def test_log_with_details(conn):
    """Details dict should be serialized to JSON."""
    log(conn, "vision", "analyze", details={"photo_id": "abc", "score": 8})
    entries = query(conn)
    assert '"photo_id"' in entries[0]["details"]


def test_log_failure_entry(conn):
    """Failed actions should be logged with success=0."""
    log(conn, "social", "post_pin", success=False, details={"error": "timeout"})
    entries = query(conn)
    assert entries[0]["success"] == 0
