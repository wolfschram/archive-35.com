#!/usr/bin/env python3
"""Build silent listing videos for the ten controlled $12 printables."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.products.digital_bundle_video import (
    build_listing_video,
    write_video_build_manifest,
)
from src.products.preview_approval import load_approved_previews


def main() -> None:
    spec = json.loads((AGENT_ROOT / "experiments/etsy-digital-mvp.json").read_text())
    drafts = AGENT_ROOT / "data/etsy_digital_drafts"
    built = []
    skipped = []
    for product in spec["products"]:
        product_id = product["product_id"]
        package = drafts / product_id
        video = package / f"{product_id}_listing-video.mp4"
        try:
            previews = load_approved_previews(package)
        except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
            skipped.append({"product_id": product_id, "reason": str(exc)})
            continue
        result = build_listing_video(previews, video)
        write_video_build_manifest(previews, video, package / "video-build.json")
        result.update({"product_id": product_id, "listing_id": product["etsy_listing_id"]})
        built.append(result)
    if any(
        not 3 <= item["duration_seconds"] <= 15
        or item["size_bytes"] > 100 * 1024 * 1024
        or min(item["width"], item["height"]) < 1080
        or item["has_audio"]
        for item in built
    ):
        raise SystemExit("One or more listing videos failed Etsy preflight")
    if not built:
        raise SystemExit(f"No approved videos could be built: {skipped}")
    print(json.dumps({"built": built, "skipped": skipped}, indent=2))


if __name__ == "__main__":
    main()
