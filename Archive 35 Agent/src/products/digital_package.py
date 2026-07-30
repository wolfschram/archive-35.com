"""Build Etsy-ready personal-use printable photography packages."""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image


RATIO_SPECS = {
    "2x3": 3 / 2,
    "3x4": 4 / 3,
    "4x5": 5 / 4,
    "11x14": 14 / 11,
    "iso": math.sqrt(2),
}
MAX_ETSY_FILE_BYTES = 20 * 1024 * 1024
LICENSE_URL = "https://archive-35.com/terms.html"
LICENSE_TERMS = (
    "Personal-use wall display only. No resale, redistribution, commercial use, "
    "or sublicensing. Copyright remains with Wolfgang Schram / Archive-35."
)


def _sha256(path: Path) -> str:
    """Return the source checksum recorded in the package manifest."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _crop_box(
    width: int,
    height: int,
    target_ratio: float,
    focal_point: tuple[float, float],
) -> tuple[int, int, int, int]:
    """Calculate the largest crop at a ratio, centered on a normalized focal point."""
    source_ratio = width / height
    if source_ratio > target_ratio:
        crop_height = height
        crop_width = round(height * target_ratio)
    else:
        crop_width = width
        crop_height = round(width / target_ratio)

    focus_x = min(max(focal_point[0], 0), 1) * width
    focus_y = min(max(focal_point[1], 0), 1) * height
    left = round(focus_x - crop_width / 2)
    top = round(focus_y - crop_height / 2)
    left = min(max(left, 0), width - crop_width)
    top = min(max(top, 0), height - crop_height)
    return left, top, left + crop_width, top + crop_height


def _save_under_limit(image: Image.Image, destination: Path) -> int:
    """Write a high-quality JPEG below Etsy's 20 MB per-file limit."""
    icc_profile = image.info.get("icc_profile")
    for quality in (95, 92, 89, 86, 82, 78):
        image.save(
            destination,
            "JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
            dpi=(300, 300),
            icc_profile=icc_profile,
        )
        if destination.stat().st_size <= MAX_ETSY_FILE_BYTES:
            return quality
    raise ValueError(f"Cannot fit {destination.name} below Etsy's 20 MB limit")


def _embed_rights_metadata(path: Path, title: str) -> None:
    """Embed copyright and personal-use terms directly in the JPEG."""
    exiftool = shutil.which("exiftool")
    if not exiftool:
        raise RuntimeError("exiftool is required to embed delivery metadata")
    command = [
        exiftool,
        "-overwrite_original",
        "-Artist=Wolfgang Schram",
        "-XMP-dc:Creator=Wolfgang Schram",
        "-Copyright=Copyright 2026 Wolfgang Schram. All rights reserved.",
        f"-Title={title}",
        f"-ObjectName={title}",
        f"-Description={title}. {LICENSE_TERMS}",
        f"-XMP-xmpRights:UsageTerms={LICENSE_TERMS}",
        f"-XMP-xmpRights:WebStatement={LICENSE_URL}",
        f"-XMP-photoshop:Instructions=C2PA notice: Authentic photography by "
        "Wolfgang Schram; this print derivative carries embedded rights metadata.",
        f"-IPTC:SpecialInstructions=License: {LICENSE_URL}. C2PA provenance "
        "is maintained by Archive-35.",
        "-Credit=Archive-35 / The Restless Eye",
        "-Source=archive-35.com",
        "-XMP-dc:Rights=Personal-use license; copyright retained by creator.",
        str(path),
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"exiftool failed for {path.name}: {result.stderr.strip()}")
    if path.stat().st_size > MAX_ETSY_FILE_BYTES:
        raise ValueError(f"Metadata pushed {path.name} above Etsy's 20 MB limit")


def build_digital_package(
    source: str | Path,
    output_root: str | Path,
    product_id: str,
    title: str,
    price_usd: float = 12.0,
    focal_point: tuple[float, float] = (0.5, 0.5),
) -> dict[str, Any]:
    """Generate five full-resolution ratio files and a verification manifest."""
    source_path = Path(source).resolve()
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    if not product_id.startswith("A35-DIG-"):
        raise ValueError("Digital product IDs must start with A35-DIG-")
    if price_usd <= 0:
        raise ValueError("Price must be positive")

    output_dir = Path(output_root).resolve() / product_id
    output_dir.mkdir(parents=True, exist_ok=True)
    existing = [path for path in output_dir.iterdir() if path.is_file()]
    if existing:
        raise FileExistsError(
            f"Output package is not empty: {output_dir}"
        )

    source_hash = _sha256(source_path)
    files = []
    with Image.open(source_path) as original:
        source_width, source_height = original.size
        image = original.convert("RGB")
        if original.info.get("icc_profile"):
            image.info["icc_profile"] = original.info["icc_profile"]
        for ratio_name, target_ratio in RATIO_SPECS.items():
            crop = image.crop(_crop_box(
                source_width,
                source_height,
                target_ratio,
                focal_point,
            ))
            filename = f"{product_id}_{ratio_name}.jpg"
            destination = output_dir / filename
            quality = _save_under_limit(crop, destination)
            _embed_rights_metadata(destination, title)
            files.append({
                "filename": filename,
                "ratio": ratio_name,
                "width": crop.width,
                "height": crop.height,
                "megapixels": round(crop.width * crop.height / 1_000_000, 1),
                "size_bytes": destination.stat().st_size,
                "jpeg_quality": quality,
                "sha256": _sha256(destination),
            })

    if len(files) != 5:
        raise RuntimeError("Etsy package must contain exactly five delivery files")

    manifest = {
        "schema_version": 1,
        "product_id": product_id,
        "sku": product_id,
        "title": title,
        "price_usd": round(float(price_usd), 2),
        "product_type": "etsy_instant_download",
        "physical_item": False,
        "source": {
            "filename": source_path.name,
            "width": source_width,
            "height": source_height,
            "sha256": source_hash,
        },
        "focal_point": {"x": focal_point[0], "y": focal_point[1]},
        "license": LICENSE_TERMS,
        "license_url": LICENSE_URL,
        "c2pa_notice": (
            "Authentic photography by Wolfgang Schram; C2PA provenance for "
            "the source is maintained by Archive-35."
        ),
        "delivery_files": files,
        "etsy_constraints": {
            "file_count": len(files),
            "max_file_bytes": MAX_ETSY_FILE_BYTES,
            "all_files_within_limit": all(
                item["size_bytes"] <= MAX_ETSY_FILE_BYTES for item in files
            ),
        },
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
