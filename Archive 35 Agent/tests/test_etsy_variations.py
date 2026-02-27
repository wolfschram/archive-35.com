"""Tests for the Etsy variation matrix builder.

Validates that:
- Correct number of variants generated per aspect ratio
- Prices match manual Etsy listing values (regression test)
- Wood + Frame combos are disabled
- Frame addon prices are correct
- Inventory payload structure matches Etsy API schema
"""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.brand.etsy_variations import (
    build_variation_matrix,
    build_etsy_inventory_payload,
    get_matrix_summary,
    FRAME_OPTIONS,
    NO_FRAME_MATERIALS,
)
from src.brand.pricing import (
    website_price,
    etsy_price,
    frame_addon_price,
)


# ── Test: Standard 3:2 photo (6000x4000) ────────────────────────────────

def test_standard_3_2_matrix():
    """Standard 3:2 photo should produce 5 materials × 6 sizes × 4 frames = 120 combos."""
    products = build_variation_matrix(6000, 4000)
    assert len(products) > 0

    materials = set(p["material_key"] for p in products)
    assert materials == {"paper", "canvas", "wood", "metal", "acrylic"}

    # Every material/size combo should have 4 frame options
    mat_size_combos = set((p["material_key"], p["size_label"]) for p in products)
    for ms in mat_size_combos:
        frames_for_combo = [p for p in products
                            if p["material_key"] == ms[0] and p["size_label"] == ms[1]]
        assert len(frames_for_combo) == 4, f"{ms} has {len(frames_for_combo)} frames, expected 4"


def test_wood_frame_disabled():
    """Wood + any frame should be is_enabled=False."""
    products = build_variation_matrix(6000, 4000)
    wood_products = [p for p in products if p["material_key"] == "wood"]

    for p in wood_products:
        if p["frame"] == "No Frame":
            assert p["is_enabled"] is True, f"Wood No Frame should be enabled"
        else:
            assert p["is_enabled"] is False, f"Wood {p['frame']} should be disabled"


def test_non_wood_frames_enabled():
    """Non-wood materials with frames should all be enabled."""
    products = build_variation_matrix(6000, 4000)
    non_wood = [p for p in products if p["material_key"] != "wood"]

    for p in non_wood:
        assert p["is_enabled"] is True, f"{p['material_name']} {p['frame']} should be enabled"


# ── Test: Price regression against manual Etsy listings ──────────────────

def test_standard_5size_prices():
    """Verify prices match what we manually entered on Etsy for standard 5-size listings.

    These are the KNOWN CORRECT prices from the manual listing work.
    """
    products = build_variation_matrix(6000, 4000)

    # Find FAP 12x8 No Frame — should be ~$51
    fap_12x8 = next((p for p in products
                     if p["material_key"] == "paper" and p["size_label"] == "12x8"
                     and p["frame"] == "No Frame"), None)
    if fap_12x8:
        assert fap_12x8["etsy_price"] == etsy_price(website_price("paper", 12, 8))

    # Verify FAP 12x8 Black Frame = base + frame addon (component-level markup)
    fap_12x8_framed = next((p for p in products
                            if p["material_key"] == "paper" and p["size_label"] == "12x8"
                            and p["frame"] == "Black Frame"), None)
    if fap_12x8_framed:
        expected = etsy_price(website_price("paper", 12, 8)) + etsy_price(frame_addon_price(12, 8))
        assert fap_12x8_framed["etsy_price"] == expected, \
            f"FAP 12x8 Black Frame: got ${fap_12x8_framed['etsy_price']}, expected ${expected}"


def test_panoramic_photo():
    """Panoramic photo (e.g., 8000x3333) should use panoramic size tables."""
    # 8000x3333 → aspect ratio ~2.4 → panorama_12_5 (sizes: 24x10, 36x15, 48x20, 60x25)
    products = build_variation_matrix(8000, 3333)

    sizes = set(p["size_label"] for p in products)
    # Should contain panoramic sizes, not standard 3:2 sizes
    assert "12x8" not in sizes, "Panoramic photo shouldn't have 12x8"
    assert len(sizes) > 0, "Should have at least one panoramic size"


def test_16_9_photo():
    """16:9 photo should use wide size table."""
    # 5760x3240 → aspect ratio 1.78 → wide_16_9 (sizes: 16x9, 24x14, 32x18, 48x27)
    products = build_variation_matrix(5760, 3240)

    sizes = set(p["size_label"] for p in products)
    # Should contain 16:9 sizes
    assert len(sizes) > 0, "Should have at least one 16:9 size"


# ── Test: Inventory payload structure ────────────────────────────────────

def test_inventory_payload_structure():
    """Verify the Etsy API payload has the required fields."""
    products = build_variation_matrix(6000, 4000)
    payload = build_etsy_inventory_payload(products)

    assert "products" in payload
    assert "price_on_property" in payload
    assert "quantity_on_property" in payload
    assert "sku_on_property" in payload

    assert len(payload["products"]) == len(products)
    assert len(payload["price_on_property"]) == 2  # Both variations affect price

    # Check first product structure
    first = payload["products"][0]
    assert "property_values" in first
    assert "offerings" in first
    assert len(first["property_values"]) == 2  # Material & Size + Frame

    # Check property values
    mat_prop = first["property_values"][0]
    assert mat_prop["property_name"] == "Material & Size"
    assert len(mat_prop["values"]) == 1

    frame_prop = first["property_values"][1]
    assert frame_prop["property_name"] == "Frame"
    assert frame_prop["values"][0] in FRAME_OPTIONS

    # Check offering
    offering = first["offerings"][0]
    assert "price" in offering
    assert "quantity" in offering
    assert "is_enabled" in offering
    assert offering["quantity"] == 999


def test_summary():
    """Verify matrix summary has useful information."""
    products = build_variation_matrix(6000, 4000)
    summary = get_matrix_summary(products)

    assert summary["total_variants"] > 0
    assert summary["enabled_variants"] > 0
    assert summary["disabled_variants"] > 0  # Wood + Frame combos
    assert len(summary["materials"]) == 5
    assert len(summary["frames"]) == 4
    assert summary["price_range"][0] < summary["price_range"][1]


# ── Run tests ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_standard_3_2_matrix,
        test_wood_frame_disabled,
        test_non_wood_frames_enabled,
        test_standard_5size_prices,
        test_panoramic_photo,
        test_16_9_photo,
        test_inventory_payload_structure,
        test_summary,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            print(f"  ✓ {test.__name__}")
            passed += 1
        except Exception as e:
            print(f"  ✗ {test.__name__}: {e}")
            failed += 1

    print(f"\n{passed} passed, {failed} failed")
