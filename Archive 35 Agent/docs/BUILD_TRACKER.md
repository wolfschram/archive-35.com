# Archive-35 Build Tracker

> Coworker: Work through these in order. Check off when complete + tested.
> If blocked, skip to next non-blocked task and note the blocker.

---

## Phase 1 Build Tasks

### Foundation (Priority: P0 — Do First)

- [x] **T01: Project scaffolding** ✅
  - Create `pyproject.toml` with all dependencies (anthropic, aiogram, huey, pydantic-settings, httpx, pillow)
  - Create `.env.example` with all required keys documented
  - Create `src/__init__.py` and all subpackage `__init__.py` files
  - Run `uv sync` to verify all deps install
  - **Test:** `uv run python -c "import anthropic; import aiogram; print('OK')"`

- [x] **T02: Config module** ✅
  - Create `src/config.py` using pydantic-settings
  - Load all .env values with type validation
  - Fail fast with clear error on missing required values
  - **Test:** `tests/test_config.py` — test valid config, test missing key raises error

- [x] **T03: Database module**
  - Create `src/db.py` — SQLite connection with WAL mode
  - Create `scripts/init_db.py` — run all CREATE TABLE statements from CLAUDE.md schema
  - **Test:** `tests/test_db.py` — create tables, insert row, read back, verify WAL mode

- [x] **T04: Pydantic models**
  - Create `src/models.py` — Photo, Content, Action, AuditEntry, SKU, RateLimit
  - All models match SQLite schema
  - **Test:** `tests/test_models.py` — create instance, serialize to dict, validate types

### Safety Layer (Priority: P0)

- [x] **T05: Idempotency ledger**
  - Create `src/safety/ledger.py`
  - Hash-based dedup: `can_execute(action_type, target, content) → bool`
  - `record_action(...)` after successful execution
  - **Test:** Same action returns False on second call

- [x] **T06: Rate limiter**
  - Create `src/safety/rate_limiter.py`
  - Per-API daily call count + daily cost tracking
  - `check_limit(api_name) → bool` / `record_usage(api_name, cost)`
  - Auto-reset at midnight
  - **Test:** Hit limit, verify blocked, verify reset

- [x] **T07: Audit logger**
  - Create `src/safety/audit.py`
  - `log(component, action, details, cost)` — writes to audit_log table
  - Non-blocking (buffer if DB unavailable)
  - **Test:** Log 10 entries, query back, verify all present

- [x] **T08: Kill switch**
  - Create `src/safety/kill_switch.py`
  - `is_active(scope="global") → bool`
  - `activate(scope, reason)` / `deactivate(scope)`
  - Check global first, then per-platform
  - **Test:** Activate global, verify all scopes blocked. Activate "pinterest" only, verify others unblocked.

### Intelligence Layer (Priority: P0)

- [x] **T09: Photo importer**
  - Create `src/pipeline/import_photos.py`
  - Scan directory, hash files, skip duplicates (ledger check)
  - Resize to 1024px longest edge (Pillow)
  - Extract EXIF to JSON
  - Store in photos table
  - **Test:** Import 3 test photos, verify dedup on re-import

- [x] **T10: Vision Agent**
  - Create `src/agents/vision.py`
  - Send photo to Claude Haiku API (single or batch)
  - Structured output: tags, mood, composition, marketability_score
  - Cache results (never re-analyze same hash)
  - Rate limit + audit log integration
  - **Test:** Mock Claude API response, verify parsing + storage
  - **Needs:** ANTHROPIC_API_KEY in .env (or mock for testing)

- [x] **T11: Content Agent**
  - Create `src/agents/content.py`
  - Input: photo metadata + vision tags + brand provenance
  - Output: platform-specific content (Pinterest, Instagram, Etsy)
  - Generate 2-3 variants per platform
  - Set expires_at = now + 48h
  - Rate limit + audit log integration
  - **Test:** Mock Claude API, verify content structure per platform

### Brand Layer (Priority: P1)

- [x] **T12: Provenance generator**
  - Create `src/brand/provenance.py`
  - Input: EXIF data (GPS, date, camera) + collection name
  - Output: 2-3 sentence story for Brand Proof Layer
  - Uses a story bank JSON (tour memories, location context)
  - **Test:** Feed sample EXIF, verify story output is non-empty

- [x] **T13: SKU generator + COGS**
  - Create `src/brand/sku.py`
  - Generate SKU from photo + size + paper + edition
  - Lookup COGS from `docs/COGS_TABLE.md` (parsed at startup)
  - Calculate min price floor (COGS + fees + 40% margin)
  - **Test:** Generate SKU, verify format, verify price floor math

- [x] **T14: Greatest Hits manager**
  - Create `src/brand/greatest_hits.py`
  - Track approved content that performed well
  - `get_repost_candidates(platform, count) → List[Content]`
  - Respect minimum days between reposts (configurable, default 14)
  - **Test:** Add 5 items, mark 2 as high-performing, verify selection

### Action Layer (Priority: P0)

- [x] **T15: Social posting agent**
  - Create `src/agents/social.py`
  - Late API client: post to Pinterest, Instagram
  - Idempotency check before every post
  - Randomized posting times within window
  - Retry with exponential backoff
  - Rate limit + audit log integration
  - **Test:** Mock Late API, verify idempotency prevents double-post

- [x] **T16: Etsy listing packager**
  - Create `src/platforms/etsy.py`
  - Input: content from Content Agent
  - Output: formatted listing package (title, 13 tags, description, price, category)
  - Save to `data/content/etsy_listings/` as markdown files
  - **Test:** Generate listing, verify tag count = 13, verify price ≥ floor

### Telegram Bot (Priority: P0)

- [x] **T17: Bot setup + webhook**
  - Create `src/telegram/bot.py`
  - aiogram 3.x bot initialization
  - Webhook or polling mode (configurable)
  - `/status` command: show system health
  - `/kill` command: activate global kill switch
  - `/resume` command: deactivate kill switch
  - **Test:** Bot starts, responds to /status (polling mode for tests)

- [x] **T18: Approval handlers**
  - Create `src/telegram/handlers.py`
  - Inline keyboard: Approve / Edit / Reject / Defer
  - Approve → update content status, move to posting queue
  - Edit → prompt for corrections, regenerate
  - Reject → log with reason
  - Defer → re-queue for tomorrow
  - **Test:** Simulate button press, verify status changes

- [x] **T19: Approval queue + expiry**
  - Create `src/telegram/queue.py`
  - Bundle pending content into Telegram messages
  - 48h expiry: auto-expire unapproved content
  - Queue size management (max 15 items per batch)
  - **Test:** Create content, wait (mock time), verify expiry

### Pipeline Integration (Priority: P0)

- [x] **T20: Daily pipeline**
  - Create `src/pipeline/daily.py`
  - Orchestrates: kill check → import → vision → content → telegram queue
  - Entry point: `python -m src.pipeline.daily`
  - Error handling: any agent failure logged + skipped, pipeline continues
  - **Test:** Full pipeline with mocked APIs, verify end-to-end flow

- [x] **T21: Scheduler**
  - Create `src/pipeline/scheduler.py`
  - Huey task definitions
  - Cron: daily pipeline at 06:00, posting at 10:00/14:00/18:00, summary at 20:00
  - Expiry check every hour
  - **Test:** Verify task registration, verify cron schedule parsing

### Containerization (Priority: P1)

- [x] **T22: Dockerfile**
  - Single-stage Python 3.12 image
  - Install uv + project deps
  - Copy src/ and scripts/
  - Entrypoint: Huey consumer + Telegram bot
  - Health check endpoint
  - **Test:** `docker build` succeeds, container starts, /status responds

- [x] **T23: Docker Compose**
  - Single service (archive35) with all components
  - Volume mount for data/ (persistent)
  - .env file loading
  - Restart policy: unless-stopped
  - **Test:** `docker compose up` runs full system

### Documentation (Priority: P1)

- [x] **T24: Brand voice guide**
  - Create `docs/BRAND_VOICE.md`
  - Tone, style, vocabulary for each platform
  - Example captions for Pinterest, Instagram, Etsy
  - Words to use / words to avoid
  - The Archive-35 story (touring photographer, ADHD, restless eye)

- [x] **T25: COGS table**
  - Create `docs/COGS_TABLE.md`
  - Placeholder values (update when test prints arrive)
  - Per-SKU: paper, size, POD cost, Etsy fees, shipping, min price
  - Machine-parseable format (markdown table)

---

## Completion Criteria

All tasks checked → Phase 1 is ready for soft launch.

**Estimated effort:** 20-25 tasks × 30-60 min each = 10-25 hours of Coworker time.

**Overnight strategy:** Tasks T01-T08 (foundation + safety) can run without any API keys.
Tasks T09-T11 need ANTHROPIC_API_KEY or mocks. Tasks T15 needs LATE_API_KEY or mocks.
Tasks T17-T19 need TELEGRAM_BOT_TOKEN or mocks.
