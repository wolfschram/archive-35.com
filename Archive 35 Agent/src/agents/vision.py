"""Vision Agent for Archive-35.

Analyzes photos using Claude Haiku API for tags, mood, composition,
and marketability scoring. Caches results to prevent re-analysis.
"""

from __future__ import annotations

import base64
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from src.safety.audit import log as audit_log
from src.safety.rate_limiter import check_limit, record_usage

logger = logging.getLogger(__name__)

# Default prompt for vision analysis
VISION_PROMPT = """Analyze this fine art photograph. Respond in JSON only:
{
    "tags": ["list", "of", "descriptive", "tags"],
    "mood": "one word mood (e.g., serene, dramatic, contemplative)",
    "composition": "brief composition description",
    "marketability_score": 1-10,
    "suggested_title": "evocative title for print sales"
}

Consider: visual impact, emotional resonance, print-worthiness,
commercial appeal for home decor. Be specific with tags."""


MAX_IMAGE_BYTES = 4_500_000  # Stay under Claude's 5MB base64 limit


def _encode_image(image_path: Path) -> str:
    """Base64-encode an image file, resizing if over 5MB limit."""
    raw = image_path.read_bytes()

    if len(raw) <= MAX_IMAGE_BYTES:
        return base64.b64encode(raw).decode("utf-8")

    # Resize to fit under the limit
    logger.info("Resizing %s (%d bytes) for vision API", image_path.name, len(raw))
    from PIL import Image
    import io

    img = Image.open(image_path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    # Start at 2000px long edge, reduce until under limit
    for max_dim in (2000, 1500, 1200, 1000, 800):
        img_copy = img.copy()
        img_copy.thumbnail((max_dim, max_dim), Image.LANCZOS)
        buf = io.BytesIO()
        img_copy.save(buf, "JPEG", quality=85, optimize=True)
        if buf.tell() <= MAX_IMAGE_BYTES:
            return base64.b64encode(buf.getvalue()).decode("utf-8")

    # Last resort: very small
    img.thumbnail((600, 600), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _get_media_type(path: Path) -> str:
    """Get media type from file extension."""
    ext = path.suffix.lower()
    types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    return types.get(ext, "image/jpeg")


def _parse_vision_response(text: str) -> dict[str, Any]:
    """Parse the JSON response from Claude Vision.

    Handles cases where response may include markdown code fences.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        cleaned = "\n".join(lines[1:-1])

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Failed to parse vision response as JSON")
        return {
            "tags": [],
            "mood": "unknown",
            "composition": "unknown",
            "marketability_score": 5,
            "suggested_title": "Untitled",
        }


def analyze_photo(
    conn: sqlite3.Connection,
    photo_id: str,
    image_path: Optional[Path] = None,
    client: Optional[Any] = None,
    model: str = "claude-haiku-4-5-20251001",
) -> Optional[dict]:
    """Analyze a photo using Claude Vision API.

    Caches results — will not re-analyze a photo that has vision data.

    Args:
        conn: Active database connection.
        photo_id: Photo ID (SHA256 hash).
        image_path: Path to the image file (or resized copy).
        client: Anthropic client instance (None = skip API call).
        model: Claude model to use for vision.

    Returns:
        Dict with tags, mood, composition, score. None if skipped/failed.
    """
    # Check cache — skip if already analyzed
    row = conn.execute(
        "SELECT vision_analyzed_at FROM photos WHERE id = ?",
        (photo_id,),
    ).fetchone()

    if not row:
        logger.error("Photo %s not found in database", photo_id)
        return None

    if row["vision_analyzed_at"]:
        logger.debug("Photo %s already analyzed, skipping", photo_id[:12])
        cached = conn.execute(
            "SELECT vision_tags, vision_mood, vision_composition, marketability_score FROM photos WHERE id = ?",
            (photo_id,),
        ).fetchone()
        return dict(cached)

    # Check rate limits — don't mark as error (temporary condition)
    if not check_limit(conn, "anthropic", daily_call_limit=500, daily_cost_limit_usd=5.0):
        logger.warning("Anthropic API rate limit reached, skipping vision analysis")
        return None

    if client is None:
        logger.warning("No Anthropic client provided, skipping vision analysis")
        audit_log(conn, "vision", "analyze_skipped", {
            "photo_id": photo_id,
            "reason": "no_api_client",
        })
        return None

    if image_path is None or not image_path.exists():
        logger.error("Image file not found for photo %s: %s", photo_id[:12], image_path)
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """UPDATE photos SET
               vision_mood = 'error',
               vision_analyzed_at = ?
               WHERE id = ?""",
            (now, photo_id),
        )
        conn.commit()
        audit_log(conn, "vision", "analyze_failed", {
            "photo_id": photo_id,
            "error": f"Image file not found: {image_path}",
        }, success=False)
        return None

    # Call Claude Vision API
    try:
        image_data = _encode_image(image_path)
        media_type = _get_media_type(image_path)

        response = client.messages.create(
            model=model,
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": VISION_PROMPT,
                    },
                ],
            }],
        )

        # Parse response
        result_text = response.content[0].text
        result = _parse_vision_response(result_text)

        # Estimate cost (Haiku is ~$0.001 per image)
        cost = 0.001

        # Store results
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """UPDATE photos SET
               vision_tags = ?,
               vision_mood = ?,
               vision_composition = ?,
               marketability_score = ?,
               vision_analyzed_at = ?
               WHERE id = ?""",
            (
                json.dumps(result.get("tags", [])),
                result.get("mood", "unknown"),
                result.get("composition", "unknown"),
                result.get("marketability_score", 5),
                now,
                photo_id,
            ),
        )
        conn.commit()

        # Record usage and audit
        record_usage(conn, "anthropic", cost_usd=cost)
        audit_log(conn, "vision", "analyze_photo", {
            "photo_id": photo_id,
            "score": result.get("marketability_score"),
            "tags_count": len(result.get("tags", [])),
        }, cost_usd=cost)

        logger.info(
            "Analyzed %s: score=%s, tags=%d",
            photo_id[:12],
            result.get("marketability_score"),
            len(result.get("tags", [])),
        )
        return result

    except Exception as e:
        logger.error("Vision analysis failed for %s: %s", photo_id[:12], e)
        audit_log(conn, "vision", "analyze_failed", {
            "photo_id": photo_id,
            "error": str(e),
        }, success=False)

        # Mark as failed so it doesn't block future batches
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """UPDATE photos SET
               vision_mood = 'error',
               vision_analyzed_at = ?
               WHERE id = ?""",
            (now, photo_id),
        )
        conn.commit()
        return None


def analyze_batch(
    conn: sqlite3.Connection,
    photo_ids: list[str],
    image_dir: Optional[Path] = None,
    client: Optional[Any] = None,
    model: str = "claude-haiku-4-5-20251001",
) -> list[dict]:
    """Analyze multiple photos sequentially.

    Args:
        conn: Active database connection.
        photo_ids: List of photo IDs to analyze.
        image_dir: Directory containing image files.
        client: Anthropic client instance.
        model: Claude model to use.

    Returns:
        List of analysis results (skipped photos excluded).
    """
    results = []
    for photo_id in photo_ids:
        # Look up filename
        row = conn.execute(
            "SELECT filename, path FROM photos WHERE id = ?",
            (photo_id,),
        ).fetchone()

        if not row:
            continue

        # Determine image path
        image_path = None
        if image_dir:
            image_path = image_dir / row["filename"]
        elif row["path"]:
            image_path = Path(row["path"])
            # Resolve relative paths against repo root
            if not image_path.is_absolute():
                repo_root = Path(__file__).parent.parent.parent.parent  # agents -> src -> Agent -> repo root
                image_path = repo_root / image_path

        result = analyze_photo(conn, photo_id, image_path, client, model)
        if result:
            results.append(result)

    return results
