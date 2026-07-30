"""Build a short, silent Etsy listing video from approved preview cards."""

from __future__ import annotations

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
        raise ValueError("Bundle video requires exactly five approved previews")
    paths = [Path(value).resolve() for value in preview_paths]
    if any(not path.is_file() for path in paths):
        raise ValueError("Bundle video preview is missing")
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
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format",
         "-of", "json", str(output)],
        check=True, capture_output=True, text=True,
    )
    metadata = json.loads(probe.stdout)
    stream = metadata["streams"][0]
    return {
        "path": str(output),
        "size_bytes": output.stat().st_size,
        "duration_seconds": round(float(metadata["format"]["duration"]), 2),
        "width": stream["width"],
        "height": stream["height"],
        "codec": stream["codec_name"],
        "has_audio": any(item["codec_type"] == "audio" for item in metadata["streams"]),
    }
