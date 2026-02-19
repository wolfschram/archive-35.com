"""Daily pipeline for Archive-35.

Orchestrates the full daily cycle:
kill check → import → vision → content → telegram queue.

Entry point: python -m src.pipeline.daily
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Optional

from src.config import get_settings
from src.db import get_initialized_connection
from src.safety.audit import log as audit_log
from src.safety.kill_switch import is_active

logger = logging.getLogger(__name__)


def run_daily_pipeline(
    db_path: Optional[str] = None,
    photo_dir: Optional[str] = None,
    anthropic_client: Optional[Any] = None,
    dry_run: bool = False,
) -> dict:
    """Run the full daily pipeline.

    Steps:
    1. Check kill switch
    2. Import new photos
    3. Analyze with Vision Agent
    4. Generate content for all platforms
    5. Bundle for Telegram approval queue
    6. Post approved content

    Args:
        db_path: Override database path.
        photo_dir: Override photo import directory.
        anthropic_client: Anthropic client (None = stub mode).
        dry_run: If True, simulate posting without API calls.

    Returns:
        Dict with pipeline results and stats.
    """
    settings = get_settings()
    db = db_path or settings.db_path
    photos_dir = photo_dir or settings.photo_import_dir

    conn = get_initialized_connection(db)
    results: dict[str, Any] = {
        "status": "started",
        "steps": {},
        "errors": [],
    }

    try:
        # Step 1: Kill switch check
        if is_active(conn, "global"):
            logger.warning("Global kill switch is active, aborting pipeline")
            results["status"] = "blocked"
            results["reason"] = "kill_switch_active"
            audit_log(conn, "pipeline", "daily_blocked", {"reason": "kill_switch"})
            return results

        audit_log(conn, "pipeline", "daily_start")
        logger.info("=== Daily pipeline started ===")

        # Step 2: Import photos
        try:
            from src.pipeline.import_photos import import_directory

            imported = import_directory(conn, photos_dir)
            results["steps"]["import"] = {
                "status": "ok",
                "imported": len(imported),
                "photo_ids": imported,
            }
            logger.info("Imported %d new photos", len(imported))
        except Exception as e:
            logger.error("Photo import failed: %s", e)
            results["steps"]["import"] = {"status": "error", "error": str(e)}
            results["errors"].append(f"import: {e}")

        # Step 3: Vision analysis
        try:
            from src.agents.vision import analyze_batch

            # Get un-analyzed photos
            rows = conn.execute(
                "SELECT id FROM photos WHERE vision_analyzed_at IS NULL"
            ).fetchall()
            unanalyzed = [r["id"] for r in rows]

            if unanalyzed:
                analyzed = analyze_batch(
                    conn, unanalyzed,
                    image_dir=Path(photos_dir) if photos_dir else None,
                    client=anthropic_client,
                )
                results["steps"]["vision"] = {
                    "status": "ok",
                    "analyzed": len(analyzed),
                    "skipped": len(unanalyzed) - len(analyzed),
                }
            else:
                results["steps"]["vision"] = {"status": "ok", "analyzed": 0}
            logger.info("Vision analysis: %d photos", len(unanalyzed))
        except Exception as e:
            logger.error("Vision analysis failed: %s", e)
            results["steps"]["vision"] = {"status": "error", "error": str(e)}
            results["errors"].append(f"vision: {e}")

        # Step 4: Content generation
        try:
            from src.agents.content import generate_all_platforms
            from src.brand.provenance import generate_provenance

            # Get photos that have vision data but no content yet
            rows = conn.execute(
                """SELECT p.id, p.exif_json, p.collection, p.vision_mood, p.vision_tags
                   FROM photos p
                   WHERE p.vision_analyzed_at IS NOT NULL
                   AND p.id NOT IN (SELECT DISTINCT photo_id FROM content)"""
            ).fetchall()

            content_count = 0
            for photo_row in rows:
                # Generate provenance
                provenance = generate_provenance(
                    exif_json=photo_row["exif_json"],
                    collection=photo_row["collection"],
                    vision_mood=photo_row["vision_mood"],
                    vision_tags=photo_row["vision_tags"],
                )
                # Generate content
                content_ids = generate_all_platforms(
                    conn, photo_row["id"],
                    provenance=provenance,
                    client=anthropic_client,
                )
                content_count += len(content_ids)

            results["steps"]["content"] = {
                "status": "ok",
                "photos_processed": len(rows),
                "content_created": content_count,
            }
            logger.info("Generated %d content items", content_count)
        except Exception as e:
            logger.error("Content generation failed: %s", e)
            results["steps"]["content"] = {"status": "error", "error": str(e)}
            results["errors"].append(f"content: {e}")

        # Step 5: Expire old content + prepare queue
        try:
            from src.telegram.queue import expire_old_content, get_queue_stats

            expired = expire_old_content(conn)
            stats = get_queue_stats(conn)

            results["steps"]["queue"] = {
                "status": "ok",
                "expired": expired,
                "stats": stats,
            }
            logger.info("Queue: %d expired, stats=%s", expired, stats)
        except Exception as e:
            logger.error("Queue management failed: %s", e)
            results["steps"]["queue"] = {"status": "error", "error": str(e)}
            results["errors"].append(f"queue: {e}")

        # Step 6: Post approved content
        try:
            from src.agents.social import post_approved_batch

            posted = post_approved_batch(conn, dry_run=dry_run)
            results["steps"]["posting"] = {
                "status": "ok",
                "posted": posted,
            }
            logger.info("Posted %d items", posted)
        except Exception as e:
            logger.error("Posting failed: %s", e)
            results["steps"]["posting"] = {"status": "error", "error": str(e)}
            results["errors"].append(f"posting: {e}")

        # Finalize
        results["status"] = "completed" if not results["errors"] else "completed_with_errors"
        audit_log(conn, "pipeline", "daily_complete", {
            "status": results["status"],
            "error_count": len(results["errors"]),
        })
        logger.info("=== Daily pipeline finished: %s ===", results["status"])

    except Exception as e:
        results["status"] = "failed"
        results["errors"].append(f"pipeline: {e}")
        logger.error("Pipeline failed: %s", e)
        audit_log(conn, "pipeline", "daily_failed", {"error": str(e)}, success=False)

    finally:
        conn.close()

    return results


def main() -> None:
    """CLI entry point for the daily pipeline."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    logger.info("Starting Archive-35 daily pipeline...")
    results = run_daily_pipeline(dry_run=True)

    print(f"\nPipeline status: {results['status']}")
    for step, data in results.get("steps", {}).items():
        print(f"  {step}: {data.get('status', 'unknown')}")

    if results.get("errors"):
        print(f"\nErrors ({len(results['errors'])}):")
        for err in results["errors"]:
            print(f"  - {err}")

    sys.exit(0 if results["status"] != "failed" else 1)


if __name__ == "__main__":
    main()
