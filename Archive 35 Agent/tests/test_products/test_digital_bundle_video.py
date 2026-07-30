from pathlib import Path

from PIL import Image

from src.products.digital_bundle_video import build_listing_video


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
