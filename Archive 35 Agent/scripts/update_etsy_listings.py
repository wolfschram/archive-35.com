"""Update all Etsy listings with proper sizing, pricing, and descriptions.

Resolves original photo dimensions from the DB, calculates the largest
print size at 150+ DPI, and updates each listing with:
- Correct print dimensions based on actual photo resolution
- Proper pricing (Pictorem cost × 2 + Etsy fee markup)
- Enhanced descriptions emphasizing large-scale, museum-quality prints
- DPI quality tier and source resolution info

Usage:
    # Dry run (preview changes, no API calls):
    python scripts/update_etsy_listings.py --dry-run

    # Live update all listings:
    python scripts/update_etsy_listings.py --live

    # Update a single listing:
    python scripts/update_etsy_listings.py --live --listing-id 4473737336
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.integrations.etsy import (
    ensure_valid_token,
    get_credentials,
    get_listings,
    update_listing,
    _api_request,
)
from src.agents.etsy_pricing import (
    resolve_original_dimensions,
    calculate_best_size,
    get_listing_pricing,
    detect_orientation,
    MIN_DPI,
    MATERIAL,
)
from src.brand.pricing import (
    PRICE_TABLE,
    ASPECT_RATIO_CATEGORIES,
    get_matching_category,
    filter_sizes_by_aspect,
    calculate_dpi,
    get_quality_badge,
    website_price,
    etsy_price,
    PICTOREM_COSTS,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ── Description Templates ──────────────────────────────────────────────

def build_enhanced_description(
    current_title: str,
    current_desc: str,
    width_in: int,
    height_in: int,
    dpi: int,
    quality_badge: str,
    photo_w: int,
    photo_h: int,
    megapixels: float,
    etsy_price_usd: float,
) -> str:
    """Build an enhanced description emphasizing large-scale, museum-quality prints.

    Cross-references the Archive-35 website messaging:
    - Museum-quality prints
    - ChromaLuxe HD metal
    - Specific dimensions and DPI
    - Source resolution
    - 60-year archival rating
    """
    # Extract the story part from existing description (after the shipping section)
    story = ""
    if current_desc:
        lines = current_desc.split("\n")
        # Find the story section (usually after FREE SHIPPING paragraph)
        story_lines = []
        past_shipping = False
        for line in lines:
            stripped = line.strip()
            if past_shipping and stripped:
                # Stop before "THE ARTIST" or "WHY CHROMALUXE" or "SIZE" sections
                upper = stripped.upper()
                if any(x in upper for x in ["THE ARTIST", "WHY CHROMALUXE", "SIZE", "SATISFACTION", "WOLF SCHRAM", "25 YEARS"]):
                    break
                story_lines.append(stripped)
            if any(x in stripped.upper() for x in ["THE MOMENT", "READY TO HANG", "NO FRAME NEEDED"]):
                past_shipping = True

        story = "\n".join(story_lines).strip()

    # If we couldn't extract a story, use a cleaned version of existing desc
    if not story and current_desc:
        # Take first meaningful paragraph after shipping info
        paragraphs = current_desc.split("\n\n")
        for p in paragraphs[1:3]:
            cleaned = p.strip()
            if cleaned and "FREE SHIPPING" not in cleaned.upper() and "CHROMALUXE" not in cleaned.upper():
                story = cleaned
                break

    if not story:
        story = "A striking moment captured through the lens of Wolf Schram."

    sq_ft = (width_in * height_in) / 144
    size_desc = f"{width_in}×{height_in} inches"
    if sq_ft >= 10:
        scale_word = "monumental"
    elif sq_ft >= 5:
        scale_word = "large-scale"
    elif sq_ft >= 3:
        scale_word = "substantial"
    else:
        scale_word = "gallery-sized"

    description = f"""FREE SHIPPING — This {scale_word} {size_desc} museum-quality metal print ships free across North America and Canada. Arrives ready to hang with included standoff brackets. No frame needed.

{story}

PRINT SPECIFICATIONS
• Size: {width_in}×{height_in}" ({sq_ft:.1f} sq ft of wall art)
• Material: ChromaLuxe HD Aluminum — White Gloss
• Print Resolution: {dpi} DPI ({quality_badge})
• Source Image: {photo_w:,}×{photo_h:,} pixels ({megapixels:.1f} megapixels)
• Mount: Metal standoff brackets included — floats ¾" off the wall
• Archival Rating: 60+ years fade resistance
• Certificate of Authenticity included

WHY CHROMALUXE HD METAL
This is not a regular print. ChromaLuxe HD aluminum is the gold standard for fine art photography. Your image is infused directly into a specially coated aluminum sheet at extreme heat, creating colors that pop with unmatched vibrancy, deep luminous blacks, and a luminous depth that paper and canvas cannot match. The white gloss finish adds a subtle glow that brings the image to life. Metal standoff brackets float the print off the wall for a clean, gallery-quality look.

THE ARTIST — Wolf Schram has spent 25 years photographing across 55 countries. Each print in the Archive-35 collection is a moment from decades of travel — captured, curated, and printed at the highest quality available. This is fine art photography meant to be experienced at scale.

100% satisfaction guarantee. Ships from North America."""

    return description


def build_enhanced_title(
    current_title: str,
    width_in: int,
    height_in: int,
    quality_badge: str,
) -> str:
    """Build an enhanced title with proper dimensions.

    Format: [Subject] [Size] Metal Print | Large-Scale Fine Art | Free Shipping
    Max 140 chars (Etsy limit).
    """
    import re

    # Extract subject from current title (before the size/format part)
    parts = current_title.split("|")
    subject_part = parts[0].strip()

    # Remove old size references and format labels
    subject_part = re.sub(r'\d+[×x]\d+\s*(inches?|in|")\s*', '', subject_part)
    subject_part = re.sub(r'Metal Print\s*', '', subject_part)
    subject_part = re.sub(r'\s+', ' ', subject_part).strip()

    # Build size string
    size_str = f"{width_in}×{height_in}\""

    # Scale descriptor for title (avoid "Good" — all quality tiers are premium)
    sq_in = width_in * height_in
    if sq_in >= 1200:
        scale = "Large-Scale Fine Art"
    elif sq_in >= 500:
        scale = "Fine Art Wall Art"
    else:
        scale = "Fine Art Print"

    title = f"{subject_part} {size_str} Metal Print | {scale} | Free Shipping"

    if len(title) > 140:
        title = f"{subject_part} {size_str} Metal Print | Free Shipping"
    if len(title) > 140:
        title = title[:137] + "..."

    return title


# ── Main Update Logic ──────────────────────────────────────────────────

def fetch_all_active_listings() -> list[dict]:
    """Fetch all active Etsy listings with pagination."""
    all_listings = []
    for offset in range(0, 200, 25):
        batch = get_listings(state="active", limit=25, offset=offset)
        results = batch.get("results", [])
        all_listings.extend(results)
        if len(results) < 25:
            break
    return all_listings


def get_listing_images(listing_id: int) -> list[dict]:
    """Get image data for a listing."""
    result = _api_request(f"/application/listings/{listing_id}/images")
    return result.get("results", [])


def process_listing(listing: dict, dry_run: bool = True) -> dict:
    """Process a single listing: calculate sizing, pricing, and new content.

    Returns a dict with all proposed changes.
    """
    listing_id = listing["listing_id"]
    current_title = listing.get("title", "")
    current_desc = listing.get("description", "")
    current_price = listing.get("price", {})
    current_price_usd = current_price.get("amount", 0) / current_price.get("divisor", 100)

    # Get image dimensions
    images = get_listing_images(listing_id)
    if not images:
        return {"listing_id": listing_id, "status": "skipped", "reason": "no images"}

    thumb_w = images[0].get("full_width", 0)
    thumb_h = images[0].get("full_height", 0)

    # Resolve to original dimensions
    orig_w, orig_h = resolve_original_dimensions(thumb_w, thumb_h)

    # Get full pricing info
    pricing = get_listing_pricing(photo_w=thumb_w, photo_h=thumb_h)

    width_in = pricing["width_in"]
    height_in = pricing["height_in"]
    dpi = pricing["dpi"]
    megapixels = pricing["megapixels"]

    quality_badge = "Museum Quality" if dpi >= 300 else ("Excellent" if dpi >= 200 else "Good")

    # Build new title and description
    new_title = build_enhanced_title(current_title, width_in, height_in, quality_badge)
    new_desc = build_enhanced_description(
        current_title=current_title,
        current_desc=current_desc,
        width_in=width_in,
        height_in=height_in,
        dpi=dpi,
        quality_badge=quality_badge,
        photo_w=orig_w,
        photo_h=orig_h,
        megapixels=megapixels,
        etsy_price_usd=pricing["etsy_price_usd"],
    )

    # Build tags emphasizing large-scale
    tags = build_tags(current_title, width_in, height_in, quality_badge)

    result = {
        "listing_id": listing_id,
        "status": "pending",
        "current_title": current_title,
        "new_title": new_title,
        "current_price_usd": current_price_usd,
        "new_price_usd": pricing["etsy_price_usd"],
        "price_cents": pricing["etsy_price_cents"],
        "thumb_dims": f"{thumb_w}×{thumb_h}",
        "orig_dims": f"{orig_w}×{orig_h}",
        "print_size": f"{width_in}×{height_in}\"",
        "dpi": dpi,
        "quality": quality_badge,
        "megapixels": megapixels,
        "new_description": new_desc,
        "tags": tags,
    }

    return result


def build_tags(title: str, width_in: int, height_in: int, quality: str) -> list[str]:
    """Build 13 SEO-optimized tags (each ≤20 chars)."""
    tags = []

    # Size-related tags
    tags.append(f"{width_in}x{height_in} metal print")
    tags.append("large wall art")
    tags.append("metal print")

    # Material tags
    tags.append("chromaluxe print")
    tags.append("aluminum wall art")
    tags.append("metal wall decor")

    # Quality tags
    if "Museum" in quality:
        tags.append("museum quality art")
    else:
        tags.append("fine art print")

    # Decor tags
    tags.append("living room art")
    tags.append("office wall art")
    tags.append("modern home decor")

    # Gift/occasion
    tags.append("housewarming gift")
    tags.append("photography print")

    # Extract location from title
    location_words = []
    for word in ["Iceland", "Africa", "Safari", "Mountain", "Ocean", "Waterfall",
                 "New Zealand", "New York", "Tanzania", "Penguin", "Cheetah",
                 "Lion", "Elephant", "Puffin", "Canyon"]:
        if word.lower() in title.lower():
            tag = f"{word.lower()} wall art"
            if len(tag) <= 20:
                location_words.append(tag)

    # Replace generic tags with location-specific ones
    for loc_tag in location_words[:2]:
        if len(tags) >= 13:
            tags.pop()  # Remove last generic tag
        tags.insert(3, loc_tag)

    # Ensure exactly 13 tags, each ≤20 chars
    tags = [t[:20] for t in tags]
    while len(tags) < 13:
        tags.append("ready to hang art")
    tags = tags[:13]

    return tags


def apply_update(listing_id: int, title: str, description: str, price_cents: int, tags: list[str]) -> dict:
    """Push update to Etsy API."""
    updates = {
        "title": title,
        "description": description,
        "tags": tags,
    }

    # Update listing metadata
    result = update_listing(listing_id, updates)
    if "error" in result:
        return result

    # Update price separately if needed
    # Note: Etsy listing price updates may need inventory API
    # For single-SKU listings, we can set price in the listing update
    # Let's try including price in the update
    price_result = update_listing(listing_id, {"price": price_cents / 100})
    if "error" in price_result:
        logger.warning("Price update failed for %s: %s", listing_id, price_result.get("error"))

    return result


def main():
    parser = argparse.ArgumentParser(description="Update Etsy listings with proper sizing and pricing")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without updating")
    parser.add_argument("--live", action="store_true", help="Actually push updates to Etsy")
    parser.add_argument("--listing-id", type=int, help="Update a single listing")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of listings to process")
    parser.add_argument("--output", type=str, help="Save results to JSON file")
    args = parser.parse_args()

    if not args.dry_run and not args.live:
        print("ERROR: Must specify --dry-run or --live")
        sys.exit(1)

    # Verify token
    token = ensure_valid_token()
    if not token.get("valid"):
        print(f"ERROR: Etsy token invalid: {token.get('error')}")
        sys.exit(1)
    print("✓ Etsy token valid")

    # Fetch listings
    if args.listing_id:
        # Fetch single listing
        creds = get_credentials()
        result = _api_request(f"/application/listings/{args.listing_id}")
        if "error" in result:
            print(f"ERROR: {result['error']}")
            sys.exit(1)
        all_listings = [result]
    else:
        all_listings = fetch_all_active_listings()

    print(f"✓ Found {len(all_listings)} active listings")

    if args.limit > 0:
        all_listings = all_listings[:args.limit]
        print(f"  (limited to {args.limit})")

    # Process each listing
    results = []
    for i, listing in enumerate(all_listings):
        lid = listing["listing_id"]
        print(f"\n[{i+1}/{len(all_listings)}] Processing {lid}: {listing.get('title', '')[:50]}...")

        try:
            change = process_listing(listing, dry_run=args.dry_run)
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({"listing_id": lid, "status": "error", "error": str(e)})
            continue

        if change.get("status") == "skipped":
            print(f"  SKIPPED: {change.get('reason')}")
            results.append(change)
            continue

        # Show the proposed changes
        print(f"  Current: {change['current_title'][:60]}")
        print(f"  New:     {change['new_title'][:60]}")
        print(f"  Source:  {change['orig_dims']} ({change['megapixels']:.1f}MP)")
        print(f"  Print:   {change['print_size']} @ {change['dpi']} DPI ({change['quality']})")
        print(f"  Price:   ${change['current_price_usd']:.0f} → ${change['new_price_usd']:.0f}")

        if args.live:
            try:
                api_result = apply_update(
                    lid,
                    change["new_title"],
                    change["new_description"],
                    change["price_cents"],
                    change["tags"],
                )
                if "error" in api_result:
                    change["status"] = "error"
                    change["error"] = api_result.get("error", "Unknown")
                    print(f"  ✗ UPDATE FAILED: {change['error']}")
                else:
                    change["status"] = "updated"
                    print(f"  ✓ UPDATED")

                # Rate limit: Etsy allows ~10 req/sec
                time.sleep(0.5)

            except Exception as e:
                change["status"] = "error"
                change["error"] = str(e)
                print(f"  ✗ ERROR: {e}")
        else:
            change["status"] = "dry_run"

        results.append(change)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    updated = sum(1 for r in results if r.get("status") == "updated")
    dry_run_count = sum(1 for r in results if r.get("status") == "dry_run")
    errors = sum(1 for r in results if r.get("status") == "error")
    skipped = sum(1 for r in results if r.get("status") == "skipped")

    if args.dry_run:
        print(f"DRY RUN: {dry_run_count} listings would be updated")
    else:
        print(f"Updated: {updated}")
    print(f"Errors:  {errors}")
    print(f"Skipped: {skipped}")

    # Price impact
    old_total = sum(r.get("current_price_usd", 0) for r in results if r.get("status") in ("dry_run", "updated"))
    new_total = sum(r.get("new_price_usd", 0) for r in results if r.get("status") in ("dry_run", "updated"))
    if old_total > 0:
        print(f"\nPrice impact:")
        print(f"  Old average: ${old_total/max(1, len(results)):.0f}")
        print(f"  New average: ${new_total/max(1, len(results)):.0f}")
        print(f"  Total portfolio value: ${old_total:,.0f} → ${new_total:,.0f}")

    # Save results
    if args.output:
        output_path = Path(args.output)
        # Remove non-serializable data
        for r in results:
            if "new_description" in r:
                r["new_description_preview"] = r["new_description"][:200] + "..."
                del r["new_description"]
        output_path.write_text(json.dumps(results, indent=2))
        print(f"\nResults saved to {output_path}")

    return results


if __name__ == "__main__":
    main()
