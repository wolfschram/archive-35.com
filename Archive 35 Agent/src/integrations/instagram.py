"""Instagram Graph API integration for Archive-35.

Handles:
- Publishing photos (2-step: create container → publish)
- Token refresh (long-lived tokens, 60-day expiry)
- Rate limiting (25 posts per 24 hours)

Requirements:
- Images must be at a PUBLIC URL (no local uploads)
- JPEG recommended, max 8MB, aspect ratio 4:5 to 1.91:1
- App is in Development Mode — only testers can post
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Instagram API base
IG_API_BASE = "https://graph.instagram.com/v21.0"

# Max posts per 24-hour window
MAX_POSTS_PER_DAY = 25


def _get_env(key: str, default: str = "") -> str:
    """Read from Agent .env, fall back to os.environ."""
    return os.environ.get(key, default)


def _load_env_file() -> dict[str, str]:
    """Load Agent .env file and return as dict."""
    env_vars: dict[str, str] = {}
    # Try Agent .env first
    agent_env = Path(__file__).parent.parent.parent / ".env"
    if agent_env.exists():
        for line in agent_env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                env_vars[key.strip()] = value.strip()
    return env_vars


def get_credentials() -> dict[str, str]:
    """Get Instagram API credentials from environment.

    Returns dict with: access_token, user_id, app_id, app_secret
    """
    env = _load_env_file()
    return {
        "access_token": env.get("INSTAGRAM_ACCESS_TOKEN", _get_env("INSTAGRAM_ACCESS_TOKEN")),
        "user_id": env.get("INSTAGRAM_USER_ID", _get_env("INSTAGRAM_USER_ID")),
        "scoped_user_id": env.get("INSTAGRAM_SCOPED_USER_ID", _get_env("INSTAGRAM_SCOPED_USER_ID")),
        "app_id": env.get("INSTAGRAM_APP_ID", _get_env("INSTAGRAM_APP_ID")),
        "app_secret": env.get("INSTAGRAM_APP_SECRET", _get_env("INSTAGRAM_APP_SECRET")),
        "token_expires": env.get("INSTAGRAM_TOKEN_EXPIRES", _get_env("INSTAGRAM_TOKEN_EXPIRES")),
    }


def is_configured() -> bool:
    """Check if Instagram credentials are present."""
    creds = get_credentials()
    return bool(creds["access_token"] and creds["user_id"])


def _api_request(
    url: str,
    method: str = "GET",
    data: Optional[dict] = None,
    timeout: int = 30,
) -> dict:
    """Make an Instagram Graph API request.

    Returns parsed JSON response or raises exception.
    """
    if data and method == "POST":
        encoded = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(url, data=encoded, method="POST")
    else:
        req = urllib.request.Request(url, method=method)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        logger.error("Instagram API error %d: %s", e.code, body)
        try:
            return {"error": json.loads(body).get("error", {"message": body})}
        except json.JSONDecodeError:
            return {"error": {"message": body, "code": e.code}}


# ── Token Management ─────────────────────────────────────────────


def verify_token() -> dict:
    """Verify the current access token works.

    Returns: {valid: bool, username: str, user_id: str, permissions: list}
    """
    creds = get_credentials()
    if not creds["access_token"]:
        return {"valid": False, "error": "No access token configured"}

    token = urllib.parse.quote(creds["access_token"])
    url = f"{IG_API_BASE}/me?fields=id,username,user_id&access_token={token}"
    result = _api_request(url)

    if "error" in result:
        return {"valid": False, "error": result["error"].get("message", str(result["error"]))}

    return {
        "valid": True,
        "username": result.get("username", ""),
        "user_id": result.get("user_id", ""),
        "scoped_id": result.get("id", ""),
    }


def refresh_token() -> dict:
    """Refresh the long-lived access token (extends for another 60 days).

    Returns: {success: bool, expires_in: int, permissions: str}
    """
    creds = get_credentials()
    if not creds["access_token"]:
        return {"success": False, "error": "No access token configured"}

    token = urllib.parse.quote(creds["access_token"])
    url = f"{IG_API_BASE.replace('/v21.0', '')}/refresh_access_token?grant_type=ig_refresh_token&access_token={token}"
    result = _api_request(url)

    if "error" in result:
        return {"success": False, "error": result["error"].get("message", str(result["error"]))}

    new_token = result.get("access_token", "")
    expires_in = result.get("expires_in", 0)
    permissions = result.get("permissions", "")

    # Update .env file with new token
    if new_token:
        _update_env_token(new_token, expires_in)

    return {
        "success": True,
        "expires_in": expires_in,
        "expires_days": round(expires_in / 86400, 1),
        "permissions": permissions,
    }


def _update_env_token(new_token: str, expires_in: int) -> None:
    """Update the .env file with a refreshed token."""
    agent_env = Path(__file__).parent.parent.parent / ".env"
    if not agent_env.exists():
        logger.warning("Agent .env not found, cannot update token")
        return

    content = agent_env.read_text()
    lines = content.splitlines()
    new_lines = []

    from datetime import timedelta
    expiry_date = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).strftime("%Y-%m-%d")

    for line in lines:
        if line.startswith("INSTAGRAM_ACCESS_TOKEN="):
            new_lines.append(f"INSTAGRAM_ACCESS_TOKEN={new_token}")
        elif line.startswith("INSTAGRAM_TOKEN_EXPIRES="):
            new_lines.append(f"INSTAGRAM_TOKEN_EXPIRES={expiry_date}")
        else:
            new_lines.append(line)

    agent_env.write_text("\n".join(new_lines) + "\n")
    logger.info("Updated Instagram token in .env (expires %s)", expiry_date)


# ── Publishing ───────────────────────────────────────────────────


def create_media_container(
    image_url: str,
    caption: str,
) -> dict:
    """Step 1: Create a media container for a photo post.

    Args:
        image_url: PUBLIC URL of the image (must be accessible by Instagram)
        caption: Post caption (max 2200 chars, max 30 hashtags)

    Returns: {id: container_id} or {error: ...}
    """
    creds = get_credentials()
    if not creds["access_token"] or not creds["user_id"]:
        return {"error": {"message": "Instagram not configured"}}

    url = f"{IG_API_BASE}/{creds['user_id']}/media"
    data = {
        "image_url": image_url,
        "caption": caption,
        "access_token": creds["access_token"],
    }

    result = _api_request(url, method="POST", data=data)
    if "error" in result:
        logger.error("Failed to create media container: %s", result["error"])
    else:
        logger.info("Created media container: %s", result.get("id"))

    return result


def publish_container(container_id: str) -> dict:
    """Step 2: Publish a media container.

    Args:
        container_id: ID from create_media_container()

    Returns: {id: media_id} or {error: ...}
    """
    creds = get_credentials()
    if not creds["access_token"] or not creds["user_id"]:
        return {"error": {"message": "Instagram not configured"}}

    url = f"{IG_API_BASE}/{creds['user_id']}/media_publish"
    data = {
        "creation_id": container_id,
        "access_token": creds["access_token"],
    }

    result = _api_request(url, method="POST", data=data)
    if "error" in result:
        logger.error("Failed to publish container %s: %s", container_id, result["error"])
    else:
        logger.info("Published media: %s", result.get("id"))

    return result


def check_container_status(container_id: str) -> dict:
    """Check if a media container is ready to publish.

    Returns: {status: str, status_code: str}
    Status codes: EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED
    """
    creds = get_credentials()
    token = urllib.parse.quote(creds["access_token"])
    url = f"{IG_API_BASE}/{container_id}?fields=status,status_code&access_token={token}"
    return _api_request(url)


def publish_photo(
    image_url: str,
    caption: str,
    conn: Optional[sqlite3.Connection] = None,
    photo_id: Optional[str] = None,
    max_wait: int = 30,
) -> dict:
    """Full publish flow: create container → wait → publish.

    Args:
        image_url: Public URL of the image
        caption: Post caption
        conn: DB connection (for audit logging)
        photo_id: Photo ID (for audit logging)
        max_wait: Max seconds to wait for container to be ready

    Returns: {success: bool, media_id: str} or {success: bool, error: str}
    """
    # Step 1: Create container
    container = create_media_container(image_url, caption)
    if "error" in container:
        error_msg = container["error"].get("message", str(container["error"]))
        if conn:
            _audit_log(conn, "publish_failed", {
                "photo_id": photo_id,
                "error": error_msg,
                "step": "create_container",
            })
        return {"success": False, "error": error_msg}

    container_id = container.get("id")
    if not container_id:
        return {"success": False, "error": "No container ID returned"}

    # Step 2: Wait for container to be ready
    waited = 0
    while waited < max_wait:
        status = check_container_status(container_id)
        status_code = status.get("status_code", "")

        if status_code == "FINISHED":
            break
        elif status_code in ("ERROR", "EXPIRED"):
            error_msg = f"Container {status_code}: {status.get('status', '')}"
            if conn:
                _audit_log(conn, "publish_failed", {
                    "photo_id": photo_id,
                    "container_id": container_id,
                    "error": error_msg,
                    "step": "container_status",
                })
            return {"success": False, "error": error_msg}

        time.sleep(2)
        waited += 2

    if waited >= max_wait:
        return {"success": False, "error": f"Container not ready after {max_wait}s"}

    # Step 3: Publish
    result = publish_container(container_id)
    if "error" in result:
        error_msg = result["error"].get("message", str(result["error"]))
        if conn:
            _audit_log(conn, "publish_failed", {
                "photo_id": photo_id,
                "container_id": container_id,
                "error": error_msg,
                "step": "publish",
            })
        return {"success": False, "error": error_msg}

    media_id = result.get("id", "")

    if conn:
        _audit_log(conn, "published", {
            "photo_id": photo_id,
            "media_id": media_id,
            "container_id": container_id,
            "platform": "instagram",
        })

    return {"success": True, "media_id": media_id, "container_id": container_id}


def _audit_log(
    conn: sqlite3.Connection,
    action: str,
    details: dict,
    success: bool = True,
) -> None:
    """Write to audit_log table."""
    try:
        conn.execute(
            """INSERT INTO audit_log (component, action, details, success, timestamp)
               VALUES (?, ?, ?, ?, ?)""",
            (
                "instagram",
                action,
                json.dumps(details),
                success,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()
    except Exception as e:
        logger.warning("Failed to write audit log: %s", e)


# ── Account Info ─────────────────────────────────────────────────


def get_account_info() -> dict:
    """Get Instagram account info including follower count."""
    creds = get_credentials()
    if not creds["access_token"]:
        return {"error": "Not configured"}

    token = urllib.parse.quote(creds["access_token"])
    url = f"{IG_API_BASE}/me?fields=id,username,account_type,media_count,followers_count,follows_count&access_token={token}"
    return _api_request(url)


def get_recent_media(limit: int = 10) -> dict:
    """Get recent media posts."""
    creds = get_credentials()
    if not creds["access_token"]:
        return {"error": "Not configured"}

    token = urllib.parse.quote(creds["access_token"])
    url = f"{IG_API_BASE}/me/media?fields=id,caption,media_type,timestamp,permalink&limit={limit}&access_token={token}"
    return _api_request(url)
