"""Instagram auto-posting agent for Archive-35.

Posts 3x/day from live Etsy listing images. Rotates through catalogue,
never repeats within 30 days. Captions generated with brand voice.

Usage:
    from src.agents.instagram_agent import post_next_image
    result = post_next_image(conn, client)
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from src.agents.etsy_copywriter import get_story_for_collection, STORY_BANK
from src.integrations.instagram import is_configured, publish_photo
from src.safety.audit import log as audit_log
from src.safety.kill_switch import is_active
from src.safety.rate_limiter import check_limit, record_usage

logger = logging.getLogger(__name__)

NO_REPEAT_DAYS = 30

# ── DB setup ────────────────────────────────────────────────────────────

INSTAGRAM_POSTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS instagram_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    etsy_listing_id TEXT NOT NULL,
    image_url TEXT NOT NULL,
    caption TEXT,
    media_id TEXT,
    posted_at TEXT NOT NULL,
    success INTEGER DEFAULT 1
);
"""


def ensure_table(conn: sqlite3.Connection):
    """Create instagram_posts table if it doesn't exist."""
    conn.execute(INSTAGRAM_POSTS_SCHEMA)
    conn.commit()


# ── Image selection ─────────────────────────────────────────────────────

def _get_recently_posted_ids(conn: sqlite3.Connection) -> set[str]:
    """Get listing IDs posted in the last NO_REPEAT_DAYS days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=NO_REPEAT_DAYS)).isoformat()
    rows = conn.execute(
        "SELECT DISTINCT etsy_listing_id FROM instagram_posts WHERE posted_at > ? AND success = 1",
        (cutoff,),
    ).fetchall()
    return {r[0] for r in rows}


def _fetch_etsy_listing_images(conn: sqlite3.Connection) -> list[dict]:
    """Fetch all active Etsy listings with their primary image URLs.

    Uses the Etsy API to get current listings + images.
    Returns list of {listing_id, title, image_url, tags, collection}.
    """
    from src.integrations.etsy import get_listings, _api_request, ensure_valid_token

    token_result = ensure_valid_token()
    if not token_result.get("valid"):
        logger.error("Etsy token invalid: %s", token_result.get("error"))
        return []

    all_listings = []
    offset = 0
    while True:
        batch = get_listings(state="active", limit=25, offset=offset)
        if "error" in batch:
            break
        results = batch.get("results", [])
        all_listings.extend(results)
        if len(results) < 25:
            break
        offset += 25

    listing_images = []
    for listing in all_listings:
        lid = listing["listing_id"]
        images = _api_request(f"/application/listings/{lid}/images")
        imgs = images.get("results", [])
        if not imgs:
            continue

        # Use the fullxfull URL — Instagram needs public URLs
        image_url = imgs[0].get("url_fullxfull") or imgs[0].get("url_570xN")
        if not image_url:
            continue

        # Check aspect ratio — Instagram requires 4:5 (0.8) to 1.91:1
        img_w = imgs[0].get("full_width", 0)
        img_h = imgs[0].get("full_height", 0)
        if img_h > 0:
            aspect = img_w / img_h
            if aspect < 0.8 or aspect > 1.91:
                logger.info("Skipping listing %s — aspect ratio %.2f out of range", lid, aspect)
                continue

        # Try to detect collection from title/tags
        title = listing.get("title", "")
        tags = listing.get("tags", [])
        collection = _guess_collection(title, tags)

        listing_images.append({
            "listing_id": str(lid),
            "title": title,
            "image_url": image_url,
            "tags": tags,
            "collection": collection,
        })

    return listing_images


def _guess_collection(title: str, tags: list[str]) -> str:
    """Guess the collection from title/tags for story bank matching."""
    combined = (title + " " + " ".join(tags)).lower()
    # Check story bank keys
    for key in STORY_BANK:
        if key in combined:
            return key
    # Common mappings
    for keyword, collection in [
        ("hawaii", "hawaii"), ("lava", "hawaii"), ("volcano", "hawaii"),
        ("iceland", "iceland"), ("tanzania", "tanzania"), ("serengeti", "tanzania"),
        ("elephant", "tanzania"), ("giraffe", "tanzania"),
        ("teton", "grand teton"), ("venice", "venice"), ("italy", "italy"),
        ("antelope", "antelope canyon"), ("slot canyon", "antelope canyon"),
        ("new york", "new york"), ("nyc", "new york"),
        ("los angeles", "los angeles"), ("gehry", "architecture"),
        ("desert", "desert"), ("dunes", "desert"), ("white sands", "desert"),
        ("cuba", "cuba"), ("aircraft", "planes"), ("hangar", "planes"),
        ("ocean", "ocean"), ("wave", "ocean"),
    ]:
        if keyword in combined:
            return collection
    return ""


def pick_next_image(
    conn: sqlite3.Connection,
) -> Optional[dict]:
    """Pick the next image to post, respecting 30-day no-repeat rule."""
    ensure_table(conn)
    recently_posted = _get_recently_posted_ids(conn)
    listings = _fetch_etsy_listing_images(conn)

    if not listings:
        logger.warning("No Etsy listings found for Instagram posting")
        return None

    # Filter out recently posted
    candidates = [l for l in listings if l["listing_id"] not in recently_posted]

    if not candidates:
        logger.info("All %d listings posted in last %d days, resetting rotation",
                     len(listings), NO_REPEAT_DAYS)
        candidates = listings  # Allow repeats if all exhausted

    # Pick the first candidate (could add randomization later)
    return candidates[0]


# ── Caption generation ──────────────────────────────────────────────────

CAPTION_PROMPT = (
    "You are the voice of Archive-35 (The Restless Eye) on Instagram.\n"
    "Write an Instagram caption for this fine art photograph.\n\n"
    "STEP 1 — IDENTIFY THE SUBJECT ACCURATELY.\n"
    "Before writing, determine what is actually in the photo.\n"
    "Use these rules to avoid common misidentification:\n\n"
    "ICELAND AERIALS: Turquoise/milky water with black volcanic rock and green\n"
    "moss seen from above = GLACIAL RIVER, not ocean. The turquoise color comes\n"
    "from glacial flour (pulverized rock). These are braided river channels in\n"
    "the Icelandic highlands. Only call it ocean if you see open water with a\n"
    "visible horizon or clear wave/surf patterns hitting a beach.\n\n"
    "TANZANIA/SERENGETI: Identify animals by species — elephant, zebra, giraffe,\n"
    "wildebeest, lion. Don't guess. If you can't tell, say 'wildlife.'\n\n"
    "GENERAL: River ≠ ocean. Lake ≠ ocean. Waterfall ≠ river. Be precise.\n"
    "If unsure, keep the description general rather than guessing wrong.\n\n"
    "STEP 2 — WRITE THE CAPTION.\n"
    "RULES:\n"
    "- Never salesy. Thoughtful, human, slightly poetic.\n"
    "- Short sentences. Present tense for the moment.\n"
    "- Never: 'stunning', 'beautiful', 'perfect for', 'captures'\n"
    "- Accuracy is non-negotiable.\n\n"
    "COLLECTION: {collection}\n"
    "STORY: {story}\n\n"
    "STRUCTURE:\n"
    "- Line 1: One strong opening sentence about the moment/place\n"
    "- Lines 2-3: Brief personal story (2-3 sentences max)\n"
    "- Blank line\n"
    "- Available as a fine art print — link in bio\n"
    "- Blank line\n"
    "- 8-12 hashtags mixing niche + broad:\n"
    "  Include 3-4 niche (#fineartphotography #photographyprints #artcollector)\n"
    "  Include 2-3 location (#iceland #serengeti #newyork etc)\n"
    "  Include 2-3 decor (#wallart #homedecor #interiordesign)\n"
    "  Include 1-2 broad (#photography #art)\n\n"
    "Do NOT output any preamble, headers, or labels. Start directly with the caption.\n"
    "Max 300 words. Plain text only (no JSON)."
)


def generate_caption(
    listing: dict,
    client: Any,
    model: str = "claude-sonnet-4-5-20250929",
) -> Optional[str]:
    """Generate an Instagram caption using Claude Vision + story bank.

    Sends the actual image to Claude so captions describe what's really
    in the photo — no more guessing from titles alone.
    """
    collection = listing.get("collection", "")
    story = get_story_for_collection(collection) if collection else ""

    prompt = CAPTION_PROMPT.format(
        collection=collection or "Fine Art Photography",
        story=story or "25 years touring, 55 countries, one restless eye.",
    )

    image_url = listing.get("image_url", "")

    # Build message content — include image if URL available
    content: list[dict] = []
    if image_url:
        content.append({
            "type": "image",
            "source": {"type": "url", "url": image_url},
        })
    content.append({"type": "text", "text": prompt})

    try:
        response = client.messages.create(
            model=model, max_tokens=500,
            messages=[{"role": "user", "content": content}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.error("Caption generation failed: %s", e)
        return None


# ── Main posting function ───────────────────────────────────────────────

def post_next_image(
    conn: sqlite3.Connection,
    client: Any,
    model: str = "claude-sonnet-4-5-20250929",
    dry_run: bool = False,
) -> dict[str, Any]:
    """Pick the next image and post to Instagram.

    Returns dict with post details or error.
    """
    ensure_table(conn)

    if is_active(conn, "instagram"):
        return {"error": "Kill switch active for instagram"}

    if not is_configured():
        return {"error": "Instagram not configured"}

    if not check_limit(conn, "instagram", daily_call_limit=25, daily_cost_limit_usd=999.0):
        return {"error": "Instagram daily post limit reached"}

    # Pick image
    listing = pick_next_image(conn)
    if not listing:
        return {"error": "No images available to post"}

    # Generate caption
    if not check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=15.0):
        return {"error": "Anthropic rate limit reached"}

    caption = generate_caption(listing, client, model)
    if not caption:
        return {"error": "Caption generation failed"}

    record_usage(conn, "anthropic", cost_usd=0.002)

    result = {
        "listing_id": listing["listing_id"],
        "title": listing["title"],
        "image_url": listing["image_url"],
        "caption_preview": caption[:200],
        "collection": listing["collection"],
    }

    if dry_run:
        result["action"] = "dry_run"
        return result

    # Post to Instagram
    post_result = publish_photo(
        image_url=listing["image_url"],
        caption=caption,
        conn=conn,
        photo_id=listing["listing_id"],
    )

    now = datetime.now(timezone.utc).isoformat()
    success = post_result.get("success", False)

    # Log to instagram_posts table
    conn.execute(
        """INSERT INTO instagram_posts
           (etsy_listing_id, image_url, caption, media_id, posted_at, success)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            listing["listing_id"],
            listing["image_url"],
            caption,
            post_result.get("media_id", ""),
            now,
            1 if success else 0,
        ),
    )
    conn.commit()

    if success:
        record_usage(conn, "instagram")
        result["action"] = "posted"
        result["media_id"] = post_result.get("media_id")
    else:
        result["action"] = "failed"
        result["error"] = post_result.get("error", "Unknown error")

    audit_log(conn, "instagram_agent", "post", {
        "listing_id": listing["listing_id"],
        "success": success,
        "media_id": post_result.get("media_id", ""),
    })

    return result
