"""Build a short, silent Etsy listing video from approved preview cards."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


def build_listing_video(
    preview_paths: list[str],
    output_path: str | Path,
    *,
    ffmpeg: str = "ffmpeg",
) -> dict:
    """Render five square preview cards into a 14.4-second H.264 MP4."""
    if len(preview_paths) != 5:
        raise ValueError("Listing video requires exactly five approved previews")
    paths = [Path(value).resolve() for value in preview_paths]
    if any(not path.is_file() for path in paths):
        raise ValueError("Listing video preview is missing")
    output = Path(output_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    command = [ffmpeg, "-y"]
    for path in paths:
        command.extend(["-loop", "1", "-t", "3.2", "-i", str(path)])
    scaled = ";".join(
        f"[{index}:v]scale=1080:1080,setsar=1,fps=30,format=yuv420p[v{index}]"
        for index in range(5)
    )
    fades = (
        "[v0][v1]xfade=transition=fade:duration=0.4:offset=2.8[x1];"
        "[x1][v2]xfade=transition=fade:duration=0.4:offset=5.6[x2];"
        "[x2][v3]xfade=transition=fade:duration=0.4:offset=8.4[x3];"
        "[x3][v4]xfade=transition=fade:duration=0.4:offset=11.2[out]"
    )
    command.extend([
        "-filter_complex", f"{scaled};{fades}", "-map", "[out]",
        "-t", "14.4", "-an", "-c:v", "libx264", "-crf", "20",
        "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(output),
    ])
    subprocess.run(command, check=True, capture_output=True)
    return inspect_listing_video(output)


def inspect_listing_video(
    video_path: str | Path,
    *,
    ffprobe: str = "ffprobe",
) -> dict:
    """Read the Etsy-relevant properties of an existing listing video."""
    video = Path(video_path).resolve()
    probe = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-show_format",
         "-of", "json", str(video)],
        check=True, capture_output=True, text=True,
    )
    metadata = json.loads(probe.stdout)
    stream = next(
        item for item in metadata["streams"] if item["codec_type"] == "video"
    )
    return {
        "path": str(video),
        "size_bytes": video.stat().st_size,
        "duration_seconds": round(float(metadata["format"]["duration"]), 2),
        "width": stream["width"],
        "height": stream["height"],
        "codec": stream["codec_name"],
        "has_audio": any(item["codec_type"] == "audio" for item in metadata["streams"]),
    }


def write_video_build_manifest(
    preview_paths: list[str],
    video_path: str | Path,
    destination: str | Path,
) -> Path:
    """Bind a rendered video to the exact approved previews used to build it."""
    video = Path(video_path).resolve()
    manifest = {
        "schema_version": 1,
        "previews": [
            {
                "filename": Path(value).name,
                "sha256": hashlib.sha256(Path(value).read_bytes()).hexdigest(),
            }
            for value in preview_paths
        ],
        "video": {
            "filename": video.name,
            "sha256": hashlib.sha256(video.read_bytes()).hexdigest(),
        },
    }
    output = Path(destination).resolve()
    output.write_text(json.dumps(manifest, indent=2) + "\n")
    return output


def verify_video_build_manifest(
    preview_paths: list[str],
    video_path: str | Path,
    manifest_path: str | Path,
) -> None:
    """Reject a video when its approved inputs or rendered bytes have changed."""
    manifest = json.loads(Path(manifest_path).read_text())
    expected_previews = manifest.get("previews", [])
    actual_previews = [
        {
            "filename": Path(value).name,
            "sha256": hashlib.sha256(Path(value).read_bytes()).hexdigest(),
        }
        for value in preview_paths
    ]
    if actual_previews != expected_previews:
        raise ValueError("Video build previews do not match approved inputs")
    video = Path(video_path)
    expected_video = manifest.get("video", {})
    if video.name != expected_video.get("filename"):
        raise ValueError("Video filename does not match build manifest")
    if hashlib.sha256(video.read_bytes()).hexdigest() != expected_video.get("sha256"):
        raise ValueError("Video bytes do not match build manifest")
