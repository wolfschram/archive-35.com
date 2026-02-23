"""Pinterest API v5 integration for Archive-35.

Handles:
- OAuth 2.0 flow for Pinterest API v5
- Creating pins with images, titles, descriptions, and links
- Managing boards (list, create)
- Reading pin analytics (when Standard tier is granted)

Pinterest API v5 docs: https://developers.pinterest.com/docs/api/v5/

Requirements:
- App ID + App Secret from developers.pinterest.com
- OAuth 2.0 access token (via authorization code flow)
- Board ID for pin destinations

Access tiers:
- Trial: pins only visible to creator, 1000 req/day
- Standard: pins publicly visible, variable rate limits
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from base64 import b64encode
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Pinterest API v5 base
PINTEREST_API_BASE = "https://api.pinterest.com/v5"

# OAuth endpoints
PINTEREST_AUTH_URL = "https://www.pinterest.com/oauth/"
PINTEREST_TOKEN_URL = f"{PINTEREST_API_BASE}/oauth/token"

# Default redirect URI
DEFAULT_REDIRECT_URI = "https://archive-35.com/api/pinterest-callback"

# Rate limiting
MAX_RETRIES = 3
BASE_BACKOFF = 2.0

# Refresh cooldown — prevent hammering Pinterest when refresh token is invalid
_last_refresh_failure: float = 0.0
_REFRESH_COOLDOWN = 300  # 5 minutes


# ── Environment & Credentials ────────────────────────────────────────────

def _load_env_file() -> dict[str, str]:
    """Load Agent .env file."""
    env_vars: dict[str, str] = {}
    agent_env = Path(__file__).parent.parent.parent / ".env"
    if agent_env.exists():
        for line in agent_env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                env_vars[key.strip()] = value.strip()
    return env_vars


def get_credentials() -> dict[str, str]:
    """Get Pinterest API credentials from environment.

    Returns dict with: app_id, app_secret, access_token, redirect_uri
    """
    env = _load_env_file()
    return {
        "app_id": env.get("PINTEREST_APP_ID", os.environ.get("PINTEREST_APP_ID", "")),
        "app_secret": env.get("PINTEREST_APP_SECRET", os.environ.get("PINTEREST_APP_SECRET", "")),
        "access_token": env.get("PINTEREST_ACCESS_TOKEN", os.environ.get("PINTEREST_ACCESS_TOKEN", "")),
        "refresh_token": env.get("PINTEREST_REFRESH_TOKEN", os.environ.get("PINTEREST_REFRESH_TOKEN", "")),
        "redirect_uri": env.get("PINTEREST_REDIRECT_URI", os.environ.get("PINTEREST_REDIRECT_URI", DEFAULT_REDIRECT_URI)),
        "token_expires": env.get("PINTEREST_TOKEN_EXPIRES", os.environ.get("PINTEREST_TOKEN_EXPIRES", "")),
        "board_id": env.get("PINTEREST_BOARD_ID", os.environ.get("PINTEREST_BOARD_ID", "")),
    }


def is_configured() -> bool:
    """Check if Pinterest credentials are present (not just placeholders)."""
    creds = get_credentials()
    app_id = creds.get("app_id", "")
    return bool(app_id and app_id != "..." and creds.get("app_secret") and creds["app_secret"] != "...")


def has_valid_token() -> bool:
    """Check if we have a non-expired access token."""
    creds = get_credentials()
    if not creds.get("access_token"):
        return False
    expires = creds.get("token_expires", "")
    if expires:
        try:
            exp_dt = datetime.fromisoformat(expires)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            return datetime.now(timezone.utc) < exp_dt
        except (ValueError, TypeError):
            pass
    return bool(creds["access_token"])


def _save_tokens(access_token: str, refresh_token: str, expires_in: int):
    """Save OAuth tokens to Agent .env file."""
    agent_env = Path(__file__).parent.parent.parent / ".env"
    if not agent_env.exists():
        logger.error("Agent .env not found at %s", agent_env)
        return

    from datetime import timedelta
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).strftime("%Y-%m-%d")

    updates = {
        "PINTEREST_ACCESS_TOKEN": access_token,
        "PINTEREST_REFRESH_TOKEN": refresh_token,
        "PINTEREST_TOKEN_EXPIRES": expires_at,
    }

    lines = agent_env.read_text().splitlines()
    new_lines = []
    updated_keys = set()
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                updated_keys.add(key)
                continue
        new_lines.append(line)

    # Add any keys not already in file
    for key, value in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={value}")

    agent_env.write_text("\n".join(new_lines) + "\n")
    logger.info("Saved Pinterest tokens to .env (expires: %s)", expires_at)


# ── OAuth 2.0 Flow ──────────────────────────────────────────────────────

def generate_oauth_url(scopes: Optional[list[str]] = None) -> dict[str, str]:
    """Generate Pinterest OAuth 2.0 authorization URL.

    Pinterest uses standard OAuth 2.0 (not PKCE).
    Requires app_id + app_secret for token exchange.

    Args:
        scopes: List of OAuth scopes. Defaults to pin read/write + boards.

    Returns dict with: auth_url, state
    """
    creds = get_credentials()
    if not creds.get("app_id"):
        return {"error": "PINTEREST_APP_ID not configured in .env"}

    if scopes is None:
        scopes = [
            "boards:read",
            "boards:write",
            "pins:read",
            "pins:write",
            "user_accounts:read",
        ]

    state = secrets.token_urlsafe(16)

    params = {
        "client_id": creds["app_id"],
        "redirect_uri": creds["redirect_uri"],
        "response_type": "code",
        "scope": ",".join(scopes),
        "state": state,
    }

    auth_url = f"{PINTEREST_AUTH_URL}?{urllib.parse.urlencode(params)}"

    return {
        "auth_url": auth_url,
        "state": state,
    }


def exchange_code(auth_code: str) -> dict[str, Any]:
    """Exchange authorization code for access + refresh tokens.

    Pinterest uses Basic Auth (app_id:app_secret) for token exchange.

    Args:
        auth_code: Code from OAuth callback.

    Returns:
        Token response dict or error.
    """
    creds = get_credentials()

    # Pinterest requires Basic auth header with app_id:app_secret
    auth_string = b64encode(
        f"{creds['app_id']}:{creds['app_secret']}".encode()
    ).decode()

    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": auth_code,
        "redirect_uri": creds["redirect_uri"],
    }).encode()

    req = urllib.request.Request(
        PINTEREST_TOKEN_URL,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {auth_string}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            _save_tokens(
                result["access_token"],
                result.get("refresh_token", ""),
                result.get("expires_in", 2592000),  # 30 days default
            )
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error("Pinterest token exchange failed: %s %s", e.code, body)
        return {"error": f"Token exchange failed: {e.code}", "detail": body}


def refresh_access_token() -> dict[str, Any]:
    """Refresh the Pinterest access token using the refresh token.

    Returns new token dict or error.
    """
    creds = get_credentials()
    if not creds.get("refresh_token"):
        return {"error": "No refresh token available"}

    auth_string = b64encode(
        f"{creds['app_id']}:{creds['app_secret']}".encode()
    ).decode()

    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": creds["refresh_token"],
    }).encode()

    req = urllib.request.Request(
        PINTEREST_TOKEN_URL,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {auth_string}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            _save_tokens(
                result["access_token"],
                result.get("refresh_token", creds["refresh_token"]),
                result.get("expires_in", 2592000),
            )
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error("Pinterest token refresh failed: %s %s", e.code, body)
        return {"error": f"Token refresh failed: {e.code}", "detail": body}


# ── API Request Helper ───────────────────────────────────────────────────

def _api_request(
    endpoint: str,
    method: str = "GET",
    data: Optional[dict] = None,
    auto_refresh: bool = True,
) -> dict[str, Any]:
    """Make an authenticated Pinterest API v5 request.

    Args:
        endpoint: API path (e.g., "/pins", "/boards")
        method: HTTP method
        data: Request body (JSON-serializable)
        auto_refresh: Try refreshing token on 401

    Returns:
        Parsed JSON response or error dict.
    """
    creds = get_credentials()
    if not creds.get("access_token"):
        return {"error": "No Pinterest access token. Run OAuth flow first."}

    url = f"{PINTEREST_API_BASE}{endpoint}"

    headers = {
        "Authorization": f"Bearer {creds['access_token']}",
        "Content-Type": "application/json",
    }

    body = None
    if data and method in ("POST", "PUT", "PATCH"):
        body = json.dumps(data).encode()

    req = urllib.request.Request(url, data=body, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            response_body = resp.read().decode()
            if response_body:
                return json.loads(response_body)
            return {"status": "ok"}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""

        # Auto-refresh on 401 (with cooldown to avoid spam)
        global _last_refresh_failure
        if e.code == 401 and auto_refresh and creds.get("refresh_token"):
            if time.time() - _last_refresh_failure < _REFRESH_COOLDOWN:
                logger.debug("Pinterest refresh on cooldown, skipping")
            else:
                logger.info("Pinterest token expired, attempting refresh...")
                refresh_result = refresh_access_token()
                if "error" not in refresh_result:
                    return _api_request(endpoint, method, data, auto_refresh=False)
                _last_refresh_failure = time.time()

        logger.error("Pinterest API error %s: %s", e.code, error_body)
        return {"error": f"API request failed: {e.code}", "detail": error_body}


# ── Board Operations ─────────────────────────────────────────────────────

def list_boards(page_size: int = 25, bookmark: str = "") -> dict[str, Any]:
    """List all boards for the authenticated user.

    Args:
        page_size: Number of boards per page (max 250).
        bookmark: Pagination cursor from previous response.

    Returns:
        Dict with 'items' (list of boards) and optional 'bookmark'.
    """
    params = f"?page_size={page_size}"
    if bookmark:
        params += f"&bookmark={urllib.parse.quote(bookmark)}"
    return _api_request(f"/boards{params}")


def create_board(
    name: str,
    description: str = "",
    privacy: str = "PUBLIC",
) -> dict[str, Any]:
    """Create a new board.

    Args:
        name: Board name (e.g., "Iceland Landscapes").
        description: Board description.
        privacy: "PUBLIC" or "PROTECTED" (secret board).

    Returns:
        Created board dict with 'id'.
    """
    return _api_request("/boards", method="POST", data={
        "name": name,
        "description": description,
        "privacy": privacy,
    })


def get_board(board_id: str) -> dict[str, Any]:
    """Get a specific board by ID."""
    return _api_request(f"/boards/{board_id}")


# ── Pin Operations ───────────────────────────────────────────────────────

def create_pin(
    board_id: str,
    title: str,
    description: str,
    image_url: str,
    link: str = "",
    alt_text: str = "",
) -> dict[str, Any]:
    """Create a pin on a board.

    Args:
        board_id: Target board ID.
        title: Pin title (max 100 chars).
        description: Pin description (max 500 chars).
        image_url: Public URL of the image.
        link: Destination URL when pin is clicked.
        alt_text: Accessibility text for the image.

    Returns:
        Created pin dict with 'id'.
    """
    pin_data: dict[str, Any] = {
        "board_id": board_id,
        "title": title[:100],
        "description": description[:500],
        "media_source": {
            "source_type": "image_url",
            "url": image_url,
        },
    }

    if link:
        pin_data["link"] = link
    if alt_text:
        pin_data["alt_text"] = alt_text[:500]

    return _api_request("/pins", method="POST", data=pin_data)


def get_pin(pin_id: str) -> dict[str, Any]:
    """Get a specific pin by ID."""
    return _api_request(f"/pins/{pin_id}")


def delete_pin(pin_id: str) -> dict[str, Any]:
    """Delete a pin by ID."""
    return _api_request(f"/pins/{pin_id}", method="DELETE")


def list_pins(board_id: str, page_size: int = 25, bookmark: str = "") -> dict[str, Any]:
    """List pins on a board.

    Args:
        board_id: Board to list pins from.
        page_size: Results per page (max 250).
        bookmark: Pagination cursor.

    Returns:
        Dict with 'items' (list of pins) and optional 'bookmark'.
    """
    params = f"?page_size={page_size}"
    if bookmark:
        params += f"&bookmark={urllib.parse.quote(bookmark)}"
    return _api_request(f"/boards/{board_id}/pins{params}")


# ── User Account ─────────────────────────────────────────────────────────

def get_user_account() -> dict[str, Any]:
    """Get the authenticated user's account info.

    Returns username, profile image, website URL, etc.
    Useful for verifying the token works.
    """
    return _api_request("/user_account")


# ── High-Level Operations ────────────────────────────────────────────────

def post_photo_as_pin(
    photo_data: dict[str, Any],
    board_id: Optional[str] = None,
    gallery_base_url: str = "https://archive-35.com/gallery.html",
) -> dict[str, Any]:
    """Create a Pinterest pin from an Archive-35 photo.

    This is the main entry point for the Agent pipeline.
    Takes photo metadata (from DB or gallery-data.json) and creates
    a properly formatted pin with link back to the gallery.

    Args:
        photo_data: Dict with keys: title, description, tags, image_url,
                    collection, filename (at minimum).
        board_id: Target board. Falls back to PINTEREST_BOARD_ID env var.
        gallery_base_url: Base URL for gallery links.

    Returns:
        Pin creation result or error.
    """
    creds = get_credentials()
    target_board = board_id or creds.get("board_id", "")

    if not target_board:
        return {"error": "No board_id specified. Set PINTEREST_BOARD_ID in .env or pass board_id."}

    title = photo_data.get("title", "Untitled")
    description = photo_data.get("description", "")
    image_url = photo_data.get("image_url", "")
    collection = photo_data.get("collection", "")
    filename = photo_data.get("filename", "")

    if not image_url:
        return {"error": "No image_url in photo_data"}

    # Build tags into description
    tags = photo_data.get("tags", [])
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except (json.JSONDecodeError, TypeError):
            tags = [t.strip() for t in tags.split(",") if t.strip()]

    tag_str = " ".join(f"#{t.replace(' ', '')}" for t in tags[:10])
    full_description = f"{description}\n\n{tag_str}".strip() if tag_str else description

    # Build gallery link
    link = gallery_base_url
    if collection:
        link = f"{gallery_base_url}#collection={urllib.parse.quote(collection)}"

    # Alt text from title + collection
    alt_text = f"{title} — fine art photography from the {collection} collection by Wolf Schram" if collection else title

    return create_pin(
        board_id=target_board,
        title=title,
        description=full_description,
        image_url=image_url,
        link=link,
        alt_text=alt_text,
    )


def ensure_board_exists(
    board_name: str,
    description: str = "",
) -> dict[str, Any]:
    """Find or create a board by name.

    Args:
        board_name: Name to search for or create.
        description: Description if creating new board.

    Returns:
        Board dict with 'id'.
    """
    # List existing boards and check for match
    result = list_boards(page_size=250)
    if "error" in result:
        return result

    boards = result.get("items", [])
    for board in boards:
        if board.get("name", "").lower() == board_name.lower():
            logger.info("Found existing board: %s (id: %s)", board["name"], board["id"])
            return board

    # Create new board
    logger.info("Creating new board: %s", board_name)
    return create_board(name=board_name, description=description)


def get_status() -> dict[str, Any]:
    """Get Pinterest integration status for dashboard display.

    Returns:
        Dict with connection status, board count, token expiry, etc.
    """
    creds = get_credentials()
    status: dict[str, Any] = {
        "configured": is_configured(),
        "has_token": bool(creds.get("access_token")),
        "token_valid": has_valid_token(),
        "token_expires": creds.get("token_expires", ""),
        "app_id": creds.get("app_id", ""),
        "board_id": creds.get("board_id", ""),
    }

    # Try fetching user info if we have a token
    if status["has_token"]:
        user = get_user_account()
        if "error" not in user:
            status["username"] = user.get("username", "")
            status["profile_url"] = f"https://pinterest.com/{user.get('username', '')}"
            status["connected"] = True
        else:
            status["connected"] = False
            status["error"] = user.get("error", "")
    else:
        status["connected"] = False

    return status
