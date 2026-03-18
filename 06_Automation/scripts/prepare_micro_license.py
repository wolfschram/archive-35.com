#!/usr/bin/env python3
"""
Image Preparation Pipeline for Archive-35 Micro-Licensing
Generates multi-resolution versions from source images.

Usage:
  python3 prepare_micro_license.py                     # Process first 10 from watermarked/
  python3 prepare_micro_license.py --count 50          # Process first 50
  python3 prepare_micro_license.py --input /path/to/dir # Process from specific directory
"""
import json
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

try:
    from PIL import Image, ImageDraw, ImageFont, ExifTags
except ImportError:
    print("ERROR: Pillow not installed. Run: pip3 install Pillow")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]  # archive-35 root
WATERMARKED_DIR = ROOT / "09_Licensing" / "watermarked"
OUTPUT_DIR = ROOT / "09_Licensing" / "micro"
C2PA_DIR = ROOT / "07_C2PA"
DATA_DIR = ROOT / "data"

# Resolution tiers
TIERS = {
    "thumbnail": {
        "width": 1200,
        "height": 630,
        "quality": 85,
        "suffix": "_thumb",
        "description": "Social/blog thumbnail"
    },
    "web_standard": {
        "width": 2400,
        "height": 1600,
        "quality": 92,
        "suffix": "_web",
        "description": "Web standard resolution"
    },
    "web_premium": {
        "width": 4000,
        "height": 2667,
        "quality": 95,
        "suffix": "_premium",
        "description": "Web premium resolution"
    }
}


def get_exif_data(img):
    """Extract EXIF data from image."""
    exif = {}
    try:
        raw_exif = img.getexif()
        if raw_exif:
            for tag_id, value in raw_exif.items():
                tag = ExifTags.TAGS.get(tag_id, tag_id)
                if isinstance(value, bytes):
                    continue  # Skip binary data
                exif[str(tag)] = str(value)
    except Exception:
        pass
    return exif


def copy_exif(source_img, dest_path):
    """Copy EXIF data from source to destination."""
    try:
        exif = source_img.info.get("exif")
        if exif:
            dest_img = Image.open(dest_path)
            dest_img.save(dest_path, "JPEG", exif=exif, quality=95)
    except Exception:
        pass  # EXIF copy is best-effort


def create_watermark(img, text="ARCHIVE-35"):
    """Add a subtle watermark to the preview image."""
    watermarked = img.copy()
    draw = ImageDraw.Draw(watermarked)

    # Try to load a good font
    font_size = max(20, min(img.width, img.height) // 20)
    font = None
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                continue
    if not font:
        font = ImageFont.load_default()

    # Draw semi-transparent watermark diagonally across center
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    x = (img.width - text_w) // 2
    y = (img.height - text_h) // 2

    # Draw with transparency using a separate image
    txt_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    txt_draw = ImageDraw.Draw(txt_layer)
    # White text with low opacity
    txt_draw.text((x, y), text, fill=(255, 255, 255, 60), font=font)
    # Second line offset
    txt_draw.text((x - text_w // 4, y + text_h + 20), text, fill=(255, 255, 255, 40), font=font)
    txt_draw.text((x + text_w // 4, y - text_h - 20), text, fill=(255, 255, 255, 40), font=font)

    watermarked = Image.alpha_composite(watermarked.convert("RGBA"), txt_layer)
    return watermarked.convert("RGB")


def resize_to_fit(img, target_width, target_height):
    """Resize image to fit within target dimensions, cropping to aspect ratio if needed."""
    target_ratio = target_width / target_height
    img_ratio = img.width / img.height

    if abs(img_ratio - target_ratio) < 0.1:
        # Close enough, just resize
        return img.resize((target_width, target_height), Image.LANCZOS)

    if img_ratio > target_ratio:
        # Image is wider - crop width
        new_height = img.height
        new_width = int(new_height * target_ratio)
        left = (img.width - new_width) // 2
        cropped = img.crop((left, 0, left + new_width, new_height))
    else:
        # Image is taller - crop height
        new_width = img.width
        new_height = int(new_width / target_ratio)
        top = (img.height - new_height) // 2
        cropped = img.crop((0, top, new_width, top + new_height))

    return cropped.resize((target_width, target_height), Image.LANCZOS)


def process_image(source_path, image_id, output_base):
    """Process a single image into all resolution tiers."""
    try:
        img = Image.open(source_path)
    except Exception as e:
        print(f"  ERROR: Cannot open {source_path}: {e}")
        return None

    exif_data = get_exif_data(img)
    results = {
        "image_id": image_id,
        "source": str(source_path),
        "source_dimensions": {"width": img.width, "height": img.height},
        "exif": exif_data,
        "versions": {},
        "processed_at": datetime.utcnow().isoformat()
    }

    # Generate each tier
    for tier_name, tier_config in TIERS.items():
        target_w = tier_config["width"]
        target_h = tier_config["height"]

        # Skip if source is smaller than target
        if img.width < target_w and img.height < target_h:
            # Use source dimensions scaled proportionally
            scale = min(target_w / img.width, target_h / img.height)
            target_w = int(img.width * scale)
            target_h = int(img.height * scale)

        resized = resize_to_fit(img, target_w, target_h)
        output_path = output_base / f"{image_id}{tier_config['suffix']}.jpg"

        resized.save(output_path, "JPEG", quality=tier_config["quality"])

        # Try to copy EXIF
        copy_exif(img, output_path)

        results["versions"][tier_name] = {
            "path": str(output_path.relative_to(ROOT)),
            "width": resized.width,
            "height": resized.height,
            "quality": tier_config["quality"],
            "file_size_kb": round(os.path.getsize(output_path) / 1024, 1)
        }

    # Generate watermarked preview
    preview_w = min(1600, img.width)
    preview_h = int(preview_w * img.height / img.width)
    preview = img.resize((preview_w, preview_h), Image.LANCZOS)
    watermarked = create_watermark(preview)
    preview_path = output_base / f"{image_id}_preview.jpg"
    watermarked.save(preview_path, "JPEG", quality=85)

    results["versions"]["preview"] = {
        "path": str(preview_path.relative_to(ROOT)),
        "width": watermarked.width,
        "height": watermarked.height,
        "quality": 85,
        "file_size_kb": round(os.path.getsize(preview_path) / 1024, 1),
        "watermarked": True
    }

    return results


def main():
    parser = argparse.ArgumentParser(description="Prepare micro-license image versions")
    parser.add_argument("--input", type=str, default=str(WATERMARKED_DIR),
                        help="Input directory with source images")
    parser.add_argument("--count", type=int, default=10,
                        help="Number of images to process")
    args = parser.parse_args()

    input_dir = Path(args.input)
    if not input_dir.exists():
        print(f"ERROR: Input directory not found: {input_dir}")
        sys.exit(1)

    # Create output directories
    output_base = OUTPUT_DIR
    output_base.mkdir(parents=True, exist_ok=True)

    # Load catalog for ID matching
    catalog_path = DATA_DIR / "licensing-catalog.json"
    id_lookup = {}
    if catalog_path.exists():
        with open(catalog_path) as f:
            cat = json.load(f)
        for img in cat.get("images", []):
            id_lookup[f"{img['id']}.jpg"] = img["id"]

    # Find source images
    source_files = sorted([
        f for f in input_dir.iterdir()
        if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".tiff", ".tif")
    ])[:args.count]

    print(f"[Micro-License Prep] Processing {len(source_files)} images from {input_dir}")
    print(f"  Output: {output_base}")

    manifest = {
        "generated_at": datetime.utcnow().isoformat(),
        "source_dir": str(input_dir),
        "tiers": {k: v["description"] for k, v in TIERS.items()},
        "images": []
    }

    processed = 0
    for source_path in source_files:
        image_id = id_lookup.get(source_path.name, source_path.stem)
        print(f"  [{processed + 1}/{len(source_files)}] {image_id}...", end="")

        result = process_image(source_path, image_id, output_base)
        if result:
            manifest["images"].append(result)
            processed += 1
            print(" OK")
        else:
            print(" FAILED")

    # Save manifest
    manifest_path = output_base / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n[Micro-License Prep] Done: {processed}/{len(source_files)} images processed")
    print(f"  Manifest: {manifest_path}")
    print(f"  Tiers: {', '.join(TIERS.keys())} + preview (watermarked)")

    return manifest


if __name__ == "__main__":
    main()
