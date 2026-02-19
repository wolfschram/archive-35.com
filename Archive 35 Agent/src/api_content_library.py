"""Archive-35 Content Library API routes.

FastAPI router for managing content masters: listing, searching, duplicating,
and marking content as reused. Integrate this router into api.py with:

    from src.api_content_library import router as library_router
    app.include_router(library_router, prefix="/library", tags=["content-library"])
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.content_library import ContentLibrary, ContentMaster
from src.db import get_initialized_connection

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_library(db_path: str = "data/archive35.db") -> ContentLibrary:
    """Get an initialized ContentLibrary instance."""
    conn = get_initialized_connection(db_path)
    return ContentLibrary(conn)


# ── Request/Response Models ──────────────────────────────────────────


class SaveMasterRequest(BaseModel):
    """Request to save a new master record."""

    platform: str = Field(..., description="pinterest, instagram, etsy, or shopify")
    photo_id: str = Field(..., description="Photo ID this content references")
    body: str = Field(..., description="Main content body")
    title: Optional[str] = Field(None, description="Optional title/headline")
    tags: Optional[list[str]] = Field(None, description="Optional tags for searchability")
    provenance: Optional[str] = Field(None, description="Approval note, e.g. 'Approved by Wolf'")
    skus: Optional[list[dict]] = Field(None, description="Related SKU objects")
    collection: Optional[str] = Field(None, description="Collection name")
    content_id: Optional[str] = Field(None, description="Original content ID")


class DuplicateMasterRequest(BaseModel):
    """Request to duplicate a master."""

    new_platform: Optional[str] = Field(None, description="New platform, or same as original")


class MasterResponse(BaseModel):
    """Master record response."""

    id: str
    content_id: str
    platform: str
    photo_id: str
    collection: Optional[str]
    title: Optional[str]
    body: str
    tags: list[str]
    provenance: Optional[str]
    skus: list[dict]
    approved_at: str
    last_reused: Optional[str]
    reuse_count: int
    performance_score: float
    created_at: str


class ListMastersResponse(BaseModel):
    """Response for list endpoints."""

    items: list[MasterResponse]
    total: int


class ReuseCandidate(BaseModel):
    """A content master eligible for reposting."""

    id: str
    content_id: str
    platform: str
    photo_id: str
    title: Optional[str]
    body: str
    reuse_count: int
    last_reused: Optional[str]
    performance_score: float


class StatsResponse(BaseModel):
    """Library statistics response."""

    total_masters: int
    by_platform: dict[str, int]
    total_reuses: int
    average_performance_score: float


def _master_to_response(master: ContentMaster) -> MasterResponse:
    """Convert ContentMaster to API response model."""
    return MasterResponse(
        id=master.id,
        content_id=master.content_id,
        platform=master.platform,
        photo_id=master.photo_id,
        collection=master.collection,
        title=master.title,
        body=master.body,
        tags=master.get_tags(),
        provenance=master.provenance,
        skus=master.get_skus(),
        approved_at=master.approved_at,
        last_reused=master.last_reused,
        reuse_count=master.reuse_count,
        performance_score=master.performance_score,
        created_at=master.created_at,
    )


# ── Routes ───────────────────────────────────────────────────────────


@router.post("")
def create_master(req: SaveMasterRequest) -> MasterResponse:
    """Save a new master content record.

    Master records are reusable, approved pieces of content that can be
    duplicated for variations, reposts, and cross-platform distribution.
    """
    library = _get_library()
    try:
        master = library.save_master(
            platform=req.platform,
            photo_id=req.photo_id,
            body=req.body,
            title=req.title,
            tags=req.tags,
            provenance=req.provenance,
            skus=req.skus,
            collection=req.collection,
            content_id=req.content_id,
        )
        return _master_to_response(master)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error saving master: {e}")
        raise HTTPException(status_code=500, detail="Failed to save master")
    finally:
        library.conn.close()


@router.get("")
def list_masters(
    platform: Optional[str] = None,
    collection: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
) -> ListMastersResponse:
    """List all master content records with optional filters.

    Args:
        platform: Filter by platform (pinterest, instagram, etsy, shopify).
        collection: Filter by collection name.
        limit: Max results (default 100, max 500).
        offset: Pagination offset (default 0).

    Returns:
        Paginated list of masters with total count.
    """
    library = _get_library()
    try:
        masters, total = library.list_masters(
            platform=platform, collection=collection, limit=limit, offset=offset
        )
        items = [_master_to_response(m) for m in masters]
        return ListMastersResponse(items=items, total=total)
    except Exception as e:
        logger.error(f"Error listing masters: {e}")
        raise HTTPException(status_code=500, detail="Failed to list masters")
    finally:
        library.conn.close()


@router.get("/search")
def search_masters(q: str = Query(..., min_length=2), limit: int = Query(default=100, le=500)) -> ListMastersResponse:
    """Full-text search across title, body, and tags.

    Args:
        q: Search query (minimum 2 characters).
        limit: Max results (default 100, max 500).

    Returns:
        List of matching masters.
    """
    library = _get_library()
    try:
        masters = library.search_masters(query=q, limit=limit)
        items = [_master_to_response(m) for m in masters]
        return ListMastersResponse(items=items, total=len(items))
    except Exception as e:
        logger.error(f"Error searching masters: {e}")
        raise HTTPException(status_code=500, detail="Failed to search masters")
    finally:
        library.conn.close()


@router.get("/{master_id}")
def get_master(master_id: str) -> MasterResponse:
    """Get a specific master record by ID.

    Args:
        master_id: ID of the master to retrieve.

    Returns:
        Full master record details.
    """
    library = _get_library()
    try:
        master = library.get_master(master_id)
        if not master:
            raise HTTPException(status_code=404, detail="Master not found")
        return _master_to_response(master)
    finally:
        library.conn.close()


@router.post("/{master_id}/duplicate")
def duplicate_master(master_id: str, req: DuplicateMasterRequest) -> MasterResponse:
    """Clone a master for variation on a different platform.

    Duplicating a master creates a new, independent record that can be
    modified without affecting the original.

    Args:
        master_id: ID of the master to clone.
        req: Request with optional new_platform.

    Returns:
        The newly created master record.
    """
    library = _get_library()
    try:
        new_master = library.duplicate_master(master_id, new_platform=req.new_platform)
        if not new_master:
            raise HTTPException(status_code=404, detail="Master not found")
        return _master_to_response(new_master)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error duplicating master: {e}")
        raise HTTPException(status_code=500, detail="Failed to duplicate master")
    finally:
        library.conn.close()


@router.get("/photo/{photo_id}/variations")
def get_variations(photo_id: str) -> dict[str, list[MasterResponse]]:
    """Get all content variations for a photo across platforms.

    Args:
        photo_id: Photo ID to find variations for.

    Returns:
        Dict mapping platform name to list of masters.
    """
    library = _get_library()
    try:
        variations = library.get_variations(photo_id)
        return {
            platform: [_master_to_response(m) for m in masters]
            for platform, masters in variations.items()
        }
    except Exception as e:
        logger.error(f"Error getting variations: {e}")
        raise HTTPException(status_code=500, detail="Failed to get variations")
    finally:
        library.conn.close()


@router.get("/reuse/candidates")
def get_reuse_candidates(
    cooldown: int = Query(default=30, ge=1, le=365),
) -> list[ReuseCandidate]:
    """Find masters eligible for reposting (cooldown period elapsed).

    Masters are eligible for reuse after a cooldown period from their
    last reuse. Default cooldown is 30 days. This prevents the same
    content from being reposted too frequently.

    Args:
        cooldown: Cooldown period in days (default 30, range 1-365).

    Returns:
        List of eligible reuse candidates sorted by performance.
    """
    library = _get_library()
    try:
        candidates = library.get_reuse_candidates(cooldown_days=cooldown)
        return [
            ReuseCandidate(
                id=m.id,
                content_id=m.content_id,
                platform=m.platform,
                photo_id=m.photo_id,
                title=m.title,
                body=m.body,
                reuse_count=m.reuse_count,
                last_reused=m.last_reused,
                performance_score=m.performance_score,
            )
            for m in candidates
        ]
    except Exception as e:
        logger.error(f"Error getting reuse candidates: {e}")
        raise HTTPException(status_code=500, detail="Failed to get reuse candidates")
    finally:
        library.conn.close()


@router.post("/{master_id}/reuse")
def mark_reused(master_id: str) -> dict[str, Any]:
    """Mark a master as reused and update timestamp and count.

    When content is reposted, call this endpoint to track the reuse.
    This updates last_reused timestamp and increments reuse_count.

    Args:
        master_id: ID of the master being reused.

    Returns:
        Status dict with success and updated counts.
    """
    library = _get_library()
    try:
        success = library.mark_reused(master_id)
        if not success:
            raise HTTPException(status_code=404, detail="Master not found")

        # Fetch updated master
        updated = library.get_master(master_id)
        return {
            "success": True,
            "last_reused": updated.last_reused,
            "reuse_count": updated.reuse_count,
        }
    except Exception as e:
        logger.error(f"Error marking master as reused: {e}")
        raise HTTPException(status_code=500, detail="Failed to mark master as reused")
    finally:
        library.conn.close()


@router.put("/{master_id}/performance")
def update_performance(master_id: str, score: float = Query(..., ge=0, le=100)) -> dict[str, Any]:
    """Update the performance score for a master.

    Performance scores track how well content has performed (0-100).
    Use this to record engagement metrics, click-through rates, or
    other success indicators.

    Args:
        master_id: ID of the master.
        score: Performance score (0.0 - 100.0).

    Returns:
        Status dict with updated score.
    """
    library = _get_library()
    try:
        success = library.update_performance(master_id, score)
        if not success:
            raise HTTPException(status_code=404, detail="Master not found")

        updated = library.get_master(master_id)
        return {"success": True, "performance_score": updated.performance_score}
    except Exception as e:
        logger.error(f"Error updating performance: {e}")
        raise HTTPException(status_code=500, detail="Failed to update performance")
    finally:
        library.conn.close()


@router.get("/{master_id}/export")
def export_master(master_id: str, format: str = Query(default="json", pattern="^json$")) -> dict[str, str]:
    """Export a master record as JSON for backup or transfer.

    Returns the master as JSON suitable for backup to R2 or external storage.

    Args:
        master_id: ID of the master to export.
        format: Export format (currently only 'json' supported).

    Returns:
        Dict with format and json_data keys.
    """
    library = _get_library()
    try:
        json_str = library.export_master(master_id, format=format)
        if not json_str:
            raise HTTPException(status_code=404, detail="Master not found")

        return {
            "format": format,
            "json_data": json_str,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error exporting master: {e}")
        raise HTTPException(status_code=500, detail="Failed to export master")
    finally:
        library.conn.close()


@router.get("/stats")
def library_stats() -> StatsResponse:
    """Get aggregate statistics about the content library.

    Returns counts, platform breakdown, reuse metrics, and performance averages.

    Returns:
        Statistics dict with library metrics.
    """
    library = _get_library()
    try:
        stats = library.get_stats()
        return StatsResponse(
            total_masters=stats["total_masters"],
            by_platform=stats["by_platform"],
            total_reuses=stats["total_reuses"],
            average_performance_score=stats["average_performance_score"],
        )
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to get stats")
    finally:
        library.conn.close()
