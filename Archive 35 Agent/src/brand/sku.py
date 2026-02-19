"""SKU generator and COGS calculator for Archive-35.

Generates SKUs in format: A35-{COLLECTION}-{PHOTO_NUM}-{SIZE}-{PAPER}-{EDITION}
Calculates minimum price floor from COGS + fees + margin.
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

# COGS table (placeholder values — update when test prints arrive)
# Format: (size_code, paper_code) → base_cost_usd
COGS_TABLE: dict[tuple[str, str], float] = {
    # Hahnemuhle Photo Rag
    ("8R", "HAH"): 12.00,
    ("11R", "HAH"): 18.00,
    ("16R", "HAH"): 28.00,
    ("20R", "HAH"): 42.00,
    ("24R", "HAH"): 58.00,
    # Canson Platine Fibre Rag
    ("8R", "CAN"): 10.00,
    ("11R", "CAN"): 15.00,
    ("16R", "CAN"): 24.00,
    ("20R", "CAN"): 36.00,
    ("24R", "CAN"): 48.00,
    # Metal Print
    ("8R", "MTL"): 22.00,
    ("11R", "MTL"): 35.00,
    ("16R", "MTL"): 55.00,
    ("20R", "MTL"): 80.00,
    ("24R", "MTL"): 110.00,
}

# Fee structure
ETSY_FEE_RATE = 0.065  # 6.5% transaction fee
ETSY_LISTING_FEE = 0.20
ETSY_PAYMENT_PROCESSING = 0.03  # 3% + $0.25
SHIPPING_ESTIMATE: dict[str, float] = {
    "8R": 8.00,
    "11R": 10.00,
    "16R": 14.00,
    "20R": 18.00,
    "24R": 22.00,
}
TARGET_MARGIN = 0.40  # 40% minimum margin


def get_base_cost(size_code: str, paper_code: str) -> float:
    """Look up base production cost from COGS table.

    Args:
        size_code: Print size (e.g., "16R" for 16x20).
        paper_code: Paper type (e.g., "HAH" for Hahnemuhle).

    Returns:
        Base cost in USD. Returns 0.0 if not found.
    """
    return COGS_TABLE.get((size_code, paper_code), 0.0)


def calculate_min_price(
    base_cost: float,
    size_code: str,
    margin: float = TARGET_MARGIN,
) -> float:
    """Calculate minimum price floor (cost + fees + margin).

    Args:
        base_cost: POD production cost.
        size_code: Print size for shipping estimate.
        margin: Target profit margin (default 40%).

    Returns:
        Minimum list price in USD.
    """
    shipping = SHIPPING_ESTIMATE.get(size_code, 12.00)
    total_cost = base_cost + shipping + ETSY_LISTING_FEE

    # Price = total_cost / (1 - margin - etsy_fees - payment_fees)
    effective_rate = 1 - margin - ETSY_FEE_RATE - ETSY_PAYMENT_PROCESSING
    if effective_rate <= 0:
        effective_rate = 0.20  # Safety fallback

    min_price = total_cost / effective_rate
    return round(min_price, 2)


def generate_sku(
    collection: str,
    photo_num: int,
    size_code: str,
    paper_code: str,
    edition_type: str = "OE",
) -> str:
    """Generate a SKU string.

    Format: A35-{COLLECTION}-{NUM:04d}-{SIZE}-{PAPER}-{EDITION}

    Args:
        collection: Collection code (e.g., "ICE").
        photo_num: Photo number within collection.
        size_code: Print size code.
        paper_code: Paper type code.
        edition_type: "OE" (open edition) or "LE" (limited edition).

    Returns:
        SKU string.
    """
    return f"A35-{collection.upper()}-{photo_num:04d}-{size_code}-{paper_code}-{edition_type}"


def create_sku_entry(
    conn: sqlite3.Connection,
    photo_id: str,
    collection: str,
    photo_num: int,
    size_code: str,
    paper_code: str,
    edition_type: str = "OE",
    edition_total: Optional[int] = None,
    list_price_override: Optional[float] = None,
) -> Optional[str]:
    """Create a SKU catalog entry in the database.

    Args:
        conn: Active database connection.
        photo_id: Photo ID (SHA256 hash).
        collection: Collection code.
        photo_num: Photo number.
        size_code: Print size.
        paper_code: Paper type.
        edition_type: "OE" or "LE".
        edition_total: Total prints for LE (required for LE).
        list_price_override: Manual price (uses calculated min if None).

    Returns:
        SKU string if created, None if failed.
    """
    sku = generate_sku(collection, photo_num, size_code, paper_code, edition_type)
    base_cost = get_base_cost(size_code, paper_code)

    if base_cost == 0:
        logger.warning("No COGS data for %s/%s, using estimate", size_code, paper_code)
        base_cost = 25.0  # Fallback estimate

    min_price = calculate_min_price(base_cost, size_code)
    list_price = list_price_override or round(min_price * 1.2, 2)  # 20% above floor

    try:
        conn.execute(
            """INSERT OR REPLACE INTO sku_catalog
               (sku, photo_id, collection, size_code, paper_code,
                edition_type, edition_total, base_cost_usd,
                min_price_usd, list_price_usd)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                sku,
                photo_id,
                collection,
                size_code,
                paper_code,
                edition_type,
                edition_total,
                base_cost,
                min_price,
                list_price,
            ),
        )
        conn.commit()
        logger.info("Created SKU: %s at $%.2f (floor $%.2f)", sku, list_price, min_price)
        return sku
    except Exception as e:
        logger.error("Failed to create SKU %s: %s", sku, e)
        return None
