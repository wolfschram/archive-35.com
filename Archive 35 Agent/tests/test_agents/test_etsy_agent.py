"""Tests for the Etsy listing restructure + SEO rewrite agent."""

import json
from unittest.mock import patch, MagicMock

import pytest

from src.agents.etsy_agent import (
    analyze_listing_image,
    _format_paste_ready,
    _save_deactivated_log,
    restructure_all_listings,
)
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


@pytest.fixture
def mock_seo_response():
    return {
        "title": "Hawaii Volcanic Coast Metal Print | Dramatic Lava Wall Art",
        "description": (
            "FREE SHIPPING — Ships free across North America and Canada.\n\n"
            "Molten lava meets the Pacific in a display of raw power.\n\n"
            "By Wolf Schram — 25 years, 55 countries, The Restless Eye.\n\n"
            "ChromaLuxe HD Metal Print — vivid colors, 60-year archival.\n\n"
            "20×30 inches. 100% satisfaction guarantee."
        ),
        "tags": [
            "hawaii lava print", "volcanic coast art", "metal wall art",
            "dramatic landscape", "nature metal print", "living room wall art",
            "office decor", "housewarming gift", "unique anniversary gift",
            "chromaluxe art", "aluminum wall art", "big island hawaii",
            "museum quality print",
        ],
        "price_context": "ChromaLuxe metal prints deliver gallery-quality vibrancy.",
    }


@pytest.fixture
def mock_pricing():
    return {
        "orientation": "landscape",
        "size_label": "20×30 inches",
        "width_in": 30, "height_in": 20,
        "pictorem_cost_usd": 150.00,
        "markup": 5.0,
        "etsy_price_cents": 75000,
        "etsy_price_usd": 750.00,
        "material": "HD Metal Print — White Gloss ChromaLuxe",
        "mount": "Metal standoff hanging brackets (included)",
        "shipping": "Free shipping — North America and Canada",
    }


class TestAnalyzeListingImage:
    def test_successful_analysis(self, mock_seo_response):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text=json.dumps(mock_seo_response))]
        )
        with patch("src.agents.etsy_agent._download_image_bytes", return_value=b"\xff\xd8\xff"):
            result = analyze_listing_image(
                "https://example.com/img.jpg", "Old Title", "20×30 inches", mock_client,
            )
        assert result is not None
        assert len(result["tags"]) == 13
        assert "FREE SHIPPING" in result["description"]

    def test_image_download_failure(self):
        mock_client = MagicMock()
        with patch("src.agents.etsy_agent._download_image_bytes", return_value=None):
            result = analyze_listing_image(
                "https://example.com/broken.jpg", "Title", "20×30", mock_client,
            )
        assert result is None


class TestFormatPasteReady:
    def test_contains_all_fields(self, mock_seo_response, mock_pricing):
        output = _format_paste_ready(12345, mock_seo_response, mock_pricing)
        assert "12345" in output
        assert "ChromaLuxe" in output
        assert "20×30" in output
        assert "$750" in output
        assert "Free shipping" in output


class TestSaveDeactivatedLog:
    def test_creates_log_file(self, tmp_path):
        log_path = tmp_path / "deactivated_listings.json"
        with patch("src.agents.etsy_agent.DEACTIVATED_LOG", log_path):
            _save_deactivated_log([{"listing_id": 111, "reason": "test"}])
        data = json.loads(log_path.read_text())
        assert len(data) == 1
        assert data[0]["listing_id"] == 111

    def test_appends_to_existing(self, tmp_path):
        log_path = tmp_path / "deactivated_listings.json"
        log_path.write_text('[{"listing_id": 100}]')
        with patch("src.agents.etsy_agent.DEACTIVATED_LOG", log_path):
            _save_deactivated_log([{"listing_id": 200}])
        data = json.loads(log_path.read_text())
        assert len(data) == 2


class TestRestructureAllListings:
    def test_dry_run(self, conn, mock_seo_response):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text=json.dumps(mock_seo_response))]
        )
        fake_active = {"results": [{"listing_id": 111, "title": "Old", "tags": []}], "count": 1}
        fake_inactive = {"results": [{"listing_id": 222, "title": "Old 2", "tags": []}], "count": 1}
        fake_images = [{"full_width": 2000, "full_height": 1333, "url_570xN": "https://example.com/img.jpg"}]

        def mock_get_listings(state="active", limit=25, offset=0):
            return fake_active if state == "active" else fake_inactive

        with (
            patch("src.agents.etsy_agent.ensure_valid_token", return_value={"valid": True}),
            patch("src.agents.etsy_agent.get_listings", side_effect=mock_get_listings),
            patch("src.agents.etsy_agent._fetch_listing_images", return_value=fake_images),
            patch("src.agents.etsy_agent._download_image_bytes", return_value=b"\xff\xd8\xff"),
            patch("src.agents.etsy_agent.check_limit", return_value=True),
            patch("src.agents.etsy_agent.record_usage"),
        ):
            result = restructure_all_listings(conn, mock_client, dry_run=True)

        assert result["total"] == 2
        assert result["paste_ready"] == 2
        assert result["updated"] == 0
        # Both should be landscape (2000x1333)
        for r in result["results"]:
            assert r["orientation"] == "landscape"
            assert r["size"] == "30×20 inches"

    def test_invalid_token(self, conn):
        mock_client = MagicMock()
        with patch("src.agents.etsy_agent.ensure_valid_token",
                    return_value={"valid": False, "error": "expired"}):
            result = restructure_all_listings(conn, mock_client)
        assert "error" in result

    def test_reactivates_inactive_after_update(self, conn, mock_seo_response):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text=json.dumps(mock_seo_response))]
        )
        fake_active = {"results": [], "count": 0}
        fake_inactive = {"results": [{"listing_id": 333, "title": "Inactive", "tags": []}], "count": 1}
        fake_images = [{"full_width": 2000, "full_height": 1333, "url_570xN": "https://example.com/img.jpg"}]

        def mock_get_listings(state="active", limit=25, offset=0):
            return fake_active if state == "active" else fake_inactive

        with (
            patch("src.agents.etsy_agent.ensure_valid_token", return_value={"valid": True}),
            patch("src.agents.etsy_agent.get_listings", side_effect=mock_get_listings),
            patch("src.agents.etsy_agent._fetch_listing_images", return_value=fake_images),
            patch("src.agents.etsy_agent._download_image_bytes", return_value=b"\xff\xd8\xff"),
            patch("src.agents.etsy_agent._apply_update", return_value={"listing_id": 333}),
            patch("src.agents.etsy_agent.activate_listing", return_value={"listing_id": 333}) as mock_activate,
            patch("src.agents.etsy_agent.check_limit", return_value=True),
            patch("src.agents.etsy_agent.record_usage"),
        ):
            result = restructure_all_listings(conn, mock_client)

        assert result["updated"] == 1
        assert result["reactivated"] == 1
        mock_activate.assert_called_once_with(333)
