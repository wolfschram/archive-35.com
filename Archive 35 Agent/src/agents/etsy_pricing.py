"""Etsy pricing for Archive-35 — mirrors website pricing + Etsy fee markup.

Calculates the optimal print size from original photo dimensions,
picks the largest standard size that maintains 200+ DPI,
then applies website pricing + Etsy fee markup.

Pricing formula (identical to website):
    website_price = PRICE_TABLE lookup (Pictorem cost × 2, 50% margin)
    etsy_price = website_price / (1 - 9.5%) to cover Etsy fees

Product: HD Metal Print, White Gloss ChromaLuxe + standoff brackets
Shipping: Free — North America and Canada (Pictorem fulfills)
"""

from __future__ import annotations

import logging
import math
import sqlite3
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Import website pricing tables (single source of truth) ───────────

from src.brand.pricing import (
    PRICE_TABLE,
    PICTOREM_COSTS,
    ASPECT_RATIO_CATEGORIES,
    ETSY_TOTAL_PERCENTAGE,
    ETSY_PAYMENT_FLAT,
    ETSY_LISTING_FEE,
    website_price,
    etsy_price as _etsy_price_from_website,
)

# Minimum DPI for print quality — never go below this.
# 150 DPI is industry standard for large-format fine art prints.
# Quality badges: Museum Quality ≥300, Excellent ≥200, Good ≥150.
MIN_DPI = 150

# Material for Etsy single-SKU listings
MATERIAL = "metal"


def resolve_original_dimensions(
    photo_w: int = 0,
    photo_h: int = 0,
) -> tuple[int, int]:
    """Resolve original photo dimensions from the photos DB.

    Etsy API returns thumbnail dimensions (~2000px). We need the original
    pixel count for correct print sizing and pricing.

    Strategy:
    1. If photo_w > 3000, assume it's already original — use as-is.
    2. Otherwise, find a matching photo in the DB by aspect ratio.
       - Prefer standard camera originals (4000-12000px) over stitched panoramas
       - Use 0.05 tolerance for aspect ratio matching
    3. Fallback: scale up assuming 8688px long edge (median of archive).
    """
    if photo_w > 3000 or photo_h > 3000:
        return photo_w, photo_h

    if photo_w == 0 or photo_h == 0:
        return 8688, 5792

    thumb_aspect = photo_w / photo_h

    try:
        db_path = Path(__file__).parent.parent / "data" / "archive35.db"
        if db_path.exists():
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            # Prefer standard camera originals (4000-12000px) over giant stitches.
            # This gives realistic print sizes for the typical Etsy listing.
            rows = conn.execute(
                """SELECT width, height FROM photos
                   WHERE width > 3000 AND height > 0
                   AND width <= 12000
                   AND ABS(CAST(width AS REAL)/height - ?) < 0.05
                   ORDER BY width DESC LIMIT 1""",
                (thumb_aspect,),
            ).fetchall()
            # If no standard match, try including stitched panoramas
            if not rows:
                rows = conn.execute(
                    """SELECT width, height FROM photos
                       WHERE width > 3000 AND height > 0
                       AND ABS(CAST(width AS REAL)/height - ?) < 0.08
                       ORDER BY width DESC LIMIT 1""",
                    (thumb_aspect,),
                ).fetchall()
            conn.close()
            if rows:
                orig_w, orig_h = rows[0]["width"], rows[0]["height"]
                logger.info(
                    "Resolved original: %dx%d → %dx%d (aspect %.2f)",
                    photo_w, photo_h, orig_w, orig_h, thumb_aspect,
                )
                return orig_w, orig_h
    except Exception as e:
        logger.warning("DB lookup for original dimensions failed: %s", e)

    # Fallback: scale up from aspect ratio using 8688px long edge
    # (median width of standard camera photos in the archive)
    if thumb_aspect >= 1:
        return 8688, round(8688 / thumb_aspect)
    else:
        return round(8688 * thumb_aspect), 8688


def detect_orientation(width: int, height: int) -> str:
    """Detect photo orientation from pixel dimensions."""
    if height == 0:
        return "landscape"
    ratio = width / height
    if ratio > 2.0:
        return "panoramic"
    elif ratio > 1.1:
        return "landscape"
    elif ratio < 0.9:
        return "portrait"
    else:
        return "square"


def _get_aspect_category(aspect: float) -> dict | None:
    """Find the matching aspect ratio category from the website's size tables."""
    for cat in ASPECT_RATIO_CATEGORIES.values():
        lo, hi = cat["range"]
        if lo <= aspect <= hi:
            return cat
    # Also check inverted for portrait
    inv = 1 / aspect if aspect > 0 else 1.5
    for cat in ASPECT_RATIO_CATEGORIES.values():
        lo, hi = cat["range"]
        if lo <= inv <= hi:
            # Return sizes flipped for portrait
            return {
                "name": cat["name"] + " (portrait)",
                "range": cat["range"],
                "sizes": [(h, w) for w, h in cat["sizes"]],
            }
    return None


def calculate_best_size(
    photo_w: int,
    photo_h: int,
) -> dict[str, Any] | None:
    """Find the largest standard print size for this photo at 200+ DPI.

    Uses the website's aspect ratio categories and standard sizes.
    Only considers sizes available in the PRICE_TABLE for metal prints.

    Returns dict with width_in, height_in, label, dpi, or None if no size works.
    """
    if photo_h == 0:
        photo_h = 1
    aspect = photo_w / photo_h

    category = _get_aspect_category(aspect)
    if not category:
        logger.warning("No aspect category for ratio %.2f", aspect)
        return None

    sizes = category["sizes"]

    # Filter to sizes that exist in the metal price table and meet DPI
    valid = []
    for w, h in sizes:
        # Check price table has this size
        if website_price(MATERIAL, w, h) == 0:
            continue
        # Check DPI at this size
        dpi = min(photo_w / w, photo_h / h) if w > 0 and h > 0 else 0
        if dpi >= MIN_DPI:
            valid.append({"width_in": w, "height_in": h, "dpi": round(dpi)})

    if not valid:
        logger.warning(
            "No valid metal print size for %dx%d (aspect %.2f, category %s)",
            photo_w, photo_h, aspect, category["name"],
        )
        return None

    # Pick the largest (last in the sorted list = biggest)
    best = max(valid, key=lambda s: s["width_in"] * s["height_in"])
    best["label"] = f"{best['width_in']}×{best['height_in']} inches"
    return best


def get_listing_pricing(
    orientation: str = "",
    photo_w: int = 6000,
    photo_h: int = 4000,
) -> dict[str, Any]:
    """Get complete pricing info for an Etsy listing.

    Mirrors the website's pricing exactly, plus Etsy fee markup.

    1. Resolves original photo dimensions (if given thumbnails)
    2. Finds the largest standard print size at 200+ DPI
    3. Looks up the website price (Pictorem cost × 2)
    4. Adds Etsy fee markup (9.5% + $0.45)

    Args:
        orientation: Ignored (kept for backward compatibility).
        photo_w: Photo width in pixels (original or thumbnail).
        photo_h: Photo height in pixels (original or thumbnail).

    Returns dict with all pricing details.
    """
    # Resolve to original dimensions if we got thumbnails
    photo_w, photo_h = resolve_original_dimensions(photo_w, photo_h)

    # Find the best standard size
    size = calculate_best_size(photo_w, photo_h)

    if size is None:
        # Fallback: scan ALL sizes in price table for metal, pick largest at 200+ DPI
        logger.warning("No category match for %dx%d — scanning all metal sizes", photo_w, photo_h)
        all_metal = PRICE_TABLE.get(MATERIAL, {})
        fallback_valid = []
        for (sw, sh), price in all_metal.items():
            dpi = min(photo_w / sw, photo_h / sh) if sw > 0 and sh > 0 else 0
            # Also check flipped for portrait
            dpi_flip = min(photo_w / sh, photo_h / sw) if sw > 0 and sh > 0 else 0
            if dpi >= MIN_DPI:
                fallback_valid.append({"width_in": sw, "height_in": sh, "dpi": round(dpi)})
            elif dpi_flip >= MIN_DPI:
                fallback_valid.append({"width_in": sh, "height_in": sw, "dpi": round(dpi_flip)})
        if fallback_valid:
            size = max(fallback_valid, key=lambda s: s["width_in"] * s["height_in"])
            size["label"] = f"{size['width_in']}×{size['height_in']} inches"
        else:
            # Last resort: smallest metal size
            logger.warning("No size at 200+ DPI for %dx%d — using smallest metal", photo_w, photo_h)
            size = {"width_in": 12, "height_in": 8, "label": "12×8 inches", "dpi": round(min(photo_w/12, photo_h/8))}

    w, h = size["width_in"], size["height_in"]

    # Get website price (Pictorem cost × 2)
    site_price = website_price(MATERIAL, w, h)
    cost = PICTOREM_COSTS.get(MATERIAL, {}).get((w, h), 0.0)
    if cost == 0.0:
        cost = PICTOREM_COSTS.get(MATERIAL, {}).get((h, w), 0.0)

    # Calculate Etsy price (website price + Etsy fee markup)
    etsy_p = _etsy_price_from_website(site_price) if site_price > 0 else 0

    megapixels = round((photo_w * photo_h) / 1_000_000, 1)

    return {
        "orientation": detect_orientation(photo_w, photo_h),
        "size_label": size["label"],
        "width_in": w,
        "height_in": h,
        "dpi": size["dpi"],
        "photo_pixels": f"{photo_w}×{photo_h}",
        "megapixels": megapixels,
        "pictorem_cost_usd": cost,
        "website_price_usd": site_price,
        "etsy_price_cents": int(etsy_p * 100),
        "etsy_price_usd": float(etsy_p),
        "material": "HD Metal Print — White Gloss ChromaLuxe",
        "mount": "Metal standoff hanging brackets (included)",
        "shipping": "Free shipping — North America and Canada",
    }
