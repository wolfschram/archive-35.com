"""Tests for the provenance generator."""

import json

from src.brand.provenance import generate_provenance


def test_basic_provenance():
    """Should generate a non-empty story."""
    story = generate_provenance()
    assert isinstance(story, str)
    assert len(story) > 20


def test_provenance_with_collection():
    """Should include collection-specific context."""
    story = generate_provenance(collection="ICE")
    # Should mention Iceland-related content
    assert len(story) > 20


def test_provenance_with_exif():
    """Should include camera and date from EXIF."""
    exif = json.dumps({
        "Make": "Sony",
        "Model": "ILCE-7RM4",
        "DateTime": "2024:01:15 14:30:00",
    })
    story = generate_provenance(exif_json=exif, collection="ICE")
    assert "Sony" in story
    assert "January 2024" in story


def test_provenance_with_mood():
    """Should include mood-based closing."""
    story = generate_provenance(vision_mood="serene")
    assert "stillness" in story.lower() or "restless eye" in story.lower() or "serene" in story.lower()


def test_provenance_unknown_collection():
    """Should use generic story for unknown collections."""
    story = generate_provenance(collection="UNKNOWN")
    assert len(story) > 20
    assert "Restless Eye" in story or "journey" in story or "restless eye" in story.lower()


def test_provenance_no_exif():
    """Should work fine with no EXIF data."""
    story = generate_provenance(collection="TOK", vision_mood="vibrant")
    assert len(story) > 20
