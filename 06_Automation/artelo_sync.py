#!/usr/bin/env python3
"""
Archive-35 Artelo Sync
Uploads photos to Artelo and creates product listings via API.
"""
import os
import json
import requests
from pathlib import Path

# Configuration
BASE_DIR = Path("/Users/wolfgangschram/My Drive (wolf@schramfamily.com)/My Drive/Archive-35.com")
PORTFOLIO_DIR = BASE_DIR / "01_Portfolio"
ENV_FILE = BASE_DIR / "05_Business/.env"

# Load API key
def load_api_key():
    with open(ENV_FILE) as f:
        for line in f:
            if line.startswith("ARTELO_API_KEY="):
                return line.strip().split("=", 1)[1]
    raise ValueError("ARTELO_API_KEY not found in .env")

API_KEY = None  # Loaded at runtime
ARTELO_BASE_URL = "https://api.artelo.io/v1"  # Verify actual endpoint

def get_headers():
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

def upload_image(image_path):
    """Upload an image to Artelo and return the image ID."""
    url = f"{ARTELO_BASE_URL}/images"

    with open(image_path, "rb") as f:
        files = {"file": f}
        headers = {"Authorization": f"Bearer {API_KEY}"}
        response = requests.post(url, headers=headers, files=files)

    if response.status_code == 200:
        return response.json().get("id")
    else:
        print(f"Upload failed for {image_path}: {response.text}")
        return None

def create_product(image_id, photo_data):
    """Create a product listing on Artelo."""
    url = f"{ARTELO_BASE_URL}/products"

    payload = {
        "image_id": image_id,
        "title": photo_data.get("title", "Untitled"),
        "description": photo_data.get("analysis", {}).get("description", ""),
        "tags": photo_data.get("analysis", {}).get("tags", []),
        "product_type": "art_print",
        "sizes": ["8x10", "12x18", "16x24", "24x36"],  # Configure as needed
        "paper_type": "fine_art",
        "frame_options": ["unframed", "black", "white", "natural"]
    }

    response = requests.post(url, headers=get_headers(), json=payload)

    if response.status_code == 200:
        return response.json().get("product_url")
    else:
        print(f"Product creation failed: {response.text}")
        return None

def sync_gallery(gallery_name):
    """Sync all photos in a gallery to Artelo."""
    global API_KEY
    API_KEY = load_api_key()

    gallery_dir = PORTFOLIO_DIR / gallery_name
    photos_file = gallery_dir / "_photos.json"
    originals_dir = gallery_dir / "originals"

    if not photos_file.exists():
        print(f"No _photos.json found in {gallery_name}")
        return

    with open(photos_file) as f:
        data = json.load(f)

    photos = data.get("photos", [])
    updated = False

    for photo in photos:
        # Skip if already synced
        if photo.get("artelo_url"):
            print(f"Skipping {photo['filename']} - already synced")
            continue

        image_path = originals_dir / photo["filename"]
        if not image_path.exists():
            print(f"Image not found: {image_path}")
            continue

        print(f"Uploading {photo['filename']}...")
        image_id = upload_image(image_path)

        if image_id:
            print(f"Creating product listing...")
            product_url = create_product(image_id, photo)

            if product_url:
                photo["artelo_url"] = product_url
                photo["artelo_synced"] = True
                updated = True
                print(f"✓ {photo['filename']} → {product_url}")

    if updated:
        with open(photos_file, "w") as f:
            json.dump(data, f, indent=2)
        print(f"\n_photos.json updated with Artelo URLs")

def show_status(gallery_name):
    """Show sync status for a gallery."""
    gallery_dir = PORTFOLIO_DIR / gallery_name
    photos_file = gallery_dir / "_photos.json"

    if not photos_file.exists():
        print(f"No _photos.json found")
        return

    with open(photos_file) as f:
        data = json.load(f)

    photos = data.get("photos", [])
    synced = sum(1 for p in photos if p.get("artelo_synced"))

    print(f"\nArtelo Sync Status: {gallery_name}")
    print(f"{'='*50}")
    print(f"Total photos: {len(photos)}")
    print(f"Synced to Artelo: {synced}")
    print(f"Pending: {len(photos) - synced}")
    print()

    for photo in photos:
        status = "✓" if photo.get("artelo_synced") else "○"
        print(f"  {status} {photo['filename']}")

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python artelo_sync.py <gallery_name> [--status]")
        print("Example: python artelo_sync.py Grand_Teton")
        sys.exit(1)

    gallery = sys.argv[1]

    if "--status" in sys.argv:
        show_status(gallery)
    else:
        sync_gallery(gallery)
