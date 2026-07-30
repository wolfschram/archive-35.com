#!/usr/bin/env python3
"""Upload a verified local product package to Etsy as a private draft."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.integrations.etsy import (
    create_digital_listing,
    find_listing_by_sku,
    get_listing,
    get_listing_files,
    get_listing_images,
    get_listing_inventory,
)
from src.products.preview_approval import load_approved_previews


def verify_delivery_files(package: Path, listing: dict) -> None:
    """Reject missing, stale, oversized, or out-of-package delivery files."""
    manifest = json.loads((package / "manifest.json").read_text())
    expected = {item["filename"]: item for item in manifest["delivery_files"]}
    if len(expected) != 5 or len(listing["delivery_files"]) != 5:
        raise SystemExit("Exactly five delivery files are required")
    for value in listing["delivery_files"]:
        path = Path(value).resolve()
        item = expected.get(path.name)
        if path.parent != package or not item or not path.is_file():
            raise SystemExit(f"Unexpected delivery file: {path}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != item["sha256"] or path.stat().st_size > 20 * 1024 * 1024:
            raise SystemExit(f"Delivery file failed preflight: {path.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package_dir", help="Folder containing listing.json and previews/")
    args = parser.parse_args()

    package = Path(args.package_dir).resolve()
    state_path = package / "etsy-state.json"
    if state_path.exists():
        existing = json.loads(state_path.read_text())
        raise SystemExit(
            f"Etsy draft already recorded: listing {existing.get('listing_id', '?')}"
        )
    listing = json.loads((package / "listing.json").read_text())
    verify_delivery_files(package, listing)
    preview_paths = load_approved_previews(package)
    remote = find_listing_by_sku(listing["sku"])
    if remote:
        state_path.write_text(json.dumps({
            "listing_id": remote["listing_id"],
            "status": remote.get("state", "existing"),
            "sku": listing["sku"],
            "recovered_from_etsy": True,
        }, indent=2) + "\n")
        raise SystemExit(
            f"Existing Etsy listing recovered: {remote['listing_id']}"
        )

    def save_initial_state(state: dict) -> None:
        state_path.write_text(json.dumps(state, indent=2) + "\n")

    result = create_digital_listing(
        title=listing["title"],
        description=listing["description"],
        price=listing["price"],
        tags=listing["tags"],
        sku=listing["sku"],
        delivery_files=listing["delivery_files"],
        image_paths=preview_paths,
        shop_section_id=listing.get("shop_section_id"),
        activate=False,
        on_draft_created=save_initial_state,
    )
    if result.get("listing_id"):
        listing_id = result["listing_id"]
        remote_listing = get_listing(listing_id)
        remote_images = get_listing_images(listing_id)
        remote_files = get_listing_files(listing_id)
        remote_inventory = get_listing_inventory(listing_id)
        if any("error" in value for value in (
            remote_listing, remote_images, remote_files, remote_inventory,
        )):
            result["error"] = "Draft created, but Etsy readback failed"
            result["status"] = "unverified_draft"
        else:
            image_count = len(remote_images.get("results", []))
            file_count = len(remote_files.get("results", []))
            remote_type = remote_listing.get(
                "type", remote_listing.get("listing_type"),
            )
            price = remote_listing.get("price", {})
            remote_price = (
                float(price.get("amount", 0)) / float(price.get("divisor", 100))
                if isinstance(price, dict) else float(price or 0)
            )
            verified = (
                remote_listing.get("state") == "draft"
                and remote_type == "download"
                and listing["sku"] in remote_listing.get("skus", [])
                and remote_listing.get("shop_section_id")
                == listing.get("shop_section_id")
                and any(
                    product.get("sku") == listing["sku"]
                    for product in remote_inventory.get("products", [])
                )
                and remote_listing.get("title") == listing["title"]
                and round(remote_price, 2) == round(float(listing["price"]), 2)
                and set(remote_listing.get("tags", [])) == set(listing["tags"])
                and image_count == len(preview_paths)
                and file_count == 5
            )
            result["readback"] = {
                "state": remote_listing.get("state"),
                "type": remote_type,
                "price_usd": round(remote_price, 2),
                "title_matches": remote_listing.get("title") == listing["title"],
                "tags_match": set(remote_listing.get("tags", [])) == set(listing["tags"]),
                "sku_match": listing["sku"] in remote_listing.get("skus", []),
                "section_match": remote_listing.get("shop_section_id")
                == listing.get("shop_section_id"),
                "images": image_count,
                "files": file_count,
                "verified": verified,
            }
            if not verified:
                result["error"] = "Etsy draft readback did not match local plan"
                result["status"] = "unverified_draft"
        state_path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if "error" in result:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
