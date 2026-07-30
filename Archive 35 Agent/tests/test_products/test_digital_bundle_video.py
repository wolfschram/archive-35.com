from pathlib import Path

from PIL import Image

import pytest

from src.products.digital_bundle_video import (
    build_listing_video,
    inspect_listing_video,
    verify_video_build_manifest,
    write_video_build_manifest,
)


def test_builds_etsy_compliant_silent_video(tmp_path):
    previews = []
    for index, color in enumerate(("red", "green", "blue", "gold", "black")):
        path = tmp_path / f"{index}.jpg"
        Image.new("RGB", (2000, 2000), color).save(path, quality=80)
        previews.append(str(path))
    output = tmp_path / "bundle.mp4"
    result = build_listing_video(previews, output)
    assert Path(result["path"]) == output.resolve()
    assert result["codec"] == "h264"
    assert result["width"] == result["height"] == 1080
    assert 3 <= result["duration_seconds"] <= 15
    assert result["size_bytes"] < 100 * 1024 * 1024
    assert result["has_audio"] is False
    assert inspect_listing_video(output) == result


def test_video_manifest_binds_approved_inputs_and_output(tmp_path):
    previews = []
    for index in range(2):
        path = tmp_path / f"{index}.jpg"
        path.write_bytes(f"preview-{index}".encode())
        previews.append(str(path))
    video = tmp_path / "listing.mp4"
    video.write_bytes(b"video")
    manifest = write_video_build_manifest(previews, video, tmp_path / "video-build.json")

    verify_video_build_manifest(previews, video, manifest)
    video.write_bytes(b"changed")
    with pytest.raises(ValueError, match="Video bytes"):
        verify_video_build_manifest(previews, video, manifest)


def test_video_manifest_rejects_changed_preview(tmp_path):
    preview = tmp_path / "preview.jpg"
    preview.write_bytes(b"approved")
    video = tmp_path / "listing.mp4"
    video.write_bytes(b"video")
    manifest = write_video_build_manifest([str(preview)], video, tmp_path / "build.json")

    preview.write_bytes(b"changed")
    with pytest.raises(ValueError, match="approved inputs"):
        verify_video_build_manifest([str(preview)], video, manifest)
