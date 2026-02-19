# Google Sheets Integration

The `GoogleSheetsLogger` class posts Agent events to a shared Google Sheet via the same Apps Script webhook that the main site uses (`GOOGLE_SHEET_WEBHOOK_URL`).

## Quick Start

```python
from src.integrations import GoogleSheetsLogger
import asyncio

async def main():
    sheets = GoogleSheetsLogger()

    # Log a content post
    await sheets.log_content_posted(
        content_id="pin_abc123",
        platform="pinterest",
        title="Sunset over Grand Teton",
        photo_id="gt-001",
        post_url="https://pinterest.com/pin/123456"
    )

    # Ensure queued events are posted
    await sheets.flush()

asyncio.run(main())
```

## Features

### Batching
- Events are queued in memory and posted in batches
- Default batch size: 10 events
- Manual flush with `.flush()` to send immediately
- Configurable: `GoogleSheetsLogger(batch_size=20)`

### Retry Logic
- 3 attempts with exponential backoff (2^n seconds)
- Non-blocking: failures log warnings but don't raise exceptions
- Recommended for asyncio pipelines where post failure shouldn't crash the agent

### Event Types

#### 1. Content Approval
```python
await sheets.log_content_approved(
    content_id="post_xyz789",
    platform="instagram",
    title="Mountain meadow wildflowers",
    photo_id="nz-042",
    approved_at="2026-02-19T15:30:00+00:00"  # Optional, defaults to now
)
```

#### 2. Content Posted
```python
await sheets.log_content_posted(
    content_id="post_xyz789",
    platform="instagram",
    title="Mountain meadow wildflowers",
    photo_id="nz-042",
    post_url="https://instagram.com/p/abc123",  # Optional
    posted_at="2026-02-19T15:35:00+00:00"  # Optional, defaults to now
)
```

#### 3. Pipeline Runs
```python
await sheets.log_pipeline_run(
    run_id="daily_2026-02-19",
    status="success",  # or "partial", "failed"
    photos_processed=42,
    content_generated=84,
    cost_usd=2.35,
    duration_secs=145.6
)
```

#### 4. API Cost Tracking
```python
await sheets.log_api_cost(
    date="2026-02-19",
    component="claude_vision",
    calls=150,
    cost_usd=1.50
)
```

#### 5. Error Logging
```python
await sheets.log_error(
    component="pinterest_api",
    error_message="Rate limit exceeded: 429 Too Many Requests",
    severity="warning"  # or "error", "critical"
)
```

## Integration with Audit System

The Agent already has a local audit log (`src/safety/audit.py`). This Google Sheets logger is **separate but complementary**.

### Pattern: Log locally, then post to Sheets

```python
from src.safety import audit
from src.integrations import GoogleSheetsLogger

# Log to local DB
audit.log(
    conn,
    component="content",
    action="post_pin",
    details={"platform": "pinterest", "photo_id": "gt-001"},
    cost_usd=0.05
)

# Also log to Google Sheets
sheets = GoogleSheetsLogger()
await sheets.log_content_posted(
    content_id="pin_abc123",
    platform="pinterest",
    title="Grand Teton Sunset",
    photo_id="gt-001"
)

# Later, flush all queued events
await sheets.flush()
```

## Configuration

### Environment Variable
```bash
export GOOGLE_SHEET_WEBHOOK_URL="https://script.google.com/macros/d/YOUR_DEPLOYMENT_ID/userweb"
```

If not set, the logger will queue events but not post them (logs a warning on init).

### Custom Batch Size
```python
sheets = GoogleSheetsLogger(batch_size=20)
```

## Background Task Pattern

For long-running pipelines, spawn a background task to flush every 60 seconds:

```python
import asyncio

async def background_flush(sheets, interval_secs=60):
    """Periodically flush Google Sheets queue."""
    while True:
        await asyncio.sleep(interval_secs)
        posted = await sheets.flush()
        if posted > 0:
            logger.info(f"Google Sheets: flushed {posted} events")

# In your main pipeline:
sheets = GoogleSheetsLogger()
flush_task = asyncio.create_task(background_flush(sheets))

try:
    # ... your main work ...
    await sheets.log_pipeline_run(...)
finally:
    await sheets.flush()  # Final flush before exit
    flush_task.cancel()
```

## Google Sheet Schema

The Apps Script webhook posts to these tabs (auto-created if missing):

### "Agent" Tab (for Agent-specific events)
| Date | Event Type | Content ID | Platform | Photo ID | Title | URL | Status | Cost USD | Notes |
|------|-----------|-----------|----------|----------|-------|-----|--------|----------|-------|
| 2026-02-19 15:30:00 | content_approved | post_xyz789 | instagram | nz-042 | Mountain meadow... | — | approved | 0.05 | — |
| 2026-02-19 15:35:00 | content_posted | post_xyz789 | instagram | nz-042 | Mountain meadow... | https://instagram.com/p/... | posted | — | — |

The existing tabs ("Orders", "Clients", "Signups", "Issues") remain unchanged.

## Error Handling

All methods are non-blocking. Failures:
- Are logged as warnings
- Don't raise exceptions
- Don't block the agent's main work
- Queued events are retried up to 3 times

Example log output:
```
WARNING: GoogleSheetsLogger: post failed (attempt 1): Connection timeout
WARNING: GoogleSheetsLogger: post failed (attempt 2): Connection timeout
ERROR: GoogleSheetsLogger: failed to post 5 events after 3 retries
```

## Dependencies

- `httpx` (async HTTP client) — should already be in Agent deps
- `asyncio` (standard library)

## Performance

- **Memory**: ~1KB per queued event
- **Latency**: <500ms to post batch (3-tuple timeout)
- **Network**: One POST per 10 events (batched)

For a 100-event pipeline: ~1 batch posted, ~500ms overhead.
