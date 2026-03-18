"""Tests for the Etsy bulk listing uploader."""

import json
from unittest.mock import patch, MagicMock

import pytest

from src.agents.etsy_copywriter import (
    get_story_for_collection,
    sanity_check,
)
from src.agents.etsy_uploader import (
    _load_packages,
    _get_mockup_files,
    upload_all_packages,
)
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


class TestStoryBank:
    def test_antelope_canyon(self):
        story = get_story_for_collection("Antelope Canyon")
        assert "cathedral made by water" in story

    def test_tanzania(self):
        story = get_story_for_collection("Tanzania")
        assert "Kilimanjaro" in story

    def test_iceland(self):
        story = get_story_for_collection("Iceland")
        assert "stops you" in story

    def test_grand_teton(self):
        story = get_story_for_collection("Grand Teton")
        assert "Tetons" in story

    def test_cuba(self):
        story = get_story_for_collection("Cuba")
        assert "frozen and alive" in story

    def test_black_and_white(self):
        story = get_story_for_collection("Black and White")
        assert "not a filter" in story

    def test_unknown_collection_returns_empty(self):
        story = get_story_for_collection("Unknown Place 123")
        assert story == ""


class TestSanityCheck:
    def test_clean_copy_passes(self):
        issues = sanity_check(
            "Antelope Canyon Metal Print",
            "FREE SHIPPING — Ships free. The light enters from above.",
            "Antelope Canyon",
        )
        assert issues == []

    def test_banned_phrase_caught(self):
        issues = sanity_check(
            "Random Stuff Print",
            "FREE SHIPPING — generic description",
            "Random Stuff",
        )
        assert any("Random Stuff" in i.lower() or "random stuff" in i.lower() for i in issues)

    def test_missing_free_shipping(self):
        issues = sanity_check(
            "Good Title", "No shipping info here.", "Iceland",
        )
        assert any("FREE SHIPPING" in i for i in issues)

    def test_title_too_long(self):
        issues = sanity_check(
            "x" * 141, "FREE SHIPPING — ok", "Iceland",
        )
        assert any("Title too long" in i for i in issues)


class TestGetMockupFiles:
    def test_returns_up_to_4(self, tmp_path):
        images_dir = tmp_path / "images"
        images_dir.mkdir()
        images = []
        for i in range(6):
            f = images_dir / f"mockup-{i}-etsy.jpg"
            f.write_bytes(b"\xff\xd8\xff")
            images.append({"order": i + 1, "type": "mockup", "filename": f.name})
        images.append({"order": 7, "type": "original", "filename": "orig.jpg"})

        pkg = {"_pkg_dir": str(tmp_path), "images": images}
        result = _get_mockup_files(pkg, max_count=4)
        assert len(result) == 4


class TestUploadAllPackages:
    def test_dry_run(self, conn):
        mock_client = MagicMock()
        mock_seo = {"title": "Test Print", "description": "FREE SHIPPING — test", "tags": ["a"] * 13}
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text=json.dumps(mock_seo))]
        )

        fake_pkg = {
            "_pkg_dir": "/fake", "_pkg_name": "test-pkg",
            "title": "Old", "description": "Old desc", "gallery_name": "Iceland",
            "photo_dimensions": {"width": 2000, "height": 1333},
            "images": [],
        }

        with (
            patch("src.agents.etsy_uploader.ensure_valid_token", return_value={"valid": True}),
            patch("src.agents.etsy_uploader._load_packages", return_value=[fake_pkg]),
            patch("src.agents.etsy_uploader.check_limit", return_value=True),
            patch("src.agents.etsy_uploader.record_usage"),
        ):
            result = upload_all_packages(conn, mock_client, dry_run=True)

        assert result["total"] == 1
        assert result["created"] == 0  # dry run

    def test_invalid_token(self, conn):
        mock_client = MagicMock()
        with patch("src.agents.etsy_uploader.ensure_valid_token",
                    return_value={"valid": False, "error": "expired"}):
            result = upload_all_packages(conn, mock_client)
        assert "error" in result
