#!/usr/bin/env python3
"""Build a hash-bound Etsy video from one package's approved previews."""

from __future__ import annotations

import argparse
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
    parser = argparse.ArgumentParser()
    parser.add_argument("package_dir")
    args = parser.parse_args()
    package = Path(args.package_dir).resolve()
    previews = load_approved_previews(package)
    video = package / f"{package.name}_listing-video.mp4"
    result = build_listing_video(previews, video)
    write_video_build_manifest(previews, video, package / "video-build.json")
    invalid = (
        not 3 <= result["duration_seconds"] <= 15
        or result["size_bytes"] > 100 * 1024 * 1024
        or min(result["width"], result["height"]) < 1080
        or result["has_audio"]
    )
    if invalid:
        raise SystemExit(f"Etsy video preflight failed: {result}")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
