"""Tests for the Etsy listing packager."""

import json
from pathlib import Path

import pytest

from src.db import get_initialized_connection
from src.platforms.etsy import _ensure_13_tags, generate_listing


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    c = get_initialized_connection(db_path)

    c.execute(
        """INSERT INTO photos
           (id, filename, path, imported_at, collection, vision_tags)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ("photo1", "iceland.jpg", "/photos/iceland.jpg",
         "2026-02-18T00:00:00Z", "ICE",
         '["aurora", "landscape", "ice", "nordic"]'),
    )
    c.execute(
        """INSERT INTO content
           (id, photo_id, platform, content_type, body, tags, created_at, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        ("etsy1", "photo1", "etsy", "listing",
         "Aurora Borealis Over Diamond Beach - Fine Art Print. "
         "Stunning capture of the northern lights dancing over volcanic black sand.",
         '["aurora", "iceland", "fine art", "landscape", "northern lights"]',
         "2026-02-18T00:00:00Z",
         "Captured on a winter expedition across Iceland."),
    )
    c.commit()
    return c


def test_ensure_13_tags():
    """Should pad tags to exactly 13."""
    tags = _ensure_13_tags(["aurora", "iceland", "art"])
    assert len(tags) == 13


def test_ensure_13_tags_dedup():
    """Should deduplicate tags."""
    tags = _ensure_13_tags(["aurora", "aurora", "AURORA", "ice"])
    assert len(tags) == 13
    assert tags.count("aurora") == 1


def test_ensure_13_tags_trim():
    """Should trim to 13 if more provided."""
    tags = _ensure_13_tags([f"tag{i}" for i in range(20)])
    assert len(tags) == 13


def test_generate_listing(conn):
    """Should generate a complete listing dict."""
    listing = generate_listing(conn, "etsy1")
    assert listing is not None
    assert listing["tag_count"] == 13
    assert listing["price"] > 0
    assert listing["price"] >= listing["min_price"]
    assert listing["title"]
    assert listing["description"]


def test_listing_price_above_floor(conn):
    """List price should be above minimum floor."""
    listing = generate_listing(conn, "etsy1", size_code="16R", paper_code="HAH")
    assert listing["price"] >= listing["min_price"]
    assert listing["base_cost"] > 0


def test_listing_saves_to_file(conn, tmp_path):
    """Should save listing as markdown file."""
    output = tmp_path / "etsy_listings"
    listing = generate_listing(conn, "etsy1", output_dir=str(output))
    assert listing is not None
    assert "file_path" in listing

    filepath = Path(listing["file_path"])
    assert filepath.exists()
    content = filepath.read_text()
    assert "## Tags" in content
    assert "## Description" in content


def test_listing_nonexistent_content(conn):
    """Should return None for missing content."""
    result = generate_listing(conn, "nonexistent")
    assert result is None
