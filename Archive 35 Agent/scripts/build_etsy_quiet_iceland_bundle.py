#!/usr/bin/env python3
"""Build the controlled Quiet Iceland three-photograph Etsy package."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.products.digital_bundle import build_bundle_package
from src.products.digital_bundle_previews import build_bundle_previews
from src.products.digital_listing import build_bundle_listing_copy, write_listing_plan
from src.products.digital_package import _sha256, build_digital_package


PRODUCT_ID = "A35-DIG-SET-ICE-0001"
PRINTABLE_DOWNLOADS_SECTION_ID = 59608958
COLLECTION_TITLE = "Quiet Iceland"
SOURCE_PRODUCTS = [
    {
        "product_id": "A35-DIG-ICE-0002",
        "source": "01_Portfolio/Iceland/originals/WOLF4448-Edit.jpg",
        "title": "Vestrahorn's Shadow Over Black Sands",
        "focal_point": (0.66, 0.5),
    },
    {
        "product_id": "A35-DIG-ICE-0003",
        "source": "01_Portfolio/Iceland/originals/WOLF4460-Pano.jpg",
        "title": "Vestrahorn's Reflection",
        "focal_point": (0.55, 0.5),
    },
    {
        "product_id": "A35-DIG-ICE-0001",
        "source": "01_Portfolio/Iceland/originals/WOLF4556.jpg",
        "title": "Vestrahorn's Reflection in Still Waters",
        "focal_point": (0.55, 0.5),
    },
]
TAGS = [
    "iceland wall art",
    "nordic wall decor",
    "mountain print set",
    "set of 3 prints",
    "vestrahorn print",
    "scandinavian art",
    "black sand beach",
    "landscape download",
    "printable gallery",
    "digital download",
    "moody wall art",
    "travel wall decor",
    "iceland photography",
]


def ensure_source_packages(drafts: Path) -> list[Path]:
    """Build the two bundle-only source packages and reuse the live Iceland single."""
    packages = []
    for product in SOURCE_PRODUCTS:
        package = drafts / product["product_id"]
        manifest = package / "manifest.json"
        source = AGENT_ROOT.parent / product["source"]
        if not manifest.is_file():
            build_digital_package(
                source=source,
                output_root=drafts,
                product_id=product["product_id"],
                title=product["title"],
                price_usd=12,
                focal_point=product["focal_point"],
            )
        else:
            existing = json.loads(manifest.read_text())
            source_state = existing.get("source", {})
            valid = (
                existing.get("product_id") == product["product_id"]
                and existing.get("title") == product["title"]
                and source_state.get("filename") == source.name
                and source_state.get("sha256") == _sha256(source)
            )
            if not valid:
                raise ValueError(f"Stale bundle source package: {package.name}")
        packages.append(package)
    return packages


def main() -> None:
    drafts = AGENT_ROOT / "data" / "etsy_digital_drafts"
    packages = ensure_source_packages(drafts)
    output = drafts / PRODUCT_ID
    titles = [item["title"] for item in SOURCE_PRODUCTS]
    manifest_path = output / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
    else:
        manifest = build_bundle_package(
            packages,
            drafts,
            PRODUCT_ID,
            COLLECTION_TITLE,
            titles,
            price_usd=18,
        )
    listing = build_bundle_listing_copy(
        product_id=PRODUCT_ID,
        collection_title=COLLECTION_TITLE,
        artwork_titles=titles,
        price_usd=18,
        tags=TAGS,
        etsy_title=(
            "Iceland Wall Art Set of 3, Nordic Mountain Printable "
            "Photography Digital Download"
        ),
        shop_section_id=PRINTABLE_DOWNLOADS_SECTION_ID,
        location="Iceland",
    )
    listing_path = write_listing_plan(output, listing)
    previews = build_bundle_previews(
        [AGENT_ROOT.parent / item["source"] for item in SOURCE_PRODUCTS],
        titles,
        output / "previews",
        collection_title=COLLECTION_TITLE,
    )
    print(json.dumps({
        "product_id": PRODUCT_ID,
        "price_usd": listing["price"],
        "delivery_files": len(manifest["delivery_files"]),
        "bundle_members": manifest["bundle_count"],
        "previews": len(previews),
        "listing_plan": str(listing_path),
        "output": str(output),
    }, indent=2))


if __name__ == "__main__":
    main()
