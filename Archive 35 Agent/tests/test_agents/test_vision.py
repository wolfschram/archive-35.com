"""Tests for the Vision Agent."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from src.agents.vision import _parse_vision_response, analyze_photo
from src.db import get_initialized_connection


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


@pytest.fixture
def sample_photo(conn, tmp_path):
    """Create a test photo in the DB and on disk."""
    img = Image.new("RGB", (800, 600), color=(100, 150, 200))
    photo_path = tmp_path / "test_photo.jpg"
    img.save(photo_path)

    conn.execute(
        """INSERT INTO photos (id, filename, path, imported_at)
           VALUES (?, ?, ?, ?)""",
        ("testhash123", "test_photo.jpg", str(photo_path), "2026-02-18T00:00:00Z"),
    )
    conn.commit()
    return "testhash123", photo_path


def _mock_claude_response():
    """Create a mock Anthropic API response."""
    mock_response = MagicMock()
    mock_content = MagicMock()
    mock_content.text = json.dumps({
        "tags": ["landscape", "ice", "aurora", "nordic", "winter"],
        "mood": "serene",
        "composition": "Rule of thirds with dramatic sky",
        "marketability_score": 8,
        "suggested_title": "Arctic Serenity",
    })
    mock_response.content = [mock_content]
    return mock_response


def test_parse_vision_response_valid():
    """Should parse a valid JSON response."""
    result = _parse_vision_response('{"tags": ["ice"], "mood": "cold"}')
    assert result["tags"] == ["ice"]
    assert result["mood"] == "cold"


def test_parse_vision_response_with_fences():
    """Should handle markdown code fences."""
    text = '```json\n{"tags": ["ice"], "mood": "cold"}\n```'
    result = _parse_vision_response(text)
    assert result["tags"] == ["ice"]


def test_parse_vision_response_invalid():
    """Should return defaults for invalid JSON."""
    result = _parse_vision_response("not json at all")
    assert result["tags"] == []
    assert result["mood"] == "unknown"
    assert result["marketability_score"] == 5


def test_analyze_without_client(conn, sample_photo):
    """Should skip gracefully when no API client is provided."""
    photo_id, _ = sample_photo
    result = analyze_photo(conn, photo_id, client=None)
    assert result is None


def test_analyze_with_mock_client(conn, sample_photo):
    """Should analyze and store results with a mock client."""
    photo_id, photo_path = sample_photo

    mock_client = MagicMock()
    mock_client.messages.create.return_value = _mock_claude_response()

    result = analyze_photo(conn, photo_id, photo_path, client=mock_client)
    assert result is not None
    assert result["marketability_score"] == 8
    assert "landscape" in result["tags"]

    # Verify stored in DB
    row = conn.execute(
        "SELECT vision_mood, marketability_score, vision_analyzed_at FROM photos WHERE id = ?",
        (photo_id,),
    ).fetchone()
    assert row["vision_mood"] == "serene"
    assert row["marketability_score"] == 8
    assert row["vision_analyzed_at"] is not None


def test_analyze_caches_results(conn, sample_photo):
    """Should not re-analyze a photo that already has vision data."""
    photo_id, photo_path = sample_photo

    mock_client = MagicMock()
    mock_client.messages.create.return_value = _mock_claude_response()

    # First call
    analyze_photo(conn, photo_id, photo_path, client=mock_client)
    # Second call — should use cache
    result = analyze_photo(conn, photo_id, photo_path, client=mock_client)

    # API should only be called once
    assert mock_client.messages.create.call_count == 1
    assert result is not None


def test_analyze_nonexistent_photo(conn):
    """Should return None for a photo not in the database."""
    result = analyze_photo(conn, "nonexistent", client=MagicMock())
    assert result is None
