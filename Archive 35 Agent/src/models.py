"""Archive-35 Pydantic models.

All data models matching the SQLite schema. Used for validation,
serialization, and type safety throughout the application.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


def _utc_now() -> str:
    """Return current UTC timestamp as ISO string."""
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    """Generate a new UUID4 string."""
    return str(uuid4())


class Photo(BaseModel):
    """A photo record from the photos table."""

    id: str = Field(..., description="SHA256 hash of file content")
    filename: str
    path: str
    imported_at: str = Field(default_factory=_utc_now)
    width: Optional[int] = None
    height: Optional[int] = None
    exif_json: Optional[str] = None
    collection: Optional[str] = None
    vision_tags: Optional[str] = None
    vision_mood: Optional[str] = None
    vision_composition: Optional[str] = None
    vision_analyzed_at: Optional[str] = None
    marketability_score: Optional[int] = Field(default=None, ge=1, le=10)

    def get_tags(self) -> list[str]:
        """Parse vision_tags JSON string into a list."""
        if not self.vision_tags:
            return []
        return json.loads(self.vision_tags)

    def get_exif(self) -> dict:
        """Parse exif_json string into a dict."""
        if not self.exif_json:
            return {}
        return json.loads(self.exif_json)


class Content(BaseModel):
    """Generated content awaiting approval."""

    id: str = Field(default_factory=_uuid)
    photo_id: str
    platform: str = Field(..., description="pinterest, instagram, or etsy")
    content_type: str = Field(..., description="caption, description, or listing")
    body: str
    tags: Optional[str] = None
    variant: int = Field(default=1, ge=1)
    status: str = Field(default="pending")
    created_at: str = Field(default_factory=_utc_now)
    approved_at: Optional[str] = None
    posted_at: Optional[str] = None
    expires_at: Optional[str] = None
    provenance: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        """Ensure status is one of the allowed values."""
        allowed = {"pending", "approved", "rejected", "expired"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}, got '{v}'")
        return v

    @field_validator("platform")
    @classmethod
    def validate_platform(cls, v: str) -> str:
        """Ensure platform is recognized."""
        allowed = {"pinterest", "instagram", "etsy", "shopify"}
        if v not in allowed:
            raise ValueError(f"platform must be one of {allowed}, got '{v}'")
        return v

    def get_tags(self) -> list[str]:
        """Parse tags JSON string into a list."""
        if not self.tags:
            return []
        return json.loads(self.tags)

    def is_expired(self) -> bool:
        """Check if content has passed its expiry time."""
        if not self.expires_at:
            return False
        expires = datetime.fromisoformat(self.expires_at)
        now = datetime.now(timezone.utc)
        return now > expires


class Action(BaseModel):
    """An entry in the idempotency ledger."""

    id: str = Field(default_factory=_uuid)
    action_hash: str
    action_type: str = Field(..., description="post, list, or email")
    target: str = Field(..., description="Platform + ID")
    content_id: Optional[str] = None
    status: str = Field(default="pending")
    created_at: str = Field(default_factory=_utc_now)
    executed_at: Optional[str] = None
    cost_usd: float = Field(default=0.0, ge=0)
    error: Optional[str] = None


class AuditEntry(BaseModel):
    """An audit log entry."""

    id: Optional[int] = None  # Auto-incremented by SQLite
    timestamp: str = Field(default_factory=_utc_now)
    component: str
    action: str
    details: Optional[str] = None
    cost_usd: float = Field(default=0.0, ge=0)
    success: int = Field(default=1, ge=0, le=1)


class RateLimit(BaseModel):
    """Rate limit tracking for a single API."""

    api_name: str
    calls_today: int = Field(default=0, ge=0)
    cost_today_usd: float = Field(default=0.0, ge=0)
    daily_call_limit: int = Field(..., ge=1)
    daily_cost_limit_usd: float = Field(..., ge=0)
    last_reset: str = Field(default_factory=_utc_now)

    def is_call_limit_reached(self) -> bool:
        """Check if daily call limit is reached."""
        return self.calls_today >= self.daily_call_limit

    def is_cost_limit_reached(self) -> bool:
        """Check if daily cost limit is reached."""
        return self.cost_today_usd >= self.daily_cost_limit_usd


class KillSwitch(BaseModel):
    """Kill switch state for a scope."""

    scope: str = Field(..., description="global, pinterest, instagram, etc.")
    active: int = Field(default=0, ge=0, le=1)
    activated_at: Optional[str] = None
    activated_by: Optional[str] = None
    reason: Optional[str] = None


class SKU(BaseModel):
    """A product SKU in the catalog."""

    sku: str = Field(..., description="e.g. A35-ICE-0042-16R-HAH-OE")
    photo_id: str
    collection: str
    size_code: str
    paper_code: str
    edition_type: str = Field(..., description="OE or LE")
    edition_total: Optional[int] = None
    edition_sold: int = Field(default=0, ge=0)
    base_cost_usd: float = Field(..., ge=0)
    min_price_usd: float = Field(..., ge=0)
    list_price_usd: float = Field(..., ge=0)
    active: int = Field(default=1, ge=0, le=1)

    @field_validator("edition_type")
    @classmethod
    def validate_edition_type(cls, v: str) -> str:
        """Ensure edition type is OE or LE."""
        if v not in ("OE", "LE"):
            raise ValueError(f"edition_type must be 'OE' or 'LE', got '{v}'")
        return v


class GreatestHit(BaseModel):
    """Tracking record for high-performing content."""

    id: str = Field(default_factory=_uuid)
    content_id: str
    platform: str
    times_posted: int = Field(default=1, ge=1)
    last_posted_at: Optional[str] = None
    performance_score: Optional[float] = None
    eligible: int = Field(default=1, ge=0, le=1)
