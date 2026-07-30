#!/usr/bin/env python3
"""Upload the verified Desert Geometry listing video exactly once."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.integrations.etsy import get_listing_videos, upload_listing_video_from_path


def main() -> None:
    package = (
        AGENT_ROOT / "data/etsy_digital_drafts/A35-DIG-SET-DES-0001"
    ).resolve()
    listing_id = int(json.loads((package / "etsy-state.json").read_text())["listing_id"])
    video = package / "A35-DIG-SET-DES-0001_listing-video.mp4"
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format",
         "-of", "json", str(video)],
        check=True, capture_output=True, text=True,
    ).stdout)
    streams = probe["streams"]
    duration = float(probe["format"]["duration"])
    valid = (
        3 <= duration <= 15
        and video.stat().st_size <= 100 * 1024 * 1024
        and streams[0]["width"] >= 1080
        and streams[0]["height"] >= 1080
        and not any(item["codec_type"] == "audio" for item in streams)
    )
    if not valid:
        raise SystemExit("Listing video failed Etsy preflight")
    before = get_listing_videos(listing_id)
    if before.get("results"):
        print(json.dumps({"status": "existing", "videos": before["results"]}, indent=2))
        return
    result = upload_listing_video_from_path(listing_id, str(video))
    if "error" in result:
        raise SystemExit(json.dumps(result))
    readback = get_listing_videos(listing_id)
    if "error" in readback or not readback.get("results"):
        raise SystemExit(f"Video upload readback failed: {readback}")
    state = {
        "listing_id": listing_id,
        "video_id": readback["results"][0].get("video_id"),
        "video_state": readback["results"][0].get("video_state"),
        "duration_seconds": round(duration, 2),
        "size_bytes": video.stat().st_size,
    }
    (package / "etsy-video-state.json").write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps(state, indent=2))


if __name__ == "__main__":
    main()
