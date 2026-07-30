"""Tests for three-photograph Etsy bundle packages."""

import ast
import json
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from src.products import digital_bundle
from src.products.digital_bundle_previews import build_bundle_previews
from src.products.digital_package import RATIO_SPECS, _sha256


def _single_package(root: Path, product_id: str, color: str) -> Path:
    package = root / product_id
    package.mkdir()
    files = []
    for ratio, value in RATIO_SPECS.items():
        image = Image.new("RGB", (1500, round(1500 / value)), color)
        output = package / f"{product_id}_{ratio}.jpg"
        image.save(output, "JPEG", quality=90)
        files.append({
            "filename": output.name,
            "ratio": ratio,
            "sha256": _sha256(output),
        })
    (package / "manifest.json").write_text(json.dumps({
        "product_id": product_id,
        "delivery_files": files,
    }))
    return package


@pytest.fixture
def source_packages(tmp_path):
    return [
        _single_package(tmp_path, "A35-DIG-ONE-0001", "red"),
        _single_package(tmp_path, "A35-DIG-TWO-0001", "green"),
        _single_package(tmp_path, "A35-DIG-THR-0001", "blue"),
    ]


def test_builds_five_verified_ratio_zips(source_packages, tmp_path, monkeypatch):
    monkeypatch.setattr(
        digital_bundle, "_embed_rights_metadata", lambda path, title: None
    )
    manifest = digital_bundle.build_bundle_package(
        source_packages,
        tmp_path / "output",
        "A35-DIG-SET-TEST-0001",
        "Desert Geometry",
        ["One", "Two", "Three"],
    )
    package = tmp_path / "output" / "A35-DIG-SET-TEST-0001"
    assert len(manifest["delivery_files"]) == 5
    assert manifest["bundle_count"] == 3
    assert manifest["etsy_constraints"]["all_files_within_limit"] is True
    for item in manifest["delivery_files"]:
        archive = package / item["filename"]
        assert archive.stat().st_size <= 20 * 1024 * 1024
        assert _sha256(archive) == item["sha256"]
        with zipfile.ZipFile(archive) as contents:
            names = contents.namelist()
        assert len([name for name in names if name.endswith(".jpg")]) == 3
        assert "README.txt" in names


def test_refuses_duplicate_sources(source_packages, tmp_path):
    with pytest.raises(ValueError, match="distinct"):
        digital_bundle.build_bundle_package(
            [source_packages[0]] * 3,
            tmp_path / "output",
            "A35-DIG-SET-TEST-0002",
            "Duplicate Set",
            ["One", "Two", "Three"],
        )


def test_builds_five_square_bundle_previews(tmp_path):
    sources = []
    for index, color in enumerate(("red", "green", "blue")):
        source = tmp_path / f"source-{index}.jpg"
        Image.new("RGB", (1200, 800), color).save(source)
        sources.append(source)
    outputs = build_bundle_previews(
        sources,
        ["Crimson Passage", "Solitary Tree", "Dunes in Motion"],
        tmp_path / "previews",
        collection_title="Test Collection",
    )
    assert len(outputs) == 5
    for output in outputs:
        with Image.open(output) as image:
            assert image.size == (2000, 2000)


def test_desert_builder_assigns_section_to_listing_copy():
    script = Path(__file__).parents[2] / "scripts/build_etsy_desert_bundle.py"
    tree = ast.parse(script.read_text())
    calls = {
        node.func.id: {keyword.arg for keyword in node.keywords}
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    assert "shop_section_id" in calls["build_bundle_listing_copy"]
    assert "shop_section_id" not in calls["build_bundle_package"]
