"""Tests for the SKU generator and COGS calculator."""

import pytest

from src.brand.sku import (
    calculate_min_price,
    create_sku_entry,
    generate_sku,
    get_base_cost,
)
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    c = get_initialized_connection(db_path)
    # Insert a test photo
    c.execute(
        "INSERT INTO photos (id, filename, path, imported_at) VALUES (?, ?, ?, ?)",
        ("photo123", "test.jpg", "/test.jpg", "2026-02-18T00:00:00Z"),
    )
    c.commit()
    return c


def test_generate_sku_format():
    """SKU should follow A35-XXX-NNNN-SIZE-PAPER-ED format."""
    sku = generate_sku("ICE", 42, "16R", "HAH", "OE")
    assert sku == "A35-ICE-0042-16R-HAH-OE"


def test_generate_sku_le():
    """Limited edition SKU should end with LE."""
    sku = generate_sku("TOK", 1, "20R", "CAN", "LE")
    assert sku == "A35-TOK-0001-20R-CAN-LE"


def test_get_base_cost_known():
    """Should return correct cost for known size/paper combo."""
    cost = get_base_cost("16R", "HAH")
    assert cost == 28.00


def test_get_base_cost_unknown():
    """Should return 0.0 for unknown combo."""
    cost = get_base_cost("99R", "XYZ")
    assert cost == 0.0


def test_calculate_min_price():
    """Min price should be higher than base cost."""
    base = get_base_cost("16R", "HAH")
    min_price = calculate_min_price(base, "16R")
    assert min_price > base
    assert min_price > 0


def test_min_price_covers_costs():
    """Min price should cover production + shipping + margin."""
    base = 28.00  # 16R HAH
    shipping = 14.00
    total_cost = base + shipping + 0.20  # listing fee
    min_price = calculate_min_price(base, "16R")
    assert min_price > total_cost * 1.3  # Should be well above costs


def test_create_sku_entry(conn):
    """Should create a SKU entry in the database."""
    sku = create_sku_entry(conn, "photo123", "ICE", 42, "16R", "HAH")
    assert sku == "A35-ICE-0042-16R-HAH-OE"

    row = conn.execute("SELECT * FROM sku_catalog WHERE sku = ?", (sku,)).fetchone()
    assert row is not None
    assert row["list_price_usd"] >= row["min_price_usd"]
    assert row["min_price_usd"] >= row["base_cost_usd"]


def test_create_sku_with_price_override(conn):
    """Should respect price override."""
    sku = create_sku_entry(
        conn, "photo123", "ICE", 43, "16R", "HAH",
        list_price_override=150.00,
    )
    row = conn.execute("SELECT list_price_usd FROM sku_catalog WHERE sku = ?", (sku,)).fetchone()
    assert row["list_price_usd"] == 150.00
