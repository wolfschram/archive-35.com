#!/usr/bin/env python3
"""Verify every local Etsy MVP artifact before any live draft upload."""

from __future__ import annotations

import hashlib
import argparse
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.products.preview_approval import load_approved_previews


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-id")
    args = parser.parse_args()
    spec = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-digital-mvp.json").read_text()
    )
    results = []
    for product in spec["products"]:
        if args.product_id and product["product_id"] != args.product_id:
            continue
        package = (
            AGENT_ROOT / "data" / "etsy_digital_drafts" / product["product_id"]
        )
        manifest = json.loads((package / "manifest.json").read_text())
        listing = json.loads((package / "listing.json").read_text())
        if manifest["product_id"] != listing["sku"] or listing["price"] != 12:
            raise SystemExit(f"Identity or price mismatch: {product['product_id']}")
        if len(manifest["delivery_files"]) != 5:
            raise SystemExit(f"Wrong delivery count: {product['product_id']}")
        for item in manifest["delivery_files"]:
            path = package / item["filename"]
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != item["sha256"] or path.stat().st_size > 20 * 1024 * 1024:
                raise SystemExit(f"Invalid delivery file: {path}")
            with Image.open(path) as image:
                if not image.info.get("icc_profile"):
                    raise SystemExit(f"Missing ICC profile: {path}")
            metadata = json.loads(subprocess.run(
                ["exiftool", "-json", "-UsageTerms", "-WebStatement",
                 "-Instructions", str(path)],
                capture_output=True, text=True, check=True,
            ).stdout)[0]
            if (
                not metadata.get("UsageTerms")
                or metadata.get("WebStatement") != "https://archive-35.com/terms.html"
                or "C2PA" not in metadata.get("Instructions", "")
            ):
                raise SystemExit(f"Incomplete rights metadata: {path}")
        previews = load_approved_previews(package)
        results.append({
            "product_id": product["product_id"],
            "delivery_files": 5,
            "approved_previews": len(previews),
            "ready_for_private_draft": not (package / "etsy-state.json").exists(),
        })
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
