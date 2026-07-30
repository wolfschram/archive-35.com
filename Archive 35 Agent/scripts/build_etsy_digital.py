#!/usr/bin/env python3
"""Build and verify one Etsy instant-download photography package."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.products.digital_package import build_digital_package
from src.products.digital_listing import build_listing_copy, write_listing_plan


def main() -> None:
    """Parse inputs and build a package without publishing it."""
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="High-resolution source JPEG")
    parser.add_argument("product_id", help="SKU beginning with A35-DIG-")
    parser.add_argument("title", help="Customer-facing artwork title")
    parser.add_argument(
        "--output-root",
        default="data/etsy_digital_drafts",
        help="Local ignored output directory",
    )
    parser.add_argument("--price", type=float, default=12.0)
    parser.add_argument("--location", default="Antelope Canyon, Arizona, USA")
    parser.add_argument("--etsy-title")
    parser.add_argument("--tag", action="append", dest="tags")
    parser.add_argument("--focal-x", type=float, default=0.5)
    parser.add_argument("--focal-y", type=float, default=0.5)
    args = parser.parse_args()

    manifest = build_digital_package(
        source=args.source,
        output_root=args.output_root,
        product_id=args.product_id,
        title=args.title,
        price_usd=args.price,
        focal_point=(args.focal_x, args.focal_y),
    )
    package_dir = Path(args.output_root).resolve() / args.product_id
    listing_path = write_listing_plan(
        package_dir,
        build_listing_copy(
            product_id=args.product_id,
            artwork_title=args.title,
            location=args.location,
            price_usd=args.price,
            tags=args.tags,
            etsy_title=args.etsy_title,
        ),
    )
    print(json.dumps({
        "product_id": manifest["product_id"],
        "files": len(manifest["delivery_files"]),
        "output": str(package_dir),
        "listing_plan": str(listing_path),
        "all_files_within_limit": (
            manifest["etsy_constraints"]["all_files_within_limit"]
        ),
    }, indent=2))


if __name__ == "__main__":
    main()
