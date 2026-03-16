"""Tests for Etsy OAuth token refresh and scope checking."""

import json
from unittest.mock import patch, MagicMock

import pytest

from src.integrations.etsy import (
    ensure_valid_token,
    check_scope,
    has_valid_token,
    refresh_access_token,
)


@pytest.fixture
def mock_creds_expired():
    """Credentials with an expired token."""
    return {
        "api_key": "test_key",
        "shared_secret": "test_secret",
        "access_token": "old_token",
        "refresh_token": "refresh_123",
        "shop_id": "64687967",
        "token_expires": "2026-03-09T00:00:00+00:00",
    }


@pytest.fixture
def mock_creds_valid():
    """Credentials with a valid (future) token."""
    return {
        "api_key": "test_key",
        "shared_secret": "test_secret",
        "access_token": "valid_token",
        "refresh_token": "refresh_123",
        "shop_id": "64687967",
        "token_expires": "2027-01-01T00:00:00+00:00",
    }


@pytest.fixture
def mock_creds_no_refresh():
    """Credentials with expired token and no refresh token."""
    return {
        "api_key": "test_key",
        "shared_secret": "test_secret",
        "access_token": "old_token",
        "refresh_token": "",
        "shop_id": "64687967",
        "token_expires": "2026-03-09T00:00:00+00:00",
    }


class TestEnsureValidToken:
    """Tests for ensure_valid_token()."""

    def test_valid_token_returns_immediately(self, mock_creds_valid):
        with patch("src.integrations.etsy.get_credentials", return_value=mock_creds_valid):
            result = ensure_valid_token()
            assert result["valid"] is True

    def test_expired_token_triggers_refresh(self, mock_creds_expired):
        refresh_response = {
            "access_token": "new_token",
            "refresh_token": "new_refresh",
            "expires_in": 3600,
        }
        with (
            patch("src.integrations.etsy.get_credentials", return_value=mock_creds_expired),
            patch("src.integrations.etsy.refresh_access_token", return_value=refresh_response) as mock_refresh,
            patch("src.integrations.etsy._save_tokens"),
        ):
            result = ensure_valid_token()
            assert result["valid"] is True
            assert result.get("refreshed") is True
            mock_refresh.assert_called_once()

    def test_expired_no_refresh_token_requires_reauth(self, mock_creds_no_refresh):
        with patch("src.integrations.etsy.get_credentials", return_value=mock_creds_no_refresh):
            result = ensure_valid_token()
            assert result["valid"] is False
            assert result["reauth_required"] is True

    def test_refresh_failure_returns_error(self, mock_creds_expired):
        with (
            patch("src.integrations.etsy.get_credentials", return_value=mock_creds_expired),
            patch("src.integrations.etsy.refresh_access_token", return_value={"error": "invalid_grant"}),
        ):
            result = ensure_valid_token()
            assert result["valid"] is False
            assert "invalid_grant" in result["error"]


class TestCheckScope:
    """Tests for check_scope()."""

    def test_scope_check_with_valid_token(self, mock_creds_valid):
        listings_response = {"count": 30, "results": []}
        receipts_response = {"count": 0, "results": []}

        with (
            patch("src.integrations.etsy.get_credentials", return_value=mock_creds_valid),
            patch("src.integrations.etsy._api_request") as mock_api,
        ):
            mock_api.side_effect = [listings_response, receipts_response]
            result = check_scope()

            assert result["listings_r"] is True
            assert result["listing_count"] == 30
            assert result["transactions_r"] is True

    def test_scope_check_no_token(self, mock_creds_no_refresh):
        with patch("src.integrations.etsy.get_credentials", return_value=mock_creds_no_refresh):
            result = check_scope()
            assert "error" in result

    def test_scope_check_no_shop_id(self, mock_creds_valid):
        creds_no_shop = {**mock_creds_valid, "shop_id": ""}
        with patch("src.integrations.etsy.get_credentials", return_value=creds_no_shop):
            result = check_scope()
            assert "error" in result
            assert "ETSY_SHOP_ID" in result["error"]
