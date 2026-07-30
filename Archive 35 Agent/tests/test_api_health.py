"""Health endpoint tests for measured Etsy state."""

from src import api
from src.db import get_initialized_connection


def test_health_uses_latest_etsy_snapshot_and_order_facts(tmp_path, monkeypatch):
    conn = get_initialized_connection(tmp_path / "health.db")
    conn.executemany(
        """INSERT INTO etsy_listing_snapshots
           (captured_at, listing_id, state, title)
           VALUES (?, ?, ?, ?)""",
        [
            ("2026-07-29T00:00:00Z", 1, "active", "Old listing"),
            ("2026-07-30T00:00:00Z", 1, "active", "Current listing"),
            ("2026-07-30T00:00:00Z", 2, "inactive", "Inactive listing"),
        ],
    )
    conn.execute(
        """INSERT INTO etsy_order_facts
           (order_key, receipt_id, quantity, gross_usd, captured_at)
           VALUES ('order-1', 99, 1, 9, '2026-07-30T00:00:00Z')"""
    )
    conn.commit()
    monkeypatch.setattr(api, "_get_conn", lambda: conn)

    result = api.health()

    assert result["status"] == "online"
    assert result["etsy_listings"] == 1
    assert result["sales"] == 1
