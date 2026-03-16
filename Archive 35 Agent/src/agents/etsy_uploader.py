"""Etsy bulk listing uploader from pre-built listing packages.

Reads listing packages from etsy-export/, rewrites copy with Claude,
watermarks originals, uploads images, and creates live Etsy listings.

Usage:
    from src.agents.etsy_uploader import upload_all_packages
    results = upload_all_packages(conn, client)
"""

from __future__ import annotations

import json
import logging
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Optional

from src.agents.etsy_copywriter import (
    REWRITE_PROMPT,
    get_story_for_collection,
    sanity_check,
)
from src.agents.etsy_pricing import (
    detect_orientation,
    get_listing_pricing,
)
from src.brand.watermark import add_banner_to_file
from src.integrations.etsy import (
    activate_listing,
    create_listing,
    ensure_valid_token,
    upload_listing_image_from_file,
)
from src.safety.audit import log as audit_log
from src.safety.rate_limiter import check_limit, record_usage

logger = logging.getLogger(__name__)

EXPORT_DIR = Path(__file__).parent.parent.parent.parent / "06_Automation" / "etsy-export"
PHOTO_DIR = Path(__file__).parent.parent.parent.parent / "photography"
MAX_ETSY_IMAGES = 10  # Etsy allows up to 10 images per listing


def _load_packages() -> list[dict]:
    """Load all listing packages from etsy-export/."""
    packages = []
    if not EXPORT_DIR.exists():
        logger.error("etsy-export directory not found: %s", EXPORT_DIR)
        return packages

    for pkg_dir in sorted(EXPORT_DIR.iterdir()):
        listing_file = pkg_dir / "listing.json"
        if not listing_file.exists():
            continue
        try:
            data = json.loads(listing_file.read_text())
            data["_pkg_dir"] = str(pkg_dir)
            data["_pkg_name"] = pkg_dir.name
            packages.append(data)
        except (json.JSONDecodeError, OSError) as e:
            logger.error("Failed to load %s: %s", listing_file, e)
    return packages


def _rewrite_with_claude(
    pkg: dict, size_label: str, client: Any, model: str,
) -> Optional[dict]:
    """Rewrite listing copy using Claude + story bank."""
    collection = pkg.get("gallery_name", "")
    story = get_story_for_collection(collection)
    old_title = pkg.get("title", "")
    old_desc = pkg.get("description", "")[:500]

    prompt = REWRITE_PROMPT.format(
        collection=collection,
        story=story or "No specific story — write from what's visible.",
        old_title=old_title,
        old_desc_preview=old_desc,
        size_label=size_label,
    )

    try:
        response = client.messages.create(
            model=model, max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])
        # Handle Claude returning extra text after JSON
        # Find the first complete JSON object
        brace_depth = 0
        json_end = -1
        for i, ch in enumerate(text):
            if ch == "{":
                brace_depth += 1
            elif ch == "}":
                brace_depth -= 1
                if brace_depth == 0:
                    json_end = i + 1
                    break
        if json_end > 0:
            text = text[:json_end]
        result = json.loads(text)
        # Enforce Etsy limits
        tags = [t[:20] for t in result.get("tags", [])][:13]
        result["tags"] = tags
        title = result.get("title", "")
        if len(title) > 140:
            result["title"] = title[:137] + "..."
        return result
    except Exception as e:
        logger.error("Claude rewrite failed for %s: %s", pkg.get("_pkg_name"), e)
        return None


def _watermark_original(pkg: dict) -> Optional[str]:
    """Find the original photo and watermark it to a temp file."""
    pkg_dir = Path(pkg["_pkg_dir"])
    images = pkg.get("images", [])

    # Find the original image
    original = None
    for img in images:
        if img.get("type") == "original":
            original = pkg_dir / "images" / img["filename"]
            break

    if not original or not original.exists():
        # Try finding in photography/ directory
        collection = pkg.get("gallery_name", "")
        for img in images:
            if img.get("type") == "original":
                fname = img["filename"].replace("12-original-", "")
                alt = PHOTO_DIR / collection / fname
                if alt.exists():
                    original = alt
                    break

    if not original or not original.exists():
        logger.warning("No original image found for %s", pkg.get("_pkg_name"))
        return None

    # Watermark to temp file
    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp.close()
    result = add_banner_to_file(str(original), tmp.name)
    return result


def _get_mockup_files(pkg: dict, max_count: int = 4) -> list[str]:
    """Get up to max_count mockup image paths from the package."""
    pkg_dir = Path(pkg["_pkg_dir"])
    images = pkg.get("images", [])
    mockups = []
    for img in sorted(images, key=lambda x: x.get("order", 99)):
        if img.get("type") == "mockup":
            path = pkg_dir / "images" / img["filename"]
            if path.exists():
                mockups.append(str(path))
            if len(mockups) >= max_count:
                break
    return mockups


def upload_all_packages(
    conn: sqlite3.Connection,
    client: Any,
    model: str = "claude-sonnet-4-5-20250929",
    dry_run: bool = False,
    limit: int = 100,
) -> dict[str, Any]:
    """Upload all listing packages to Etsy.

    For each package:
    1. Rewrite description with Claude + story bank
    2. Sanity check copy
    3. Watermark original photo
    4. Create draft listing on Etsy
    5. Upload original (watermarked) as image 1
    6. Upload up to 4 mockups as images 2-5
    7. Activate the listing
    """
    token_result = ensure_valid_token()
    if not token_result.get("valid"):
        return {"error": token_result.get("error", "Token invalid")}

    packages = _load_packages()
    if not packages:
        return {"error": "No listing packages found in etsy-export/"}

    packages = packages[:limit]
    logger.info("Found %d listing packages to upload", len(packages))
    audit_log(conn, "etsy_uploader", "upload_started", {"count": len(packages)})

    summary = {
        "total": len(packages), "created": 0, "activated": 0,
        "skipped": 0, "errors": [], "results": [],
    }

    for pkg in packages:
        pkg_name = pkg.get("_pkg_name", "unknown")

        if not check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=15.0):
            summary["errors"].append("Rate limit reached")
            break

        # Detect orientation + pricing from photo dimensions
        dims = pkg.get("photo_dimensions", {})
        w = dims.get("width", 2000)
        h = dims.get("height", 1333)
        orientation = detect_orientation(w, h)
        pricing = get_listing_pricing(orientation)

        # Rewrite copy with Claude
        seo = _rewrite_with_claude(pkg, pricing["size_label"], client, model)
        if not seo:
            summary["skipped"] += 1
            summary["errors"].append(f"{pkg_name}: Claude rewrite failed")
            continue

        record_usage(conn, "anthropic", cost_usd=0.003)

        # Sanity check
        issues = sanity_check(
            seo.get("title", ""),
            seo.get("description", ""),
            pkg.get("gallery_name", ""),
        )
        if issues:
            logger.warning("Sanity issues for %s: %s", pkg_name, issues)
            summary["errors"].append(f"{pkg_name}: {'; '.join(issues)}")
            summary["skipped"] += 1
            continue

        entry = {
            "pkg_name": pkg_name,
            "title": seo["title"],
            "orientation": orientation,
            "price_usd": pricing["etsy_price_usd"],
        }

        if dry_run:
            entry["action"] = "dry_run"
            summary["skipped"] += 1
            summary["results"].append(entry)
            continue

        # Create draft listing
        result = create_listing(
            title=seo["title"],
            description=seo["description"],
            price=pricing["etsy_price_usd"],
            tags=seo["tags"],
            quantity=999,
            who_made="i_did",
            when_made="made_to_order",
        )

        if "error" in result:
            entry["action"] = "error"
            entry["error"] = result.get("detail", result["error"])
            summary["errors"].append(f"{pkg_name}: {entry['error']}")
            summary["results"].append(entry)
            continue

        listing_id = result.get("listing_id")
        entry["listing_id"] = listing_id
        summary["created"] += 1

        # Upload watermarked original as image 1
        watermarked = _watermark_original(pkg)
        if watermarked:
            img_result = upload_listing_image_from_file(listing_id, watermarked, rank=1)
            if "error" in (img_result or {}):
                logger.warning("Image 1 upload failed: %s", img_result)

        # Upload mockups as images 2-5
        mockups = _get_mockup_files(pkg, max_count=4)
        for i, mockup_path in enumerate(mockups):
            img_result = upload_listing_image_from_file(
                listing_id, mockup_path, rank=i + 2,
            )
            if "error" in (img_result or {}):
                logger.warning("Mockup %d upload failed: %s", i + 2, img_result)

        # Activate listing
        act_result = activate_listing(listing_id)
        if "error" not in act_result:
            entry["action"] = "activated"
            summary["activated"] += 1
        else:
            entry["action"] = "created_draft"
            entry["activate_error"] = act_result.get("error")

        summary["results"].append(entry)

        audit_log(conn, "etsy_uploader", "listing_uploaded", {
            "pkg_name": pkg_name, "listing_id": listing_id,
            "orientation": orientation, "price": pricing["etsy_price_usd"],
        }, cost_usd=0.003)

    audit_log(conn, "etsy_uploader", "upload_complete", {
        k: v for k, v in summary.items() if k != "results"
    })

    logger.info(
        "Upload complete: %d created, %d activated, %d skipped, %d errors",
        summary["created"], summary["activated"],
        summary["skipped"], len(summary["errors"]),
    )
    return summary
