# Archive-35 Parallel Sprint Brief
**Written: March 16, 2026**
**Goal: First sale by Friday + autonomous pipeline for all 1,109 photos**

Run BOTH tracks simultaneously. They do not depend on each other.

---

## TRACK A — This Week (Sale by Friday)
### Use what's already built. Ship immediately.

**What we have right now:**
- 24 Iceland photos with COMPLETE mockup sets in `/mockups/iceland/`
- Each photo has 10 room scene mockups already rendered: bedroom, gallery, hotel corridor,
  hotel lobby, living room, penthouse bedroom, penthouse luxury, restaurant
- File pattern: `mockups/iceland/{photo_id}/{photo_id}-{room}-etsy.jpg`
- 239 Etsy-ready JPGs sitting on disk doing nothing

**Iceland photos ready to list (all 24):**
wolf2970, wolf3043, wolf3044-pano, wolf3058, wolf3088, wolf3245, wolf3249,
wolf3710, wolf3753-edit, wolf3921-pano, wolf3979, wolf4122-edit, wolf4123-edit,
wolf4127-edit, wolf4324, wolf4389, wolf4419, wolf4427-pano, wolf4448-edit,
wolf4460-pano, wolf4530-pano, wolf4556, wolf4745-pano, wolf4838-pano

**For each Iceland photo — create one Etsy listing:**

1. Find the original web image:
   `01_Portfolio/iceland/web/{filename}-full.jpg`
   Match photo_id to filename via `data/photos.json` (field: `id` vs `filename`)

2. Apply watermark banner via `src/brand/watermark.py`:
   ```python
   from src.brand.watermark import add_banner
   etsy_main = add_banner('path/to/web/full.jpg', output_path)
   ```
   This produces the lead Etsy image with ARCHIVE|35 banner.

3. Collect room mockup images for the listing (use these 5 as listing photos 2-6):
   - `{photo_id}-living-room-modern-etsy.jpg`
   - `{photo_id}-bedroom-standard-etsy.jpg`
   - `{photo_id}-gallery-white-etsy.jpg`
   - `{photo_id}-penthouse-luxury-etsy.jpg`
   - `{photo_id}-hotel-lobby-etsy.jpg`

4. Run Claude Vision on the original to generate:
   - Title (SEO, 140 chars max)
   - Description (use LISTING_REWRITE_BRIEF.md brand voice + Iceland story)
   - 13 tags

5. Detect orientation from image dimensions in `data/photos.json`

6. Create Etsy listing via API:
   - Material & Size variants (existing system — do NOT change)
   - Lead image = watermarked original
   - Images 2-6 = room mockups
   - Free shipping North America & Canada
   - Status: active

7. Log listing_id + photo_id to `data/etsy_listings.json`

**Target: All 24 Iceland photos listed by Wednesday.**
Iceland is the #1 searched landscape photography category on Etsy.
24 new listings = 24 more chances to be found before Friday.

---

## TRACK B — Autonomous Pipeline (builds in parallel)
### For all 1,109 photos across all 48 collections

**The gap:** Only Iceland has mockups. All other 1,085 photos need:
1. Watermark applied
2. Mockups generated via mockup-service (port 8036)
3. Then same listing flow as Track A

**Architecture for Track B agent:**

### Step 1 — Inventory what needs processing
```python
# For each collection in 01_Portfolio/:
# Check if mockups/{collection}/{photo_id}/ exists
# If not -> add to processing queue
# Priority order:
priority_collections = [
    'antelope-canyon',   # Top Etsy search category
    'tanzania',          # Unique story, high emotion
    'grand-teton',       # Iconic US landscape
    'cuba',              # Rare on Etsy, gap in market
    'black-and-white',   # Timeless, cross-demographic
    'death-valley',
    'los-angeles',
    'new-york',
    'argentina',
    'south-africa',
    # ... then all remaining collections
]
```

### Step 2 — Watermark pipeline
```python
from src.brand.watermark import add_banner

# Input:  01_Portfolio/{collection}/web/{filename}-full.jpg
# Output: data/processed/{collection}/{photo_id}-watermarked.jpg
# Temp:   data/processing_queue/{photo_id}.json (status tracking)
```

### Step 3 — Mockup generation via mockup-service
The mockup-service runs on port 8036. Use `POST /composite/batch`:

```python
import httpx

# Check service is running first
health = httpx.get('http://localhost:8036/health')

# Generate batch mockups for one photo
batch_payload = {
    'photos': [{
        'id': photo_id,
        'path': f'01_Portfolio/{collection}/web/{filename}-full.jpg',
        'collection': collection
    }],
    'templates': [
        'living-room-modern',
        'bedroom-standard',
        'gallery-white',
        'penthouse-luxury',
        'hotel-lobby'
    ],
    'output_dir': f'mockups/{collection}/{photo_id}',
    'format': 'etsy'  # generates -{room}-etsy.jpg files
}
response = httpx.post('http://localhost:8036/composite/batch', json=batch_payload)
job_id = response.json()['job_id']

# Poll for completion
while True:
    status = httpx.get(f'http://localhost:8036/composite/status/{job_id}').json()
    if status['status'] == 'complete': break
    time.sleep(2)
```

**CRITICAL:** Check `mockup-service/CONSTRAINTS.md` and `LESSONS_LEARNED.md`
before making API calls. Port 8036 must be running.
Start with: `cd mockup-service && npm start`

### Step 4 — After mockups generated, same as Track A
Watermark → mockups ready → create Etsy listing → log to etsy_listings.json

### Step 5 — Rate limiting
- Etsy API: max 10 listing creates per minute
- Mockup service: process one photo at a time, don't batch too many
- Claude Vision: max 50 calls per run
- Add 2 second sleep between Etsy API calls

---

## SHARED: New file to create — `src/agents/listing_publisher.py`

This is the shared engine used by both tracks.

```python
"""
listing_publisher.py — Creates Etsy listings from processed photo assets.

Input:
    photo_id: str           — e.g. 'wolf3058'
    collection: str         — e.g. 'iceland'
    watermarked_path: str   — path to watermarked lead image
    mockup_paths: list[str] — paths to room mockup images (2-6)
    photo_metadata: dict    — from data/photos.json

Output:
    etsy_listing_id: str    — created listing ID
    logged to: data/etsy_listings.json

Process:
    1. Claude Vision generates title/description/tags
    2. Detect orientation from metadata
    3. Upload images to Etsy (lead + mockups)
    4. Create listing with full metadata
    5. Activate listing
    6. Log result
"""
```

---

## DATABASE — Add to D1 schema

```sql
CREATE TABLE IF NOT EXISTS processed_photos (
    photo_id TEXT PRIMARY KEY,
    collection TEXT,
    watermark_done BOOLEAN DEFAULT 0,
    mockups_done BOOLEAN DEFAULT 0,
    etsy_listing_id TEXT,
    etsy_listed_at TEXT,
    vision_title TEXT,
    vision_tags TEXT,
    status TEXT DEFAULT 'pending',  -- pending/processing/listed/error
    error_msg TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## WHAT NOT TO TOUCH

- Do NOT modify mockup-service internals
- Do NOT change compositor.js or templates.js
- Do NOT change existing Etsy listings that are already live
- Do NOT restart the mockup-service during a batch run
- Read `mockup-service/CONSTRAINTS.md` before any mockup API call
- Check `CLAUDE.md` in root before any changes
- Three-system rule: changes to shared data files = test Studio + Agent + Mockup

---

## SUCCESS METRICS

**By Wednesday:**
- All 24 Iceland photos listed on Etsy with watermarked lead image + 5 room mockups
- Track B pipeline scaffolded and processing first collection (antelope-canyon)

**By Friday:**
- 50+ total listings live on Etsy
- Instagram posting 3x/day with Iceland + existing shop images
- At least 1 sale

---

## START HERE — First commands for Claude Code

```bash
# 1. Verify mockup-service has Iceland mockups
ls /Users/wolfgangschram/Documents/ACTIVE/archive-35/mockups/iceland/ | wc -l
# Should show 24

# 2. Check one photo has all mockups
ls /Users/wolfgangschram/Documents/ACTIVE/archive-35/mockups/iceland/wolf3058/
# Should show 20 files (10 rooms x 2 versions each)

# 3. Check watermark module works
cd /Users/wolfgangschram/Documents/ACTIVE/archive-35
python3 -c "from src.brand.watermark import add_banner; print('watermark OK')"

# 4. Check mockup-service is running
curl http://localhost:8036/health
# If not running: cd mockup-service && npm start

# 5. Check Etsy token is valid
curl http://localhost:8035/etsy/oauth/scope-check
# If expired: POST /etsy/oauth/refresh

# 6. Run first Track A listing (dry run)
curl -X POST http://localhost:8035/etsy/restructure?dry_run=true
```

*Brief written March 16, 2026 — based on live repo audit via MCP*
