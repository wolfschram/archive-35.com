"""Tests for the daily pipeline."""

from pathlib import Path

import pytest
from PIL import Image

from src.db import get_initialized_connection
from src.pipeline.daily import run_daily_pipeline


@pytest.fixture
def setup(tmp_path):
    """Set up a complete test environment."""
    db_path = str(tmp_path / "test.db")
    photo_dir = tmp_path / "photos" / "ICE"
    photo_dir.mkdir(parents=True)

    # Create test photos
    for i in range(3):
        img = Image.new("RGB", (800, 600), color=(i * 50, 100, 200))
        img.save(photo_dir / f"photo_{i}.jpg")

    conn = get_initialized_connection(db_path)
    conn.close()

    return db_path, str(photo_dir)


def test_full_pipeline_dry_run(setup):
    """Full pipeline should complete in dry run mode."""
    db_path, photo_dir = setup
    results = run_daily_pipeline(
        db_path=db_path,
        photo_dir=photo_dir,
        dry_run=True,
    )
    assert results["status"] in ("completed", "completed_with_errors")
    assert "import" in results["steps"]


def test_pipeline_imports_photos(setup):
    """Pipeline should import photos from the directory."""
    db_path, photo_dir = setup
    results = run_daily_pipeline(
        db_path=db_path,
        photo_dir=photo_dir,
        dry_run=True,
    )
    import_result = results["steps"].get("import", {})
    assert import_result.get("status") == "ok"
    assert import_result.get("imported", 0) == 3


def test_pipeline_kill_switch_blocks(setup):
    """Pipeline should abort when kill switch is active."""
    db_path, photo_dir = setup

    # Activate kill switch
    from src.safety.kill_switch import activate
    conn = get_initialized_connection(db_path)
    activate(conn, "global", reason="test")
    conn.close()

    results = run_daily_pipeline(
        db_path=db_path,
        photo_dir=photo_dir,
        dry_run=True,
    )
    assert results["status"] == "blocked"


def test_pipeline_generates_content(setup):
    """Pipeline should generate content for imported+analyzed photos."""
    db_path, photo_dir = setup

    # First run: import + stub analysis
    conn = get_initialized_connection(db_path)

    # Manually simulate a photo with vision data
    conn.execute(
        """INSERT INTO photos
           (id, filename, path, imported_at, collection,
            vision_tags, vision_mood, vision_composition,
            marketability_score, vision_analyzed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("manual1", "test.jpg", "/test.jpg", "2026-02-18T00:00:00Z", "ICE",
         '["ice", "aurora"]', "serene", "dramatic", 8, "2026-02-18T01:00:00Z"),
    )
    conn.commit()
    conn.close()

    results = run_daily_pipeline(
        db_path=db_path,
        photo_dir=photo_dir,
        dry_run=True,
    )

    content_result = results["steps"].get("content", {})
    assert content_result.get("status") == "ok"
    assert content_result.get("content_created", 0) > 0


def test_pipeline_empty_directory(tmp_path):
    """Pipeline should handle empty photo directory gracefully."""
    db_path = str(tmp_path / "test.db")
    empty_dir = str(tmp_path / "empty")
    Path(empty_dir).mkdir()

    results = run_daily_pipeline(
        db_path=db_path,
        photo_dir=empty_dir,
        dry_run=True,
    )
    assert results["status"] in ("completed", "completed_with_errors")
    assert results["steps"]["import"]["imported"] == 0
