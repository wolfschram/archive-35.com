#!/usr/bin/env python3
"""Build verified ZIP packages for the five controlled direct-download products."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "Archive 35 Agent/experiments/etsy-digital-mvp.json"
DRAFTS_DIR = ROOT / "Archive 35 Agent/data/etsy_digital_drafts"
OUTPUT_DIR = ROOT / "Archive 35 Agent/data/direct_printable_packages"
FIXED_ZIP_TIME = (2026, 7, 30, 0, 0, 0)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def advertised_products(spec: dict) -> list[dict]:
    ids = spec["campaign"]["advertised_product_ids"]
    products = {product["product_id"]: product for product in spec["products"]}
    missing = [product_id for product_id in ids if product_id not in products]
    if missing:
        raise ValueError(f"Advertised products missing from spec: {missing}")
    return [products[product_id] for product_id in ids]


def license_text(product: dict, manifest: dict) -> str:
    return f"""ARCHIVE-35 PERSONAL-USE PRINTABLE

Artwork: {product["artwork_title"]}
Location: {product["location"]}
SKU: {product["product_id"]}
Photographer: Wolfgang Schram

WHAT IS INCLUDED
Five high-resolution JPEG files: 2:3, 3:4, 4:5, 11:14, and ISO paper ratios.
No physical print or frame is included.

LICENSE
{manifest["license"]}

You may print the files for your own wall display or personal gifts.
You may not upload the files to resale sites, share or redistribute them,
claim them as your work, or use them commercially.

Terms: https://archive-35.com/terms.html
Support: wolf@archive-35.com

Copyright © 2026 Wolfgang Schram / Archive-35. All rights reserved.
"""


def add_bytes(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, content)


def add_file(archive: zipfile.ZipFile, source: Path, name: str) -> None:
    info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    with source.open("rb") as file_handle:
        archive.writestr(info, file_handle.read())


def build_package(product: dict, output_dir: Path) -> dict:
    sku = product["product_id"]
    draft_dir = DRAFTS_DIR / sku
    manifest_path = draft_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest["product_id"] != sku or manifest["physical_item"] is not False:
        raise ValueError(f"Invalid digital manifest for {sku}")

    verified_files = []
    for delivery in manifest["delivery_files"]:
        source = draft_dir / delivery["filename"]
        actual_hash = sha256(source)
        if actual_hash != delivery["sha256"]:
            raise ValueError(f"Hash mismatch for {source}")
        if source.stat().st_size != delivery["size_bytes"]:
            raise ValueError(f"Size mismatch for {source}")
        verified_files.append((source, delivery))

    output_dir.mkdir(parents=True, exist_ok=True)
    package_path = output_dir / f"archive-35-{sku}.zip"
    with zipfile.ZipFile(package_path, "w", allowZip64=True) as archive:
        for source, delivery in verified_files:
            add_file(archive, source, f"Archive-35/{delivery['filename']}")
        add_bytes(
            archive,
            "Archive-35/README-LICENSE.txt",
            license_text(product, manifest).encode("utf-8"),
        )

    with zipfile.ZipFile(package_path) as archive:
        bad_file = archive.testzip()
        if bad_file:
            raise ValueError(f"ZIP integrity failed for {bad_file}")

    return {
        "sku": sku,
        "title": product["artwork_title"],
        "price_usd": 9.0,
        "r2_key": f"printables/{sku}/archive-35-{sku}.zip",
        "filename": package_path.name,
        "size_bytes": package_path.stat().st_size,
        "sha256": sha256(package_path),
        "source_file_count": len(verified_files),
    }


def build_all(output_dir: Path = OUTPUT_DIR) -> dict:
    spec = json.loads(SPEC_PATH.read_text())
    packages = [
        build_package(product, output_dir)
        for product in advertised_products(spec)
    ]
    result = {
        "schema_version": 1,
        "price_usd": 9.0,
        "package_count": len(packages),
        "packages": packages,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    result = build_all(args.output)
    total_mb = sum(item["size_bytes"] for item in result["packages"]) / 1024 / 1024
    print(f"Built and verified {result['package_count']} packages ({total_mb:.1f} MiB)")


if __name__ == "__main__":
    main()
