from pathlib import Path

import pytest
from PIL import Image

from src.products.preview_approval import approve_previews, load_approved_previews


def _preview(path: Path, size=(2000, 2000)) -> None:
    Image.new("RGB", size, (30, 40, 50)).save(path, "JPEG")


def test_approval_is_bound_to_reviewed_file_hash(tmp_path):
    previews = tmp_path / "previews"
    previews.mkdir()
    _preview(previews / "room.jpg")

    approve_previews(tmp_path, ["room.jpg"])
    assert load_approved_previews(tmp_path) == [str(previews / "room.jpg")]

    _preview(previews / "room.jpg", size=(2100, 2000))
    with pytest.raises(ValueError, match="changed after review"):
        load_approved_previews(tmp_path)


def test_approval_rejects_undersized_preview(tmp_path):
    previews = tmp_path / "previews"
    previews.mkdir()
    _preview(previews / "small.jpg", size=(1999, 2000))
    with pytest.raises(ValueError, match="below 2000"):
        approve_previews(tmp_path, ["small.jpg"])


def test_approval_requires_explicit_selection(tmp_path):
    (tmp_path / "previews").mkdir()
    with pytest.raises(ValueError, match="At least one"):
        approve_previews(tmp_path, [])
