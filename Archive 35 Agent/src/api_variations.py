"""API routes for Content Variation Engine.

REST endpoints for creating and managing content variations.
Integrates with FastAPI to provide a clean interface to the variations module.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.agents import variations
from src.config import get_settings
from src.db import get_initialized_connection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["variations"])


# ── Request/Response Models ──────────────────────────────────────────


class CreateVariationRequest(BaseModel):
    """Request to create a variation from existing content."""

    content_id: str = Field(..., description="ID of content to vary")
    changes: Optional[dict[str, Any]] = Field(
        None,
        description="Optional overrides: body, tags, platform",
    )


class AdaptPlatformRequest(BaseModel):
    """Request to adapt content to a different platform."""

    content_id: str = Field(..., description="ID of content to adapt")
    target_platform: str = Field(
        ...,
        description="Target platform: pinterest, instagram, etsy, shopify",
    )


class RefreshCopyRequest(BaseModel):
    """Request to refresh caption copy."""

    content_id: str = Field(..., description="ID of content to refresh")


class ABTestRequest(BaseModel):
    """Request to generate A/B test variants."""

    content_id: str = Field(..., description="ID of content to create variants from")
    count: int = Field(2, ge=1, le=5, description="Number of variants (1-5)")


class SeasonalAdjustmentRequest(BaseModel):
    """Request to adjust content for seasonal context."""

    content_id: str = Field(..., description="ID of content to adjust")
    season_or_event: str = Field(
        ...,
        description="Seasonal context: winter, summer, holiday, Black Friday, etc.",
    )


class VariationResponse(BaseModel):
    """Response after variation creation."""

    success: bool
    variation_id: Optional[str] = None
    message: str


class VariationListResponse(BaseModel):
    """Response with list of variations."""

    photo_id: str
    variations: list[dict]
    total: int


# ── Helper ───────────────────────────────────────────────────────────


def _get_conn():
    """Get an initialized DB connection."""
    settings = get_settings()
    return get_initialized_connection(settings.db_path)


def _get_anthropic_client() -> Optional[Any]:
    """Get Anthropic client from settings, or None if not configured."""
    settings = get_settings()
    if settings.anthropic_api_key:
        try:
            import anthropic
            return anthropic.Anthropic(api_key=settings.anthropic_api_key)
        except Exception as e:
            logger.warning("Failed to create Anthropic client: %s", e)
            return None
    return None


# ── Routes ───────────────────────────────────────────────────────────


@router.post("/create")
def create_variation_endpoint(req: CreateVariationRequest) -> VariationResponse:
    """Create a variation of existing content with optional overrides.

    Allows Wolf to tweak captions, swap platforms, adjust tags without
    generating entirely new content from scratch.

    Args:
        req: CreateVariationRequest with content_id and optional changes dict.

    Returns:
        VariationResponse with new variation_id or error message.
    """
    conn = _get_conn()
    try:
        variation_id = variations.create_variation(
            conn,
            req.content_id,
            changes=req.changes,
        )
        if variation_id:
            return VariationResponse(
                success=True,
                variation_id=variation_id,
                message=f"Variation created: {variation_id}",
            )
        else:
            raise HTTPException(status_code=400, detail="Failed to create variation")
    except Exception as e:
        logger.error("Create variation error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/adapt-platform")
def adapt_platform_endpoint(req: AdaptPlatformRequest) -> VariationResponse:
    """Convert content from one platform to another.

    Uses Claude to intelligently rewrite the caption for the target platform's
    style (e.g., Pinterest → Instagram means going from inspirational to conversational).

    Args:
        req: AdaptPlatformRequest with content_id and target_platform.

    Returns:
        VariationResponse with adapted content_id or error message.
    """
    conn = _get_conn()
    try:
        client = _get_anthropic_client()
        variation_id = variations.adapt_platform(
            conn,
            req.content_id,
            req.target_platform,
            client=client,
        )
        if variation_id:
            return VariationResponse(
                success=True,
                variation_id=variation_id,
                message=f"Content adapted to {req.target_platform}: {variation_id}",
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Failed to adapt content to target platform",
            )
    except Exception as e:
        logger.error("Adapt platform error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/refresh")
def refresh_copy_endpoint(req: RefreshCopyRequest) -> VariationResponse:
    """Rewrite caption to feel fresh while keeping intent and photo the same.

    Uses Claude to paraphrase the caption, change hooks and structure,
    but preserve the core message and emotional tone.

    Args:
        req: RefreshCopyRequest with content_id.

    Returns:
        VariationResponse with refreshed content_id or error message.
    """
    conn = _get_conn()
    try:
        client = _get_anthropic_client()
        variation_id = variations.refresh_copy(
            conn,
            req.content_id,
            client=client,
        )
        if variation_id:
            return VariationResponse(
                success=True,
                variation_id=variation_id,
                message=f"Copy refreshed: {variation_id}",
            )
        else:
            raise HTTPException(status_code=400, detail="Failed to refresh copy")
    except Exception as e:
        logger.error("Refresh copy error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/ab-test")
def generate_ab_variants_endpoint(req: ABTestRequest) -> VariationResponse:
    """Generate A/B test variants with different hooks and angles.

    Uses Claude to create alternative versions with different emotional angles
    (e.g., emotional storytelling vs. practical benefits vs. curiosity-driven).

    Args:
        req: ABTestRequest with content_id and optional count (1-5).

    Returns:
        VariationResponse with list of new variation_ids or error message.
    """
    conn = _get_conn()
    try:
        client = _get_anthropic_client()
        variant_ids = variations.generate_ab_variants(
            conn,
            req.content_id,
            count=req.count,
            client=client,
        )
        if variant_ids:
            return VariationResponse(
                success=True,
                variation_id=variant_ids[0],  # Return first for backwards compat
                message=f"Generated {len(variant_ids)} A/B variants: {', '.join(v[:8] for v in variant_ids)}",
            )
        else:
            raise HTTPException(status_code=400, detail="Failed to generate A/B variants")
    except Exception as e:
        logger.error("Generate A/B variants error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.post("/seasonal")
def suggest_seasonal_endpoint(req: SeasonalAdjustmentRequest) -> VariationResponse:
    """Adjust content for seasonal context (e.g., "winter vibes", "holiday gift guide").

    Uses Claude to rewrite the caption emphasizing seasonal themes while
    keeping the core image and message intact.

    Args:
        req: SeasonalAdjustmentRequest with content_id and season_or_event.

    Returns:
        VariationResponse with seasonal content_id or error message.
    """
    conn = _get_conn()
    try:
        client = _get_anthropic_client()
        variation_id = variations.suggest_seasonal(
            conn,
            req.content_id,
            req.season_or_event,
            client=client,
        )
        if variation_id:
            return VariationResponse(
                success=True,
                variation_id=variation_id,
                message=f"Content adjusted for {req.season_or_event}: {variation_id}",
            )
        else:
            raise HTTPException(status_code=400, detail="Failed to adjust content seasonally")
    except Exception as e:
        logger.error("Seasonal adjustment error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/history/{photo_id}")
def get_variation_history_endpoint(photo_id: str) -> VariationListResponse:
    """Get all variations created for a photo.

    Shows the complete variation lineage for a single photo, useful for
    understanding what versions have been created and their performance.

    Args:
        photo_id: Photo ID to query.

    Returns:
        VariationListResponse with list of variations and total count.
    """
    conn = _get_conn()
    try:
        variations_list = variations.get_variation_history(conn, photo_id)
        return VariationListResponse(
            photo_id=photo_id,
            variations=variations_list,
            total=len(variations_list),
        )
    except Exception as e:
        logger.error("Get variation history error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
