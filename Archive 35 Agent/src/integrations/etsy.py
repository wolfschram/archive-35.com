"""Etsy API v3 integration for Archive-35.

Handles:
- OAuth 2.0 flow (PKCE) for Etsy Open API v3
- Creating and updating listings with photos
- Receiving receipts (orders) via polling (Etsy has no webhooks)
- Syncing order status for Pictorem fulfillment routing

Etsy Open API v3 docs: https://developers.etsy.com/documentation/

Requirements:
- API key (keystring) from etsy.com/developers
- OAuth 2.0 access token (via PKCE flow)
- Shop ID (numeric) from shop settings
"""

from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import os
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from base64 import urlsafe_b64encode
from datetime import datetime, timezone

# Fix SSL certs on Python 3.13 / macOS (must run before any HTTPS calls)
from src import ssl_fix  # noqa: F401
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# Etsy API v3 base
ETSY_API_BASE = "https://openapi.etsy.com/v3"

# Etsy fee structure (for reference in pricing)
ETSY_TRANSACTION_FEE_RATE = 0.065
ETSY_PAYMENT_PROCESSING_RATE = 0.03
ETSY_PAYMENT_FLAT_FEE = 0.25
ETSY_LISTING_FEE = 0.20

# Default taxonomy for fine art photography prints
# Will be auto-discovered via get_photography_taxonomy_id() on first use.
# Fallback only used if API lookup fails entirely.
DEFAULT_TAXONOMY_ID = None  # Set dynamically — do NOT hardcode stale IDs

# Shipping profile — must be created in Etsy shop settings first
# This gets populated from .env or shop lookup
DEFAULT_SHIPPING_PROFILE_ID = None

# Cached taxonomy ID (discovered at runtime from Etsy's taxonomy API)
_cached_taxonomy_id: Optional[int] = None

# Simple rate limiter — stay at 4 req/sec (Etsy allows ~10)
_last_etsy_call: float = 0


def _rate_limit():
    """Enforce 4 req/sec rate limit on Etsy API calls."""
    global _last_etsy_call
    now = time.time()
    elapsed = now - _last_etsy_call
    if elapsed < 0.25:
        time.sleep(0.25 - elapsed)
    _last_etsy_call = time.time()


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
    """Get Etsy API credentials from environment.

    Returns dict with: api_key, access_token, refresh_token, shop_id
    """
    env = _load_env_file()
    return {
        "api_key": env.get("ETSY_API_KEY", os.environ.get("ETSY_API_KEY", "")),
        "shared_secret": env.get("ETSY_API_SECRET", env.get("ETSY_SHARED_SECRET", os.environ.get("ETSY_API_SECRET", os.environ.get("ETSY_SHARED_SECRET", "")))),
        "access_token": env.get("ETSY_ACCESS_TOKEN", os.environ.get("ETSY_ACCESS_TOKEN", "")),
        "refresh_token": env.get("ETSY_REFRESH_TOKEN", os.environ.get("ETSY_REFRESH_TOKEN", "")),
        "shop_id": env.get("ETSY_SHOP_ID", os.environ.get("ETSY_SHOP_ID", "")),
        "token_expires": env.get("ETSY_TOKEN_EXPIRES", os.environ.get("ETSY_TOKEN_EXPIRES", "")),
    }


def is_configured() -> bool:
    """Check if Etsy credentials are present (not just placeholders)."""
    creds = get_credentials()
    api_key = creds.get("api_key", "")
    return bool(api_key and api_key != "your_etsy_api_key_here" and creds.get("shop_id"))


def has_valid_token() -> bool:
    """Check if we have a non-expired access token."""
    creds = get_credentials()
    if not creds.get("access_token"):
        return False
    expires = creds.get("token_expires", "")
    if expires:
        try:
            exp_dt = datetime.fromisoformat(expires)
            return datetime.now(timezone.utc) < exp_dt
        except (ValueError, TypeError):
            pass
    return bool(creds["access_token"])


def ensure_valid_token() -> dict[str, Any]:
    """Proactively check token validity and refresh if expired.

    Returns:
        {"valid": True} if token is good (or was refreshed successfully).
        {"valid": False, "error": "..."} if refresh failed.
        {"valid": False, "error": "...", "reauth_required": True} if no
        refresh token exists and a full OAuth flow is needed.
    """
    if has_valid_token():
        return {"valid": True}

    creds = get_credentials()
    if not creds.get("refresh_token"):
        return {
            "valid": False,
            "error": "No refresh token — full OAuth reauthorization required",
            "reauth_required": True,
        }

    logger.info("Token expired, refreshing...")
    result = refresh_access_token()
    if "error" in result:
        return {"valid": False, "error": result["error"]}

    return {"valid": True, "refreshed": True}


def check_scope() -> dict[str, Any]:
    """Test which API scopes the current token has.

    Makes lightweight API calls to check listings_r and listings_w.
    Returns a dict of scope → bool.
    """
    token_check = ensure_valid_token()
    if not token_check.get("valid"):
        return {"error": token_check.get("error", "Token invalid")}

    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    scopes: dict[str, Any] = {
        "listings_r": False,
        "listings_w": False,
        "transactions_r": False,
    }

    # Test listings_r: fetch one listing
    result = _api_request(
        f"/application/shops/{shop_id}/listings?limit=1&state=active"
    )
    if "error" not in result:
        scopes["listings_r"] = True
        scopes["listing_count"] = result.get("count", 0)

    # Test listings_w: attempt a no-op update on a draft listing
    # We create a minimal draft and immediately delete it
    # Instead, just check if we can read — listings_w can only be confirmed
    # by attempting a write. We'll flag it as "untested" and let the
    # Etsy rewrite agent confirm on first real write.
    scopes["listings_w"] = "untested — will confirm on first write"

    # Test transactions_r: fetch recent receipts
    result = _api_request(
        f"/application/shops/{shop_id}/receipts?limit=1"
    )
    if "error" not in result:
        scopes["transactions_r"] = True

    return scopes


def _save_tokens(access_token: str, refresh_token: str, expires_in: int):
    """Save OAuth tokens to Agent .env file."""
    agent_env = Path(__file__).parent.parent.parent / ".env"
    if not agent_env.exists():
        logger.error("Agent .env not found at %s", agent_env)
        return

    lines = agent_env.read_text().splitlines()
    from datetime import timedelta
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

    updates = {
        "ETSY_ACCESS_TOKEN": access_token,
        "ETSY_REFRESH_TOKEN": refresh_token,
        "ETSY_TOKEN_EXPIRES": expires_at,
    }

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
    logger.info("Saved Etsy tokens to .env (expires: %s)", expires_at)


# ── OAuth 2.0 PKCE Flow ─────────────────────────────────────────────────

def generate_oauth_url() -> dict[str, str]:
    """Generate Etsy OAuth 2.0 authorization URL with PKCE.

    Returns dict with: auth_url, code_verifier, state
    The code_verifier must be saved for the token exchange step.
    """
    creds = get_credentials()
    if not creds.get("api_key"):
        return {"error": "ETSY_API_KEY not configured in .env"}

    # Generate PKCE code verifier and challenge
    code_verifier = secrets.token_urlsafe(64)[:128]
    code_challenge = urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).decode().rstrip("=")

    state = secrets.token_urlsafe(16)

    params = {
        "response_type": "code",
        "client_id": creds["api_key"],
        "redirect_uri": "https://archive-35.com/etsy-callback",
        "scope": "listings_r listings_w listings_d transactions_r transactions_w shops_r shops_w",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    auth_url = f"https://www.etsy.com/oauth/connect?{urllib.parse.urlencode(params)}"

    return {
        "auth_url": auth_url,
        "code_verifier": code_verifier,
        "state": state,
    }


def exchange_code(auth_code: str, code_verifier: str) -> dict[str, Any]:
    """Exchange authorization code for access + refresh tokens.

    Args:
        auth_code: Code from OAuth callback.
        code_verifier: PKCE verifier from generate_oauth_url().

    Returns:
        Token response dict or error.
    """
    creds = get_credentials()

    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "client_id": creds["api_key"],
        "redirect_uri": "https://archive-35.com/etsy-callback",
        "code": auth_code,
        "code_verifier": code_verifier,
    }).encode()

    req = urllib.request.Request(
        "https://api.etsy.com/v3/public/oauth/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            _save_tokens(
                result["access_token"],
                result["refresh_token"],
                result.get("expires_in", 3600),
            )
            # Fetch and save shop_id using the new access token
            try:
                user_id = result.get("user_id")
                if user_id:
                    _fetch_and_save_shop_id(result["access_token"], creds["api_key"], creds.get("shared_secret", ""))
            except Exception as shop_err:
                logger.warning("Could not auto-fetch shop_id: %s", shop_err)
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error("Etsy token exchange failed: %s %s", e.code, body)
        # Parse Etsy's error JSON for a readable message
        try:
            err_data = json.loads(body)
            desc = err_data.get("error_description", err_data.get("error", body))
        except (json.JSONDecodeError, TypeError):
            desc = body or f"HTTP {e.code}"
        return {"error": desc, "detail": desc}
    except urllib.error.URLError as e:
        logger.error("Etsy token exchange network error: %s", e.reason)
        return {"error": f"Network error — cannot reach Etsy: {e.reason}", "detail": str(e.reason)}
    except OSError as e:
        logger.error("Etsy token exchange OS error: %s", e)
        return {"error": f"Network error: {e}", "detail": str(e)}


def _fetch_and_save_shop_id(access_token: str, api_key: str, shared_secret: str = "") -> None:
    """Fetch the user's shop ID from Etsy and save to .env."""
    # Try with just keystring first (v3 standard), then with shared_secret appended
    header_variants = [api_key]
    if shared_secret:
        header_variants.append(f"{api_key}:{shared_secret}")

    for api_key_header in header_variants:
        headers = {
            "x-api-key": api_key_header,
            "Authorization": f"Bearer {access_token}",
        }
        try:
            # Extract user_id from token (prefix before first dot)
            user_id = access_token.split(".")[0] if "." in access_token else None

            # Also try /users/me as fallback
            if not user_id:
                req = urllib.request.Request(
                    f"{ETSY_API_BASE}/application/users/me",
                    headers=headers,
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    user_data = json.loads(resp.read())
                user_id = user_data.get("user_id")

            if not user_id:
                logger.warning("Could not determine Etsy user_id")
                continue

            logger.info("Fetching shops for user %s (x-api-key format: %s...)",
                        user_id, api_key_header[:8])

            req2 = urllib.request.Request(
                f"{ETSY_API_BASE}/application/users/{user_id}/shops",
                headers=headers,
            )
            with urllib.request.urlopen(req2, timeout=15) as resp:
                shops_data = json.loads(resp.read())

            logger.info("Shops API response for user %s: %s", user_id, json.dumps(shops_data)[:500])

            # Check if response has shop_id directly (single shop response)
            if "shop_id" in shops_data:
                shops = [shops_data]
            else:
                shops = shops_data.get("results", [])

            if shops:
                shop_id = str(shops[0]["shop_id"])
                shop_name = shops[0].get("shop_name", "")
                logger.info("Found Etsy shop: %s (ID: %s)", shop_name, shop_id)
                _save_shop_id_to_env(shop_id)
                return

            logger.info("No shops in response with this header format, trying next...")
        except Exception as e:
            logger.warning("Shop fetch attempt failed: %s", e)
            continue

    logger.warning("No shops found — set ETSY_SHOP_ID manually in Settings")


def _save_shop_id_to_env(shop_id: str) -> None:
    """Save shop_id to Agent .env file."""
    agent_env = Path(__file__).parent.parent.parent / ".env"
    if not agent_env.exists():
        return
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
    logger.info("Saved ETSY_SHOP_ID=%s to .env", shop_id)


def refresh_access_token() -> dict[str, Any]:
    """Refresh the Etsy access token using the refresh token.

    Returns new token dict or error.
    """
    creds = get_credentials()
    if not creds.get("refresh_token"):
        return {"error": "No refresh token available"}

    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": creds["api_key"],
        "refresh_token": creds["refresh_token"],
    }).encode()

    req = urllib.request.Request(
        "https://api.etsy.com/v3/public/oauth/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            _save_tokens(
                result["access_token"],
                result["refresh_token"],
                result.get("expires_in", 3600),
            )
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error("Etsy token refresh failed: %s %s", e.code, body)
        return {"error": f"Token refresh failed: {e.code}", "detail": body}


# ── API Request Helper ───────────────────────────────────────────────────

def _api_request(
    endpoint: str,
    method: str = "GET",
    data: Optional[dict] = None,
    content_type: str = "application/json",
) -> dict[str, Any]:
    """Make an authenticated Etsy API v3 request.

    Args:
        endpoint: API path (e.g., "/application/shops/{shop_id}/listings")
        method: HTTP method
        data: Request body (JSON-serializable)
        content_type: Content-Type header

    Returns:
        Parsed JSON response or error dict.
    """
    _rate_limit()

    # Proactively refresh token if expired before making the request
    token_check = ensure_valid_token()
    if not token_check.get("valid"):
        return {"error": token_check.get("error", "Token invalid")}

    creds = get_credentials()
    if not creds.get("access_token"):
        return {"error": "No Etsy access token. Run OAuth flow first."}

    url = f"{ETSY_API_BASE}{endpoint}"

    # Etsy requires keystring:shared_secret format since Feb 2026
    api_key_header = creds["api_key"]
    if creds.get("shared_secret"):
        api_key_header = f"{creds['api_key']}:{creds['shared_secret']}"

    headers = {
        "x-api-key": api_key_header,
        "Authorization": f"Bearer {creds['access_token']}",
    }

    body = None
    if data and method in ("POST", "PUT", "PATCH"):
        if content_type == "application/json":
            body = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        else:
            normalized = {}
            for key, value in data.items():
                if isinstance(value, list):
                    normalized[key] = ",".join(str(item) for item in value)
                elif isinstance(value, bool):
                    normalized[key] = str(value).lower()
                else:
                    normalized[key] = value
            body = urllib.parse.urlencode(normalized).encode("utf-8")
            headers["Content-Type"] = (
                "application/x-www-form-urlencoded; charset=utf-8"
            )

    req = urllib.request.Request(url, data=body, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            if not body or resp.status == 204:
                return {}
            return json.loads(body)
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode() if e.fp else ""
        logger.error("Etsy API %s %s → %s: %s", method, endpoint, e.code, resp_body)

        # Auto-refresh on 401
        if e.code == 401 and creds.get("refresh_token"):
            logger.info("Token expired, attempting refresh...")
            refresh_result = refresh_access_token()
            if "error" not in refresh_result:
                # Retry with new token
                return _api_request(endpoint, method, data, content_type)

        return {"error": f"API error {e.code}", "detail": resp_body, "status_code": e.code}
    except Exception as e:
        logger.error("Etsy API request failed: %s", e)
        return {"error": str(e)}


# ── Shop Info ────────────────────────────────────────────────────────────

def get_shop_info() -> dict[str, Any]:
    """Get current shop details."""
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(f"/application/shops/{shop_id}")


def get_shipping_profiles() -> dict[str, Any]:
    """List shipping profiles for the shop."""
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(f"/application/shops/{shop_id}/shipping-profiles")


# ── Taxonomy Discovery ───────────────────────────────────────────────────
# Etsy taxonomy IDs change over time. Instead of hardcoding, we discover
# the correct ID for "Art & Collectibles > Photography" at runtime.

def get_seller_taxonomy_nodes() -> dict[str, Any]:
    """Fetch the full seller taxonomy tree from Etsy.

    This is a public endpoint — requires API key but not OAuth token.
    Returns the complete hierarchy of listing categories.
    """
    return _api_request("/application/seller-taxonomy/nodes")


def _search_taxonomy_tree(nodes: list, target_names: list[str], depth: int = 0) -> Optional[int]:
    """Recursively search taxonomy tree for a matching path.

    Args:
        nodes: List of taxonomy node dicts (each has 'id', 'name', 'children')
        target_names: Names to match at successive levels (e.g., ["Art & Collectibles", "Photography"])
        depth: Current depth in the target_names list

    Returns:
        taxonomy_id of the deepest matching node, or None.
    """
    if depth >= len(target_names):
        return None

    target = target_names[depth].lower()
    for node in nodes:
        node_name = (node.get("name") or "").lower()
        if target in node_name or node_name in target:
            # If this is the last target, return this node's ID
            if depth == len(target_names) - 1:
                return node.get("id")
            # Otherwise, recurse into children
            children = node.get("children", [])
            if children:
                result = _search_taxonomy_tree(children, target_names, depth + 1)
                if result:
                    return result
            # If no children match deeper levels, return this node
            return node.get("id")
    return None


def get_photography_taxonomy_id() -> Optional[int]:
    """Discover the correct taxonomy ID for fine art photography prints.

    Searches the Etsy taxonomy tree for the best match:
    1. "Art & Collectibles" > "Photography" > "Color" (ideal)
    2. "Art & Collectibles" > "Photography" (fallback)
    3. "Art & Collectibles" > "Prints" (last resort)

    Caches the result for the process lifetime.
    """
    global _cached_taxonomy_id
    if _cached_taxonomy_id is not None:
        return _cached_taxonomy_id

    resp = get_seller_taxonomy_nodes()
    if "error" in resp:
        logger.error("Failed to fetch taxonomy: %s", resp)
        return None

    nodes = resp.get("results", [])
    if not nodes:
        logger.error("Taxonomy API returned no nodes")
        return None

    # Try progressively broader searches
    search_paths = [
        ["Art & Collectibles", "Photography", "Color"],
        ["Art & Collectibles", "Photography"],
        ["Art & Collectibles", "Prints"],
        ["Art", "Photography"],
        ["Art", "Prints"],
    ]

    for path in search_paths:
        result = _search_taxonomy_tree(nodes, path)
        if result:
            _cached_taxonomy_id = result
            logger.info("Discovered taxonomy ID %d for path %s", result, " > ".join(path))
            return result

    # Absolute last resort — search for any node with "Photography" in name
    def _find_any(nodes_list, name):
        for n in nodes_list:
            if name.lower() in (n.get("name") or "").lower():
                return n.get("id")
            child_result = _find_any(n.get("children", []), name)
            if child_result:
                return child_result
        return None

    photo_id = _find_any(nodes, "Photography")
    if photo_id:
        _cached_taxonomy_id = photo_id
        logger.info("Discovered taxonomy ID %d via broad 'Photography' search", photo_id)
        return photo_id

    logger.error("Could not find any photography taxonomy node!")
    return None


# ── Processing Profiles (readiness_state_id) ─────────────────────────────
# Etsy requires a readiness_state_id for all physical listings (since late 2025).
# This replaces the deprecated min/max_processing_time fields.
# For Archive-35, all prints are made-to-order (print on demand via Pictorem).

_cached_readiness_state_id: Optional[int] = None


def get_readiness_state_definitions() -> dict[str, Any]:
    """Fetch existing processing profiles for the shop."""
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(f"/application/shops/{shop_id}/readiness-state-definitions")


def create_readiness_state_definition(
    readiness_state: str = "made_to_order",
    min_processing_time: int = 3,
    max_processing_time: int = 7,
    processing_time_unit: str = "days",
) -> dict[str, Any]:
    """Create a processing profile for the shop.

    Args:
        readiness_state: "made_to_order" or "ready_to_ship"
        min_processing_time: Min processing days/weeks
        max_processing_time: Max processing days/weeks
        processing_time_unit: "days" or "weeks"

    Returns:
        Created profile with readiness_state_id, or error.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(
        f"/application/shops/{shop_id}/readiness-state-definitions",
        method="POST",
        data={
            "readiness_state": readiness_state,
            "min_processing_time": min_processing_time,
            "max_processing_time": max_processing_time,
            "processing_time_unit": processing_time_unit,
        },
    )


def get_or_create_readiness_state_id() -> Optional[int]:
    """Get a 'made_to_order' readiness_state_id, creating one if needed.

    Caches the result for the lifetime of the process to avoid
    repeated API calls.

    Returns:
        readiness_state_id (int) or None if all attempts fail.
    """
    global _cached_readiness_state_id
    if _cached_readiness_state_id is not None:
        return _cached_readiness_state_id

    # Try to find an existing 'made_to_order' profile
    existing = get_readiness_state_definitions()
    results = existing.get("results", [])
    for profile in results:
        if profile.get("readiness_state") == "made_to_order":
            _cached_readiness_state_id = profile["readiness_state_id"]
            logger.info("Found existing made_to_order profile: %s", _cached_readiness_state_id)
            return _cached_readiness_state_id

    # Fall back to any existing profile
    if results:
        _cached_readiness_state_id = results[0]["readiness_state_id"]
        logger.info("Using existing profile: %s (state: %s)",
                    _cached_readiness_state_id, results[0].get("readiness_state"))
        return _cached_readiness_state_id

    # None exist — create one (3–7 business days for Pictorem POD)
    logger.info("No readiness state definitions found — creating 'made_to_order' profile")
    created = create_readiness_state_definition(
        readiness_state="made_to_order",
        min_processing_time=3,
        max_processing_time=7,
        processing_time_unit="days",
    )
    if "error" in created:
        logger.error("Failed to create readiness state: %s", created)
        return None

    _cached_readiness_state_id = created.get("readiness_state_id")
    logger.info("Created made_to_order profile: %s", _cached_readiness_state_id)
    return _cached_readiness_state_id


# ── Return Policy Management ─────────────────────────────────────────────
# Archive-35 prints are custom-made (POD) — no returns or exchanges.

_cached_return_policy_id: Optional[int] = None


def get_return_policies() -> dict[str, Any]:
    """Get shop return policies."""
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(f"/application/shops/{shop_id}/policies/return")


def create_no_returns_policy() -> dict[str, Any]:
    """Create a 'no returns, no exchanges' return policy.

    All Archive-35 prints are made-to-order (POD) — returns not accepted.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(
        f"/application/shops/{shop_id}/policies/return",
        method="POST",
        data={
            "accepts_returns": False,
            "accepts_exchanges": False,
        },
    )


def get_or_create_no_returns_policy_id() -> Optional[int]:
    """Get a 'no returns' return_policy_id, creating one if needed.

    Caches the result for the process lifetime.
    """
    global _cached_return_policy_id
    if _cached_return_policy_id is not None:
        return _cached_return_policy_id

    # Look for existing no-returns policy
    existing = get_return_policies()
    results = existing.get("results", [])
    for policy in results:
        if not policy.get("accepts_returns") and not policy.get("accepts_exchanges"):
            _cached_return_policy_id = policy.get("return_policy_id")
            logger.info("Found existing no-returns policy: %s", _cached_return_policy_id)
            return _cached_return_policy_id

    # None found — create one
    logger.info("No 'no returns' policy found — creating one")
    created = create_no_returns_policy()
    if "error" in created:
        logger.error("Failed to create no-returns policy: %s", created)
        # Fall back to any existing policy
        if results:
            _cached_return_policy_id = results[0].get("return_policy_id")
            logger.warning("Falling back to existing policy: %s", _cached_return_policy_id)
            return _cached_return_policy_id
        return None

    _cached_return_policy_id = created.get("return_policy_id")
    logger.info("Created no-returns policy: %s", _cached_return_policy_id)
    return _cached_return_policy_id


# ── Listing Management ───────────────────────────────────────────────────

def create_listing(
    title: str,
    description: str,
    price: float,
    tags: list[str],
    sku: str = "",
    quantity: int = 999,
    shipping_profile_id: Optional[int] = None,
    taxonomy_id: Optional[int] = None,
    who_made: str = "i_did",
    when_made: str = "made_to_order",
    is_supply: bool = False,
    listing_type: str = "physical",
) -> dict[str, Any]:
    """Create a new Etsy listing (draft state).

    Args:
        title: Listing title (max 140 chars)
        description: Listing description
        price: Price in USD
        tags: List of tags (max 13, max 20 chars each)
        sku: Internal SKU reference
        quantity: Available quantity (999 = effectively unlimited for POD)
        shipping_profile_id: Etsy shipping profile ID
        taxonomy_id: Etsy category taxonomy ID (auto-discovered if None)
        who_made: "i_did", "someone_else", "collective"
        when_made: Date range string
        is_supply: False for finished products
        listing_type: "physical", "download", or "both"

    Returns:
        Created listing data or error.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    if listing_type not in {"physical", "download", "both"}:
        return {"error": f"Unsupported listing type: {listing_type}"}

    # Auto-discover taxonomy ID if not provided
    if not taxonomy_id:
        taxonomy_id = get_photography_taxonomy_id()
    if not taxonomy_id:
        return {"error": "Could not discover a valid Etsy taxonomy ID for photography prints. Check API access."}

    # Enforce Etsy limits
    if len(title) > 140:
        title = title[:137] + "..."
    tags = [t[:20] for t in tags[:13]]

    # Price in USD (Etsy accepts float with 2 decimal places for createDraftListing)
    listing_data = {
        "title": title,
        "description": description,
        "price": round(price, 2),
        "quantity": quantity,
        "tags": tags,
        "who_made": who_made,
        "when_made": when_made,
        "is_supply": is_supply,
        "taxonomy_id": taxonomy_id,
        "type": listing_type,
        # NOTE: Do NOT include "state" — createDraftListing always creates drafts.
        # Sending "state": "draft" causes a 400 error (invalid parameter).
    }

    if sku:
        listing_data["sku"] = [sku]

    # Shipping and processing profiles apply only to physical goods.
    if listing_type == "download":
        return_policy_id = get_or_create_no_returns_policy_id()
        if return_policy_id:
            listing_data["return_policy_id"] = return_policy_id
        return _api_request(
            f"/application/shops/{shop_id}/listings",
            method="POST",
            data=listing_data,
            content_type="application/x-www-form-urlencoded",
        )

    # Shipping profile is REQUIRED for physical listings.
    # Auto-fetch the first available profile if none provided.
    if not shipping_profile_id:
        profiles_resp = get_shipping_profiles()
        results = profiles_resp.get("results", [])
        if results:
            shipping_profile_id = results[0].get("shipping_profile_id")
            logger.info("Auto-selected shipping profile %s ('%s')",
                        shipping_profile_id, results[0].get("title", "?"))
        else:
            return {"error": "No shipping profiles found on Etsy shop. Create one at etsy.com/your/shops/me/tools/shipping-profiles"}

    listing_data["shipping_profile_id"] = shipping_profile_id

    # Readiness state is REQUIRED for physical listings (Etsy API change late 2025).
    # This links the listing to a processing profile (made_to_order, 3-7 days).
    readiness_id = get_or_create_readiness_state_id()
    if readiness_id:
        listing_data["readiness_state_id"] = readiness_id
    else:
        return {"error": "Could not get or create a readiness_state_id. Check Etsy API access."}

    # Return policy — POD prints are custom, no returns accepted.
    return_policy_id = get_or_create_no_returns_policy_id()
    if return_policy_id:
        listing_data["return_policy_id"] = return_policy_id
    else:
        logger.warning("Could not set no-returns policy — listing will use shop default")

    # Log the exact payload for debugging (redact nothing — we need to see it all)
    logger.info("createDraftListing payload: %s", json.dumps(listing_data, indent=2))

    result = _api_request(
        f"/application/shops/{shop_id}/listings",
        method="POST",
        data=listing_data,
        content_type="application/x-www-form-urlencoded",
    )

    if "error" in result:
        logger.error("createDraftListing FAILED — payload: %s", json.dumps(listing_data))
        logger.error("createDraftListing FAILED — response: %s", json.dumps(result))

    return result


def update_listing(listing_id: int, updates: dict) -> dict[str, Any]:
    """Update an existing listing.

    Args:
        listing_id: Etsy listing ID
        updates: Fields to update

    Returns:
        Updated listing data or error.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    return _api_request(
        f"/application/shops/{shop_id}/listings/{listing_id}",
        method="PATCH",
        data=updates,
        content_type="application/x-www-form-urlencoded",
    )


def upload_listing_image(
    listing_id: int,
    image_url: str,
    rank: int = 1,
) -> dict[str, Any]:
    """Upload an image to a listing from a public URL.

    Note: Etsy requires multipart form upload, not URL.
    For POD workflow, we download the image first then upload.

    Args:
        listing_id: Etsy listing ID
        image_url: Public URL of the image
        rank: Image position (1 = primary)

    Returns:
        Upload result or error.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    # Download image to temp buffer
    try:
        req = urllib.request.Request(image_url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            image_data = resp.read()
    except Exception as e:
        return {"error": f"Failed to download image: {e}"}

    # Etsy requires multipart upload — build manually
    boundary = f"----Archive35Boundary{secrets.token_hex(8)}"
    body = bytearray()

    # rank field
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="rank"\r\n\r\n'
    body += f"{rank}\r\n".encode()

    # image field
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="image"; filename="photo.jpg"\r\n'
    body += b"Content-Type: image/jpeg\r\n\r\n"
    body += image_data
    body += b"\r\n"

    body += f"--{boundary}--\r\n".encode()

    url = f"{ETSY_API_BASE}/application/shops/{shop_id}/listings/{listing_id}/images"
    # Etsy requires keystring:shared_secret format since Feb 2026
    api_key_header = creds["api_key"]
    if creds.get("shared_secret"):
        api_key_header = f"{creds['api_key']}:{creds['shared_secret']}"
    headers = {
        "x-api-key": api_key_header,
        "Authorization": f"Bearer {creds['access_token']}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }

    upload_req = urllib.request.Request(url, data=bytes(body), method="POST", headers=headers)

    try:
        with urllib.request.urlopen(upload_req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode() if e.fp else ""
        logger.error("Etsy image upload failed: %s %s", e.code, resp_body)
        return {"error": f"Image upload failed: {e.code}", "detail": resp_body}


def get_listings(
    state: str = "active",
    limit: int = 25,
    offset: int = 0,
) -> dict[str, Any]:
    """Get shop listings.

    Args:
        state: "active", "inactive", "draft", "expired"
        limit: Max results (1-100)
        offset: Pagination offset
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    return _api_request(
        f"/application/shops/{shop_id}/listings?state={state}&limit={limit}&offset={offset}"
    )


def get_listing(listing_id: int) -> dict[str, Any]:
    return _api_request(f"/application/listings/{listing_id}")


def get_listing_images(listing_id: int) -> dict[str, Any]:
    return _api_request(f"/application/listings/{listing_id}/images")


def get_listing_videos(listing_id: int) -> dict[str, Any]:
    return _api_request(f"/application/listings/{listing_id}/videos")


def get_listing_files(listing_id: int) -> dict[str, Any]:
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(
        f"/application/shops/{shop_id}/listings/{listing_id}/files"
    )


def find_listing_by_sku(sku: str) -> dict[str, Any] | None:
    """Find an existing shop listing before creating a potentially duplicate draft."""
    for state in ("draft", "active", "inactive"):
        response = get_listings(state=state, limit=100, offset=0)
        if "error" in response:
            raise RuntimeError(f"Etsy {state} lookup failed: {response['error']}")
        for listing in response.get("results", []):
            values = listing.get("skus", listing.get("sku", []))
            if isinstance(values, str):
                values = [values]
            description = str(listing.get("description", ""))
            if sku in values or f"SKU: {sku}" in description:
                return listing
    return None


def activate_listing(listing_id: int) -> dict[str, Any]:
    """Activate a draft listing (make it live)."""
    return update_listing(listing_id, {"state": "active"})


def deactivate_listing(listing_id: int) -> dict[str, Any]:
    """Deactivate a listing (set to inactive, can be reactivated later)."""
    return update_listing(listing_id, {"state": "inactive"})


def delete_listing(listing_id: int) -> dict[str, Any]:
    """Permanently delete a listing from Etsy.

    Uses DELETE /v3/application/listings/{listing_id}.
    This is irreversible — the listing and all its images are gone.

    Args:
        listing_id: Numeric Etsy listing ID.

    Returns:
        Empty dict on success, error dict on failure.
    """
    result = _api_request(
        f"/application/listings/{listing_id}",
        method="DELETE",
    )
    # Etsy returns 204 No Content on successful delete — our helper
    # may return an empty dict or the parsed response
    if result is None or result == {}:
        return {"deleted": True, "listing_id": listing_id}
    return result


# ── Listing Inventory (Variations) ───────────────────────────────────────

def get_listing_inventory(listing_id: int) -> dict[str, Any]:
    """Get current inventory/variations for a listing.

    Useful for inspecting property IDs and variation structure
    on existing listings.
    """
    return _api_request(f"/application/listings/{listing_id}/inventory")


def update_listing_inventory(
    listing_id: int,
    inventory_payload: dict[str, Any],
) -> dict[str, Any]:
    """Set the full variation/pricing matrix for a listing.

    This is the key endpoint that creates Material & Size × Frame
    combinations with individual pricing and enabled/disabled state.

    Args:
        listing_id: Etsy listing ID
        inventory_payload: Output from etsy_variations.build_etsy_inventory_payload()
            Must contain: products, price_on_property, quantity_on_property, sku_on_property

    Returns:
        Updated inventory data or error dict.
    """
    return _api_request(
        f"/application/listings/{listing_id}/inventory",
        method="PUT",
        data=inventory_payload,
        content_type="application/json",
    )


def create_simple_listing(
    title: str,
    description: str,
    tags: list[str],
    photo_width: int,
    photo_height: int,
    image_paths: list[str] | None = None,
    image_urls: list[str] | None = None,
    shipping_profile_id: Optional[int] = None,
    taxonomy_id: Optional[int] = None,
    activate: bool = False,
) -> dict[str, Any]:
    """Create a single-SKU Etsy listing: one size, one material, no variations.

    Simplified flow matching the current Etsy shop format:
    - ChromaLuxe HD Metal Print only
    - Size determined by photo orientation
    - Price from etsy_pricing (5x Pictorem cost)
    - No variation matrix, no frames, no personalization

    Args:
        title: Listing title (max 140 chars)
        description: Full listing description
        tags: Up to 13 Etsy tags
        photo_width: Source photo pixel width
        photo_height: Source photo pixel height
        image_paths: Local file paths to upload as listing images
        image_urls: URLs to download and upload as listing images
        shipping_profile_id: Etsy shipping profile ID
        taxonomy_id: Etsy category taxonomy ID
        activate: If True, set listing to active after setup

    Returns:
        Result dict with listing_id, pricing info, or error.
    """
    from src.agents.etsy_pricing import get_listing_pricing

    # Step 1: Get single-SKU pricing from Pictorem API (real cost for actual size)
    pricing = get_listing_pricing(photo_w=photo_width, photo_h=photo_height)
    price_usd = pricing["etsy_price_usd"]

    logger.info(
        "Creating listing '%s' — %s %s @ $%.0f",
        title[:50], pricing["material"], pricing["size_label"], price_usd,
    )

    # Step 2: Create draft listing
    result = create_listing(
        title=title,
        description=description,
        price=price_usd,
        tags=tags,
        quantity=999,
        shipping_profile_id=shipping_profile_id,
        taxonomy_id=taxonomy_id,
    )

    if "error" in result:
        return {"error": f"Failed to create listing: {result['error']}",
                "detail": result.get("detail", "")}

    listing_id = result.get("listing_id")
    if not listing_id:
        return {"error": "Listing created but no listing_id returned", "result": result}

    logger.info("Created draft listing %s", listing_id)

    # Step 3: Upload user-selected images (mockups + original photo)
    uploaded_images = []
    all_images = []
    if image_paths:
        all_images.extend(("path", p) for p in image_paths[:MOCKUP_SLOTS + 1])
    if image_urls:
        remaining = (MOCKUP_SLOTS + 1) - len(all_images)
        all_images.extend(("url", u) for u in image_urls[:remaining])

    for rank, (img_type, img_source) in enumerate(all_images, start=1):
        if img_type == "url":
            img_result = upload_listing_image(listing_id, img_source, rank=rank)
        else:
            img_result = upload_listing_image_from_file(listing_id, img_source, rank=rank)

        if "error" in img_result:
            logger.error("Image upload %d failed: %s", rank, img_result["error"])
        else:
            uploaded_images.append(img_result)
            logger.info("Uploaded image %d/%d for listing %s",
                        rank, len(all_images), listing_id)

    logger.info("Total images uploaded: %d", len(uploaded_images))

    # Step 4: Optionally activate
    if activate:
        activate_result = update_listing(listing_id, {"state": "active"})
        if "error" in activate_result:
            logger.warning("Failed to activate listing %s: %s",
                           listing_id, activate_result["error"])

    return {
        "listing_id": listing_id,
        "status": "active" if activate else "draft",
        "orientation": pricing["orientation"],
        "material": pricing["material"],
        "size": pricing["size_label"],
        "price_usd": price_usd,
        "pictorem_cost_usd": pricing["pictorem_cost_usd"],
        "shipping": pricing["shipping"],
        "images_uploaded": len(uploaded_images),
    }


def create_full_listing(
    title: str,
    description: str,
    tags: list[str],
    photo_width: int,
    photo_height: int,
    image_paths: list[str] | None = None,
    image_urls: list[str] | None = None,
    shipping_profile_id: Optional[int] = None,
    taxonomy_id: Optional[int] = None,
    min_dpi: int = 150,
    activate: bool = False,
) -> dict[str, Any]:
    """DEPRECATED — redirects to create_simple_listing.

    The old multi-variation flow (5 materials × sizes × frames) has been
    replaced with a single-SKU ChromaLuxe HD Metal Print per listing.
    """
    logger.info("create_full_listing redirecting to create_simple_listing (simplified flow)")
    return create_simple_listing(
        title=title,
        description=description,
        tags=tags,
        photo_width=photo_width,
        photo_height=photo_height,
        image_paths=image_paths,
        image_urls=image_urls,
        shipping_profile_id=shipping_profile_id,
        taxonomy_id=taxonomy_id,
        activate=activate,
    )


# ── Internal Helpers ─────────────────────────────────────────────────────

def _link_frame_images_to_variations(
    listing_id: int,
    inventory_result: dict,
    frame_image_ids: dict[str, int],
) -> None:
    """Link uploaded frame reference images to their Frame variation values.

    Reads the inventory response to find value_ids for each frame option,
    then calls updateVariationImages to associate the correct image.

    This runs automatically — Wolf never has to think about it.
    """
    from src.brand.etsy_variations import PROPERTY_ID_FRAME

    # Build lookup: frame display name → image_id
    name_to_image = {}
    for frame_key, image_id in frame_image_ids.items():
        display_name = FRAME_DISPLAY_NAMES.get(frame_key, frame_key.replace("_", " ").title())
        name_to_image[display_name] = image_id

    # Parse inventory response to find value_ids for each frame option
    variation_links = []
    seen_frames = set()
    inv_products = inventory_result.get("products", [])

    for product in inv_products:
        for pv in product.get("property_values", []):
            if pv.get("property_id") != PROPERTY_ID_FRAME:
                continue
            values = pv.get("values", [])
            value_ids = pv.get("value_ids", [])
            if not values or not value_ids:
                continue

            frame_label = values[0]  # e.g. "Black Frame", "White Frame", "Natural Wood Frame"
            value_id = value_ids[0]

            # Match frame name from the variation label
            if frame_label in name_to_image and frame_label not in seen_frames:
                variation_links.append({
                    "property_id": PROPERTY_ID_FRAME,
                    "value_id": value_id,
                    "image_id": name_to_image[frame_label],
                })
                seen_frames.add(frame_label)

    if variation_links:
        result = update_variation_images(listing_id, variation_links)
        if "error" in result:
            logger.error("Failed to link frame variation images: %s", result["error"])
        else:
            logger.info("Linked %d frame images to variations on listing %s",
                        len(variation_links), listing_id)
    else:
        logger.warning("No frame variations matched for image linking on listing %s", listing_id)


def _set_personalization(listing_id: int) -> None:
    """Set personalization instructions on a listing.

    Uses the legacy personalization field (is_personalizable + personalization_instructions).
    When Etsy multi-personalization API goes GA (Q2 2026), switch to PERSONALIZATION_QUESTIONS.
    """
    result = update_listing(listing_id, {
        "is_personalizable": True,
        "personalization_is_required": False,
        "personalization_instructions": PERSONALIZATION_INSTRUCTIONS,
        "personalization_char_count_max": 500,
    })
    if "error" in result:
        logger.warning("Failed to set personalization on listing %s: %s",
                        listing_id, result.get("error"))
    else:
        logger.info("Set personalization instructions on listing %s", listing_id)


# ── Variation-Image Linking ──────────────────────────────────────────────

def update_variation_images(
    listing_id: int,
    variation_images: list[dict],
) -> dict[str, Any]:
    """Link uploaded images to specific variation values.

    After uploading material reference images, call this to make Etsy
    display the correct image when a buyer selects a material variation.

    Uses the Etsy updateVariationImages endpoint:
    PUT /v3/application/shops/{shop_id}/listings/{listing_id}/variation-images

    Args:
        listing_id: Etsy listing ID
        variation_images: List of dicts, each with:
            - property_id: 513 (Material & Size) or 514 (Frame)
            - value_id: The specific variation value ID
            - image_id: The uploaded image's listing_image_id

    Returns:
        API response or error dict.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    return _api_request(
        f"/application/shops/{shop_id}/listings/{listing_id}/variation-images",
        method="PUT",
        data={"variation_images": variation_images},
        content_type="application/json",
    )


def get_variation_images(listing_id: int) -> dict[str, Any]:
    """Get current variation-image associations for a listing.

    Returns:
        API response with variation_images array, or error dict.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    return _api_request(
        f"/application/shops/{shop_id}/listings/{listing_id}/variation-images",
    )


def upload_listing_image_from_file(
    listing_id: int,
    file_path: str,
    rank: int = 1,
) -> dict[str, Any]:
    """Upload a local image file to a listing.

    Args:
        listing_id: Etsy listing ID
        file_path: Local file path to the image
        rank: Image position (1 = primary)

    Returns:
        Upload result with listing_image_id, or error dict.
    """
    from pathlib import Path

    img_path = Path(file_path)
    if not img_path.exists():
        return {"error": f"Image file not found: {file_path}"}
    token_check = ensure_valid_token()
    if not token_check.get("valid"):
        return {"error": token_check.get("error", "Token invalid")}
    _rate_limit()

    image_data = img_path.read_bytes()
    filename = img_path.name

    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    # Build multipart upload
    boundary = f"----Archive35Boundary{secrets.token_hex(8)}"
    body = bytearray()

    # rank field
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="rank"\r\n\r\n'
    body += f"{rank}\r\n".encode()

    # image field
    content_type = "image/webp" if filename.endswith(".webp") else "image/jpeg"
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode()
    body += f"Content-Type: {content_type}\r\n\r\n".encode()
    body += image_data
    body += b"\r\n"

    body += f"--{boundary}--\r\n".encode()

    url = f"{ETSY_API_BASE}/application/shops/{shop_id}/listings/{listing_id}/images"
    api_key_header = creds["api_key"]
    if creds.get("shared_secret"):
        api_key_header = f"{creds['api_key']}:{creds['shared_secret']}"
    headers = {
        "x-api-key": api_key_header,
        "Authorization": f"Bearer {creds['access_token']}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }

    upload_req = urllib.request.Request(url, data=bytes(body), method="POST", headers=headers)

    try:
        with urllib.request.urlopen(upload_req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode() if e.fp else ""
        logger.error("Etsy file image upload failed: %s %s", e.code, resp_body)
        return {"error": f"Image upload failed: {e.code}", "detail": resp_body}
    except Exception as error:
        return {"error": f"Image upload failed: {error}"}


def upload_listing_file_from_path(
    listing_id: int,
    file_path: str,
    rank: int = 1,
) -> dict[str, Any]:
    """Upload one buyer-delivery file to an Etsy digital listing."""
    digital_path = Path(file_path)
    if not digital_path.is_file():
        return {"error": f"Digital file not found: {file_path}"}
    if digital_path.stat().st_size > 20 * 1024 * 1024:
        return {"error": f"Digital file exceeds Etsy's 20 MB limit: {digital_path.name}"}
    token_check = ensure_valid_token()
    if not token_check.get("valid"):
        return {"error": token_check.get("error", "Token invalid")}
    _rate_limit()

    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    boundary = f"----Archive35Boundary{secrets.token_hex(8)}"
    body = bytearray()
    for name, value in (("name", digital_path.name), ("rank", str(rank))):
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += f"{value}\r\n".encode()
    body += f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="file"; '
        f'filename="{digital_path.name}"\r\n'
    ).encode()
    content_type = mimetypes.guess_type(digital_path.name)[0] or (
        "application/octet-stream"
    )
    body += f"Content-Type: {content_type}\r\n\r\n".encode()
    body += digital_path.read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()

    api_key = creds["api_key"]
    if creds.get("shared_secret"):
        api_key = f"{api_key}:{creds['shared_secret']}"
    request = urllib.request.Request(
        f"{ETSY_API_BASE}/application/shops/{shop_id}/listings/{listing_id}/files",
        data=bytes(body),
        method="POST",
        headers={
            "x-api-key": api_key,
            "Authorization": f"Bearer {creds['access_token']}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode() if error.fp else ""
        return {"error": f"Digital file upload failed: {error.code}", "detail": detail}
    except Exception as error:
        return {"error": f"Digital file upload failed: {error}"}


def upload_listing_video_from_path(
    listing_id: int,
    file_path: str,
) -> dict[str, Any]:
    """Upload one Etsy listing video after enforcing documented limits."""
    video_path = Path(file_path)
    allowed = {".mp4", ".mov", ".flv", ".aac", ".avi", ".3gp", ".mpeg"}
    if not video_path.is_file() or video_path.suffix.lower() not in allowed:
        return {"error": f"Invalid listing video: {file_path}"}
    if video_path.stat().st_size > 100 * 1024 * 1024:
        return {"error": f"Listing video exceeds Etsy's 100 MB limit: {video_path.name}"}
    token_check = ensure_valid_token()
    if not token_check.get("valid"):
        return {"error": token_check.get("error", "Token invalid")}
    _rate_limit()
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    boundary = f"----Archive35Boundary{secrets.token_hex(8)}"
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="name"\r\n\r\n'
    body += f"{video_path.name}\r\n--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="video"; '
        f'filename="{video_path.name}"\r\n'
    ).encode()
    content_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"
    body += f"Content-Type: {content_type}\r\n\r\n".encode()
    body += video_path.read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()
    api_key = creds["api_key"]
    if creds.get("shared_secret"):
        api_key = f"{api_key}:{creds['shared_secret']}"
    request = urllib.request.Request(
        f"{ETSY_API_BASE}/application/shops/{shop_id}/listings/{listing_id}/videos",
        data=bytes(body), method="POST",
        headers={"x-api-key": api_key, "Authorization": f"Bearer {creds['access_token']}",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode() if error.fp else ""
        return {"error": f"Listing video upload failed: {error.code}", "detail": detail}
    except Exception as error:
        return {"error": f"Listing video upload failed: {error}"}


def create_digital_listing(
    *,
    title: str,
    description: str,
    price: float,
    tags: list[str],
    sku: str,
    delivery_files: list[str],
    image_paths: list[str],
    taxonomy_id: Optional[int] = None,
    shop_section_id: Optional[int] = None,
    activate: bool = False,
    on_draft_created: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Create a complete digital listing, remaining draft unless activated."""
    if not 1 <= len(delivery_files) <= 5:
        return {"error": "Digital listings require between 1 and 5 delivery files"}
    if not image_paths:
        return {"error": "At least one listing preview image is required"}

    listing = create_listing(
        title=title,
        description=description,
        price=price,
        tags=tags,
        sku=sku,
        quantity=999,
        taxonomy_id=taxonomy_id,
        when_made="2020_2026",
        listing_type="download",
    )
    if "error" in listing:
        return listing
    listing_id = listing.get("listing_id")
    if not listing_id:
        return {"error": "Etsy created the draft without returning a listing_id"}
    if on_draft_created:
        on_draft_created({
            "listing_id": listing_id,
            "status": "created_draft",
            "sku": sku,
            "price_usd": round(price, 2),
        })

    inventory = get_listing_inventory(listing_id)
    products = inventory.get("products", [])
    offerings = products[0].get("offerings", []) if products else []
    if not products or not offerings:
        return {
            "error": "Draft inventory was not created",
            "listing_id": listing_id,
            "status": "partial_draft",
        }
    uploaded_images = []
    for rank, image_path in enumerate(image_paths[:20], start=1):
        result = upload_listing_image_from_file(listing_id, image_path, rank)
        if "error" in result:
            return {
                "error": "Preview image upload failed",
                "detail": result,
                "listing_id": listing_id,
                "status": "partial_draft",
            }
        uploaded_images.append(result)

    uploaded_files = []
    for rank, delivery_file in enumerate(delivery_files, start=1):
        result = upload_listing_file_from_path(listing_id, delivery_file, rank)
        if "error" in result:
            return {
                "error": "Delivery file upload failed",
                "detail": result,
                "listing_id": listing_id,
                "status": "partial_draft",
            }
        uploaded_files.append(result)

    # Etsy can reset a draft's inventory SKU while digital files are attached.
    # Apply inventory last, then require an owner-authenticated readback match.
    inventory_result = update_listing_inventory(listing_id, {
        "products": [{
            "sku": sku,
            "offerings": [{
                "quantity": 999,
                "is_enabled": True,
                "price": round(price, 2),
            }],
            "property_values": [],
        }],
        "price_on_property": [],
        "quantity_on_property": [],
        "sku_on_property": [],
        "readiness_state_on_property": [],
    })
    if "error" in inventory_result:
        return {
            "error": "Draft SKU inventory update failed",
            "detail": inventory_result,
            "listing_id": listing_id,
            "status": "partial_draft",
        }
    verified_inventory = get_listing_inventory(listing_id)
    verified_products = verified_inventory.get("products", [])
    if not verified_products or verified_products[0].get("sku") != sku:
        return {
            "error": "Draft SKU inventory readback failed",
            "detail": verified_inventory,
            "listing_id": listing_id,
            "status": "unverified_draft",
        }
    if shop_section_id is not None:
        section_result = update_listing(
            listing_id, {"shop_section_id": shop_section_id},
        )
        if "error" in section_result:
            return {
                "error": "Draft shop section update failed",
                "detail": section_result,
                "listing_id": listing_id,
                "status": "unverified_draft",
            }

    if activate:
        result = update_listing(listing_id, {"state": "active"})
        if "error" in result:
            return {
                "error": "Activation failed",
                "detail": result,
                "listing_id": listing_id,
                "status": "complete_draft",
            }
    return {
        "listing_id": listing_id,
        "status": "active" if activate else "draft",
        "images_uploaded": len(uploaded_images),
        "files_uploaded": len(uploaded_files),
        "price_usd": round(price, 2),
        "sku": sku,
    }


# ── Frame Reference Images (Auto-attach) ─────────────────────────────────

# Frame moulding reference images — always appended to Etsy listings.
# These show customers what each frame option looks like around the print.
# Paths are relative to the project root.
FRAME_IMAGES = {
    "black":        "images/products/frame-303-19.jpg",   # Black frame border (full square view)
    "white":        "images/products/frame-241-22.jpg",   # White moulding cross-section
    "natural_wood":  "images/products/frame-303-12.jpg",   # Natural wood corner (grain visible)
}

# Display names matching FRAME_OPTIONS in etsy_variations.py
FRAME_DISPLAY_NAMES = {
    "black":        "Black Frame",
    "white":        "White Frame",
    "natural_wood":  "Natural Wood Frame",
}

# ── Etsy Image Budget ───────────────────────────────────────────────────

ETSY_MAX_IMAGES = 10        # Etsy allows 10 per listing
FRAME_IMAGE_SLOTS = 3       # Reserve 3 slots for frame reference images
FRAME_IMAGES_FOR_ETSY = ["black", "white", "natural_wood"]
MOCKUP_SLOTS = ETSY_MAX_IMAGES - FRAME_IMAGE_SLOTS - 1  # = 6 mockups + 1 original


# ── Personalization Fields ──────────────────────────────────────────────

# Etsy multi-personalization (available April 2026 GA).
# Until then, use the legacy personalization field with instructions.
PERSONALIZATION_INSTRUCTIONS = (
    "Frame: Black / White / Natural Wood / None\n"
    "Mat: White / Black / None\n"
    "Mat Width: 0.5-5 inches (default 2\")\n\n"
    "No selection = unframed print only."
)

# For Etsy multi-personalization API (Q2 2026):
PERSONALIZATION_QUESTIONS = [
    {
        "question_text": "Frame Style",
        "question_type": "dropdown",
        "options": ["No Frame", "Black Picture Frame", "White Picture Frame", "Natural Wood Frame"],
        "is_required": False,
    },
    {
        "question_text": "Mat / Border",
        "question_type": "dropdown",
        "options": ["No Mat (edge to edge)", "White Mat", "Black Mat"],
        "is_required": False,
    },
    {
        "question_text": "Mat Width (inches)",
        "question_type": "dropdown",
        "options": ['0.5"', '1"', '1.5"', '2" (default)', '3"', '4"', '5"'],
        "is_required": False,
    },
]


# ── Order / Receipt Polling ──────────────────────────────────────────────

def get_receipts(
    min_created: Optional[int] = None,
    was_paid: Optional[bool] = None,
    limit: int = 25,
    offset: int = 0,
) -> dict[str, Any]:
    """Get shop receipts (orders).

    Etsy doesn't have webhooks — we poll for new receipts.

    Args:
        min_created: Unix timestamp — only receipts created after this
        was_paid: When set, filter receipts by Etsy payment status
        limit: Max results
        offset: Pagination offset

    Returns:
        Receipt list or error.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    params = f"limit={limit}&offset={offset}"
    if min_created:
        params += f"&min_created={min_created}"
    if was_paid is not None:
        params += f"&was_paid={str(was_paid).lower()}"

    return _api_request(f"/application/shops/{shop_id}/receipts?{params}")


def get_receipt(receipt_id: int) -> dict[str, Any]:
    """Get a single receipt with full details."""
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    return _api_request(f"/application/shops/{shop_id}/receipts/{receipt_id}")


def get_receipt_payments(receipt_id: int) -> dict[str, Any]:
    """Get Etsy's posted gross, fee, and net payment facts for one receipt."""
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}
    return _api_request(
        f"/application/shops/{shop_id}/receipts/{receipt_id}/payments"
    )


def parse_receipt_for_fulfillment(receipt: dict) -> list[dict]:
    """Extract fulfillment-ready order items from an Etsy receipt.

    Maps Etsy transactions to Pictorem preorder data using SKU.

    Returns:
        List of order items with: sku, material, width, height,
        quantity, customer_name, shipping_address, etsy_receipt_id
    """
    from src.brand.pricing import MATERIALS, build_pictorem_preorder

    items = []
    transactions = receipt.get("transactions", [])
    shipping = receipt.get("formatted_address") or ""

    # Parse shipping address
    buyer_name = receipt.get("name", "")
    addr = {
        "name": buyer_name,
        "first_line": receipt.get("first_line", ""),
        "second_line": receipt.get("second_line", ""),
        "city": receipt.get("city", ""),
        "state": receipt.get("state", ""),
        "zip": receipt.get("zip", ""),
        "country": receipt.get("country_iso", "US"),
    }

    for txn in transactions:
        sku_list = txn.get("sku", [])
        sku = sku_list[0] if sku_list else ""
        quantity = txn.get("quantity", 1)

        # Parse SKU: A35-{COL}-{NUM}-{WxH}-{MAT}-{ED}
        item = {
            "etsy_receipt_id": receipt.get("receipt_id"),
            "etsy_transaction_id": txn.get("transaction_id"),
            "sku": sku,
            "title": txn.get("title", ""),
            "price": txn.get("price", {}).get("amount", 0) / txn.get("price", {}).get("divisor", 100),
            "quantity": quantity,
            "shipping_address": addr,
        }

        # Try to parse material and dimensions from SKU
        if sku and sku.startswith("A35-"):
            parts = sku.split("-")
            if len(parts) >= 6:
                size_str = parts[3]  # e.g. "24x16"
                mat_code = parts[4]  # e.g. "CAN"

                # Reverse-map material code
                mat_map = {k[:3].upper(): k for k in MATERIALS}
                material_key = mat_map.get(mat_code)

                if material_key and "x" in size_str:
                    w, h = size_str.split("x")
                    item["material_key"] = material_key
                    item["width"] = int(w)
                    item["height"] = int(h)
                    item["pictorem_preorder"] = build_pictorem_preorder(
                        material_key, int(w), int(h), quantity
                    )

        items.append(item)

    return items


# ── Bulk Listing Creation ────────────────────────────────────────────────

def create_listing_from_content(
    conn: sqlite3.Connection,
    content_id: str,
    sku: str = "",
    etsy_price: float = 0,
    shipping_profile_id: Optional[int] = None,
) -> dict[str, Any]:
    """Create an Etsy listing from approved content.

    Pulls content body, tags, and photo data to create a complete listing.

    Args:
        conn: Database connection
        content_id: Content table ID
        sku: SKU for the listing
        etsy_price: Price to list at (0 = auto-calculate)
        shipping_profile_id: Etsy shipping profile

    Returns:
        Created listing result or error.
    """
    from src.brand.pricing import etsy_price as calc_etsy_price, website_price

    content = conn.execute(
        "SELECT * FROM content WHERE id = ?", (content_id,)
    ).fetchone()
    if not content:
        return {"error": f"Content {content_id} not found"}

    photo = conn.execute(
        "SELECT * FROM photos WHERE id = ?", (content["photo_id"],)
    ).fetchone()

    # Parse tags
    try:
        tags = json.loads(content["tags"]) if content["tags"] else []
    except (json.JSONDecodeError, TypeError):
        tags = []

    # Build title from content or photo data
    collection = photo["collection"] if photo else ""
    title = content.get("title") or ""
    if not title:
        # Derive from body first line + collection
        first_line = (content["body"] or "").split("\n")[0].strip()
        if len(first_line) > 100:
            first_line = first_line[:97] + "..."
        title = first_line
        if collection and collection.upper() not in title.upper():
            suffix = f" | {collection.replace('_', ' ')}"
            if len(title) + len(suffix) <= 140:
                title += suffix

    # Calculate price if not provided
    if etsy_price <= 0 and photo:
        # Default: canvas 24x16 price as base
        site_p = website_price("canvas", 24, 16)
        etsy_price = float(calc_etsy_price(site_p))

    # Append provenance to description
    description = content["body"] or ""
    if content.get("provenance"):
        description += f"\n\n{content['provenance']}"
    description += "\n\n© Wolfgang Schram / Archive-35 Studio"
    description += "\nAll prints are made-to-order and shipped directly from our professional print lab."

    result = create_listing(
        title=title,
        description=description,
        price=etsy_price,
        tags=tags,
        sku=sku,
        shipping_profile_id=shipping_profile_id,
    )

    if "error" not in result:
        # Log to audit
        from src.safety.audit import log as audit_log
        audit_log(conn, "social", "etsy_listing_created", {
            "listing_id": result.get("listing_id"),
            "content_id": content_id,
            "title": title[:60],
            "price": etsy_price,
            "sku": sku,
        })

    return result


# ── EtsyClient Class ───────────────────────────────────────────────────
# Wraps the module-level functions into a stateful class expected by api.py.
# Persists PKCE code_verifier between generate_oauth_url() and exchange_code().

class EtsyClient:
    """Stateful Etsy API client wrapping module-level functions.

    Stores PKCE code_verifier so the OAuth flow works across requests.
    All API calls delegate to the tested standalone functions above.
    """

    def __init__(self):
        self._code_verifier: Optional[str] = None
        self._state: Optional[str] = None

    @property
    def access_token(self) -> str:
        return get_credentials().get("access_token", "")

    @property
    def shop_id(self) -> str:
        return get_credentials().get("shop_id", "")

    def token_expires_within(self, hours: int = 2) -> bool:
        """Check if the access token expires within the given hours."""
        creds = get_credentials()
        expires = creds.get("token_expires", "")
        if not expires:
            return True  # No expiry info — assume needs refresh
        try:
            from datetime import timedelta
            exp_dt = datetime.fromisoformat(expires)
            threshold = datetime.now(timezone.utc) + timedelta(hours=hours)
            return exp_dt <= threshold
        except (ValueError, TypeError):
            return True  # Can't parse — assume needs refresh

    def ensure_valid_token(self) -> dict[str, Any]:
        """Check and refresh token if needed. Delegates to module-level function."""
        return ensure_valid_token()

    def refresh_access_token(self) -> dict[str, Any]:
        """Refresh the access token. Delegates to module-level function."""
        return refresh_access_token()

    def generate_oauth_url(self) -> tuple[str, str]:
        """Generate OAuth URL, store code_verifier for later exchange.

        Returns:
            (auth_url, state) tuple
        """
        result = generate_oauth_url()
        if "error" in result:
            raise RuntimeError(result["error"])
        self._code_verifier = result["code_verifier"]
        self._state = result["state"]
        return result["auth_url"], result["state"]

    def exchange_code(self, auth_code: str) -> dict[str, Any]:
        """Exchange authorization code using stored PKCE verifier.

        Args:
            auth_code: Code from OAuth callback

        Returns:
            Token response dict

        Raises:
            RuntimeError: If no code_verifier from prior generate_oauth_url()
        """
        if not self._code_verifier:
            raise RuntimeError(
                "No code_verifier — call generate_oauth_url() first"
            )
        result = exchange_code(auth_code, self._code_verifier)
        if "error" in result:
            raise RuntimeError(result.get("detail", result["error"]))
        return result

    def get_shop_info(self) -> dict[str, Any]:
        return get_shop_info()

    def get_shipping_profiles(self) -> dict[str, Any]:
        return get_shipping_profiles()

    def get_receipts(self, was_paid: bool = True, limit: int = 25, **kwargs) -> dict[str, Any]:
        """Poll for receipts/orders."""
        return get_receipts(was_paid=was_paid, limit=limit, **kwargs)

    def get_receipt(self, receipt_id: int) -> dict[str, Any]:
        return get_receipt(receipt_id)

    def get_receipt_payments(self, receipt_id: int) -> dict[str, Any]:
        return get_receipt_payments(receipt_id)

    def get_listings(self, state: str = "active", limit: int = 25, offset: int = 0) -> dict[str, Any]:
        return get_listings(state=state, limit=limit, offset=offset)

    def create_listing_from_content(
        self,
        conn: sqlite3.Connection = None,
        content: dict = None,
        content_id: str = "",
        price: float = 0,
        quantity: int = 999,
        sku: str = "",
        shipping_profile_id: Optional[int] = None,
        **kwargs,
    ) -> dict[str, Any]:
        """Create listing — supports both api.py call signatures.

        api.py calls this with (content=dict, price=, quantity=, shipping_profile_id=)
        Direct callers may use (conn=, content_id=, sku=, etsy_price=)
        """
        # If called with content dict directly (api.py pattern)
        if content and isinstance(content, dict):
            from src.brand.pricing import etsy_price as calc_etsy_price, website_price

            # Parse tags
            try:
                tags = json.loads(content.get("tags", "[]")) if content.get("tags") else []
            except (json.JSONDecodeError, TypeError):
                tags = []

            title = content.get("title") or ""
            if not title:
                first_line = (content.get("body") or "").split("\n")[0].strip()
                if len(first_line) > 100:
                    first_line = first_line[:97] + "..."
                title = first_line

            description = content.get("body") or ""
            if content.get("provenance"):
                description += f"\n\n{content['provenance']}"
            description += "\n\n© Wolfgang Schram / Archive-35 Studio"
            description += "\nAll prints are made-to-order and shipped directly from our professional print lab."

            listing_price = price if price > 0 else float(calc_etsy_price(website_price("canvas", 24, 16)))

            return create_listing(
                title=title,
                description=description,
                price=listing_price,
                tags=tags,
                sku=sku,
                quantity=quantity,
                shipping_profile_id=shipping_profile_id,
            )

        # If called with conn + content_id (direct module pattern)
        if conn and content_id:
            return create_listing_from_content(
                conn, content_id, sku=sku,
                etsy_price=price,
                shipping_profile_id=shipping_profile_id,
            )

        return {"error": "Must provide either content dict or conn + content_id"}

    def upload_listing_image(self, listing_id: int, image_url: str, rank: int = 1) -> dict[str, Any]:
        return upload_listing_image(listing_id, image_url, rank)

    def activate_listing(self, listing_id: int) -> dict[str, Any]:
        return activate_listing(listing_id)
