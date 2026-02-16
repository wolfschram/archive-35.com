# CLAUDE.md — Archive-35 AI Agent System

> **Read this file completely before doing anything.**
> This governs all work in this folder.
> Last updated: 2026-02-16

---

## PROJECT OVERVIEW

**Archive-35** is an AI-powered automation system for a fine art photography print business.
- **Operator:** Wolf — solo developer, VP of Engineering (25+ years), ADHD/dyslexia
- **Brand:** "The Restless Eye" — fine art photography from 55+ countries
- **Goal:** Automate content generation, social media posting, marketplace listings
- **Revenue channels:** Etsy (open editions), Shopify (limited editions), licensing (B2B)
- **Architecture version:** v3.1 (simplified from v3 based on LLM adversarial review)

---

## 🚨 EXECUTION RULES — CRITICAL

### Rule 1: ONE TASK AT A TIME
- Work on exactly **one task** from the build tracker (below).
- Do NOT combine tasks or scope-creep.
- When a task is complete, update `docs/BUILD_TRACKER.md` and STOP.
- Ask Wolf which task to do next, or follow the priority order if running overnight.

### Rule 2: SMALL FILES, COMPLETE MODULES
- Every Python file should be **under 300 lines**.
- If a module grows past 300 lines, split it.
- Every file must have: docstring, type hints, error handling.
- Every module must be independently testable.

### Rule 3: TEST BEFORE MOVING ON
- Write a test for every module you create.
- Run the test. If it fails, fix it before moving to the next task.
- Tests go in `tests/` mirroring the `src/` structure.

### Rule 4: NO PREMATURE COMPLEXITY
These are **BANNED** in Phase 1:
- ❌ LangGraph (use plain Python + cron)
- ❌ Saga Engine (just log errors and retry)
- ❌ Mem0 / vector memory (edit prompts manually)
- ❌ Firecrawl / Research Agent (manual keywords for now)
- ❌ Multi-container Docker (single container)
- ❌ Kubernetes, Terraform, or any infra-as-code beyond Docker Compose

### Rule 5: COMMIT MESSAGES
Format: `[component] short description`
Examples:
- `[safety] add idempotency ledger with SQLite backend`
- `[content] caption generator for Pinterest pins`
- `[telegram] approval bot with approve/reject/defer buttons`

### Rule 6: CONTEXT PRESERVATION
- After completing a task, write a **2-3 line summary** to `docs/SESSION_LOG.md`
- Include: what was built, what was tested, what's next
- This is how the next session (or overnight run) knows where to pick up

---

## FOLDER STRUCTURE

```
archive-35/
├── CLAUDE.md                    ← YOU ARE HERE. Master instructions.
├── .env.example                 ← Template for all API keys and config
├── .env                         ← Actual config (NEVER commit, gitignored)
├── pyproject.toml               ← Python project config (uv)
├── uv.lock                      ← Dependency lockfile
├── Dockerfile                   ← Single-container Phase 1 build
├── docker-compose.yml           ← Docker Compose for local dev
├── README.md                    ← Project readme
│
├── docs/
│   ├── ARCHITECTURE.md          ← System architecture (v3.1)
│   ├── DEPENDENCIES.md          ← Component dependency map
│   ├── BUILD_TRACKER.md         ← Task checklist with status
│   ├── SESSION_LOG.md           ← Running log of completed work
│   ├── COST_MODEL.md            ← Unit economics and monthly costs
│   ├── COGS_TABLE.md            ← Per-SKU cost of goods (update with real numbers)
│   └── BRAND_VOICE.md           ← Content Agent tone/style guide
│
├── src/
│   ├── __init__.py
│   ├── config.py                ← pydantic-settings, .env loader, fail-fast validation
│   ├── db.py                    ← SQLite connection, WAL mode, schema init
│   ├── models.py                ← Pydantic models for all data types
│   │
│   ├── safety/
│   │   ├── __init__.py
│   │   ├── ledger.py            ← Idempotency ledger (side-effect dedup)
│   │   ├── rate_limiter.py      ← Per-API rate limiting with budget caps
│   │   ├── audit.py             ← Audit log (every action, every cost)
│   │   └── kill_switch.py       ← Global + per-platform emergency stop
│   │
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── vision.py            ← Photo analysis via Claude Batch API
│   │   ├── content.py           ← Caption/description/tag generation
│   │   └── social.py            ← Late API posting with idempotency
│   │
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── daily.py             ← Main daily pipeline (cron entry point)
│   │   ├── import_photos.py     ← Photo import + hash + resize for API
│   │   └── scheduler.py         ← Huey task definitions + cron schedules
│   │
│   ├── telegram/
│   │   ├── __init__.py
│   │   ├── bot.py               ← aiogram bot setup + webhook
│   │   ├── handlers.py          ← Approve/reject/edit/defer handlers
│   │   └── queue.py             ← Approval queue with 48h expiry
│   │
│   ├── platforms/
│   │   ├── __init__.py
│   │   ├── etsy.py              ← Listing package generator (paste-ready)
│   │   └── shopify.py           ← Shopify API client (Phase 2, stub only)
│   │
│   └── brand/
│       ├── __init__.py
│       ├── provenance.py        ← Auto-generate story from photo metadata
│       ├── sku.py               ← SKU generator + COGS lookup
│       └── greatest_hits.py     ← Auto-rotation of approved content
│
├── tests/
│   ├── __init__.py
│   ├── test_safety/
│   │   ├── test_ledger.py
│   │   ├── test_rate_limiter.py
│   │   └── test_kill_switch.py
│   ├── test_agents/
│   │   ├── test_vision.py
│   │   └── test_content.py
│   └── test_pipeline/
│       └── test_daily.py
│
├── scripts/
│   ├── init_db.py               ← Create all SQLite tables
│   ├── import_batch.py          ← Bulk import photos from a directory
│   └── generate_listing.py      ← CLI: generate Etsy listing for one photo
│
└── data/
    ├── photos/                  ← Imported photo metadata (not the photos themselves)
    ├── content/                 ← Generated content awaiting approval
    ├── approved/                ← Approved content ready to post
    └── archive35.db             ← SQLite database
```

---

## TECHNOLOGY STACK

| Category | Technology | Version | Why |
|----------|-----------|---------|-----|
| Language | Python | 3.12+ | AI ecosystem, fast prototyping |
| Package manager | uv | latest | 10-100x faster than pip |
| AI | Claude API (Anthropic) | latest | Haiku for vision batch, Sonnet for content |
| Task queue | Huey | 2.5+ | SQLite backend, cron, retry logic |
| Database | SQLite + WAL | 3.45+ | Zero config, sufficient for solo operator |
| Telegram bot | aiogram | 3.x | Async, inline keyboards, webhooks |
| Social posting | Late API | v1 | 13 platforms, one integration |
| Containerization | Docker + Compose | latest | Single container for Phase 1 |
| Print-on-demand | Printful / Prodigi | API v2 | Zero inventory fulfillment |

---

## DATABASE SCHEMA

```sql
-- Core tables (created by scripts/init_db.py)

CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,           -- SHA256 of file content
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    exif_json TEXT,                -- Raw EXIF as JSON
    collection TEXT,              -- e.g., "ICE", "TOK", "LON"
    vision_tags TEXT,             -- JSON array from Vision Agent
    vision_mood TEXT,
    vision_composition TEXT,
    vision_analyzed_at TEXT,
    marketability_score INTEGER   -- 1-10 from Vision Agent
);

CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY,          -- UUID
    photo_id TEXT NOT NULL REFERENCES photos(id),
    platform TEXT NOT NULL,       -- "pinterest", "instagram", "etsy"
    content_type TEXT NOT NULL,   -- "caption", "description", "listing"
    body TEXT NOT NULL,           -- The generated content
    tags TEXT,                    -- JSON array
    variant INTEGER DEFAULT 1,   -- Which variant (1, 2, 3)
    status TEXT DEFAULT 'pending', -- pending, approved, rejected, expired
    created_at TEXT NOT NULL,
    approved_at TEXT,
    posted_at TEXT,
    expires_at TEXT,              -- 48h from creation
    provenance TEXT               -- Brand proof story
);

CREATE TABLE IF NOT EXISTS actions_ledger (
    id TEXT PRIMARY KEY,          -- UUID
    action_hash TEXT UNIQUE NOT NULL, -- SHA256(action_type + target + content)
    action_type TEXT NOT NULL,    -- "post", "list", "email"
    target TEXT NOT NULL,         -- Platform + ID
    content_id TEXT REFERENCES content(id),
    status TEXT DEFAULT 'pending', -- pending, executed, failed, rolled_back
    created_at TEXT NOT NULL,
    executed_at TEXT,
    cost_usd REAL DEFAULT 0,
    error TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
    api_name TEXT PRIMARY KEY,
    calls_today INTEGER DEFAULT 0,
    cost_today_usd REAL DEFAULT 0,
    daily_call_limit INTEGER NOT NULL,
    daily_cost_limit_usd REAL NOT NULL,
    last_reset TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    component TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,                 -- JSON
    cost_usd REAL DEFAULT 0,
    success INTEGER DEFAULT 1    -- 0 = failed
);

CREATE TABLE IF NOT EXISTS kill_switch (
    scope TEXT PRIMARY KEY,       -- "global", "pinterest", "instagram", etc.
    active INTEGER DEFAULT 0,
    activated_at TEXT,
    activated_by TEXT,
    reason TEXT
);

CREATE TABLE IF NOT EXISTS sku_catalog (
    sku TEXT PRIMARY KEY,         -- e.g., "A35-ICE-0042-16R-HAH-OE"
    photo_id TEXT REFERENCES photos(id),
    collection TEXT NOT NULL,
    size_code TEXT NOT NULL,
    paper_code TEXT NOT NULL,
    edition_type TEXT NOT NULL,   -- "OE" or "LE"
    edition_total INTEGER,        -- NULL for OE, number for LE
    edition_sold INTEGER DEFAULT 0,
    base_cost_usd REAL NOT NULL,  -- POD cost from COGS table
    min_price_usd REAL NOT NULL,  -- Floor price (cost + fees + margin)
    list_price_usd REAL NOT NULL, -- Actual listing price
    active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS greatest_hits (
    id TEXT PRIMARY KEY,
    content_id TEXT REFERENCES content(id),
    platform TEXT NOT NULL,
    times_posted INTEGER DEFAULT 1,
    last_posted_at TEXT,
    performance_score REAL,       -- Engagement metric (if trackable)
    eligible INTEGER DEFAULT 1    -- Can it be reposted?
);
```

---

## API KEYS NEEDED (.env)

```bash
# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=your_chat_id

# Late API (social posting)
LATE_API_KEY=...

# Etsy (when approved — Phase 2)
ETSY_API_KEY=...
ETSY_API_SECRET=...

# Shopify (Phase 2)
SHOPIFY_STORE_URL=...
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...

# Printful
PRINTFUL_API_KEY=...

# General
DAILY_BUDGET_USD=5.00
PHOTO_IMPORT_DIR=/path/to/photos
LOG_LEVEL=INFO
DB_PATH=data/archive35.db
```

---

## OVERNIGHT BUILD INSTRUCTIONS

If Wolf says "run the build overnight" or "work through the task list":

1. Read `docs/BUILD_TRACKER.md` — find the first unchecked task
2. Execute that task following the rules above
3. Run tests for that task
4. Update `docs/BUILD_TRACKER.md` (check it off)
5. Write a summary to `docs/SESSION_LOG.md`
6. Move to the next unchecked task
7. Repeat until all tasks are done or you hit a blocker
8. If you hit a blocker: log it in `docs/SESSION_LOG.md`, skip to the next non-blocked task

**IMPORTANT FOR OVERNIGHT RUNS:**
- Do NOT ask questions. Make reasonable decisions and document them.
- If unsure between two approaches, pick the simpler one.
- If a test fails after 3 attempts, log the failure and move on.
- If you need an API key that's not set, create a stub/mock and move on.
- Save all work frequently. Do not batch large changes.

---

## WHAT SUCCESS LOOKS LIKE

Phase 1 is complete when:
- [ ] `python -m src.pipeline.daily` runs the full daily cycle
- [ ] Photos can be imported and analyzed by Claude Vision
- [ ] Content is generated for Pinterest + Instagram + Etsy
- [ ] Telegram bot sends approval requests with buttons
- [ ] Approved content posts via Late API
- [ ] Etsy listing packages are generated (paste-ready)
- [ ] Safety layer prevents duplicate actions
- [ ] Kill switch stops all agents
- [ ] Greatest Hits mode can auto-rotate approved content
- [ ] All tests pass
