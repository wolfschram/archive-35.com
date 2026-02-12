#!/usr/bin/env python3
"""
upload_to_r2.py — Upload originals, previews, and thumbnails to Cloudflare R2.

Usage:
    python upload_to_r2.py [--folder /path/to/09_Licensing]
    python upload_to_r2.py --verify-only          # check backup status without uploading

SECURITY: Originals are stored PRIVATE (no public URL).
Previews and thumbnails can be public for gallery display.
Original file access requires a presigned URL generated after Stripe payment.

SAFETY:
  - Originals MUST exist locally before upload (hard fail if missing)
  - Every upload is verified with a HEAD request
  - Backup status (r2_backup_verified + timestamp) is written to metadata JSON
  - Use --verify-only to audit which originals are/aren't backed up

NOTE: Requires R2 credentials in _config.json and boto3 installed.
"""

import json
import os
import sys
from datetime import datetime, timezone
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


def resolve_original_path(base, meta):
    """
    Find the original file using metadata.
    Priority:
      1. source_path + original_filename (external folder, e.g. ../Photography/...)
      2. base / originals / original_filename (local originals/ folder)
    Returns Path or None.
    """
    filename = meta["original_filename"]

    # Try source_path from metadata first (where scan found the file)
    source = meta.get("source_path", "")
    if source:
        source_dir = Path(source)
        # Handle relative paths (relative to base / 09_Licensing)
        if not source_dir.is_absolute():
            source_dir = (base / source_dir).resolve()
        candidate = source_dir / filename
        if candidate.exists():
            return candidate

    # Fallback: local originals/ folder
    candidate = base / "originals" / filename
    if candidate.exists():
        return candidate

    return None


def verify_r2_object(s3, bucket, r2_key, expected_size=None):
    """
    Verify an object exists on R2 via HEAD request.
    Optionally checks file size matches.
    Returns True if verified, False otherwise.
    """
    try:
        resp = s3.head_object(Bucket=bucket, Key=r2_key)
        if expected_size and resp.get("ContentLength") != expected_size:
            return False
        return True
    except Exception:
        return False


def upload_file(s3, bucket, local_path, r2_key, content_type="image/jpeg"):
    """Upload a single file to R2."""
    s3.upload_file(
        str(local_path),
        bucket,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )


def update_metadata_backup_status(meta_file, meta, r2_key, file_type):
    """Write backup verification status to metadata JSON."""
    if "r2_backup_status" not in meta:
        meta["r2_backup_status"] = {}

    meta["r2_backup_status"][file_type] = {
        "verified": True,
        "r2_key": r2_key,
        "backed_up_at": datetime.now(timezone.utc).isoformat(),
    }

    with open(meta_file, "w") as f:
        json.dump(meta, f, indent=2, default=str)


def get_content_type(path):
    """Determine content type from file extension."""
    ext = Path(path).suffix.lower()
    return {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".tif": "image/tiff",
        ".tiff": "image/tiff", ".webp": "image/webp",
    }.get(ext, "application/octet-stream")


# ─── VERIFY-ONLY MODE ─────────────────────────────────────────────
def verify_only(base_path):
    """
    Audit which originals are backed up to R2.
    Checks: local file exists + r2_backup_status in metadata.
    Does NOT upload anything.
    """
    base = Path(base_path)
    metadata_dir = base / "metadata"
    meta_files = sorted(metadata_dir.glob("A35-*.json"))

    backed_up = []
    missing_local = []
    not_backed_up = []

    for mf in meta_files:
        with open(mf) as f:
            meta = json.load(f)

        catalog_id = meta["catalog_id"]
        filename = meta["original_filename"]

        # Check local
        local = resolve_original_path(base, meta)
        if not local:
            missing_local.append((catalog_id, filename, meta.get("source_path", "?")))
            continue

        # Check backup status
        backup = meta.get("r2_backup_status", {}).get("original", {})
        if backup.get("verified"):
            backed_up.append((catalog_id, filename, backup["backed_up_at"]))
        else:
            not_backed_up.append((catalog_id, filename, str(local)))

    # Report
    print(f"\n{'='*60}")
    print(f"  R2 BACKUP STATUS — {len(meta_files)} licensing images")
    print(f"{'='*60}")

    if backed_up:
        print(f"\n  ✅ BACKED UP ({len(backed_up)}):")
        for cid, fn, dt in backed_up:
            print(f"     {cid}  {fn}  (backed up {dt[:10]})")

    if not_backed_up:
        print(f"\n  ⚠️  NOT YET BACKED UP ({len(not_backed_up)}):")
        for cid, fn, path in not_backed_up:
            print(f"     {cid}  {fn}")
            print(f"            local: {path}")

    if missing_local:
        print(f"\n  ❌ LOCAL FILE MISSING ({len(missing_local)}):")
        for cid, fn, src in missing_local:
            print(f"     {cid}  {fn}")
            print(f"            expected in: {src}")

    print(f"\n{'='*60}")
    print(f"  Summary: {len(backed_up)} backed up, {len(not_backed_up)} pending, {len(missing_local)} missing locally")
    print(f"{'='*60}\n")

    return len(missing_local) == 0 and len(not_backed_up) == 0


# ─── MAIN UPLOAD ──────────────────────────────────────────────────
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
    verified = 0
    errors = 0
    skipped_already_backed = 0
    originals_missing = []

    print(f"\n📦 R2 Upload — {len(meta_files)} images to process\n")

    for mf in meta_files:
        with open(mf) as f:
            meta = json.load(f)

        catalog_id = meta["catalog_id"]
        keys = meta["r2_keys"]

        # ── ORIGINAL: resolve path from source_path ──
        original_path = resolve_original_path(base, meta)

        if not original_path:
            # HARD FAIL for originals — these are irreplaceable
            originals_missing.append((catalog_id, meta["original_filename"], meta.get("source_path", "?")))
            print(f"  ❌ {catalog_id}: ORIGINAL NOT FOUND locally — {meta['original_filename']}")
            print(f"     Expected in: {meta.get('source_path', 'originals/')}")
            errors += 1
            continue

        # Check if original already verified on R2
        existing_backup = meta.get("r2_backup_status", {}).get("original", {})
        if existing_backup.get("verified"):
            skipped_already_backed += 1
        else:
            # Upload original
            try:
                ct = get_content_type(original_path)
                upload_file(s3, bucket, original_path, keys["original"], ct)

                # VERIFY upload succeeded
                local_size = original_path.stat().st_size
                if verify_r2_object(s3, bucket, keys["original"], local_size):
                    update_metadata_backup_status(mf, meta, keys["original"], "original")
                    print(f"  ✅ {catalog_id}: original uploaded + verified ({meta.get('file_size_mb', '?')}MB)")
                    uploaded += 1
                    verified += 1
                else:
                    print(f"  ⚠️  {catalog_id}: uploaded but verification FAILED — size mismatch!")
                    errors += 1
            except Exception as e:
                print(f"  ❌ {catalog_id}: upload ERROR — {e}")
                errors += 1

        # ── PREVIEW + THUMBNAIL: these are regenerated, not irreplaceable ──
        secondary_files = [
            (base / "watermarked" / f"{catalog_id}.jpg", keys["preview"], "preview"),
            (base / "thumbnails" / f"{catalog_id}.jpg", keys["thumbnail"], "thumbnail"),
        ]

        for local_path, r2_key, file_type in secondary_files:
            if not local_path.exists():
                continue
            try:
                upload_file(s3, bucket, local_path, r2_key, "image/jpeg")
                if verify_r2_object(s3, bucket, r2_key):
                    update_metadata_backup_status(mf, meta, r2_key, file_type)
                    print(f"  ✓ {catalog_id}: {file_type}")
                    uploaded += 1
                else:
                    print(f"  ⚠️  {catalog_id}: {file_type} uploaded but verify failed")
            except Exception as e:
                print(f"  ERROR {catalog_id} {file_type}: {e}")
                errors += 1

    # ── SUMMARY ──
    print(f"\n{'='*60}")
    print(f"  R2 UPLOAD COMPLETE")
    print(f"{'='*60}")
    print(f"  Uploaded:           {uploaded} files")
    print(f"  Verified:           {verified} originals")
    print(f"  Already backed up:  {skipped_already_backed} originals (skipped)")
    print(f"  Errors:             {errors}")

    if originals_missing:
        print(f"\n  ⛔ MISSING ORIGINALS ({len(originals_missing)}):")
        print(f"  These files were NOT found locally and could NOT be backed up:")
        for cid, fn, src in originals_missing:
            print(f"     {cid}  {fn}")
            print(f"            expected in: {src}")
        print(f"\n  ACTION: Ensure originals are on local storage, then re-run upload.")

    print(f"{'='*60}\n")


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
    import argparse
    parser = argparse.ArgumentParser(description="Upload licensing files to Cloudflare R2")
    parser.add_argument("--folder", default=os.path.dirname(os.path.abspath(__file__)),
                        help="Path to 09_Licensing directory")
    parser.add_argument("--verify-only", action="store_true",
                        help="Check backup status without uploading")
    args = parser.parse_args()

    if args.verify_only:
        print("🔍 Verify-only mode — checking R2 backup status...")
        all_good = verify_only(args.folder)
        sys.exit(0 if all_good else 1)
    else:
        print(f"Uploading to R2 ...")
        upload_to_r2(args.folder)
