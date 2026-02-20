"""Archive-35 Pricing Engine.

Mirrors the website's product-selector.js pricing EXACTLY,
then adds Etsy marketplace markup to cover platform fees.

Website formula:
    base_size = 96 sq in (12×8)
    ratio = size_inches / base_size
    scale_factor = ratio ** 0.75
    price = round(base_price * scale_factor)

Etsy markup formula:
    etsy_price = website_price / (1 - total_etsy_fee_rate)
    Covers: 6.5% transaction + 3% payment processing + $0.25 flat + $0.20 listing
"""

from __future__ import annotations

import math
from typing import Optional

# ── Website Materials (matches product-selector.js) ──────────────────────

MATERIALS = {
    "canvas": {"name": "Canvas", "base_price": 82, "max_sq_in": 2400,
               "pictorem_type": "stretched", "pictorem_extras": "semigloss|mirrorimage|c15|none|none"},
    "metal": {"name": "Metal", "base_price": 99, "max_sq_in": 2400,
              "pictorem_type": "al", "pictorem_extras": "none|none"},
    "acrylic": {"name": "Acrylic", "base_price": 149, "max_sq_in": 2400,
                "pictorem_type": "ac220", "pictorem_extras": "none|none"},
    "paper": {"name": "Fine Art Paper", "base_price": 45, "max_sq_in": 2400,
              "pictorem_type": "art", "pictorem_extras": "none|none"},
    "wood": {"name": "Wood", "base_price": 92, "max_sq_in": 2400,
             "pictorem_type": "ru14", "pictorem_extras": "none|none"},
}

# ── Aspect Ratio Size Tables (matches product-selector.js) ──────────────

ASPECT_RATIO_CATEGORIES = {
    "standard_3_2": {
        "name": "Standard 3:2", "range": (1.4, 1.6),
        "sizes": [(12, 8), (18, 12), (24, 16), (36, 24), (48, 32), (60, 40)],
    },
    "wide_16_9": {
        "name": "Wide 16:9", "range": (1.6, 1.9),
        "sizes": [(16, 9), (24, 14), (32, 18), (48, 27)],
    },
    "four_3": {
        "name": "4:3 Ratio", "range": (1.2, 1.4),
        "sizes": [(16, 12), (20, 16), (24, 18), (40, 30)],
    },
    "square": {
        "name": "Square", "range": (0.95, 1.05),
        "sizes": [(12, 12), (20, 20), (30, 30)],
    },
    "panorama_2_1": {
        "name": "Panorama 2:1", "range": (1.9, 2.2),
        "sizes": [(24, 12), (36, 18), (48, 24)],
    },
    "panorama_12_5": {
        "name": "Wide Panorama 12:5", "range": (2.2, 2.7),
        "sizes": [(24, 10), (36, 15), (48, 20), (60, 25)],
    },
    "panorama_3_1": {
        "name": "Panorama 3:1", "range": (2.7, 3.3),
        "sizes": [(36, 12), (48, 16), (60, 20)],
    },
    "ultra_wide_4_1": {
        "name": "Ultra-Wide 4:1+", "range": (3.3, float("inf")),
        "sizes": [(42, 12), (56, 16), (60, 15), (72, 18)],
    },
}

# ── Etsy Fee Structure ───────────────────────────────────────────────────

ETSY_TRANSACTION_FEE = 0.065     # 6.5% of sale price
ETSY_PAYMENT_PROCESSING = 0.03   # 3% of sale price
ETSY_PAYMENT_FLAT = 0.25         # $0.25 per transaction
ETSY_LISTING_FEE = 0.20          # $0.20 per listing (one-time per 4 months)
ETSY_TOTAL_PERCENTAGE = ETSY_TRANSACTION_FEE + ETSY_PAYMENT_PROCESSING  # 9.5%


# ── Core Pricing Functions ───────────────────────────────────────────────

def website_price(material_key: str, width_in: int, height_in: int) -> int:
    """Calculate website price — EXACT mirror of product-selector.js.

    Args:
        material_key: 'canvas', 'metal', 'acrylic', 'paper', 'wood'
        width_in: Print width in inches
        height_in: Print height in inches

    Returns:
        Price in whole USD (rounded)
    """
    material = MATERIALS.get(material_key)
    if not material:
        return 0
    base_price = material["base_price"]
    size_inches = width_in * height_in
    base_size = 96  # 12×8 = smallest print
    ratio = size_inches / base_size
    scale_factor = math.pow(ratio, 0.75)
    return round(base_price * scale_factor)


def etsy_price(site_price: int) -> int:
    """Calculate Etsy list price that nets the website price after fees.

    Etsy takes ~9.5% + $0.45 per sale. This inverts that so Wolf
    receives the same revenue as a direct website sale.

    Args:
        site_price: Website retail price in USD

    Returns:
        Etsy list price in whole USD (rounded up)
    """
    # price_after_fees = etsy_price * (1 - 0.095) - 0.45
    # We want price_after_fees >= site_price
    # etsy_price = (site_price + 0.45) / (1 - 0.095)
    raw = (site_price + ETSY_PAYMENT_FLAT + ETSY_LISTING_FEE) / (1 - ETSY_TOTAL_PERCENTAGE)
    return math.ceil(raw)  # Round up to never lose margin


def calculate_dpi(photo_w: int, photo_h: int, print_w: int, print_h: int) -> int:
    """Calculate print DPI from photo and print dimensions."""
    dpi_w = photo_w / print_w
    dpi_h = photo_h / print_h
    return round(min(dpi_w, dpi_h))


def get_quality_badge(dpi: int) -> Optional[str]:
    """Get quality tier for a given DPI. None if below minimum."""
    if dpi >= 300:
        return "Museum Quality"
    elif dpi >= 200:
        return "Excellent"
    elif dpi >= 150:
        return "Good"
    return None  # Below minimum — don't offer this size


def get_matching_category(aspect_ratio: float) -> Optional[dict]:
    """Find the best aspect ratio category for a photo."""
    # Pass 1: exact range match
    for key, cat in ASPECT_RATIO_CATEGORIES.items():
        lo, hi = cat["range"]
        if lo <= aspect_ratio <= hi:
            return {"key": key, **cat}

    # Pass 2: tolerance match (10%)
    tolerance = 0.1
    best = None
    best_count = 0
    for key, cat in ASPECT_RATIO_CATEGORIES.items():
        lo, hi = cat["range"]
        if aspect_ratio >= lo * (1 - tolerance) and aspect_ratio <= hi * (1 + tolerance):
            sizes = filter_sizes_by_aspect(cat["sizes"], aspect_ratio, tolerance)
            if len(sizes) > best_count:
                best_count = len(sizes)
                best = {"key": key, **cat}

    return best or {"key": "standard_3_2", **ASPECT_RATIO_CATEGORIES["standard_3_2"]}


def filter_sizes_by_aspect(
    sizes: list[tuple[int, int]], aspect_ratio: float, tolerance: float = 0.1
) -> list[tuple[int, int]]:
    """Filter sizes that match a photo's aspect ratio within tolerance."""
    result = []
    for w, h in sizes:
        size_ratio = w / h
        if (size_ratio >= aspect_ratio * (1 - tolerance) and
                size_ratio <= aspect_ratio * (1 + tolerance)):
            result.append((w, h))
    return result


def get_available_products(
    photo_width: int,
    photo_height: int,
    min_dpi: int = 150,
) -> list[dict]:
    """Get all available print products for a photo with pricing.

    Returns a list of dicts with material, size, website price,
    Etsy price, DPI, and quality badge for every valid combo.
    """
    aspect_ratio = photo_width / photo_height if photo_height > 0 else 1.5
    category = get_matching_category(aspect_ratio)
    applicable_sizes = filter_sizes_by_aspect(category["sizes"], aspect_ratio)

    products = []
    for material_key, material in MATERIALS.items():
        for w, h in applicable_sizes:
            dpi = calculate_dpi(photo_width, photo_height, w, h)
            quality = get_quality_badge(dpi)
            if not quality:
                continue  # Below minimum DPI threshold

            sq_in = w * h
            if sq_in > material["max_sq_in"]:
                continue  # Exceeds material max size

            site_p = website_price(material_key, w, h)
            etsy_p = etsy_price(site_p)

            products.append({
                "material_key": material_key,
                "material_name": material["name"],
                "width": w,
                "height": h,
                "sq_in": sq_in,
                "dpi": dpi,
                "quality": quality,
                "website_price": site_p,
                "etsy_price": etsy_p,
                "etsy_markup": etsy_p - site_p,
                "aspect_category": category["name"],
                "pictorem_type": material["pictorem_type"],
                "pictorem_extras": material["pictorem_extras"],
            })

    return products


def build_pictorem_preorder(
    material_key: str, width: int, height: int, quantity: int = 1
) -> str:
    """Build a Pictorem preorder code for fulfillment.

    Format: qty|material|type|orientation|width|height|extras...
    """
    material = MATERIALS.get(material_key)
    if not material:
        return ""

    orientation = "horizontal" if width >= height else "vertical"
    extras = material["pictorem_extras"]

    return f"{quantity}|{material_key}|{material['pictorem_type']}|{orientation}|{width}|{height}|{extras}"
