#!/usr/bin/env python3
"""Idempotently upload one package's approved, hash-bound Etsy video."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.integrations.etsy import get_listing_videos, upload_listing_video_from_path
from src.products.digital_bundle_video import (
    inspect_listing_video,
    verify_video_build_manifest,
)
from src.products.preview_approval import load_approved_previews


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package_dir")
    args = parser.parse_args()
    package = Path(args.package_dir).resolve()
    listing_id = int(json.loads((package / "etsy-state.json").read_text())["listing_id"])
    video = package / f"{package.name}_listing-video.mp4"
    previews = load_approved_previews(package)
    verify_video_build_manifest(previews, video, package / "video-build.json")
    metadata = inspect_listing_video(video)
    invalid = (
        not 3 <= metadata["duration_seconds"] <= 15
        or metadata["size_bytes"] > 100 * 1024 * 1024
        or min(metadata["width"], metadata["height"]) < 1080
        or metadata["has_audio"]
    )
    if invalid:
        raise SystemExit(f"Etsy video preflight failed: {metadata}")

    before = get_listing_videos(listing_id)
    if "error" in before:
        raise SystemExit(f"Video lookup failed: {before}")
    status = "existing"
    if not before.get("results"):
        uploaded = upload_listing_video_from_path(listing_id, str(video))
        if "error" in uploaded:
            raise SystemExit(f"Video upload failed: {uploaded}")
        status = "uploaded"
    readback = get_listing_videos(listing_id)
    videos = readback.get("results", [])
    if len(videos) != 1 or videos[0].get("video_state") != "active":
        raise SystemExit(f"Video readback failed: {readback}")
    state = {
        "listing_id": listing_id,
        "video_id": videos[0]["video_id"],
        "video_state": "active",
        "status": status,
        "duration_seconds": metadata["duration_seconds"],
        "size_bytes": metadata["size_bytes"],
    }
    (package / "etsy-video-state.json").write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps(state, indent=2))


if __name__ == "__main__":
    main()
