"""Tests for the rate limiter."""

import pytest

from src.db import get_initialized_connection
from src.safety.rate_limiter import check_limit, get_usage, record_usage


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


def test_new_api_is_allowed(conn):
    """A fresh API should be within limits."""
    assert check_limit(conn, "anthropic", daily_call_limit=10) is True


def test_call_limit_blocks(conn):
    """Should block after reaching call limit."""
    # Initialize with limit of 10
    check_limit(conn, "anthropic", daily_call_limit=10)
    for _ in range(10):
        record_usage(conn, "anthropic")
    # Now at limit
    assert check_limit(conn, "anthropic") is False


def test_cost_limit_blocks(conn):
    """Should block after reaching cost limit."""
    record_usage(conn, "anthropic", cost_usd=5.0)
    assert check_limit(conn, "anthropic", daily_cost_limit_usd=5.0) is False


def test_below_limit_allowed(conn):
    """Should allow calls below both limits."""
    for _ in range(5):
        record_usage(conn, "anthropic", cost_usd=0.01)
    assert check_limit(conn, "anthropic", daily_call_limit=10, daily_cost_limit_usd=5.0) is True


def test_usage_tracking(conn):
    """get_usage should reflect recorded calls and costs."""
    record_usage(conn, "anthropic", cost_usd=0.10)
    record_usage(conn, "anthropic", cost_usd=0.20)

    usage = get_usage(conn, "anthropic")
    assert usage["calls_today"] == 2
    assert abs(usage["cost_today_usd"] - 0.30) < 0.001


def test_different_apis_independent(conn):
    """Limits should be independent per API."""
    # Initialize both with limit of 10
    check_limit(conn, "anthropic", daily_call_limit=10)
    check_limit(conn, "late_api", daily_call_limit=10)

    for _ in range(10):
        record_usage(conn, "anthropic")

    assert check_limit(conn, "anthropic") is False
    assert check_limit(conn, "late_api") is True


def test_reset_simulation(conn):
    """Manually setting last_reset to yesterday should trigger reset."""
    # Record some usage
    record_usage(conn, "anthropic", cost_usd=1.0)

    # Simulate yesterday's date
    conn.execute(
        "UPDATE rate_limits SET last_reset = '2020-01-01' WHERE api_name = ?",
        ("anthropic",),
    )
    conn.commit()

    # Check should trigger reset
    assert check_limit(conn, "anthropic", daily_call_limit=10) is True
    usage = get_usage(conn, "anthropic")
    assert usage["calls_today"] == 0
    assert usage["cost_today_usd"] == 0.0
