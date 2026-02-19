"""Tests for the idempotency ledger."""

import pytest

from src.db import get_initialized_connection
from src.safety.ledger import can_execute, get_action_by_hash, record_action


@pytest.fixture
def conn(tmp_path):
    """Provide an initialized in-memory-like DB connection."""
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


def test_new_action_can_execute(conn):
    """A brand new action should be allowed."""
    assert can_execute(conn, "post", "pinterest:123", "Hello world") is True


def test_duplicate_action_blocked(conn):
    """After recording, the same action should be blocked."""
    record_action(conn, "post", "pinterest:123", "Hello world")
    assert can_execute(conn, "post", "pinterest:123", "Hello world") is False


def test_different_actions_allowed(conn):
    """Different actions should not block each other."""
    record_action(conn, "post", "pinterest:123", "Hello world")
    assert can_execute(conn, "post", "instagram:456", "Hello world") is True
    assert can_execute(conn, "post", "pinterest:123", "Different content") is True


def test_failed_action_allows_retry(conn):
    """A failed action should allow retry."""
    record_action(
        conn, "post", "pinterest:123", "Hello world",
        status="failed", error="Network timeout",
    )
    assert can_execute(conn, "post", "pinterest:123", "Hello world") is True


def test_record_returns_id(conn):
    """record_action should return a UUID string."""
    action_id = record_action(conn, "post", "pinterest:123", "Hello world")
    assert isinstance(action_id, str)
    assert len(action_id) == 36  # UUID format


def test_record_with_cost(conn):
    """Cost should be stored correctly."""
    record_action(
        conn, "post", "pinterest:123", "Hello world",
        cost_usd=0.005,
    )
    row = get_action_by_hash(conn, "post", "pinterest:123", "Hello world")
    assert row["cost_usd"] == 0.005


def test_retry_updates_existing(conn):
    """Retrying a failed action should update the existing record."""
    record_action(
        conn, "post", "pinterest:123", "Hello world",
        status="failed", error="Timeout",
    )
    record_action(
        conn, "post", "pinterest:123", "Hello world",
        status="executed",
    )
    row = get_action_by_hash(conn, "post", "pinterest:123", "Hello world")
    assert row["status"] == "executed"
    assert row["executed_at"] is not None


def test_get_action_by_hash_returns_none(conn):
    """Looking up a non-existent action should return None."""
    result = get_action_by_hash(conn, "post", "nonexistent", "nothing")
    assert result is None
