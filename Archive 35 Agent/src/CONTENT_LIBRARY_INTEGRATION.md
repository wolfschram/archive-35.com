# Content Library Integration Guide

## Overview

The `content_library.py` module provides a master file storage system for Archive-35 content. Every approved piece of content is stored as a reusable master record that can be duplicated, searched, and reposted across platforms.

**Key Principle**: Art is timeless — content created weeks ago can be repurposed for new variations and postings.

## Files Created

- `/src/content_library.py` — Core library class and models (290 lines)
- `/src/api_content_library.py` — FastAPI router with REST endpoints (380 lines)

## Integration Steps

### 1. Add to Your API

In `src/api.py`, after the imports, add:

```python
from src.api_content_library import router as library_router

# ... existing middleware and route setup ...

# Include content library routes
app.include_router(library_router, prefix="/library", tags=["content-library"])
```

### 2. Database Schema

The schema is automatically created when `ContentLibrary(conn)` is initialized. The `content_masters` table will be created with proper indexes on:
- `photo_id` — for fetching variations
- `platform` — for platform-specific queries
- `approved_at` — for chronological sorting

## API Endpoints

All endpoints are prefixed with `/library`:

### Create Master
```
POST /library
{
  "platform": "pinterest",
  "photo_id": "photo-123",
  "body": "Beautiful sunset...",
  "title": "Mountain Sunset",
  "tags": ["sunset", "mountains"],
  "provenance": "Approved by Wolf",
  "collection": "landscapes"
}
```

### List Masters
```
GET /library?platform=pinterest&collection=landscapes&limit=50&offset=0
```

### Search Masters
```
GET /library/search?q=sunset&limit=100
```

### Get Single Master
```
GET /library/{master_id}
```

### Duplicate for Variation
```
POST /library/{master_id}/duplicate
{
  "new_platform": "instagram"
}
```

### Get All Variations of a Photo
```
GET /library/photo/{photo_id}/variations
```

Response:
```json
{
  "pinterest": [...masters...],
  "instagram": [...masters...],
  "etsy": [...masters...]
}
```

### Find Reuse Candidates
```
GET /library/reuse/candidates?cooldown=30
```

Returns masters where `last_reused` is older than 30 days (or NULL).

### Mark as Reused
```
POST /library/{master_id}/reuse
```

Updates `last_reused` timestamp and increments `reuse_count`.

### Update Performance Score
```
PUT /library/{master_id}/performance?score=85.5
```

Track engagement metrics, click rates, etc. Scores are 0-100.

### Export as JSON
```
GET /library/{master_id}/export?format=json
```

Returns:
```json
{
  "format": "json",
  "json_data": "{...full master as JSON...}"
}
```

Suitable for backup to R2 or external storage.

### Library Statistics
```
GET /library/stats
```

Returns:
```json
{
  "total_masters": 245,
  "by_platform": {
    "pinterest": 98,
    "instagram": 87,
    "etsy": 60
  },
  "total_reuses": 1203,
  "average_performance_score": 72.5
}
```

## Usage Examples

### Save Approved Content as Master

When content is approved in the workflow:

```python
from src.db import get_initialized_connection
from src.content_library import ContentLibrary

conn = get_initialized_connection()
library = ContentLibrary(conn)

# Save from approved content
master = library.save_master(
    platform=content.platform,
    photo_id=content.photo_id,
    body=content.body,
    title=get_content_title(content),  # You generate this
    tags=content.get_tags(),
    provenance=f"Approved by Wolf, {datetime.now().strftime('%Y-%m-%d')}",
    skus=get_related_skus(content.photo_id),
)
```

### Find Content for Reposting

```python
# Find masters eligible for reposting
candidates = library.get_reuse_candidates(cooldown_days=30)

for master in candidates:
    # Repost to platform
    post_to_platform(master.platform, master.body, master.photo_id)

    # Mark as reused
    library.mark_reused(master.id)
```

### Create Platform Variations

```python
# Original Pinterest master
original = library.get_master(master_id)

# Create Instagram variation (different caption length, hashtags)
instagram_version = library.duplicate_master(master_id, new_platform="instagram")

# Modify the Instagram version in your UI before posting
# (The duplicate starts with the same content but is independent)
```

### Track Content Performance

After posting content and measuring engagement:

```python
# Get engagement metrics (you implement this)
engagement_score = measure_engagement(master.photo_id, master.platform)

# Update performance in library
library.update_performance(master.id, score=engagement_score)

# Use for ranking when selecting reuse candidates
candidates = library.get_reuse_candidates(cooldown_days=30)
top_performers = sorted(candidates, key=lambda m: m.performance_score, desc=True)
```

## Database Schema

```sql
CREATE TABLE content_masters (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    collection TEXT,
    title TEXT,
    body TEXT NOT NULL,
    tags TEXT,              -- JSON array
    provenance TEXT,        -- "Approved by Wolf, 2026-02-15"
    skus TEXT,              -- JSON array
    approved_at TEXT NOT NULL,
    last_reused TEXT,       -- ISO timestamp or NULL
    reuse_count INTEGER DEFAULT 0,
    performance_score REAL DEFAULT 0.0,
    created_at TEXT NOT NULL,
    UNIQUE(content_id, platform)  -- Can't duplicate same content + platform
);

CREATE INDEX idx_content_masters_photo_id ON content_masters(photo_id);
CREATE INDEX idx_content_masters_platform ON content_masters(platform);
CREATE INDEX idx_content_masters_approved_at ON content_masters(approved_at);
```

## Design Notes

### Why Separate from `content` Table?

The existing `content` table tracks content through the approval workflow (pending → approved → posted). The `content_masters` table stores **only approved, finalized content** as reusable masters.

- `content` table: Workflow state, variants, approvals
- `content_masters` table: Reusable masters for distribution

### Reuse Tracking

- `reuse_count`: How many times this master has been reused
- `last_reused`: Timestamp of the most recent reuse
- `cooldown_days`: Prevents the same content from being reposted too frequently

Example: A master with `last_reused=2026-02-01` becomes eligible for reuse on 2026-03-02 (with 30-day cooldown).

### Performance Scoring

Store engagement metrics as normalized scores (0-100):
- 0-20: Poor engagement
- 20-40: Below average
- 40-60: Average
- 60-80: Good
- 80-100: Excellent

Use `get_reuse_candidates()` with sorting to prioritize high-performing content.

### Provenance Tracking

The `provenance` field is human-readable, e.g.:
- "Approved by Wolf, 2026-02-15"
- "Duplicated from master-456"
- "Edited for Instagram, 2026-02-16"

This provides an audit trail without complex versioning.

## Performance Considerations

- All queries use indexed lookups (`photo_id`, `platform`, `approved_at`)
- `search_masters()` uses LIKE pattern matching on `title`, `body`, `tags`
- For large datasets (10k+ masters), consider adding fulltext search (FTS5)
- WAL mode (inherited from parent connection) allows concurrent reads

## Example Workflow

1. **Content Generation** → Agent creates captions, titles
2. **Approval** → Wolf approves in UI
3. **Master Creation** → `POST /library` saves approved content
4. **Platform Variations** → `POST /library/{id}/duplicate` for Instagram, Etsy versions
5. **Distribution** → Post to platforms using master content
6. **Reuse Tracking** → `POST /library/{id}/reuse` after posting
7. **Performance** → `PUT /library/{id}/performance` with engagement metrics
8. **Reposting** → Query `GET /library/reuse/candidates` to find candidates
9. **Backups** → `GET /library/{id}/export` for R2 archiving

## Testing

Quick test to verify integration:

```python
from src.db import get_initialized_connection
from src.content_library import ContentLibrary

conn = get_initialized_connection("data/archive35.db")
library = ContentLibrary(conn)

# Save a test master
master = library.save_master(
    platform="pinterest",
    photo_id="test-photo",
    body="Test content",
    title="Test",
)
print(f"Created master: {master.id}")

# Verify it exists
retrieved = library.get_master(master.id)
assert retrieved.body == "Test content"
print("✓ Retrieval works")

conn.close()
```

## Next Steps

1. Integrate the API router into `api.py`
2. Add content master creation to approval workflow
3. Create dashboard UI for browsing/searching masters
4. Build reposting scheduler using `get_reuse_candidates()`
5. Implement performance tracking from platform analytics
