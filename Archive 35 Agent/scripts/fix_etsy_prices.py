"""Fix Etsy listing prices by updating the inventory/variation matrix.

Etsy listings with variations (Material & Size × Frame) store prices
in the inventory, not on the listing itself. This script recalculates
the full variation matrix using actual photo dimensions and pushes
updated pricing via the inventory API.

Usage:
    python scripts/fix_etsy_prices.py --dry-run
    python scripts/fix_etsy_prices.py --live
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.integrations.etsy import (
    ensure_valid_token,
    get_listings,
    _api_request,
    update_listing_inventory,
)
from src.agents.etsy_pricing import resolve_original_dimensions
from src.brand.etsy_variations import (
    build_variation_matrix,
    build_etsy_inventory_payload,
    get_matrix_summary,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def fetch_all_active_listings() -> list[dict]:
    all_listings = []
    for offset in range(0, 200, 25):
        batch = get_listings(state="active", limit=25, offset=offset)
        results = batch.get("results", [])
        all_listings.extend(results)
        if len(results) < 25:
            break
    return all_listings


def get_listing_images(listing_id: int) -> list[dict]:
    result = _api_request(f"/application/listings/{listing_id}/images")
    return result.get("results", [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--listing-id", type=int)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    if not args.dry_run and not args.live:
        print("ERROR: Must specify --dry-run or --live")
        sys.exit(1)

    token = ensure_valid_token()
    if not token.get("valid"):
        print(f"ERROR: Token invalid: {token.get('error')}")
        sys.exit(1)
    print("✓ Token valid")

    if args.listing_id:
        result = _api_request(f"/application/listings/{args.listing_id}")
        if "error" in result:
            print(f"ERROR: {result['error']}")
            sys.exit(1)
        all_listings = [result]
    else:
        all_listings = fetch_all_active_listings()

    print(f"✓ Found {len(all_listings)} listings")

    if args.limit > 0:
        all_listings = all_listings[:args.limit]

    updated = 0
    errors = 0

    for i, listing in enumerate(all_listings):
        lid = listing["listing_id"]
        title = listing.get("title", "")
        current_price = listing.get("price", {}).get("amount", 0) / listing.get("price", {}).get("divisor", 100)

        print(f"\n[{i+1}/{len(all_listings)}] {lid}: {title[:55]}...")

        # Get image dimensions
        images = get_listing_images(lid)
        if not images:
            print("  SKIP: no images")
            continue

        thumb_w = images[0].get("full_width", 0)
        thumb_h = images[0].get("full_height", 0)

        # Resolve original dimensions
        orig_w, orig_h = resolve_original_dimensions(thumb_w, thumb_h)

        # Build variation matrix with correct pricing
        products = build_variation_matrix(orig_w, orig_h, min_dpi=150)
        if not products:
            print(f"  SKIP: no valid products for {orig_w}×{orig_h}")
            continue

        # Filter for premium Etsy positioning:
        # 1. Remove paper (needs framing — doesn't fit "ready to hang" messaging)
        # 2. Minimum 24" long edge (everything on Etsy is large-scale)
        products = [
            p for p in products
            if p["material_key"] != "paper"
            and max(p["width"], p["height"]) >= 24
        ]
        if not products:
            print(f"  SKIP: no products after premium filter for {orig_w}×{orig_h}")
            continue

        summary = get_matrix_summary(products)
        enabled = [p for p in products if p["is_enabled"]]
        min_price = min(p["etsy_price"] for p in enabled) if enabled else 0
        max_price = max(p["etsy_price"] for p in enabled) if enabled else 0

        print(f"  Source: {orig_w}×{orig_h}")
        print(f"  Variants: {summary['enabled_variants']} enabled, {summary['disabled_variants']} disabled")
        print(f"  Sizes: {', '.join(summary['sizes'])}")
        print(f"  Price: ${current_price:.0f} → ${min_price:.0f}-${max_price:.0f}")

        if args.live:
            # Build Etsy inventory payload
            payload = build_etsy_inventory_payload(products)

            result = update_listing_inventory(lid, payload)
            if "error" in result:
                print(f"  ✗ ERROR: {result.get('error', 'Unknown')}")
                # Show more detail
                detail = result.get("detail", "")
                if detail:
                    print(f"    Detail: {detail[:200]}")
                errors += 1
            else:
                print(f"  ✓ INVENTORY UPDATED")
                updated += 1

            time.sleep(0.5)
        else:
            print(f"  [DRY RUN]")
            updated += 1

    print(f"\n{'='*60}")
    print(f"{'LIVE' if args.live else 'DRY RUN'} SUMMARY")
    print(f"{'='*60}")
    print(f"Updated: {updated}")
    print(f"Errors:  {errors}")


if __name__ == "__main__":
    main()
