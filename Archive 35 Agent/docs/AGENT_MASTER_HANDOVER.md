# Archive-35 Agent — Master Handover Document
**Written: March 16, 2026 — Full repo audit via MCP**
**This is the single source of truth for what this project is, what exists, and what to build next.**

---

## WHAT THIS PROJECT IS

This is the **Archive-35 Autonomous Sales Agent** — a Python-based AI system that:
- Generates and uploads listings to Etsy (31 packages ready, 1,109 photos in archive)
- Posts to Instagram 3x/day via Later API (built, needs wiring)
- Manages the full pipeline from raw photo → watermark → mockup → listing → sale
- Lives inside the larger `archive-35.com` monorepo at `/Archive 35 Agent/`

**Owner:** Wolf Schram | wolf@archive-35.com | The Restless Eye
**Revenue goal:** First sale by end of week (March 21, 2026)

---

## WHERE EVERYTHING LIVES

### Repository
- **GitHub:** https://github.com/wolfschram/archive-35.com
- **Current branch:** `claude/job-pipeline-v2-5x9f7`
- **Main branch:** `main` (production — website is live)
- **Agent folder:** `/Archive 35 Agent/` inside the monorepo

### Key directories
```
archive-35/
├── Archive 35 Agent/          ← THE AGENT (you are here)
│   ├── CLAUDE.md              ← LAW. Read before anything.
│   ├── src/
│   │   ├── api.py             ← FastAPI server, port 8035
│   │   ├── agents/
│   │   │   ├── etsy_agent.py      ← Listing restructure orchestrator
│   │   │   ├── etsy_copywriter.py ← Claude Vision copy generation
│   │   │   ├── etsy_pricing.py    ← Pictorem pricing table
│   │   │   ├── etsy_uploader.py   ← Image upload + listing create
│   │   │   ├── content.py         ← Content generation
│   │   │   ├── social.py          ← Instagram/Later API posting
│   │   │   └── vision.py          ← Claude Vision wrapper
│   │   ├── integrations/
│   │   │   ├── etsy.py            ← Etsy API v3 client (OAuth, CRUD)
│   │   │   ├── instagram.py       ← Later API client
│   │   │   ├── mockup_service.py  ← Mockup service client (port 8036)
│   │   │   └── r2_upload.py       ← Cloudflare R2 client
│   │   ├── brand/
│   │   │   └── watermark.py       ← ARCHIVE|35 banner on photos
│   │   ├── safety/                ← Kill switch, rate limiter, audit log
│   │   └── pipeline/              ← Daily pipeline, scheduler
│   ├── docs/
│   │   ├── BUILD_TRACKER.md       ← Task checklist
│   │   ├── LISTING_REWRITE_BRIEF.md  ← Brand voice + story bank
│   │   ├── PARALLEL_SPRINT_BRIEF.md  ← Track A + B architecture
│   │   └── SESSION_LOG.md            ← Running work log
│   └── data/
│       └── archive35.db           ← SQLite database
│
├── 01_Portfolio/              ← 1,109 original photos by collection
│   └── {collection}/
│       ├── originals/         ← Full-res RAW source files
│       └── web/               ← {filename}-full.jpg + {filename}-thumb.jpg
│
├── 06_Automation/
│   └── etsy-export/           ← 31 READY-TO-UPLOAD listing packages
│       └── {nn}-{collection}-{title}/
│           ├── listing.json   ← Title, description, tags, variations, image order
│           ├── 01-mockup-*.jpg    ← Room scene image 1
│           ├── 02-mockup-*.jpg    ← Room scene image 2
│           ├── ...                ← More room scenes
│           └── 0N-original-*.jpg  ← Original photo (last in listing.json)
│
├── mockups/                   ← Pre-generated room mockups
│   └── iceland/               ← 24 Iceland photos, 10 mockups each = 239 files
│       └── {photo_id}/
│           └── {photo_id}-{room}-etsy.jpg
│
└── mockup-service/            ← Node.js mockup compositor, port 8036
    └── src/server.js
```

---

## PORT MAP — DO NOT CONFLICT

| Service | Port | Start command |
|---|---|---|
| Archive-35 Agent (Python FastAPI) | **8035** | `python3 src/api.py` |
| Mockup service (Node.js) | **8036** | `cd mockup-service && npm start` |
| Studio (Electron/React) | **3001** | `cd 05_Studio/app && npm run dev` |
| Job pipeline (SEPARATE project) | **3000** | Never touch from here |

---

## WHAT'S ALREADY BUILT AND WORKING

### ✅ Done and tested
- Etsy OAuth 2.0 token refresh (`ensure_valid_token()`)
- Etsy scope check (`listings_r` ✅, `transactions_r` ✅, `listings_w` untested)
- Etsy pricing table with verified Pictorem PRO costs
- Claude Vision SEO copy generation for listings
- Watermark system (`src/brand/watermark.py`)
- Safety layer: kill switch, rate limiter, audit logger, idempotency ledger
- Instagram Later API integration (built, not yet wired to scheduler)
- Telegram approval bot (built — bypassed with `AUTO_APPROVE=true`)
- Full SQLite schema with WAL mode
- Docker + Docker Compose

### 🔲 What Claude Code is currently working on
- Rewriting descriptions in etsy-export/ packages with brand voice from LISTING_REWRITE_BRIEF.md
- Building `etsy_uploader.py` to upload images + create listings
- This is the direct path to first sale

### 🔲 Not yet built (next up)
- T28: Instagram auto-posting wired to scheduler (3x/day)
- T29: AUTO_APPROVE bypass flag for Telegram
- T30: Agent dashboard (Cloudflare Worker, accessible from browser)
- Track B: Autonomous mockup generation for all 1,109 photos

---

## THE 31 READY-TO-UPLOAD PACKAGES

These are in `06_Automation/etsy-export/`. Each has everything needed to create an Etsy listing.

**Priority order for upload (highest Etsy demand first):**
1. `01-antelope-canyon-*` — slot canyon photography (top Etsy search)
2. `02-antelope-canyon-*` — second antelope canyon image
3. `27-31 tanzania-*` — 5 Tanzania wildlife images (elephant, zebra, giraffe)
4. `15-grand-teton-*` — Grand Teton winter landscape
5. `04,05,06,07 black-and-white-*` — B&W series (elephant storm, beach, giraffe, shipwreck)
6. `32-iceland-*` — Iceland (only 1 package but 24 Iceland photos in /mockups/ ready)
7. All others

**What each listing.json contains:**
- `title` — needs rewriting with LISTING_REWRITE_BRIEF.md brand voice
- `description` — needs rewriting (currently generic AI filler)
- `tags` — 13 tags (check against brief, may need updating)
- `variations` — full pricing matrix: Paper/Canvas/Wood/Metal/Acrylic × 5 sizes (DO NOT CHANGE)
- `images` — ordered list of mockup files + original
- `base_price` — starting price shown in search results

**Image order correction (confirmed by Wolf):**
- Image 1 = original photo WITH watermark applied via `src/brand/watermark.py`
- Images 2-6 = room mockups in listing.json order
- Mockups do NOT get watermarked

---

## THE DESCRIPTION REWRITE RULES

Full brand voice in `docs/LISTING_REWRITE_BRIEF.md`. Summary:

**Template:**
```
[ONE LINE: the moment, present tense, no adjectives]

FREE SHIPPING — Ships free across North America and Canada. Arrives ready to hang. No frame needed.

[THE MOMENT: 2-3 sentences. Specific place, light, atmosphere.]

[THE STORY: 2-3 sentences matching Wolf's real life stories to the subject.]

Printed on ChromaLuxe HD Metal — white gloss aluminum. Colors appear luminous, almost backlit.
Deep blacks. Glowing highlights. 60+ year archival rating.
Standoff brackets float the print off your wall. Arrives ready to hang.

[SIZE] | Free shipping North America & Canada | 100% satisfaction guarantee.

Wolf Schram | The Restless Eye | 25 years, 55 countries.
```

**STORY BANK — match to image subject:**
- Tanzania/Africa/Wildlife → Mother's birthplace story (Kilimanjaro, grandfather's coffee farm, 2017)
- Iceland → The light, the waterfalls, the landscape still being assembled
- Hawaii/Volcano → Standing at the edge of active lava, ground being made in real time
- NYC/Urban → 2008 camera store, bought first camera, something clicked
- Venice/Italy → Touring years, getting lost in Venice before tourists arrive
- Desert/Southwest → White Sands alone, drove before sunrise, shadow in the dunes
- LA/California → Santa Ana winds, sky scoured clean, the light here is not subtle
- Architecture → Don't photograph buildings, photograph what they do to light
- Aviation/Industrial → 25 years of airports, 3am maintenance hangars

**SANITY CHECK — do not upload if description contains:**
- "Random Stuff" → fix before uploading
- "placeholder" → fix before uploading
- Subject mismatch (wolf/wildlife on non-wildlife image) → fix before uploading
- Generic phrases: "stunning", "perfect for your home", "beautiful" → rewrite

---

## CRITICAL RULES (from CLAUDE.md)

1. **ONE TASK AT A TIME** — complete, test, update BUILD_TRACKER.md, stop
2. **Files under 300 lines** — split if larger
3. **Test before moving on** — every module needs a test
4. **Run sync before any git push to website:** `python3 sync_gallery_data.py`
5. **Never touch:** Stripe, checkout, auth, email flows without Wolf
6. **Three-system rule:** shared data file changes = test Studio + Agent + Mockup
7. **Never fabricate URLs** — check docs/INFRASTRUCTURE.md first
8. **This is a live system** — real customers may be buying right now

---

## ENVIRONMENT VARIABLES NEEDED

```bash
# Check .env exists and has these:
ETSY_API_KEY=
ETSY_SHOP_ID=
ETSY_ACCESS_TOKEN=        # Refreshed March 2026 (was expired)
ETSY_REFRESH_TOKEN=
ETSY_TOKEN_EXPIRES=

INSTAGRAM_USER_ID=
INSTAGRAM_ACCESS_TOKEN=   # Expires 2026-04-20 (valid)

ANTHROPIC_API_KEY=        # For Claude Vision copy generation

PICTOREM_API_KEY=         # Available, confirmed by Wolf

CLOUDFLARE_ACCOUNT_ID=b7491e0a2209add17e1f4307eb77c991
CLOUDFLARE_R2_BUCKET=

AUTO_APPROVE=true         # Bypasses Telegram approval queue
DASHBOARD_PASSWORD=       # For agent dashboard
```

---

## GITHUB — WHAT NEEDS TO HAPPEN

**Current state:**
- Branch: `claude/job-pipeline-v2-5x9f7`
- All agent work is on this branch
- New files (etsy_agent.py, etsy_copywriter.py, etc.) are untracked (??)
- The branch has not been merged to main

**What Claude Code should do:**
1. Commit all current untracked agent files with message: `[agent] Phase 2 Etsy upload pipeline — T26-T27 complete`
2. Continue building on this branch
3. Do NOT merge to main — main is the live website
4. A separate PR to main will be done when the agent is fully tested

**Commit message format:** `[component] description`
Examples:
- `[etsy] listing uploader with watermark + image order`
- `[instagram] wire Later API to scheduler`
- `[dashboard] Cloudflare Worker agent status page`

---

## DASHBOARD — WHAT'S NEEDED

Wolf wants a web UI accessible from any browser (not just local).

**Location:** Cloudflare Worker at `agent.archive-35.com` or `agent.athos-obs.com`
**Auth:** Password gate (env var `DASHBOARD_PASSWORD`)

**Must show:**
- Agent status (running/paused/error) with last heartbeat
- Etsy: total listings live, listings created today, last listing title
- Instagram: posts today, last post image thumbnail
- Sales: any new Etsy orders (poll every 30min)
- Log: last 50 agent actions scrollable
- Emergency stop button (triggers kill switch)

**This is T30 in BUILD_TRACKER.md. Build after T28 (Instagram) and T29 (AUTO_APPROVE).**

---

## WHERE TO START RIGHT NOW

```bash
# 1. Read the law
cat /Users/wolfgangschram/Documents/ACTIVE/archive-35/Archive\ 35\ Agent/CLAUDE.md

# 2. Check current task status
cat /Users/wolfgangschram/Documents/ACTIVE/archive-35/Archive\ 35\ Agent/docs/BUILD_TRACKER.md

# 3. Check Etsy token
curl http://localhost:8035/etsy/oauth/scope-check

# 4. Look at the first listing package to upload
cat /Users/wolfgangschram/Documents/ACTIVE/archive-35/06_Automation/etsy-export/01-antelope-canyon-antelope-canyon-photography-print-slot/listing.json

# 5. Commit what's already built
cd /Users/wolfgangschram/Documents/ACTIVE/archive-35
git add "Archive 35 Agent/"
git commit -m "[agent] Phase 2 Etsy pipeline — pricing, copywriter, uploader scaffolding"
git push
```

---

## THE ONE THING THAT MATTERS THIS WEEK

Get the 31 listing packages uploaded to Etsy with rewritten descriptions.
Tanzania elephant with the mother/Kilimanjaro story is the most likely first sale.
Antelope Canyon is the highest search volume.

Instagram posting live is the traffic driver.

Dashboard is how Wolf watches it happen from his phone.

**First sale by Friday. That's the mission.**

---
*Written March 16, 2026 — full MCP audit of live repo*
*Next session: read CLAUDE.md + this file + BUILD_TRACKER.md in that order*
