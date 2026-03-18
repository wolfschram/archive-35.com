"""Etsy Listing Restructure + SEO Rewrite Agent for Archive-35.

Transforms all listings (active + inactive) to single-SKU HD Metal Prints:
- Detects orientation from Etsy image dimensions
- Sets single size per listing based on orientation
- Rewrites title/description/tags with Claude Vision
- Sets 3x markup pricing on Pictorem base costs
- Reactivates inactive listings after transformation
- Logs all deactivated listing IDs for recovery

Usage:
    from src.agents.etsy_agent import restructure_all_listings
    results = restructure_all_listings(conn, client)
"""

from __future__ import annotations

import json
import logging
import sqlite3
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from src.agents.etsy_pricing import (
    detect_orientation,
    get_listing_pricing,
)
from src.integrations.etsy import (
    _api_request,
    activate_listing,
    deactivate_listing,
    ensure_valid_token,
    get_listings,
    update_listing,
)
from src.safety.audit import log as audit_log
from src.safety.rate_limiter import check_limit, record_usage

logger = logging.getLogger(__name__)

DEACTIVATED_LOG = Path(__file__).parent.parent.parent / "data" / "deactivated_listings.json"

# ── Claude Vision prompt ────────────────────────────────────────────────

ETSY_SEO_PROMPT_TEMPLATE = (
    "You are an expert fine art photography copywriter for Etsy.\n"
    "Analyze this image and generate optimized listing content.\n\n"
    "CONTEXT:\n"
    "- Brand: Archive-35 / The Restless Eye by Wolf Schram\n"
    "- 25+ years photographing across 55 countries\n"
    "- Product: Single-SKU {size_label} HD Metal Print on White Gloss ChromaLuxe\n"
    "- Print resolution: {dpi} DPI ({quality_badge})\n"
    "- Source image: {photo_pixels} ({megapixels} megapixels)\n"
    "- Mount: Metal standoff hanging brackets included — floats ¾\" off the wall\n"
    "- Archival rating: 60+ years fade resistance\n"
    "- Certificate of Authenticity included\n"
    "- Free shipping across North America and Canada\n"
    "- Current listing title: {current_title}\n\n"
    "GENERATE:\n"
    "1. TITLE: SEO-optimized, max 140 chars. Front-load search terms.\n"
    '   Format: "[Subject] {size_label} Metal Print | Large-Scale Fine Art | Free Shipping"\n'
    "   ALWAYS include the exact print size ({size_label}) in the title.\n"
    "   Do NOT include brand name (Etsy shows shop name separately).\n\n"
    "2. DESCRIPTION: 6 sections separated by blank lines.\n"
    "   Section 1: FREE SHIPPING — This large-scale {size_label} museum-quality\n"
    "   metal print ships free across North America and Canada.\n"
    "   Arrives ready to hang with included standoff brackets. No frame needed.\n"
    "   Section 2: The moment — what is happening in the image, the story.\n"
    "   Be precise about what you see. Do NOT invent locations.\n"
    "   Section 3: PRINT SPECIFICATIONS — bullet list:\n"
    "   • Size: {size_label}\n"
    "   • Material: ChromaLuxe HD Aluminum — White Gloss\n"
    "   • Print Resolution: {dpi} DPI ({quality_badge})\n"
    "   • Source Image: {photo_pixels} ({megapixels} megapixels)\n"
    "   • Mount: Metal standoff brackets included — floats off wall\n"
    "   • Archival Rating: 60+ years fade resistance\n"
    "   • Certificate of Authenticity included\n"
    "   Section 4: WHY CHROMALUXE HD METAL — image infused into specially\n"
    "   coated aluminum at extreme heat. Colors pop with unmatched vibrancy,\n"
    "   deep luminous blacks, luminous depth paper and canvas cannot match.\n"
    "   White gloss finish brings the image to life. Standoff brackets float\n"
    "   the print off the wall for a clean, gallery-quality look.\n"
    "   Section 5: THE ARTIST — Wolf Schram, 25 years, 55 countries,\n"
    "   The Restless Eye. Fine art photography meant to be experienced at scale.\n"
    "   Section 6: 100% satisfaction guarantee. Ships from North America.\n\n"
    "3. TAGS: Exactly 13 tags. EACH TAG MAX 20 CHARACTERS (Etsy limit).\n"
    "   - 3 subject/location (specific, not generic)\n"
    "   - 2 style/mood (dramatic, minimalist, etc.)\n"
    "   - 3 room/decor (living room art, office decor, etc.)\n"
    "   - 2 occasion (housewarming gift, anniversary, etc.)\n"
    "   - 3 medium (metal print, metal wall art, large wall art)\n\n"
    "4. PRICE_CONTEXT: One sentence about ChromaLuxe metal print value.\n\n"
    "CRITICAL — ACCURACY:\n"
    "- Do NOT invent locations. Describe what's visible.\n"
    "- Do NOT mention cameras or lenses.\n"
    "- ICELAND AERIALS: Turquoise/milky water with black volcanic rock and\n"
    "  green moss seen from above = GLACIAL RIVER, not ocean. The turquoise\n"
    "  comes from glacial flour (pulverized rock). Only say 'ocean' if you\n"
    "  see open water with a visible horizon or surf hitting a beach.\n"
    "- WILDLIFE: Identify species precisely. Don't say 'mother and calf'\n"
    "  unless a calf is clearly visible. A single elephant is a single elephant.\n"
    "- River ≠ ocean. Lake ≠ ocean. Waterfall ≠ river. Be precise.\n\n"
    "FORMATTING:\n"
    "- FREE SHIPPING must be the first thing in the description.\n"
    '- JSON ONLY: {{"title":"...","description":"...","tags":[...],"price_context":"..."}}'
)


# ── Image helpers ───────────────────────────────────────────────────────

def _fetch_listing_images(listing_id: int) -> list[dict]:
    """Get all image data for a listing (includes dimensions)."""
    result = _api_request(f"/application/listings/{listing_id}/images")
    return result.get("results", [])


def _download_image_bytes(url: str) -> Optional[bytes]:
    """Download image from URL."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Archive35-Agent/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read()
    except Exception as e:
        logger.error("Failed to download %s: %s", url, e)
        return None


def _resize_image_for_api(image_bytes: bytes, max_edge: int = 2000, max_bytes: int = 4_500_000) -> bytes:
    """Resize image to fit within Claude API limits.

    Prevents 413 errors by limiting image size before base64 encoding.
    Claude Vision works well at 2000px — no need for full resolution.

    Args:
        image_bytes: Raw image data
        max_edge: Maximum dimension on longest edge (pixels)
        max_bytes: Maximum file size in bytes (before base64)

    Returns:
        JPEG bytes, resized and compressed to fit limits.
    """
    from io import BytesIO
    from PIL import Image

    img = Image.open(BytesIO(image_bytes))
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    # Resize if larger than max_edge
    w, h = img.size
    if max(w, h) > max_edge:
        scale = max_edge / max(w, h)
        new_w, new_h = int(w * scale), int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        logger.info("Resized image %dx%d → %dx%d for API", w, h, new_w, new_h)

    # Compress to fit max_bytes
    quality = 85
    while quality >= 40:
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
        quality -= 10

    # Last resort: return whatever we have
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=40, optimize=True)
    return buf.getvalue()


# ── Vision analysis ─────────────────────────────────────────────────────

def analyze_listing_image(
    image_url: str,
    current_title: str,
    size_label: str,
    client: Any,
    model: str = "claude-sonnet-4-5-20250929",
    dpi: int = 0,
    quality_badge: str = "",
    photo_pixels: str = "",
    megapixels: float = 0.0,
) -> Optional[dict[str, Any]]:
    """Send listing image to Claude Vision for SEO-optimized content."""
    import base64

    image_bytes = _download_image_bytes(image_url)
    if not image_bytes:
        return None

    # Resize to prevent 413 errors — Claude Vision works fine at 2000px
    image_bytes = _resize_image_for_api(image_bytes)
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    prompt = ETSY_SEO_PROMPT_TEMPLATE.format(
        current_title=current_title,
        size_label=size_label,
        dpi=dpi or "N/A",
        quality_badge=quality_badge or "N/A",
        photo_pixels=photo_pixels or "N/A",
        megapixels=f"{megapixels:.1f}" if megapixels else "N/A",
    )

    try:
        response = client.messages.create(
            model=model,
            max_tokens=1500,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64},
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )

        text = response.content[0].text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])

        result = json.loads(text)
        # Enforce Etsy tag constraints: max 13 tags, each max 20 chars
        tags = result.get("tags", [])
        tags = [t[:20] for t in tags]  # Etsy 20-char limit per tag
        if len(tags) > 13:
            tags = tags[:13]
        result["tags"] = tags
        title = result.get("title", "")
        if len(title) > 140:
            result["title"] = title[:137] + "..."
        return result

    except (json.JSONDecodeError, Exception) as e:
        logger.error("Vision analysis failed: %s", e)
        return None


# ── Listing helpers ─────────────────────────────────────────────────────

def _fetch_all_listings() -> tuple[list[dict], list[dict]]:
    """Fetch all active and inactive listings from Etsy."""
    active, inactive = [], []
    for state, target in [("active", active), ("inactive", inactive)]:
        offset = 0
        while True:
            batch = get_listings(state=state, limit=25, offset=offset)
            if "error" in batch:
                logger.error("Failed to fetch %s listings: %s", state, batch["error"])
                break
            results = batch.get("results", [])
            target.extend(results)
            if len(results) < 25:
                break
            offset += 25
    return active, inactive


def _save_deactivated_log(entries: list[dict]):
    """Save deactivated listing IDs to JSON for recovery."""
    DEACTIVATED_LOG.parent.mkdir(parents=True, exist_ok=True)
    existing = []
    if DEACTIVATED_LOG.exists():
        try:
            existing = json.loads(DEACTIVATED_LOG.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    existing.extend(entries)
    DEACTIVATED_LOG.write_text(json.dumps(existing, indent=2) + "\n")
    logger.info("Saved %d entries to %s", len(entries), DEACTIVATED_LOG)


def _apply_update(listing_id: int, seo_data: dict, pricing: dict) -> dict:
    """Push full restructure update to Etsy API."""
    updates = {
        "title": seo_data["title"],
        "description": seo_data["description"],
        "tags": seo_data["tags"],
    }
    return update_listing(listing_id, updates)


def _format_paste_ready(listing_id: int, seo_data: dict, pricing: dict) -> str:
    """Format as paste-ready text for manual update."""
    tags_str = ", ".join(seo_data.get("tags", []))
    return (
        f"--- Listing {listing_id} ---\n"
        f"TITLE:\n{seo_data.get('title', '')}\n\n"
        f"DESCRIPTION:\n{seo_data.get('description', '')}\n\n"
        f"TAGS (13):\n{tags_str}\n\n"
        f"PRODUCT: {pricing['material']}\n"
        f"SIZE: {pricing['size_label']}\n"
        f"PRICE: ${pricing['etsy_price_usd']:.0f}\n"
        f"SHIPPING: {pricing['shipping']}\n---"
    )


# ── Main orchestrator ───────────────────────────────────────────────────

def restructure_all_listings(
    conn: sqlite3.Connection,
    client: Any,
    model: str = "claude-sonnet-4-5-20250929",
    dry_run: bool = False,
) -> dict[str, Any]:
    """Restructure all Etsy listings to single-SKU HD Metal Prints.

    Processes both active and inactive listings. For each:
    1. Detect orientation from image dimensions
    2. Calculate pricing (3x Pictorem cost)
    3. Rewrite SEO with Claude Vision
    4. Update listing via API (or paste-ready fallback)
    5. Reactivate inactive listings after transformation
    """
    token_result = ensure_valid_token()
    if not token_result.get("valid"):
        return {"error": token_result.get("error", "Token invalid")}

    active, inactive = _fetch_all_listings()
    all_listings = [(l, "active") for l in active] + [(l, "inactive") for l in inactive]
    logger.info("Found %d active + %d inactive = %d total listings",
                len(active), len(inactive), len(all_listings))

    audit_log(conn, "etsy_agent", "restructure_started", {
        "active": len(active), "inactive": len(inactive),
    })

    summary = {
        "total": len(all_listings), "updated": 0, "reactivated": 0,
        "paste_ready": 0, "skipped": 0, "errors": [], "results": [],
    }
    can_write = None

    for listing, orig_state in all_listings:
        listing_id = listing["listing_id"]
        title = listing.get("title", "")

        if not check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=10.0):
            summary["errors"].append("Rate limit reached — stopped early")
            break

        # Step 1: Get images + detect orientation
        images = _fetch_listing_images(listing_id)
        if not images:
            summary["skipped"] += 1
            continue

        w = images[0].get("full_width", 0)
        h = images[0].get("full_height", 0)
        pricing = get_listing_pricing(photo_w=w, photo_h=h)
        image_url = images[0].get("url_570xN") or images[0].get("url_fullxfull")

        # Step 2: Claude Vision SEO rewrite
        seo_data = analyze_listing_image(
            image_url, title, pricing["size_label"], client, model,
        )
        if not seo_data:
            summary["skipped"] += 1
            summary["errors"].append(f"Vision failed for {listing_id}")
            continue

        cost = 0.005
        record_usage(conn, "anthropic", cost_usd=cost)

        entry = {
            "listing_id": listing_id, "orig_state": orig_state,
            "orientation": pricing["orientation"], "size": pricing["size_label"],
            "price_usd": pricing["etsy_price_usd"],
            "old_title": title, "new_title": seo_data.get("title", ""),
        }

        # Step 3: Apply update
        if dry_run:
            entry["action"] = "dry_run"
            entry["paste_ready"] = _format_paste_ready(listing_id, seo_data, pricing)
            summary["paste_ready"] += 1
        elif can_write is not False:
            api_result = _apply_update(listing_id, seo_data, pricing)
            if "error" in api_result:
                if api_result.get("status_code") in (403, 401):
                    can_write = False
                    entry["action"] = "paste_ready_fallback"
                    entry["paste_ready"] = _format_paste_ready(listing_id, seo_data, pricing)
                    summary["paste_ready"] += 1
                else:
                    entry["action"] = "error"
                    entry["error"] = api_result.get("detail", api_result["error"])
                    summary["errors"].append(f"{listing_id}: {entry['error']}")
            else:
                can_write = True
                entry["action"] = "updated"
                summary["updated"] += 1

                # Step 4: Reactivate if was inactive
                if orig_state == "inactive":
                    act_result = activate_listing(listing_id)
                    if "error" not in act_result:
                        entry["reactivated"] = True
                        summary["reactivated"] += 1
                    else:
                        entry["reactivate_error"] = act_result.get("error")
        else:
            entry["action"] = "paste_ready"
            entry["paste_ready"] = _format_paste_ready(listing_id, seo_data, pricing)
            summary["paste_ready"] += 1

        summary["results"].append(entry)
        audit_log(conn, "etsy_agent", "listing_restructured", {
            "listing_id": listing_id, "action": entry.get("action"),
            "orientation": pricing["orientation"], "price": pricing["etsy_price_usd"],
        }, cost_usd=cost)

    audit_log(conn, "etsy_agent", "restructure_complete", {
        k: v for k, v in summary.items() if k != "results"
    })

    logger.info(
        "Restructure complete: %d updated, %d reactivated, %d paste-ready, %d skipped",
        summary["updated"], summary["reactivated"],
        summary["paste_ready"], summary["skipped"],
    )
    return summary
