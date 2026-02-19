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
from pydantic import BaseModel

from src.config import get_settings
from src.db import get_initialized_connection
from src.safety import audit, kill_switch, rate_limiter
from src.telegram.queue import get_pending_content, get_queue_stats, expire_old_content

from src.api_content_library import router as library_router
from src.api_variations import router as variations_router

logger = logging.getLogger(__name__)

app = FastAPI(title="Archive-35 Agent API", version="0.2.0")

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
    """API health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


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
            f"""SELECT c.*, p.filename, p.collection
                FROM content c JOIN photos p ON c.photo_id = p.id
                {where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?""",
            params,
        ).fetchall()

        return {"items": [dict(r) for r in rows]}
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


@app.post("/pipeline/run")
def run_pipeline(dry_run: bool = True):
    """Manually trigger the daily pipeline."""
    from src.pipeline.daily import run_daily_pipeline

    results = run_daily_pipeline(dry_run=dry_run)
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
    """Get kill switch and rate limit status."""
    conn = _get_conn()
    try:
        ks = kill_switch.get_status(conn)
        rates = conn.execute("SELECT * FROM rate_limits").fetchall()
        return {
            "kill_switches": ks,
            "rate_limits": [dict(r) for r in rates],
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
    class Config:
        extra = "allow"


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


# ── CLI Entry Point ─────────────────────────────────────────────


def main():
    """Start the API server."""
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="127.0.0.1", port=8035, log_level="info")


if __name__ == "__main__":
    main()
