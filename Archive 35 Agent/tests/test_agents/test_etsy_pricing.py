"""Tests for Pictorem pricing and orientation detection."""

import pytest

from src.agents.etsy_pricing import (
    detect_orientation,
    get_size_for_orientation,
    get_pictorem_cost,
    calculate_etsy_price,
    get_listing_pricing,
)


class TestDetectOrientation:
    def test_landscape(self):
        assert detect_orientation(2000, 1333) == "landscape"

    def test_portrait(self):
        assert detect_orientation(1333, 2000) == "portrait"

    def test_square(self):
        assert detect_orientation(2000, 2000) == "square"

    def test_near_square_landscape(self):
        assert detect_orientation(2000, 1900) == "square"

    def test_panoramic(self):
        assert detect_orientation(3000, 1000) == "panoramic"

    def test_wide_but_not_panoramic(self):
        # 2.4x ratio — landscape, not panoramic (threshold is 2.5)
        assert detect_orientation(2400, 1000) == "landscape"

    def test_zero_height(self):
        assert detect_orientation(2000, 0) == "landscape"


class TestGetSizeForOrientation:
    def test_landscape_size(self):
        size = get_size_for_orientation("landscape")
        assert size["width_in"] == 30
        assert size["height_in"] == 20
        assert "30×20" in size["label"]

    def test_portrait_size(self):
        size = get_size_for_orientation("portrait")
        assert size["width_in"] == 20
        assert size["height_in"] == 30

    def test_square_size(self):
        size = get_size_for_orientation("square")
        assert size["width_in"] == 24
        assert size["height_in"] == 24

    def test_panoramic_size(self):
        size = get_size_for_orientation("panoramic")
        assert size["width_in"] == 24
        assert size["height_in"] == 12

    def test_unknown_defaults_to_landscape(self):
        size = get_size_for_orientation("unknown")
        assert size["width_in"] == 30


class TestPictoremCost:
    def test_landscape_cost(self):
        cost = get_pictorem_cost("landscape")
        assert cost == 150.00

    def test_portrait_cost(self):
        cost = get_pictorem_cost("portrait")
        assert cost == 150.00

    def test_square_cost(self):
        cost = get_pictorem_cost("square")
        assert cost == 145.00

    def test_panoramic_cost(self):
        cost = get_pictorem_cost("panoramic")
        assert cost == 85.00


class TestCalculateEtsyPrice:
    def test_5x_markup_landscape(self):
        # 150 * 5 = 750
        price_cents = calculate_etsy_price(150.00, 5.0)
        assert price_cents == 75000

    def test_5x_markup_portrait(self):
        # 150 * 5 = 750
        price_cents = calculate_etsy_price(150.00, 5.0)
        assert price_cents == 75000

    def test_5x_markup_square(self):
        # 145 * 5 = 725
        price_cents = calculate_etsy_price(145.00, 5.0)
        assert price_cents == 72500

    def test_5x_markup_panoramic(self):
        # 85 * 5 = 425
        price_cents = calculate_etsy_price(85.00, 5.0)
        assert price_cents == 42500

    def test_price_always_positive(self):
        price_cents = calculate_etsy_price(10.00, 5.0)
        assert price_cents > 0


class TestGetListingPricing:
    def test_landscape_full_pricing(self):
        p = get_listing_pricing("landscape")
        assert p["orientation"] == "landscape"
        assert p["size_label"] == "30×20 inches"
        assert p["pictorem_cost_usd"] == 150.00
        assert p["etsy_price_usd"] == 750.00
        assert "ChromaLuxe" in p["material"]
        assert "standoff" in p["mount"]
        assert "Free shipping" in p["shipping"]
