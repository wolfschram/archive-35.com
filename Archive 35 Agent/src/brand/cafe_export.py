"""Archive-35 CaFÉ (CallForEntry.org) Portfolio Export Module.

Prepares images and metadata for CaFÉ portfolio submissions.
Follows the EXACT pattern of the Etsy export system (06_Automation/etsy-export/).

CaFÉ requirements:
  - JPEG images, under 5MB, 1200-3000px longest side
  - Metadata fields with strict character limits (title 60, alt_text 125, medium 60, desc 300)
  - submission.json per-image form data
  - README.txt validation report

Export structure:
  CaFE Ready/
    {call_name}/
      submission.json  (array of all images)
      README.txt       (submission manifest + validation)
      {filename_001}.jpg
      {filename_002}.jpg
      ...
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image

logger = logging.getLogger(__name__)

__all__ = [
    "resize_for_cafe",
    "calculate_print_dimensions",
    "truncate_with_ellipsis",
    "generate_alt_text",
    "resolve_photo_metadata",
    "build_cafe_metadata",
    "export_cafe_folder",
]


# CaFE Submission Constraints
CAFE_MAX_SIZE_MB = 4.8
CAFE_MIN_PX = 1200
CAFE_MAX_PX = 3000
CAFE_MAX_IMAGES = 10

# Character limits (enforce via truncation)
CHAR_LIMITS = {
    "title": 60,
    "alt_text": 125,
    "medium": 60,
    "description": 300,
}

# Default medium text (photo type descriptor)
DEFAULT_MEDIUM = "Digital photograph, archival pigment print"


def resize_for_cafe(
    src_path: Path,
    dest_path: Path,
    max_size_mb: float = CAFE_MAX_SIZE_MB,
    min_px: int = CAFE_MIN_PX,
    max_px: int = CAFE_MAX_PX,
) -> dict:
    """Resize image to CaFE specification.

    Strategy:
      1. Open image and determine dimensions
      2. Check if already within acceptable size range
      3. If longer edge < min_px, upscale (rare, but possible)
      4. If longer edge > max_px, downscale
      5. Compress JPEG to meet size target (max_size_mb)
      6. Return metadata: {width, height, file_size_kb, quality}

    Args:
        src_path: Source image path
        dest_path: Destination path for resized JPEG
        max_size_mb: Maximum file size target (default 4.8 MB)
        min_px: Minimum longest side (default 1200)
        max_px: Maximum longest side (default 3000)

    Returns:
        Dict with keys: width, height, file_size_kb, quality_used
    """
    try:
        img = Image.open(src_path)
        if img.mode != "RGB":
            img = img.convert("RGB")

        w, h = img.size
        longest = max(w, h)

        # Calculate target resolution
        target_longest = longest
        if longest < min_px:
            logger.warning(
                "Image %s is %dpx (< %dpx min), upscaling",
                Path(src_path).name,
                longest,
                min_px,
            )
            target_longest = min_px
        elif longest > max_px:
            target_longest = max_px

        # Resize if needed
        if target_longest != longest:
            scale = target_longest / longest
            new_w = int(w * scale)
            new_h = int(h * scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            logger.info(
                "Resized %s: %dx%d → %dx%d",
                Path(src_path).name,
                w,
                h,
                new_w,
                new_h,
            )

        # Compress to meet size target
        # Start at quality 85, reduce until file meets size target
        max_bytes = max_size_mb * 1024 * 1024
        quality = 85
        min_quality = 60

        while quality >= min_quality:
            img.save(dest_path, "JPEG", quality=quality, optimize=True)
            file_size_bytes = os.path.getsize(dest_path)

            if file_size_bytes <= max_bytes:
                logger.info(
                    "CaFE image ready: %s (%dx%d @ Q%d, %.1f MB)",
                    Path(dest_path).name,
                    img.width,
                    img.height,
                    quality,
                    file_size_bytes / 1024 / 1024,
                )
                return {
                    "width": img.width,
                    "height": img.height,
                    "file_size_kb": file_size_bytes / 1024,
                    "quality": quality,
                }

            quality -= 5

        # If even Q60 is too big, use it anyway (CaFE may accept slightly over)
        img.save(dest_path, "JPEG", quality=min_quality, optimize=True)
        file_size_bytes = os.path.getsize(dest_path)

        logger.warning(
            "CaFE image oversized: %s (%.1f MB > %.1f MB max)",
            Path(dest_path).name,
            file_size_bytes / 1024 / 1024,
            max_size_mb,
        )

        return {
            "width": img.width,
            "height": img.height,
            "file_size_kb": file_size_bytes / 1024,
            "quality": min_quality,
        }

    except Exception as e:
        logger.error("Failed to resize %s for CaFE: %s", src_path, e)
        raise


def calculate_print_dimensions(
    pixel_w: int, pixel_h: int, max_long_side_inches: int = 30
) -> dict:
    """Calculate standard print dimensions from pixel dimensions.

    Assumes 300 DPI (professional print standard).
    Returns max dimension as max_long_side_inches if needed.

    Args:
        pixel_w: Image width in pixels
        pixel_h: Image height in pixels
        max_long_side_inches: Cap longest dimension (default 30")

    Returns:
        Dict with keys: width_inches, height_inches, depth_inches
    """
    dpi = 300  # Professional print standard
    inches_w = pixel_w / dpi
    inches_h = pixel_h / dpi

    # Scale down if longest side exceeds max
    longest_inches = max(inches_w, inches_h)
    if longest_inches > max_long_side_inches:
        scale = max_long_side_inches / longest_inches
        inches_w *= scale
        inches_h *= scale

    # CaFE asks for depth (print mount thickness), usually ~0.1" for standard prints
    depth = 0.1

    return {
        "width": round(inches_w, 1),
        "height": round(inches_h, 1),
        "depth": depth,
    }


def truncate_with_ellipsis(text: str, max_len: int) -> str:
    """Truncate text to max_len characters, breaking at word boundary if possible.

    If text fits, returns unchanged. If oversized, adds "..." and tries to
    break at the last space before the limit.

    Args:
        text: Input text
        max_len: Character limit

    Returns:
        Truncated text (or original if already within limit)
    """
    if len(text) <= max_len:
        return text

    # Leave room for "..."
    target = max_len - 3

    # Try to break at last space before target
    truncated = text[:target]
    last_space = truncated.rfind(" ")

    if last_space > 0:
        truncated = truncated[:last_space]
    else:
        truncated = truncated[:target]

    return truncated.rstrip() + "..."


def generate_alt_text(title: str, description: str, max_len: int = 125) -> str:
    """Generate alt text from title and first sentence of description.

    Strategy:
      - Start with title
      - Append first sentence of description (up to max_len total)
      - For accessibility: "Title. First sentence of description."

    Args:
        title: Photo title
        description: Photo description (may be multi-sentence)
        max_len: Character limit for alt text

    Returns:
        Alt text, truncated to max_len if needed
    """
    # Extract first sentence
    first_sentence = description.split(".")[0].strip()

    # Build alt text: "Title. First sentence."
    alt = f"{title}. {first_sentence}."

    # Truncate if needed
    if len(alt) > max_len:
        alt = truncate_with_ellipsis(alt, max_len)

    return alt


def resolve_photo_metadata(
    photo_id: str,
    photos_json_path: Path,
    licensing_catalog_path: Optional[Path] = None,
) -> dict:
    """Resolve photo metadata from canonical sources.

    Checks photos.json first (canonical for published images), then falls back
    to licensing_catalog if provided (for licensing-specific metadata).

    Args:
        photo_id: Photo ID to look up (e.g., "alps-001")
        photos_json_path: Path to photos.json (main metadata)
        licensing_catalog_path: Optional licensing catalog JSON

    Returns:
        Unified metadata dict with source tracking:
        {
          id, filename, title, description, location, tags, year,
          collection, collectionTitle, dimensions, source
        }

    Raises:
        ValueError: If photo not found in any source
    """
    # Try photos.json first
    try:
        with open(photos_json_path) as f:
            data = json.load(f)
            photos = data.get("photos", [])

        for photo in photos:
            if photo.get("id") == photo_id:
                photo["source"] = "photos.json"
                return photo

    except Exception as e:
        logger.warning("Failed to load photos.json: %s", e)

    # Try licensing catalog if provided
    if licensing_catalog_path and licensing_catalog_path.exists():
        try:
            with open(licensing_catalog_path) as f:
                data = json.load(f)
                photos = data.get("photos", [])

            for photo in photos:
                if photo.get("id") == photo_id:
                    photo["source"] = "licensing_catalog"
                    return photo

        except Exception as e:
            logger.warning("Failed to load licensing catalog: %s", e)

    # Not found anywhere
    raise ValueError(f"Photo {photo_id} not found in metadata sources")


def build_cafe_metadata(photo_data: dict, overrides: dict = None) -> dict:
    """Build CaFE-ready metadata from resolved photo data.

    Enforces all character limits via truncation.
    Generates computed fields like alt_text and print dimensions.

    Args:
        photo_data: Resolved photo metadata (from resolve_photo_metadata)
        overrides: Optional dict of field overrides (title, description, etc.)

    Returns:
        Dict ready for CaFE submission.json with fields:
        - title (str, ≤60 chars)
        - alt_text (str, ≤125 chars, auto-generated if not provided)
        - medium (str, ≤60 chars, default: "Digital photograph...")
        - description (str, ≤300 chars)
        - height, width, depth (print dimensions in inches)
        - units (always "Inches")
        - year (int)
        - for_sale (str: "Yes"/"No")
        - price (int, default 1200)
        - discipline (str, always "Photography")
        - public_art (str, always "No")
        - file (str, filename only, no path)
    """
    overrides = overrides or {}

    # Resolve values with override support
    title = overrides.get("title") or photo_data.get("title", "Untitled")
    description = overrides.get("description") or photo_data.get("description", "")
    medium = overrides.get("medium") or DEFAULT_MEDIUM
    price = overrides.get("price") or 1200
    year = overrides.get("year") or photo_data.get("year") or 2024
    for_sale = overrides.get("for_sale") or "Yes"

    # Truncate to character limits
    title = truncate_with_ellipsis(title, CHAR_LIMITS["title"])
    description = truncate_with_ellipsis(description, CHAR_LIMITS["description"])
    medium = truncate_with_ellipsis(medium, CHAR_LIMITS["medium"])

    # Generate alt text if not provided
    alt_text = overrides.get("alt_text") or generate_alt_text(title, description)
    alt_text = truncate_with_ellipsis(alt_text, CHAR_LIMITS["alt_text"])

    # Calculate print dimensions
    dims_px = photo_data.get("dimensions", {})
    pixel_w = dims_px.get("width", 3000)
    pixel_h = dims_px.get("height", 2000)
    print_dims = calculate_print_dimensions(pixel_w, pixel_h)

    # Filename (no path)
    filename = overrides.get("file") or f"{photo_data.get('filename', 'photo')}.jpg"

    return {
        "file": filename,
        "title": title,
        "alt_text": alt_text,
        "medium": medium,
        "height": print_dims["height"],
        "width": print_dims["width"],
        "depth": print_dims["depth"],
        "units": "Inches",
        "for_sale": for_sale,
        "price": price,
        "year": year,
        "discipline": "Photography",
        "public_art": "No",
        "description": description,
    }


def export_cafe_folder(
    call_name: str,
    images: list[dict],
    project_root: Path,
    output_root: Path = None,
) -> dict:
    """Export CaFE portfolio submission folder.

    Main export function. Creates folder structure:
      {output_root}/
        {call_name}/
          submission.json  (array of all image entries)
          README.txt       (manifest + validation report)
          {filename_001}.jpg
          {filename_002}.jpg
          ...

    Args:
        call_name: Call name for folder (e.g., "photografique-issue-002")
        images: List of image specs, each with keys:
          - photo_id: Photo ID (e.g., "alps-001")
          - file_path: Path to source image file
          - overrides: Optional dict of metadata overrides (title, description, price, etc.)
        project_root: Archive-35.com repository root (for photos.json location)
        output_root: Output folder (default: {project_root}/CaFE Ready/)

    Returns:
        Dict with keys:
        - success (bool)
        - export_path (str): Path to created folder
        - images_count (int): Number of images exported
        - submission_json_path (str): Path to submission.json
        - errors (list): Any warnings/errors encountered
    """
    output_root = output_root or project_root / "CaFE Ready"
    export_path = output_root / call_name

    errors = []

    try:
        # Validate inputs
        if len(images) > CAFE_MAX_IMAGES:
            errors.append(
                f"Too many images: {len(images)} > {CAFE_MAX_IMAGES} (CaFE limit)"
            )
            return {
                "success": False,
                "export_path": str(export_path),
                "images_count": 0,
                "submission_json_path": None,
                "errors": errors,
            }

        if not images:
            errors.append("No images provided")
            return {
                "success": False,
                "export_path": str(export_path),
                "images_count": 0,
                "submission_json_path": None,
                "errors": errors,
            }

        # Locate photos.json
        photos_json_path = project_root / "_site" / "data" / "photos.json"
        if not photos_json_path.exists():
            # Fallback: try data/photos.json
            photos_json_path = project_root / "data" / "photos.json"

        if not photos_json_path.exists():
            errors.append(f"photos.json not found at {photos_json_path}")
            return {
                "success": False,
                "export_path": str(export_path),
                "images_count": 0,
                "submission_json_path": None,
                "errors": errors,
            }

        # Create export folder
        export_path.mkdir(parents=True, exist_ok=True)
        images_folder = export_path / "images"
        images_folder.mkdir(exist_ok=True)

        logger.info("Exporting CaFE submission to %s", export_path)

        # Process each image
        submission_data = []
        readme_entries = []

        for idx, image_spec in enumerate(images, 1):
            try:
                photo_id = image_spec.get("photo_id")
                file_path = Path(image_spec.get("file_path"))
                overrides = image_spec.get("overrides") or {}

                if not file_path.exists():
                    errors.append(f"Image file not found: {file_path}")
                    continue

                # Resolve metadata
                photo_data = resolve_photo_metadata(photo_id, photos_json_path)

                # Build CaFE metadata
                cafe_meta = build_cafe_metadata(photo_data, overrides)

                # Resize image for CaFE
                dest_filename = f"{idx:03d}_{cafe_meta['file']}"
                dest_path = images_folder / dest_filename
                resize_info = resize_for_cafe(file_path, dest_path)

                # Update metadata with actual resized dimensions
                cafe_meta["file"] = dest_filename
                submission_data.append(cafe_meta)

                # Build README entry
                readme_entries.append(
                    {
                        "index": idx,
                        "title": cafe_meta["title"],
                        "original_filename": photo_data.get("filename", "unknown"),
                        "alt_text": cafe_meta["alt_text"],
                        "description": cafe_meta["description"],
                        "medium": cafe_meta["medium"],
                        "price": cafe_meta["price"],
                        "year": cafe_meta["year"],
                        "width": cafe_meta["width"],
                        "height": cafe_meta["height"],
                        "file_size_kb": resize_info["file_size_kb"],
                    }
                )

                logger.info(
                    "Exported image %d/%d: %s (%dx%d, Q%d)",
                    idx,
                    len(images),
                    dest_filename,
                    resize_info["width"],
                    resize_info["height"],
                    resize_info["quality"],
                )

            except Exception as e:
                errors.append(f"Failed to process image {idx}: {e}")
                logger.error("Failed to process image %d: %s", idx, e)
                continue

        # Write submission.json
        submission_json_path = export_path / "submission.json"
        with open(submission_json_path, "w") as f:
            json.dump(submission_data, f, indent=2)

        logger.info("Wrote submission.json with %d images", len(submission_data))

        # Write README.txt
        readme_txt_path = export_path / "README.txt"
        readme_content = _build_readme(call_name, readme_entries, errors)
        with open(readme_txt_path, "w") as f:
            f.write(readme_content)

        logger.info("Wrote README.txt")

        return {
            "success": len(submission_data) > 0,
            "export_path": str(export_path),
            "images_count": len(submission_data),
            "submission_json_path": str(submission_json_path),
            "errors": errors if errors else None,
        }

    except Exception as e:
        errors.append(f"Export failed: {e}")
        logger.error("CaFE export failed: %s", e)
        return {
            "success": False,
            "export_path": str(export_path),
            "images_count": 0,
            "submission_json_path": None,
            "errors": errors,
        }


def _build_readme(call_name: str, entries: list[dict], errors: list[str]) -> str:
    """Build README.txt validation report.

    Args:
        call_name: Call name
        entries: List of readme entry dicts
        errors: List of error/warning messages

    Returns:
        Formatted README.txt string
    """
    timestamp = datetime.utcnow().isoformat() + "Z"

    lines = [
        f"CAFE SUBMISSION — {call_name}",
        f"Generated: {timestamp}",
        f"Images: {len(entries)} of {CAFE_MAX_IMAGES} (CaFE max)",
        "",
        "IMAGE ORDER:",
    ]

    # Image list
    for entry in entries:
        lines.append(f"  {entry['index']}. {entry['title']} ({entry['original_filename']})")
        lines.append(f"     Title: {entry['title']} [{len(entry['title'])}/60 chars]")
        lines.append(f"     Alt Text: {entry['alt_text'][:80]}{'...' if len(entry['alt_text']) > 80 else ''} [{len(entry['alt_text'])}/125 chars]")
        lines.append(f"     Description: {entry['description'][:60]}{'...' if len(entry['description']) > 60 else ''} [{len(entry['description'])}/300 chars]")
        lines.append(f"     Medium: {entry['medium']} | Price: ${entry['price']} | Year: {entry['year']} | {entry['width']}\"{entry['height']}\"")

    # Validation summary
    lines.append("")
    lines.append("VALIDATION:")

    title_ok = all(len(e["title"]) <= 60 for e in entries)
    lines.append(f"  {'✓' if title_ok else '✗'} All titles under 60 chars")

    desc_ok = all(len(e["description"]) <= 300 for e in entries)
    lines.append(f"  {'✓' if desc_ok else '✗'} All descriptions under 300 chars")

    alt_ok = all(len(e["alt_text"]) <= 125 for e in entries)
    lines.append(f"  {'✓' if alt_ok else '✗'} All alt texts under 125 chars")

    size_ok = all(e["file_size_kb"] < 5 * 1024 for e in entries)  # 5 MB
    lines.append(f"  {'✓' if size_ok else '✗'} All images under 5MB")

    if errors:
        lines.append("")
        lines.append("WARNINGS:")
        for error in errors:
            lines.append(f"  ! {error}")

    return "\n".join(lines)
