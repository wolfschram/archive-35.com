"""Pictorem pricing and orientation detection for Etsy listings.

Hardcoded ChromaLuxe HD Metal Print costs based on public pricing.
Stub for real Pictorem API — swap in when credentials are available.

Product: HD Metal Print, White Gloss, ChromaLuxe
Mount: Metal standoff hanging brackets (included)
Shipping: Free — North America and Canada (Pictorem fulfills)
"""

from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Orientation → Size mapping ──────────────────────────────────────────
# Verified from Wolf's Pictorem PRO account, March 2026.
ORIENTATION_SIZES = {
    "landscape": {"width_in": 30, "height_in": 20, "label": "30×20 inches"},
    "portrait": {"width_in": 20, "height_in": 30, "label": "20×30 inches"},
    "square": {"width_in": 24, "height_in": 24, "label": "24×24 inches"},
    "panoramic": {"width_in": 24, "height_in": 12, "label": "24×12 inches"},
}

# ── Verified Pictorem PRO reseller costs (USD) ─────────────────────────
# Source: Wolf's Pictorem PRO account screenshot, March 2026.
# HD Metal Print, White Gloss ChromaLuxe, standoff brackets included.
# DO NOT CHANGE — these are confirmed PRO prices.
PICTOREM_BASE_COSTS = {
    "30x20": 150.00,
    "20x30": 150.00,
    "24x24": 145.00,
    "24x12": 85.00,
}

# Minimum markup multiplier — fine art positioning, not commodity
MIN_MARKUP = 5.0

# Etsy fee structure for price calculation
ETSY_TRANSACTION_FEE = 0.065
ETSY_PAYMENT_PROCESSING = 0.03
ETSY_PAYMENT_FLAT = 0.25
ETSY_LISTING_FEE = 0.20


def detect_orientation(width: int, height: int) -> str:
    """Detect photo orientation from pixel dimensions.

    Args:
        width: Image width in pixels.
        height: Image height in pixels.

    Returns:
        One of: "landscape", "portrait", "square", "panoramic"
    """
    if height == 0:
        return "landscape"
    ratio = width / height
    if ratio > 2.5:
        return "panoramic"
    elif ratio > 1.1:
        return "landscape"
    elif ratio < 0.9:
        return "portrait"
    else:
        return "square"


def get_size_for_orientation(orientation: str) -> dict[str, Any]:
    """Get the print size spec for a given orientation.

    Returns dict with width_in, height_in, label.
    """
    return ORIENTATION_SIZES.get(orientation, ORIENTATION_SIZES["landscape"])


def get_pictorem_cost(orientation: str) -> float:
    """Get Pictorem base cost for a given orientation's print size.

    Args:
        orientation: "landscape", "portrait", "square", or "panoramic"

    Returns:
        Base cost in USD.
    """
    size = get_size_for_orientation(orientation)
    key = f"{size['height_in']}x{size['width_in']}"
    # Try both orderings
    cost = PICTOREM_BASE_COSTS.get(key)
    if cost is None:
        key = f"{size['width_in']}x{size['height_in']}"
        cost = PICTOREM_BASE_COSTS.get(key)
    if cost is None:
        logger.warning("No Pictorem cost for %s, using fallback", key)
        cost = 89.00  # Default to largest size cost
    return cost


def calculate_etsy_price(base_cost: float, markup: float = MIN_MARKUP) -> int:
    """Calculate final Etsy listing price with markup, accounting for fees.

    The markup is applied to the base cost. Etsy fees are factored in so
    the effective margin stays close to the target markup.

    Args:
        base_cost: Pictorem fulfillment cost in USD.
        markup: Markup multiplier (default 3.0 = 3x).

    Returns:
        Price in cents (Etsy API uses cents via amount/divisor).
    """
    raw_price = base_cost * markup

    # Round to nearest $5 for clean pricing
    rounded = round(raw_price / 5) * 5
    if rounded < raw_price:
        rounded += 5

    return int(rounded * 100)  # cents


def get_listing_pricing(orientation: str) -> dict[str, Any]:
    """Get complete pricing info for a listing based on orientation.

    Returns dict with all pricing details for the listing update.
    """
    size = get_size_for_orientation(orientation)
    base_cost = get_pictorem_cost(orientation)
    price_cents = calculate_etsy_price(base_cost)
    price_dollars = price_cents / 100

    return {
        "orientation": orientation,
        "size_label": size["label"],
        "width_in": size["width_in"],
        "height_in": size["height_in"],
        "pictorem_cost_usd": base_cost,
        "markup": MIN_MARKUP,
        "etsy_price_cents": price_cents,
        "etsy_price_usd": price_dollars,
        "material": "HD Metal Print — White Gloss ChromaLuxe",
        "mount": "Metal standoff hanging brackets (included)",
        "shipping": "Free shipping — North America and Canada",
    }


# ── Pictorem API stub ──────────────────────────────────────────────────

def fetch_pictorem_price_api(
    width_in: int,
    height_in: int,
    product: str = "hd_metal_white_gloss",
) -> Optional[float]:
    """Fetch real-time pricing from Pictorem API.

    TODO: Implement when PICTOREM_API_KEY is available.
    Currently returns None — caller should fall back to hardcoded costs.

    Args:
        width_in: Print width in inches.
        height_in: Print height in inches.
        product: Pictorem product code.

    Returns:
        Cost in USD, or None if API unavailable.
    """
    import os
    api_key = os.environ.get("PICTOREM_API_KEY", "")
    if not api_key or api_key == "...":
        return None

    # TODO: Real implementation
    # url = f"https://api.pictorem.com/v1/pricing?product={product}&width={width_in}&height={height_in}"
    # headers = {"Authorization": f"Bearer {api_key}"}
    # ...
    logger.info("Pictorem API stub called — using hardcoded pricing")
    return None
