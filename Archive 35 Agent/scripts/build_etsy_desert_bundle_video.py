#!/usr/bin/env python3
"""Build the approved Desert Geometry Etsy listing video."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.products.digital_bundle_video import build_listing_video
from src.products.preview_approval import load_approved_previews


def main() -> None:
    package = (
        AGENT_ROOT / "data/etsy_digital_drafts/A35-DIG-SET-DES-0001"
    ).resolve()
    result = build_listing_video(
        load_approved_previews(package),
        package / "A35-DIG-SET-DES-0001_listing-video.mp4",
    )
    if (
        not 3 <= result["duration_seconds"] <= 15
        or result["size_bytes"] > 100 * 1024 * 1024
        or min(result["width"], result["height"]) < 1080
        or result["has_audio"]
    ):
        raise SystemExit(f"Etsy video preflight failed: {result}")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
