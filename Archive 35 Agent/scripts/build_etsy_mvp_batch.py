#!/usr/bin/env python3
"""Build every missing product in the controlled five-subject Etsy MVP."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.products.digital_listing import build_listing_copy, write_listing_plan
from src.products.digital_package import build_digital_package


def main() -> None:
    spec_path = AGENT_ROOT / "experiments" / "etsy-digital-mvp.json"
    spec = json.loads(spec_path.read_text())
    output_root = AGENT_ROOT / "data" / "etsy_digital_drafts"
    results = []

    for product in spec["products"]:
        package = output_root / product["product_id"]
        if (package / "manifest.json").exists():
            status = "listing_refreshed"
        else:
            build_digital_package(
                source=(AGENT_ROOT / product["source"]).resolve(),
                output_root=output_root,
                product_id=product["product_id"],
                title=product["artwork_title"],
                price_usd=spec["price_usd"],
                focal_point=tuple(product["focal_point"]),
            )
            status = "built"
        write_listing_plan(package, build_listing_copy(
            product_id=product["product_id"],
            artwork_title=product["artwork_title"],
            location=product["location"],
            price_usd=spec["price_usd"],
            tags=product["tags"],
            etsy_title=product["etsy_title"],
        ))
        results.append({"product_id": product["product_id"], "status": status})

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
