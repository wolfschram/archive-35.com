"""Build Etsy-ready three-photograph printable bundles."""

from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from PIL import Image

from src.products.digital_package import (
    LICENSE_TERMS,
    LICENSE_URL,
    MAX_ETSY_FILE_BYTES,
    RATIO_SPECS,
    _embed_rights_metadata,
    _sha256,
)


MAX_MEMBER_BYTES = 6 * 1024 * 1024
MAX_MEMBER_DIMENSION = 6000


def _package_manifest(package: Path) -> dict[str, Any]:
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(manifest_path)
    return json.loads(manifest_path.read_text())


def _ratio_source(package: Path, manifest: dict, ratio: str) -> Path:
    matching = [
        item for item in manifest["delivery_files"] if item["ratio"] == ratio
    ]
    if len(matching) != 1:
        raise ValueError(f"{package.name} must contain one {ratio} file")
    source = package / matching[0]["filename"]
    if not source.is_file() or _sha256(source) != matching[0]["sha256"]:
        raise ValueError(f"Source package verification failed: {source.name}")
    return source


def _save_bundle_member(
    source: Path,
    destination: Path,
    title: str,
) -> dict[str, Any]:
    """Create a metadata-bearing JPEG small enough for a three-file ZIP."""
    with Image.open(source) as original:
        image = original.convert("RGB")
        if original.info.get("icc_profile"):
            image.info["icc_profile"] = original.info["icc_profile"]
    if max(image.size) > MAX_MEMBER_DIMENSION:
        image.thumbnail(
            (MAX_MEMBER_DIMENSION, MAX_MEMBER_DIMENSION),
            Image.Resampling.LANCZOS,
        )

    quality_used = None
    while True:
        for quality in (92, 88, 84, 80, 76):
            image.save(
                destination,
                "JPEG",
                quality=quality,
                optimize=True,
                progressive=True,
                dpi=(300, 300),
                icc_profile=image.info.get("icc_profile"),
            )
            _embed_rights_metadata(destination, title)
            if destination.stat().st_size <= MAX_MEMBER_BYTES:
                quality_used = quality
                break
        if quality_used is not None:
            break
        if min(image.size) < 1800:
            break
        image = image.resize(
            (round(image.width * 0.9), round(image.height * 0.9)),
            Image.Resampling.LANCZOS,
        )
    if quality_used is None:
        raise ValueError(f"Cannot fit bundle member: {source.name}")
    return {
        "filename": destination.name,
        "width": image.width,
        "height": image.height,
        "size_bytes": destination.stat().st_size,
        "jpeg_quality": quality_used,
        "sha256": _sha256(destination),
    }


def build_bundle_package(
    source_packages: list[str | Path],
    output_root: str | Path,
    product_id: str,
    title: str,
    member_names: list[str],
    price_usd: float = 18.0,
) -> dict[str, Any]:
    """Generate five ratio ZIPs, each containing three printable photographs."""
    packages = [Path(value).resolve() for value in source_packages]
    if len(packages) != 3 or len(member_names) != 3:
        raise ValueError("A bundle requires exactly three source products")
    if len(set(packages)) != 3 or len(set(member_names)) != 3:
        raise ValueError("Bundle sources and display names must be distinct")
    if not product_id.startswith("A35-DIG-SET-"):
        raise ValueError("Bundle IDs must start with A35-DIG-SET-")
    if price_usd <= 0:
        raise ValueError("Price must be positive")

    output_dir = Path(output_root).resolve() / product_id
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.iterdir()):
        raise FileExistsError(f"Output package is not empty: {output_dir}")
    manifests = [_package_manifest(package) for package in packages]
    source_products = [
        {
            "product_id": manifest["product_id"],
            "title": name,
            "package_sha256": _sha256(package / "manifest.json"),
        }
        for package, manifest, name in zip(packages, manifests, member_names)
    ]

    delivery_files = []
    readme = (
        f"{title}\n\nEach ZIP contains three JPEG photographs in one print "
        f"ratio. {LICENSE_TERMS}\nLicense: {LICENSE_URL}\n"
    )
    with tempfile.TemporaryDirectory(prefix="archive35-bundle-") as temp:
        temp_dir = Path(temp)
        for ratio in RATIO_SPECS:
            members = []
            ratio_dir = temp_dir / ratio
            ratio_dir.mkdir()
            for package, manifest, name in zip(
                packages, manifests, member_names
            ):
                source = _ratio_source(package, manifest, ratio)
                slug = package.name.lower().replace("a35-dig-", "")
                destination = ratio_dir / f"{slug}_{ratio}.jpg"
                member = _save_bundle_member(source, destination, name)
                member["source_product_id"] = manifest["product_id"]
                members.append(member)

            zip_name = f"{product_id}_{ratio}.zip"
            zip_path = output_dir / zip_name
            with zipfile.ZipFile(
                zip_path, "w", compression=zipfile.ZIP_DEFLATED
            ) as archive:
                for member in members:
                    archive.write(
                        ratio_dir / member["filename"],
                        arcname=member["filename"],
                    )
                archive.writestr("README.txt", readme)
            if zip_path.stat().st_size > MAX_ETSY_FILE_BYTES:
                raise ValueError(f"Bundle ZIP exceeds Etsy limit: {zip_name}")
            delivery_files.append({
                "filename": zip_name,
                "ratio": ratio,
                "size_bytes": zip_path.stat().st_size,
                "sha256": _sha256(zip_path),
                "members": members,
            })

    manifest = {
        "schema_version": 1,
        "product_id": product_id,
        "sku": product_id,
        "title": title,
        "price_usd": round(float(price_usd), 2),
        "product_type": "etsy_instant_download_bundle",
        "physical_item": False,
        "bundle_count": 3,
        "source_products": source_products,
        "license": LICENSE_TERMS,
        "license_url": LICENSE_URL,
        "delivery_files": delivery_files,
        "etsy_constraints": {
            "file_count": len(delivery_files),
            "max_file_bytes": MAX_ETSY_FILE_BYTES,
            "all_files_within_limit": all(
                item["size_bytes"] <= MAX_ETSY_FILE_BYTES
                for item in delivery_files
            ),
        },
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return manifest
