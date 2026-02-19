"""Archive-35 Content Master File Storage module.

Manages reusable master records of approved content. Every piece of approved
content is stored as a master record for future reuse. Art is timeless —
content created weeks ago can be repurposed for new variations and postings.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def _utc_now() -> str:
    """Return current UTC timestamp as ISO string."""
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    """Generate a new UUID4 string."""
    return str(uuid4())


class ContentMaster(BaseModel):
    """A master record of approved, reusable content."""

    id: str = Field(..., description="Content master ID")
    content_id: str = Field(..., description="Original content ID")
    platform: str = Field(..., description="Platform: pinterest, instagram, etsy, shopify")
    photo_id: str = Field(..., description="Photo this content references")
    collection: Optional[str] = None
    title: Optional[str] = None
    body: str = Field(..., description="Main content body")
    tags: Optional[str] = None  # JSON array
    provenance: Optional[str] = None  # Human readable: "Approved by Wolf, 2026-02-15"
    skus: Optional[str] = None  # JSON array of SKU objects
    approved_at: str = Field(default_factory=_utc_now)
    last_reused: Optional[str] = None
    reuse_count: int = Field(default=0, ge=0)
    performance_score: float = Field(default=0.0, ge=0.0, le=100.0)
    created_at: str = Field(default_factory=_utc_now)

    def get_tags(self) -> list[str]:
        """Parse tags JSON string into a list."""
        if not self.tags:
            return []
        try:
            return json.loads(self.tags)
        except (json.JSONDecodeError, TypeError):
            return []

    def get_skus(self) -> list[dict]:
        """Parse skus JSON string into a list of dicts."""
        if not self.skus:
            return []
        try:
            return json.loads(self.skus)
        except (json.JSONDecodeError, TypeError):
            return []

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict for JSON export."""
        return {
            "id": self.id,
            "content_id": self.content_id,
            "platform": self.platform,
            "photo_id": self.photo_id,
            "collection": self.collection,
            "title": self.title,
            "body": self.body,
            "tags": self.get_tags(),
            "provenance": self.provenance,
            "skus": self.get_skus(),
            "approved_at": self.approved_at,
            "last_reused": self.last_reused,
            "reuse_count": self.reuse_count,
            "performance_score": self.performance_score,
            "created_at": self.created_at,
        }


class ContentLibrary:
    """Master content library for Archive-35 reusable content.

    Stores approved content as master records for future variations, reposts,
    and cross-platform distribution. Tracks reuse history and performance.
    """

    def __init__(self, db_conn: sqlite3.Connection):
        """Initialize with a database connection.

        Args:
            db_conn: Active SQLite connection.
        """
        self.conn = db_conn
        self._init_schema()

    def _init_schema(self) -> None:
        """Create content_masters table if it doesn't exist."""
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS content_masters (
                id TEXT PRIMARY KEY,
                content_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                photo_id TEXT NOT NULL,
                collection TEXT,
                title TEXT,
                body TEXT NOT NULL,
                tags TEXT,
                provenance TEXT,
                skus TEXT,
                approved_at TEXT NOT NULL,
                last_reused TEXT,
                reuse_count INTEGER DEFAULT 0,
                performance_score REAL DEFAULT 0.0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(content_id, platform)
            )
            """
        )
        # Create index for faster searches
        self.conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_masters_photo_id
            ON content_masters(photo_id)
            """
        )
        self.conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_masters_platform
            ON content_masters(platform)
            """
        )
        self.conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_content_masters_approved_at
            ON content_masters(approved_at)
            """
        )
        self.conn.commit()

    def save_master(
        self,
        platform: str,
        photo_id: str,
        body: str,
        title: Optional[str] = None,
        tags: Optional[list[str]] = None,
        provenance: Optional[str] = None,
        skus: Optional[list[dict]] = None,
        collection: Optional[str] = None,
        content_id: Optional[str] = None,
    ) -> ContentMaster:
        """Save approved content as a master record.

        Args:
            platform: Target platform (pinterest, instagram, etsy, shopify).
            photo_id: ID of the photo this content references.
            body: Main content body text.
            title: Optional title/headline for the content.
            tags: Optional list of tags for searchability.
            provenance: Optional human-readable approval note.
            skus: Optional list of related SKU objects.
            collection: Optional collection name.
            content_id: Optional original content ID. Auto-generated if not provided.

        Returns:
            ContentMaster: The saved master record.

        Raises:
            sqlite3.IntegrityError: If content_id + platform already exists.
        """
        master_id = _uuid()
        content_id = content_id or _uuid()
        now = _utc_now()

        tags_json = json.dumps(tags) if tags else None
        skus_json = json.dumps(skus) if skus else None

        self.conn.execute(
            """
            INSERT INTO content_masters
            (id, content_id, platform, photo_id, collection, title, body,
             tags, provenance, skus, approved_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                master_id,
                content_id,
                platform,
                photo_id,
                collection,
                title,
                body,
                tags_json,
                provenance,
                skus_json,
                now,
                now,
            ),
        )
        self.conn.commit()

        return ContentMaster(
            id=master_id,
            content_id=content_id,
            platform=platform,
            photo_id=photo_id,
            collection=collection,
            title=title,
            body=body,
            tags=tags_json,
            provenance=provenance,
            skus=skus_json,
            approved_at=now,
            created_at=now,
        )

    def get_master(self, master_id: str) -> Optional[ContentMaster]:
        """Retrieve a single master record by ID.

        Args:
            master_id: ID of the master record to fetch.

        Returns:
            ContentMaster if found, None otherwise.
        """
        row = self.conn.execute(
            "SELECT * FROM content_masters WHERE id = ?", (master_id,)
        ).fetchone()

        if not row:
            return None

        return ContentMaster(**dict(row))

    def list_masters(
        self,
        platform: Optional[str] = None,
        collection: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[ContentMaster], int]:
        """List master records with optional filters.

        Args:
            platform: Filter by platform (optional).
            collection: Filter by collection (optional).
            limit: Max results to return (default 100, max 500).
            offset: Pagination offset (default 0).

        Returns:
            Tuple of (list of ContentMaster, total count).
        """
        limit = min(limit, 500)
        conditions, params = [], []

        if platform:
            conditions.append("platform = ?")
            params.append(platform)
        if collection:
            conditions.append("collection = ?")
            params.append(collection)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        # Get total count
        count_query = f"SELECT COUNT(*) as cnt FROM content_masters {where}"
        total = self.conn.execute(count_query, params).fetchone()["cnt"]

        # Get paginated results
        params.extend([limit, offset])
        query = (
            f"SELECT * FROM content_masters {where} "
            f"ORDER BY approved_at DESC LIMIT ? OFFSET ?"
        )
        rows = self.conn.execute(query, params).fetchall()

        masters = [ContentMaster(**dict(r)) for r in rows]
        return masters, total

    def search_masters(self, query: str, limit: int = 100) -> list[ContentMaster]:
        """Full-text search across title, body, and tags.

        Args:
            query: Search query string.
            limit: Max results to return (default 100, max 500).

        Returns:
            List of matching ContentMaster records.
        """
        limit = min(limit, 500)
        search_term = f"%{query}%"

        rows = self.conn.execute(
            """
            SELECT * FROM content_masters
            WHERE title LIKE ? OR body LIKE ? OR tags LIKE ?
            ORDER BY approved_at DESC
            LIMIT ?
            """,
            (search_term, search_term, search_term, limit),
        ).fetchall()

        return [ContentMaster(**dict(r)) for r in rows]

    def duplicate_master(
        self, master_id: str, new_platform: Optional[str] = None
    ) -> Optional[ContentMaster]:
        """Clone a master record for variation on a different platform.

        Args:
            master_id: ID of the master to clone.
            new_platform: Optional new platform. If not provided, uses same as original.

        Returns:
            New ContentMaster if successful, None if original not found.
        """
        original = self.get_master(master_id)
        if not original:
            return None

        # Create a new variation
        return self.save_master(
            platform=new_platform or original.platform,
            photo_id=original.photo_id,
            body=original.body,
            title=original.title,
            tags=original.get_tags() or None,
            provenance=f"Duplicated from {master_id}; {original.provenance or ''}".strip(),
            skus=original.get_skus() or None,
            collection=original.collection,
        )

    def get_variations(self, photo_id: str) -> dict[str, list[ContentMaster]]:
        """Get all content variations for a photo across platforms.

        Args:
            photo_id: Photo ID to search for.

        Returns:
            Dict mapping platform name to list of ContentMaster records.
        """
        rows = self.conn.execute(
            "SELECT * FROM content_masters WHERE photo_id = ? ORDER BY platform, approved_at DESC",
            (photo_id,),
        ).fetchall()

        result: dict[str, list[ContentMaster]] = {}
        for row in rows:
            master = ContentMaster(**dict(row))
            platform = master.platform
            if platform not in result:
                result[platform] = []
            result[platform].append(master)

        return result

    def get_reuse_candidates(self, cooldown_days: int = 30) -> list[ContentMaster]:
        """Find masters eligible for reposting (last_reused > cooldown_days ago).

        Args:
            cooldown_days: Minimum days since last reuse. Default 30.

        Returns:
            List of eligible ContentMaster records.
        """
        cutoff_time = (
            datetime.now(timezone.utc) - timedelta(days=cooldown_days)
        ).isoformat()

        rows = self.conn.execute(
            """
            SELECT * FROM content_masters
            WHERE last_reused IS NULL OR last_reused < ?
            ORDER BY reuse_count DESC, approved_at DESC
            """,
            (cutoff_time,),
        ).fetchall()

        return [ContentMaster(**dict(r)) for r in rows]

    def mark_reused(self, master_id: str) -> bool:
        """Update last_reused timestamp and increment reuse_count.

        Args:
            master_id: ID of the master being reused.

        Returns:
            True if updated, False if master not found.
        """
        now = _utc_now()
        cursor = self.conn.execute(
            """
            UPDATE content_masters
            SET last_reused = ?, reuse_count = reuse_count + 1
            WHERE id = ?
            """,
            (now, master_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def update_performance(self, master_id: str, score: float) -> bool:
        """Update performance score for a master.

        Args:
            master_id: ID of the master.
            score: Performance score (0.0 - 100.0).

        Returns:
            True if updated, False if master not found.
        """
        score = max(0.0, min(100.0, score))  # Clamp to 0-100
        cursor = self.conn.execute(
            "UPDATE content_masters SET performance_score = ? WHERE id = ?",
            (score, master_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def export_master(self, master_id: str, format: str = "json") -> Optional[str]:
        """Export a master record to JSON string.

        Args:
            master_id: ID of the master to export.
            format: Export format (currently only 'json' supported).

        Returns:
            JSON string if found, None otherwise.
        """
        master = self.get_master(master_id)
        if not master:
            return None

        if format == "json":
            return json.dumps(master.to_dict(), indent=2)

        raise ValueError(f"Unsupported format: {format}")

    def delete_master(self, master_id: str) -> bool:
        """Delete a master record (use with caution).

        Args:
            master_id: ID of the master to delete.

        Returns:
            True if deleted, False if not found.
        """
        cursor = self.conn.execute("DELETE FROM content_masters WHERE id = ?", (master_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def get_stats(self) -> dict[str, Any]:
        """Get aggregate statistics about the content library.

        Returns:
            Dict with counts and metrics.
        """
        total = self.conn.execute(
            "SELECT COUNT(*) as cnt FROM content_masters"
        ).fetchone()["cnt"]

        by_platform = self.conn.execute(
            """
            SELECT platform, COUNT(*) as cnt
            FROM content_masters
            GROUP BY platform
            ORDER BY cnt DESC
            """
        ).fetchall()

        total_reuses = self.conn.execute(
            "SELECT SUM(reuse_count) as total FROM content_masters"
        ).fetchone()["total"] or 0

        avg_performance = self.conn.execute(
            "SELECT AVG(performance_score) as avg FROM content_masters"
        ).fetchone()["avg"] or 0.0

        return {
            "total_masters": total,
            "by_platform": {r["platform"]: r["cnt"] for r in by_platform},
            "total_reuses": total_reuses,
            "average_performance_score": round(avg_performance, 2),
        }
