#!/usr/bin/env python3
"""
Archive 35 — Caption Generator
Generates caption drafts from image metadata.

Status: PLACEHOLDER — Not yet implemented
"""

import os
from pathlib import Path

import pandas as pd
import yaml
# from PIL import Image
# import exifread  # Uncomment when implementing


def load_config(config_path: str = "config.yaml") -> dict:
    """Load configuration from YAML file."""
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def extract_exif(image_path: str) -> dict:
    """Extract EXIF metadata from image."""
    # TODO: Implement EXIF extraction
    return {
        "camera": None,
        "lens": None,
        "focal_length": None,
        "aperture": None,
        "shutter_speed": None,
        "iso": None,
        "date_taken": None,
        "gps": None,
    }


def generate_caption_variants(metadata: dict, style: str = "contemplative") -> dict:
    """Generate short, medium, and long caption variants."""
    # TODO: Implement caption generation logic
    # Could integrate with Claude API for AI-assisted captions

    return {
        "short": "[Generated short caption placeholder]",
        "medium": "[Generated medium caption placeholder]",
        "long": "[Generated long caption placeholder]",
    }


def get_hashtags(collection: str, location: str) -> list:
    """Get relevant hashtags based on collection and location."""
    core = ["#archive35", "#fineartphotography", "#landscapephotography"]
    # TODO: Load from hashtag_sets.md and select based on content
    return core


def main():
    """Generate captions for images in queue."""
    print("Archive 35 Caption Generator")
    print("=" * 40)
    print("Status: PLACEHOLDER — Not yet implemented")
    print()
    print("To implement:")
    print("1. EXIF metadata extraction")
    print("2. Caption template system")
    print("3. Optional: Claude API integration for AI captions")
    print("4. Hashtag selection logic")


if __name__ == "__main__":
    main()
