"""Tests for the photo importer."""

from pathlib import Path

import pytest
from PIL import Image

from src.db import get_initialized_connection
from src.pipeline.import_photos import import_directory, import_photo


@pytest.fixture
def conn(tmp_path):
    db_path = str(tmp_path / "test.db")
    return get_initialized_connection(db_path)


@pytest.fixture
def sample_photos(tmp_path):
    """Create 3 test photos of different sizes."""
    photo_dir = tmp_path / "ICE"
    photo_dir.mkdir()

    for i, size in enumerate([(800, 600), (2000, 1500), (1024, 768)]):
        img = Image.new("RGB", size, color=(i * 50, 100, 200))
        img.save(photo_dir / f"photo_{i}.jpg")

    return photo_dir


def test_import_single_photo(conn, sample_photos):
    """Should import a single photo and return its hash."""
    photo_path = list(sample_photos.glob("*.jpg"))[0]
    photo_id = import_photo(conn, photo_path)
    assert photo_id is not None
    assert len(photo_id) == 64  # SHA256 hex


def test_import_stores_in_db(conn, sample_photos):
    """Imported photo should be in the database."""
    photo_path = list(sample_photos.glob("*.jpg"))[0]
    photo_id = import_photo(conn, photo_path)

    row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    assert row is not None
    assert row["filename"] == photo_path.name
    assert row["width"] > 0
    assert row["height"] > 0


def test_import_dedup(conn, sample_photos):
    """Re-importing the same photo should return None (skipped)."""
    photo_path = list(sample_photos.glob("*.jpg"))[0]
    first = import_photo(conn, photo_path)
    second = import_photo(conn, photo_path)
    assert first is not None
    assert second is None


def test_import_directory(conn, sample_photos):
    """Should import all 3 test photos from directory."""
    imported = import_directory(conn, sample_photos)
    assert len(imported) == 3


def test_import_directory_dedup(conn, sample_photos):
    """Re-importing the same directory should return empty."""
    first = import_directory(conn, sample_photos)
    second = import_directory(conn, sample_photos)
    assert len(first) == 3
    assert len(second) == 0


def test_guesses_collection(conn, sample_photos):
    """Should guess collection from parent directory name."""
    photo_path = list(sample_photos.glob("*.jpg"))[0]
    photo_id = import_photo(conn, photo_path)
    row = conn.execute("SELECT collection FROM photos WHERE id = ?", (photo_id,)).fetchone()
    assert row["collection"] == "ICE"


def test_skips_unsupported_files(conn, tmp_path):
    """Should skip non-image files."""
    txt_file = tmp_path / "readme.txt"
    txt_file.write_text("not a photo")
    result = import_photo(conn, txt_file)
    assert result is None


def test_resize_output(conn, sample_photos, tmp_path):
    """Should create resized copies when output_dir is provided."""
    output = tmp_path / "resized"
    imported = import_directory(conn, sample_photos, output_dir=output)
    assert len(imported) == 3

    resized_files = list(output.glob("*.jpg"))
    assert len(resized_files) == 3

    # Check that large images were resized
    for f in resized_files:
        img = Image.open(f)
        assert max(img.size) <= 1024
