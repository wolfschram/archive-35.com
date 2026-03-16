"""Tests for the Instagram auto-posting agent."""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest

from src.agents.instagram_agent import (
    _guess_collection,
    ensure_table,
    generate_caption,
    pick_next_image,
    post_next_image,
    NO_REPEAT_DAYS,
)
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    c = get_initialized_connection(db_path)
    ensure_table(c)
    return c


class TestGuessCollection:
    def test_antelope_canyon(self):
        assert _guess_collection("Antelope Canyon Metal Print", []) == "antelope canyon"

    def test_tanzania_from_tags(self):
        assert _guess_collection("Wildlife Print", ["elephant", "safari"]) == "tanzania"

    def test_hawaii_from_title(self):
        assert _guess_collection("Hawaii Volcano Lava Print", []) == "hawaii"

    def test_architecture_from_gehry(self):
        assert _guess_collection("Gehry Building Metal Print", []) == "architecture"

    def test_unknown(self):
        assert _guess_collection("Abstract Print", ["colorful"]) == ""


class TestPickNextImage:
    def test_picks_unposted_first(self, conn):
        fake_listings = [
            {"listing_id": "111", "title": "A", "image_url": "http://a.jpg", "tags": [], "collection": ""},
            {"listing_id": "222", "title": "B", "image_url": "http://b.jpg", "tags": [], "collection": ""},
        ]
        # Mark 111 as recently posted
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO instagram_posts (etsy_listing_id, image_url, posted_at, success) VALUES (?, ?, ?, 1)",
            ("111", "http://a.jpg", now),
        )
        conn.commit()

        with patch("src.agents.instagram_agent._fetch_etsy_listing_images", return_value=fake_listings):
            result = pick_next_image(conn)

        assert result is not None
        assert result["listing_id"] == "222"

    def test_resets_when_all_posted(self, conn):
        fake_listings = [
            {"listing_id": "111", "title": "A", "image_url": "http://a.jpg", "tags": [], "collection": ""},
        ]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO instagram_posts (etsy_listing_id, image_url, posted_at, success) VALUES (?, ?, ?, 1)",
            ("111", "http://a.jpg", now),
        )
        conn.commit()

        with patch("src.agents.instagram_agent._fetch_etsy_listing_images", return_value=fake_listings):
            result = pick_next_image(conn)

        # Should still return something (resets rotation)
        assert result is not None

    def test_old_posts_dont_block(self, conn):
        fake_listings = [
            {"listing_id": "111", "title": "A", "image_url": "http://a.jpg", "tags": [], "collection": ""},
        ]
        # Posted 31 days ago — outside the 30-day window
        old_date = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        conn.execute(
            "INSERT INTO instagram_posts (etsy_listing_id, image_url, posted_at, success) VALUES (?, ?, ?, 1)",
            ("111", "http://a.jpg", old_date),
        )
        conn.commit()

        with patch("src.agents.instagram_agent._fetch_etsy_listing_images", return_value=fake_listings):
            result = pick_next_image(conn)

        assert result["listing_id"] == "111"


class TestGenerateCaption:
    def test_returns_string(self):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text="The light enters from above.\n\n#antelopecanyon")]
        )
        result = generate_caption(
            {"title": "Antelope Canyon", "collection": "antelope canyon", "tags": []},
            mock_client,
        )
        assert result is not None
        assert "light" in result


class TestPostNextImage:
    def test_kill_switch_blocks(self, conn):
        mock_client = MagicMock()
        with patch("src.agents.instagram_agent.is_active", return_value=True):
            result = post_next_image(conn, mock_client)
        assert "error" in result
        assert "kill switch" in result["error"].lower()

    def test_dry_run(self, conn):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = MagicMock(
            content=[MagicMock(text="A beautiful moment.\n\n#art")]
        )
        fake_listing = {
            "listing_id": "999", "title": "Test", "image_url": "http://test.jpg",
            "tags": [], "collection": "iceland",
        }

        with (
            patch("src.agents.instagram_agent.is_active", return_value=False),
            patch("src.agents.instagram_agent.is_configured", return_value=True),
            patch("src.agents.instagram_agent.check_limit", return_value=True),
            patch("src.agents.instagram_agent.record_usage"),
            patch("src.agents.instagram_agent.pick_next_image", return_value=fake_listing),
        ):
            result = post_next_image(conn, mock_client, dry_run=True)

        assert result["action"] == "dry_run"
        assert result["listing_id"] == "999"
