#!/usr/bin/env python3
"""Populate SKU catalog from photos DB using website pricing formula.

Reads all photos, calculates available print products per photo
(based on aspect ratio + DPI thresholds), and inserts SKUs into
the sku_catalog table with website price AND Etsy price.

Usage:
    cd "Archive 35 Agent"
    python3 scripts/populate_sku_catalog.py [--dry-run] [--clear]
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db import get_initialized_connection
from src.brand.pricing import (
    MATERIALS,
    get_available_products,
    build_pictorem_preorder,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Default materials to generate SKUs for on Etsy
# (canvas and metal are top sellers, paper for budget option)
DEFAULT_ETSY_MATERIALS = ["canvas", "metal", "paper"]


def get_collection_code(collection: str) -> str:
    """Generate a 3-letter collection code from collection name."""
    if not collection:
        return "UNK"
    # Use first 3 consonants or first 3 chars
    consonants = [c for c in collection.upper() if c not in "AEIOU_ -"]
    if len(consonants) >= 3:
        return "".join(consonants[:3])
    return collection.upper().replace("_", "").replace(" ", "")[:3]


def get_photo_number(conn: sqlite3.Connection, photo_id: str, collection: str) -> int:
    """Get sequential photo number within a collection."""
    rows = conn.execute(
        """SELECT id FROM photos
           WHERE collection = ?
           ORDER BY filename""",
        (collection,),
    ).fetchall()
    for i, row in enumerate(rows, 1):
        if row["id"] == photo_id:
            return i
    return 1


def populate(
    conn: sqlite3.Connection,
    materials: list[str] | None = None,
    clear: bool = False,
    dry_run: bool = False,
) -> dict:
    """Populate SKU catalog for all photos.

    Args:
        conn: Active database connection.
        materials: Materials to generate SKUs for (default: canvas, metal, paper).
        clear: Clear existing SKU catalog first.
        dry_run: Print what would be created without writing.

    Returns:
        Summary dict with counts.
    """
    target_materials = materials or DEFAULT_ETSY_MATERIALS

    if clear and not dry_run:
        conn.execute("DELETE FROM sku_catalog")
        conn.commit()
        logger.info("Cleared existing SKU catalog")

    # Get all photos with dimensions
    photos = conn.execute(
        """SELECT id, filename, collection, width, height, exif_json
           FROM photos
           WHERE width > 0 AND height > 0
           ORDER BY collection, filename"""
    ).fetchall()

    logger.info("Processing %d photos for %s", len(photos), target_materials)

    stats = {"photos": 0, "skus_created": 0, "skus_skipped": 0, "collections": set()}
    sku_rows = []

    for photo in photos:
        photo_id = photo["id"]
        collection = photo["collection"] or "uncategorized"
        col_code = get_collection_code(collection)
        photo_num = get_photo_number(conn, photo_id, collection)

        products = get_available_products(
            photo_width=photo["width"],
            photo_height=photo["height"],
            min_dpi=150,
        )

        # Filter to target materials only
        products = [p for p in products if p["material_key"] in target_materials]

        if not products:
            continue

        stats["photos"] += 1
        stats["collections"].add(collection)

        for p in products:
            mat_code = p["material_key"][:3].upper()  # CAN, MET, ACR, PAP, WOO
            size_str = f"{p['width']}x{p['height']}"
            sku = f"A35-{col_code}-{photo_num:04d}-{size_str}-{mat_code}-OE"

            sku_rows.append({
                "sku": sku,
                "photo_id": photo_id,
                "collection": collection,
                "size_code": size_str,
                "paper_code": mat_code,
                "edition_type": "open",
                "edition_total": None,
                "edition_sold": 0,
                "base_cost_usd": 0.0,  # TBD: Pictorem wholesale lookup
                "min_price_usd": float(p["website_price"]),
                "list_price_usd": float(p["etsy_price"]),
                "active": 1,
            })

    if dry_run:
        logger.info("\n=== DRY RUN — No changes made ===")
        logger.info("Would create %d SKUs for %d photos across %d collections",
                     len(sku_rows), stats["photos"], len(stats["collections"]))

        # Show sample pricing
        if sku_rows:
            logger.info("\nSample SKUs (first 20):")
            logger.info("%-42s  %6s  %6s  %s", "SKU", "Site$", "Etsy$", "Size")
            for row in sku_rows[:20]:
                logger.info("%-42s  $%5.0f  $%5.0f  %s",
                            row["sku"], row["min_price_usd"],
                            row["list_price_usd"], row["size_code"])
    else:
        for row in sku_rows:
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO sku_catalog
                       (sku, photo_id, collection, size_code, paper_code,
                        edition_type, edition_total, edition_sold,
                        base_cost_usd, min_price_usd, list_price_usd, active)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row["sku"], row["photo_id"], row["collection"],
                        row["size_code"], row["paper_code"],
                        row["edition_type"], row["edition_total"], row["edition_sold"],
                        row["base_cost_usd"], row["min_price_usd"],
                        row["list_price_usd"], row["active"],
                    ),
                )
                stats["skus_created"] += 1
            except Exception as e:
                logger.error("Failed to insert SKU %s: %s", row["sku"], e)
                stats["skus_skipped"] += 1

        conn.commit()

    stats["collections"] = len(stats["collections"])
    stats["total_sku_rows"] = len(sku_rows)
    return stats


def main():
    parser = argparse.ArgumentParser(description="Populate SKU catalog from photos DB")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen")
    parser.add_argument("--clear", action="store_true", help="Clear catalog first")
    parser.add_argument("--materials", nargs="+", default=None,
                        choices=list(MATERIALS.keys()),
                        help="Materials to generate SKUs for")
    args = parser.parse_args()

    # DB path: Archive 35 Agent/data/archive35.db
    db_path = Path(__file__).parent.parent / "data" / "archive35.db"
    if not db_path.exists():
        logger.error("Database not found: %s", db_path)
        sys.exit(1)

    conn = get_initialized_connection()
    try:
        stats = populate(conn, materials=args.materials, clear=args.clear, dry_run=args.dry_run)
        logger.info("\n=== Summary ===")
        logger.info("Photos processed: %d", stats["photos"])
        logger.info("Collections: %d", stats["collections"])
        logger.info("SKUs generated: %d", stats.get("skus_created", stats.get("total_sku_rows", 0)))
        if stats.get("skus_skipped"):
            logger.info("SKUs skipped (errors): %d", stats["skus_skipped"])
    finally:
        conn.close()


if __name__ == "__main__":
    main()
