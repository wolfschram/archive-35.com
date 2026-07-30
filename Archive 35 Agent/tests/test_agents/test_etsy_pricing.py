"""Tests for DPI-aware Pictorem pricing and Etsy fee coverage."""

import math

import pytest

from src.agents.etsy_pricing import (
    MIN_DPI,
    calculate_best_size,
    detect_orientation,
    get_listing_pricing,
)
from src.brand.pricing import ETSY_LISTING_FEE, ETSY_PAYMENT_FLAT, ETSY_TOTAL_PERCENTAGE


@pytest.mark.parametrize(
    ("width", "height", "expected"),
    [
        (2000, 1333, "landscape"),
        (1333, 2000, "portrait"),
        (2000, 2000, "square"),
        (2000, 1900, "square"),
        (3000, 1000, "panoramic"),
        (2400, 1000, "panoramic"),
        (2000, 0, "landscape"),
    ],
)
def test_detect_orientation(width, height, expected):
    assert detect_orientation(width, height) == expected


@pytest.mark.parametrize(
    ("dimensions", "orientation", "size", "cost", "site_price", "etsy_price"),
    [
        ((6000, 4000), "landscape", (36, 24), 204.73, 409, 453),
        ((4000, 6000), "portrait", (24, 36), 204.73, 409, 453),
        ((6000, 6000), "square", (30, 30), 212.21, 424, 470),
        ((6000, 2000), "panoramic", (36, 12), 114.97, 230, 255),
    ],
)
def test_listing_pricing_uses_verified_cost_table(
    dimensions, orientation, size, cost, site_price, etsy_price
):
    pricing = get_listing_pricing(photo_w=dimensions[0], photo_h=dimensions[1])
    assert pricing["orientation"] == orientation
    assert (pricing["width_in"], pricing["height_in"]) == size
    assert pricing["dpi"] >= MIN_DPI
    assert pricing["pictorem_cost_usd"] == cost
    assert pricing["website_price_usd"] == site_price
    assert pricing["etsy_price_usd"] == etsy_price


def test_etsy_price_covers_site_revenue_after_marketplace_fees():
    pricing = get_listing_pricing(photo_w=6000, photo_h=4000)
    net_after_fees = (
        pricing["etsy_price_usd"] * (1 - ETSY_TOTAL_PERCENTAGE)
        - ETSY_PAYMENT_FLAT
        - ETSY_LISTING_FEE
    )
    assert net_after_fees >= pricing["website_price_usd"]
    assert pricing["website_price_usd"] >= math.floor(
        pricing["pictorem_cost_usd"] * 2
    )


def test_best_size_never_drops_below_print_quality_floor():
    size = calculate_best_size(6000, 4000)
    assert size is not None
    assert size["dpi"] >= MIN_DPI
