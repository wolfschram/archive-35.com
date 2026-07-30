"""Tests for Etsy demand and revenue measurement."""

from datetime import datetime, timedelta, timezone

import pytest

from src.agents.etsy_demand import (
    capture_listing_snapshots,
    capture_order_facts,
    capture_payment_fact,
    record_experiment_cost,
    revenue_report,
)
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    """Return an initialized isolated database."""
    connection = get_initialized_connection(tmp_path / "demand.db")
    yield connection
    connection.close()


def listing(listing_id=101, views=10, favorites=1):
    """Build a representative Etsy listing response."""
    return {
        "listing_id": listing_id,
        "state": "active",
        "title": "Iceland Printable Wall Art",
        "listing_type": "download",
        "price": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
        "views": views,
        "num_favorers": favorites,
        "quantity": 999,
        "url": "https://etsy.example/listing/101",
    }


def test_listing_snapshots_are_immutable_by_timestamp(conn):
    """Two collection runs should preserve both points in time."""
    capture_listing_snapshots(conn, [listing()], "2026-07-01T00:00:00+00:00")
    capture_listing_snapshots(
        conn,
        [listing(views=25, favorites=4)],
        "2026-07-02T00:00:00+00:00",
    )
    rows = conn.execute(
        "SELECT views, favorites FROM etsy_listing_snapshots ORDER BY captured_at"
    ).fetchall()
    assert [(row[0], row[1]) for row in rows] == [(10, 1), (25, 4)]


def test_digital_order_has_zero_cogs(conn):
    """Archive-35 digital SKUs should be fully measurable with zero fulfillment."""
    receipts = [{
        "receipt_id": 9001,
        "transactions": [{
            "transaction_id": 77,
            "listing_id": 101,
            "sku": ["A35-DIG-ICE-0001"],
            "quantity": 1,
            "price": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
        }],
    }]
    assert capture_order_facts(conn, receipts) == 1
    row = conn.execute(
        "SELECT gross_usd, cogs_usd FROM etsy_order_facts"
    ).fetchone()
    assert row["gross_usd"] == 12
    assert row["cogs_usd"] == 0


def test_budget_is_hard_capped_at_fifty_dollars(conn):
    """No recorded experiment spend may exceed Wolf's authorization."""
    assert record_experiment_cost(
        conn, 42, note="21 days at $2", external_reference="ads-1",
    ) == 42
    with pytest.raises(ValueError, match="\\$8.00 remains"):
        record_experiment_cost(conn, 8.01, external_reference="ads-2")
    assert record_experiment_cost(
        conn, 8, external_reference="ads-3",
    ) == 50


def test_report_calculates_demand_and_known_contribution(conn):
    """The 30-day report should measure deltas and contribution."""
    early = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    recent = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    capture_listing_snapshots(conn, [listing()], early)
    capture_listing_snapshots(
        conn, [listing(views=30, favorites=5)], recent,
    )
    capture_order_facts(conn, [{
        "receipt_id": 9001,
        "transactions": [{
            "transaction_id": 77,
            "listing_id": 101,
            "sku": ["A35-DIG-ICE-0001"],
            "quantity": 1,
            "price": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
        }],
    }])
    record_experiment_cost(conn, 2, external_reference="listing-fees")

    report = revenue_report(conn)
    assert report["gross_revenue_usd"] == 12
    assert report["estimated_contribution_usd"] == 8.41
    assert report["profit_verified"] is False
    assert report["fee_data_complete"] is False
    assert report["budget_remaining_usd"] == 48
    assert report["top_demand"][0]["view_delta"] == 20
    assert report["top_demand"][0]["favorite_delta"] == 4


def test_old_receipt_does_not_reappear_as_current_revenue(conn):
    old_paid_timestamp = int(
        (datetime.now(timezone.utc) - timedelta(days=60)).timestamp()
    )
    capture_order_facts(conn, [{
        "receipt_id": 8001,
        "paid_timestamp": old_paid_timestamp,
        "transactions": [{
            "transaction_id": 55,
            "sku": ["A35-DIG-OLD"],
            "quantity": 1,
            "price": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
        }],
    }])
    assert revenue_report(conn, days=30)["orders"] == 0


def test_listing_fee_is_counted_for_each_transaction(conn):
    capture_order_facts(conn, [{
        "receipt_id": 9002,
        "transactions": [
            {
                "transaction_id": 1,
                "sku": ["A35-DIG-ONE"],
                "price": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
            },
            {
                "transaction_id": 2,
                "sku": ["A35-DIG-TWO"],
                "price": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
            },
        ],
    }])
    report = revenue_report(conn)
    assert report["transactions"] == 2
    assert report["estimated_etsy_fees_usd"] == 2.93


def test_actual_payment_fees_replace_estimate_when_complete(conn):
    capture_order_facts(conn, [{
        "receipt_id": 9003,
        "transactions": [{
            "transaction_id": 3,
            "sku": ["A35-DIG-ONE"],
            "price": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
        }],
    }])
    capture_payment_fact(conn, 9003, {
        "payment_id": 33,
        "amount_gross": {"amount": 1200, "divisor": 100, "currency_code": "USD"},
        "amount_fees": {"amount": 155, "divisor": 100, "currency_code": "USD"},
        "amount_net": {"amount": 1045, "divisor": 100, "currency_code": "USD"},
    })
    report = revenue_report(conn)
    assert report["fee_data_complete"] is True
    assert report["actual_etsy_fees_usd"] == 1.55
    assert report["estimated_contribution_usd"] == 10.45
