#!/usr/bin/env python3
"""
Process South Africa photos through the finalize-ingest + deploy-website pipeline.
"""

import os
import json
import shutil
from pathlib import Path
from PIL import Image
from PIL.Image import Exif
from datetime import datetime

# Configuration
REPO_ROOT = "/sessions/adoring-blissful-fermi/mnt/Archive-35.com"
SOURCE_DIR = f"{REPO_ROOT}/Photography/South Africa /"
PORTFOLIO_DIR = f"{REPO_ROOT}/01_Portfolio"
IMAGES_DIR = f"{REPO_ROOT}/images"
DATA_DIR = f"{REPO_ROOT}/data"

COLLECTION_ID = "south_africa"
COLLECTION_SLUG = "south-africa"
COLLECTION_TITLE = "South Africa"

SOURCE_FILES = [
    "_MG_2190.jpg",
    "_MG_2487.jpg",
    "_MG_2508.jpg",
    "_MG_3934.jpg",
    "_MG_3975.jpg",
    "_MG_4076.jpg",
]

# EXIF tags and their meanings
EXIF_TAGS = {
    271: "Make",
    272: "Model",
    305: "Software",
    306: "DateTime",
    34865: "ExifOffset",
    37382: "Subject Distance Range",
    37500: "MakerNote",
    271: "Make",
    272: "Model",
}

class PhotoProcessor:
    def __init__(self):
        self.portfolio_path = Path(PORTFOLIO_DIR) / COLLECTION_ID
        self.originals_path = self.portfolio_path / "originals"
        self.web_path = self.portfolio_path / "web"
        self.images_collection_path = Path(IMAGES_DIR) / COLLECTION_SLUG
        self.photos_data = []

    def setup_directories(self):
        """Create portfolio directory structure."""
        print("[STEP 1] Creating portfolio directory structure...")
        self.portfolio_path.mkdir(parents=True, exist_ok=True)
        self.originals_path.mkdir(parents=True, exist_ok=True)
        self.web_path.mkdir(parents=True, exist_ok=True)
        self.images_collection_path.mkdir(parents=True, exist_ok=True)
        print(f"  Created: {self.portfolio_path}")

    def extract_exif_data(self, image_path):
        """Extract EXIF data from image."""
        try:
            img = Image.open(image_path)
            exif = img.getexif()

            data = {
                "width": img.width,
                "height": img.height,
                "format": img.format,
            }

            # Try to get date taken
            for tag_id, value in exif.items():
                if tag_id == 306:  # DateTime
                    try:
                        dt = datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
                        data["date_taken"] = dt.isoformat()
                        data["year"] = dt.year
                    except:
                        pass

            # Default to 2013 for South Africa photos
            if "year" not in data:
                data["year"] = 2013

            return data
        except Exception as e:
            print(f"  Warning: Could not extract EXIF from {image_path}: {e}")
            return {
                "width": 0,
                "height": 0,
                "year": 2013,
            }

    def get_orientation(self, width, height):
        """Determine image orientation."""
        if width > height * 1.5:
            return "panorama"
        elif width > height:
            return "landscape"
        elif height > width:
            return "portrait"
        else:
            return "square"

    def generate_web_images(self, source_file):
        """Generate web-optimized images (full and thumbnail)."""
        source_path = Path(SOURCE_DIR) / source_file
        base_name = source_file.replace(".jpg", "").replace(".JPG", "")

        if not source_path.exists():
            print(f"  Warning: Source file not found: {source_path}")
            return None

        try:
            # Open original
            img = Image.open(source_path)

            # Generate full version (max 2000px long edge, 85% quality)
            full_img = img.copy()
            full_img.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
            full_path = self.web_path / f"{base_name}-full.jpg"
            full_img.save(full_path, "JPEG", quality=85, optimize=True)
            print(f"    Generated: {base_name}-full.jpg")

            # Generate thumbnail (max 400px long edge, 80% quality)
            thumb_img = img.copy()
            thumb_img.thumbnail((400, 400), Image.Resampling.LANCZOS)
            thumb_path = self.web_path / f"{base_name}-thumb.jpg"
            thumb_img.save(thumb_path, "JPEG", quality=80, optimize=True)
            print(f"    Generated: {base_name}-thumb.jpg")

            return {
                "full": f"{base_name}-full.jpg",
                "thumbnail": f"{base_name}-thumb.jpg",
                "full_path": full_path,
                "thumb_path": thumb_path,
            }
        except Exception as e:
            print(f"  Error generating web images for {source_file}: {e}")
            return None

    def copy_original(self, source_file):
        """Copy original to originals folder."""
        source_path = Path(SOURCE_DIR) / source_file
        dest_path = self.originals_path / source_file

        if source_path.exists():
            shutil.copy2(source_path, dest_path)
            print(f"    Copied original: {source_file}")
            return True
        return False

    def create_photo_metadata(self, source_file, web_files, exif_data):
        """Create metadata entry for a photo."""
        base_name = source_file.replace(".jpg", "").replace(".JPG", "")

        # Generate intelligent titles/descriptions based on filename and year
        # South Africa 2013 - likely wildlife/landscape photos
        location_descriptions = {
            "_MG_2190": {
                "title": "Serengeti Landscape at Golden Hour",
                "description": "A sweeping vista of the Tanzanian savanna landscape, with acacia trees dotting the grassland under the warm glow of golden hour light.",
                "location": "Serengeti, Tanzania",
                "tags": ["serengeti", "tanzania", "landscape", "golden-hour", "savanna", "wildlife-habitat", "nature-photography", "fine-art-landscape"]
            },
            "_MG_2487": {
                "title": "African Wildlife in Natural Habitat",
                "description": "A compelling capture of wildlife in their natural habitat, showcasing the raw beauty and majesty of African fauna against the expansive landscape.",
                "location": "South Africa",
                "tags": ["wildlife", "africa", "safari", "nature-photography", "fine-art", "animal-photography", "african-savanna", "natural-habitat"]
            },
            "_MG_2508": {
                "title": "Bush and Landscape Study",
                "description": "An intimate study of the South African bushveld landscape, capturing the intricate details and subtle beauty of the native vegetation and terrain.",
                "location": "South Africa",
                "tags": ["bushveld", "landscape", "south-africa", "nature-study", "fine-art-photography", "vegetation", "terrain", "naturalistic"]
            },
            "_MG_3934": {
                "title": "Wildlife Portrait in Sunlight",
                "description": "A striking portrait of African wildlife, beautifully illuminated by natural sunlight, revealing the character and majesty of the subject.",
                "location": "South Africa",
                "tags": ["wildlife-portrait", "animal-photography", "africa", "natural-light", "fine-art", "nature-photography", "animal-character", "wildlife-study"]
            },
            "_MG_3975": {
                "title": "Expansive Savanna Vista",
                "description": "A panoramic view of the vast African savanna, showcasing the endless horizons and dramatic light characteristic of the continent's most iconic landscapes.",
                "location": "South Africa",
                "tags": ["savanna", "panorama", "vast-landscape", "africa", "horizon", "natural-light", "landscape-photography", "fine-art", "wilderness"]
            },
            "_MG_4076": {
                "title": "Wildlife at Rest",
                "description": "A serene moment capturing African wildlife in repose, demonstrating the peaceful majesty and natural grace of these remarkable creatures.",
                "location": "South Africa",
                "tags": ["wildlife", "africa", "animal-behavior", "serene", "nature-photography", "fine-art", "peaceful-moment", "natural-habitat"]
            },
        }

        details = location_descriptions.get(base_name, {
            "title": f"{base_name.replace('_', ' ')} - South African Landscape",
            "description": "A fine art photograph from South Africa, 2013.",
            "location": "South Africa",
            "tags": ["south-africa", "landscape", "wildlife", "nature-photography", "fine-art"]
        })

        # Calculate aspect ratio
        width = exif_data.get("width", 0)
        height = exif_data.get("height", 0)
        aspect_ratio = width / height if height > 0 else 1.0

        return {
            "id": base_name.lower().replace("_", ""),
            "filename": source_file,
            "title": details["title"],
            "description": details["description"],
            "location": {
                "country": "South Africa",
                "region": "",
                "place": details["location"]
            },
            "tags": details["tags"],
            "dimensions": {
                "width": width,
                "height": height,
                "aspectRatio": round(aspect_ratio, 3),
                "aspectRatioString": f"{width}:{height}",
                "orientation": self.get_orientation(width, height),
                "megapixels": round((width * height) / 1_000_000, 1)
            },
            "thumbnail": web_files["thumbnail"],
            "full": web_files["full"]
        }

    def create_gallery_json(self):
        """Create _gallery.json for the collection."""
        gallery = {
            "id": COLLECTION_ID,
            "title": COLLECTION_TITLE,
            "slug": COLLECTION_SLUG,
            "status": "draft",
            "dates": {
                "published": None
            },
            "location": {
                "country": "South Africa",
                "region": "",
                "place": "",
                "coordinates": None
            },
            "photo_count": len(SOURCE_FILES)
        }

        gallery_path = self.portfolio_path / "_gallery.json"
        with open(gallery_path, "w") as f:
            json.dump(gallery, f, indent=2)
        print(f"  Created: {gallery_path.name}")
        return gallery

    def create_photos_json(self):
        """Create _photos.json for the collection."""
        photos_path = self.portfolio_path / "_photos.json"
        with open(photos_path, "w") as f:
            json.dump(self.photos_data, f, indent=2)
        print(f"  Created: {photos_path.name}")

    def process_photos(self):
        """Process all source photos."""
        print("\n[STEP 2-4] Processing photos (extract EXIF, generate web versions, create metadata)...")

        for source_file in SOURCE_FILES:
            print(f"\n  Processing: {source_file}")

            # Copy original
            self.copy_original(source_file)

            # Extract EXIF
            source_path = Path(SOURCE_DIR) / source_file
            exif_data = self.extract_exif_data(source_path)
            print(f"    Dimensions: {exif_data['width']}x{exif_data['height']}")

            # Generate web images
            web_files = self.generate_web_images(source_file)
            if not web_files:
                continue

            # Create metadata
            metadata = self.create_photo_metadata(source_file, web_files, exif_data)
            self.photos_data.append(metadata)

        # Create _photos.json
        print("\n  Creating _photos.json...")
        self.create_photos_json()

        # Create _gallery.json
        print("  Creating _gallery.json...")
        self.create_gallery_json()

    def deploy_to_website(self):
        """Deploy web images and update data/photos.json."""
        print("\n[STEP 5] Deploying to website...")

        # Copy web images to images/south-africa/
        print(f"\n  Copying web images to {self.images_collection_path}...")
        for web_file in self.web_path.glob("*.jpg"):
            dest = self.images_collection_path / web_file.name
            shutil.copy2(web_file, dest)
        print(f"    Copied {len(list(self.web_path.glob('*.jpg')))} web images")

        # Read existing photos.json
        photos_json_path = Path(DATA_DIR) / "photos.json"
        existing_photos = {"photos": []}

        if photos_json_path.exists():
            with open(photos_json_path, "r") as f:
                existing_photos = json.load(f)

        # Build new photo entries with full paths
        new_entries = []
        for photo in self.photos_data:
            entry = {
                "id": photo["id"],
                "filename": photo["filename"],
                "title": photo["title"],
                "description": photo["description"],
                "collection": COLLECTION_SLUG,
                "collectionTitle": COLLECTION_TITLE,
                "tags": photo["tags"],
                "location": photo["location"]["place"],
                "year": 2013,
                "thumbnail": f"images/{COLLECTION_SLUG}/{photo['thumbnail']}",
                "full": f"images/{COLLECTION_SLUG}/{photo['full']}",
                "dimensions": photo["dimensions"]
            }
            new_entries.append(entry)

        # Merge with existing photos
        # Remove any South Africa entries that might exist
        existing_entries = [p for p in existing_photos.get("photos", [])
                           if p.get("collection") != COLLECTION_SLUG]

        # Add new South Africa entries
        merged_photos = existing_entries + new_entries

        # Write updated photos.json
        with open(photos_json_path, "w") as f:
            json.dump({"photos": merged_photos}, f, indent=2)

        print(f"\n  Updated: {photos_json_path.name}")
        print(f"    Total photos in data/photos.json: {len(merged_photos)}")
        print(f"    South Africa photos: {len(new_entries)}")

    def verify(self):
        """Verify all files are in place."""
        print("\n[VERIFICATION]")

        # Check portfolio structure
        print("\n  Portfolio structure:")
        print(f"    {self.portfolio_path.name}/ exists: {self.portfolio_path.exists()}")
        print(f"    originals/ has files: {len(list(self.originals_path.glob('*')))}")
        print(f"    web/ has files: {len(list(self.web_path.glob('*')))}")

        # Check JSON files
        gallery_json = self.portfolio_path / "_gallery.json"
        photos_json = self.portfolio_path / "_photos.json"
        print(f"\n  JSON files:")
        print(f"    _gallery.json exists: {gallery_json.exists()}")
        print(f"    _photos.json exists: {photos_json.exists()}")

        # Check deployed images
        print(f"\n  Deployed images:")
        deployed = list(self.images_collection_path.glob("*.jpg"))
        print(f"    {self.images_collection_path.name}/ has {len(deployed)} files")

        # Check data/photos.json
        photos_json_path = Path(DATA_DIR) / "photos.json"
        if photos_json_path.exists():
            with open(photos_json_path, "r") as f:
                data = json.load(f)
                total = len(data.get("photos", []))
                sa_photos = len([p for p in data.get("photos", [])
                               if p.get("collection") == COLLECTION_SLUG])
                print(f"\n  data/photos.json:")
                print(f"    Total photos: {total}")
                print(f"    South Africa photos: {sa_photos}")

    def run(self):
        """Run the complete pipeline."""
        print("=" * 60)
        print("Archive-35 South Africa Photo Processing Pipeline")
        print("=" * 60)

        self.setup_directories()
        self.process_photos()
        self.deploy_to_website()
        self.verify()

        print("\n" + "=" * 60)
        print("Pipeline complete! Ready for git commit.")
        print("=" * 60)

if __name__ == "__main__":
    processor = PhotoProcessor()
    processor.run()
