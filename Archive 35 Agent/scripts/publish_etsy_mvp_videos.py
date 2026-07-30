#!/usr/bin/env python3
"""Idempotently upload verified videos for the controlled $12 printables."""

from __future__ import annotations

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
    spec = json.loads((AGENT_ROOT / "experiments/etsy-digital-mvp.json").read_text())
    drafts = AGENT_ROOT / "data/etsy_digital_drafts"
    published = []
    skipped = []
    for product in spec["products"]:
        product_id = product["product_id"]
        listing_id = int(product["etsy_listing_id"])
        package = drafts / product_id
        video = package / f"{product_id}_listing-video.mp4"
        try:
            previews = load_approved_previews(package)
            verify_video_build_manifest(
                previews, video, package / "video-build.json"
            )
        except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
            skipped.append({"product_id": product_id, "reason": str(exc)})
            continue
        metadata = inspect_listing_video(video)
        invalid = (
            not 3 <= metadata["duration_seconds"] <= 15
            or metadata["size_bytes"] > 100 * 1024 * 1024
            or min(metadata["width"], metadata["height"]) < 1080
            or metadata["has_audio"]
        )
        if invalid:
            skipped.append({"product_id": product_id, "reason": "Etsy video preflight failed"})
            continue
        before = get_listing_videos(listing_id)
        if "error" in before:
            raise SystemExit(f"Video lookup failed for {product_id}: {before}")
        status = "existing"
        if not before.get("results"):
            uploaded = upload_listing_video_from_path(listing_id, str(video))
            if "error" in uploaded:
                raise SystemExit(f"Video upload failed for {product_id}: {uploaded}")
            status = "uploaded"
        readback = get_listing_videos(listing_id)
        videos = readback.get("results", [])
        if len(videos) != 1 or videos[0].get("video_state") != "active":
            raise SystemExit(f"Video readback failed for {product_id}: {readback}")
        state = {
            "product_id": product_id, "listing_id": listing_id,
            "video_id": videos[0]["video_id"], "video_state": "active",
            "status": status,
        }
        (package / "etsy-video-state.json").write_text(json.dumps(state, indent=2) + "\n")
        published.append(state)
    if not published:
        raise SystemExit(f"No approved videos were published: {skipped}")
    print(json.dumps({"published": published, "skipped": skipped}, indent=2))


if __name__ == "__main__":
    main()
