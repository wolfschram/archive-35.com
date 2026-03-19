#!/usr/bin/env python3
"""
Embed IPTC/XMP rights metadata directly INTO JPEG files using exiftool.
No sidecar files — everything embedded in the image so agents and Google can read it.

Requires: exiftool (brew install exiftool)

Usage:
    python3 embed_iptc_metadata.py          # Process all images
    python3 embed_iptc_metadata.py 10       # Process first 10 per directory
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DIRECTORIES = [
    ROOT / "09_Licensing" / "watermarked",
    ROOT / "09_Licensing" / "micro",
    ROOT / "09_Licensing" / "thumbnails",
]

# Full metadata for licensing images
LICENSING_FIELDS = [
    "-IPTC:CopyrightNotice=© 2026 Wolf Schram / Archive-35. All rights reserved.",
    "-IPTC:Credit=Archive-35 / The Restless Eye",
    "-IPTC:Source=archive-35.com",
    "-IPTC:Contact=wolf@archive-35.com",
    "-IPTC:SpecialInstructions=C2PA verified authentic photography. NOT AI generated. License required for any use.",
    "-XMP:Creator=Wolf Schram",
    "-XMP:Rights=© 2026 Wolf Schram / Archive-35. All rights reserved.",
    "-XMP:WebStatement=https://archive-35.com/terms.html",
    "-XMP:UsageTerms=Licensed image. Purchase license at https://archive-35.com/micro-licensing.html",
    "-XMP:Marked=True",
]


def check_exiftool():
    try:
        r = subprocess.run(["exiftool", "-ver"], capture_output=True, text=True)
        print(f"exiftool version: {r.stdout.strip()}")
        return True
    except FileNotFoundError:
        print("ERROR: exiftool not found. Install with: brew install exiftool")
        return False


def embed_directory(directory, fields, limit=None):
    if not directory.exists():
        print(f"  Skipping {directory.name}/ (not found)")
        return 0

    jpgs = sorted(directory.glob("*.jpg"))
    if limit:
        jpgs = jpgs[:limit]

    if not jpgs:
        print(f"  Skipping {directory.name}/ (no JPEGs)")
        return 0

    cmd = ["exiftool", "-overwrite_original"] + fields + [str(j) for j in jpgs]
    r = subprocess.run(cmd, capture_output=True, text=True)

    # Parse count from exiftool output
    for line in r.stdout.splitlines():
        if "image files updated" in line:
            print(f"  {directory.name}/: {line.strip()}")
            return int(line.strip().split()[0])

    if r.returncode != 0:
        print(f"  {directory.name}/: ERROR — {r.stderr[:200]}")
    return 0


def delete_xmp_sidecars():
    """Delete orphan .xmp sidecar files — metadata is now in the JPEGs."""
    count = 0
    for d in DIRECTORIES:
        if not d.exists():
            continue
        for xmp in d.glob("*.xmp"):
            xmp.unlink()
            count += 1
    if count:
        print(f"Deleted {count} orphan .xmp sidecar files")


def main():
    if not check_exiftool():
        sys.exit(1)

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    total = 0

    print(f"\nEmbedding IPTC/XMP metadata into JPEGs{f' (limit: {limit} per dir)' if limit else ''}...")
    for d in DIRECTORIES:
        total += embed_directory(d, LICENSING_FIELDS, limit)

    delete_xmp_sidecars()
    print(f"\nTotal: {total} images updated")


if __name__ == "__main__":
    main()
