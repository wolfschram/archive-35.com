"""Archive-35 branding watermark banner for Etsy images.

Ports the banner style from mockup-service/compositor.js to Python/PIL.
Adds a semi-transparent bottom banner with:
  - "ARCHIVE" in white (light weight)
  - Gold vertical divider "|"
  - "35" in gold (bold)
  - "ARCHIVE-35.COM" underneath in white

Used on the original photo before Etsy upload.
The room mockup images get their banner from compositor.js (Sharp/SVG).
Frame mockup images do NOT get a banner — the original photo carries the branding.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Banner config (matches compositor.js Etsy banner)
BANNER_HEIGHT_RATIO = 0.10   # 10% of image height
BANNER_BG_OPACITY = 191      # 75% of 255
BANNER_BG_COLOR = (0, 0, 0)
GOLD = (255, 215, 0)
WHITE = (255, 255, 255)

# Etsy max image size — resize before bannering so text is proportional
ETSY_MAX_DIMENSION = 2000

# Font paths — Liberation Sans is the Linux Helvetica equivalent
FONT_LIGHT = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
FONT_FALLBACK = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_FALLBACK_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _load_font(path: str, size: int):
    """Load a TrueType font with fallback."""
    from PIL import ImageFont

    try:
        return ImageFont.truetype(path, size)
    except (IOError, OSError):
        logger.warning("Font not found: %s, trying fallback", path)
        try:
            return ImageFont.truetype(FONT_FALLBACK, size)
        except (IOError, OSError):
            logger.warning("Fallback font not found, using default")
            return ImageFont.load_default()


def _load_bold_font(size: int):
    """Load bold font with fallback chain."""
    from PIL import ImageFont

    for p in [FONT_BOLD, FONT_FALLBACK_BOLD, FONT_FALLBACK]:
        try:
            return ImageFont.truetype(p, size)
        except (IOError, OSError):
            continue
    return ImageFont.load_default()


def _resize_for_etsy(image):
    """Resize image so longest edge is ETSY_MAX_DIMENSION.

    Etsy displays at max 2000px. Resizing before bannering ensures
    the text is proportionally correct — not microscopic on 13000px panoramas.
    """
    from PIL import Image

    w, h = image.size
    longest = max(w, h)
    if longest <= ETSY_MAX_DIMENSION:
        return image

    scale = ETSY_MAX_DIMENSION / longest
    new_w = int(w * scale)
    new_h = int(h * scale)
    return image.resize((new_w, new_h), Image.LANCZOS)


def add_banner(image, banner_height_ratio: float = BANNER_HEIGHT_RATIO):
    """Add Archive-35 branding banner to the bottom of a PIL Image.

    Args:
        image: PIL Image (RGB mode). Should already be resized for Etsy.
        banner_height_ratio: Banner height as fraction of image height

    Returns:
        New PIL Image with banner composited on top
    """
    from PIL import Image, ImageDraw, ImageFont

    img_w, img_h = image.size

    # Banner height must match the room mockups (compositor.js).
    # Room mockups are 2000x2000 with 10% = 200px banner.
    # For panoramics (2000x850), percentage-of-height gives a tiny banner.
    # Fix: use 10% of the LONGEST edge — same as a square mockup would use.
    longest = max(img_w, img_h)
    banner_h = max(int(longest * banner_height_ratio), 120)

    # Create banner as RGBA for transparency
    banner = Image.new("RGBA", (img_w, banner_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(banner)

    # Semi-transparent black background
    draw.rectangle([(0, 0), (img_w, banner_h)],
                   fill=(*BANNER_BG_COLOR, BANNER_BG_OPACITY))

    # Font sizes scale with banner height
    main_font_size = max(int(banner_h * 0.38), 18)
    num_font_size = max(int(main_font_size * 1.20), 22)
    url_font_size = max(int(banner_h * 0.20), 12)

    font_light = _load_font(FONT_LIGHT, main_font_size)
    font_bold = _load_bold_font(num_font_size)
    font_url = _load_font(FONT_LIGHT, url_font_size)

    # Measure text widths for centering
    archive_text = "ARCHIVE"
    num_text = "35"
    url_text = "ARCHIVE-35.COM"

    archive_bbox = draw.textbbox((0, 0), archive_text, font=font_light)
    archive_w = archive_bbox[2] - archive_bbox[0]

    num_bbox = draw.textbbox((0, 0), num_text, font=font_bold)
    num_w = num_bbox[2] - num_bbox[0]

    url_bbox = draw.textbbox((0, 0), url_text, font=font_url)
    url_w = url_bbox[2] - url_bbox[0]

    # Layout: "ARCHIVE  |  35" centered, with divider
    gap = max(int(banner_h * 0.10), 6)        # gap between elements
    divider_w = max(int(banner_h * 0.02), 2)  # divider line width

    total_w = archive_w + gap + divider_w + gap + num_w
    start_x = (img_w - total_w) // 2

    # Vertical positions — main text at ~20% from top, URL at ~72%
    main_y = int(banner_h * 0.14)
    url_y = int(banner_h * 0.68)

    # Draw "ARCHIVE" in white
    draw.text((start_x, main_y), archive_text,
              fill=(*WHITE, 255), font=font_light)

    # Draw gold divider line
    divider_x = start_x + archive_w + gap
    divider_top = int(banner_h * 0.12)
    divider_bottom = int(banner_h * 0.55)
    draw.line([(divider_x, divider_top), (divider_x, divider_bottom)],
              fill=(*GOLD, 255), width=divider_w)

    # Draw "35" in gold bold
    num_x = divider_x + divider_w + gap
    # Vertically align "35" baseline with "ARCHIVE"
    num_y_offset = int((main_font_size - num_font_size) * 0.35)
    draw.text((num_x, main_y + num_y_offset), num_text,
              fill=(*GOLD, 255), font=font_bold)

    # Draw "ARCHIVE-35.COM" centered below
    url_x = (img_w - url_w) // 2
    draw.text((url_x, url_y), url_text,
              fill=(*WHITE, 230), font=font_url)

    # Composite banner onto image
    result = image.copy().convert("RGBA")
    banner_y = img_h - banner_h
    result.paste(banner, (0, banner_y), banner)

    return result.convert("RGB")


def add_banner_to_file(
    input_path: str,
    output_path: Optional[str] = None,
    jpeg_quality: int = 90,
) -> str:
    """Add Archive-35 banner to an image file for Etsy upload.

    Resizes to Etsy max dimensions (2000px) first, then applies banner.
    This ensures the banner text is proportionally correct regardless
    of original photo resolution (even 13000px panoramas).

    Args:
        input_path: Path to input image
        output_path: Path to save result (default: overwrites input)
        jpeg_quality: JPEG quality (default 90)

    Returns:
        Path to the output file
    """
    from PIL import Image

    if output_path is None:
        output_path = input_path

    try:
        img = Image.open(input_path)
        if img.mode != "RGB":
            img = img.convert("RGB")

        # Resize to Etsy dimensions first — banner proportions depend on this
        img = _resize_for_etsy(img)

        result = add_banner(img)
        result.save(output_path, "JPEG", quality=jpeg_quality)
        logger.info("Branded for Etsy: %s → %s (%dx%d)",
                     Path(input_path).name, Path(output_path).name,
                     result.size[0], result.size[1])
        return output_path

    except Exception as e:
        logger.error("Failed to add banner to %s: %s", input_path, e)
        return input_path  # Return original path on failure
