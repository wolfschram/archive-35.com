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
import os
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from base64 import urlsafe_b64encode
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Etsy API v3 base
ETSY_API_BASE = "https://openapi.etsy.com/v3"

# Etsy fee structure (for reference in pricing)
ETSY_TRANSACTION_FEE_RATE = 0.065
ETSY_PAYMENT_PROCESSING_RATE = 0.03
ETSY_PAYMENT_FLAT_FEE = 0.25
ETSY_LISTING_FEE = 0.20

# Default taxonomy for fine art photography prints
# "Art & Collectibles > Photography > Color"
DEFAULT_TAXONOMY_ID = 69150467  # Etsy taxonomy ID for Photography > Color

# Shipping profile — must be created in Etsy shop settings first
# This gets populated from .env or shop lookup
DEFAULT_SHIPPING_PROFILE_ID = None


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
        "scope": "listings_r listings_w listings_d transactions_r transactions_w shops_r",
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
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        logger.error("Etsy token exchange failed: %s %s", e.code, body)
        return {"error": f"Token exchange failed: {e.code}", "detail": body}


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
            body = urllib.parse.urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"

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


# ── Listing Management ───────────────────────────────────────────────────

def create_listing(
    title: str,
    description: str,
    price: float,
    tags: list[str],
    sku: str = "",
    quantity: int = 999,
    shipping_profile_id: Optional[int] = None,
    taxonomy_id: int = DEFAULT_TAXONOMY_ID,
    who_made: str = "i_did",
    when_made: str = "made_to_order",
    is_supply: bool = False,
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
        taxonomy_id: Etsy category taxonomy ID
        who_made: "i_did", "someone_else", "collective"
        when_made: Date range string
        is_supply: False for finished products

    Returns:
        Created listing data or error.
    """
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    # Enforce Etsy limits
    if len(title) > 140:
        title = title[:137] + "..."
    tags = [t[:20] for t in tags[:13]]

    # Price in USD cents (Etsy uses float with 2 decimal places)
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
        "type": "physical",  # POD prints are physical goods
        "state": "draft",  # Start as draft for review
    }

    if sku:
        listing_data["sku"] = [sku]

    if shipping_profile_id:
        listing_data["shipping_profile_id"] = shipping_profile_id

    return _api_request(
        f"/application/shops/{shop_id}/listings",
        method="POST",
        data=listing_data,
    )


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


def create_full_listing(
    title: str,
    description: str,
    tags: list[str],
    photo_width: int,
    photo_height: int,
    image_paths: list[str] | None = None,
    image_urls: list[str] | None = None,
    shipping_profile_id: Optional[int] = None,
    taxonomy_id: int = DEFAULT_TAXONOMY_ID,
    min_dpi: int = 150,
    activate: bool = False,
) -> dict[str, Any]:
    """Create a complete Etsy listing with all variations, pricing, and images.

    This is the one-shot orchestrator that does everything:
    1. Creates a draft listing
    2. Uploads images
    3. Sets the full Material & Size × Frame inventory matrix
    4. Optionally activates the listing

    Args:
        title: Listing title (max 140 chars)
        description: Full listing description
        tags: Up to 13 Etsy tags
        photo_width: Source photo pixel width (for DPI calculations)
        photo_height: Source photo pixel height
        image_paths: Local file paths to upload as listing images
        image_urls: URLs to download and upload as listing images
        shipping_profile_id: Etsy shipping profile ID
        taxonomy_id: Etsy category taxonomy ID
        min_dpi: Minimum print DPI threshold
        activate: If True, set listing to active after setup

    Returns:
        Result dict with listing_id, variant_count, price_range, or error.
    """
    from src.brand.etsy_variations import (
        build_variation_matrix,
        build_etsy_inventory_payload,
        get_matrix_summary,
    )

    # Step 1: Build the variation matrix to get the base price
    products = build_variation_matrix(photo_width, photo_height, min_dpi=min_dpi)
    if not products:
        return {"error": "No valid print sizes for this photo (check DPI/dimensions)"}

    summary = get_matrix_summary(products)
    base_price = summary["price_range"][0]  # Lowest price for draft creation

    logger.info(
        "Creating listing '%s' with %d variants ($%.0f–$%.0f)",
        title[:50], summary["total_variants"],
        summary["price_range"][0], summary["price_range"][1],
    )

    # Step 2: Create draft listing
    result = create_listing(
        title=title,
        description=description,
        price=base_price,
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

    # Step 3: Upload images
    uploaded_images = []
    all_images = []
    if image_paths:
        all_images.extend(("path", p) for p in image_paths)
    if image_urls:
        all_images.extend(("url", u) for u in image_urls)

    for rank, (img_type, img_source) in enumerate(all_images, start=1):
        if img_type == "url":
            img_result = upload_listing_image(listing_id, img_source, rank=rank)
        else:
            # For local paths, read the file and we'd need a file upload variant
            # For now, skip local paths (TODO: add file upload support)
            logger.warning("Local file upload not yet supported: %s", img_source)
            continue

        if "error" in img_result:
            logger.error("Image upload %d failed: %s", rank, img_result["error"])
        else:
            uploaded_images.append(img_result)
            logger.info("Uploaded image %d/%d for listing %s",
                        rank, len(all_images), listing_id)

    # Step 4: Set inventory (variations + pricing)
    inventory_payload = build_etsy_inventory_payload(products)
    inv_result = update_listing_inventory(listing_id, inventory_payload)

    if "error" in inv_result:
        return {
            "error": f"Listing created but inventory update failed: {inv_result['error']}",
            "listing_id": listing_id,
            "detail": inv_result.get("detail", ""),
            "note": "Listing exists as draft — fix inventory manually or retry",
        }

    logger.info("Set %d variants on listing %s", summary["total_variants"], listing_id)

    # Step 5: Optionally activate
    if activate:
        activate_result = update_listing(listing_id, {"state": "active"})
        if "error" in activate_result:
            logger.warning("Failed to activate listing %s: %s",
                           listing_id, activate_result["error"])

    return {
        "listing_id": listing_id,
        "status": "active" if activate else "draft",
        "total_variants": summary["total_variants"],
        "enabled_variants": summary["enabled_variants"],
        "disabled_variants": summary["disabled_variants"],
        "price_range": summary["price_range"],
        "materials": summary["materials"],
        "sizes": summary["sizes"],
        "frames": summary["frames"],
        "images_uploaded": len(uploaded_images),
    }


# ── Order / Receipt Polling ──────────────────────────────────────────────

def get_receipts(
    min_created: Optional[int] = None,
    limit: int = 25,
    offset: int = 0,
) -> dict[str, Any]:
    """Get shop receipts (orders).

    Etsy doesn't have webhooks — we poll for new receipts.

    Args:
        min_created: Unix timestamp — only receipts created after this
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

    return _api_request(f"/application/shops/{shop_id}/receipts?{params}")


def get_receipt(receipt_id: int) -> dict[str, Any]:
    """Get a single receipt with full details."""
    creds = get_credentials()
    shop_id = creds.get("shop_id")
    if not shop_id:
        return {"error": "ETSY_SHOP_ID not configured"}

    return _api_request(f"/application/shops/{shop_id}/receipts/{receipt_id}")


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
        return get_receipts(limit=limit, **kwargs)

    def get_receipt(self, receipt_id: int) -> dict[str, Any]:
        return get_receipt(receipt_id)

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
