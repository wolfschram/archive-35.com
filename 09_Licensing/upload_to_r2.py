#!/usr/bin/env python3
"""
upload_to_r2.py — Upload originals, previews, and thumbnails to Cloudflare R2.

Usage:
    python upload_to_r2.py [--folder /path/to/09_Licensing]

SECURITY: Originals are stored PRIVATE (no public URL).
Previews and thumbnails can be public for gallery display.
Original file access requires a presigned URL generated after Stripe payment.

NOTE: Requires R2 credentials in _config.json. This script will skip
      uploads if credentials are placeholder values.
"""

import json
import os
import sys
from pathlib import Path

try:
    import boto3
    from botocore.config import Config
except ImportError:
    boto3 = None


def load_config(base):
    with open(base / "_config.json") as f:
        return json.load(f)


def get_s3_client(r2_cfg):
    """Create an S3-compatible client for Cloudflare R2."""
    if boto3 is None:
        return None

    return boto3.client(
        "s3",
        endpoint_url=r2_cfg["endpoint_url"],
        aws_access_key_id=r2_cfg["access_key_id"],
        aws_secret_access_key=r2_cfg["secret_access_key"],
        config=Config(signature_version="s3v4"),
    )


def upload_file(s3, bucket, local_path, r2_key, content_type="image/jpeg"):
    """Upload a single file to R2."""
    s3.upload_file(
        str(local_path),
        bucket,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )


def upload_to_r2(base_path):
    base = Path(base_path)
    cfg = load_config(base)
    r2_cfg = cfg["r2"]

    # Check for placeholder credentials
    if "<" in r2_cfg["access_key_id"] or "<" in r2_cfg["endpoint_url"]:
        print("⚠ R2 credentials not configured yet (placeholder values in _config.json)")
        print("  Skipping upload. Configure R2 credentials and re-run.")
        print("  Files are ready locally in originals/, watermarked/, thumbnails/")
        return

    if boto3 is None:
        print("⚠ boto3 not installed. Run: pip install boto3")
        print("  Skipping upload. Install boto3 and re-run.")
        return

    s3 = get_s3_client(r2_cfg)
    bucket = r2_cfg["bucket"]
    metadata_dir = base / "metadata"

    meta_files = sorted(metadata_dir.glob("A35-*.json"))
    uploaded = 0
    errors = 0

    for mf in meta_files:
        with open(mf) as f:
            meta = json.load(f)

        catalog_id = meta["catalog_id"]
        keys = meta["r2_keys"]

        files_to_upload = [
            (base / "originals" / meta["original_filename"], keys["original"]),
            (base / "watermarked" / f"{catalog_id}.jpg", keys["preview"]),
            (base / "thumbnails" / f"{catalog_id}.jpg", keys["thumbnail"]),
        ]

        for local_path, r2_key in files_to_upload:
            if not local_path.exists():
                continue
            try:
                # Determine content type
                ext = local_path.suffix.lower()
                ct = {
                    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".png": "image/png", ".tif": "image/tiff",
                    ".tiff": "image/tiff", ".webp": "image/webp",
                }.get(ext, "application/octet-stream")

                upload_file(s3, bucket, local_path, r2_key, ct)
                print(f"  ✓ {r2_key}")
                uploaded += 1
            except Exception as e:
                print(f"  ERROR {r2_key}: {e}")
                errors += 1

    print(f"\n✓ R2 upload: {uploaded} files uploaded, {errors} errors")


def generate_presigned_url(base_path, catalog_id):
    """Generate a presigned URL for an original file (called after Stripe payment)."""
    base = Path(base_path)
    cfg = load_config(base)
    r2_cfg = cfg["r2"]

    if "<" in r2_cfg["access_key_id"]:
        return None

    s3 = get_s3_client(r2_cfg)

    # Load metadata to get R2 key
    meta_file = base / "metadata" / f"{catalog_id}.json"
    with open(meta_file) as f:
        meta = json.load(f)

    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": r2_cfg["bucket"], "Key": meta["r2_keys"]["original"]},
        ExpiresIn=r2_cfg["presigned_expiry_seconds"],
    )
    return url


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    print(f"Uploading to R2 ...")
    upload_to_r2(folder)
