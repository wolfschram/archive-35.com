#!/usr/bin/env python3
"""Build the controlled Desert Geometry three-photograph Etsy package."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.products.digital_bundle import build_bundle_package
from src.products.digital_bundle_previews import build_bundle_previews
from src.products.digital_listing import (
    build_bundle_listing_copy,
    write_listing_plan,
)


PRODUCT_ID = "A35-DIG-SET-DES-0001"
PRINTABLE_DOWNLOADS_SECTION_ID = 59608958
COLLECTION_TITLE = "Desert Geometry"
SOURCE_IDS = [
    "A35-DIG-ANT-0001",
    "A35-DIG-MON-0001",
    "A35-DIG-DUN-0001",
]
ARTWORK_TITLES = [
    "Crimson Passage Through Stone",
    "Solitary Tree in Monument Valley",
    "Desert Dunes in Motion",
]


def main() -> None:
    spec = json.loads(
        (AGENT_ROOT / "experiments/etsy-digital-mvp.json").read_text()
    )
    products = {item["product_id"]: item for item in spec["products"]}
    drafts = AGENT_ROOT / "data" / "etsy_digital_drafts"
    packages = [drafts / product_id for product_id in SOURCE_IDS]
    output = drafts / PRODUCT_ID
    manifest = build_bundle_package(
        packages,
        drafts,
        PRODUCT_ID,
        COLLECTION_TITLE,
        ARTWORK_TITLES,
        price_usd=18,
    )
    listing = build_bundle_listing_copy(
        product_id=PRODUCT_ID,
        collection_title=COLLECTION_TITLE,
        artwork_titles=ARTWORK_TITLES,
        price_usd=18,
        shop_section_id=PRINTABLE_DOWNLOADS_SECTION_ID,
    )
    listing_path = write_listing_plan(output, listing)
    preview_sources = [
        (AGENT_ROOT / products[product_id]["source"]).resolve()
        for product_id in SOURCE_IDS
    ]
    previews = build_bundle_previews(
        preview_sources,
        ARTWORK_TITLES,
        output / "previews",
        collection_title=COLLECTION_TITLE,
    )
    print(json.dumps({
        "product_id": PRODUCT_ID,
        "price_usd": 18,
        "delivery_files": len(manifest["delivery_files"]),
        "bundle_members": manifest["bundle_count"],
        "previews": len(previews),
        "listing_plan": str(listing_path),
        "output": str(output),
    }, indent=2))


if __name__ == "__main__":
    main()
