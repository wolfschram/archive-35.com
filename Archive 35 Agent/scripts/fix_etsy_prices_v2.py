"""Fix Etsy prices — single-SKU metal prints with REAL Pictorem API costs.

For each listing:
1. Get image dimensions from Etsy
2. Resolve to original photo dimensions from DB
3. Calculate maximum metal print size at 150+ DPI
4. Call Pictorem API for the REAL wholesale cost of that exact size
5. Set Etsy price = Pictorem cost × 2 + Etsy fee markup
6. Update inventory to single-SKU (no variations) so displayed price is correct

Usage:
    python scripts/fix_etsy_prices_v2.py --dry-run
    python scripts/fix_etsy_prices_v2.py --live
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.integrations.etsy import (
    ensure_valid_token,
    get_listings,
    _api_request,
    update_listing,
    update_listing_inventory,
    get_credentials,
)
from src.agents.etsy_pricing import resolve_original_dimensions
from src.brand.pricing import (
    ASPECT_RATIO_CATEGORIES,
    PRICE_TABLE,
    get_matching_category,
    filter_sizes_by_aspect,
    calculate_dpi,
    get_quality_badge,
    ETSY_TOTAL_PERCENTAGE,
    ETSY_PAYMENT_FLAT,
    ETSY_LISTING_FEE,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Load Pictorem API key
_pictorem_key = ""
for _line in (Path(__file__).parent.parent.parent / ".env").read_text().splitlines():
    if _line.startswith("PICTOREM_API_KEY="):
        _pictorem_key = _line.split("=", 1)[1].strip()
        break


def get_real_pictorem_cost(width_in: int, height_in: int) -> float | None:
    """Call Pictorem API for real wholesale cost of HD metal + standoff."""
    orientation = "horizontal" if width_in >= height_in else (
        "vertical" if height_in > width_in else "square"
    )
    code = f"1|metal|hd|{orientation}|{width_in}|{height_in}|standoff"

    url = "https://www.pictorem.com/artflow/0.1/getprice"
    data = urllib.parse.urlencode({
        "preordercode": code,
        "deliverycountry": "USA",
        "deliveryprovince": "",
    }).encode()
    req = urllib.request.Request(url, data=data, headers={"artFlowKey": _pictorem_key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        if result.get("status"):
            return result["worksheet"]["price"]["subTotal"]
    except Exception as e:
        logger.error("Pictorem API error for %dx%d: %s", width_in, height_in, e)
    return None


def calculate_etsy_price(pictorem_cost: float) -> int:
    """Calculate Etsy listing price from Pictorem wholesale cost.

    Formula: website_price = round(pictorem_cost × 2)  (50% margin)
             etsy_price = website_price / (1 - 9.5%) + flat fees
    """
    website_price = round(pictorem_cost * 2)
    raw = (website_price + ETSY_PAYMENT_FLAT + ETSY_LISTING_FEE) / (1 - ETSY_TOTAL_PERCENTAGE)
    return math.ceil(raw)


def find_best_metal_size(photo_w: int, photo_h: int, min_dpi: int = 150) -> dict | None:
    """Find the largest standard metal print size for this photo at min_dpi+.

    Only considers sizes that exist in the PRICE_TABLE for metal.
    """
    if photo_h == 0:
        return None
    aspect = photo_w / photo_h

    category = get_matching_category(aspect)
    sizes = filter_sizes_by_aspect(category["sizes"], aspect)

    if not sizes:
        sizes = category["sizes"]

    valid = []
    for w, h in sizes:
        # Must exist in metal price table
        if PRICE_TABLE.get("metal", {}).get((w, h)) is None and \
           PRICE_TABLE.get("metal", {}).get((h, w)) is None:
            continue
        dpi = min(photo_w / w, photo_h / h) if w > 0 and h > 0 else 0
        quality = get_quality_badge(dpi)
        if quality:
            valid.append({"width": w, "height": h, "dpi": round(dpi), "quality": quality})

    if not valid:
        # Fallback: scan ALL metal sizes
        for (sw, sh) in PRICE_TABLE.get("metal", {}).keys():
            dpi = min(photo_w / sw, photo_h / sh) if sw > 0 and sh > 0 else 0
            dpi_flip = min(photo_w / sh, photo_h / sw) if sw > 0 and sh > 0 else 0
            if dpi >= min_dpi:
                valid.append({"width": sw, "height": sh, "dpi": round(dpi), "quality": get_quality_badge(round(dpi))})
            elif dpi_flip >= min_dpi:
                valid.append({"width": sh, "height": sw, "dpi": round(dpi_flip), "quality": get_quality_badge(round(dpi_flip))})

    if not valid:
        return None

    best = max(valid, key=lambda s: s["width"] * s["height"])
    return best


def build_single_sku_inventory(etsy_price_usd: int) -> dict:
    """Build inventory payload for a single-SKU listing (no variations)."""
    # Get readiness state ID
    from src.integrations.etsy import get_or_create_readiness_state_id
    readiness_id = get_or_create_readiness_state_id()

    offering = {
        "price": float(etsy_price_usd),
        "quantity": 999,
        "is_enabled": True,
    }
    if readiness_id:
        offering["readiness_state_id"] = readiness_id

    return {
        "products": [{
            "property_values": [],
            "offerings": [offering],
        }],
        "price_on_property": [],
        "quantity_on_property": [],
        "sku_on_property": [],
    }


def fetch_all_active_listings() -> list[dict]:
    all_listings = []
    for offset in range(0, 200, 25):
        batch = get_listings(state="active", limit=25, offset=offset)
        results = batch.get("results", [])
        all_listings.extend(results)
        if len(results) < 25:
            break
    return all_listings


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

    if not _pictorem_key:
        print("ERROR: PICTOREM_API_KEY not found in .env")
        sys.exit(1)

    token = ensure_valid_token()
    if not token.get("valid"):
        print(f"ERROR: Etsy token invalid: {token.get('error')}")
        sys.exit(1)
    print("✓ Etsy token valid")

    if args.listing_id:
        result = _api_request(f"/application/listings/{args.listing_id}")
        if "error" in result:
            print(f"ERROR: {result['error']}")
            sys.exit(1)
        all_listings = [result]
    else:
        all_listings = fetch_all_active_listings()

    print(f"✓ {len(all_listings)} listings")

    if args.limit > 0:
        all_listings = all_listings[:args.limit]

    updated = 0
    errors = 0
    total_pictorem_cost = 0
    total_etsy_revenue = 0

    for i, listing in enumerate(all_listings):
        lid = listing["listing_id"]
        title = listing.get("title", "")[:55]
        current_price = listing.get("price", {}).get("amount", 0) / listing.get("price", {}).get("divisor", 100)

        print(f"\n[{i+1}/{len(all_listings)}] {lid}: {title}...")

        # Step 1: Get image dimensions
        imgs = _api_request(f"/application/listings/{lid}/images")
        img_results = imgs.get("results", [])
        if not img_results:
            print("  SKIP: no images")
            continue

        tw = img_results[0].get("full_width", 0)
        th = img_results[0].get("full_height", 0)

        # Step 2: Resolve to original dimensions
        ow, oh = resolve_original_dimensions(tw, th)

        # Step 3: Find best metal print size
        size = find_best_metal_size(ow, oh, min_dpi=150)
        if not size:
            print(f"  SKIP: no valid metal size for {ow}×{oh}")
            errors += 1
            continue

        pw, ph = size["width"], size["height"]
        dpi = size["dpi"]
        quality = size["quality"]

        # Step 4: Get REAL Pictorem cost via API
        real_cost = get_real_pictorem_cost(pw, ph)
        if real_cost is None:
            print(f"  SKIP: Pictorem API failed for {pw}×{ph}")
            errors += 1
            continue

        # Step 5: Calculate correct Etsy price
        correct_etsy = calculate_etsy_price(real_cost)
        margin = correct_etsy - real_cost
        margin_pct = (margin / correct_etsy * 100) if correct_etsy > 0 else 0

        total_pictorem_cost += real_cost
        total_etsy_revenue += correct_etsy

        print(f"  Photo: {ow}×{oh} → Print: {pw}×{ph}\" @ {dpi} DPI ({quality})")
        print(f"  Pictorem cost: ${real_cost:.2f}")
        print(f"  Correct Etsy:  ${correct_etsy}")
        print(f"  Current Etsy:  ${current_price:.0f}")
        print(f"  Margin:        ${margin:.0f} ({margin_pct:.0f}%)")

        if args.live:
            # Step 6a: Update inventory to single-SKU with correct price
            inv_payload = build_single_sku_inventory(correct_etsy)
            inv_result = update_listing_inventory(lid, inv_payload)
            if "error" in inv_result:
                print(f"  ✗ INVENTORY ERROR: {inv_result.get('error', '')[:100]}")
                errors += 1
                time.sleep(0.5)
                continue

            # Step 6b: Update title with correct size
            import re
            new_title = title
            # Replace any size references with correct size
            new_title = re.sub(r'\d+[×x]\d+[&"]?[a-z;]*\s*', '', listing.get("title", ""))
            new_title = re.sub(r'Metal Print', '', new_title)
            new_title = re.sub(r'\s+', ' ', new_title).strip()

            sq_in = pw * ph
            scale = "Large-Scale Fine Art" if sq_in >= 1200 else "Fine Art Wall Art"
            new_title = f"{new_title} {pw}×{ph}\" Metal Print | {scale} | Free Shipping"
            if len(new_title) > 140:
                new_title = f"{new_title.split('|')[0].strip()} | Free Shipping"
            if len(new_title) > 140:
                new_title = new_title[:137] + "..."

            title_result = update_listing(lid, {"title": new_title})
            if "error" in title_result:
                print(f"  ⚠ Title update failed: {title_result.get('error', '')[:80]}")

            print(f"  ✓ FIXED: ${correct_etsy} (was ${current_price:.0f})")
            updated += 1
            time.sleep(0.5)
        else:
            print(f"  [DRY RUN] Would set to ${correct_etsy}")
            updated += 1

    print(f"\n{'='*70}")
    print(f"{'LIVE' if args.live else 'DRY RUN'} SUMMARY")
    print(f"{'='*70}")
    print(f"Updated: {updated}")
    print(f"Errors:  {errors}")
    if updated > 0:
        print(f"\nTotal Pictorem cost (if all sold): ${total_pictorem_cost:,.2f}")
        print(f"Total Etsy revenue (if all sold):  ${total_etsy_revenue:,.0f}")
        print(f"Total margin:                      ${total_etsy_revenue - total_pictorem_cost:,.0f}")
        print(f"Avg margin per print:              {((total_etsy_revenue - total_pictorem_cost) / total_etsy_revenue * 100):.0f}%")


if __name__ == "__main__":
    main()
