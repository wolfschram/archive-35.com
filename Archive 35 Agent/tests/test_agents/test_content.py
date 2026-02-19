"""Tests for the Content Agent."""

import json
from unittest.mock import MagicMock

import pytest

from src.agents.content import generate_all_platforms, generate_content
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


@pytest.fixture
def photo_in_db(conn):
    """Insert a test photo with vision data."""
    conn.execute(
        """INSERT INTO photos
           (id, filename, path, imported_at, collection,
            vision_tags, vision_mood, vision_composition, marketability_score, vision_analyzed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            "photo123",
            "iceland.jpg",
            "/photos/iceland.jpg",
            "2026-02-18T00:00:00Z",
            "ICE",
            '["ice", "landscape", "aurora", "nordic"]',
            "serene",
            "Rule of thirds with dramatic sky",
            8,
            "2026-02-18T01:00:00Z",
        ),
    )
    conn.commit()
    return "photo123"


def _mock_content_response(platform):
    """Create a mock API response for content generation."""
    mock_response = MagicMock()
    mock_content = MagicMock()

    if platform == "etsy":
        mock_content.text = json.dumps({
            "title": "Arctic Aurora Fine Art Print",
            "body": "A stunning capture of the northern lights.",
            "tags": [f"tag{i}" for i in range(13)],
        })
    else:
        mock_content.text = json.dumps({
            "body": "Stunning aurora photograph from Iceland.",
            "tags": ["aurora", "iceland", "fineart", "landscape"],
        })

    mock_response.content = [mock_content]
    return mock_response


def test_generate_stub_content(conn, photo_in_db):
    """Should create stub content when no API client provided."""
    content_id = generate_content(conn, photo_in_db, "pinterest")
    assert content_id is not None

    row = conn.execute("SELECT * FROM content WHERE id = ?", (content_id,)).fetchone()
    assert row["platform"] == "pinterest"
    assert row["status"] == "pending"
    assert "[Stub]" in row["body"]
    assert row["expires_at"] is not None


def test_generate_with_mock_client(conn, photo_in_db):
    """Should use API response when client is provided."""
    mock_client = MagicMock()
    mock_client.messages.create.return_value = _mock_content_response("pinterest")

    content_id = generate_content(
        conn, photo_in_db, "pinterest", client=mock_client,
    )
    assert content_id is not None

    row = conn.execute("SELECT * FROM content WHERE id = ?", (content_id,)).fetchone()
    assert "aurora" in row["body"].lower() or "stunning" in row["body"].lower()


def test_generate_all_platforms(conn, photo_in_db):
    """Should generate content for all 3 platforms with 2 variants each."""
    content_ids = generate_all_platforms(conn, photo_in_db, variants=2)
    assert len(content_ids) == 6  # 3 platforms * 2 variants

    # Check platform distribution
    platforms = []
    for cid in content_ids:
        row = conn.execute("SELECT platform FROM content WHERE id = ?", (cid,)).fetchone()
        platforms.append(row["platform"])
    assert platforms.count("pinterest") == 2
    assert platforms.count("instagram") == 2
    assert platforms.count("etsy") == 2


def test_generate_nonexistent_photo(conn):
    """Should return None for a photo not in the database."""
    result = generate_content(conn, "nonexistent", "pinterest")
    assert result is None


def test_content_has_expiry(conn, photo_in_db):
    """Content should have a 48h expiry set."""
    content_id = generate_content(conn, photo_in_db, "instagram")
    row = conn.execute("SELECT created_at, expires_at FROM content WHERE id = ?", (content_id,)).fetchone()
    assert row["expires_at"] is not None
    assert row["expires_at"] > row["created_at"]


def test_etsy_content_type_is_listing(conn, photo_in_db):
    """Etsy content should have content_type 'listing'."""
    content_id = generate_content(conn, photo_in_db, "etsy")
    row = conn.execute("SELECT content_type FROM content WHERE id = ?", (content_id,)).fetchone()
    assert row["content_type"] == "listing"


def test_social_content_type_is_caption(conn, photo_in_db):
    """Pinterest/Instagram content should have content_type 'caption'."""
    content_id = generate_content(conn, photo_in_db, "pinterest")
    row = conn.execute("SELECT content_type FROM content WHERE id = ?", (content_id,)).fetchone()
    assert row["content_type"] == "caption"
