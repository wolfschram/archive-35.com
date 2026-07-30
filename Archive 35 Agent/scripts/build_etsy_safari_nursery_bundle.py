#!/usr/bin/env python3
"""Build one demand-led Safari Nursery Etsy bundle from verified packages."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.products.digital_bundle import build_bundle_package
from src.products.digital_bundle_previews import build_bundle_previews
from src.products.digital_listing import build_bundle_listing_copy, write_listing_plan


PRODUCT_ID = "A35-DIG-SET-SAF-0001"
SOURCE_IDS = [
    "A35-DIG-ELE-0001",
    "A35-DIG-GIR-0001",
    "A35-DIG-LIO-0001",
]
ARTWORK_TITLES = [
    "Elephant Herd Beneath the Storm",
    "Solitary Giraffe on the Savanna",
    "Lion Pride in the Tall Grass",
]
TAGS = [
    "safari nursery decor",
    "safari nursery art",
    "nursery wall art",
    "african nursery art",
    "animal print set",
    "set of 3 prints",
    "neutral nursery",
    "safari wall art",
    "giraffe wall art",
    "elephant wall art",
    "lion wall art",
    "digital download",
    "authentic photo",
]


def main() -> None:
    spec = json.loads(
        (AGENT_ROOT / "experiments/etsy-digital-mvp.json").read_text()
    )
    products = {item["product_id"]: item for item in spec["products"]}
    drafts = AGENT_ROOT / "data" / "etsy_digital_drafts"
    packages = [drafts / product_id for product_id in SOURCE_IDS]
    output = drafts / PRODUCT_ID
    manifest_path = output / "manifest.json"
    manifest = (
        json.loads(manifest_path.read_text())
        if manifest_path.is_file()
        else build_bundle_package(
            packages, drafts, PRODUCT_ID, "Safari Nursery",
            ARTWORK_TITLES, price_usd=15,
        )
    )
    listing = build_bundle_listing_copy(
        product_id=PRODUCT_ID,
        collection_title="Safari Nursery",
        artwork_titles=ARTWORK_TITLES,
        price_usd=15,
        tags=TAGS,
        etsy_title=(
            "Safari Nursery Wall Art Set of 3, Neutral Animal Photography "
            "Printable Digital Download"
        ),
        shop_section_id=59608958,
        location="Tanzania",
    )
    listing_path = write_listing_plan(output, listing)
    previews = build_bundle_previews(
        [(AGENT_ROOT / products[item]["source"]).resolve() for item in SOURCE_IDS],
        ARTWORK_TITLES,
        output / "previews",
        collection_title="Safari Nursery",
    )
    print(json.dumps({
        "product_id": PRODUCT_ID,
        "price_usd": listing["price"],
        "delivery_files": len(manifest["delivery_files"]),
        "previews": len(previews),
        "listing_plan": str(listing_path),
    }, indent=2))


if __name__ == "__main__":
    main()
