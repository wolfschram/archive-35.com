"""Upload files to Cloudflare R2 for public URL access.

Instagram and Pinterest APIs require publicly accessible image URLs.
This module uploads mockup images to the R2 bucket and returns
a public URL that can be used in social media API calls.

R2 credentials are read from root .env (shared with Studio).
"""

import logging
import os
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig

logger = logging.getLogger(__name__)

# R2 config — read from environment (root .env via getAgentConfig IPC fallback)
_R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
_R2_ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID", "")
_R2_SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
_R2_BUCKET = os.getenv("R2_SOCIAL_BUCKET", "archive-35-social")
_R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")

# Public domain for R2 — the social bucket's public dev URL
# Enabled in Cloudflare dashboard: R2 > archive-35-social > Settings > Public Development URL
_R2_PUBLIC_DOMAIN = os.getenv(
    "R2_SOCIAL_PUBLIC_URL",
    "https://pub-e234c9959bf14a75a4d5b3f04dd1ff4c.r2.dev"
)


def _get_s3_client():
    """Create boto3 S3 client configured for Cloudflare R2."""
    if not _R2_ACCESS_KEY or not _R2_SECRET_KEY:
        raise RuntimeError(
            "R2 credentials not configured. "
            "Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env"
        )

    endpoint = _R2_ENDPOINT or f"https://{_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=_R2_ACCESS_KEY,
        aws_secret_access_key=_R2_SECRET_KEY,
        config=BotoConfig(
            signature_version="s3v4",
            retries={"max_attempts": 2, "mode": "standard"},
        ),
        region_name="auto",
    )


def upload_to_r2(local_path: str, r2_key: str) -> str:
    """Upload a file to R2 and return its public URL.

    Args:
        local_path: Absolute path to the local file.
        r2_key: Object key in R2 (e.g. 'mockups/my-image.jpg').

    Returns:
        Public URL string for the uploaded file.

    Raises:
        FileNotFoundError: If local_path doesn't exist.
        RuntimeError: If R2 credentials aren't configured.
    """
    filepath = Path(local_path)
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {local_path}")

    # Determine content type
    ext = filepath.suffix.lower()
    content_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    content_type = content_types.get(ext, "application/octet-stream")

    client = _get_s3_client()

    logger.info("Uploading %s → r2://%s/%s", filepath.name, _R2_BUCKET, r2_key)

    client.upload_file(
        str(filepath),
        _R2_BUCKET,
        r2_key,
        ExtraArgs={
            "ContentType": content_type,
            "CacheControl": "public, max-age=86400",  # 24h cache
        },
    )

    public_url = f"{_R2_PUBLIC_DOMAIN.rstrip('/')}/{r2_key}"
    logger.info("Uploaded: %s", public_url)
    return public_url


def delete_from_r2(r2_key: str) -> bool:
    """Delete a file from R2.

    Args:
        r2_key: Object key to delete.

    Returns:
        True if deleted, False on error.
    """
    try:
        client = _get_s3_client()
        client.delete_object(Bucket=_R2_BUCKET, Key=r2_key)
        logger.info("Deleted from R2: %s", r2_key)
        return True
    except Exception as e:
        logger.error("Failed to delete %s from R2: %s", r2_key, e)
        return False
