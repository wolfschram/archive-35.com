#!/usr/bin/env python3
"""
process_licensing_images.py — Master pipeline for licensing image ingestion.

Usage:
    python process_licensing_images.py [/path/to/09_Licensing]

Runs the full pipeline in sequence:
  1. Scan & classify originals
  2. Generate watermarked previews
  3. Generate thumbnails
  4. Upload to R2 (if credentials configured)
  5. Generate static catalog JSON for the licensing gallery page
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

# Import pipeline steps
from scan_licensing_folder import scan
from generate_watermark import generate_watermarks
from generate_thumbnail import generate_thumbnails
from upload_to_r2 import upload_to_r2


def generate_gallery_catalog(base_path):
    """
    Generate a public-safe catalog JSON for the licensing gallery web page.
    This file goes into the website root and is loaded by /licensing.html.
    No sensitive data (R2 keys, buyer info) — only what the gallery needs.
    """
    base = Path(base_path)
    cfg_path = base / "_config.json"
    catalog_path = base / "_catalog.json"

    with open(cfg_path) as f:
        cfg = json.load(f)
    with open(catalog_path) as f:
        catalog = json.load(f)

    # Build public gallery data
    gallery_images = []
    for entry in catalog["images"]:
        catalog_id = entry["catalog_id"]

        # Load full metadata for pricing + specs
        meta_file = base / "metadata" / f"{catalog_id}.json"
        if meta_file.exists():
            with open(meta_file) as f:
                meta = json.load(f)
        else:
            meta = entry

        # Compute starting price (lowest tier for this classification)
        classification = entry.get("classification", "STANDARD")
        tier_prices = {
            tier: prices[classification]
            for tier, prices in cfg["pricing"].items()
        }
        starting_price = min(tier_prices.values())

        gallery_images.append({
            "id": catalog_id,
            "title": entry.get("title", "") or entry.get("original_filename", ""),
            "classification": classification,
            "width": entry.get("width", meta.get("resolution", {}).get("width", 0)),
            "height": entry.get("height", meta.get("resolution", {}).get("height", 0)),
            "megapixels": entry.get("megapixels", 0),
            "file_size_mb": entry.get("file_size_mb", 0),
            "location": meta.get("location", ""),
            "thumbnail": f"09_Licensing/thumbnails/{catalog_id}.jpg",
            "preview": f"09_Licensing/watermarked/{catalog_id}.jpg",
            "starting_price": starting_price,
            "pricing": tier_prices,
            "license_count": entry.get("license_count", 0),
            "status": entry.get("status", "available"),
            "max_print_300dpi": meta.get("max_print_300dpi", {}),
            "max_print_150dpi": meta.get("max_print_150dpi", {}),
        })

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_images": len(gallery_images),
        "classifications": cfg["classification"],
        "tiers": cfg["tiers"],
        "images": gallery_images,
    }

    # Write to website data directory
    site_root = base.parent
    data_dir = site_root / "data"
    data_dir.mkdir(exist_ok=True)
    output_path = data_dir / "licensing-catalog.json"

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n✓ Gallery catalog: {len(gallery_images)} images → {output_path}")
    return output


def main():
    import argparse
    parser = argparse.ArgumentParser(description="ARCHIVE-35 Licensing Image Pipeline")
    parser.add_argument("folder", nargs="?", default=os.path.dirname(os.path.abspath(__file__)),
                        help="Path to 09_Licensing directory")
    parser.add_argument("--source", help="External source folder to scan (e.g., Photography/Large Scale Photography Stitch/)")
    args = parser.parse_args()
    folder = args.folder
    source = args.source
    base = Path(folder)

    print("=" * 60)
    print("  ARCHIVE-35 LICENSING IMAGE PIPELINE")
    if source:
        print(f"  Source: {source}")
    print("=" * 60)

    # Step 1: Scan & classify
    print(f"\n{'─' * 40}")
    print("STEP 1: Scan & Classify")
    print(f"{'─' * 40}")
    scan(folder, source_folder=source)

    # Step 2: Watermarks
    print(f"\n{'─' * 40}")
    print("STEP 2: Generate Watermarked Previews")
    print(f"{'─' * 40}")
    generate_watermarks(folder)

    # Step 3: Thumbnails
    print(f"\n{'─' * 40}")
    print("STEP 3: Generate Thumbnails")
    print(f"{'─' * 40}")
    generate_thumbnails(folder)

    # Step 4: R2 Upload
    print(f"\n{'─' * 40}")
    print("STEP 4: Upload to R2")
    print(f"{'─' * 40}")
    upload_to_r2(folder)

    # Step 5: Gallery catalog
    print(f"\n{'─' * 40}")
    print("STEP 5: Generate Gallery Catalog")
    print(f"{'─' * 40}")
    generate_gallery_catalog(folder)

    print(f"\n{'=' * 60}")
    print("  PIPELINE COMPLETE")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
