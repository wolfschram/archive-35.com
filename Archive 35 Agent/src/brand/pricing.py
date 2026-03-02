"""Archive-35 Pricing Engine.

Mirrors the website's product-selector.js pricing EXACTLY,
then adds Etsy marketplace markup to cover platform fees.

Pricing method: Per-size lookup table based on REAL Pictorem API costs.
    retail_price = round(pictorem_cost × 2)  → exact 50% margin
    Verified via Pictorem getprice API on 2026-03-02.

Default material configurations (what Pictorem charges us):
    Canvas:  gallery wrap (stretched, semigloss, mirror edge, 1.5" depth)
    Metal:   ChromaLuxe HD + standoff mounting
    Acrylic: ac220 + standoff mounting
    Paper:   fine art paper (bare)
    Wood:    rustic plywood (bare, french cleat is free)

Frame add-on tiers (~20% margin over Pictorem frame cost, API-verified):
    ≤144 sq in → $65, ≤288 → $75, ≤480 → $85,
    ≤864 → $130, ≤1536 → $170, else → $235

Etsy markup formula:
    etsy_price = website_price / (1 - total_etsy_fee_rate)
    Covers: 6.5% transaction + 3% payment processing + $0.25 flat + $0.20 listing
"""

from __future__ import annotations

import math
from typing import Optional

# ── Price Lookup Table (Pictorem API cost × 2, verified 2026-03-02) ──────
# Every price guarantees exactly 50% margin over real Pictorem fulfillment cost.

PRICE_TABLE = {
    "canvas": { (12,8): 101, (16,9): 109, (12,12): 90, (16,12): 98, (18,12): 120, (24,10): 124, (24,12): 113, (20,16): 137, (24,14): 140, (24,16): 129, (20,20): 151, (24,18): 156, (36,12): 137, (42,12): 168, (36,15): 174, (32,18): 179, (36,18): 191, (48,16): 192, (36,24): 208, (56,16): 232, (30,30): 214, (60,15): 233, (48,20): 242, (48,24): 255, (40,30): 282, (60,20): 282, (48,27): 298, (72,18): 459, (60,25): 331, (48,32): 337, (60,40): 640 },
    "metal": { (12,8): 90, (16,9): 110, (12,12): 110, (16,12): 130, (18,12): 140, (24,10): 150, (24,12): 170, (20,16): 183, (24,14): 190, (24,16): 210, (20,20): 217, (24,18): 230, (36,12): 230, (42,12): 260, (36,15): 275, (32,18): 290, (36,18): 320, (48,16): 370, (36,24): 409, (56,16): 423, (30,30): 424, (60,15): 424, (48,20): 449, (48,24): 529, (40,30): 549, (60,20): 549, (48,27): 589, (72,18): 750, (60,25): 674, (48,32): 689, (60,40): 1209 },
    "acrylic": { (12,8): 123, (16,9): 142, (12,12): 142, (16,12): 160, (18,12): 170, (24,10): 179, (24,12): 197, (20,16): 210, (24,14): 216, (24,16): 234, (20,20): 240, (24,18): 253, (36,12): 253, (42,12): 281, (36,15): 294, (32,18): 308, (36,18): 336, (48,16): 382, (36,24): 419, (56,16): 432, (30,30): 433, (60,15): 433, (48,20): 456, (48,24): 530, (40,30): 549, (60,20): 549, (48,27): 586, (72,18): 747, (60,25): 664, (48,32): 678, (60,40): 1173 },
    "paper": { (12,8): 33, (16,9): 37, (12,12): 37, (16,12): 42, (18,12): 44, (24,10): 46, (24,12): 50, (20,16): 53, (24,14): 54, (24,16): 59, (20,20): 60, (24,18): 63, (36,12): 63, (42,12): 69, (36,15): 72, (32,18): 75, (36,18): 82, (48,16): 92, (36,24): 101, (56,16): 104, (30,30): 104, (60,15): 104, (48,20): 109, (48,24): 126, (40,30): 131, (60,20): 131, (48,27): 139, (72,18): 139, (60,25): 157, (48,32): 160, (60,40): 237 },
    "wood": { (12,8): 54, (16,9): 66, (12,12): 66, (16,12): 79, (18,12): 85, (24,10): 92, (24,12): 104, (20,16): 113, (24,14): 117, (24,16): 130, (20,20): 134, (24,18): 143, (36,12): 143, (42,12): 162, (36,15): 171, (32,18): 181, (36,18): 200, (48,16): 231, (36,24): 257, (56,16): 265, (30,30): 266, (60,15): 266, (48,20): 282, (48,24): 333, (40,30): 346, (60,20): 346, (48,27): 371, (72,18): 533, (60,25): 425, (48,32): 435, (60,40): 825 },
}

# ── Pictorem Cost Table (for margin verification & cost reporting) ────────

PICTOREM_COSTS = {
    "canvas": { (12,8): 50.37, (16,9): 54.30, (12,12): 44.86, (16,12): 48.80, (18,12): 60.21, (24,10): 62.18, (24,12): 56.67, (20,16): 68.74, (24,14): 70.05, (24,16): 64.54, (20,20): 75.30, (24,18): 77.92, (36,12): 68.48, (42,12): 83.83, (36,15): 86.78, (32,18): 89.73, (36,18): 95.64, (48,16): 96.03, (36,24): 103.90, (56,16): 115.97, (30,30): 106.86, (60,15): 116.30, (48,20): 121.22, (48,24): 127.52, (40,30): 140.90, (60,20): 140.90, (48,27): 148.78, (72,18): 229.53, (60,25): 165.50, (48,32): 168.46, (60,40): 320.06 },
    "metal": { (12,8): 45.16, (16,9): 55.13, (12,12): 55.13, (16,12): 65.10, (18,12): 70.09, (24,10): 75.08, (24,12): 85.05, (20,16): 91.70, (24,14): 95.02, (24,16): 105.00, (20,20): 108.32, (24,18): 114.97, (36,12): 114.97, (42,12): 129.93, (36,15): 137.41, (32,18): 144.89, (36,18): 159.85, (48,16): 184.78, (36,24): 204.73, (56,16): 211.38, (30,30): 212.21, (60,15): 212.21, (48,20): 224.68, (48,24): 264.57, (40,30): 274.54, (60,20): 274.54, (48,27): 294.49, (72,18): 375.24, (60,25): 336.88, (48,32): 344.36, (60,40): 604.63 },
    "acrylic": { (12,8): 61.66, (16,9): 70.90, (12,12): 70.90, (16,12): 80.15, (18,12): 84.78, (24,10): 89.40, (24,12): 98.65, (20,16): 104.81, (24,14): 107.90, (24,16): 117.14, (20,20): 120.23, (24,18): 126.39, (36,12): 126.39, (42,12): 140.26, (36,15): 147.20, (32,18): 154.14, (36,18): 168.01, (48,16): 191.13, (36,24): 209.62, (56,16): 215.79, (30,30): 216.56, (60,15): 216.56, (48,20): 228.12, (48,24): 265.11, (40,30): 274.36, (60,20): 274.36, (48,27): 292.86, (72,18): 373.61, (60,25): 332.16, (48,32): 339.10, (60,40): 586.31 },
    "paper": { (12,8): 16.52, (16,9): 18.64, (12,12): 18.64, (16,12): 20.76, (18,12): 21.82, (24,10): 22.89, (24,12): 25.01, (20,16): 26.42, (24,14): 27.13, (24,16): 29.25, (20,20): 29.96, (24,18): 31.37, (36,12): 31.37, (42,12): 34.55, (36,15): 36.15, (32,18): 37.74, (36,18): 40.92, (48,16): 46.22, (36,24): 50.47, (56,16): 51.88, (30,30): 52.06, (60,15): 52.06, (48,20): 54.71, (48,24): 63.20, (40,30): 65.32, (60,20): 65.32, (48,27): 69.56, (72,18): 69.56, (60,25): 78.58, (48,32): 80.17, (60,40): 118.36 },
    "wood": { (12,8): 26.86, (16,9): 33.21, (12,12): 33.21, (16,12): 39.55, (18,12): 42.73, (24,10): 45.90, (24,12): 52.25, (20,16): 56.48, (24,14): 58.59, (24,16): 64.94, (20,20): 67.06, (24,18): 71.29, (36,12): 71.29, (42,12): 80.81, (36,15): 85.57, (32,18): 90.33, (36,18): 99.85, (48,16): 115.71, (36,24): 128.41, (56,16): 132.64, (30,30): 133.17, (60,15): 133.17, (48,20): 141.10, (48,24): 166.49, (40,30): 172.83, (60,20): 172.83, (48,27): 185.53, (72,18): 266.28, (60,25): 212.50, (48,32): 217.26, (60,40): 412.25 },
}

# ── Material Metadata (for Pictorem fulfillment codes) ───────────────────

MATERIALS = {
    "canvas": {"name": "Canvas", "max_sq_in": 2400,
               "pictorem_type": "stretched", "pictorem_extras": "semigloss|mirrorimage|c15|none|none"},
    "metal": {"name": "Metal", "max_sq_in": 2400,
              "pictorem_type": "hd", "pictorem_extras": "standoff"},
    "acrylic": {"name": "Acrylic", "max_sq_in": 2400,
                "pictorem_type": "ac220", "pictorem_extras": "standoff"},
    "paper": {"name": "Fine Art Paper", "max_sq_in": 2400,
              "pictorem_type": "art", "pictorem_extras": ""},
    "wood": {"name": "Wood", "max_sq_in": 2400,
             "pictorem_type": "ru14", "pictorem_extras": ""},
}

# ── Frame Mouldings (matches product-catalog.json v3) ───────────────────
# Floating frames: canvas, metal, acrylic  |  Picture frames: paper only

FRAME_MOULDINGS = {
    "floating": {
        "303-19": {"name": "Black Floating Frame", "color": "black"},
        "303-12": {"name": "Natural Wood Floating Frame", "color": "natural"},
        "317-22": {"name": "White Floating Frame", "color": "white"},
    },
    "picture": {
        "241-29": {"name": "Black Picture Frame", "color": "black"},
        "241-22": {"name": "White Picture Frame", "color": "white"},
        "724-12": {"name": "Natural Wood Picture Frame", "color": "natural"},
    },
}

# Materials that use floating frames (moulding type)
FLOATING_FRAME_MATERIALS = {"canvas", "metal", "acrylic"}
# Materials that use picture frames (frame type)
PICTURE_FRAME_MATERIALS = {"paper"}


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
    """Look up website retail price — EXACT mirror of product-selector.js.

    Uses per-size lookup table based on real Pictorem API costs.
    Every price = round(Pictorem_cost × 2) for exact 50% margin.

    Args:
        material_key: 'canvas', 'metal', 'acrylic', 'paper', 'wood'
        width_in: Print width in inches
        height_in: Print height in inches

    Returns:
        Price in whole USD, or 0 if size not in table
    """
    table = PRICE_TABLE.get(material_key)
    if not table:
        return 0
    # Try exact match, then reversed dimensions
    price = table.get((width_in, height_in))
    if price is not None:
        return price
    price = table.get((height_in, width_in))
    if price is not None:
        return price
    return 0


def pictorem_cost(material_key: str, width_in: int, height_in: int) -> float:
    """Look up Pictorem wholesale cost for a material+size.

    Returns:
        Cost in USD (float), or 0.0 if not found
    """
    table = PICTOREM_COSTS.get(material_key)
    if not table:
        return 0.0
    cost = table.get((width_in, height_in))
    if cost is not None:
        return cost
    cost = table.get((height_in, width_in))
    if cost is not None:
        return cost
    return 0.0


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


def frame_addon_price(width_in: int, height_in: int) -> int:
    """Calculate frame add-on price — mirrors product-selector.js getFrameAddOnPrice().

    ~20% margin over Pictorem frame cost (API-verified 2026-03-02):
        ≤144 sq in (12×12 and under)  → $65  (est cost ~$53)
        ≤288 sq in (up to 24×12)      → $75  (est cost ~$60)
        ≤480 sq in (up to 24×16)      → $85  (API cost $68)
        ≤864 sq in (up to 36×24)      → $130 (API cost $102)
        ≤1536 sq in (up to 48×32)     → $170 (API cost $136)
        >1536 sq in (60×40 and up)    → $235 (est cost ~$188)
    """
    area = width_in * height_in
    if area <= 144:
        return 65
    if area <= 288:
        return 75
    if area <= 480:
        return 85
    if area <= 864:
        return 130
    if area <= 1536:
        return 170
    return 235


def get_frame_type(material_key: str) -> Optional[str]:
    """Return 'floating' or 'picture' based on material, or None if no frames."""
    if material_key in FLOATING_FRAME_MATERIALS:
        return "floating"
    if material_key in PICTURE_FRAME_MATERIALS:
        return "picture"
    return None


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
            if site_p == 0:
                continue  # Size not in lookup table

            etsy_p = etsy_price(site_p)
            cost = pictorem_cost(material_key, w, h)

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
                "pictorem_cost": cost,
                "margin_pct": round((site_p - cost) / site_p * 100, 1) if site_p > 0 else 0,
                "aspect_category": category["name"],
                "pictorem_type": material["pictorem_type"],
                "pictorem_extras": material["pictorem_extras"],
            })

    return products


def build_pictorem_preorder(
    material_key: str,
    width: int,
    height: int,
    quantity: int = 1,
    sub_type: str = "",
    mounting: str = "",
    finish: str = "",
    edge: str = "",
    frame: str = "",
) -> str:
    """Build a Pictorem preorder code for fulfillment.

    Basic format:   qty|material|type|orientation|width|height|extras...
    With frame:     qty|material|type|orientation|width|height|extras...|mountingType|frameCode

    Mirrors stripe-webhook.js buildPreorderCode() logic exactly.
    """
    material = MATERIALS.get(material_key)
    if not material:
        return ""

    orientation = "horizontal" if width >= height else "vertical"

    has_sub_options = any([sub_type, mounting, finish, edge])

    if not has_sub_options and not frame:
        # Default path — use material defaults
        extras = material["pictorem_extras"]
        parts = [str(quantity), material_key, material["pictorem_type"],
                 orientation, str(width), str(height)]
        if extras:
            parts.extend(extras.split("|"))
        return "|".join(parts)

    # Sub-option path
    mat_type = sub_type or material["pictorem_type"]
    additionals: list[str] = []

    if material_key == "canvas":
        if mat_type == "rolled":
            mat_type = "canvas"
        else:
            mat_type = "stretched"
        fin = finish or "semigloss"
        edg = edge or "mirrorimage"
        additionals = [fin, edg]
        if sub_type in ("c15", "c075"):
            additionals.append(sub_type)
        additionals.extend(["none", "none"])
    elif material_key in ("metal", "acrylic"):
        if mounting and mounting != "none":
            additionals = [mounting]
        else:
            additionals = ["standoff"]  # Default mounting
    elif material_key == "wood":
        if mounting == "frenchcleat":
            additionals = ["frenchcleat"]

    parts = [str(quantity), material_key, mat_type,
             orientation, str(width), str(height)]
    if additionals and any(a != "none" for a in additionals):
        parts.extend(additionals)

    if frame:
        frame_mounting_type = "frame" if material_key == "paper" else "moulding"
        parts.extend([frame_mounting_type, frame])

    return "|".join(parts)
