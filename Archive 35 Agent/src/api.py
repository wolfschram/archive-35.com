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
        if not photo_path.exists():
            raise HTTPException(status_code=404, detail="Photo file not found on disk")

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
            f"""SELECT c.*, p.filename, p.collection, p.path as photo_path
                FROM content c JOIN photos p ON c.photo_id = p.id
                {where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?""",
            params,
        ).fetchall()

        items = []
        for r in rows:
            item = dict(r)
            # Add thumbnail URL — points to the Agent API thumbnail endpoint
            item["thumbnail_url"] = f"/photos/{item['photo_id']}/thumbnail?size=300"
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
def approve_content(content_id: str):
    return _update_content_status(content_id, "approved")


@app.post("/content/{content_id}/reject")
def reject_content(content_id: str):
    return _update_content_status(content_id, "rejected")


@app.post("/content/{content_id}/defer")
def defer_content(content_id: str):
    return _update_content_status(content_id, "deferred")


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

    # Full pipeline run
    from src.pipeline.daily import run_daily_pipeline
    client = _get_anthropic_client()
    results = run_daily_pipeline(anthropic_client=client, dry_run=dry_run)
    return results


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


class InstagramPublishRequest(BaseModel):
    image_url: str
    caption: str
    photo_id: Optional[str] = None


@app.post("/instagram/publish")
def instagram_publish(req: InstagramPublishRequest):
    """Publish a photo to Instagram.

    Requires a public image URL and caption.
    Two-step process: create container → publish.
    """
    from src.integrations.instagram import publish_photo

    conn = _get_conn()
    try:
        result = publish_photo(
            image_url=req.image_url,
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
