"""Tests for Pydantic models."""

import json

import pytest
from pydantic import ValidationError

from src.models import (
    Action,
    AuditEntry,
    Content,
    GreatestHit,
    KillSwitch,
    Photo,
    RateLimit,
    SKU,
)


class TestPhoto:
    def test_create_minimal(self):
        photo = Photo(id="abc123", filename="test.jpg", path="/photos/test.jpg")
        assert photo.id == "abc123"
        assert photo.filename == "test.jpg"
        assert photo.imported_at  # Auto-generated

    def test_full_photo(self):
        photo = Photo(
            id="abc123",
            filename="test.jpg",
            path="/photos/test.jpg",
            width=4000,
            height=3000,
            exif_json='{"camera": "Sony A7R"}',
            collection="ICE",
            vision_tags='["ice", "landscape"]',
            marketability_score=8,
        )
        assert photo.width == 4000
        assert photo.get_tags() == ["ice", "landscape"]
        assert photo.get_exif() == {"camera": "Sony A7R"}

    def test_marketability_score_range(self):
        with pytest.raises(ValidationError):
            Photo(id="x", filename="x", path="x", marketability_score=11)

    def test_serialize_to_dict(self):
        photo = Photo(id="abc123", filename="test.jpg", path="/photos/test.jpg")
        d = photo.model_dump()
        assert isinstance(d, dict)
        assert d["id"] == "abc123"

    def test_get_tags_empty(self):
        photo = Photo(id="abc123", filename="test.jpg", path="/photos/test.jpg")
        assert photo.get_tags() == []


class TestContent:
    def test_create_content(self):
        content = Content(
            photo_id="abc123",
            platform="pinterest",
            content_type="caption",
            body="A stunning landscape",
        )
        assert content.status == "pending"
        assert content.variant == 1
        assert content.id  # UUID auto-generated

    def test_invalid_platform(self):
        with pytest.raises(ValidationError, match="platform"):
            Content(
                photo_id="abc123",
                platform="tiktok",
                content_type="caption",
                body="test",
            )

    def test_invalid_status(self):
        with pytest.raises(ValidationError, match="status"):
            Content(
                photo_id="abc123",
                platform="pinterest",
                content_type="caption",
                body="test",
                status="published",
            )

    def test_is_expired(self):
        content = Content(
            photo_id="abc123",
            platform="pinterest",
            content_type="caption",
            body="test",
            expires_at="2020-01-01T00:00:00+00:00",
        )
        assert content.is_expired() is True

    def test_not_expired(self):
        content = Content(
            photo_id="abc123",
            platform="pinterest",
            content_type="caption",
            body="test",
            expires_at="2030-01-01T00:00:00+00:00",
        )
        assert content.is_expired() is False


class TestAction:
    def test_create_action(self):
        action = Action(
            action_hash="hash123",
            action_type="post",
            target="pinterest:pin123",
        )
        assert action.status == "pending"
        assert action.cost_usd == 0.0


class TestAuditEntry:
    def test_create_audit_entry(self):
        entry = AuditEntry(
            component="vision",
            action="analyze_photo",
            details='{"photo_id": "abc123"}',
            cost_usd=0.003,
        )
        assert entry.success == 1
        assert entry.cost_usd == 0.003


class TestRateLimit:
    def test_create_rate_limit(self):
        rl = RateLimit(
            api_name="anthropic",
            daily_call_limit=1000,
            daily_cost_limit_usd=5.0,
        )
        assert rl.calls_today == 0
        assert rl.is_call_limit_reached() is False

    def test_call_limit_reached(self):
        rl = RateLimit(
            api_name="anthropic",
            calls_today=1000,
            daily_call_limit=1000,
            daily_cost_limit_usd=5.0,
        )
        assert rl.is_call_limit_reached() is True

    def test_cost_limit_reached(self):
        rl = RateLimit(
            api_name="anthropic",
            cost_today_usd=5.0,
            daily_call_limit=1000,
            daily_cost_limit_usd=5.0,
        )
        assert rl.is_cost_limit_reached() is True


class TestKillSwitch:
    def test_create_kill_switch(self):
        ks = KillSwitch(scope="global")
        assert ks.active == 0


class TestSKU:
    def test_create_sku(self):
        sku = SKU(
            sku="A35-ICE-0042-16R-HAH-OE",
            photo_id="abc123",
            collection="ICE",
            size_code="16R",
            paper_code="HAH",
            edition_type="OE",
            base_cost_usd=25.0,
            min_price_usd=60.0,
            list_price_usd=89.0,
        )
        assert sku.active == 1

    def test_invalid_edition_type(self):
        with pytest.raises(ValidationError, match="edition_type"):
            SKU(
                sku="X",
                photo_id="X",
                collection="X",
                size_code="X",
                paper_code="X",
                edition_type="INVALID",
                base_cost_usd=0,
                min_price_usd=0,
                list_price_usd=0,
            )


class TestGreatestHit:
    def test_create_greatest_hit(self):
        gh = GreatestHit(content_id="c123", platform="pinterest")
        assert gh.times_posted == 1
        assert gh.eligible == 1
