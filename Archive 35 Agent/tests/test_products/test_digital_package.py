"""Tests for Etsy digital printable package generation."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image, ImageCms

from src.products import digital_package


@pytest.fixture
def source_image(tmp_path: Path) -> Path:
    """Create a deterministic landscape source image."""
    source = tmp_path / "source.jpg"
    Image.new("RGB", (1500, 1000), (120, 70, 35)).save(source, quality=95)
    return source


def test_builds_exactly_five_ratio_files(
    source_image: Path,
    tmp_path: Path,
    monkeypatch,
):
    """A package should match Etsy's five-file instant-download limit."""
    monkeypatch.setattr(
        digital_package,
        "_embed_rights_metadata",
        lambda path, title: None,
    )
    manifest = digital_package.build_digital_package(
        source_image,
        tmp_path / "output",
        "A35-DIG-TEST-0001",
        "Test Landscape",
    )
    package = tmp_path / "output" / "A35-DIG-TEST-0001"
    jpgs = sorted(package.glob("*.jpg"))

    assert len(jpgs) == 5
    assert manifest["etsy_constraints"]["file_count"] == 5
    assert manifest["etsy_constraints"]["all_files_within_limit"] is True
    assert {item["ratio"] for item in manifest["delivery_files"]} == {
        "2x3", "3x4", "4x5", "11x14", "iso",
    }


def test_output_dimensions_match_declared_ratios(
    source_image: Path,
    tmp_path: Path,
    monkeypatch,
):
    """Each generated delivery file should have the advertised aspect ratio."""
    monkeypatch.setattr(
        digital_package,
        "_embed_rights_metadata",
        lambda path, title: None,
    )
    manifest = digital_package.build_digital_package(
        source_image,
        tmp_path / "output",
        "A35-DIG-TEST-0002",
        "Test Landscape",
    )
    for item in manifest["delivery_files"]:
        expected = digital_package.RATIO_SPECS[item["ratio"]]
        actual = item["width"] / item["height"]
        assert actual == pytest.approx(expected, abs=0.002)


def test_refuses_to_overwrite_existing_package(
    source_image: Path,
    tmp_path: Path,
):
    """Existing product artifacts must never be silently replaced."""
    package = tmp_path / "output" / "A35-DIG-TEST-0003"
    package.mkdir(parents=True)
    (package / "existing.txt").write_text("keep")
    with pytest.raises(FileExistsError):
        digital_package.build_digital_package(
            source_image,
            tmp_path / "output",
            "A35-DIG-TEST-0003",
            "Test Landscape",
        )


def test_embeds_license_url_usage_terms_and_c2pa_notice(source_image: Path):
    if not shutil.which("exiftool"):
        pytest.skip("exiftool is not installed")
    digital_package._embed_rights_metadata(source_image, "Test Landscape")
    result = subprocess.run(
        ["exiftool", "-json", str(source_image)],
        capture_output=True, text=True, check=True,
    )
    metadata = json.loads(result.stdout)[0]
    values = " ".join(str(value) for value in metadata.values())
    assert digital_package.LICENSE_URL in values
    assert digital_package.LICENSE_TERMS in values
    assert "C2PA" in values


def test_save_preserves_srgb_profile(tmp_path: Path):
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    image = Image.new("RGB", (100, 100), "red")
    image.info["icc_profile"] = profile
    output = tmp_path / "profile.jpg"
    digital_package._save_under_limit(image, output)
    with Image.open(output) as saved:
        assert saved.info.get("icc_profile")
