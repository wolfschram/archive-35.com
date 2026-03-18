#!/usr/bin/env python3
"""
Pinterest Pin Generator for Archive-35
Generates 1000x1500 vertical pin images with branding and a CSV for Tailwind bulk upload.
"""
import json
import csv
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("ERROR: Pillow not installed. Run: pip3 install Pillow")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]  # archive-35 root
DATA_DIR = ROOT / "data"
WATERMARKED_DIR = ROOT / "09_Licensing" / "watermarked"
OUTPUT_DIR = ROOT / "02_Social" / "pinterest" / "pins"
CSV_OUTPUT = ROOT / "02_Social" / "pinterest" / "tailwind_upload.csv"

PIN_WIDTH = 1000
PIN_HEIGHT = 1500
PHOTO_HEIGHT = 1000  # Top 2/3
BRAND_HEIGHT = 500   # Bottom 1/3

# Brand colors
BG_COLOR = (18, 18, 18)        # Dark background
GOLD = (201, 168, 76)          # Gold accent
WHITE = (255, 255, 255)
LIGHT_GRAY = (180, 180, 180)

# Board mapping based on location/tags
BOARD_RULES = [
    (["iceland"], "Iceland Photography | Nature Wall Art"),
    (["grand teton", "teton", "glacier", "yosemite", "joshua tree", "sequoia", "death valley", "white sands", "national park"], "National Park Photography | Mountain Art"),
    (["tanzania", "serengeti", "south africa", "safari", "elephant", "cheetah", "lion", "wildlife"], "African Wildlife Prints | Safari Wall Art"),
    (["desert", "white sands", "death valley", "dunes", "monument valley"], "Desert Photography | Minimalist Art"),
    (["new york", "manhattan", "chicago", "los angeles", "san francisco", "london", "paris", "prague", "moscow", "urban", "city"], "Urban Photography | Modern Wall Art"),
    (["landscape", "mountain", "ocean", "lake", "waterfall", "coast", "beach"], "Landscape Photography Prints | Fine Art Wall Decor"),
]
DEFAULT_BOARD = "Fine Art Photography | Archive-35"


def get_board(image_data):
    """Determine Pinterest board based on image location and tags."""
    location = image_data.get("location", "").lower()
    title = image_data.get("title", "").lower()
    tags = []
    for field in ["tags", "subjects"]:
        val = image_data.get(field, [])
        if isinstance(val, list):
            tags.extend([t.lower() for t in val])
        elif isinstance(val, str):
            tags.append(val.lower())

    search_text = f"{location} {title} {' '.join(tags)}"

    for keywords, board in BOARD_RULES:
        for kw in keywords:
            if kw in search_text:
                return board
    return DEFAULT_BOARD


def get_location_tag(location):
    """Generate a hashtag from location."""
    if not location:
        return "naturephotography"
    parts = location.replace(",", "").split()
    # Use first significant word
    for part in parts:
        if len(part) > 3:
            return part.lower().replace(" ", "")
    return "travel"


def generate_description(image_data):
    """Generate pin description from image data."""
    title = image_data.get("title", "Untitled")
    location = image_data.get("location", "")
    loc_tag = get_location_tag(location)

    desc = f"""{title} | Fine art photography print by Wolf Schram

{location}

Museum-quality prints on canvas, metal, acrylic, and fine art paper. Free US shipping. C2PA verified -- NOT AI generated.

Shop prints: https://www.etsy.com/shop/Archive35Photo
License: https://archive-35.com/licensing.html

#fineart #photography #wallart #homedecor #landscapephotography #{loc_tag}"""
    return desc


def try_load_font(size):
    """Try to load a clean font, fall back to default."""
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFPro.ttf",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def create_pin(image_data, source_path, output_path):
    """Create a single Pinterest pin image."""
    try:
        img = Image.open(source_path)
    except Exception as e:
        print(f"  ERROR loading {source_path}: {e}")
        return False

    # Create canvas
    canvas = Image.new("RGB", (PIN_WIDTH, PIN_HEIGHT), BG_COLOR)

    # Scale and crop photo to fit top portion
    img_ratio = img.width / img.height
    target_ratio = PIN_WIDTH / PHOTO_HEIGHT

    if img_ratio > target_ratio:
        # Image is wider - scale by height, crop width
        new_height = PHOTO_HEIGHT
        new_width = int(new_height * img_ratio)
        img_resized = img.resize((new_width, new_height), Image.LANCZOS)
        left = (new_width - PIN_WIDTH) // 2
        img_cropped = img_resized.crop((left, 0, left + PIN_WIDTH, PHOTO_HEIGHT))
    else:
        # Image is taller - scale by width, crop height
        new_width = PIN_WIDTH
        new_height = int(new_width / img_ratio)
        img_resized = img.resize((new_width, new_height), Image.LANCZOS)
        top = (new_height - PHOTO_HEIGHT) // 2
        img_cropped = img_resized.crop((0, top, PIN_WIDTH, top + PHOTO_HEIGHT))

    canvas.paste(img_cropped, (0, 0))

    # Draw branded bottom section
    draw = ImageDraw.Draw(canvas)

    # Gold accent line
    draw.rectangle([(0, PHOTO_HEIGHT), (PIN_WIDTH, PHOTO_HEIGHT + 3)], fill=GOLD)

    # Brand text
    font_brand = try_load_font(36)
    font_title = try_load_font(24)
    font_url = try_load_font(18)

    # "ARCHIVE | 35" centered
    brand_text = "ARCHIVE  |  35"
    brand_bbox = draw.textbbox((0, 0), brand_text, font=font_brand)
    brand_w = brand_bbox[2] - brand_bbox[0]
    draw.text(((PIN_WIDTH - brand_w) // 2, PHOTO_HEIGHT + 40), brand_text, fill=GOLD, font=font_brand)

    # Image title
    title = image_data.get("title", "Untitled")
    if len(title) > 45:
        title = title[:42] + "..."
    title_bbox = draw.textbbox((0, 0), title, font=font_title)
    title_w = title_bbox[2] - title_bbox[0]
    draw.text(((PIN_WIDTH - title_w) // 2, PHOTO_HEIGHT + 100), title, fill=WHITE, font=font_title)

    # Location
    location = image_data.get("location", "")
    if location:
        if len(location) > 50:
            location = location[:47] + "..."
        loc_bbox = draw.textbbox((0, 0), location, font=font_url)
        loc_w = loc_bbox[2] - loc_bbox[0]
        draw.text(((PIN_WIDTH - loc_w) // 2, PHOTO_HEIGHT + 140), location, fill=LIGHT_GRAY, font=font_url)

    # URL
    url_text = "archive-35.com"
    url_bbox = draw.textbbox((0, 0), url_text, font=font_url)
    url_w = url_bbox[2] - url_bbox[0]
    draw.text(((PIN_WIDTH - url_w) // 2, PHOTO_HEIGHT + 200), url_text, fill=GOLD, font=font_url)

    # "C2PA Verified" badge
    badge_text = "C2PA Verified | NOT AI Generated"
    badge_bbox = draw.textbbox((0, 0), badge_text, font=font_url)
    badge_w = badge_bbox[2] - badge_bbox[0]
    draw.text(((PIN_WIDTH - badge_w) // 2, PIN_HEIGHT - 60), badge_text, fill=LIGHT_GRAY, font=font_url)

    # Save
    canvas.save(output_path, "JPEG", quality=90)
    return True


def main(count=50):
    """Generate Pinterest pins for the first N images."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load catalog
    catalog_path = DATA_DIR / "licensing-catalog.json"
    if not catalog_path.exists():
        print("ERROR: licensing-catalog.json not found")
        return

    with open(catalog_path) as f:
        catalog = json.load(f)

    images = catalog.get("images", [])[:count]
    print(f"[Pinterest] Generating {len(images)} pin images...")

    csv_rows = []
    generated = 0

    for i, img_data in enumerate(images):
        img_id = img_data.get("id", f"unknown_{i}")
        source = WATERMARKED_DIR / f"{img_id}.jpg"

        if not source.exists():
            print(f"  SKIP: {img_id} - source not found at {source}")
            continue

        output_file = OUTPUT_DIR / f"pin_{i+1:03d}.jpg"
        success = create_pin(img_data, source, output_file)

        if success:
            generated += 1
            board = get_board(img_data)
            description = generate_description(img_data)
            title = img_data.get("title", "Untitled")

            csv_rows.append({
                "image_path": str(output_file.relative_to(ROOT)),
                "pin_title": title,
                "pin_description": description,
                "destination_url": "https://www.etsy.com/shop/Archive35Photo",
                "board_name": board
            })
            if generated % 10 == 0:
                print(f"  Generated {generated} pins...")

    # Write CSV
    if csv_rows:
        with open(CSV_OUTPUT, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["image_path", "pin_title", "pin_description", "destination_url", "board_name"])
            writer.writeheader()
            writer.writerows(csv_rows)

    print(f"\n[Pinterest] Done: {generated} pins generated")
    print(f"  Pins: {OUTPUT_DIR}")
    print(f"  CSV:  {CSV_OUTPUT}")


if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    main(count)
