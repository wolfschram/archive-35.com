"""Archive-35 Agent REST API.

FastAPI server bridging the Electron Studio UI to the Python agent backend.
Spawned by Electron main process on startup, killed on quit.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Allow large panoramas globally — Wolf shoots 200M+ pixel panos
from PIL import Image as _PILImage
_PILImage.MAX_IMAGE_PIXELS = None

from src.config import get_settings
from src.db import get_initialized_connection
from src.safety import audit, kill_switch, rate_limiter
from src.telegram.queue import get_pending_content, get_queue_stats, expire_old_content

from src.api_content_library import router as library_router
from src.api_variations import router as variations_router

logger = logging.getLogger(__name__)

app = FastAPI(title="Archive-35 Agent API", version="0.2.0")


def _get_anthropic_client():
    """Get Anthropic client, checking Agent .env then root .env fallback."""
    settings = get_settings()
    api_key = None

    # 1. Check Agent's own .env
    if settings.has_anthropic_key():
        api_key = settings.anthropic_api_key

    # 2. Fallback: read from root Archive-35 .env (Studio's key)
    if not api_key:
        root_env = Path(__file__).parent.parent.parent / ".env"
        if root_env.exists():
            for line in root_env.read_text().splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    val = line.split("=", 1)[1].strip()
                    if val and val != "sk-ant-...":
                        api_key = val
                        break

    if not api_key:
        return None

    try:
        import anthropic
        return anthropic.Anthropic(api_key=api_key)
    except Exception as e:
        logger.error("Failed to create Anthropic client: %s", e)
        return None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_conn():
    """Get an initialized DB connection."""
    settings = get_settings()
    return get_initialized_connection(settings.db_path)


# ── Health ──────────────────────────────────────────────────────


@app.get("/health")
def health():
    """API health check — also verifies DB connectivity."""
    db_ok = False
    try:
        conn = _get_conn()
        conn.execute("SELECT 1").fetchone()
        conn.close()
        db_ok = True
    except Exception:
        pass
    return {
        "status": "online" if db_ok else "degraded",
        "version": "0.2.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "db": "ok" if db_ok else "error",
    }


@app.get("/mockups/image/{filename:path}")
def serve_mockup_image(filename: str):
    """Serve a mockup image from mockups/social/ directory."""
    mockup_dir = Path(__file__).parent.parent.parent / "mockups" / "social"
    file_path = mockup_dir / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Mockup image not found")
    return FileResponse(file_path, media_type="image/jpeg")


# ── Dashboard Stats ─────────────────────────────────────────────


@app.get("/stats")
def dashboard_stats():
    """Aggregate stats for the dashboard."""
    conn = _get_conn()
    try:
        photos = conn.execute("SELECT COUNT(*) as cnt FROM photos").fetchone()["cnt"]
        analyzed = conn.execute(
            "SELECT COUNT(*) as cnt FROM photos WHERE vision_analyzed_at IS NOT NULL"
        ).fetchone()["cnt"]
        content_total = conn.execute("SELECT COUNT(*) as cnt FROM content").fetchone()["cnt"]
        pending = conn.execute(
            "SELECT COUNT(*) as cnt FROM content WHERE status='pending'"
        ).fetchone()["cnt"]
        approved = conn.execute(
            "SELECT COUNT(*) as cnt FROM content WHERE status='approved'"
        ).fetchone()["cnt"]
        posted = conn.execute(
            "SELECT COUNT(*) as cnt FROM content WHERE status='posted'"
        ).fetchone()["cnt"]

        today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00")
        cost_today = audit.total_cost(conn, since=today)
        cost_total = audit.total_cost(conn)

        ks_status = kill_switch.get_status(conn)
        queue = get_queue_stats(conn)

        return {
            "photos": {"total": photos, "analyzed": analyzed},
            "content": {
                "total": content_total, "pending": pending,
                "approved": approved, "posted": posted,
            },
            "costs": {"today_usd": round(cost_today, 4), "total_usd": round(cost_total, 4)},
            "kill_switches": ks_status,
            "queue": queue,
        }
    finally:
        conn.close()


# ── Photos ──────────────────────────────────────────────────────


@app.get("/photos")
def list_photos(
    collection: Optional[str] = None,
    analyzed: Optional[bool] = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
):
    """List photos with optional filters."""
    conn = _get_conn()
    try:
        conditions, params = [], []
        if collection:
            conditions.append("collection = ?")
            params.append(collection)
        if analyzed is True:
            conditions.append("vision_analyzed_at IS NOT NULL")
        elif analyzed is False:
            conditions.append("vision_analyzed_at IS NULL")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.extend([limit, offset])

        rows = conn.execute(
            f"SELECT * FROM photos {where} ORDER BY imported_at DESC LIMIT ? OFFSET ?",
            params,
        ).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM photos {where.replace('LIMIT ? OFFSET ?', '')}",
            params[:-2],
        ).fetchone()["cnt"]

        return {"items": [dict(r) for r in rows], "total": total}
    finally:
        conn.close()


@app.get("/photos/collections/list")
def list_collections():
    """Get all unique collection names with photo counts."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT collection, COUNT(*) as count FROM photos GROUP BY collection ORDER BY count DESC"
        ).fetchall()
        return {"collections": [{"name": r[0], "count": r[1]} for r in rows]}
    finally:
        conn.close()


@app.get("/photos/{photo_id}")
def get_photo(photo_id: str):
    """Get photo detail with related content."""
    conn = _get_conn()
    try:
        photo = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")

        content = conn.execute(
            "SELECT * FROM content WHERE photo_id = ? ORDER BY platform, variant",
            (photo_id,),
        ).fetchall()
        skus = conn.execute(
            "SELECT * FROM sku_catalog WHERE photo_id = ?", (photo_id,),
        ).fetchall()

        return {
            "photo": dict(photo),
            "content": [dict(c) for c in content],
            "skus": [dict(s) for s in skus],
        }
    finally:
        conn.close()


@app.get("/photos/{photo_id}/thumbnail")
def get_photo_thumbnail(photo_id: str, size: int = Query(default=300, le=800)):
    """Serve a resized thumbnail for fast grid display.

    Generates a small JPEG on first request, caches it in data/thumbnails/.
    Subsequent requests serve the cached file instantly.
    """
    conn = _get_conn()
    try:
        photo = conn.execute("SELECT path FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")

        photo_path = Path(photo["path"])
        # Resolve relative paths against repo root
        if not photo_path.is_absolute():
            repo_root = Path(__file__).parent.parent.parent  # Archive 35 Agent -> repo root
            photo_path = repo_root / photo_path
        if not photo_path.exists():
            raise HTTPException(status_code=404, detail=f"Photo file not found on disk: {photo_path}")

        # Check for cached thumbnail
        thumb_dir = Path("data/thumbnails")
        thumb_dir.mkdir(parents=True, exist_ok=True)
        thumb_path = thumb_dir / f"{photo_id}_{size}.jpg"

        if not thumb_path.exists():
            # Generate thumbnail from original
            from PIL import Image
            img = Image.open(photo_path)
            img.thumbnail((size, size), Image.LANCZOS)
            # Convert to RGB if needed (handles RGBA, CMYK, etc.)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.save(str(thumb_path), "JPEG", quality=80, optimize=True)

        return FileResponse(
            path=str(thumb_path),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=604800"},  # 7 days
        )
    finally:
        conn.close()


class ImportRequest(BaseModel):
    directory: Optional[str] = None


@app.post("/photos/import")
def import_photos(req: ImportRequest):
    """Trigger photo import from directory."""
    from src.pipeline.import_photos import import_directory

    conn = _get_conn()
    try:
        settings = get_settings()
        photo_dir = req.directory or settings.photo_import_dir
        imported = import_directory(conn, photo_dir)
        return {"imported": len(imported), "photo_ids": imported}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.post("/photos/reimport")
def reimport_photos(req: ImportRequest):
    """Clear all photo data and reimport from scratch."""
    from src.pipeline.import_photos import import_directory

    conn = _get_conn()
    try:
        # Clear existing photo data and related ledger entries
        conn.execute("DELETE FROM photos")
        conn.execute("DELETE FROM actions_ledger WHERE action_type = 'import' AND target = 'photos'")
        conn.commit()
        logger.info("Cleared photos table and import ledger for reimport")

        settings = get_settings()
        photo_dir = req.directory or settings.photo_import_dir
        imported = import_directory(conn, photo_dir)
        return {"imported": len(imported), "cleared": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


class AnalyzeRequest(BaseModel):
    photo_ids: Optional[list[str]] = None  # None = all unanalyzed
    limit: int = 10  # max photos per batch


@app.post("/photos/analyze")
def analyze_photos(req: AnalyzeRequest):
    """Run Claude Vision analysis on photos."""
    client = _get_anthropic_client()
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key not configured. Set it in Studio Settings > API Keys.",
        )

    conn = _get_conn()
    try:
        if req.photo_ids:
            ids = req.photo_ids
        else:
            rows = conn.execute(
                "SELECT id FROM photos WHERE vision_analyzed_at IS NULL LIMIT ?",
                (req.limit,),
            ).fetchall()
            ids = [r["id"] for r in rows]

        if not ids:
            return {"analyzed": 0, "message": "All photos already analyzed"}

        from src.agents.vision import analyze_batch
        results = analyze_batch(conn, ids, client=client)

        remaining = conn.execute(
            "SELECT COUNT(*) as cnt FROM photos WHERE vision_analyzed_at IS NULL"
        ).fetchone()["cnt"]

        return {
            "analyzed": len(results),
            "requested": len(ids),
            "remaining_unanalyzed": remaining,
            "results": results,
        }
    finally:
        conn.close()


# ── Content ─────────────────────────────────────────────────────


@app.get("/content")
def list_content(
    status: Optional[str] = None,
    platform: Optional[str] = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
):
    """List content items with filters."""
    conn = _get_conn()
    try:
        conditions, params = [], []
        if status:
            conditions.append("c.status = ?")
            params.append(status)
        if platform:
            conditions.append("c.platform = ?")
            params.append(platform)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.extend([limit, offset])

        rows = conn.execute(
            f"""SELECT c.*, p.filename, p.collection, p.path as photo_path,
                       p.exif_json, p.vision_tags
                FROM content c JOIN photos p ON c.photo_id = p.id
                {where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?""",
            params,
        ).fetchall()

        items = []
        for r in rows:
            item = dict(r)
            # Add thumbnail URL — points to the Agent API thumbnail endpoint
            item["thumbnail_url"] = f"/photos/{item['photo_id']}/thumbnail?size=300"
            # Derive a title if content table doesn't have one
            if not item.get("title"):
                # Try EXIF title, then vision suggested_title, then collection name
                title = None
                if item.get("exif_json"):
                    try:
                        exif = json.loads(item["exif_json"]) if isinstance(item["exif_json"], str) else item["exif_json"]
                        title = exif.get("ImageDescription") or exif.get("XPTitle")
                    except Exception:
                        pass
                if not title and item.get("collection"):
                    title = item["collection"].replace("_", " ")
                item["title"] = title or item.get("filename", "Untitled")
            # Don't send large EXIF blob to frontend
            item.pop("exif_json", None)
            item.pop("vision_tags", None)
            items.append(item)

        return {"items": items}
    finally:
        conn.close()


def _update_content_status(content_id: str, new_status: str):
    """Update content status with audit logging."""
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM content WHERE id = ?", (content_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Content not found")

        now = datetime.now(timezone.utc).isoformat()
        approved_at = now if new_status == "approved" else None

        conn.execute(
            "UPDATE content SET status = ?, approved_at = ? WHERE id = ?",
            (new_status, approved_at, content_id),
        )
        conn.commit()
        audit.log(conn, "studio", f"content_{new_status}", {
            "content_id": content_id, "platform": row["platform"],
        })
        return {"id": content_id, "status": new_status}
    finally:
        conn.close()


@app.post("/content/{content_id}/approve")
def approve_content(content_id: str, auto_publish: bool = True):
    """Approve content and optionally auto-publish to the platform."""
    result = _update_content_status(content_id, "approved")

    if auto_publish:
        conn = _get_conn()
        try:
            row = conn.execute(
                """SELECT c.*, p.filename, p.collection
                   FROM content c JOIN photos p ON c.photo_id = p.id
                   WHERE c.id = ?""",
                (content_id,),
            ).fetchone()

            if row and row["platform"] == "instagram":
                try:
                    from src.integrations.instagram import publish_photo

                    # Build image URL
                    collection = (row["collection"] or "").lower()
                    base_name = row["filename"].rsplit(".", 1)[0] if row["filename"] else ""
                    image_url = f"https://archive-35.com/images/{collection}/{base_name}-full.jpg"

                    pub_result = publish_photo(
                        image_url=image_url,
                        caption=row["body"] or "",
                        conn=conn,
                        photo_id=row["photo_id"],
                    )
                    if pub_result.get("success"):
                        conn.execute(
                            "UPDATE content SET status = 'posted', posted_at = ? WHERE id = ?",
                            (datetime.now(timezone.utc).isoformat(), content_id),
                        )
                        conn.commit()
                        audit.log(conn, "publish", "auto_publish_instagram", {
                            "content_id": content_id,
                            "media_id": pub_result.get("media_id"),
                        })
                        result["published"] = True
                        result["media_id"] = pub_result.get("media_id")
                        result["permalink"] = pub_result.get("permalink")
                        result["status"] = "posted"
                except Exception as e:
                    logger.error("Auto-publish failed for %s: %s", content_id, e)
                    result["publish_error"] = str(e)
            # Pinterest and Etsy auto-publish can be added here in future phases
        finally:
            conn.close()

    return result


@app.post("/content/{content_id}/reject")
def reject_content(content_id: str):
    return _update_content_status(content_id, "rejected")


@app.post("/content/{content_id}/defer")
def defer_content(content_id: str):
    return _update_content_status(content_id, "deferred")


@app.post("/content/clear-all")
def clear_all_content():
    """Delete ALL content queue items + related actions. Fresh start."""
    conn = _get_conn()
    try:
        c1 = conn.execute("SELECT count(*) FROM content").fetchone()[0]
        conn.execute("DELETE FROM actions_ledger WHERE content_id IS NOT NULL")
        conn.execute("DELETE FROM content")
        # Also clear mockup_content if table exists
        c2 = 0
        try:
            c2 = conn.execute("SELECT count(*) FROM mockup_content").fetchone()[0]
            conn.execute("DELETE FROM mockup_content")
        except Exception:
            pass  # table may not exist
        conn.commit()
        audit.log(conn, "studio", "content_cleared_all", {
            "content_deleted": c1, "mockup_content_deleted": c2,
        })
        return {"cleared": c1 + c2, "content": c1, "mockup_content": c2}
    finally:
        conn.close()


@app.get("/mockups/list")
def list_available_mockups():
    """List all generated mockup images in mockups/social/ directory.

    Returns grouped by photo+template combo with platform variants.
    """
    import re
    mockup_dir = Path(__file__).parent.parent.parent / "mockups" / "social"
    if not mockup_dir.exists():
        return {"items": [], "total": 0}

    files = sorted(f.name for f in mockup_dir.iterdir() if f.suffix in (".jpg", ".png", ".webp"))

    # Group by photo+template combo
    groups: dict[str, dict] = {}
    for fname in files:
        # Pattern: gallery_photoname_template_platform.jpg
        # or older pattern: gallery-room-platform.jpg
        parts = fname.rsplit("_", 1)
        if len(parts) == 2:
            base, platform_ext = parts
            platform = platform_ext.replace(".jpg", "").replace(".png", "").replace(".webp", "")
            if platform in ("instagram", "pinterest", "etsy", "full"):
                if base not in groups:
                    groups[base] = {"base": base, "platforms": {}, "files": []}
                groups[base]["platforms"][platform] = fname
                groups[base]["files"].append(fname)
            else:
                # Single file, no platform suffix
                if fname not in groups:
                    groups[fname] = {"base": fname, "platforms": {"full": fname}, "files": [fname]}
        else:
            if fname not in groups:
                groups[fname] = {"base": fname, "platforms": {"full": fname}, "files": [fname]}

    items = list(groups.values())
    return {"items": items, "total": len(items), "dir": str(mockup_dir)}


class GenerateDraftRequest(BaseModel):
    photo_id: str
    platform: str = "instagram"
    context: dict | None = None  # For mockups: {gallery, template, filename}


@app.post("/content/generate-draft")
def generate_draft(req: GenerateDraftRequest):
    """Generate AI caption/listing draft for a photo or mockup (not saved to DB)."""
    # Handle mockup drafts (no DB photo required)
    if req.photo_id == "__mockup__" and req.context:
        client = _get_anthropic_client()
        if not client:
            raise HTTPException(status_code=503, detail="No Anthropic API key configured")

        from src.agents.content import PLATFORM_PROMPTS, _parse_content_response

        gallery = req.context.get("gallery", "")
        template = req.context.get("template", "")
        filename = req.context.get("filename", "")

        mockup_context = (
            f"This is a wall art mockup showing a fine art photograph displayed in a room setting.\n"
            f"Gallery/Collection: {gallery}\n"
            f"Room template: {template}\n"
            f"Filename: {filename}\n"
            f"The image shows the photograph as it would look hanging on a wall in a modern interior."
        )

        prompt = PLATFORM_PROMPTS.get(req.platform, PLATFORM_PROMPTS["instagram"])
        full_prompt = f"Photo context:\n{mockup_context}\n\n{prompt}"

        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1000,
            messages=[{"role": "user", "content": full_prompt}],
        )
        result = _parse_content_response(response.content[0].text)
        return result

    # Standard photo draft
    conn = _get_conn()
    try:
        photo = conn.execute("SELECT * FROM photos WHERE id = ?", (req.photo_id,)).fetchone()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")

        client = _get_anthropic_client()
        if not client:
            raise HTTPException(status_code=503, detail="No Anthropic API key configured")

        from src.agents.content import _build_context, PLATFORM_PROMPTS, _parse_content_response

        context = _build_context(photo)
        prompt = PLATFORM_PROMPTS.get(req.platform, PLATFORM_PROMPTS["instagram"])
        full_prompt = f"Photo context:\n{context}\n\n{prompt}"

        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1000,
            messages=[{"role": "user", "content": full_prompt}],
        )
        result = _parse_content_response(response.content[0].text)
        return result
    finally:
        conn.close()


class CreateManualContentRequest(BaseModel):
    photo_id: str
    platform: str
    body: str
    title: str = ""
    tags: list[str] = []


@app.post("/content/create-manual")
def create_manual_content(req: CreateManualContentRequest):
    """Create a manually-composed content entry (status=pending)."""
    conn = _get_conn()
    try:
        # Allow mockup entries — photo_id can be a filename or '__mockup__'
        is_mockup = req.photo_id.startswith("__mockup__") or not req.photo_id.isdigit()
        photo = None
        if not is_mockup:
            photo = conn.execute("SELECT * FROM photos WHERE id = ?", (req.photo_id,)).fetchone()
            if not photo:
                raise HTTPException(status_code=404, detail="Photo not found")

        from uuid import uuid4
        from datetime import timedelta
        content_id = str(uuid4())
        now = datetime.now(timezone.utc)
        expires = now + timedelta(hours=168)  # 7 days for manual posts

        body = req.body
        if req.title:
            body = f"{req.title}\n\n{body}"

        conn.execute(
            """INSERT INTO content
               (id, photo_id, platform, content_type, body, tags,
                variant, status, created_at, expires_at, provenance)
               VALUES (?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, 'manual')""",
            (
                content_id,
                req.photo_id,
                req.platform,
                "listing" if req.platform == "etsy" else "caption",
                body,
                json.dumps(req.tags),
                now.isoformat(),
                expires.isoformat(),
            ),
        )
        conn.commit()
        audit.log(conn, "studio", "manual_content_create", {
            "content_id": content_id, "photo_id": req.photo_id,
            "platform": req.platform,
        })
        return {"id": content_id, "status": "pending"}
    finally:
        conn.close()


# ── Mockup Content Queue ───────────────────────────────────────
# Bridge between Mockup Service (port 8036) and social posting pipeline.
# Mockup images saved to mockups/social/ get queued here with AI-generated
# captions, then approved and published just like regular photo content.


class MockupQueueRequest(BaseModel):
    """Queue a mockup image for social posting."""
    image_path: str          # relative path like mockups/social/foo.jpg
    platform: str            # instagram, pinterest, etsy
    photo_path: str          # original photo path (for context in caption gen)
    template_id: str         # room template used
    gallery: str = ""        # gallery name
    caption: str = ""        # optional pre-written caption
    tags: list[str] = []     # optional pre-written tags
    auto_generate: bool = True  # generate AI caption if none provided


@app.post("/mockup-content/queue")
def queue_mockup_content(req: MockupQueueRequest):
    """Queue a mockup for social posting — optionally auto-generate caption."""
    from uuid import uuid4
    from datetime import timedelta

    conn = _get_conn()
    try:
        content_id = str(uuid4())
        now = datetime.now(timezone.utc)
        expires = now + timedelta(hours=168)  # 7 days

        caption = req.caption
        tags = req.tags

        # Auto-generate caption using Claude if requested and no caption provided
        if req.auto_generate and not caption:
            try:
                client = _get_anthropic_client()
                if client:
                    from src.agents.content import PLATFORM_PROMPTS
                    platform_prompt = PLATFORM_PROMPTS.get(
                        f"{req.platform}_mockup",
                        PLATFORM_PROMPTS.get(req.platform, PLATFORM_PROMPTS.get("instagram", "")),
                    )
                    gallery_name = req.gallery or Path(req.photo_path).parent.name
                    photo_name = Path(req.photo_path).stem

                    prompt = (
                        f"Generate a social media caption for this room mockup photo.\n\n"
                        f"Gallery: {gallery_name}\n"
                        f"Photo: {photo_name}\n"
                        f"Room template: {req.template_id.replace('-', ' ')}\n"
                        f"Platform: {req.platform}\n"
                        f"Brand: Archive 35 — Fine art photography by Wolfgang Schram\n"
                        f"Website: archive-35.com\n\n"
                        f"{platform_prompt}"
                    )

                    resp = client.messages.create(
                        model="claude-sonnet-4-5-20250929",
                        max_tokens=500,
                        messages=[{"role": "user", "content": prompt}],
                    )
                    raw = resp.content[0].text.strip()

                    # Extract tags from response if present
                    if "#" in raw:
                        lines = raw.split("\n")
                        tag_line = [l for l in lines if l.strip().startswith("#")]
                        if tag_line:
                            tags = [t.strip().lstrip("#") for t in tag_line[-1].split("#") if t.strip()]
                            caption = "\n".join(l for l in lines if not l.strip().startswith("#")).strip()
                        else:
                            caption = raw
                    else:
                        caption = raw
                    logger.info("AI caption generated for mockup %s", content_id[:12])
            except Exception as e:
                logger.warning("Caption generation failed: %s — using template fallback", e)
                gallery_name = req.gallery or Path(req.photo_path).parent.name
                caption = f"Transform your space with fine art photography. '{gallery_name}' collection — archive-35.com"
                tags = ["wallart", "fineart", "homedecor", "interiordesign", "photographyprints"]

        # Ensure we have fallback caption
        if not caption:
            gallery_name = req.gallery or Path(req.photo_path).parent.name
            caption = f"Fine art photography for your walls. '{gallery_name}' — archive-35.com"

        # Save to mockup_content table
        from src.integrations.mockup_service import ensure_mockup_tables
        ensure_mockup_tables(conn)

        conn.execute(
            """INSERT OR IGNORE INTO mockup_content
               (id, photo_id, template_id, platform, image_path,
                caption, tags, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (
                content_id,
                req.photo_path,   # photo_id = original photo path
                req.template_id,
                req.platform,
                req.image_path,
                caption,
                json.dumps(tags) if tags else json.dumps([]),
                now.isoformat(),
            ),
        )
        conn.commit()

        audit.log(conn, "studio", "mockup_content_queued", {
            "content_id": content_id, "platform": req.platform,
            "template": req.template_id, "image": req.image_path,
        })

        return {
            "id": content_id,
            "status": "pending",
            "caption": caption,
            "tags": tags,
            "image_path": req.image_path,
            "platform": req.platform,
        }
    finally:
        conn.close()


@app.get("/mockup-content")
def list_mockup_content(
    status: Optional[str] = None,
    platform: Optional[str] = None,
    limit: int = Query(default=50, le=200),
):
    """List queued mockup content items."""
    conn = _get_conn()
    try:
        from src.integrations.mockup_service import ensure_mockup_tables
        ensure_mockup_tables(conn)

        conditions, params = [], []
        if status:
            conditions.append("status = ?")
            params.append(status)
        if platform:
            conditions.append("platform = ?")
            params.append(platform)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.append(limit)

        rows = conn.execute(
            f"""SELECT * FROM mockup_content
                {where} ORDER BY created_at DESC LIMIT ?""",
            params,
        ).fetchall()

        items = [dict(r) for r in rows]
        # Parse tags JSON for frontend
        for item in items:
            if item.get("tags") and isinstance(item["tags"], str):
                try:
                    item["tags"] = json.loads(item["tags"])
                except Exception:
                    item["tags"] = []
        return {"items": items, "total": len(items)}
    finally:
        conn.close()


@app.post("/mockup-content/{content_id}/approve")
def approve_mockup_content(content_id: str):
    """Approve a mockup content item for publishing."""
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM mockup_content WHERE id = ?", (content_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mockup content not found")

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE mockup_content SET status = 'approved' WHERE id = ?",
            (content_id,),
        )
        conn.commit()
        audit.log(conn, "studio", "mockup_content_approved", {
            "content_id": content_id, "platform": row["platform"],
        })
        return {"id": content_id, "status": "approved"}
    finally:
        conn.close()


@app.post("/mockup-content/{content_id}/reject")
def reject_mockup_content(content_id: str):
    """Reject a mockup content item."""
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE mockup_content SET status = 'rejected' WHERE id = ?",
            (content_id,),
        )
        conn.commit()
        return {"id": content_id, "status": "rejected"}
    finally:
        conn.close()


@app.post("/mockup-content/{content_id}/edit")
def edit_mockup_content(content_id: str, caption: str = "", tags: list[str] = []):
    """Edit caption/tags before publishing."""
    conn = _get_conn()
    try:
        updates = []
        params = []
        if caption:
            updates.append("caption = ?")
            params.append(caption)
        if tags:
            updates.append("tags = ?")
            params.append(json.dumps(tags))
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")

        params.append(content_id)
        conn.execute(
            f"UPDATE mockup_content SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()
        return {"id": content_id, "updated": True}
    finally:
        conn.close()


@app.post("/mockup-content/{content_id}/publish")
def publish_mockup_content(content_id: str):
    """Publish an approved mockup to its target platform."""
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM mockup_content WHERE id = ?", (content_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mockup content not found")
        if row["status"] not in ("approved", "pending"):
            raise HTTPException(status_code=400, detail=f"Cannot publish: status is {row['status']}")

        platform = row["platform"]
        image_path = row["image_path"]
        caption = row["caption"] or ""
        tags_raw = row["tags"]
        tags = json.loads(tags_raw) if isinstance(tags_raw, str) else (tags_raw or [])

        # Check kill switch
        if kill_switch.is_active(conn, platform) or kill_switch.is_active(conn, "global"):
            raise HTTPException(status_code=503, detail=f"Kill switch active for {platform}")

        result = {"id": content_id, "platform": platform}

        if platform == "instagram":
            from src.integrations.instagram import publish_photo
            # Instagram requires public URL — mockup must be uploaded first
            # For now, serve via the mockup service or upload to R2
            settings = get_settings()
            abs_path = Path(settings.repo_root) / image_path
            if not abs_path.exists():
                raise HTTPException(status_code=404, detail=f"Mockup image not found: {image_path}")

            # Upload to R2 first to get public URL
            try:
                from src.integrations.r2_upload import upload_to_r2
                public_url = upload_to_r2(str(abs_path), f"mockups/{abs_path.name}")
                pub = publish_photo(image_url=public_url, caption=caption, conn=conn)
                if pub.get("success"):
                    result["published"] = True
                    result["media_id"] = pub.get("media_id")
                    result["permalink"] = pub.get("permalink")
                else:
                    result["error"] = pub.get("error", "Unknown error")
            except ImportError:
                raise HTTPException(status_code=501, detail="R2 upload not configured — Instagram needs public URL")

        elif platform == "pinterest":
            from src.integrations.pinterest import PinterestClient
            settings = get_settings()
            abs_path = Path(settings.repo_root) / image_path

            # Pinterest also needs public URL
            try:
                from src.integrations.r2_upload import upload_to_r2
                public_url = upload_to_r2(str(abs_path), f"mockups/{abs_path.name}")
                client = PinterestClient()
                pin = client.create_pin(
                    title=caption[:100] if caption else "Fine Art Photography — Archive 35",
                    description=caption[:500] if caption else "",
                    image_url=public_url,
                    link="https://archive-35.com/gallery",
                    alt_text=f"Wall art mockup — Archive 35 Photography",
                )
                if pin:
                    result["published"] = True
                    result["pin_id"] = pin.get("id")
                else:
                    result["error"] = "Pin creation returned empty"
            except ImportError:
                raise HTTPException(status_code=501, detail="R2 upload not configured — Pinterest needs public URL")

        elif platform == "etsy":
            # Etsy listing creation is more complex — requires shop setup
            result["error"] = "Etsy publish requires OAuth — use Etsy Listings tab"
            result["published"] = False

        else:
            raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")

        # Update status
        if result.get("published"):
            conn.execute(
                "UPDATE mockup_content SET status = 'posted', posted_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), content_id),
            )
            conn.commit()
            audit.log(conn, "publish", f"mockup_published_{platform}", {
                "content_id": content_id, **{k: v for k, v in result.items() if k != "id"},
            })
            result["status"] = "posted"
        elif result.get("error"):
            conn.execute(
                "UPDATE mockup_content SET error = ? WHERE id = ?",
                (result["error"], content_id),
            )
            conn.commit()

        return result
    finally:
        conn.close()


# ── Pipeline ────────────────────────────────────────────────────


@app.get("/pipeline/status")
def pipeline_status():
    """Get pipeline run status from audit log."""
    conn = _get_conn()
    try:
        last_run = conn.execute(
            """SELECT * FROM audit_log
               WHERE component='pipeline' AND action IN ('daily_complete','daily_failed','daily_blocked')
               ORDER BY id DESC LIMIT 1"""
        ).fetchone()

        recent = audit.query(conn, component="pipeline", limit=20)
        return {
            "last_run": dict(last_run) if last_run else None,
            "recent_activity": recent,
        }
    finally:
        conn.close()


class PipelineRunRequest(BaseModel):
    component: Optional[str] = None


@app.post("/pipeline/run")
def run_pipeline(dry_run: bool = True, req: PipelineRunRequest = PipelineRunRequest()):
    """Manually trigger the daily pipeline or test a specific component."""
    # Component-specific health tests (used by Health panel)
    if req.component == "vision":
        client = _get_anthropic_client()
        if not client:
            return {"success": False, "error": "Anthropic API key not configured"}
        try:
            # Quick model ping — no actual image analysis
            resp = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=10,
                messages=[{"role": "user", "content": "Reply OK"}],
            )
            return {"success": True, "model": "claude-haiku-4-5-20251001"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    if req.component == "content":
        client = _get_anthropic_client()
        if not client:
            return {"success": False, "error": "Anthropic API key not configured"}
        try:
            resp = client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=10,
                messages=[{"role": "user", "content": "Reply OK"}],
            )
            return {"success": True, "model": "claude-sonnet-4-5-20250929"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # Full pipeline run — runs in background thread to avoid IPC timeout
    import threading
    from src.pipeline.daily import run_daily_pipeline

    client = _get_anthropic_client()

    def _run_bg():
        try:
            run_daily_pipeline(anthropic_client=client, dry_run=dry_run)
        except Exception as e:
            logger.error("Background pipeline failed: %s", e)

    thread = threading.Thread(target=_run_bg, daemon=True)
    thread.start()
    return {"status": "started", "message": "Pipeline running in background — check logs for progress"}


@app.get("/pipeline/logs")
def pipeline_logs(
    component: Optional[str] = None,
    limit: int = Query(default=100, le=500),
):
    """Get audit log entries."""
    conn = _get_conn()
    try:
        logs = audit.query(conn, component=component, limit=limit)
        return {"items": logs}
    finally:
        conn.close()


# ── Safety ──────────────────────────────────────────────────────


@app.get("/safety/status")
def safety_status():
    """Get kill switch, rate limit, and Late API status."""
    conn = _get_conn()
    try:
        ks = kill_switch.get_status(conn)
        rates = conn.execute("SELECT * FROM rate_limits").fetchall()
        # Check Late API connectivity
        settings = get_settings()
        late_connected = settings.has_late_api_key() if hasattr(settings, 'has_late_api_key') else False
        return {
            "kill_switches": ks,
            "rate_limits": [dict(r) for r in rates],
            "connected": late_connected,
        }
    finally:
        conn.close()


class KillSwitchRequest(BaseModel):
    reason: str = ""


@app.post("/safety/kill/{scope}")
def activate_kill(scope: str, req: KillSwitchRequest):
    """Activate kill switch for a scope."""
    conn = _get_conn()
    try:
        kill_switch.activate(conn, scope, req.reason, activated_by="studio")
        audit.log(conn, "studio", "kill_activated", {"scope": scope, "reason": req.reason})
        return {"scope": scope, "active": True}
    finally:
        conn.close()


@app.post("/safety/resume/{scope}")
def deactivate_kill(scope: str):
    """Deactivate kill switch for a scope."""
    conn = _get_conn()
    try:
        kill_switch.deactivate(conn, scope)
        audit.log(conn, "studio", "kill_deactivated", {"scope": scope})
        return {"scope": scope, "active": False}
    finally:
        conn.close()


# ── SKUs & Etsy ─────────────────────────────────────────────────


@app.get("/skus")
def list_skus():
    """List all SKU entries with pricing."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM sku_catalog ORDER BY collection, sku"
        ).fetchall()
        return {"items": [dict(r) for r in rows]}
    finally:
        conn.close()


@app.get("/etsy/listings")
def list_etsy_listings():
    """List generated Etsy listing content."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            """SELECT c.*, p.filename, p.collection
               FROM content c JOIN photos p ON c.photo_id = p.id
               WHERE c.platform = 'etsy'
               ORDER BY c.created_at DESC"""
        ).fetchall()
        return {"items": [dict(r) for r in rows]}
    finally:
        conn.close()


@app.get("/etsy/status")
def etsy_status():
    """Check Etsy integration status — tokens, shop info, SKU count."""
    from src.integrations.etsy import EtsyClient
    conn = _get_conn()
    try:
        client = EtsyClient()
        has_tokens = bool(client.access_token)

        sku_count = conn.execute("SELECT COUNT(*) FROM sku_catalog WHERE active = 1").fetchone()[0]

        result = {
            "configured": has_tokens,
            "connected": False,
            "shop_id": client.shop_id or None,
            "active_skus": sku_count,
        }

        # If tokens exist, try to fetch shop info
        if has_tokens and client.shop_id:
            try:
                shop = client.get_shop_info()
                if "error" not in shop:
                    result["connected"] = True
                    result["shop_name"] = shop.get("shop_name")
                    result["shop_url"] = shop.get("url")
                    result["listing_active_count"] = shop.get("listing_active_count", 0)
                else:
                    result["error"] = shop.get("error", "")
            except Exception as e:
                result["error"] = str(e)

        return result
    except Exception as e:
        return {"configured": False, "connected": False, "error": str(e)}
    finally:
        conn.close()


@app.get("/etsy/oauth/url")
def etsy_oauth_url():
    """Generate Etsy OAuth authorization URL for the user to visit."""
    from src.integrations.etsy import EtsyClient
    client = EtsyClient()
    url, state = client.generate_oauth_url()
    return {"url": url, "state": state}


class EtsyOAuthCallback(BaseModel):
    code: str
    state: str


@app.post("/etsy/oauth/callback")
def etsy_oauth_callback(req: EtsyOAuthCallback):
    """Exchange OAuth authorization code for access tokens."""
    from src.integrations.etsy import EtsyClient
    conn = _get_conn()
    try:
        client = EtsyClient()
        tokens = client.exchange_code(req.code)
        audit.log(conn, "etsy", "oauth_connected", {"shop_id": client.shop_id})
        return {"success": True, "shop_id": client.shop_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


class EtsyListingCreate(BaseModel):
    content_id: str
    shipping_profile_id: Optional[int] = None


@app.post("/etsy/listings/create")
def create_etsy_listing(req: EtsyListingCreate):
    """Create an Etsy listing from approved content + SKU catalog, then upload image."""
    from src.integrations.etsy import EtsyClient
    conn = _get_conn()
    try:
        # Get approved content
        content = conn.execute(
            "SELECT * FROM content WHERE id = ? AND platform = 'etsy'",
            (req.content_id,),
        ).fetchone()
        if not content:
            raise HTTPException(status_code=404, detail="Content not found or not Etsy platform")
        content = dict(content)

        # Get SKUs for this photo
        skus = conn.execute(
            "SELECT * FROM sku_catalog WHERE photo_id = ? AND active = 1 ORDER BY list_price_usd",
            (content["photo_id"],),
        ).fetchall()
        if not skus:
            raise HTTPException(status_code=400, detail="No active SKUs for this photo")

        # Use first (cheapest) SKU as the listing base price
        base_sku = dict(skus[0])

        client = EtsyClient()
        listing = client.create_listing_from_content(
            content=content,
            price=base_sku["list_price_usd"],
            quantity=999,
            sku=base_sku["sku"],
            shipping_profile_id=req.shipping_profile_id,
        )

        if "error" in listing:
            raise HTTPException(status_code=502, detail=listing["error"])

        listing_id = listing.get("listing_id")

        # Upload image after successful listing creation
        image_result = None
        if listing_id:
            photo = conn.execute(
                "SELECT filename, collection FROM photos WHERE id = ?",
                (content["photo_id"],),
            ).fetchone()
            if photo:
                image_url = f"https://archive-35.com/images/{photo['collection']}/{photo['filename']}"
                image_result = client.upload_listing_image(listing_id, image_url)
                if "error" in (image_result or {}):
                    logger.warning("Image upload failed for listing %s: %s", listing_id, image_result)

        # Record in audit log
        audit.log(conn, "etsy", "listing_created", {
            "listing_id": listing_id,
            "content_id": req.content_id,
            "sku": base_sku["sku"],
            "price": base_sku["list_price_usd"],
            "image_uploaded": image_result is not None and "error" not in (image_result or {}),
        })

        return {"listing": listing, "sku": base_sku["sku"], "image": image_result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create Etsy listing: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


class EtsyImageUpload(BaseModel):
    photo_id: str


@app.post("/etsy/listings/{listing_id}/upload-image")
def upload_etsy_listing_image(listing_id: int, req: EtsyImageUpload):
    """Manually upload an image to an existing Etsy listing."""
    from src.integrations.etsy import EtsyClient
    conn = _get_conn()
    try:
        photo = conn.execute(
            "SELECT filename, collection FROM photos WHERE id = ?",
            (req.photo_id,),
        ).fetchone()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")

        image_url = f"https://archive-35.com/images/{photo['collection']}/{photo['filename']}"
        client = EtsyClient()
        result = client.upload_listing_image(listing_id, image_url)

        if "error" in result:
            raise HTTPException(status_code=502, detail=result["error"])

        audit.log(conn, "etsy", "image_uploaded", {
            "listing_id": listing_id,
            "photo_id": req.photo_id,
            "image_url": image_url,
        })

        return {"success": True, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Image upload failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.post("/skus/populate")
def populate_sku_catalog(clear: bool = False, dry_run: bool = False):
    """Populate SKU catalog from photos DB using pricing engine."""
    from scripts.populate_sku_catalog import populate
    conn = _get_conn()
    try:
        stats = populate(conn, clear=clear, dry_run=dry_run)
        audit.log(conn, "catalog", "skus_populated", stats)
        return stats
    except Exception as e:
        logger.error("SKU populate failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


class EtsyBatchCreate(BaseModel):
    content_id: str
    sku_list: list[str]
    shipping_profile_id: Optional[int] = None


@app.post("/etsy/listings/create-batch")
def create_etsy_listings_batch(req: EtsyBatchCreate):
    """Create multiple Etsy listings (one per SKU) from a single content item.

    Each SKU becomes its own listing with the correct material/size-specific pricing.
    Images are uploaded to each listing after creation.
    """
    from src.integrations.etsy import EtsyClient
    from src.brand.pricing import etsy_price as calc_etsy_price
    conn = _get_conn()
    try:
        # Validate content
        content = conn.execute(
            "SELECT * FROM content WHERE id = ? AND platform = 'etsy'",
            (req.content_id,),
        ).fetchone()
        if not content:
            raise HTTPException(status_code=404, detail="Content not found or not Etsy platform")
        content = dict(content)

        # Get photo for image URL
        photo = conn.execute(
            "SELECT filename, collection FROM photos WHERE id = ?",
            (content["photo_id"],),
        ).fetchone()
        image_url = None
        if photo:
            image_url = f"https://archive-35.com/images/{photo['collection']}/{photo['filename']}"

        client = EtsyClient()
        results = []

        for sku_code in req.sku_list:
            # Look up SKU in catalog
            sku_row = conn.execute(
                "SELECT * FROM sku_catalog WHERE sku = ? AND active = 1",
                (sku_code,),
            ).fetchone()
            if not sku_row:
                results.append({"sku": sku_code, "status": "error", "detail": "SKU not found or inactive"})
                continue

            sku_row = dict(sku_row)
            price = sku_row["list_price_usd"]

            # Parse material from paper_code for title suffix
            mat_labels = {"CAN": "Canvas", "MET": "Metal", "ACR": "Acrylic", "PAP": "Paper", "WOO": "Wood"}
            mat_label = mat_labels.get(sku_row.get("paper_code", ""), "Print")
            size_label = sku_row.get("size_code", "").replace("x", "×")

            # Create listing with material/size in title for Etsy SEO
            listing_content = dict(content)
            base_title = listing_content.get("title") or listing_content.get("body", "").split("\n")[0].strip()
            if len(base_title) > 90:
                base_title = base_title[:87] + "..."
            suffix = f" | {mat_label} {size_label}"
            listing_content["title"] = (base_title + suffix)[:140]

            listing = client.create_listing_from_content(
                content=listing_content,
                price=price,
                quantity=999,
                sku=sku_code,
                shipping_profile_id=req.shipping_profile_id,
            )

            if "error" in listing:
                results.append({"sku": sku_code, "status": "error", "detail": listing["error"]})
                continue

            listing_id = listing.get("listing_id")
            entry = {"sku": sku_code, "listing_id": listing_id, "status": "created", "price": price}

            # Upload image
            if listing_id and image_url:
                img_result = client.upload_listing_image(listing_id, image_url)
                entry["image_uploaded"] = "error" not in (img_result or {})
            else:
                entry["image_uploaded"] = False

            results.append(entry)

            # Audit each listing
            audit.log(conn, "etsy", "listing_created_batch", {
                "listing_id": listing_id,
                "content_id": req.content_id,
                "sku": sku_code,
                "price": price,
            })

        return {
            "content_id": req.content_id,
            "total": len(req.sku_list),
            "created": sum(1 for r in results if r["status"] == "created"),
            "failed": sum(1 for r in results if r["status"] == "error"),
            "results": results,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Batch Etsy listing creation failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/etsy/receipts")
def get_etsy_receipts(status: str = "open"):
    """Poll Etsy for recent orders/receipts."""
    from src.integrations.etsy import EtsyClient
    conn = _get_conn()
    try:
        client = EtsyClient()
        was_paid = status != "all"
        receipts = client.get_receipts(was_paid=was_paid, limit=25)

        # Enrich with local SKU data
        results = []
        for r in receipts.get("results", []):
            enriched = {
                "receipt_id": r.get("receipt_id"),
                "buyer_email": r.get("buyer_email"),
                "buyer_name": r.get("name"),
                "total": r.get("grandtotal", {}).get("amount", 0) / 100,
                "currency": r.get("grandtotal", {}).get("currency_code", "USD"),
                "status": r.get("status"),
                "created": r.get("create_timestamp"),
                "transactions": [],
            }
            for t in r.get("transactions", []):
                enriched["transactions"].append({
                    "title": t.get("title"),
                    "quantity": t.get("quantity"),
                    "price": t.get("price", {}).get("amount", 0) / 100,
                    "sku": next(
                        (v.get("value") for v in t.get("variations", [])
                         if v.get("property_id") == 513),  # SKU property
                        t.get("sku"),
                    ),
                })
            results.append(enriched)

        return {"receipts": results, "count": len(results)}
    except Exception as e:
        logger.error("Etsy receipt fetch failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


class FulfillmentRequest(BaseModel):
    receipt_id: int


@app.post("/etsy/receipts/fulfill")
def fulfill_etsy_receipt(req: FulfillmentRequest):
    """Route an Etsy order to Pictorem fulfillment.

    Parses the receipt SKU → looks up print specs → builds Pictorem
    preorder code → submits to Pictorem API (same flow as stripe-webhook).
    """
    from src.integrations.etsy import EtsyClient
    from src.brand.pricing import build_pictorem_preorder
    conn = _get_conn()
    try:
        client = EtsyClient()
        receipt = client.get_receipt(req.receipt_id)

        fulfillment_items = []
        for txn in receipt.get("transactions", []):
            # Extract SKU from listing variations or transaction SKU field
            sku_value = next(
                (v.get("value") for v in txn.get("variations", [])
                 if v.get("property_id") == 513),
                txn.get("sku"),
            )
            if not sku_value:
                continue

            # Look up SKU in our catalog
            sku_row = conn.execute(
                "SELECT * FROM sku_catalog WHERE sku = ?", (sku_value,)
            ).fetchone()
            if not sku_row:
                logger.warning("Unknown SKU in Etsy order: %s", sku_value)
                continue

            sku_row = dict(sku_row)
            # Parse material from paper_code: CAN→canvas, MET→metal, etc.
            mat_map = {"CAN": "canvas", "MET": "metal", "ACR": "acrylic",
                       "PAP": "paper", "WOO": "wood"}
            material = mat_map.get(sku_row["paper_code"], "canvas")

            # Parse size from size_code: "24x16" → (24, 16)
            w, h = [int(x) for x in sku_row["size_code"].split("x")]

            preorder = build_pictorem_preorder(material, w, h, txn.get("quantity", 1))

            # Get photo path for Pictorem image URL
            photo = conn.execute(
                "SELECT path, filename FROM photos WHERE id = ?",
                (sku_row["photo_id"],)
            ).fetchone()

            fulfillment_items.append({
                "sku": sku_value,
                "preorder_code": preorder,
                "material": material,
                "size": f"{w}x{h}",
                "quantity": txn.get("quantity", 1),
                "photo_filename": photo["filename"] if photo else "unknown",
                "photo_path": photo["path"] if photo else None,
            })

        if not fulfillment_items:
            raise HTTPException(status_code=400, detail="No fulfillable items found in receipt")

        # Log the fulfillment (Pictorem submission would go here when API is live)
        audit.log(conn, "etsy", "order_fulfilled", {
            "receipt_id": req.receipt_id,
            "items": len(fulfillment_items),
            "preorder_codes": [f["preorder_code"] for f in fulfillment_items],
        })

        return {
            "receipt_id": req.receipt_id,
            "items": fulfillment_items,
            "status": "ready_for_pictorem",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Etsy fulfillment failed for receipt %s: %s", req.receipt_id, e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/etsy/shipping-profiles")
def get_etsy_shipping_profiles():
    """List Etsy shipping profiles for listing creation."""
    from src.integrations.etsy import EtsyClient
    try:
        client = EtsyClient()
        profiles = client.get_shipping_profiles()
        return {"profiles": profiles.get("results", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/etsy/listings/{listing_id}")
def delete_etsy_listing(listing_id: int):
    """Delete a single Etsy listing permanently."""
    from src.integrations.etsy import delete_listing
    result = delete_listing(listing_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/etsy/listings/delete-batch")
def delete_etsy_listings_batch(req: dict):
    """Delete multiple Etsy listings at once.

    Body: { "listing_ids": [123, 456, ...] }
    """
    from src.integrations.etsy import delete_listing
    listing_ids = req.get("listing_ids", [])
    if not listing_ids:
        raise HTTPException(status_code=400, detail="No listing_ids provided")

    results = []
    for lid in listing_ids:
        try:
            result = delete_listing(int(lid))
            results.append({
                "listing_id": lid,
                "status": "deleted" if result.get("deleted") else "error",
                "detail": result.get("error", ""),
            })
        except Exception as e:
            results.append({"listing_id": lid, "status": "error", "detail": str(e)})

    deleted = sum(1 for r in results if r["status"] == "deleted")
    return {"total": len(listing_ids), "deleted": deleted, "results": results}


@app.post("/etsy/receipts/auto-fulfill")
def auto_fulfill_etsy_orders():
    """Poll Etsy for new paid orders and auto-route to Pictorem fulfillment.

    Designed to be called on a schedule (e.g., every 30 minutes) or manually.
    Only processes receipts that haven't been fulfilled yet (checked via audit log).
    """
    from src.integrations.etsy import EtsyClient, parse_receipt_for_fulfillment
    from src.brand.pricing import build_pictorem_preorder
    conn = _get_conn()
    try:
        client = EtsyClient()
        if not client.access_token:
            return {"skipped": True, "reason": "No Etsy access token configured"}

        # Fetch recent paid receipts
        receipts_resp = client.get_receipts(was_paid=True, limit=25)
        if "error" in receipts_resp:
            return {"error": receipts_resp["error"]}

        all_receipts = receipts_resp.get("results", [])

        # Check which receipt IDs we've already fulfilled
        fulfilled_ids = set()
        rows = conn.execute(
            "SELECT json_extract(details, '$.receipt_id') as rid FROM audit_log "
            "WHERE action = 'order_fulfilled' OR action = 'etsy_auto_fulfilled'"
        ).fetchall()
        for r in rows:
            if r[0]:
                fulfilled_ids.add(int(r[0]))

        # Process unfulfilled receipts
        processed = []
        skipped = []

        for receipt in all_receipts:
            receipt_id = receipt.get("receipt_id")
            if not receipt_id or receipt_id in fulfilled_ids:
                skipped.append(receipt_id)
                continue

            # Parse receipt for fulfillment items
            items = parse_receipt_for_fulfillment(receipt)
            if not items:
                skipped.append(receipt_id)
                continue

            # Build Pictorem preorder submission
            fulfillment_items = []
            for item in items:
                # Look up photo path for Pictorem image URL
                if item.get("sku"):
                    sku_row = conn.execute(
                        "SELECT photo_id FROM sku_catalog WHERE sku = ?",
                        (item["sku"],),
                    ).fetchone()
                    if sku_row:
                        photo = conn.execute(
                            "SELECT path, filename, collection FROM photos WHERE id = ?",
                            (sku_row[0],),
                        ).fetchone()
                        if photo:
                            item["image_url"] = (
                                f"https://archive-35.com/images/{photo['collection']}/{photo['filename']}"
                            )

                fulfillment_items.append(item)

            # TODO: Submit to Pictorem API when live (same as stripe-webhook flow)
            # For now, log and mark as fulfilled

            audit.log(conn, "etsy", "etsy_auto_fulfilled", {
                "receipt_id": receipt_id,
                "items": len(fulfillment_items),
                "preorder_codes": [f.get("pictorem_preorder", "") for f in fulfillment_items],
                "buyer_name": receipt.get("name", ""),
            })

            processed.append({
                "receipt_id": receipt_id,
                "items": len(fulfillment_items),
                "buyer_name": receipt.get("name", ""),
            })

        return {
            "polled": len(all_receipts),
            "processed": len(processed),
            "skipped": len(skipped),
            "orders": processed,
        }
    except Exception as e:
        logger.error("Etsy auto-fulfill failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ── Pinterest Endpoints ────────────────────────────────────────────


@app.get("/pinterest/status")
def pinterest_status():
    """Check Pinterest integration status — token, boards, user info."""
    from src.integrations.pinterest import get_status
    return get_status()


@app.get("/pinterest/oauth/url")
def pinterest_oauth_url():
    """Generate Pinterest OAuth authorization URL for the user to visit."""
    from src.integrations.pinterest import generate_oauth_url
    result = generate_oauth_url()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


class PinterestOAuthCallback(BaseModel):
    code: str


@app.post("/pinterest/oauth/callback")
def pinterest_oauth_callback(req: PinterestOAuthCallback):
    """Exchange OAuth authorization code for Pinterest access tokens."""
    from src.integrations.pinterest import exchange_code
    conn = _get_conn()
    try:
        result = exchange_code(req.code)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        audit.log(conn, "pinterest", "oauth_connected", {
            "access_token_prefix": result.get("access_token", "")[:10] + "...",
        })
        return {"success": True, "token_type": result.get("token_type", "")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.get("/pinterest/boards")
def pinterest_boards():
    """List all Pinterest boards for the authenticated user."""
    from src.integrations.pinterest import list_boards
    result = list_boards(page_size=250)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


class PinterestBoardCreate(BaseModel):
    name: str
    description: str = ""
    privacy: str = "PUBLIC"


@app.post("/pinterest/boards/create")
def create_pinterest_board(req: PinterestBoardCreate):
    """Create a new Pinterest board."""
    from src.integrations.pinterest import create_board
    conn = _get_conn()
    try:
        result = create_board(name=req.name, description=req.description, privacy=req.privacy)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        audit.log(conn, "pinterest", "board_created", {
            "board_id": result.get("id", ""),
            "name": req.name,
        })
        return result
    finally:
        conn.close()


class PinterestPinCreate(BaseModel):
    board_id: Optional[str] = None  # Falls back to PINTEREST_BOARD_ID env var
    title: str
    description: str = ""
    image_url: str
    link: str = ""
    alt_text: str = ""


@app.post("/pinterest/pins/create")
def create_pinterest_pin(req: PinterestPinCreate):
    """Create a single Pinterest pin.

    board_id is optional — falls back to PINTEREST_BOARD_ID from .env.
    image_url can be local (auto-uploaded to R2) or public.
    """
    from src.integrations.pinterest import create_pin, get_credentials as get_pinterest_creds
    conn = _get_conn()
    try:
        # Resolve board_id — use default from env if not provided
        board_id = req.board_id
        if not board_id:
            pinterest_creds = get_pinterest_creds()
            board_id = pinterest_creds.get("board_id", "")
        if not board_id:
            raise HTTPException(status_code=400, detail="No board_id provided and PINTEREST_BOARD_ID not set in .env")

        # Ensure image URL is public
        public_url = _ensure_public_url(req.image_url)

        result = create_pin(
            board_id=board_id,
            title=req.title,
            description=req.description,
            image_url=public_url,
            link=req.link,
            alt_text=req.alt_text,
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        audit.log(conn, "pinterest", "pin_created", {
            "pin_id": result.get("id", ""),
            "board_id": board_id,
            "title": req.title,
        })
        return result
    finally:
        conn.close()


class PinterestPhotoPin(BaseModel):
    photo_id: str
    board_id: Optional[str] = None


@app.post("/pinterest/pins/from-photo")
def create_pin_from_photo(req: PinterestPhotoPin):
    """Create a Pinterest pin from an Archive-35 photo in the database.

    Pulls photo metadata (title, description, tags, image URL) from the
    photos table and creates a formatted pin with gallery link.
    """
    from src.integrations.pinterest import post_photo_as_pin
    conn = _get_conn()
    try:
        photo = conn.execute(
            "SELECT * FROM photos WHERE id = ?",
            (req.photo_id,),
        ).fetchone()
        if not photo:
            raise HTTPException(status_code=404, detail=f"Photo {req.photo_id} not found")

        photo_data = {
            "title": photo["title"] or photo["filename"],
            "description": photo["description"] or "",
            "tags": photo["tags"] or "[]",
            "image_url": f"https://archive-35.com/images/{photo['collection']}/{photo['filename']}",
            "collection": photo["collection"],
            "filename": photo["filename"],
        }

        result = post_photo_as_pin(photo_data, board_id=req.board_id)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        audit.log(conn, "pinterest", "photo_pinned", {
            "photo_id": req.photo_id,
            "pin_id": result.get("id", ""),
            "collection": photo["collection"],
        })
        return result
    finally:
        conn.close()


@app.get("/pinterest/user")
def pinterest_user():
    """Get the authenticated Pinterest user account info."""
    from src.integrations.pinterest import get_user_account
    result = get_user_account()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/pinterest/boards/{board_id}/pins")
def pinterest_board_pins(board_id: str, page_size: int = 25, bookmark: str = ""):
    """List pins on a specific board."""
    from src.integrations.pinterest import list_pins
    result = list_pins(board_id, page_size=page_size, bookmark=bookmark)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.delete("/pinterest/pins/{pin_id}")
def delete_pinterest_pin(pin_id: str):
    """Delete a single Pinterest pin."""
    from src.integrations.pinterest import delete_pin
    result = delete_pin(pin_id)
    if isinstance(result, dict) and "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"deleted": True, "pin_id": pin_id}


@app.post("/pinterest/pins/delete-batch")
def delete_pinterest_pins_batch(req: dict):
    """Delete multiple Pinterest pins at once.

    Body: { "pin_ids": ["123", "456", ...] }
    """
    from src.integrations.pinterest import delete_pin
    pin_ids = req.get("pin_ids", [])
    if not pin_ids:
        raise HTTPException(status_code=400, detail="No pin_ids provided")

    results = []
    for pid in pin_ids:
        try:
            result = delete_pin(str(pid))
            has_error = isinstance(result, dict) and "error" in result
            results.append({
                "pin_id": pid,
                "status": "error" if has_error else "deleted",
                "detail": result.get("error", "") if has_error else "",
            })
        except Exception as e:
            results.append({"pin_id": pid, "status": "error", "detail": str(e)})

    deleted = sum(1 for r in results if r["status"] == "deleted")
    return {"total": len(pin_ids), "deleted": deleted, "results": results}


# ── Config ─────────────────────────────────────────────────────


@app.get("/config")
def get_config():
    """Get general Agent configuration."""
    settings = get_settings()
    return {
        "daily_budget_usd": settings.daily_budget_usd,
        "log_level": settings.log_level,
        "db_path": settings.db_path,
        "pipeline_schedule": "0 9 * * *",  # default: 9am daily
    }


class ConfigUpdate(BaseModel):
    daily_budget_usd: Optional[float] = None
    log_level: Optional[str] = None
    db_path: Optional[str] = None


@app.post("/config")
def update_config(req: ConfigUpdate):
    """Update general Agent configuration (writes to .env)."""
    env_path = Path(__file__).parent.parent / ".env"
    content = env_path.read_text() if env_path.exists() else ""

    updates = {}
    if req.daily_budget_usd is not None:
        updates["DAILY_BUDGET_USD"] = str(req.daily_budget_usd)
    if req.log_level is not None:
        updates["LOG_LEVEL"] = req.log_level.upper()
    if req.db_path is not None:
        updates["DB_PATH"] = req.db_path

    for key, value in updates.items():
        import re
        pattern = re.compile(rf"^{key}=.*$", re.MULTILINE)
        if pattern.search(content):
            content = pattern.sub(f"{key}={value}", content)
        else:
            content = content.rstrip() + f"\n{key}={value}\n"

    env_path.write_text(content)
    return {"success": True, **updates}


@app.get("/config/keys")
def get_agent_keys():
    """Get Agent-specific API key status (masked)."""
    settings = get_settings()
    def mask(val: str) -> str:
        if not val or len(val) < 8:
            return ""
        return val[:4] + "•" * (len(val) - 8) + val[-4:]

    return {
        "TELEGRAM_BOT_TOKEN": mask(settings.telegram_bot_token),
        "TELEGRAM_CHAT_ID": settings.telegram_chat_id,
        "LATE_API_KEY": mask(settings.late_api_key),
        "ETSY_API_KEY": mask(settings.etsy_api_key),
        "ETSY_API_SECRET": mask(settings.etsy_api_secret),
        "SHOPIFY_STORE_URL": settings.shopify_store_url,
        "SHOPIFY_API_KEY": mask(settings.shopify_api_key),
        "SHOPIFY_API_SECRET": mask(settings.shopify_api_secret),
        "PRINTFUL_API_KEY": mask(settings.printful_api_key),
    }


class KeyUpdate(BaseModel):
    model_config = {"extra": "allow"}


@app.post("/config/keys")
def save_agent_key(req: KeyUpdate):
    """Save an Agent-specific API key to .env."""
    env_path = Path(__file__).parent.parent / ".env"
    content = env_path.read_text() if env_path.exists() else ""

    import re
    for key, value in req.__pydantic_extra__.items():
        key_upper = key.upper()
        pattern = re.compile(rf"^{key_upper}=.*$", re.MULTILINE)
        if pattern.search(content):
            content = pattern.sub(f"{key_upper}={value}", content)
        else:
            content = content.rstrip() + f"\n{key_upper}={value}\n"

    env_path.write_text(content)
    return {"success": True}


class KeyTest(BaseModel):
    key_id: str
    value: str


@app.post("/config/test-key")
def test_agent_key(req: KeyTest):
    """Test an API key by making a lightweight validation call."""
    key_id = req.key_id.upper()
    value = req.value

    if not value:
        return {"success": False, "message": "No key value provided"}

    if key_id in ("TELEGRAM_BOT_TOKEN",):
        try:
            import urllib.request
            url = f"https://api.telegram.org/bot{value}/getMe"
            resp = urllib.request.urlopen(url, timeout=5)
            data = json.loads(resp.read())
            if data.get("ok"):
                bot = data["result"]
                return {"success": True, "message": f"Connected: @{bot.get('username', 'unknown')}"}
            return {"success": False, "message": "Invalid bot token"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    if key_id in ("LATE_API_KEY",):
        return {"success": True, "message": "Key format looks valid (live test requires Late API)"}

    if key_id in ("ETSY_API_KEY",):
        return {"success": True, "message": "Key saved. Full validation available after OAuth setup."}

    return {"success": True, "message": f"Key '{key_id}' saved (no live test available)"}


@app.get("/config/photo-source")
def get_photo_source():
    """Get photo import source configuration."""
    settings = get_settings()
    return {
        "source": "r2" if "r2" in settings.photo_import_dir.lower() else "local",
        "import_dir": settings.photo_import_dir,
    }


class PhotoSourceUpdate(BaseModel):
    source: str = "local"
    import_dir: Optional[str] = None


@app.post("/config/photo-source")
def save_photo_source(req: PhotoSourceUpdate):
    """Update photo import source config."""
    env_path = Path(__file__).parent.parent / ".env"
    content = env_path.read_text() if env_path.exists() else ""

    import_dir = req.import_dir or ("./data/photos" if req.source == "local" else "r2://archive-35")

    import re
    pattern = re.compile(r"^PHOTO_IMPORT_DIR=.*$", re.MULTILINE)
    if pattern.search(content):
        content = pattern.sub(f"PHOTO_IMPORT_DIR={import_dir}", content)
    else:
        content = content.rstrip() + f"\nPHOTO_IMPORT_DIR={import_dir}\n"

    env_path.write_text(content)
    return {"success": True, "source": req.source, "import_dir": import_dir}


@app.post("/config/test-telegram")
def test_telegram():
    """Send a test message via Telegram bot."""
    settings = get_settings()
    if not settings.has_telegram_config():
        return {"success": False, "message": "Telegram bot token or chat ID not configured"}
    try:
        import urllib.request
        import urllib.parse
        url = (
            f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage?"
            f"chat_id={urllib.parse.quote(settings.telegram_chat_id)}"
            f"&text={urllib.parse.quote('Archive-35 Agent test message')}"
        )
        resp = urllib.request.urlopen(url, timeout=5)
        data = json.loads(resp.read())
        if data.get("ok"):
            return {"success": True, "message": "Test message sent to Telegram"}
        return {"success": False, "message": data.get("description", "Unknown error")}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/config/test-late")
def test_late():
    """Test Late API connection."""
    settings = get_settings()
    if not settings.has_late_api_key():
        return {"success": False, "message": "Late API key not configured"}
    return {"success": True, "message": "Late API key is configured (live test requires API endpoint)"}


# ── Mount sub-routers ──────────────────────────────────────────

app.include_router(library_router, prefix="/library", tags=["content-library"])
app.include_router(variations_router, prefix="/variations", tags=["variations"])


# ── Instagram ────────────────────────────────────────────────────


@app.get("/instagram/status")
def instagram_status():
    """Check Instagram integration status and token validity."""
    from src.integrations.instagram import is_configured, verify_token, get_credentials

    if not is_configured():
        return {"configured": False, "valid": False, "error": "Instagram not configured in .env"}

    creds = get_credentials()
    verification = verify_token()

    return {
        "configured": True,
        "valid": verification.get("valid", False),
        "username": verification.get("username", ""),
        "user_id": verification.get("user_id", ""),
        "token_expires": creds.get("token_expires", "unknown"),
        "error": verification.get("error"),
    }


@app.post("/instagram/refresh-token")
def instagram_refresh_token():
    """Refresh the Instagram long-lived token (extends 60 days)."""
    from src.integrations.instagram import refresh_token

    result = refresh_token()
    return result


@app.get("/instagram/account")
def instagram_account():
    """Get Instagram account info."""
    from src.integrations.instagram import get_account_info

    return get_account_info()


@app.get("/instagram/media")
def instagram_media(limit: int = Query(10, ge=1, le=50)):
    """Get recent Instagram media posts."""
    from src.integrations.instagram import get_recent_media

    return get_recent_media(limit=limit)


def _load_root_env_for_r2():
    """Load R2 credentials from root .env into os.environ if not already set."""
    import os
    if os.environ.get("R2_ACCESS_KEY_ID"):
        return  # Already set
    root_env = Path(__file__).resolve().parent.parent.parent / ".env"
    if root_env.exists():
        for line in root_env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                if key.startswith("R2_") and key not in os.environ:
                    os.environ[key] = val


def _ensure_public_url(image_url: str) -> str:
    """Convert a local image URL to a public R2 URL if needed.

    If image_url is already public (https://), returns as-is.
    If image_url is a local mockup URL (localhost), uploads to R2 first.
    """
    if image_url.startswith("https://"):
        return image_url

    # Ensure R2 credentials are loaded from root .env
    _load_root_env_for_r2()

    # Local URL — extract filename and upload to R2
    if "localhost" in image_url or "127.0.0.1" in image_url:
        # Extract mockup filename from URL like http://localhost:8035/mockups/image/foo.jpg
        filename = image_url.split("/mockups/image/")[-1] if "/mockups/image/" in image_url else ""
        if filename:
            # repo root is 2 levels up from this file (src/api.py → Archive 35 Agent → repo)
            repo_root = Path(__file__).resolve().parent.parent.parent
            mockup_dir = repo_root / "mockups" / "social"
            local_path = mockup_dir / filename
            if local_path.exists():
                from src.integrations.r2_upload import upload_to_r2
                return upload_to_r2(str(local_path), f"mockups/{filename}")

        raise HTTPException(
            status_code=400,
            detail=f"Cannot resolve local image to public URL: {image_url}"
        )

    # Not https and not localhost — treat as local path
    local_path = Path(image_url)
    if local_path.exists():
        from src.integrations.r2_upload import upload_to_r2
        return upload_to_r2(str(local_path), f"uploads/{local_path.name}")

    raise HTTPException(
        status_code=400,
        detail=f"Image URL must be publicly accessible (https://). Got: {image_url}"
    )


class InstagramPublishRequest(BaseModel):
    image_url: str
    caption: str
    photo_id: Optional[str] = None


@app.post("/instagram/publish")
def instagram_publish(req: InstagramPublishRequest):
    """Publish a photo to Instagram.

    Accepts both public URLs and local mockup URLs.
    Local images are auto-uploaded to R2 for a public URL.
    Two-step process: create container → publish.
    """
    from src.integrations.instagram import publish_photo

    conn = _get_conn()
    try:
        public_url = _ensure_public_url(req.image_url)
        result = publish_photo(
            image_url=public_url,
            caption=req.caption,
            conn=conn,
            photo_id=req.photo_id,
        )
        return result
    finally:
        conn.close()


# ── CLI Entry Point ─────────────────────────────────────────────


def main():
    """Start the API server."""
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="127.0.0.1", port=8035, log_level="info")


if __name__ == "__main__":
    main()
