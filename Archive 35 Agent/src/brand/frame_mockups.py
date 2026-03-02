"""Generate framed mockup images for Etsy listings.

Takes an original photo and creates 3 mockup images showing the photo
inside each frame type (Black, White, Natural Wood). These replace the
raw moulding close-up photos that were confusing to customers.

Each mockup shows:
- The photo at a reasonable display size
- A beveled frame border with realistic color graduation
- A subtle white mat border between frame and photo
- A light drop shadow for depth

Output: 3 JPEG files in a temp directory, ready for upload to Etsy.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Frame color presets — matches the 3 frame options in etsy_variations.py
FRAME_PRESETS = {
    "black": {
        "label": "Black Frame",
        "outer": (30, 30, 30),        # Dark gray highlight (top/left)
        "face": (20, 20, 20),         # Frame face
        "inner": (10, 10, 10),        # Inner shadow (bottom/right)
        "shadow": (50, 50, 50),       # Drop shadow
    },
    "white": {
        "label": "White Frame",
        "outer": (255, 255, 255),     # Pure white highlight
        "face": (245, 245, 240),      # Slightly warm white
        "inner": (220, 220, 215),     # Light gray shadow
        "shadow": (200, 200, 195),    # Subtle shadow
    },
    "natural_wood": {
        "label": "Natural Wood Frame",
        "outer": (212, 184, 148),     # Light wood highlight
        "face": (180, 145, 100),      # Medium wood tone
        "inner": (140, 110, 75),      # Dark wood shadow
        "shadow": (120, 95, 65),      # Deep wood shadow
    },
}

# Layout constants
FRAME_WIDTH_RATIO = 0.04     # Frame width as % of image longest edge
MAT_WIDTH_RATIO = 0.025      # White mat between frame and photo
SHADOW_SIZE = 4              # Drop shadow in px
OUTPUT_SIZE = 1200           # Max dimension of output image
JPEG_QUALITY = 88


def generate_framed_mockups(
    photo_path: str,
    output_dir: Optional[str] = None,
    frame_keys: Optional[list[str]] = None,
) -> dict[str, str]:
    """Generate framed mockup images from an original photo.

    Args:
        photo_path: Path to the original photo file
        output_dir: Directory to save mockups (default: temp dir)
        frame_keys: Which frames to generate (default: all 3)

    Returns:
        Dict mapping frame_key → output file path.
        e.g. {"black": "/tmp/.../frame-black.jpg", ...}
    """
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        logger.error("PIL/Pillow not installed — cannot generate frame mockups")
        return {}

    if frame_keys is None:
        frame_keys = list(FRAME_PRESETS.keys())

    # Load and resize the original photo
    try:
        photo = Image.open(photo_path)
    except Exception as e:
        logger.error("Cannot open photo %s: %s", photo_path, e)
        return {}

    # Convert to RGB if needed (CMYK, RGBA, etc.)
    if photo.mode != "RGB":
        photo = photo.convert("RGB")

    # Resize photo to fit within OUTPUT_SIZE (preserving aspect ratio)
    pw, ph = photo.size
    scale = min(OUTPUT_SIZE / pw, OUTPUT_SIZE / ph)
    if scale < 1:
        new_w = int(pw * scale)
        new_h = int(ph * scale)
        photo = photo.resize((new_w, new_h), Image.LANCZOS)
    pw, ph = photo.size

    # Calculate frame and mat dimensions
    longest = max(pw, ph)
    frame_w = max(int(longest * FRAME_WIDTH_RATIO), 12)
    mat_w = max(int(longest * MAT_WIDTH_RATIO), 6)

    # Create output directory
    if output_dir:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = Path(tempfile.mkdtemp(prefix="a35_frame_mockups_"))

    results = {}

    for frame_key in frame_keys:
        preset = FRAME_PRESETS.get(frame_key)
        if not preset:
            logger.warning("Unknown frame key: %s", frame_key)
            continue

        # Canvas size: photo + mat + frame + shadow
        canvas_w = pw + 2 * (mat_w + frame_w) + SHADOW_SIZE
        canvas_h = ph + 2 * (mat_w + frame_w) + SHADOW_SIZE

        # Light gray background (like a gallery wall)
        canvas = Image.new("RGB", (canvas_w, canvas_h), (245, 243, 240))
        draw = ImageDraw.Draw(canvas)

        # Offset for shadow (frame starts at shadow offset)
        fx = 0
        fy = 0

        # Draw drop shadow
        shadow_rect = (
            fx + SHADOW_SIZE,
            fy + SHADOW_SIZE,
            fx + 2 * (frame_w + mat_w) + pw + SHADOW_SIZE,
            fy + 2 * (frame_w + mat_w) + ph + SHADOW_SIZE,
        )
        draw.rectangle(shadow_rect, fill=(210, 208, 205))

        # Draw outer frame border (highlight edge)
        outer_rect = (fx, fy, fx + 2 * (frame_w + mat_w) + pw, fy + 2 * (frame_w + mat_w) + ph)
        draw.rectangle(outer_rect, fill=preset["outer"])

        # Draw frame face (main color)
        face_inset = max(frame_w // 6, 2)
        face_rect = (
            fx + face_inset,
            fy + face_inset,
            outer_rect[2] - face_inset,
            outer_rect[3] - face_inset,
        )
        draw.rectangle(face_rect, fill=preset["face"])

        # Draw inner frame edge (shadow)
        inner_inset = frame_w - max(frame_w // 6, 2)
        inner_rect = (
            fx + inner_inset,
            fy + inner_inset,
            outer_rect[2] - inner_inset,
            outer_rect[3] - inner_inset,
        )
        draw.rectangle(inner_rect, fill=preset["inner"])

        # Draw white mat
        mat_rect = (
            fx + frame_w,
            fy + frame_w,
            fx + frame_w + 2 * mat_w + pw,
            fy + frame_w + 2 * mat_w + ph,
        )
        draw.rectangle(mat_rect, fill=(255, 255, 255))

        # Paste the photo
        photo_x = fx + frame_w + mat_w
        photo_y = fy + frame_w + mat_w
        canvas.paste(photo, (photo_x, photo_y))

        # Add Archive-35 branding banner
        try:
            from src.brand.watermark import add_banner
            canvas = add_banner(canvas)
        except Exception as e:
            logger.warning("Could not add banner to %s mockup: %s", frame_key, e)

        # Save
        out_path = out_dir / f"frame-{frame_key}.jpg"
        canvas.save(str(out_path), "JPEG", quality=JPEG_QUALITY)
        results[frame_key] = str(out_path)
        logger.info("Generated %s frame mockup: %s (%dx%d)",
                     preset["label"], out_path.name, canvas_w, canvas_h)

    return results
