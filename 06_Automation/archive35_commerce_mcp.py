#!/usr/bin/env python3
"""
Archive-35 Commerce MCP Server
Allows AI assistants (Claude, ChatGPT, Copilot) to search, browse,
and purchase Archive-35 images directly from their interfaces.

Run: python3 archive35_commerce_mcp.py
Or via FastMCP: fastmcp run archive35_commerce_mcp.py
"""
import os
import sys
import json
from pathlib import Path

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    print('Install MCP: pip3 install "mcp[cli]" --break-system-packages', file=sys.stderr)
    sys.exit(1)

# ── Paths ────────────────────────────────────────────────────────────────
ROOT = Path(os.environ.get(
    "ARCHIVE35_ROOT",
    os.path.expanduser("~/Documents/ACTIVE/archive-35")
))
DATA_DIR = ROOT / "data"
CATALOG_FILE = DATA_DIR / "licensing-catalog.json"
PHOTOS_FILE = DATA_DIR / "photos.json"

# ── MCP Server ───────────────────────────────────────────────────────────
mcp = FastMCP("archive35-commerce")

# ── Subject and mood tag maps (mirror gallery.js) ────────────────────────
SUBJECT_TAGS = {
    "landscape": ["mountain", "landscape", "valley", "glacier", "alpine", "highland",
                   "plateau", "dune", "mesa", "canyon", "cliff", "ridge", "peak",
                   "forest", "meadow", "field"],
    "wildlife": ["wildlife", "elephant", "zebra", "giraffe", "animal", "bird",
                  "safari", "serengeti", "migration"],
    "urban": ["city", "skyline", "street", "urban", "downtown", "building",
              "skyscraper", "neon", "traffic", "pedestrian"],
    "abstract": ["abstract", "pattern", "texture", "geometric", "reflection",
                  "blur", "light-study", "flowing-patterns", "mineral"],
    "travel": ["travel", "culture", "market", "temple", "village", "road",
               "journey", "exploration", "harbor", "port"],
    "architecture": ["architecture", "building", "facade", "dome", "arch",
                      "column", "modern-architecture", "glass", "steel",
                      "concert-hall", "basilica", "cathedral"],
    "ocean": ["ocean", "wave", "coast", "beach", "shore", "sea", "tide",
              "surf", "coral", "marine", "pacific", "atlantic"],
    "desert": ["desert", "sand", "dune", "arid", "mesa", "badlands",
               "sandstone", "slot-canyon", "red-rock", "white-sands"],
    "aerial": ["aerial", "drone", "overhead", "bird-eye", "above", "altitude"],
}

MOOD_TAGS = {
    "dramatic": ["dramatic", "storm", "thunder", "contrast", "bold", "powerful",
                  "intense", "dark-sky", "turbulent"],
    "minimalist": ["minimalist", "minimal", "sparse", "negative-space",
                    "solitude", "isolation", "simple", "clean"],
    "warm": ["warm", "golden", "sunset", "sunrise", "amber", "orange",
             "fire", "glow", "tropical"],
    "cold": ["cold", "ice", "snow", "frozen", "winter", "glacier",
             "arctic", "frost", "blue-tone"],
    "documentary": ["documentary", "candid", "authentic", "real", "unposed",
                     "street", "reportage", "journalism"],
    "serene": ["serene", "peaceful", "calm", "tranquil", "still", "quiet",
               "gentle", "soft-light", "pastel"],
}


def _load_catalog() -> dict:
    """Load the licensing catalog."""
    if CATALOG_FILE.exists():
        with open(CATALOG_FILE) as f:
            return json.load(f)
    return {"images": [], "tiers": {}, "classifications": {}}


def _load_photos() -> list:
    """Load photos.json gallery data."""
    if PHOTOS_FILE.exists():
        with open(PHOTOS_FILE) as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return data.get("photos", data.get("images", []))
    return []


def _matches_tags(image: dict, tag_map: dict, key: str) -> bool:
    """Check if an image matches a subject or mood tag."""
    if not key or key not in tag_map:
        return True
    search_terms = tag_map[key]
    title = (image.get("title") or "").lower()
    location = (image.get("location") or "").lower()
    collection = (image.get("collection") or "").lower()
    tags = " ".join(image.get("tags", [])).lower() if isinstance(image.get("tags"), list) else ""
    combined = f"{title} {location} {collection} {tags}"
    return any(term in combined for term in search_terms)


def _get_orientation(image: dict) -> str:
    """Determine image orientation from dimensions."""
    w = image.get("width", 0)
    h = image.get("height", 0)
    if w == 0 or h == 0:
        return "unknown"
    ratio = w / h
    if ratio > 2.5:
        return "panorama"
    elif ratio > 1.2:
        return "landscape"
    elif ratio < 0.8:
        return "portrait"
    elif 0.95 <= ratio <= 1.05:
        return "square"
    else:
        return "wide"


def _image_to_result(image: dict) -> dict:
    """Convert a catalog image to a search result."""
    return {
        "id": image.get("id", ""),
        "title": image.get("title", "Untitled"),
        "location": image.get("location", ""),
        "collection": image.get("collection", ""),
        "classification": image.get("classification", "STANDARD"),
        "width": image.get("width", 0),
        "height": image.get("height", 0),
        "megapixels": image.get("megapixels", 0),
        "orientation": _get_orientation(image),
        "thumbnail_url": f"https://archive-35.com/{image.get('thumbnail', '')}",
        "preview_url": f"https://archive-35.com/{image.get('preview', '')}",
        "starting_price_usd": image.get("starting_price", 280),
        "c2pa_verified": True,
        "status": image.get("status", "available"),
    }


# ── MCP Tools ────────────────────────────────────────────────────────────

@mcp.tool()
def search_images(
    query: str = "",
    subject: str = "",
    mood: str = "",
    location: str = "",
    orientation: str = "",
    limit: int = 20
) -> dict:
    """Search Archive-35's photography catalog. Returns matching images with thumbnails, metadata, and pricing.

    Subjects: landscape, wildlife, urban, abstract, travel, architecture, ocean, desert, aerial
    Moods: dramatic, minimalist, warm, cold, documentary, serene
    Orientations: landscape, portrait, panorama, square, wide

    All images are C2PA verified authentic photography — NOT AI-generated.
    166+ ultra-high-resolution images from 55+ countries by Wolf Schram.
    """
    catalog = _load_catalog()
    images = catalog.get("images", [])

    # Apply filters
    results = []
    for img in images:
        if subject and not _matches_tags(img, SUBJECT_TAGS, subject):
            continue
        if mood and not _matches_tags(img, MOOD_TAGS, mood):
            continue
        if location:
            loc_lower = location.lower()
            img_location = (img.get("location") or "").lower()
            img_collection = (img.get("collection") or "").lower()
            if loc_lower not in img_location and loc_lower not in img_collection:
                continue
        if orientation:
            if _get_orientation(img) != orientation:
                continue
        if query:
            q = query.lower()
            searchable = f"{img.get('title', '')} {img.get('location', '')} {img.get('collection', '')}".lower()
            if q not in searchable:
                continue
        results.append(_image_to_result(img))

    # Limit results
    limit = min(limit, 50)
    total = len(results)
    results = results[:limit]

    return {
        "gallery": "Archive-35 / The Restless Eye by Wolf Schram",
        "total_results": total,
        "showing": len(results),
        "c2pa_verified": True,
        "images": results,
        "browse_more": "https://archive-35.com/licensing.html",
        "api_endpoint": "https://archive-35.com/api/license/gallery",
    }


@mcp.tool()
def get_image_details(image_id: str) -> dict:
    """Get full details for a specific image including all licensing options and technical specs.

    Returns title, location, description, all resolution options, pricing tiers,
    C2PA verification status, and maximum print sizes.
    """
    catalog = _load_catalog()
    for img in catalog.get("images", []):
        if img.get("id") == image_id:
            return {
                "id": img["id"],
                "title": img.get("title", ""),
                "location": img.get("location", ""),
                "collection": img.get("collection", ""),
                "classification": img.get("classification", ""),
                "width": img.get("width", 0),
                "height": img.get("height", 0),
                "megapixels": img.get("megapixels", 0),
                "file_size_mb": img.get("file_size_mb", 0),
                "orientation": _get_orientation(img),
                "thumbnail_url": f"https://archive-35.com/{img.get('thumbnail', '')}",
                "preview_url": f"https://archive-35.com/{img.get('preview', '')}",
                "c2pa_verified": True,
                "max_print_300dpi": img.get("max_print_300dpi", {}),
                "max_print_150dpi": img.get("max_print_150dpi", {}),
                "pricing": img.get("pricing", {}),
                "micro_licensing": {
                    "web": {"price_usd": 0.50, "resolution": "1200px", "use": "web/blog/social", "duration": "1 year"},
                    "commercial": {"price_usd": 2.50, "resolution": "full", "use": "commercial + license certificate", "duration": "2 years"},
                },
                "status": img.get("status", "available"),
                "license_count": img.get("license_count", 0),
                "purchase_url": f"https://archive-35.com/licensing.html?image={image_id}",
            }
    return {"error": f"Image '{image_id}' not found", "browse": "https://archive-35.com/licensing.html"}


@mcp.tool()
def browse_collections() -> dict:
    """Browse all photography collections with descriptions and sample images.

    Archive-35 features photography from 55+ countries across landscapes,
    wildlife, urban, desert, ocean, and architectural subjects.
    """
    catalog = _load_catalog()
    images = catalog.get("images", [])

    # Group by collection
    collections = {}
    for img in images:
        coll = img.get("collection", "uncategorized") or "uncategorized"
        if coll not in collections:
            collections[coll] = {
                "name": coll,
                "image_count": 0,
                "sample_images": [],
                "locations": set(),
            }
        collections[coll]["image_count"] += 1
        if len(collections[coll]["sample_images"]) < 3:
            collections[coll]["sample_images"].append({
                "id": img.get("id"),
                "title": img.get("title"),
                "thumbnail": f"https://archive-35.com/{img.get('thumbnail', '')}",
            })
        loc = img.get("location", "")
        if loc:
            collections[coll]["locations"].add(loc)

    # Convert sets to lists for JSON serialization
    result = []
    for coll in collections.values():
        coll["locations"] = list(coll["locations"])[:5]
        result.append(coll)

    result.sort(key=lambda c: -c["image_count"])

    return {
        "gallery": "Archive-35 / The Restless Eye",
        "total_collections": len(result),
        "total_images": len(images),
        "collections": result,
        "browse_online": "https://archive-35.com/gallery.html",
    }


@mcp.tool()
def get_licensing_info(image_id: str) -> dict:
    """Get licensing options and pricing for an image.

    Tiers:
    - Web ($0.50): 1200px, web/blog/social use, 1 year
    - Commercial ($2.50): Full resolution + license certificate, 2 years
    - Editorial ($700): Full resolution, editorial use, 1 year
    - Commercial Print ($1,400): Full resolution, print production, 2 years
    - Hospitality ($3,500): Perpetual, unlimited use
    """
    catalog = _load_catalog()
    tiers = catalog.get("tiers", {})

    for img in catalog.get("images", []):
        if img.get("id") == image_id:
            pricing = img.get("pricing", {})
            return {
                "image_id": image_id,
                "title": img.get("title", ""),
                "status": img.get("status", "available"),
                "c2pa_verified": True,
                "micro_licenses": {
                    "web": {
                        "price_usd": 0.50,
                        "description": "1200px clean, web/blog/social",
                        "duration": "1 year",
                        "geography": "Worldwide",
                    },
                    "commercial": {
                        "price_usd": 2.50,
                        "description": "Full resolution + license certificate",
                        "duration": "2 years",
                        "geography": "Worldwide",
                    },
                },
                "full_licenses": {
                    tier_name: {
                        "price_usd": price,
                        "description": tiers.get(tier_name, {}).get("name", tier_name),
                        "duration": tiers.get(tier_name, {}).get("duration", ""),
                        "geography": tiers.get(tier_name, {}).get("geography", "Worldwide"),
                    }
                    for tier_name, price in pricing.items()
                },
                "purchase_options": {
                    "micro_license": f"https://archive-35.com/micro-licensing.html?image={image_id}",
                    "full_license": f"https://archive-35.com/licensing.html?image={image_id}",
                    "contact": "wolf@archive-35.com",
                },
            }
    return {"error": f"Image '{image_id}' not found"}


@mcp.tool()
def get_purchase_url(image_id: str, tier: str = "web") -> dict:
    """Get a Stripe checkout URL to purchase a license for an image.
    Returns a URL the user can visit to complete the purchase.

    Tiers: web ($0.50), commercial ($2.50), or contact for full licenses.
    """
    catalog = _load_catalog()
    for img in catalog.get("images", []):
        if img.get("id") == image_id:
            title = img.get("title", "Untitled")

            if tier in ("web", "commercial"):
                price = 0.50 if tier == "web" else 2.50
                tier_desc = "1200px web/social" if tier == "web" else "Full resolution + certificate"
                return {
                    "image_id": image_id,
                    "title": title,
                    "tier": tier,
                    "price_usd": price,
                    "tier_description": tier_desc,
                    "checkout_url": f"https://archive-35.com/api/micro-license/checkout?image_id={image_id}&tier={tier}",
                    "note": "Visit the checkout URL to complete your purchase via Stripe.",
                }
            else:
                pricing = img.get("pricing", {})
                if tier in pricing:
                    return {
                        "image_id": image_id,
                        "title": title,
                        "tier": tier,
                        "price_usd": pricing[tier],
                        "contact": "wolf@archive-35.com",
                        "licensing_page": f"https://archive-35.com/licensing.html?image={image_id}",
                        "note": f"Full licenses at ${pricing[tier]}+ — contact wolf@archive-35.com or visit the licensing page.",
                    }
                else:
                    return {
                        "image_id": image_id,
                        "title": title,
                        "available_tiers": ["web", "commercial"] + list(pricing.keys()),
                        "error": f"Tier '{tier}' not found. Available tiers listed above.",
                    }

    return {"error": f"Image '{image_id}' not found"}


# ── Main ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    mcp.run()
