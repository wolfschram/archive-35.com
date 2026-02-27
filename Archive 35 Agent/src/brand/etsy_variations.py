"""Etsy variation matrix builder for Archive-35.

Generates the full product matrix (Material & Size × Frame) with correct
pricing for the Etsy updateListingInventory API endpoint.

Uses pricing.py for all price calculations — this module only handles
the variation structure and Etsy-specific payload format.

Key rules:
- Wood material: "No Frame" ONLY (framing not supported by Pictorem for wood)
- All other materials: 4 frame options (No Frame, Black, White, Natural Wood)
- Prices are Etsy-marked-up website prices (component-level markup)
- DPI filtering: sizes below 150 DPI are excluded

Etsy inventory API property IDs:
- 513: First custom variation ("Material & Size")
- 514: Second custom variation ("Frame")
These MUST be verified against a live listing once OAuth is active.
If Etsy uses different IDs, update PROPERTY_ID_MATERIAL_SIZE and
PROPERTY_ID_FRAME below.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from src.brand.pricing import (
    MATERIALS,
    etsy_price,
    frame_addon_price,
    get_matching_category,
    filter_sizes_by_aspect,
    website_price,
    calculate_dpi,
    get_quality_badge,
)

logger = logging.getLogger(__name__)

# ── Etsy Property IDs ────────────────────────────────────────────────────
# Verify these against a live listing via GET /listings/{id}/inventory
# once OAuth is working. Update if Etsy assigns different IDs.

PROPERTY_ID_MATERIAL_SIZE = 513   # Custom variation 1
PROPERTY_ID_FRAME = 514           # Custom variation 2

# ── Frame Options ────────────────────────────────────────────────────────

FRAME_OPTIONS = ["No Frame", "Black Frame", "White Frame", "Natural Wood Frame"]

# Materials that do NOT support framing (only "No Frame" allowed)
NO_FRAME_MATERIALS = {"wood"}

# ── Material Display Names (Etsy variation label) ────────────────────────

MATERIAL_DISPLAY_NAMES = {
    "paper": "Fine Art Paper",
    "canvas": "Canvas",
    "wood": "Wood",
    "metal": "Metal",
    "acrylic": "Acrylic",
}

# Material order for Etsy listings (matches manual listing order)
MATERIAL_ORDER = ["paper", "canvas", "wood", "metal", "acrylic"]


# ── Matrix Generation ────────────────────────────────────────────────────

def build_variation_matrix(
    photo_width: int,
    photo_height: int,
    min_dpi: int = 150,
    max_sizes: int = 6,
) -> list[dict]:
    """Build the full Material & Size × Frame product matrix.

    Args:
        photo_width: Source photo pixel width
        photo_height: Source photo pixel height
        min_dpi: Minimum DPI threshold (sizes below this are excluded)
        max_sizes: Maximum number of sizes to include per material

    Returns:
        List of product dicts, each with:
        - material_key, material_name, width, height, size_label
        - frame, is_framed
        - etsy_price (total including frame addon if framed)
        - is_enabled (False for Wood + any frame)
        - offering dict ready for Etsy API
    """
    aspect_ratio = photo_width / photo_height if photo_height > 0 else 1.5
    category = get_matching_category(aspect_ratio)
    sizes = filter_sizes_by_aspect(category["sizes"], aspect_ratio)

    if not sizes:
        # Fallback to category sizes without aspect filtering
        sizes = category["sizes"]

    products = []

    for mat_key in MATERIAL_ORDER:
        mat = MATERIALS.get(mat_key)
        if not mat:
            continue

        mat_name = MATERIAL_DISPLAY_NAMES.get(mat_key, mat["name"])

        for w, h in sizes[:max_sizes]:
            # DPI check
            dpi = calculate_dpi(photo_width, photo_height, w, h)
            quality = get_quality_badge(dpi)
            if not quality:
                continue

            # Size constraint
            sq_in = w * h
            if sq_in > mat.get("max_sq_in", 2400):
                continue

            # Base prices
            site_base = website_price(mat_key, w, h)
            etsy_base = etsy_price(site_base)
            size_label = f"{w}x{h}"

            # Frame add-on: mark up the addon separately (component-level markup)
            # This matches the manual Etsy listing approach where base and frame
            # addon are each independently marked up, then summed.
            site_frame_addon = frame_addon_price(w, h)
            etsy_frame_addon = etsy_price(site_frame_addon)

            # Determine which frame options this material supports
            if mat_key in NO_FRAME_MATERIALS:
                frames = FRAME_OPTIONS  # All 4 options exist but framed ones disabled
            else:
                frames = FRAME_OPTIONS

            for frame in frames:
                is_no_frame = (frame == "No Frame")
                is_wood_framed = (mat_key in NO_FRAME_MATERIALS and not is_no_frame)

                if is_no_frame:
                    total_price = etsy_base
                else:
                    total_price = etsy_base + etsy_frame_addon

                products.append({
                    "material_key": mat_key,
                    "material_name": mat_name,
                    "width": w,
                    "height": h,
                    "size_label": size_label,
                    "material_size_label": f"{mat_name} {size_label}",
                    "frame": frame,
                    "is_framed": not is_no_frame,
                    "etsy_price": total_price,
                    "is_enabled": not is_wood_framed,
                    "dpi": dpi,
                    "quality": quality,
                })

    logger.info(
        "Built variation matrix: %d products (%d enabled, %d disabled)",
        len(products),
        sum(1 for p in products if p["is_enabled"]),
        sum(1 for p in products if not p["is_enabled"]),
    )
    return products


def build_etsy_inventory_payload(
    products: list[dict],
    quantity: int = 999,
) -> dict[str, Any]:
    """Convert a product matrix into the Etsy updateListingInventory API payload.

    Args:
        products: Output from build_variation_matrix()
        quantity: Stock quantity per variant (999 = unlimited for POD)

    Returns:
        Dict matching the Etsy PUT /v3/application/listings/{id}/inventory schema:
        {
            "products": [...],
            "price_on_property": [513, 514],
            "quantity_on_property": [],
            "sku_on_property": []
        }
    """
    etsy_products = []

    for p in products:
        product_entry = {
            "property_values": [
                {
                    "property_id": PROPERTY_ID_MATERIAL_SIZE,
                    "property_name": "Material & Size",
                    "values": [p["material_size_label"]],
                },
                {
                    "property_id": PROPERTY_ID_FRAME,
                    "property_name": "Frame",
                    "values": [p["frame"]],
                },
            ],
            "offerings": [
                {
                    "price": round(p["etsy_price"], 2),
                    "quantity": quantity,
                    "is_enabled": p["is_enabled"],
                },
            ],
        }
        etsy_products.append(product_entry)

    payload = {
        "products": etsy_products,
        "price_on_property": [PROPERTY_ID_MATERIAL_SIZE, PROPERTY_ID_FRAME],
        "quantity_on_property": [],
        "sku_on_property": [],
    }

    return payload


def get_matrix_summary(products: list[dict]) -> dict[str, Any]:
    """Get a human-readable summary of the variation matrix.

    Useful for logging and UI display before committing to Etsy.
    """
    materials = sorted(set(p["material_name"] for p in products))
    sizes = sorted(set(p["size_label"] for p in products),
                   key=lambda s: int(s.split("x")[0]))
    frames = sorted(set(p["frame"] for p in products),
                    key=lambda f: FRAME_OPTIONS.index(f) if f in FRAME_OPTIONS else 99)

    enabled = [p for p in products if p["is_enabled"]]
    disabled = [p for p in products if not p["is_enabled"]]

    price_range = (
        min(p["etsy_price"] for p in enabled) if enabled else 0,
        max(p["etsy_price"] for p in enabled) if enabled else 0,
    )

    return {
        "total_variants": len(products),
        "enabled_variants": len(enabled),
        "disabled_variants": len(disabled),
        "materials": materials,
        "sizes": sizes,
        "frames": frames,
        "price_range": price_range,
        "disabled_reason": "Wood + Frame combos (framing not supported for wood prints)",
    }
