"""Google Sheets webhook integration for Archive-35 Agent.

Logs Agent activities to the shared Google Sheet via Apps Script webhook.
Mirrors the production website's logging pattern (stripe-webhook.js).

The Google Apps Script webhook (google-sheets-order-log.js) creates rows in:
  - "Agent" tab: Content approvals, posts, pipeline runs, API costs, errors
  - Uses the same GOOGLE_SHEET_WEBHOOK_URL env var as the main site

Queues events and batches posts every 60s or when 10 events accumulate
to avoid hammering the webhook endpoint.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

try:
    import httpx
except ImportError:
    httpx = None

logger = logging.getLogger(__name__)


class GoogleSheetsLogger:
    """Queue and batch-post Agent events to Google Sheets webhook.

    Methods:
        log_content_approved: Log when content (post) is approved by moderator
        log_content_posted: Log when content is published to platform
        log_pipeline_run: Log daily pipeline execution metrics
        log_api_cost: Log API spend (Claude, vision models, etc.)
        log_error: Log errors for monitoring and debugging
        flush: Force queue flush (used by background task)
    """

    def __init__(self, webhook_url: Optional[str] = None, batch_size: int = 10):
        """Initialize logger.

        Args:
            webhook_url: Google Apps Script webhook URL. Falls back to
                env var GOOGLE_SHEET_WEBHOOK_URL if not provided.
            batch_size: Flush queue after this many events (default: 10).
        """
        self.webhook_url = webhook_url or os.getenv("GOOGLE_SHEET_WEBHOOK_URL")
        self.batch_size = batch_size
        self.queue: list[dict] = []
        self.lock = asyncio.Lock()

        if not self.webhook_url:
            logger.warning(
                "GoogleSheetsLogger: GOOGLE_SHEET_WEBHOOK_URL not set. "
                "Events will be queued but NOT posted."
            )

    async def log_content_approved(
        self,
        content_id: str,
        platform: str,
        title: str,
        photo_id: str,
        approved_at: Optional[str] = None,
    ) -> None:
        """Log content approval event.

        Args:
            content_id: Unique identifier for the content piece.
            platform: Target platform (e.g., "pinterest", "instagram").
            title: Content title or caption.
            photo_id: Photo ID from gallery data.
            approved_at: ISO timestamp. Defaults to now.
        """
        await self._enqueue(
            {
                "eventType": "content_approved",
                "contentId": content_id,
                "platform": platform,
                "title": title,
                "photoId": photo_id,
                "approvedAt": approved_at or datetime.now(timezone.utc).isoformat(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def log_content_posted(
        self,
        content_id: str,
        platform: str,
        title: str,
        photo_id: str,
        posted_at: Optional[str] = None,
        post_url: Optional[str] = None,
    ) -> None:
        """Log content post event.

        Args:
            content_id: Unique identifier for the content piece.
            platform: Platform name (e.g., "pinterest", "instagram").
            title: Content title or caption.
            photo_id: Photo ID from gallery data.
            posted_at: ISO timestamp. Defaults to now.
            post_url: Direct URL to the posted content (optional).
        """
        await self._enqueue(
            {
                "eventType": "content_posted",
                "contentId": content_id,
                "platform": platform,
                "title": title,
                "photoId": photo_id,
                "postedAt": posted_at or datetime.now(timezone.utc).isoformat(),
                "postUrl": post_url,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def log_pipeline_run(
        self,
        run_id: str,
        status: str,
        photos_processed: int,
        content_generated: int,
        cost_usd: float,
        duration_secs: float,
    ) -> None:
        """Log daily pipeline execution.

        Args:
            run_id: Unique pipeline run ID.
            status: "success", "partial", or "failed".
            photos_processed: Number of photos analyzed.
            content_generated: Number of content pieces created.
            cost_usd: Total API cost in USD.
            duration_secs: Execution duration in seconds.
        """
        await self._enqueue(
            {
                "eventType": "pipeline_run",
                "runId": run_id,
                "status": status,
                "photosProcessed": photos_processed,
                "contentGenerated": content_generated,
                "costUsd": round(cost_usd, 4),
                "durationSecs": round(duration_secs, 2),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def log_api_cost(
        self,
        date: str,
        component: str,
        calls: int,
        cost_usd: float,
    ) -> None:
        """Log API spend tracking.

        Args:
            date: ISO date (YYYY-MM-DD).
            component: API component (e.g., "claude_vision", "pinterest_api").
            calls: Number of API calls.
            cost_usd: Cost for this component.
        """
        await self._enqueue(
            {
                "eventType": "api_cost",
                "date": date,
                "component": component,
                "calls": calls,
                "costUsd": round(cost_usd, 4),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def log_error(
        self,
        component: str,
        error_message: str,
        severity: str = "error",
    ) -> None:
        """Log errors for monitoring.

        Args:
            component: System component where error occurred.
            error_message: Error description.
            severity: "warning", "error", or "critical".
        """
        await self._enqueue(
            {
                "eventType": "error",
                "component": component,
                "errorMessage": error_message,
                "severity": severity,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def _enqueue(self, event: dict) -> None:
        """Add event to queue and flush if threshold reached."""
        async with self.lock:
            self.queue.append(event)
            if len(self.queue) >= self.batch_size:
                await self._flush_unsafe()

    async def flush(self) -> int:
        """Force queue flush. Returns number of events posted."""
        async with self.lock:
            return await self._flush_unsafe()

    async def _flush_unsafe(self) -> int:
        """POST queued events to webhook (assumes lock held).

        Returns number of events successfully posted (0 on skip/failure).
        """
        if not self.queue:
            return 0

        if not self.webhook_url:
            logger.debug(
                "GoogleSheetsLogger: webhook not configured, discarding %d events",
                len(self.queue),
            )
            self.queue.clear()
            return 0

        events = self.queue.copy()
        self.queue.clear()

        if httpx is None:
            logger.error("httpx not installed. Install it to enable Google Sheets logging.")
            return 0

        for attempt in range(3):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        self.webhook_url,
                        json={"events": events},
                        timeout=10.0,
                    )
                    if response.status_code == 200:
                        logger.debug(
                            "GoogleSheetsLogger: posted %d events (attempt %d)",
                            len(events),
                            attempt + 1,
                        )
                        return len(events)
                    else:
                        logger.warning(
                            "GoogleSheetsLogger: webhook returned %d (attempt %d)",
                            response.status_code,
                            attempt + 1,
                        )
            except Exception as e:
                logger.warning(
                    "GoogleSheetsLogger: post failed (attempt %d): %s",
                    attempt + 1,
                    str(e),
                )
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                continue

        logger.error("GoogleSheetsLogger: failed to post %d events after 3 retries", len(events))
        return 0
