"""Archive-35 Agent REST API.

FastAPI server bridging the Electron Studio UI to the Python agent backend.
Spawned by Electron main process on startup, killed on quit.
"""

from __future__ import annotations

# Fix SSL certs on Python 3.13 / macOS (must run before any HTTPS calls)
from src import ssl_fix  # noqa: F401

import json
import logging
import os
import ssl
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

# ── SSL Certificate Fix for python.org Python 3.13 on macOS ──────────
# The python.org installer doesn't auto-install root certificates.
# This patches urllib globally so all HTTPS calls work without running
# the "Install Certificates.command" script manually.
def _fix_ssl_certificates():
    """Find a valid CA bundle and install it as urllib's default context."""
    import ssl as _ssl
    import urllib.request as _ureq
    _cert_paths = [
        "/etc/ssl/cert.pem",                    # macOS system certs
        "/etc/ssl/certs/ca-certificates.crt",   # Debian/Ubuntu
        "/etc/pki/tls/certs/ca-bundle.crt",     # RHEL/CentOS
    ]
    # Try certifi first (best option if installed)
    try:
        import certifi
        _cert_paths.insert(0, certifi.where())
    except ImportError:
        pass
    for cp in _cert_paths:
        if Path(cp).exists():
            ctx = _ssl.create_default_context(cafile=cp)
            _ureq.install_opener(_ureq.build_opener(_ureq.HTTPSHandler(context=ctx)))
            os.environ.setdefault("SSL_CERT_FILE", cp)
            logging.getLogger(__name__).info("SSL certs loaded from %s", cp)
            return
    logging.getLogger(__name__).warning("No CA certificate bundle found — HTTPS calls may fail")

_fix_ssl_certificates()


# ── DNS Fallback for broken macOS mDNSResponder ──────────────────────
# macOS mDNSResponder (system DNS) periodically gets stuck, causing all
# Python/curl DNS to fail while browsers (using DNS-over-HTTPS) still
# work. This patches socket.getaddrinfo to fall back to a direct UDP
# query to Google DNS (8.8.8.8) when the system resolver fails.
def _install_dns_fallback():
    """Monkey-patch socket.getaddrinfo with a Google DNS fallback."""
    import socket
    import struct

    _original_getaddrinfo = socket.getaddrinfo
    _dns_cache: dict[str, tuple[list[str], float]] = {}  # hostname → (ips, expiry)
    _CACHE_TTL = 300  # 5 minutes
    _logger = logging.getLogger(__name__ + ".dns")

    def _resolve_via_google_dns(hostname: str) -> list[str]:
        """Direct UDP DNS query to 8.8.8.8, bypassing system resolver."""
        import time as _time
        # Check cache first
        cached = _dns_cache.get(hostname)
        if cached and cached[1] > _time.time():
            return cached[0]

        # Build DNS query packet
        query_id = os.urandom(2)
        header = query_id + b'\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00'
        question = b''
        for part in hostname.encode().split(b'.'):
            question += bytes([len(part)]) + part
        question += b'\x00\x00\x01\x00\x01'  # Type A, Class IN
        packet = header + question

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(5)
        try:
            sock.sendto(packet, ('8.8.8.8', 53))
            response, _ = sock.recvfrom(1024)

            # Parse answer count from header
            ancount = struct.unpack('!H', response[6:8])[0]
            if ancount == 0:
                return []

            # Skip header (12 bytes) and question section
            pos = 12
            while pos < len(response) and response[pos] != 0:
                pos += response[pos] + 1
            pos += 5  # null terminator + QTYPE(2) + QCLASS(2)

            # Parse answer records
            ips = []
            for _ in range(ancount):
                if pos >= len(response):
                    break
                # Handle name compression pointer or label
                if response[pos] & 0xC0 == 0xC0:
                    pos += 2
                else:
                    while pos < len(response) and response[pos] != 0:
                        pos += response[pos] + 1
                    pos += 1
                if pos + 10 > len(response):
                    break
                rtype, _rclass, _ttl, rdlength = struct.unpack('!HHIH', response[pos:pos + 10])
                pos += 10
                if rtype == 1 and rdlength == 4 and pos + 4 <= len(response):
                    ip = '.'.join(str(b) for b in response[pos:pos + 4])
                    ips.append(ip)
                pos += rdlength

            if ips:
                _dns_cache[hostname] = (ips, _time.time() + _CACHE_TTL)
            return ips
        except Exception:
            return []
        finally:
            sock.close()

    def _patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        try:
            return _original_getaddrinfo(host, port, family, type, proto, flags)
        except socket.gaierror as e:
            # System resolver failed — try Google DNS fallback
            if not isinstance(host, str) or host in ('localhost', '127.0.0.1', '::1'):
                raise
            _logger.warning("System DNS failed for %s, trying Google DNS fallback", host)
            ips = _resolve_via_google_dns(host)
            if not ips:
                _logger.error("Google DNS fallback also failed for %s", host)
                raise
            _logger.info("Resolved %s via Google DNS: %s", host, ips[0])
            # Return results in getaddrinfo format
            results = []
            p = int(port) if port else 443
            for ip in ips:
                results.append((socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, p)))
            return results

    socket.getaddrinfo = _patched_getaddrinfo
    _logger.info("DNS fallback installed (Google 8.8.8.8)")

_install_dns_fallback()


from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Allow large panoramas globally — Wolf shoots 200M+ pixel panos
from PIL import Image as _PILImage
_PILImage.MAX_IMAGE_PIXELS = None

import os as _os

# Load Agent .env into os.environ EARLY — before any module reads os.getenv().
# This ensures R2 credentials, API keys, etc. are available to all integrations.
_agent_env_path = Path(__file__).resolve().parent.parent / ".env"
if _agent_env_path.exists():
    for _line in _agent_env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            _k, _v = _k.strip(), _v.strip()
            if _k and _k not in _os.environ:
                _os.environ[_k] = _v

from src.config import get_settings
from src.db import get_initialized_connection
from src.safety import audit, kill_switch, rate_limiter
from src.telegram.queue import get_pending_content, get_queue_stats, expire_old_content

from src.api_content_library import router as library_router
from src.api_variations import router as variations_router
from src.state_manager import get_all_states, load_state, save_state
from src.agent_logging import setup_daily_logging, log_decision, log_build, get_daily_logs, get_available_log_dates

logger = logging.getLogger(__name__)

app = FastAPI(title="Archive-35 Agent API", version="0.2.0")


# Global exception handler — ensures ALL errors return JSON (never plain text)
import urllib.error
from starlette.requests import Request
from starlette.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch unhandled exceptions and return JSON instead of plain text 500."""
    # Network/DNS errors — return 200 with error field instead of 500
    # This prevents red error banners on every page when internet is down
    is_network_err = isinstance(exc, (urllib.error.URLError, OSError)) or (
        "nodename nor servname" in str(exc) or "ECONNREFUSED" in str(exc)
        or "urlopen error" in str(exc) or "Name or service not known" in str(exc)
    )
    if is_network_err:
        logger.warning("Network error on %s %s: %s", request.method, request.url.path, exc)
        return JSONResponse(
            status_code=200,
            content={"error": f"Network unavailable: {exc}", "network_error": True},
        )
    logger.error("Unhandled exception on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
    )


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

# ── Include sub-routers ────────────────────────────────────────────
try:
    from src.routes.reddit_routes import router as reddit_router
    app.include_router(reddit_router)
    logger.info("Reddit routes loaded")
except ImportError as e:
    logger.warning("Reddit routes not loaded: %s", e)


def _get_conn():
    """Get an initialized DB connection."""
    settings = get_settings()
    return get_initialized_connection(settings.db_path)


# ── Startup Health Check ───────────────────────────────────────────


@app.on_event("startup")
def startup_health_check():
    """Run on API boot: setup logging, load agent states, log resume event."""
    # 1. Setup daily rotating log files
    setup_daily_logging()
    logger.info("Archive-35 Agent API starting up")

    # 2. Load all agent states and log resume info
    try:
        states = get_all_states()
        for agent_name, state in states.items():
            last_activity = state.get("_updated_at", "unknown")
            logger.info(
                "Agent resumed — %s — last activity: %s", agent_name, last_activity
            )
    except Exception as e:
        logger.error("Failed to load agent states on startup: %s", e)

    # 3. Write startup event to audit log
    try:
        conn = _get_conn()
        agent_count = len(states) if 'states' in dir() else 0
        audit.log(
            conn,
            component="system",
            action="startup",
            details={
                "message": "System started — all agents resuming",
                "agents_with_state": agent_count,
                "boot_time": datetime.now(timezone.utc).isoformat(),
            },
        )
        conn.close()
    except Exception as e:
        logger.error("Failed to write startup audit log: %s", e)

    # 4. Log decision for traceability
    log_decision(
        component="system",
        action="startup",
        decision="API server booted, daily logging configured, agent states loaded",
    )

    logger.info("Startup health check complete")


# ── Agent States ────────────────────────────────────────────────


@app.get("/agents/states")
def get_agent_states():
    """Return all agent states for dashboard display."""
    return get_all_states()


@app.get("/agents/states/{agent_name}")
def get_agent_state(agent_name: str):
    """Return a single agent's state."""
    state = load_state(agent_name)
    if not state:
        raise HTTPException(status_code=404, detail=f"No state found for agent '{agent_name}'")
    return state


# ── Log Endpoints ───────────────────────────────────────────────


@app.get("/logs/dates")
def list_log_dates():
    """Return available log file dates for historical browsing."""
    return {"dates": get_available_log_dates()}


@app.get("/logs/daily")
def read_daily_log(date: Optional[str] = None):
    """Read a daily log file. Defaults to today.

    Args:
        date: YYYY-MM-DD format date string.
    """
    lines = get_daily_logs(date)
    return {
        "date": date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "lines": lines,
        "count": len(lines),
    }


# ── Health ──────────────────────────────────────────────────────


@app.get("/health")
def health():
    """API health check + dashboard data feed.

    Returns system status plus live counts for the agent dashboard at
    archive-35.com/agent — Etsy listings, Instagram posts today,
    sales/orders, x402 licenses, recent audit logs, and last IG posts.
    """
    db_ok = False
    extra: dict[str, Any] = {}
    try:
        conn = _get_conn()
        conn.execute("SELECT 1").fetchone()
        db_ok = True

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Etsy listings count (from live Etsy API cache in content table)
        try:
            from src.integrations.etsy import get_listings, has_valid_token
            if has_valid_token():
                data = get_listings(state="active", limit=100)
                extra["etsy_listings"] = data.get("count", len(data.get("results", [])))
            else:
                extra["etsy_listings"] = 0
        except Exception:
            extra["etsy_listings"] = 0

        # Instagram posts today + configuration check
        try:
            from src.integrations.instagram import is_configured as ig_is_configured
            extra["instagram_configured"] = ig_is_configured()
        except Exception:
            extra["instagram_configured"] = False
        try:
            conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='instagram_posts'"
            )
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM instagram_posts WHERE posted_at LIKE ? AND success = 1",
                (f"{today}%",),
            ).fetchone()
            extra["instagram_today"] = row["cnt"] if row else 0
        except Exception:
            extra["instagram_today"] = 0

        # Etsy sales/orders (from receipts — calls live API)
        try:
            from src.integrations.etsy import EtsyClient
            client = EtsyClient()
            receipts = client.get_receipts(was_paid=True, limit=100)
            extra["sales"] = len(receipts.get("results", []))
        except Exception:
            extra["sales"] = 0

        # x402 license sales (table may not exist yet)
        try:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM license_sales"
            ).fetchone()
            extra["x402_licenses"] = row["cnt"] if row else 0
        except Exception:
            extra["x402_licenses"] = 0

        # Last 20 audit log entries
        try:
            extra["logs"] = audit.query(conn, limit=20)
        except Exception:
            extra["logs"] = []

        # Last 5 Instagram posts
        try:
            rows = conn.execute(
                "SELECT id, etsy_listing_id, image_url, caption, media_id, posted_at, success "
                "FROM instagram_posts ORDER BY id DESC LIMIT 5"
            ).fetchall()
            extra["ig_posts"] = [dict(r) for r in rows]
        except Exception:
            extra["ig_posts"] = []

        # Kill switch state
        try:
            extra["kill_switch"] = kill_switch.get_status(conn)
        except Exception:
            extra["kill_switch"] = {}

        # Agent request intelligence (x402 gallery traffic)
        try:
            _ensure_agent_requests_table(conn)
            req_count = conn.execute("SELECT COUNT(*) as cnt FROM agent_requests").fetchone()
            extra["agent_requests"] = req_count["cnt"] if req_count else 0
            # Top 3 subjects for quick glance
            rows = conn.execute("SELECT query_params FROM agent_requests ORDER BY id DESC LIMIT 200").fetchall()
            subjects: dict[str, int] = {}
            for row in rows:
                try:
                    p = json.loads(row["query_params"]) if row["query_params"] else {}
                    if p.get("subject"):
                        subjects[p["subject"]] = subjects.get(p["subject"], 0) + 1
                except Exception:
                    pass
            extra["top_agent_subjects"] = sorted(subjects.items(), key=lambda x: x[1], reverse=True)[:3]
        except Exception:
            extra["agent_requests"] = 0
            extra["top_agent_subjects"] = []

        conn.close()
    except Exception:
        pass

    return {
        "status": "online" if db_ok else "degraded",
        "version": "0.2.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "db": "ok" if db_ok else "error",
        **extra,
    }


@app.get("/mockups/image/{filename:path}")
def serve_mockup_image(filename: str):
    """Serve a mockup image from anywhere under mockups/ directory.

    Accepts paths like 'iceland/wolf3969/wolf3969-room-1-instagram.jpg'
    or flat names like 'foo_bar_instagram.jpg' (legacy social/ layout).
    """
    mockup_root = Path(__file__).parent.parent.parent / "mockups"
    file_path = mockup_root / filename
    # Security: ensure resolved path stays inside mockup_root
    if not file_path.resolve().is_relative_to(mockup_root.resolve()):
        raise HTTPException(status_code=403, detail="Access denied")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Mockup image not found")
    media = "image/webp" if file_path.suffix == ".webp" else "image/jpeg"
    return FileResponse(file_path, media_type=media)


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


# ── Filesystem-based photo browsing (for Compose page) ───────────────
# Reads directly from photography/ — the source of truth with all 744+ images.
# No database import needed — instant access to every published photo.
# NOTE: These routes MUST be defined BEFORE /photos/{photo_id} to avoid
# FastAPI matching "browse" as a photo_id parameter.

@app.get("/photos/browse/collections")
def browse_collections():
    """List all collections from the photography/ filesystem directory."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    photo_dir = repo_root / "photography"
    if not photo_dir.exists():
        return {"collections": []}
    collections = []
    for d in sorted(photo_dir.iterdir()):
        if d.is_dir() and not d.name.startswith('.'):
            count = len([f for f in d.iterdir() if f.suffix.lower() in ('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp')])
            if count > 0:
                collections.append({"name": d.name, "count": count})
    collections.sort(key=lambda c: c["count"], reverse=True)
    return {"collections": collections}


@app.get("/photos/browse")
def browse_photos(collection: str, limit: int = Query(default=200, le=1000)):
    """List photos from photography/{collection}/ on the filesystem."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    col_dir = repo_root / "photography" / collection
    if not col_dir.exists() or not col_dir.is_dir():
        return {"items": [], "total": 0}
    exts = ('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp')
    files = sorted([f for f in col_dir.iterdir() if f.suffix.lower() in exts])
    items = []
    for f in files[:limit]:
        items.append({
            "id": f"fs:{collection}/{f.name}",
            "filename": f.name,
            "collection": collection,
            "path": str(f.relative_to(repo_root)),
        })
    return {"items": items, "total": len(files)}


@app.get("/photos/browse/thumbnail")
def browse_thumbnail(path: str, size: int = Query(default=300, le=800)):
    """Serve a thumbnail for a filesystem photo (path relative to repo root)."""
    import hashlib as _hashlib
    repo_root = Path(__file__).resolve().parent.parent.parent
    photo_path = repo_root / path
    if not photo_path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")
    # Security: ensure path is within photography/
    try:
        photo_path.resolve().relative_to((repo_root / "photography").resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Path must be within photography/")

    # Cache thumbnail
    path_hash = _hashlib.md5(path.encode()).hexdigest()[:12]
    thumb_dir = Path("data/thumbnails")
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumb_dir / f"fs_{path_hash}_{size}.jpg"

    if not thumb_path.exists():
        from PIL import Image
        img = Image.open(photo_path)
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.save(str(thumb_path), "JPEG", quality=80, optimize=True)

    return FileResponse(
        path=str(thumb_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=604800"},
    )


@app.get("/photos/{photo_id}")
def get_photo(photo_id: str):
    """Get photo detail with related content. Handles fs: filesystem IDs too."""
    # Handle filesystem photo IDs — return basic info without DB
    if photo_id.startswith("fs:"):
        fs_rel = photo_id[3:]
        parts = fs_rel.split("/", 1)
        collection = parts[0] if len(parts) > 1 else ""
        filename = parts[1] if len(parts) > 1 else parts[0]
        repo_root = Path(__file__).resolve().parent.parent.parent
        photo_path = repo_root / "photography" / fs_rel
        return {
            "photo": {
                "id": photo_id,
                "filename": filename,
                "collection": collection,
                "path": f"photography/{fs_rel}",
                "exists": photo_path.exists(),
            },
            "content": [],
            "skus": [],
        }

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


@app.get("/photos/{photo_id:path}/thumbnail")
def get_photo_thumbnail(photo_id: str, size: int = Query(default=300, le=800)):
    """Serve a resized thumbnail for fast grid display.

    Generates a small JPEG on first request, caches it in data/thumbnails/.
    Subsequent requests serve the cached file instantly.
    Handles both DB photo IDs and filesystem IDs (fs:Collection/file.jpg).
    """
    import hashlib as _hashlib
    repo_root = Path(__file__).resolve().parent.parent.parent

    # Handle filesystem photo IDs (fs:Collection/filename.jpg)
    if photo_id.startswith("fs:"):
        fs_rel = photo_id[3:]  # Strip "fs:" prefix → "Hawaii/photo.jpg"
        photo_path = repo_root / "photography" / fs_rel
        if not photo_path.exists():
            raise HTTPException(status_code=404, detail=f"Photo not found: {fs_rel}")
        # Security: ensure within photography/
        try:
            photo_path.resolve().relative_to((repo_root / "photography").resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Path must be within photography/")
        cache_key = _hashlib.md5(photo_id.encode()).hexdigest()[:12]
    else:
        # Standard DB lookup
        conn = _get_conn()
        try:
            photo = conn.execute("SELECT path FROM photos WHERE id = ?", (photo_id,)).fetchone()
            if not photo:
                raise HTTPException(status_code=404, detail="Photo not found")
            photo_path = Path(photo["path"])
            if not photo_path.is_absolute():
                photo_path = repo_root / photo_path
        finally:
            conn.close()
        if not photo_path.exists():
            raise HTTPException(status_code=404, detail=f"Photo file not found on disk: {photo_path}")
        cache_key = photo_id

    # Check for cached thumbnail
    thumb_dir = Path("data/thumbnails")
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumb_dir / f"{cache_key}_{size}.jpg"

    if not thumb_path.exists():
        from PIL import Image
        img = Image.open(photo_path)
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.save(str(thumb_path), "JPEG", quality=80, optimize=True)

    return FileResponse(
        path=str(thumb_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=604800"},  # 7 days
    )


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


@app.get("/photos/collections/reconcile")
def reconcile_collections():
    """Show mismatches between photography/, 01_Portfolio/, and Agent DB.

    Returns all three naming layers so Wolf can see what's off and fix it.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    photo_dir = repo_root / "photography"
    portfolio_dir = repo_root / "01_Portfolio"

    # Gather all three name sets
    photo_folders = sorted(
        [d.name for d in photo_dir.iterdir() if d.is_dir()]
    ) if photo_dir.exists() else []

    portfolio_folders = sorted(
        [d.name for d in portfolio_dir.iterdir()
         if d.is_dir() and not d.name.startswith(("_", "."))]
    ) if portfolio_dir.exists() else []

    conn = _get_conn()
    try:
        db_collections = {
            r["collection"]: r["count"]
            for r in conn.execute(
                "SELECT collection, COUNT(*) as count FROM photos GROUP BY collection"
            ).fetchall()
        }
    finally:
        conn.close()

    # Normalize function for matching
    def normalize(name: str) -> str:
        return name.lower().replace("_", "").replace(" ", "").rstrip()

    # Build unified map
    all_normalized: dict[str, dict] = {}
    for name in photo_folders:
        key = normalize(name)
        all_normalized.setdefault(key, {})["photography"] = name
    for name in portfolio_folders:
        key = normalize(name)
        all_normalized.setdefault(key, {})["portfolio"] = name
    for name in db_collections:
        key = normalize(name)
        all_normalized.setdefault(key, {})["agent_db"] = name
        all_normalized[key]["db_count"] = db_collections[name]

    # Build results
    results = []
    for key, layers in sorted(all_normalized.items()):
        photo_name = layers.get("photography")
        portfolio_name = layers.get("portfolio")
        db_name = layers.get("agent_db")
        db_count = layers.get("db_count", 0)

        # Count photos on disk
        disk_count = 0
        if photo_name:
            folder = photo_dir / photo_name
            disk_count = sum(
                1 for f in folder.iterdir()
                if f.is_file() and f.suffix.lower() in {".jpg", ".jpeg", ".png", ".tiff", ".webp"}
            )

        matched = (
            photo_name is not None
            and portfolio_name is not None
            and db_name is not None
        )
        names_consistent = len({
            normalize(n) for n in [photo_name, portfolio_name, db_name] if n
        }) <= 1

        results.append({
            "normalized_key": key,
            "photography": photo_name,
            "portfolio": portfolio_name,
            "agent_db": db_name,
            "disk_count": disk_count,
            "db_count": db_count,
            "matched": matched,
            "consistent": names_consistent,
            "needs_attention": not matched or disk_count != db_count,
        })

    mismatches = [r for r in results if r["needs_attention"]]
    return {
        "total_collections": len(results),
        "mismatches": len(mismatches),
        "collections": results,
    }


class RenameCollectionRequest(BaseModel):
    old_name: str
    new_name: str
    rename_photography: bool = True   # Rename folder in photography/
    rename_portfolio: bool = False     # Rename folder in 01_Portfolio/
    update_db: bool = True             # Update collection name in Agent DB


@app.post("/photos/collections/rename")
def rename_collection(req: RenameCollectionRequest):
    """Rename a collection across filesystem and database.

    Renames the actual folder on disk so future scans find the correct name.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    renamed = []

    if req.rename_photography:
        photo_dir = repo_root / "photography" / req.old_name
        photo_target = repo_root / "photography" / req.new_name
        if photo_dir.exists() and not photo_target.exists():
            photo_dir.rename(photo_target)
            renamed.append(f"photography/{req.old_name} → {req.new_name}")
            logger.info("Renamed photography folder: %s → %s", req.old_name, req.new_name)
        elif not photo_dir.exists():
            logger.warning("Photography folder not found: %s", req.old_name)
        elif photo_target.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Target folder already exists: photography/{req.new_name}"
            )

    if req.rename_portfolio:
        port_dir = repo_root / "01_Portfolio" / req.old_name
        port_target = repo_root / "01_Portfolio" / req.new_name
        if port_dir.exists() and not port_target.exists():
            port_dir.rename(port_target)
            renamed.append(f"01_Portfolio/{req.old_name} → {req.new_name}")
            logger.info("Renamed portfolio folder: %s → %s", req.old_name, req.new_name)

    if req.update_db:
        conn = _get_conn()
        try:
            count = conn.execute(
                "UPDATE photos SET collection = ? WHERE collection = ?",
                (req.new_name, req.old_name),
            ).rowcount
            conn.commit()
            if count:
                renamed.append(f"Agent DB: {count} photos updated")
                logger.info("Updated %d photos: collection %s → %s", count, req.old_name, req.new_name)
        finally:
            conn.close()

    return {
        "success": len(renamed) > 0,
        "changes": renamed,
        "old_name": req.old_name,
        "new_name": req.new_name,
    }


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
    """List all generated mockup images under mockups/ directory tree.

    Scans all subdirectories (social/, gallery/photo-slug/, etc.)
    and returns grouped by photo+template combo with platform variants.
    """
    KNOWN_PLATFORMS = {"instagram", "pinterest", "etsy", "full", "web-full", "web-thumb"}
    mockup_root = Path(__file__).parent.parent.parent / "mockups"
    if not mockup_root.exists():
        return {"items": [], "total": 0}

    # Recursively find all image files (skip batches/ directory)
    all_files = []
    for f in mockup_root.rglob("*"):
        if f.is_file() and f.suffix in (".jpg", ".png", ".webp"):
            rel = f.relative_to(mockup_root)
            # Skip batches/ metadata directory
            if str(rel).startswith("batches"):
                continue
            all_files.append((str(rel), f))

    all_files.sort(key=lambda x: x[0])

    # Group by photo+template combo
    groups: dict[str, dict] = {}
    for rel_path, full_path in all_files:
        fname = full_path.name
        stem = full_path.stem  # filename without extension

        # Try underscore split first (social/ pattern: base_platform.ext)
        u_parts = stem.rsplit("_", 1)

        platform = None
        base = None

        if len(u_parts) == 2 and u_parts[1] in KNOWN_PLATFORMS:
            platform = u_parts[1]
            base = u_parts[0]
        else:
            # Batch pattern uses hyphens: base-platform.ext
            # Check two-word platforms first (web-full, web-thumb)
            h2_parts = stem.rsplit("-", 2)
            h1_parts = stem.rsplit("-", 1)
            if len(h2_parts) >= 3 and f"{h2_parts[-2]}-{h2_parts[-1]}" in KNOWN_PLATFORMS:
                platform = f"{h2_parts[-2]}-{h2_parts[-1]}"
                base = stem[:-(len(platform) + 1)]  # strip -platform from end
            elif len(h1_parts) == 2 and h1_parts[1] in KNOWN_PLATFORMS:
                platform = h1_parts[1]
                base = h1_parts[0]

        if platform and base:
            if base not in groups:
                groups[base] = {"base": base, "platforms": {}, "files": [], "dir": str(full_path.parent.relative_to(mockup_root))}
            groups[base]["platforms"][platform] = rel_path
            groups[base]["files"].append(rel_path)
        else:
            # Unknown pattern — treat as single "full" image
            key = stem
            if key not in groups:
                groups[key] = {"base": key, "platforms": {"full": rel_path}, "files": [rel_path], "dir": str(full_path.parent.relative_to(mockup_root))}

    items = list(groups.values())
    return {"items": items, "total": len(items)}


class DeleteMockupRequest(BaseModel):
    base: str  # The base name (group key) — all platform variants will be deleted
    files: list[str] = []  # Optional: specific relative paths to delete


@app.post("/mockups/delete")
def delete_mockup(req: DeleteMockupRequest):
    """Delete a mockup group (all platform variants) from local disk and R2.

    Accepts either a list of relative file paths (from /mockups/list) or
    falls back to scanning all dirs for files starting with the base name.
    Also cleans up from R2 social bucket if uploaded.
    """
    mockup_root = Path(__file__).parent.parent.parent / "mockups"
    if not mockup_root.exists():
        return {"deleted": 0}

    deleted = []

    if req.files:
        # Delete specific files by relative path
        for rel in req.files:
            fp = mockup_root / rel
            if fp.exists() and fp.is_file() and fp.resolve().is_relative_to(mockup_root.resolve()):
                fp.unlink()
                deleted.append(rel)
                logger.info("Deleted mockup: %s", rel)
    else:
        # Fallback: scan all directories for files starting with base name
        for f in mockup_root.rglob("*"):
            if f.is_file() and f.stem.startswith(req.base) and f.suffix in (".jpg", ".png", ".webp"):
                rel = str(f.relative_to(mockup_root))
                f.unlink()
                deleted.append(rel)
                logger.info("Deleted mockup: %s", rel)

    # Also attempt R2 cleanup
    r2_deleted = 0
    try:
        _load_agent_env()
        from src.integrations.r2_upload import delete_from_r2
        for rel in deleted:
            fname = Path(rel).name
            if delete_from_r2(f"mockups/{fname}"):
                r2_deleted += 1
    except Exception as e:
        logger.warning("R2 cleanup skipped: %s", e)

    # Remove parent dir if now empty (batch creates per-photo subdirs)
    for rel in deleted:
        parent = (mockup_root / rel).parent
        if parent != mockup_root and parent.exists():
            try:
                if not any(parent.iterdir()):
                    parent.rmdir()
                    logger.info("Removed empty dir: %s", parent.relative_to(mockup_root))
            except OSError:
                pass

    return {"deleted": len(deleted), "r2_deleted": r2_deleted, "files": deleted}


class GenerateDraftRequest(BaseModel):
    photo_id: str
    platform: str = "instagram"
    context: dict | None = None  # For mockups: {gallery, template, filename}


@app.post("/content/generate-draft")
def generate_draft(req: GenerateDraftRequest):
    """Generate AI caption/listing draft for a photo or mockup (not saved to DB)."""
    # All paths use Vision — Claude must SEE the image to describe it accurately.
    client = _get_anthropic_client()
    if not client:
        raise HTTPException(status_code=503, detail="No Anthropic API key configured")

    from src.agents.content import PLATFORM_PROMPTS, MOCKUP_PLATFORM_PROMPTS, _parse_content_response

    prompt = PLATFORM_PROMPTS.get(req.platform, PLATFORM_PROMPTS["instagram"])
    image_url = None
    context_text = ""

    # Handle mockup drafts (no DB photo required)
    if req.photo_id == "__mockup__" and req.context:
        gallery = req.context.get("gallery", "")
        template = req.context.get("template", "")
        filename = req.context.get("filename", "")
        # Try to get mockup image URL for Vision
        image_url = req.context.get("image_url", "")
        if not image_url and filename:
            image_url = f"http://127.0.0.1:8036/mockups/{filename}"

        context_text = (
            f"Wall art mockup — photograph in a room setting.\n"
            f"Collection: {gallery}\n"
        )
        prompt = MOCKUP_PLATFORM_PROMPTS.get(req.platform, prompt)

    # Handle filesystem photo IDs (fs:Collection/filename.jpg)
    elif req.photo_id.startswith("fs:"):
        fs_path = req.photo_id[3:]
        parts = fs_path.split("/", 1)
        collection = parts[0] if len(parts) > 1 else ""
        filename = parts[1] if len(parts) > 1 else parts[0]

        # Build image URL from the website
        if collection and filename:
            base = filename.rsplit(".", 1)[0] if "." in filename else filename
            image_url = f"https://archive-35.com/images/{collection.lower()}/{base}-full.jpg"

        # Also try to read the actual file for base64
        repo_root = Path(__file__).resolve().parent.parent.parent
        local_path = repo_root / "photography" / fs_path
        if local_path.exists():
            try:
                import base64
                with open(local_path, "rb") as f:
                    raw_bytes = f.read()
                # Resize to prevent 413 errors — Claude Vision works at 2000px
                from src.agents.etsy_agent import _resize_image_for_api
                resized = _resize_image_for_api(raw_bytes, max_edge=2000, max_bytes=4_500_000)
                img_data = base64.standard_b64encode(resized).decode("utf-8")
                # Prefer local file over URL — more reliable
                image_url = None  # Will use base64 below
            except Exception:
                img_data = None
        else:
            img_data = None

        context_text = f"Fine art photograph from Archive-35.\nCollection: {collection}\n"

    # Standard DB photo draft
    else:
        conn = _get_conn()
        try:
            photo = conn.execute("SELECT * FROM photos WHERE id = ?", (req.photo_id,)).fetchone()
            if not photo:
                raise HTTPException(status_code=404, detail="Photo not found")

            from src.agents.content import _build_context
            context_text = _build_context(photo)
            img_data = None

            # Try to find image for Vision
            photo = dict(photo)
            collection = (photo.get("collection", "") or "").lower()
            filename = photo.get("filename", "")
            if collection and filename:
                base = filename.rsplit(".", 1)[0] if "." in filename else filename
                image_url = f"https://archive-35.com/images/{collection}/{base}-full.jpg"

                # Try local file
                repo_root = Path(__file__).resolve().parent.parent.parent
                local_path = repo_root / "photography" / photo.get("collection", "") / filename
                if local_path.exists():
                    try:
                        import base64
                        with open(local_path, "rb") as f:
                            raw_bytes = f.read()
                        # Resize to prevent 413 errors — Claude Vision works at 2000px
                        from src.agents.etsy_agent import _resize_image_for_api
                        resized = _resize_image_for_api(raw_bytes, max_edge=2000, max_bytes=4_500_000)
                        img_data = base64.standard_b64encode(resized).decode("utf-8")
                        image_url = None
                    except Exception:
                        pass
        finally:
            conn.close()

    # Build message with Vision if we have an image
    full_prompt = f"Photo context:\n{context_text}\n\n{prompt}"
    content: list[dict] = []

    if 'img_data' in dir() and img_data:
        # Local file as base64 — most reliable
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": img_data},
        })
    elif image_url:
        content.append({
            "type": "image",
            "source": {"type": "url", "url": image_url},
        })

    content.append({"type": "text", "text": full_prompt})

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=1000,
        messages=[{"role": "user", "content": content}],
    )
    result = _parse_content_response(response.content[0].text)
    return result


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
        else:
            # Normalize all mockup IDs to the sentinel value (satisfies FK constraint)
            req.photo_id = "__mockup__"

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


@app.delete("/content/{content_id}")
def delete_content_item(content_id: str):
    """Delete a pending/approved content item from the queue."""
    conn = _get_conn()
    try:
        row = conn.execute("SELECT id, status FROM content WHERE id = ?", (content_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Content item not found")
        conn.execute("DELETE FROM content WHERE id = ?", (content_id,))
        conn.commit()
        return {"deleted": True, "id": content_id}
    finally:
        conn.close()


@app.get("/etsy/listings/live")
def list_live_etsy_listings(state: str = "active", limit: int = 100):
    """Fetch real listings from the Etsy API (not the content DB).

    Supports state: active, draft, inactive, expired
    """
    from src.integrations.etsy import get_listings, has_valid_token
    if not has_valid_token():
        return {"results": [], "count": 0, "note": "No Etsy OAuth token — connect in Settings"}
    try:
        data = get_listings(state=state, limit=limit)
        if "error" in data:
            return {"results": [], "count": 0, "error": data["error"]}
        results = data.get("results", [])
        return {"results": results, "count": len(results)}
    except Exception as e:
        logger.error("Failed to fetch live Etsy listings: %s", e)
        return {"results": [], "count": 0, "error": str(e)}


@app.post("/etsy/restructure")
def etsy_restructure(dry_run: bool = False):
    """Restructure all Etsy listings to single-SKU HD Metal Prints.

    Processes ALL listings (active + inactive):
    - Detects orientation, sets single size per listing
    - Rewrites SEO with Claude Vision
    - Sets 3x markup pricing on Pictorem base costs
    - Reactivates inactive listings after transformation
    - Free shipping prominent in every description

    Args:
        dry_run: If true, generate paste-ready output without updating Etsy.
    """
    from src.agents.etsy_agent import restructure_all_listings
    import anthropic

    conn = _get_conn()
    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key or api_key == "sk-ant-...":
            raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY not configured")
        client = anthropic.Anthropic(api_key=api_key)
        result = restructure_all_listings(
            conn=conn, client=client, dry_run=dry_run,
        )
        if "error" in result and not result.get("results"):
            raise HTTPException(status_code=502, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Etsy restructure failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.post("/etsy/upload-packages")
def etsy_upload_packages(dry_run: bool = False, limit: int = 100):
    """Upload pre-built listing packages from etsy-export/ to Etsy.

    Rewrites copy with Claude + story bank, watermarks originals,
    uploads images, creates and activates listings.
    """
    from src.agents.etsy_uploader import upload_all_packages
    import anthropic

    conn = _get_conn()
    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key or api_key == "sk-ant-...":
            raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY not configured")
        client = anthropic.Anthropic(api_key=api_key)
        result = upload_all_packages(
            conn=conn, client=client, dry_run=dry_run, limit=limit,
        )
        if "error" in result and not result.get("results"):
            raise HTTPException(status_code=502, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Etsy upload-packages failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/etsy/diagnostic")
def etsy_diagnostic():
    """Run a full diagnostic of the Etsy API connection and capabilities.

    Tests: credentials, token validity, shop info, shipping profiles,
    readiness states, and listing permissions. Returns detailed results
    for each check so we can identify exactly what's failing.
    """
    from src.integrations.etsy import (
        get_credentials, has_valid_token, get_shop_info,
        get_shipping_profiles, get_readiness_state_definitions,
        get_or_create_readiness_state_id, get_listings,
    )
    checks = {}

    # 1. Credentials present?
    creds = get_credentials()
    checks["credentials"] = {
        "api_key": bool(creds.get("api_key")),
        "access_token": bool(creds.get("access_token")),
        "refresh_token": bool(creds.get("refresh_token")),
        "shop_id": creds.get("shop_id", ""),
        "token_expires": creds.get("token_expires", ""),
    }

    # 2. Token valid?
    checks["token_valid"] = has_valid_token()

    if not checks["token_valid"]:
        checks["note"] = "Token invalid or expired — run OAuth flow first"
        return checks

    # 3. Shop info
    shop = get_shop_info()
    checks["shop_info"] = {
        "success": "error" not in shop,
        "shop_name": shop.get("shop_name", ""),
        "error": shop.get("error", ""),
        "detail": shop.get("detail", ""),
    }

    # 4. Shipping profiles
    profiles = get_shipping_profiles()
    profile_list = profiles.get("results", [])
    checks["shipping_profiles"] = {
        "count": len(profile_list),
        "profiles": [
            {"id": p.get("shipping_profile_id"), "title": p.get("title", "?")}
            for p in profile_list
        ],
        "error": profiles.get("error", ""),
    }

    # 5. Readiness states
    readiness = get_readiness_state_definitions()
    readiness_list = readiness.get("results", [])
    checks["readiness_states"] = {
        "count": len(readiness_list),
        "states": readiness_list,
        "error": readiness.get("error", ""),
    }

    # 6. Get or create readiness_state_id
    rid = get_or_create_readiness_state_id()
    checks["readiness_state_id"] = rid

    # 6b. Taxonomy discovery
    from src.integrations.etsy import get_photography_taxonomy_id
    tax_id = get_photography_taxonomy_id()
    checks["taxonomy_id"] = tax_id

    # 7. Existing listings count
    for state_name in ("active", "draft"):
        listings = get_listings(state=state_name, limit=1)
        checks[f"listings_{state_name}"] = {
            "count": listings.get("count", len(listings.get("results", []))),
            "error": listings.get("error", ""),
        }

    return checks


@app.get("/etsy/status")
def etsy_status():
    """Check Etsy integration status — tokens, shop info, SKU count."""
    from src.integrations.etsy import EtsyClient, get_credentials, _fetch_and_save_shop_id
    conn = _get_conn()
    try:
        client = EtsyClient()
        has_tokens = bool(client.access_token)

        sku_count = conn.execute("SELECT COUNT(*) FROM sku_catalog WHERE active = 1").fetchone()[0]

        # Auto-recover shop_id if tokens exist but shop_id is missing
        shop_id = client.shop_id
        if has_tokens and not shop_id:
            logger.info("Etsy tokens present but shop_id missing — auto-fetching...")
            try:
                creds = get_credentials()
                _fetch_and_save_shop_id(
                    creds["access_token"], creds["api_key"], creds.get("shared_secret", "")
                )
                # Re-read credentials after saving
                shop_id = get_credentials().get("shop_id", "")
                logger.info("Auto-fetched shop_id: %s", shop_id)
            except Exception as e:
                logger.warning("Auto-fetch shop_id failed: %s", e)

        result = {
            "configured": has_tokens,
            "connected": False,
            "shop_id": shop_id or None,
            "active_skus": sku_count,
        }

        # If tokens exist, try to fetch shop info
        if has_tokens and shop_id:
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


@app.post("/etsy/shop-id")
def set_etsy_shop_id(body: dict):
    """Manually set the Etsy shop ID when auto-fetch fails."""
    shop_id = str(body.get("shop_id", "")).strip()
    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id is required")

    agent_env = Path(__file__).resolve().parent.parent / ".env"
    if not agent_env.exists():
        raise HTTPException(status_code=500, detail="Agent .env not found")

    lines = agent_env.read_text().splitlines()
    found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith("ETSY_SHOP_ID="):
            new_lines.append(f"ETSY_SHOP_ID={shop_id}")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"ETSY_SHOP_ID={shop_id}")
    agent_env.write_text("\n".join(new_lines) + "\n")
    logger.info("Manually set ETSY_SHOP_ID=%s", shop_id)
    return {"saved": True, "shop_id": shop_id}


# PKCE verifier persistence — survives Agent restarts
_PKCE_FILE = Path(__file__).resolve().parent.parent / "data" / ".etsy_pkce_verifier"


def _save_pkce_verifier(verifier: str):
    """Persist PKCE code_verifier to file so it survives Agent restarts."""
    _PKCE_FILE.write_text(verifier)
    logger.info("Saved PKCE verifier to %s (%d chars)", _PKCE_FILE, len(verifier))


def _load_pkce_verifier() -> Optional[str]:
    """Load persisted PKCE code_verifier."""
    if _PKCE_FILE.exists():
        v = _PKCE_FILE.read_text().strip()
        logger.info("Loaded PKCE verifier from file (%d chars)", len(v))
        return v if v else None
    return None


def _clear_pkce_verifier():
    """Remove persisted PKCE verifier after successful exchange."""
    if _PKCE_FILE.exists():
        _PKCE_FILE.unlink()


@app.get("/etsy/oauth/url")
def etsy_oauth_url():
    """Generate Etsy OAuth authorization URL for the user to visit."""
    from src.integrations.etsy import generate_oauth_url
    result = generate_oauth_url()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    _save_pkce_verifier(result["code_verifier"])
    return {"url": result["auth_url"], "state": result["state"]}


class EtsyOAuthCallback(BaseModel):
    code: str
    state: str


@app.post("/etsy/oauth/callback")
def etsy_oauth_callback(req: EtsyOAuthCallback):
    """Exchange OAuth authorization code for access tokens."""
    from src.integrations.etsy import exchange_code, get_credentials
    verifier = _load_pkce_verifier()
    if not verifier:
        raise HTTPException(
            status_code=400,
            detail="No PKCE verifier — click 'Authorize on Etsy' first, then paste the code."
        )
    logger.info("Exchanging Etsy OAuth code (verifier: %d chars, code: %s...)",
                len(verifier), req.code[:8] if req.code else "?")
    conn = _get_conn()
    try:
        result = exchange_code(req.code, verifier)
        if "error" in result:
            detail = result.get("error_description", result.get("detail", result["error"]))
            raise HTTPException(status_code=400, detail=detail)
        _clear_pkce_verifier()
        creds = get_credentials()
        audit.log(conn, "etsy", "oauth_connected", {"shop_id": creds.get("shop_id", "")})
        return {"success": True, "shop_id": creds.get("shop_id", "")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.post("/etsy/oauth/refresh")
def etsy_oauth_refresh():
    """Refresh the Etsy OAuth access token using the stored refresh token.

    Call this when the token has expired (ETSY_TOKEN_EXPIRES in .env).
    Returns new token info or error with guidance.
    """
    from src.integrations.etsy import ensure_valid_token
    result = ensure_valid_token()
    if not result.get("valid"):
        status = 401 if result.get("reauth_required") else 502
        raise HTTPException(status_code=status, detail=result.get("error", "Refresh failed"))
    conn = _get_conn()
    try:
        audit.log(conn, "etsy", "token_refreshed", {"refreshed": result.get("refreshed", False)})
    finally:
        conn.close()
    return result


@app.get("/etsy/oauth/scope-check")
def etsy_scope_check():
    """Check which Etsy API scopes the current token has.

    Tests listings_r, listings_w, and transactions_r.
    Use this after token refresh to confirm write access.
    """
    from src.integrations.etsy import check_scope
    result = check_scope()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


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


class EtsyFullListingCreate(BaseModel):
    """Create a complete Etsy listing with all variations and pricing."""
    content_id: str
    shipping_profile_id: Optional[int] = None
    min_dpi: int = 150
    activate: bool = False


class EtsyComposeCreate(BaseModel):
    """Create a full Etsy draft listing directly from Compose Post."""
    title: str
    description: str
    tags: list[str] = []
    photo_id: Optional[str] = None
    image_url: Optional[str] = None           # Single image (legacy compat)
    image_urls: list[str] = []                # Multiple images from Compose selection
    shipping_profile_id: Optional[int] = None
    min_dpi: int = 150
    activate: bool = False


@app.post("/etsy/listings/create-from-compose")
def create_etsy_from_compose(req: EtsyComposeCreate):
    """Create a single-SKU Etsy draft listing from Compose Post.

    Simplified flow: one ChromaLuxe HD Metal Print per listing,
    size determined by photo orientation, no variation matrix.
    """
    from src.integrations.etsy import create_simple_listing
    from src.agents.etsy_pricing import detect_orientation, get_listing_pricing

    conn = _get_conn()
    try:
        # Look up photo dimensions for DPI calculations
        photo_w, photo_h = 6000, 4000  # Safe defaults for high-res
        image_paths = []  # Local files (original photo — reliable, no URL guessing)
        image_urls = []   # Remote URLs (mockups from localhost, etc.)
        original_photo_url = None  # Track the frontend's URL for the original photo (for dedup)

        if req.photo_id and req.photo_id != "__mockup__":
            repo_root = Path(__file__).resolve().parent.parent.parent

            if req.photo_id.startswith("fs:"):
                # Filesystem photo — resolve to local file for direct upload
                fs_rel = req.photo_id[3:]  # "Hawaii/sunset.jpg"
                parts = fs_rel.split("/", 1)
                collection = (parts[0] if len(parts) > 1 else "").lower()
                filename = parts[1] if len(parts) > 1 else parts[0]

                # Get actual dimensions from the file
                photo_path = repo_root / "photography" / fs_rel
                try:
                    from PIL import Image as _PILImage
                    img = _PILImage.open(photo_path)
                    photo_w, photo_h = img.size
                    img.close()
                except Exception:
                    pass  # Keep 6000x4000 defaults

                # Upload original directly from disk — with Archive-35 banner
                if photo_path.exists():
                    try:
                        from src.brand.watermark import add_banner_to_file
                        import tempfile
                        tmp_dir = tempfile.mkdtemp(prefix="a35_etsy_orig_")
                        branded_path = str(Path(tmp_dir) / f"branded-{photo_path.name}")
                        add_banner_to_file(str(photo_path), branded_path)
                        image_paths.append(branded_path)
                        logger.info("Original photo branded + queued: %s (%dx%d)", photo_path.name, photo_w, photo_h)
                    except Exception as e:
                        logger.warning("Banner failed, uploading raw original: %s", e)
                        image_paths.append(str(photo_path))
                        logger.info("Original photo from filesystem: %s (%dx%d)", photo_path.name, photo_w, photo_h)
                else:
                    logger.warning("Original photo not found on disk: %s", photo_path)

                # Track the URL the frontend would have for dedup
                if collection and filename:
                    base = filename.rsplit(".", 1)[0] if "." in filename else filename
                    original_photo_url = f"https://archive-35.com/images/{collection}/{base}-full.jpg"

            else:
                # DB photo lookup
                photo = conn.execute(
                    "SELECT * FROM photos WHERE id = ?", (req.photo_id,)
                ).fetchone()
                if photo:
                    photo = dict(photo)
                    photo_w = photo.get("width") or 6000
                    photo_h = photo.get("height") or 4000
                    collection = (photo.get("collection", "") or "").lower()
                    filename = photo.get("filename", "")

                    # Try local file first — with Archive-35 banner
                    if collection and filename:
                        photo_path = repo_root / "photography" / photo.get("collection", "") / filename
                        if photo_path.exists():
                            try:
                                from src.brand.watermark import add_banner_to_file
                                import tempfile
                                tmp_dir = tempfile.mkdtemp(prefix="a35_etsy_orig_")
                                branded_path = str(Path(tmp_dir) / f"branded-{photo_path.name}")
                                add_banner_to_file(str(photo_path), branded_path)
                                image_paths.append(branded_path)
                                logger.info("Original photo (DB) branded + queued: %s (%dx%d)", photo_path.name, photo_w, photo_h)
                            except Exception as e:
                                logger.warning("Banner failed for DB photo, uploading raw: %s", e)
                                image_paths.append(str(photo_path))
                                logger.info("Original photo from DB+disk: %s (%dx%d)", photo_path.name, photo_w, photo_h)
                        else:
                            # Fall back to URL
                            base = filename.rsplit(".", 1)[0] if "." in filename else filename
                            image_urls.append(
                                f"https://archive-35.com/images/{collection}/{base}-full.jpg"
                            )
                            logger.info("Original photo from URL (file not on disk): %s", image_urls[-1])

                        # Track frontend URL for dedup
                        base = filename.rsplit(".", 1)[0] if "." in filename else filename
                        original_photo_url = f"https://archive-35.com/images/{collection}/{base}-full.jpg"

        # Add all images from Compose selection (mockups + original photo)
        # Skip the original photo URL if we already have it as a local file
        for url in req.image_urls:
            if not url or not url.startswith('http'):
                continue
            if url in image_urls:
                continue
            # Skip the original photo URL — we're uploading from disk instead
            if original_photo_url and url == original_photo_url:
                continue
            image_urls.append(url)

        # Legacy: single image_url field (backwards compat)
        if req.image_url and req.image_url not in image_urls:
            if not (original_photo_url and req.image_url == original_photo_url):
                image_urls.append(req.image_url)

        logger.info("Etsy image plan: %d local files + %d URLs", len(image_paths), len(image_urls))

        # Validate title length
        title = (req.title or "Fine Art Photography Print")[:140]

        # Get pricing info for the description (uses real Pictorem API)
        pricing = get_listing_pricing(photo_w=photo_w, photo_h=photo_h)

        # Build description — single-SKU format with full specs
        description = req.description or ""
        description += f"\n\n---\n\nPRINT SPECIFICATIONS"
        description += f"\nMaterial: ChromaLuxe HD Metal — White Gloss aluminum"
        description += f"\nSize: {pricing['size_label']}"
        description += f"\nResolution: {pricing.get('photo_pixels', '')} ({pricing.get('megapixels', '')} MP) printed at {pricing.get('dpi', '')} DPI"
        description += "\nMount: Metal standoff hanging brackets included — arrives ready to hang. No frame needed."
        description += "\nShipping: Free across North America and Canada."
        description += "\n\n© Wolfgang Schram / Archive-35 Studio"
        description += "\nAll prints are made-to-order and shipped directly from our professional print lab."

        # Cap tags at 13 (Etsy limit)
        tags = (req.tags or [])[:13]

        # Create single-SKU listing via Etsy API
        result = create_simple_listing(
            title=title,
            description=description,
            tags=tags,
            photo_width=photo_w,
            photo_height=photo_h,
            image_paths=image_paths if image_paths else None,
            image_urls=image_urls if image_urls else None,
            shipping_profile_id=req.shipping_profile_id,
            activate=req.activate,
        )

        if "error" in result:
            # Preserve the full Etsy error detail so the UI shows what's actually wrong
            etsy_detail = result.get("detail", "")
            error_msg = result["error"]
            if etsy_detail:
                error_msg = f"{error_msg} | Etsy says: {etsy_detail}"
            raise HTTPException(status_code=502, detail=error_msg)

        # Record in audit log
        audit.log(conn, "etsy", "compose_listing_created", {
            "listing_id": result.get("listing_id"),
            "title": title,
            "price_usd": result.get("price_usd"),
            "material": result.get("material"),
            "size": result.get("size"),
            "activated": req.activate,
        })

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create Etsy listing from Compose: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.post("/etsy/listings/create-full")
def create_full_etsy_listing(req: EtsyFullListingCreate):
    """Create a complete Etsy listing with Material & Size × Frame variations.

    This is the one-shot endpoint that:
    1. Reads approved content + photo metadata from the database
    2. Builds the full variation matrix (5 materials × N sizes × 4 frames)
    3. Creates the listing, uploads images, sets all prices
    4. Disables Wood + Frame combos automatically
    5. Optionally activates the listing

    Returns the full listing details including variant count and price range.
    """
    from src.integrations.etsy import create_full_listing
    from src.brand.etsy_variations import build_variation_matrix, get_matrix_summary

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

        # Get photo metadata (need dimensions for DPI calc)
        photo = conn.execute(
            "SELECT * FROM photos WHERE id = ?",
            (content["photo_id"],),
        ).fetchone()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")
        photo = dict(photo)

        photo_w = photo.get("width") or photo.get("photo_width") or 6000
        photo_h = photo.get("height") or photo.get("photo_height") or 4000

        # Parse tags
        import json as _json
        try:
            tags = _json.loads(content["tags"]) if content.get("tags") else []
        except (ValueError, TypeError):
            tags = []

        # Build title
        title = content.get("title") or ""
        if not title:
            first_line = (content.get("body") or "").split("\n")[0].strip()
            title = first_line[:140] if first_line else "Fine Art Photography Print"

        # Build description
        description = content.get("body") or ""
        if content.get("provenance"):
            description += f"\n\n{content['provenance']}"
        description += "\n\n© Wolfgang Schram / Archive-35 Studio"
        description += "\nAll prints are made-to-order and shipped directly from our professional print lab."

        # Build image URL from photo metadata
        collection = photo.get("collection", "")
        filename = photo.get("filename", "")
        image_urls = []
        if collection and filename:
            # Use the full-res web image
            base = filename.rsplit(".", 1)[0] if "." in filename else filename
            image_urls.append(f"https://archive-35.com/images/{collection}/{base}-full.jpg")

        # Preview: show what would be created (dry run info)
        products = build_variation_matrix(photo_w, photo_h, min_dpi=req.min_dpi)
        summary = get_matrix_summary(products)

        # Create the full listing
        result = create_full_listing(
            title=title,
            description=description,
            tags=tags,
            photo_width=photo_w,
            photo_height=photo_h,
            image_urls=image_urls if image_urls else None,
            shipping_profile_id=req.shipping_profile_id,
            min_dpi=req.min_dpi,
            activate=req.activate,
        )

        if "error" in result:
            etsy_detail = result.get("detail", "")
            error_msg = result["error"]
            if etsy_detail:
                error_msg = f"{error_msg} | Etsy says: {etsy_detail}"
            raise HTTPException(status_code=502, detail=error_msg)

        # Record in audit log
        audit.log(conn, "etsy", "full_listing_created", {
            "listing_id": result.get("listing_id"),
            "content_id": req.content_id,
            "variants": result.get("total_variants"),
            "price_range": result.get("price_range"),
            "activated": req.activate,
        })

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create full Etsy listing: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/etsy/listings/{listing_id}/inventory")
def get_etsy_listing_inventory(listing_id: int):
    """Get current inventory/variations for an existing listing.

    Use this to inspect property IDs and variation structure
    on listings created manually, to calibrate the automation.
    """
    from src.integrations.etsy import get_listing_inventory
    result = get_listing_inventory(listing_id)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result


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


def _save_etsy_order(receipt, fulfillment_items):
    """Save order details to data/etsy_orders/ for the email briefing agent."""
    orders_dir = Path(__file__).resolve().parents[1] / "data" / "etsy_orders"
    orders_dir.mkdir(parents=True, exist_ok=True)
    receipt_id = receipt.get("receipt_id", "unknown")
    order_file = orders_dir / f"order_{receipt_id}.json"
    order_data = {
        "receipt_id": receipt_id,
        "buyer_name": receipt.get("name", ""),
        "country": receipt.get("country_iso", ""),
        "items": len(fulfillment_items),
        "grandtotal": receipt.get("grandtotal", {}),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(order_file, "w") as f:
        json.dump(order_data, f, indent=2)


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

            # Log order to file for email briefing agent
            audit.log(conn, "etsy", "etsy_order_received", {
                "receipt_id": receipt_id,
                "buyer_name": receipt.get("name", ""),
                "items": len(fulfillment_items),
            })
            _save_etsy_order(receipt, fulfillment_items)

            # Send email notification (fails silently if SMTP not configured)
            try:
                from src.notifications.email import notify_etsy_sale
                total = receipt.get("grandtotal", {})
                amount = total.get("amount", 0) / max(total.get("divisor", 100), 1)
                currency = total.get("currency_code", "USD")
                buyer_country = receipt.get("country_iso", "unknown")
                first_title = fulfillment_items[0].get("title", "Print") if fulfillment_items else "Print"
                notify_etsy_sale(first_title, amount, currency, buyer_country, str(receipt_id))
            except Exception as notify_err:
                logger.debug("Etsy sale notification skipped: %s", notify_err)

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


# ── Etsy Export Folder ─────────────────────────────────────────────


class EtsyExportRequest(BaseModel):
    """Request body for exporting listing data to a folder for browser automation."""
    title: str
    description: str
    tags: list[str] = []
    gallery_name: str  # e.g. "Lake Powell"
    selected_images: list[dict] = []  # [{type, filename, src, ...}]
    include_originals: bool = True  # Copy original photos too


@app.post("/etsy/export-folder")
def export_etsy_folder(req: EtsyExportRequest):
    """Export listing data + images to a folder for browser-assisted Etsy posting.

    Creates: 06_Automation/etsy-export/{gallery-slug}/
      ├── listing.json      (all metadata for the listing)
      ├── images/           (mockups + originals in posting order)
      └── README.txt        (human-readable summary)

    The listing.json contains everything needed to fill an Etsy listing form:
    title, description, tags, pricing variations, category, shipping, image order.
    """
    import shutil
    import re

    project_root = Path(__file__).resolve().parent.parent.parent
    etsy_export_root = project_root / "06_Automation" / "etsy-export"

    # Build a descriptive folder name using sequential numbering + gallery + title.
    # Format: NN-Gallery-Short-Title (e.g. "01-LA-Sunset-Over-Santa-Monica")
    # This makes it easy to match folders to Etsy listings when uploading manually.
    gallery_slug = re.sub(r'[^a-z0-9]+', '-', req.gallery_name.lower()).strip('-')

    # Create a short title slug from the listing title (first 40 chars, kebab-case)
    title_slug = re.sub(r'[^a-z0-9]+', '-', req.title[:40].lower()).strip('-')
    # Remove common suffixes that add noise
    for suffix in ['-fine-art-photography-print', '-fine-art-print', '-print']:
        if title_slug.endswith(suffix):
            title_slug = title_slug[:-len(suffix)].strip('-')
            break

    base_slug = f"{gallery_slug}-{title_slug}" if title_slug else gallery_slug

    # Auto-increment: scan existing folders to find next sequence number
    etsy_export_root.mkdir(parents=True, exist_ok=True)
    existing = sorted(etsy_export_root.iterdir()) if etsy_export_root.exists() else []
    next_num = 1
    for d in existing:
        if d.is_dir():
            match = re.match(r'^(\d+)-', d.name)
            if match:
                next_num = max(next_num, int(match.group(1)) + 1)

    slug = f"{next_num:02d}-{base_slug}"
    export_dir = etsy_export_root / slug
    images_dir = export_dir / "images"

    # Clean and recreate
    if export_dir.exists():
        shutil.rmtree(export_dir, ignore_errors=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    copied_images = []
    image_order = 1

    # ── Copy selected mockup images (Etsy variants) ──
    mockup_root = project_root / "mockups"
    for img in req.selected_images:
        if img.get("type") == "mockup":
            # Find the etsy variant for this mockup
            platforms = img.get("platforms", {})
            etsy_file = platforms.get("etsy") or platforms.get("full") or platforms.get("instagram")
            if etsy_file:
                src_path = mockup_root / etsy_file
                if src_path.exists():
                    dest_name = f"{image_order:02d}-mockup-{src_path.name}"
                    shutil.copy2(src_path, images_dir / dest_name)
                    copied_images.append({"order": image_order, "type": "mockup", "filename": dest_name})
                    image_order += 1

    # ── Copy original photos ──
    # Each photo has its own 'collection' property (e.g. "Argentina") which maps
    # to a Photography/{collection}/ subfolder. Use that instead of the top-level
    # gallery_name which may be derived from mockup filenames and be wrong.
    if req.include_originals:
        for img in req.selected_images:
            if img.get("type") == "photo":
                fname = img.get("filename", "")
                # Use the photo's own collection; fall back to gallery_name
                collection = img.get("collection") or req.gallery_name
                photo_dir = project_root / "Photography" / collection
                src_path = photo_dir / fname
                if src_path.exists():
                    dest_name = f"{image_order:02d}-original-{fname}"
                    shutil.copy2(src_path, images_dir / dest_name)
                    copied_images.append({"order": image_order, "type": "original", "filename": dest_name})
                    image_order += 1
                else:
                    logger.warning(f"Original photo not found: {src_path}")

    # ── Single-SKU pricing (simplified — matches current shop format) ──
    from src.agents.etsy_pricing import detect_orientation, get_listing_pricing

    photo_w, photo_h = 6000, 4000  # reasonable default for Wolf's camera

    for img in req.selected_images:
        if img.get("type") == "photo":
            fname = img.get("filename", "")
            collection = img.get("collection") or req.gallery_name
            photo_path = project_root / "Photography" / collection / fname
            if photo_path.exists():
                try:
                    from PIL import Image as PILImage
                    with PILImage.open(photo_path) as pil_img:
                        photo_w, photo_h = pil_img.size
                except Exception:
                    pass
                break

    pricing = get_listing_pricing(photo_w=photo_w, photo_h=photo_h)

    # Ensure 13 tags, each max 20 characters (Etsy limit).
    raw_tags = [t[:20] for t in req.tags if t.strip()]
    tags = list(raw_tags)[:13]
    default_tags = [
        "archive35", "fine art photography", "wall art decor",
        "photography art", "gallery wall", "art collectors",
        "contemporary art", "landscape photo", "home decor",
        "wolf schram", "nature photography", "travel photography",
        "minimalist art",
    ]
    seen = set(t.lower() for t in tags)
    for dt in default_tags:
        if len(tags) >= 13:
            break
        if dt.lower() not in seen and len(dt) <= 20:
            tags.append(dt)
            seen.add(dt.lower())

    # ── Build listing.json ──
    listing = {
        "title": req.title[:140],
        "description": req.description,
        "tags": tags[:13],
        "price": pricing["etsy_price_usd"],
        "material": pricing["material"],
        "size": pricing["size_label"],
        "orientation": pricing["orientation"],
        "category": "Art & Collectibles > Photography > Color",
        "who_made": "i_did",
        "when_made": "made_to_order",
        "is_supply": False,
        "processing_days": {"min": 5, "max": 7},
        "shipping": pricing["shipping"],
        "quantity": 999,
        "gallery_name": req.gallery_name,
        "photo_dimensions": {"width": photo_w, "height": photo_h},
        "images": copied_images,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Write listing.json
    listing_path = export_dir / "listing.json"
    listing_path.write_text(json.dumps(listing, indent=2))

    # Write human-readable README
    readme_lines = [
        f"ETSY EXPORT — {slug}",
        f"Gallery: {req.gallery_name}",
        f"Generated: {listing['generated_at']}",
        "",
        f"Title: {listing['title']}",
        f"Material: {pricing['material']}",
        f"Size: {pricing['size_label']}",
        f"Price: ${pricing['etsy_price_usd']:.0f}",
        f"Shipping: {pricing['shipping']}",
        f"Tags ({len(tags)}/13): {', '.join(tags[:13])}",
        f"Images: {len(copied_images)} files ready to upload",
        "",
        "IMAGE ORDER:",
    ]
    for img in copied_images:
        readme_lines.append(f"  {img['order']}. [{img['type']}] {img['filename']}")

    (export_dir / "README.txt").write_text("\n".join(readme_lines))

    logger.info("Exported Etsy listing to %s — %d images, single SKU @ $%.0f",
                export_dir, len(copied_images), pricing["etsy_price_usd"])

    return {
        "success": True,
        "export_path": str(export_dir),
        "folder_name": slug,
        "images_count": len(copied_images),
        "material": pricing["material"],
        "size": pricing["size_label"],
        "price": pricing["etsy_price_usd"],
        "listing_json": str(listing_path),
    }


# ── CaFE (CallForEntry.org) Endpoints ──────────────────────────────


def _portfolio_to_slug(folder_name: str) -> str:
    """Convert 01_Portfolio folder name to web image slug.

    Matches the normalization in Studio main.js (finalize-ingest):
      Alps_ → alps, Black_and_White → black-and-white
    """
    import re
    return re.sub(r'-+$', '', folder_name.strip().lower().replace('_', '-').replace(' ', '-'))


class CaFEExportRequest(BaseModel):
    """Request body for CaFE portfolio export."""
    photo_ids: list[str] = []
    metadata_overrides: dict = {}  # {photo_id: {title, description, ...}}
    call_name: str = ""  # Optional override; auto-generated from gallery_source if empty
    gallery_source: str = ""  # Gallery folder name (e.g., "Argentina")


@app.get("/cafe/galleries")
def get_cafe_galleries():
    """List all portfolio galleries with photo counts for CaFE selection."""
    project_root = Path(__file__).resolve().parent.parent.parent
    portfolio_root = project_root / "01_Portfolio"

    galleries = []
    if portfolio_root.exists():
        for d in sorted(portfolio_root.iterdir()):
            if d.is_dir() and not d.name.startswith('_'):
                photos_json = d / "_photos.json"
                photo_count = 0
                has_metadata = False
                sample_title = None

                if photos_json.exists():
                    try:
                        with open(photos_json) as f:
                            photos = json.load(f)
                        if isinstance(photos, list):
                            photo_count = len(photos)
                            has_metadata = all(
                                p.get("title") and p.get("description")
                                for p in photos
                            )
                            if photos:
                                sample_title = photos[0].get("title", "")
                    except Exception:
                        pass

                galleries.append({
                    "name": d.name,
                    "display_name": d.name.replace("_", " ").strip(),
                    "photo_count": photo_count,
                    "has_metadata": has_metadata,
                    "sample_title": sample_title,
                })

    return {"galleries": galleries, "total": len(galleries)}


@app.get("/cafe/photos")
def get_cafe_photos(
    collection: Optional[str] = None,
    limit: int = Query(default=500, le=2000),
):
    """List photos from portfolio galleries for CaFE submission selection.

    Reads directly from 01_Portfolio/{gallery}/_photos.json files.
    When collection is specified, only returns photos from that gallery.
    """
    project_root = Path(__file__).resolve().parent.parent.parent
    portfolio_root = project_root / "01_Portfolio"

    all_photos = []

    if not portfolio_root.exists():
        return {"photos": [], "total": 0}

    try:
        # If collection specified, only read that gallery
        if collection:
            gallery_dir = portfolio_root / collection
            photos_json = gallery_dir / "_photos.json"
            if photos_json.exists():
                with open(photos_json) as f:
                    photos = json.load(f)
                if isinstance(photos, list):
                    slug = _portfolio_to_slug(collection)
                    for p in photos:
                        p["collection"] = collection  # Raw folder name (for export lookups)
                        p["collection_slug"] = slug    # Web-safe slug (for image URLs)
                        fname = p.get("filename", "")
                        base = fname.rsplit(".", 1)[0] if "." in fname else fname
                        p["thumbnail_url"] = f"https://archive-35.com/images/{slug}/{base}-thumb.jpg"
                    all_photos = photos
        else:
            # Read all galleries
            for d in sorted(portfolio_root.iterdir()):
                if d.is_dir() and not d.name.startswith('_'):
                    photos_json = d / "_photos.json"
                    if photos_json.exists():
                        try:
                            with open(photos_json) as f:
                                photos = json.load(f)
                            if isinstance(photos, list):
                                slug = _portfolio_to_slug(d.name)
                                for p in photos:
                                    p["collection"] = d.name
                                    p["collection_slug"] = slug
                                    fname = p.get("filename", "")
                                    base = fname.rsplit(".", 1)[0] if "." in fname else fname
                                    p["thumbnail_url"] = f"https://archive-35.com/images/{slug}/{base}-thumb.jpg"
                                all_photos.extend(photos)
                        except Exception:
                            continue

        total = len(all_photos)
        all_photos = all_photos[:limit]

        return {"photos": all_photos, "total": total}
    except Exception as e:
        logger.error("Failed to load portfolio photos for CaFE: %s", e)
        return {"photos": [], "total": 0}


@app.get("/cafe/submissions")
def get_cafe_submissions():
    """List existing CaFE submission export folders."""
    project_root = Path(__file__).resolve().parent.parent.parent
    cafe_root = project_root / "CaFE Ready"

    items = []
    if cafe_root.exists():
        for d in sorted(cafe_root.iterdir()):
            if d.is_dir():
                sub_json = d / "submission.json"
                readme = d / "README.txt"
                images = []

                if sub_json.exists():
                    try:
                        with open(sub_json) as f:
                            images = json.load(f)
                        # Inject thumbnail_url for each image so the UI can display them
                        # Use full URL since <img src> needs absolute URLs, not IPC paths
                        for img in images:
                            fname = img.get("file", "")
                            if fname:
                                img["thumbnail_url"] = f"http://127.0.0.1:8035/cafe/image/{d.name}/{fname}"
                    except Exception:
                        pass

                items.append({
                    "id": d.name,
                    "call_name": d.name,
                    "exported_at": datetime.fromtimestamp(
                        d.stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                    "images": images,
                    "has_readme": readme.exists(),
                })

    return {"items": items}


class CaFEGenerateMetadataRequest(BaseModel):
    """Request body for generating missing CaFE metadata fields."""
    photo_ids: list[str] = []
    fields: list[str] = ["alt_text"]  # Which fields to generate


@app.post("/cafe/generate-metadata")
def generate_cafe_metadata(req: CaFEGenerateMetadataRequest):
    """Generate missing metadata (alt_text, description) for selected photos.

    Uses existing title + description to auto-generate alt_text.
    Returns a dict of {photo_id: {field: value}} for the frontend to apply.
    """
    from src.brand.cafe_export import generate_alt_text

    project_root = Path(__file__).resolve().parent.parent.parent
    portfolio_root = project_root / "01_Portfolio"

    # Build photo lookup
    photo_lookup = {}
    if portfolio_root.exists():
        for d in portfolio_root.iterdir():
            if d.is_dir() and not d.name.startswith('_'):
                photos_json = d / "_photos.json"
                if photos_json.exists():
                    try:
                        with open(photos_json) as f:
                            photos = json.load(f)
                        if isinstance(photos, list):
                            for p in photos:
                                p["_collection_dir"] = d.name
                                photo_lookup[p["id"]] = p
                    except Exception:
                        continue

    results = {}
    for pid in req.photo_ids:
        photo = photo_lookup.get(pid)
        if not photo:
            continue

        generated = {}
        title = photo.get("title", "")
        description = photo.get("description", "")

        if "alt_text" in req.fields and title:
            generated["alt_text"] = generate_alt_text(title, description, max_len=125)

        if "description" in req.fields and not description and title:
            # Simple fallback if no description exists
            generated["description"] = title

        if generated:
            results[pid] = generated

    return {"generated": results, "count": len(results)}


@app.post("/cafe/export")
def export_cafe(req: CaFEExportRequest):
    """Generate CaFE submission folder from selected photos.

    Creates: CaFE Ready/{call_name}/
      ├── submission.json  (array of image metadata for CaFE form)
      ├── README.txt       (validation report)
      └── images/          (resized JPEGs, <5MB, 1200-3000px)

    Auto-generates call_name from gallery_source + date if not provided.
    Resolves photo metadata from 01_Portfolio/{gallery}/_photos.json files.
    """
    from src.brand.cafe_export import export_cafe_folder

    project_root = Path(__file__).resolve().parent.parent.parent
    portfolio_root = project_root / "01_Portfolio"

    # Auto-generate call_name from gallery source + date
    call_name = req.call_name
    if not call_name:
        source = req.gallery_source or "submission"
        date_str = datetime.now().strftime("%Y-%m-%d")
        call_name = f"{source}_{date_str}"

    # Build photo lookup from per-gallery _photos.json files
    photo_lookup = {}
    if portfolio_root.exists():
        for d in portfolio_root.iterdir():
            if d.is_dir() and not d.name.startswith('_'):
                photos_json = d / "_photos.json"
                if photos_json.exists():
                    try:
                        with open(photos_json) as f:
                            photos = json.load(f)
                        if isinstance(photos, list):
                            for p in photos:
                                p["collection"] = d.name
                                photo_lookup[p["id"]] = p
                    except Exception:
                        continue

    # Also try data/photos.json as fallback
    photos_json_path = project_root / "data" / "photos.json"
    if photos_json_path.exists():
        try:
            with open(photos_json_path) as f:
                data = json.load(f)
            for p in data.get("photos", []):
                if p["id"] not in photo_lookup:
                    photo_lookup[p["id"]] = p
        except Exception:
            pass

    # Build image spec list
    images = []
    for pid in req.photo_ids:
        photo = photo_lookup.get(pid)
        if not photo:
            logger.warning("Photo %s not found in any metadata source, skipping", pid)
            continue

        # Find source file
        collection = photo.get("collection", req.gallery_source or "")
        filename = photo.get("filename", "")

        # Try multiple locations for source files
        src = None
        search_paths = [
            portfolio_root / collection / "originals" / filename,
            portfolio_root / collection / filename,
            project_root / "Photography" / collection / filename,
        ]
        for sp in search_paths:
            if sp.exists():
                src = sp
                break

        if not src:
            logger.warning("Source file not found for %s in %s", filename, collection)
            continue

        images.append({
            "photo_id": pid,
            "file_path": str(src),
            "overrides": req.metadata_overrides.get(pid, {}),
        })

    result = export_cafe_folder(
        call_name=call_name,
        images=images,
        project_root=project_root,
    )

    return {
        "success": result["success"],
        "folder_name": call_name,
        "export_path": result["export_path"],
        "images_count": result["images_count"],
        "errors": result.get("errors"),
    }


@app.get("/cafe/image/{submission_id}/{filename}")
def get_cafe_image(submission_id: str, filename: str):
    """Serve an image from a CaFE submission folder.

    Searches for the file in both the submission root and images/ subfolder
    to handle both manual submissions and export-generated folders.
    """
    project_root = Path(__file__).resolve().parent.parent.parent
    cafe_root = project_root / "CaFE Ready"
    folder = cafe_root / submission_id

    if not folder.exists():
        raise HTTPException(status_code=404, detail=f"Submission folder not found: {submission_id}")

    # Try multiple locations: root first, then images/ subfolder
    search_paths = [
        folder / filename,
        folder / "images" / filename,
    ]

    for path in search_paths:
        if path.exists() and path.is_file():
            return FileResponse(
                path,
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )

    raise HTTPException(status_code=404, detail=f"Image not found: {filename}")


@app.post("/cafe/export-folder/{submission_id}")
def cafe_export_folder(submission_id: str):
    """Re-export an existing CaFE submission folder (regenerate images/metadata)."""
    project_root = Path(__file__).resolve().parent.parent.parent
    cafe_root = project_root / "CaFE Ready"
    folder = cafe_root / submission_id

    if not folder.exists():
        raise HTTPException(status_code=404, detail=f"Submission folder not found: {submission_id}")

    return {
        "success": True,
        "folder_path": str(folder),
        "message": f"Folder {submission_id} exists at {folder}",
    }


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
    try:
        verification = verify_token()
    except Exception as e:
        logger.error("Instagram status check failed: %s", e)
        return {
            "configured": True,
            "valid": False,
            "username": "",
            "user_id": "",
            "token_expires": creds.get("token_expires", "unknown"),
            "error": f"Network error: {e}",
        }

    return {
        "configured": True,
        "valid": verification.get("valid", False),
        "username": verification.get("username", ""),
        "user_id": verification.get("user_id", ""),
        "token_expires": creds.get("token_expires", "unknown"),
        "error": verification.get("error"),
    }


@app.post("/instagram/auto-post")
def instagram_auto_post(dry_run: bool = False):
    """Trigger one Instagram auto-post from Etsy listing images.

    Picks the next image in rotation (30-day no-repeat), generates
    a caption with Claude + story bank, and posts to Instagram.
    """
    from src.agents.instagram_agent import post_next_image
    import anthropic

    conn = _get_conn()
    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key or api_key == "sk-ant-...":
            raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY not configured")
        client = anthropic.Anthropic(api_key=api_key)
        result = post_next_image(conn, client, dry_run=dry_run)
        if "error" in result:
            raise HTTPException(status_code=502, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Instagram auto-post failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


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


def _load_agent_env():
    """Load Agent .env into os.environ so all modules (r2_upload, etc.) can use os.getenv().

    Agent .env is at Archive 35 Agent/.env — two directories up from src/api.py.
    Only sets vars that aren't already in os.environ (no overwriting).
    """
    import os
    if os.environ.get("R2_ACCESS_KEY_ID"):
        return  # Already loaded
    agent_env = Path(__file__).resolve().parent.parent / ".env"
    if agent_env.exists():
        for line in agent_env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                if key and key not in os.environ:
                    os.environ[key] = val


def _ensure_public_url(image_url: str) -> str:
    """Convert a local image URL to a public R2 URL if needed.

    If image_url is already public (https://), returns as-is.
    If image_url is a local mockup URL (localhost), uploads to R2 first.
    """
    if image_url.startswith("https://"):
        return image_url

    # Ensure R2 credentials are loaded from Agent .env
    _load_agent_env()

    # Local URL — extract filename and upload to R2
    if "localhost" in image_url or "127.0.0.1" in image_url:
        # Extract mockup path from URL like http://localhost:8035/mockups/image/iceland/wolf/wolf-room-instagram.jpg
        rel_path = image_url.split("/mockups/image/")[-1] if "/mockups/image/" in image_url else ""
        if rel_path:
            repo_root = Path(__file__).resolve().parent.parent.parent
            local_path = repo_root / "mockups" / rel_path
            if local_path.exists():
                from src.integrations.r2_upload import upload_to_r2
                # Upload with just the filename as the R2 key (flat namespace)
                return upload_to_r2(str(local_path), f"mockups/{local_path.name}")

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

    # Step 1: Ensure we have a public URL
    try:
        public_url = _ensure_public_url(req.image_url)
    except HTTPException:
        raise  # Pass through our own errors
    except Exception as e:
        logger.error("Failed to prepare public URL for Instagram: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to prepare image for Instagram: {str(e)}"
        )

    # Step 2: Publish via Instagram API
    conn = _get_conn()
    try:
        result = publish_photo(
            image_url=public_url,
            caption=req.caption,
            conn=conn,
            photo_id=req.photo_id,
        )
        return result
    except Exception as e:
        logger.error("Instagram publish failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Instagram publish failed: {str(e)}"
        )
    finally:
        conn.close()


# ── Notifications ──────────────────────────────────────────────


class LicenseSaleNotification(BaseModel):
    image_id: str
    image_title: str = ""
    tier: str = "web"
    amount_usd: float = 0.50
    tx_hash: str = ""
    buyer_address: str = ""


@app.post("/notify/license-sale")
def notify_license_sale(sale: LicenseSaleNotification):
    """Send email notification for an x402 license sale.

    Called by the Cloudflare Pages x402 endpoint (via webhook) or
    manually when a license sale is confirmed.
    """
    from src.notifications.email import notify_x402_sale

    sent = notify_x402_sale(
        image_id=sale.image_id,
        image_title=sale.image_title or sale.image_id,
        tier=sale.tier,
        amount_usd=sale.amount_usd,
        tx_hash=sale.tx_hash,
        buyer_address=sale.buyer_address,
    )

    conn = _get_conn()
    try:
        audit.log(
            conn, "x402", "license_sale",
            {
                "image_id": sale.image_id,
                "tier": sale.tier,
                "amount": sale.amount_usd,
                "tx_hash": sale.tx_hash,
                "email_sent": sent,
            },
            cost=0,
        )
    finally:
        conn.close()

    return {"notified": sent, "image_id": sale.image_id, "tier": sale.tier}


# ── x402 Agent Request Intelligence ────────────────────────────


AGENT_REQUESTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    query_params TEXT,
    referrer TEXT,
    country TEXT
);
"""


def _ensure_agent_requests_table(conn):
    conn.execute(AGENT_REQUESTS_SCHEMA)
    conn.commit()


class AgentRequestLog(BaseModel):
    timestamp: str = ""
    ip: str = ""
    user_agent: str = ""
    query_params: dict = {}
    referrer: str = ""
    country: str = ""


@app.post("/api/license/log-request")
def log_agent_request(entry: AgentRequestLog):
    """Log an incoming AI agent request to the gallery.

    Called by the Cloudflare Pages gallery endpoint on every request.
    This is intelligence on what AI agents actually want.
    """
    conn = _get_conn()
    try:
        _ensure_agent_requests_table(conn)
        conn.execute(
            """INSERT INTO agent_requests (timestamp, ip, user_agent, query_params, referrer, country)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                entry.timestamp or datetime.now(timezone.utc).isoformat(),
                entry.ip,
                entry.user_agent[:500],
                json.dumps(entry.query_params),
                entry.referrer,
                entry.country,
            ),
        )
        conn.commit()
        return {"logged": True}
    finally:
        conn.close()


@app.get("/api/license/insights")
def agent_request_insights(days: int = Query(default=30, le=365)):
    """Return top requested subjects, use cases, moods, and locations.

    This is the intelligence dashboard — shows what AI agents are
    actually searching for in the Archive-35 catalogue.
    """
    conn = _get_conn()
    try:
        _ensure_agent_requests_table(conn)
        since = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        rows = conn.execute(
            "SELECT query_params, timestamp, user_agent, ip, country FROM agent_requests ORDER BY id DESC LIMIT 1000"
        ).fetchall()

        total_requests = len(rows)
        subjects: dict[str, int] = {}
        use_cases: dict[str, int] = {}
        moods: dict[str, int] = {}
        locations: dict[str, int] = {}
        agents: dict[str, int] = {}

        for row in rows:
            try:
                params = json.loads(row["query_params"]) if row["query_params"] else {}
            except (json.JSONDecodeError, TypeError):
                params = {}

            if params.get("subject"):
                subjects[params["subject"]] = subjects.get(params["subject"], 0) + 1
            if params.get("use_case"):
                use_cases[params["use_case"]] = use_cases.get(params["use_case"], 0) + 1
            if params.get("mood"):
                moods[params["mood"]] = moods.get(params["mood"], 0) + 1
            if params.get("location"):
                locations[params["location"]] = locations.get(params["location"], 0) + 1

            ua = (row["user_agent"] or "")[:80]
            if ua:
                agents[ua] = agents.get(ua, 0) + 1

        def top10(d):
            return sorted(d.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "total_requests": total_requests,
            "top_subjects": top10(subjects),
            "top_use_cases": top10(use_cases),
            "top_moods": top10(moods),
            "top_locations": top10(locations),
            "top_agents": top10(agents),
            "unique_ips": len(set(r["ip"] for r in rows if r["ip"])),
        }
    finally:
        conn.close()


# ── Agent Control Endpoints (Task 14) ──────────────────────────


@app.get("/agents/status")
def agents_status():
    """Return status of all agent services (Docker or process-based)."""
    import subprocess
    services = {}
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            capture_output=True, text=True, timeout=10,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        if result.returncode == 0 and result.stdout.strip():
            raw = result.stdout.strip()
            # Docker may output a JSON array or one object per line
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    svc_list = parsed
                elif isinstance(parsed, dict):
                    svc_list = [parsed]
                else:
                    svc_list = []
            except json.JSONDecodeError:
                # Try line-by-line parsing
                svc_list = []
                for line in raw.splitlines():
                    try:
                        svc_list.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
            for svc in svc_list:
                if isinstance(svc, dict):
                    name = svc.get("Service", svc.get("Name", "unknown"))
                    state = svc.get("State", svc.get("Status", "unknown"))
                    services[name] = {"status": state, "health": svc.get("Health", "")}
    except Exception as e:
        logger.warning("Docker status check failed: %s", e)

    conn = _get_conn()
    try:
        ks_list = kill_switch.get_status(conn)
        # Convert list to dict keyed by scope
        ks = {row.get("scope", ""): row for row in ks_list if isinstance(row, dict)}
        agent_names = ["instagram", "pinterest", "reddit", "etsy", "content_pipeline", "broadcast"]
        for name in agent_names:
            if name not in services:
                services[name] = {"status": "process", "health": ""}
            scope_status = ks.get(name, {})
            services[name]["kill_switch"] = scope_status.get("active", False) if isinstance(scope_status, dict) else False
            services[name]["running"] = not services[name]["kill_switch"]
    finally:
        conn.close()

    running = sum(1 for s in services.values() if s.get("running", True))
    return {"services": services, "running": running, "total": len(services)}


@app.post("/agents/restart/{agent_name}")
def restart_agent(agent_name: str):
    """Restart a specific Docker service."""
    import subprocess
    allowed = ["api", "scheduler", "telegram", "agent-scheduler", "agent-api"]
    if agent_name not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown agent: {agent_name}. Allowed: {allowed}")
    try:
        result = subprocess.run(
            ["docker", "compose", "restart", agent_name],
            capture_output=True, text=True, timeout=30,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        conn = _get_conn()
        try:
            audit.log(conn, "system", "restart_agent", {"agent": agent_name, "result": result.returncode})
        finally:
            conn.close()
        return {"restarted": agent_name, "success": result.returncode == 0, "output": result.stdout[:500]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agents/restart-all")
def restart_all_agents():
    """Restart all Docker services."""
    import subprocess
    try:
        result = subprocess.run(
            ["docker", "compose", "restart"],
            capture_output=True, text=True, timeout=60,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        return {"success": result.returncode == 0, "output": result.stdout[:500]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class BatchPostRequest(BaseModel):
    count: int = 3
    delay_minutes: int = 5


@app.post("/instagram/post-batch")
def instagram_post_batch(req: BatchPostRequest):
    """Queue multiple Instagram posts with delays. Returns immediately."""
    import threading
    import time as _time

    def _post_batch(count: int, delay_min: int):
        for i in range(count):
            try:
                from src.agents.instagram_agent import post_next_image
                import anthropic
                api_key = os.environ.get("ANTHROPIC_API_KEY", "")
                if not api_key:
                    break
                client = anthropic.Anthropic(api_key=api_key)
                conn = _get_conn()
                try:
                    post_next_image(conn, client, dry_run=False)
                finally:
                    conn.close()
                if i < count - 1:
                    _time.sleep(delay_min * 60)
            except Exception as e:
                logger.error("Batch post %d/%d failed: %s", i + 1, count, e)

    threading.Thread(target=_post_batch, args=(req.count, req.delay_minutes), daemon=True).start()
    conn = _get_conn()
    try:
        audit.log(conn, "instagram", "post_batch_started", {"count": req.count, "delay_minutes": req.delay_minutes})
    finally:
        conn.close()
    return {"status": "batch_started", "count": req.count, "delay_minutes": req.delay_minutes}


@app.get("/instagram/next-posts")
def instagram_next_posts():
    """Get the next 3 images that would be posted to Instagram."""
    conn = _get_conn()
    try:
        # Get photos not yet posted to Instagram, ordered by marketability
        rows = conn.execute("""
            SELECT p.id, p.filename, p.collection, p.path,
                   p.vision_mood, p.marketability_score
            FROM photos p
            WHERE p.id NOT IN (
                SELECT DISTINCT json_extract(details, '$.photo_id')
                FROM audit_log
                WHERE action = 'post' AND component = 'instagram_agent'
                AND json_extract(details, '$.photo_id') IS NOT NULL
            )
            ORDER BY p.marketability_score DESC
            LIMIT 3
        """).fetchall()

        posts = []
        for r in rows:
            posts.append({
                "photo_id": r["id"] if isinstance(r, dict) else r[0],
                "filename": r["filename"] if isinstance(r, dict) else r[1],
                "collection": r["collection"] if isinstance(r, dict) else r[2],
                "mood": r["vision_mood"] if isinstance(r, dict) else r[4],
                "score": r["marketability_score"] if isinstance(r, dict) else r[5],
            })
        return {"next_posts": posts}
    except Exception as e:
        return {"next_posts": [], "error": str(e)}
    finally:
        conn.close()


@app.post("/broadcast/run")
def broadcast_run():
    """Trigger the AI broadcast pipeline."""
    import subprocess
    agent_root = Path(__file__).resolve().parent.parent
    script = agent_root.parent / "06_Automation" / "scripts" / "ai_broadcast.py"
    if not script.exists():
        script = agent_root / "src" / "agents" / "ai_broadcast.py"
    if not script.exists():
        raise HTTPException(status_code=404, detail="ai_broadcast.py not found")
    try:
        result = subprocess.run(
            ["python3", str(script)], capture_output=True, text=True, timeout=120, cwd=str(agent_root),
        )
        conn = _get_conn()
        try:
            audit.log(conn, "broadcast", "manual_run", {"returncode": result.returncode})
        finally:
            conn.close()
        return {"success": result.returncode == 0, "output": result.stdout[:1000], "errors": result.stderr[:500]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/broadcast/status")
def broadcast_status():
    """Return last broadcast results from broadcast_log.json."""
    log_path = Path(__file__).resolve().parent.parent / "data" / "broadcast_log.json"
    if not log_path.exists():
        return {"last_broadcast": None, "entries": [], "total_broadcasts": 0}
    try:
        return json.loads(log_path.read_text())
    except Exception as e:
        return {"error": str(e), "entries": []}


@app.get("/api/license/agent-intelligence")
def agent_intelligence(days: int = Query(default=7, le=90)):
    """Aggregated AI agent intelligence for the dashboard."""
    conn = _get_conn()
    try:
        _ensure_agent_requests_table(conn)
        rows = conn.execute(
            "SELECT query_params, user_agent, timestamp FROM agent_requests ORDER BY id DESC LIMIT 2000"
        ).fetchall()

        search_counts: dict[str, int] = {}
        agent_types: dict[str, int] = {"ChatGPT": 0, "Claude": 0, "Copilot": 0, "Perplexity": 0, "Other": 0}

        for row in rows:
            try:
                params = json.loads(row["query_params"]) if row["query_params"] else {}
            except (json.JSONDecodeError, TypeError):
                params = {}
            query = params.get("subject") or params.get("query") or params.get("mood") or ""
            if query:
                search_counts[query] = search_counts.get(query, 0) + 1
            ua = (row["user_agent"] or "").lower()
            if "chatgpt" in ua or "openai" in ua:
                agent_types["ChatGPT"] += 1
            elif "claude" in ua or "anthropic" in ua:
                agent_types["Claude"] += 1
            elif "copilot" in ua or "bing" in ua:
                agent_types["Copilot"] += 1
            elif "perplexity" in ua:
                agent_types["Perplexity"] += 1
            elif ua:
                agent_types["Other"] += 1

        trending = []
        for query, count in sorted(search_counts.items(), key=lambda x: x[1], reverse=True)[:15]:
            licenses_sold = 0
            try:
                r = conn.execute("SELECT COUNT(*) as cnt FROM license_sales WHERE image_id LIKE ?", (f"%{query}%",)).fetchone()
                licenses_sold = r["cnt"] if r else 0
            except Exception:
                pass
            trending.append({"query": query, "count": count, "licenses_sold": licenses_sold})

        revenue = {"period": f"{days}d", "micro_total": 0.0, "commercial_total": 0.0, "top_image": "none"}
        try:
            sales_rows = conn.execute("SELECT * FROM license_sales ORDER BY id DESC LIMIT 200").fetchall()
            for s in sales_rows:
                sd = dict(s)
                revenue["commercial_total" if sd.get("tier") == "commercial" else "micro_total"] += sd.get("amount_usd", 0)
            if sales_rows:
                revenue["top_image"] = dict(sales_rows[0]).get("image_id", "unknown")
        except Exception:
            pass

        unmet = []
        for query, count in sorted(search_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
            if count >= 3 and not any(t["query"] == query and t["licenses_sold"] > 0 for t in trending):
                unmet.append({"query": query, "search_count": count, "best_match_score": 0.0})

        return {
            "trending_searches": trending, "agent_types": agent_types,
            "unmet_demand": unmet[:10], "revenue": revenue,
            "total_requests": len(rows),
            "unique_agents": len(set(r["user_agent"] for r in rows if r["user_agent"])),
        }
    except Exception as e:
        logger.error("Agent intelligence failed: %s", e)
        return {"trending_searches": [], "agent_types": {}, "unmet_demand": [],
                "revenue": {"period": "7d", "micro_total": 0, "commercial_total": 0, "top_image": "none"},
                "total_requests": 0, "unique_agents": 0, "error": str(e)}
    finally:
        conn.close()


@app.get("/etsy/seo-report")
def etsy_seo_report():
    """Return latest Etsy SEO report."""
    report_path = Path(__file__).resolve().parent.parent / "data" / "etsy_seo_report.json"
    if not report_path.exists():
        return {"error": "No SEO report found.", "summary": None}
    try:
        return json.loads(report_path.read_text())
    except Exception as e:
        return {"error": str(e), "summary": None}


@app.post("/etsy/seo-run")
def etsy_seo_run():
    """Trigger the Etsy SEO agent."""
    import subprocess
    agent_root = Path(__file__).resolve().parent.parent
    script = agent_root / "src" / "agents" / "etsy_seo_agent.py"
    if not script.exists():
        raise HTTPException(status_code=404, detail="etsy_seo_agent.py not found")
    try:
        result = subprocess.run(
            ["python3", str(script)], capture_output=True, text=True, timeout=120, cwd=str(agent_root),
        )
        return {"success": result.returncode == 0, "output": result.stdout[:1000]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/pinterest/generate-pins")
def pinterest_generate_pins():
    """Trigger pinterest_pin_generator.py."""
    import subprocess
    agent_root = Path(__file__).resolve().parent.parent
    script = agent_root.parent / "06_Automation" / "scripts" / "pinterest_pin_generator.py"
    if not script.exists():
        for alt in [agent_root / "src" / "agents" / "pinterest_pin_generator.py", agent_root / "pinterest_pin_generator.py"]:
            if alt.exists():
                script = alt
                break
    if not script.exists():
        return {"error": "pinterest_pin_generator.py not found", "success": False}
    try:
        result = subprocess.run(
            ["python3", str(script)], capture_output=True, text=True, timeout=180, cwd=str(agent_root),
        )
        return {"success": result.returncode == 0, "output": result.stdout[:1000]}
    except Exception as e:
        return {"error": str(e), "success": False}


@app.get("/pinterest/pin-status")
def pinterest_pin_status():
    """Return generated pin count and last batch date."""
    agent_root = Path(__file__).resolve().parent.parent
    pin_dir = agent_root / "data" / "pinterest_pins"
    if not pin_dir.exists():
        pin_dir = agent_root.parent / "mockups" / "pinterest"
    pin_count = 0
    last_batch = None
    if pin_dir and pin_dir.exists():
        pins = list(pin_dir.glob("*.jpg")) + list(pin_dir.glob("*.png")) + list(pin_dir.glob("*.webp"))
        pin_count = len(pins)
        if pins:
            latest = max(pins, key=lambda p: p.stat().st_mtime)
            last_batch = datetime.fromtimestamp(latest.stat().st_mtime, tz=timezone.utc).isoformat()
    return {"pin_count": pin_count, "last_batch": last_batch}


@app.get("/pinterest/pin-image/{filename}")
def serve_pin_image(filename: str):
    """Serve a generated Pinterest pin image."""
    pin_dir = Path(__file__).resolve().parents[2] / "02_Social" / "pinterest" / "pins"
    filepath = pin_dir / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Pin image not found")
    from fastapi.responses import FileResponse
    return FileResponse(filepath, media_type="image/png")


@app.get("/pinterest/pins-list")
def list_pin_images():
    """List all generated Pinterest pin images."""
    pin_dir = Path(__file__).resolve().parents[2] / "02_Social" / "pinterest" / "pins"
    if not pin_dir.exists():
        return {"pins": []}
    pins = sorted([f.name for f in pin_dir.glob("*.png")], reverse=True)
    return {"pins": pins[:20], "total": len(pins)}


@app.get("/system/docker-status")
def system_docker_status():
    """Return Docker container statuses."""
    import subprocess
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            capture_output=True, text=True, timeout=10,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        containers = []
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                try:
                    containers.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return {"containers": containers, "docker_available": True}
    except FileNotFoundError:
        return {"containers": [], "docker_available": False, "error": "Docker not found"}
    except Exception as e:
        return {"containers": [], "docker_available": False, "error": str(e)}


@app.post("/system/restart-all")
def system_restart_all():
    """Restart all Docker containers."""
    import subprocess
    try:
        result = subprocess.run(
            ["docker", "compose", "restart"], capture_output=True, text=True, timeout=60,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        return {"success": result.returncode == 0, "output": result.stdout[:500]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/audit/log")
def audit_log_paginated(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    component: Optional[str] = None,
):
    """Return paginated, filterable audit log entries."""
    conn = _get_conn()
    try:
        conditions = []
        params: list = []
        if component:
            conditions.append("component = ?")
            params.append(component)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        total = conn.execute(f"SELECT COUNT(*) as cnt FROM audit_log {where}", params).fetchone()["cnt"]
        params.extend([limit, offset])
        rows = conn.execute(
            f"SELECT * FROM audit_log {where} ORDER BY id DESC LIMIT ? OFFSET ?", params
        ).fetchall()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        cost_today = conn.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) as total FROM audit_log WHERE timestamp LIKE ?",
            (f"{today}%",),
        ).fetchone()["total"]
        return {"entries": [dict(r) for r in rows], "total": total, "cost_today": round(cost_today, 4)}
    finally:
        conn.close()


@app.get("/licensing/dashboard")
def licensing_dashboard():
    """Return micro-licensing stats for the dashboard."""
    conn = _get_conn()
    try:
        try:
            catalog_count = conn.execute("SELECT COUNT(*) as cnt FROM photos").fetchone()["cnt"]
        except Exception:
            catalog_count = 0
        revenue = 0.0
        licenses_sold = 0
        tier_breakdown = {"thumbnail": 0, "web": 0, "commercial": 0}
        top_images: list[dict] = []
        try:
            sales = conn.execute("SELECT * FROM license_sales ORDER BY id DESC").fetchall()
            licenses_sold = len(sales)
            for s in sales:
                sd = dict(s)
                revenue += sd.get("amount_usd", 0)
                tier = sd.get("tier", "web")
                if tier in tier_breakdown:
                    tier_breakdown[tier] += 1
            top = conn.execute(
                "SELECT image_id, COUNT(*) as cnt, SUM(amount_usd) as rev FROM license_sales GROUP BY image_id ORDER BY cnt DESC LIMIT 5"
            ).fetchall()
            top_images = [dict(r) for r in top]
        except Exception:
            pass
        micro_versions = 0
        try:
            micro_dir = Path(__file__).resolve().parent.parent.parent / "public" / "micro"
            if micro_dir.exists():
                micro_versions = len(list(micro_dir.glob("*")))
        except Exception:
            pass
        return {
            "total_revenue": round(revenue, 2), "licenses_sold": licenses_sold,
            "catalog_size": catalog_count, "tier_breakdown": tier_breakdown,
            "top_images": top_images, "micro_versions": micro_versions,
        }
    finally:
        conn.close()


# ── Email Briefing ─────────────────────────────────────────────


@app.get("/email/briefing")
def email_briefing():
    """Get the latest email briefing."""
    briefing_file = Path(__file__).resolve().parents[1] / "data" / "email_briefings" / "latest.json"
    if briefing_file.exists():
        with open(briefing_file) as f:
            return json.load(f)
    return {"error": "No briefing generated yet. Run email_briefing_agent.py first."}


@app.post("/email/briefing/run")
def run_email_briefing():
    """Trigger a new email briefing scan across all 3 accounts."""
    import subprocess
    script = Path(__file__).resolve().parents[1] / "src" / "agents" / "email_briefing_agent.py"
    result = subprocess.run(
        [sys.executable, str(script), "--days", "1"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode == 0:
        return {"status": "success", "output": result.stdout.strip()}
    return {"status": "error", "message": result.stderr[:500]}


class EmailActionRequest(BaseModel):
    account: str  # "archive35", "gmail", or "icloud"
    uid: str


@app.post("/email/delete")
def delete_email(req: EmailActionRequest):
    """Move an email to trash via IMAP."""
    from src.agents.email_briefing_agent import load_env
    env = load_env()
    accounts = {
        "archive35": ("imap.gmail.com", env.get("ARCHIVE35_EMAIL", ""), env.get("ARCHIVE35_APP_PASSWORD", "")),
        "gmail": ("imap.gmail.com", env.get("GMAIL_EMAIL", ""), env.get("GMAIL_APP_PASSWORD", "")),
        "icloud": ("imap.mail.me.com", env.get("ICLOUD_EMAIL", ""), env.get("ICLOUD_APP_PASSWORD", "")),
    }
    if req.account not in accounts:
        raise HTTPException(status_code=400, detail=f"Unknown account: {req.account}")
    host, email_addr, password = accounts[req.account]
    if not email_addr or not password:
        raise HTTPException(status_code=400, detail=f"Account {req.account} not configured")
    try:
        import imaplib
        conn = imaplib.IMAP4_SSL(host, 993)
        conn.login(email_addr, password)
        conn.select("INBOX")
        trash_folder = "[Gmail]/Trash" if "gmail" in host else "Deleted Messages"
        conn.uid("COPY", req.uid, trash_folder)
        conn.uid("STORE", req.uid, "+FLAGS", "(\\Deleted)")
        conn.expunge()
        conn.logout()
        return {"status": "deleted", "uid": req.uid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/email/archive")
def archive_email(req: EmailActionRequest):
    """Archive an email (remove from inbox, keep in All Mail)."""
    from src.agents.email_briefing_agent import load_env
    env = load_env()
    accounts = {
        "archive35": ("imap.gmail.com", env.get("ARCHIVE35_EMAIL", ""), env.get("ARCHIVE35_APP_PASSWORD", "")),
        "gmail": ("imap.gmail.com", env.get("GMAIL_EMAIL", ""), env.get("GMAIL_APP_PASSWORD", "")),
        "icloud": ("imap.mail.me.com", env.get("ICLOUD_EMAIL", ""), env.get("ICLOUD_APP_PASSWORD", "")),
    }
    if req.account not in accounts:
        raise HTTPException(status_code=400, detail=f"Unknown account: {req.account}")
    host, email_addr, password = accounts[req.account]
    if not email_addr or not password:
        raise HTTPException(status_code=400, detail=f"Account {req.account} not configured")
    try:
        import imaplib
        conn = imaplib.IMAP4_SSL(host, 993)
        conn.login(email_addr, password)
        conn.select("INBOX")
        if "gmail" in host:
            # Gmail: removing \Inbox label effectively archives
            conn.uid("STORE", req.uid, "-FLAGS", "(\\Seen)")
            conn.uid("COPY", req.uid, "[Gmail]/All Mail")
            conn.uid("STORE", req.uid, "+FLAGS", "(\\Deleted)")
            conn.expunge()
        else:
            # iCloud: move to Archive
            conn.uid("COPY", req.uid, "Archive")
            conn.uid("STORE", req.uid, "+FLAGS", "(\\Deleted)")
            conn.expunge()
        conn.logout()
        return {"status": "archived", "uid": req.uid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 7: Data Intelligence Endpoints ────────────────────────


@app.get("/analytics/cloudflare")
def get_cloudflare_analytics():
    """Pull real visitor data from Cloudflare Analytics API."""
    import httpx

    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")

    if not token or not zone_id:
        return {
            "configured": False,
            "setup_instructions": "Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to .env. Get token from dash.cloudflare.com → API Tokens → Analytics Read template."
        }

    headers = {"Authorization": f"Bearer {token}"}
    since_7d = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    since_1d = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    query = """
    query {
      viewer {
        zones(filter: {zoneTag: "%s"}) {
          httpRequests1dGroups(limit: 7, orderBy: [date_DESC], filter: {date_gt: "%s"}) {
            dimensions { date }
            sum { requests pageViews }
            uniq { uniques }
          }
          httpRequestsAdaptiveGroups(limit: 20, filter: {date_gt: "%s"}, orderBy: [count_DESC]) {
            dimensions { clientRequestPath }
            count
          }
        }
      }
    }
    """ % (zone_id, since_7d, since_1d)

    try:
        r = httpx.post(
            "https://api.cloudflare.com/client/v4/graphql",
            headers=headers,
            json={"query": query},
            timeout=15,
        )
        if r.status_code != 200:
            return {"configured": True, "error": f"Cloudflare API returned {r.status_code}"}

        data = r.json()

        # Handle GraphQL errors
        if data.get("errors"):
            return {"configured": True, "error": data["errors"][0].get("message", "Unknown GraphQL error"), "raw_errors": data["errors"]}

        viewer = data.get("data") or {}
        viewer = viewer.get("viewer") or {}
        zones = viewer.get("zones") or []
        if not zones:
            return {"configured": True, "error": "No zone data returned. Check zone ID.", "zone_id_used": zone_id}

        zone = zones[0] or {}
        daily = zone.get("httpRequests1dGroups") or []
        top_pages = zone.get("httpRequestsAdaptiveGroups") or []

        return {
            "configured": True,
            "daily_stats": [{
                "date": d.get("dimensions", {}).get("date", ""),
                "visitors": d.get("uniq", {}).get("uniques", 0),
                "page_views": d.get("sum", {}).get("pageViews", 0),
                "requests": d.get("sum", {}).get("requests", 0),
            } for d in daily],
            "top_pages": [{
                "path": p.get("dimensions", {}).get("clientRequestPath", ""),
                "views": p.get("count", 0),
            } for p in (top_pages or [])[:10]],
            "totals": {
                "visitors_7d": sum(d.get("uniq", {}).get("uniques", 0) for d in daily),
                "page_views_7d": sum(d.get("sum", {}).get("pageViews", 0) for d in daily),
                "visitors_today": daily[0].get("uniq", {}).get("uniques", 0) if daily else 0,
                "page_views_today": daily[0].get("sum", {}).get("pageViews", 0) if daily else 0,
            }
        }
    except Exception as e:
        import traceback
        return {"configured": True, "error": str(e), "traceback": traceback.format_exc()}


@app.get("/analytics/athos")
def get_athos_analytics():
    """Pull visitor data for athos-obs.com from Cloudflare Analytics API."""
    import httpx

    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    zone_id = os.environ.get("CLOUDFLARE_ATHOS_ZONE_ID")

    if not token or not zone_id:
        return {
            "configured": False,
            "setup_instructions": "Add CLOUDFLARE_ATHOS_ZONE_ID to .env. Same Cloudflare token works for both zones."
        }

    headers = {"Authorization": f"Bearer {token}"}
    since_7d = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    since_1d = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    query = """
    query {
      viewer {
        zones(filter: {zoneTag: "%s"}) {
          httpRequests1dGroups(limit: 7, orderBy: [date_DESC], filter: {date_gt: "%s"}) {
            dimensions { date }
            sum { requests pageViews }
            uniq { uniques }
          }
          httpRequestsAdaptiveGroups(limit: 10, filter: {date_gt: "%s"}, orderBy: [count_DESC]) {
            dimensions { clientRequestPath }
            count
          }
        }
      }
    }
    """ % (zone_id, since_7d, since_1d)

    try:
        r = httpx.post(
            "https://api.cloudflare.com/client/v4/graphql",
            headers=headers,
            json={"query": query},
            timeout=15,
        )
        if r.status_code != 200:
            return {"configured": True, "error": f"Cloudflare API returned {r.status_code}"}

        data = r.json()

        # Handle GraphQL errors
        if data.get("errors"):
            return {"configured": True, "error": data["errors"][0].get("message", "Unknown GraphQL error"), "raw_errors": data["errors"]}

        viewer = data.get("data") or {}
        viewer = viewer.get("viewer") or {}
        zones = viewer.get("zones") or []
        if not zones:
            return {"configured": True, "error": "No zone data returned", "zone_id_used": zone_id}

        zone = zones[0] or {}
        daily = zone.get("httpRequests1dGroups") or []
        top_pages = zone.get("httpRequestsAdaptiveGroups") or []

        return {
            "configured": True,
            "daily_stats": [{
                "date": d.get("dimensions", {}).get("date", ""),
                "visitors": d.get("uniq", {}).get("uniques", 0),
                "page_views": d.get("sum", {}).get("pageViews", 0),
            } for d in daily],
            "top_pages": [{
                "path": p.get("dimensions", {}).get("clientRequestPath", ""),
                "views": p.get("count", 0),
            } for p in (top_pages or [])[:10]],
            "totals": {
                "visitors_7d": sum(d.get("uniq", {}).get("uniques", 0) for d in daily),
                "page_views_7d": sum(d.get("sum", {}).get("pageViews", 0) for d in daily),
                "visitors_today": daily[0].get("uniq", {}).get("uniques", 0) if daily else 0,
            }
        }
    except Exception as e:
        import traceback
        return {"configured": True, "error": str(e), "traceback": traceback.format_exc()}


@app.get("/instagram/insights")
def get_instagram_insights():
    """Pull engagement metrics from Instagram Graph API."""
    import httpx

    # Try to get credentials from existing integration
    token = None
    user_id = None
    try:
        from src.integrations.instagram import get_credentials
        creds = get_credentials()
        token = creds.get("access_token")
        user_id = creds.get("user_id") or creds.get("scoped_user_id")
    except Exception:
        token = os.environ.get("INSTAGRAM_ACCESS_TOKEN")
        user_id = os.environ.get("INSTAGRAM_USER_ID")

    if not token or not user_id:
        return {"configured": False}

    try:
        # Account insights
        r = httpx.get(
            f"https://graph.instagram.com/v21.0/{user_id}/insights",
            params={
                "metric": "impressions,reach,profile_views,website_clicks,follower_count",
                "period": "day",
                "access_token": token,
            },
            timeout=15,
        )
        if r.status_code == 400:
            # Instagram insights requires Business/Creator account with 100+ followers
            # Don't spam logs — this is expected in Development Mode
            return {"configured": True, "insights_available": False, "note": "Instagram app in Development Mode — insights require Business account with 100+ followers", "recent_media": []}
        insights_data = r.json().get("data", []) if r.status_code == 200 else []

        # Recent media
        media_r = httpx.get(
            f"https://graph.instagram.com/v21.0/{user_id}/media",
            params={
                "fields": "id,caption,media_type,timestamp,like_count,comments_count,permalink",
                "limit": 10,
                "access_token": token,
            },
            timeout=15,
        )
        media = media_r.json().get("data", []) if media_r.status_code == 200 else []

        return {
            "configured": True,
            "insights": {m["name"]: m.get("values", []) for m in insights_data},
            "recent_media": [{
                "id": m.get("id"),
                "caption": (m.get("caption", "")[:100] + "..." if len(m.get("caption", "")) > 100 else m.get("caption", "")),
                "likes": m.get("like_count", 0),
                "comments": m.get("comments_count", 0),
                "timestamp": m.get("timestamp"),
                "permalink": m.get("permalink"),
            } for m in media],
        }
    except Exception as e:
        return {"configured": True, "error": str(e)}


@app.get("/etsy/shop-stats")
def get_etsy_shop_stats():
    """Get real shop statistics from Etsy API."""
    from src.integrations.etsy import EtsyClient

    try:
        client = EtsyClient()
        if not client.access_token:
            return {"configured": False, "message": "Etsy token expired or missing. Reauthorize."}

        data = client.get_listings(state="active", limit=100)
        if "error" in data:
            return {"configured": False, "error": data["error"]}

        listings = data.get("results", [])
        total_count = data.get("count", len(listings))

        total_views = sum(l.get("views", 0) for l in listings)
        total_favorites = sum(l.get("num_favorers", 0) for l in listings)
        zero_view = [l for l in listings if l.get("views", 0) == 0]

        by_views = sorted(listings, key=lambda l: l.get("views", 0), reverse=True)

        return {
            "configured": True,
            "total_listings": total_count,
            "total_views": total_views,
            "total_favorites": total_favorites,
            "zero_view_count": len(zero_view),
            "top_5": [{
                "title": l.get("title", "")[:60],
                "views": l.get("views", 0),
                "favorites": l.get("num_favorers", 0),
            } for l in by_views[:5]],
            "worst_5": [{
                "title": l.get("title", "")[:60],
                "views": l.get("views", 0),
                "favorites": l.get("num_favorers", 0),
            } for l in by_views[-5:]],
        }
    except Exception as e:
        return {"configured": False, "error": str(e)}


# ── CLI Entry Point ─────────────────────────────────────────────


def main():
    """Start the API server."""
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    # Use 0.0.0.0 so Docker container accepts connections from host
    bind_host = os.environ.get("API_HOST", "0.0.0.0")
    uvicorn.run(app, host=bind_host, port=8035, log_level="info")


if __name__ == "__main__":
    main()
