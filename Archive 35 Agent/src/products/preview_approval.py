"""Record human-reviewed Etsy previews and reject stale or undersized files."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


MIN_LISTING_DIMENSION = 2000


def approve_previews(package_dir: str | Path, filenames: list[str]) -> Path:
    """Write a hash-bound allowlist after the named previews were inspected."""
    package = Path(package_dir).resolve()
    preview_dir = package / "previews"
    if not filenames:
        raise ValueError("At least one reviewed preview is required")

    approved = []
    for filename in filenames:
        path = preview_dir / filename
        if not path.is_file() or path.suffix.lower() != ".jpg":
            raise ValueError(f"Invalid preview: {filename}")
        with Image.open(path) as image:
            width, height = image.size
        if min(width, height) < MIN_LISTING_DIMENSION:
            raise ValueError(f"Preview is below 2000 px: {filename}")
        approved.append({
            "filename": filename,
            "width": width,
            "height": height,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })

    destination = package / "preview-approval.json"
    destination.write_text(json.dumps({
        "schema_version": 1,
        "review_status": "approved",
        "previews": approved,
    }, indent=2) + "\n")
    return destination


def load_approved_previews(package_dir: str | Path) -> list[str]:
    """Resolve previews only when every approved file still matches its hash."""
    package = Path(package_dir).resolve()
    approval = json.loads((package / "preview-approval.json").read_text())
    if approval.get("review_status") != "approved":
        raise ValueError("Preview approval is not active")

    paths = []
    for item in approval.get("previews", []):
        path = package / "previews" / item["filename"]
        if not path.is_file():
            raise ValueError(f"Approved preview is missing: {path.name}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != item["sha256"]:
            raise ValueError(f"Approved preview changed after review: {path.name}")
        paths.append(str(path))
    if not paths:
        raise ValueError("Preview approval contains no files")
    return paths
