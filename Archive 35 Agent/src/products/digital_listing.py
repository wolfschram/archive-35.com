"""Deterministic Etsy copy and upload plans for Archive-35 digital products."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_TAGS = [
    "antelope canyon",
    "southwest wall art",
    "printable wall art",
    "digital download",
    "desert photography",
    "arizona wall art",
    "slot canyon print",
    "red rock decor",
    "landscape photo",
    "large wall art",
    "modern home decor",
    "nature photography",
    "instant download",
]

BUNDLE_TAGS = [
    "desert wall art set",
    "southwest wall art",
    "printable gallery",
    "set of 3 prints",
    "neutral wall decor",
    "antelope canyon",
    "monument valley",
    "sand dune art",
    "digital download",
    "boho wall art",
    "western home decor",
    "earth tone art",
    "desert photography",
]


def build_bundle_listing_copy(
    *,
    product_id: str,
    collection_title: str,
    artwork_titles: list[str],
    price_usd: float = 18.0,
    tags: list[str] | None = None,
    etsy_title: str | None = None,
    shop_section_id: int | None = None,
    location: str = "American Southwest",
) -> dict[str, Any]:
    """Build clear Etsy copy for a three-photograph ZIP bundle."""
    if len(artwork_titles) != 3 or len(set(artwork_titles)) != 3:
        raise ValueError("Bundle copy requires three distinct photographs")
    final_tags = tags or BUNDLE_TAGS
    if len(final_tags) != 13 or any(len(tag) > 20 for tag in final_tags):
        raise ValueError("Etsy listings require 13 tags of at most 20 characters")
    title = etsy_title or (
        "Desert Wall Art Set of 3, Southwest Printable Photography Digital Download"
    )
    if len(title) > 140 or len(title.split()) > 15:
        raise ValueError("Etsy title must be at most 140 characters and 15 words")
    artwork_list = "\n".join(f"• {name}" for name in artwork_titles)
    description = f"""DIGITAL DOWNLOAD SET — NO PHYSICAL ITEMS OR FRAMES WILL BE SHIPPED.

{collection_title} is a coordinated set of three original photographs by Wolfgang Schram:
{artwork_list}

YOU RECEIVE 15 HIGH-RESOLUTION JPEG FILES
Etsy delivers five ZIP folders. Each ZIP contains all three photographs in one print ratio:
• 2:3 — 4×6 through 24×36
• 3:4 — 6×8 through 18×24
• 4:5 — 4×5 through 16×20
• 11:14 — 11×14 and matching enlargements
• ISO — A5, A4, A3, A2, A1

HOW IT WORKS
1. Download the five ZIP folders from Etsy after payment.
2. Open the ZIP matching your frame or printer.
3. Print at home, through a local shop, or with an online printer.

This is authentic fine-art photography, not AI-generated artwork. Colors can vary between monitors and printers. Frames and printed products shown in previews are for display only.

LICENSE
Personal-use wall display only. You may print copies for your own home or as personal gifts. No resale, redistribution, commercial use, or sublicensing. Copyright remains with Wolfgang Schram / Archive-35.

SKU: {product_id}"""
    return {
        "title": title,
        "description": description,
        "tags": final_tags,
        "price": round(float(price_usd), 2),
        "quantity": 999,
        "type": "download",
        "who_made": "i_did",
        "when_made": "2020_2026",
        "is_supply": False,
        "sku": product_id,
        "artwork_title": collection_title,
        "location": location,
        "shop_section_id": shop_section_id,
    }


def build_listing_copy(
    *,
    product_id: str,
    artwork_title: str,
    location: str,
    price_usd: float,
    tags: list[str] | None = None,
    etsy_title: str | None = None,
) -> dict[str, Any]:
    """Build clear buyer-facing copy without keyword-stuffed title repetition."""
    final_tags = tags or DEFAULT_TAGS
    if len(final_tags) != 13 or any(len(tag) > 20 for tag in final_tags):
        raise ValueError("Etsy listings require exactly 13 tags of at most 20 characters")

    title = etsy_title or (
        "Antelope Canyon Printable Wall Art, Southwest Photo Digital Download"
    )
    if len(title) > 140 or len(title.split()) > 15:
        raise ValueError("Etsy title must be at most 140 characters and 15 words")
    description = f"""DIGITAL DOWNLOAD — NO PHYSICAL ITEM OR FRAME WILL BE SHIPPED.

{artwork_title}, photographed by Wolfgang Schram in {location}.

Your purchase includes five high-resolution JPEG files covering the most common print ratios:
• 2:3 — 4×6, 8×12, 12×18, 16×24, 20×30, 24×36
• 3:4 — 6×8, 9×12, 12×16, 15×20, 18×24
• 4:5 — 4×5, 8×10, 12×15, 16×20
• 11:14 — 11×14 and matching enlargements
• ISO — A5, A4, A3, A2, A1

HOW IT WORKS
1. Etsy makes the files available after payment.
2. Download the ratio that matches your frame or printer.
3. Print at home, through a local print shop, or with an online printer.

This is authentic fine-art photography, not AI-generated artwork. Colors can vary between monitors and printers. For the best result, use a professional photo or fine-art paper printer.

LICENSE
Personal-use wall display only. You may print copies for your own home or as a personal gift. No resale, redistribution, commercial use, or sublicensing. Copyright remains with Wolfgang Schram / Archive-35.

Because this is an instant digital product, no physical item is included. Please contact Archive-35 before purchase if you need help choosing a print size.

SKU: {product_id}"""
    return {
        "title": title,
        "description": description,
        "tags": final_tags,
        "price": round(float(price_usd), 2),
        "quantity": 999,
        "type": "download",
        "who_made": "i_did",
        "when_made": "2020_2026",
        "is_supply": False,
        "sku": product_id,
        "artwork_title": artwork_title,
        "location": location,
    }


def write_listing_plan(package_dir: str | Path, listing: dict[str, Any]) -> Path:
    """Add listing copy and resolved delivery paths to an existing package."""
    directory = Path(package_dir).resolve()
    manifest = json.loads((directory / "manifest.json").read_text())
    listing["delivery_files"] = [
        str(directory / item["filename"]) for item in manifest["delivery_files"]
    ]
    destination = directory / "listing.json"
    destination.write_text(json.dumps(listing, indent=2) + "\n")
    return destination
