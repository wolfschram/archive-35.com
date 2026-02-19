"""Tests for the kill switch."""

import pytest

from src.db import get_initialized_connection
from src.safety.kill_switch import activate, deactivate, get_status, is_active


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


def test_inactive_by_default(conn):
    """No kill switch should be active by default."""
    assert is_active(conn, "global") is False
    assert is_active(conn, "pinterest") is False


def test_activate_global_blocks_all(conn):
    """Activating global should block all scopes."""
    activate(conn, "global", reason="Emergency stop")
    assert is_active(conn, "global") is True
    assert is_active(conn, "pinterest") is True
    assert is_active(conn, "instagram") is True


def test_activate_platform_only(conn):
    """Activating a platform should only block that platform."""
    activate(conn, "pinterest", reason="Pinterest rate limit")
    assert is_active(conn, "pinterest") is True
    assert is_active(conn, "instagram") is False
    assert is_active(conn, "global") is False


def test_deactivate(conn):
    """Deactivating should re-enable the scope."""
    activate(conn, "global", reason="test")
    assert is_active(conn, "global") is True

    deactivate(conn, "global")
    assert is_active(conn, "global") is False


def test_deactivate_platform_keeps_global(conn):
    """Deactivating a platform shouldn't affect global."""
    activate(conn, "global", reason="global stop")
    activate(conn, "pinterest", reason="platform stop")

    deactivate(conn, "pinterest")
    assert is_active(conn, "pinterest") is True  # Global still blocks
    assert is_active(conn, "global") is True


def test_activate_records_metadata(conn):
    """Activation should record who, when, and why."""
    activate(conn, "global", reason="Budget exceeded", activated_by="wolf")
    status = get_status(conn)
    global_entry = next(s for s in status if s["scope"] == "global")
    assert global_entry["reason"] == "Budget exceeded"
    assert global_entry["activated_by"] == "wolf"
    assert global_entry["activated_at"] is not None


def test_reactivate_updates(conn):
    """Re-activating should update reason and metadata."""
    activate(conn, "global", reason="First reason")
    activate(conn, "global", reason="Updated reason", activated_by="system")

    status = get_status(conn)
    global_entry = next(s for s in status if s["scope"] == "global")
    assert global_entry["reason"] == "Updated reason"
    assert global_entry["activated_by"] == "system"


def test_get_status_empty(conn):
    """get_status should return empty list when no switches set."""
    assert get_status(conn) == []
