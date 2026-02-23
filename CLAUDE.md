# CLAUDE.md — Archive-35.com (Live Production Site)

> **Read this file completely before doing anything.**
> Last updated: 2026-02-23 (Code safety annotation system added)

---

## 🔴 SITE IS LIVE — PRODUCTION RULES

**Archive-35.com is LIVE. Real customers are browsing, signing up, and purchasing.**

Every change must be treated as a production deployment:

- **Test before pushing.** Health-check all critical pages after deploy (home, gallery, login, account, checkout flow)
- **Never break checkout.** Stripe integration, cart, and payment flow are revenue-critical
- **Never break auth.** Magic link login, sessions, and account pages must stay functional
- **Never break email.** Welcome emails, order confirmations, and Wolf notifications must keep flowing
- **Never break the Google Sheet webhook.** Order and signup logging is how Wolf tracks the business
- **Back up before major refactors.** If touching gallery.html, stripe-webhook.js, or send-magic-link.js — read the full file first
- **No experiments on main.** If something is risky, discuss with Wolf before pushing
- **Mobile matters.** Many visitors come from iPhone/Instagram links. Test mobile viewport behavior
- **Performance matters.** Gallery has CoverFlow animations — don't regress the idle-throttling or event listener cleanup
- **Self-test EVERY change.** After every commit+push, wait for Cloudflare deploy (~15-30s), then hard-refresh the live site in the browser and: (1) take a screenshot to visually verify, (2) check the browser console for JS errors, (3) test basic interactions (click, scroll, navigate). Never tell Wolf "it's deployed" without actually verifying it works. You have Chrome browser access — use it.

---

## Owner

**Wolf (Wolfgang Schram)** — Solo operator, photographer, VP of Engineering (25+ yrs broadcast/AV/enterprise)
- ADHD/dyslexia — keep answers short, scannable, clear visual hierarchy
- Bilingual German/English, prefers English responses
- Servant leadership philosophy
- Business email: wolf@archive-35.com (ALL business email goes here)
- Personal email: wolfbroadcast@gmail.com (Stripe account owner login only)

---

## Architecture

| Layer | Technology |
|-------|------------|
| Hosting | Cloudflare Pages (static + Functions) |
| Payments | Stripe (live mode) |
| Auth | Magic link via Resend email + Cloudflare KV |
| Email | Resend API (from orders@archive-35.com and wolf@archive-35.com) |
| Print Fulfillment | Pictorem (auto-submitted via API) |
| Order/Signup Logging | Google Sheets via Apps Script webhook |
| Analytics | GA4 + Cloudflare Web Analytics |
| DNS/CDN | Cloudflare |
| Repo | GitHub (wolfschram/archive-35.com) |

## Key KV Namespaces

| Binding | ID | Purpose |
|---------|----|---------|
| AUTH_SESSIONS | 77987ba99c464d468aba0ce357a6c7f2 | Login sessions (30-day TTL) |
| AUTH_MAGIC_LINKS | 61a70f5d48a24791bbee79121fbe5907 | Magic link tokens (15-min TTL) |

## Email Flow (All BCC'd to wolf@archive-35.com)

| Trigger | Customer Gets | Wolf Gets |
|---------|--------------|----------|
| New signup | Welcome email | [New Signup] notification + BCC of welcome |
| Magic link request | Login link email | — |
| Print purchase | Order confirmation | New Order notification + BCC of confirmation |
| License purchase | License confirmation | New License notification + BCC of confirmation |

## Critical Files

| File | What it does | Risk level |
|------|-------------|------------|
| functions/api/stripe-webhook.js | Handles payments, order emails, Pictorem, Google Sheet | 🔴 CRITICAL |
| functions/api/auth/send-magic-link.js | Login + welcome email + signup logging | 🔴 CRITICAL |
| functions/api/auth/verify.js | Magic link verification + session creation | 🔴 CRITICAL |
| functions/api/auth/session.js | Session lookup for auth state | 🟡 HIGH |
| functions/api/account/update.js | Profile editing (name → Stripe sync) | 🟡 HIGH |
| gallery.html | Main gallery with CoverFlow + all photo data | 🟡 HIGH |
| login.html | Signup/login form | 🟡 HIGH |
| account.html | Customer account page with order history | 🟡 HIGH |
| js/cart.js + js/cart-ui.js | Shopping cart and checkout | 🔴 CRITICAL |
| data/gallery-data.json | Photo metadata driving the gallery | 🟡 HIGH |

## Environment Variables (Cloudflare Pages)

- STRIPE_SECRET_KEY
- RESEND_API_KEY
- GOOGLE_SHEET_WEBHOOK_URL
- PICTOREM_API_KEY
- WOLF_EMAIL (fallback: wolf@archive-35.com)

## Deploy Process

1. Commit to main → auto-deploys via Cloudflare Pages
2. After deploy, verify: `curl -s -o /dev/null -w '%{http_code}' https://archive-35.com`
3. Check critical paths: /, /gallery, /login, /account.html, /api/auth/session

---

## AI Agent System (Phase 2)

The Archive-35 Agent is an AI-powered automation system integrated into the Studio Electron app. It handles photo analysis, content generation, and social posting.

### MANDATORY: Read Before Modifying Agent or Shared Files

1. **Read this CLAUDE.md** (you're reading it now)
2. **Read 08_Docs/LESSONS_LEARNED.md** — especially Lessons 008, 022, 023, 027
3. **Read 08_Docs/Archive-35_Architecture_Integration_Blueprint.docx** — the boundary map

### File Zones (from Architecture Blueprint)

| Zone | Rule |
|------|------|
| **STUDIO** (existing pages) | Agent development must NEVER modify these files |
| **AGENT** (Agent pages + Python backend) | New files only. Safe to create and modify |
| **SHARED** (main.js, preload.js, Sidebar.js, App.js) | Changes require testing BOTH systems |

### Shared Zone Modification Rules

Before modifying any SHARED file:
- Read the ENTIRE file first
- Read LESSONS_LEARNED.md for relevant lessons
- Make the change (additive only when possible)
- Test Studio: verify all 12 Studio tabs work + deploy pipeline runs
- Test Agent: verify all 7 Agent tabs work + Dashboard shows ONLINE
- If ANYTHING breaks: revert immediately

### Agent Architecture

| Layer | Technology | Location |
|-------|------------|----------|
| Frontend | React (in Electron Studio) | 05_Studio/app/src/pages/Agent*.js |
| Backend | Python FastAPI (port 8035) | Archive 35 Agent/src/ |
| Database | SQLite + WAL mode | Archive 35 Agent/data/archive35.db |
| IPC Bridge | Electron IPC → HTTP proxy | preload.js → main.js → localhost:8035 |

### Agent Pages in Studio

| Tab | Component | Purpose |
|-----|-----------|---------|
| Dashboard | AgentDashboard.js | Overview, stats, kill switches |
| Photos | AgentPhotoImport.js | Photo grid + vision analysis |
| Queue | AgentContentQueue.js | Content approval with visual previews |
| Pipeline | AgentPipelineMonitor.js | Audit logs + manual triggers |
| Etsy | AgentEtsyListings.js | Etsy listing preview + SKU pricing |
| Health | AgentHealthPanel.js | Service testing + pipeline visualization |
| Settings | AgentSettings.js | Agent-specific API keys + config |

### CRITICAL: Studio Already Generates AI Metadata

**Before touching Agent vision/content code, understand this:** Studio's photo ingest pipeline ALREADY calls Claude Haiku 4.5 to generate AI metadata for every photo. The Agent's analysis is COMPLEMENTARY, not a replacement.

#### Studio Ingest Pipeline (ContentIngest.js → main.js IPC)

The full photo lifecycle starts in Studio, NOT the Agent:

```
Camera → Lightroom export → Studio ContentIngest.js → 01_Portfolio/ → Deploy → Live site
```

**Phase 1 — Scan + AI Analysis** (`analyze-photos` IPC in main.js):
- Reads EXIF data (camera, lens, GPS, date, exposure)
- Resizes to 800×800px for API call
- Calls Claude Haiku 4.5 to generate: **title, description, location, tags**
- User reviews and edits AI output before finalizing (AI gets sunrise/sunset wrong!)

**Phase 2 — User Review**:
- Wolf reviews every AI-generated title, description, location, and tag set
- Manual corrections applied (especially time-of-day and location specifics)

**Phase 3 — Finalize** (`finalize-ingest` IPC in main.js):
- Copies originals to `01_Portfolio/{collection}/originals/`
- Creates 3-tier web images:
  - `*-full.jpg` — 2000px JPEG @ 85% (CoverFlow hero, standard displays)
  - `*-hd.webp` — 3500px WebP @ 85% (lightbox on 4K/Retina displays)
  - `*-thumb.jpg` — 400px JPEG @ 80% (grid thumbnails)
- Signs full-size with C2PA content credentials (provenance)
- Uploads originals to Cloudflare R2 cloud storage
- Writes per-portfolio `_photos.json` metadata file

**Deploy** (`deploy-website` IPC in main.js):
- Aggregates all `_photos.json` → `data/photos.json`
- Copies web images to `images/` directory
- Runs `sync_gallery_data.py` to update gallery.html
- Git commit + push → Cloudflare Pages auto-deploys

#### What Studio Generates vs What Agent Adds

| Field | Studio (during ingest) | Agent (vision analysis) |
|-------|----------------------|----------------------|
| Title | ✅ AI-generated, user-reviewed | suggested_title (alternative) |
| Description | ✅ AI-generated, user-reviewed | — |
| Location | ✅ AI + EXIF GPS | — |
| Tags | ✅ AI-generated, user-reviewed | ✅ Additional tags (OVERLAP) |
| Mood | — | ✅ Agent-only |
| Composition | — | ✅ Agent-only |
| Marketability score | — | ✅ Agent-only (1-10) |
| EXIF data | ✅ Extracted during ingest | Imported from 01_Portfolio |

**Key insight:** Agent's unique value-add is mood, composition analysis, and marketability scoring. Tags overlap with Studio's AI tags but may add different descriptors. Agent should NOT overwrite Studio's user-reviewed titles/descriptions.

#### Master Image Source of Truth

**`photography/` folder** in the repo root is the ONE source of truth for all published images:
- **744 images across 40 gallery folders** (as of Feb 2026)
- Each subfolder = one gallery (e.g., `photography/Iceland/`, `photography/Tanzania/`)
- New galleries added by creating new folders; folder structure may grow
- Images can only be **copied out**, never deleted (only Wolf deletes)
- From here, images flow to: R2 bucket, thumbnails, web-optimized copies, etc.

```
photography/{gallery}/*.jpg  →  Source of truth (raw published images)
```

#### Web Image Tiers (3-Tier Responsive)

As of Feb 2026, every published photo exists in three web-optimized sizes:

| Tier | File Pattern | Max Size | Format | Avg Size | Purpose |
|------|-------------|----------|--------|----------|--------|
| Thumbnail | `*-thumb.jpg` | 400px | JPEG 80% | ~16 KB | Gallery grid, CoverFlow sidebar |
| Full | `*-full.jpg` | 2000px | JPEG 85% | ~509 KB | CoverFlow hero, standard displays |
| HD | `*-hd.webp` | 3500px | WebP 85% | ~922 KB | Lightbox on 4K/Retina (DPR > 1) |

**How it works:**
- Gallery grid loads thumbnails (400px) — fast, minimal bandwidth
- CoverFlow hero loads full (2000px) — sharp enough at typical card size
- Lightbox loads full FIRST (instant display), then swaps to HD WebP on high-DPI displays
- The swap is seamless — user sees 2000px immediately, then gets 3500px upgrade
- On standard displays (DPR 1), HD WebP is never loaded — zero extra bandwidth

**Why 3500px, not 4000px?** On a 4K display at DPR 2, the lightbox maxes out at ~4260 device pixels. 3500px at WebP quality 85 provides visually sharp results with acceptable file sizes. The step from 2000px → 3500px eliminates the visible softness; going to 4000px adds ~40% more bytes for diminishing perceptual returns.

**Batch generation:** `python3 scripts/generate_hd_webp.py --all` regenerates from Photography/ originals.

#### Agent Photo Import Flow

Agent's `import_photos.py` currently imports from `01_Portfolio/*/originals/` — but the **canonical source** is `photography/`. The Agent should reference `photography/` for any image operations where originals are needed.

```
photography/{gallery}/*.jpg           →  Source of truth
01_Portfolio/{collection}/originals/  →  Studio-processed copies (may not match 1:1)
01_Portfolio/{collection}/_photos.json →  EXIF + Studio metadata
```

#### Anthropic API Key Strategy (Updated)

- **Real key location:** Root `.env` at `~/Documents/Archive-35.com/.env` (shared with Studio)
- **Agent .env:** Has placeholder `sk-ant-...` — NOT a real key
- **Fallback logic:** `_get_anthropic_client()` in api.py checks Agent .env first, then falls back to root .env
- **Models used:** Vision = `claude-haiku-4-5-20251001`, Content = `claude-sonnet-4-5-20250929`
- **Rate limits:** 500 calls/day, $5.00/day budget (configurable in config.py)

### Agent API Key Strategy

- **Shared keys** (Anthropic, R2, Pictorem): Read from Studio .env via `getAgentConfig()` IPC
- **Agent-specific keys** (Late API, Telegram, Etsy, Shopify): Stored in Agent .env, managed via Agent Settings tab

### Vision Batch Operations

To run vision analysis on all unanalyzed photos:
```bash
cd "Archive 35 Agent"
nohup python3 scripts/run_vision_batch.py > vision_batch.log 2>&1 &
```
- Requires Agent API running on port 8035 (Studio must be open)
- Processes one photo at a time with 60s timeout
- Failed photos marked with `vision_mood='error'` to prevent infinite retries
- Progress: check `tail -f vision_batch.log` or query DB directly
- Images >4.5MB auto-resized via PIL before sending to Claude API

### Critical Agent Files

| File | Risk | Purpose |
|------|------|---------|
| Archive 35 Agent/src/api.py | HIGH | FastAPI server (16+ endpoints) |
| Archive 35 Agent/src/safety/kill_switch.py | CRITICAL | Emergency stop |
| Archive 35 Agent/src/agents/vision.py | MEDIUM | Claude Haiku vision analysis |
| Archive 35 Agent/src/agents/content.py | MEDIUM | Content generation |
| Archive 35 Agent/src/agents/variations.py | MEDIUM | Content variation engine |
| Archive 35 Agent/src/content_library.py | HIGH | Content master file storage |
| Archive 35 Agent/src/integrations/google_sheets.py | MEDIUM | Google Sheets webhook |

---

## 🛡️ Code Safety Protocol — MANDATORY Before Modifying Files

**This codebase has 3 interconnected systems (Studio, Agent, Mockup) with shared dependencies. A change in one file can break all three systems. Follow this protocol EVERY TIME.**

### Pre-Modification Checklist

Before editing ANY file in the Critical Files table above, or any file in `05_Studio/app/main.js`, `preload.js`, `App.js`, or `Sidebar.js`:

1. **Read `08_Docs/CONSTRAINTS.md`** — Check if the file has hard rules. If it does, follow them exactly. Only Wolf can grant exceptions.
2. **Read the file header** — Critical files have structured safety headers listing dependencies, side effects, and required reading.
3. **Read `08_Docs/LESSONS_LEARNED.md`** — Search for lessons related to the file or feature you're changing. Pay special attention to ROOT-CAUSE lessons (022, 023, 027, 029).
4. **Identify ALL consumers** — Before changing any data format, function signature, or file path, grep the entire project for references. Fix ALL consumers, not just the one you found.
5. **One change at a time** — Make one change → test → verify → then next. Never batch unrelated changes.

### The Three Safety Layers

| Layer | File | Purpose | Who can override? |
|-------|------|---------|-------------------|
| **Stop Sign** | `08_Docs/CONSTRAINTS.md` | Hard "NEVER" rules per critical file | Wolf only |
| **Speed Bump** | File headers in source code | Dependency hints + "read first" pointers | Wolf only |
| **Guardrails** | This CLAUDE.md section | Process checklist + zone rules | Wolf only |

### File Safety Header Format

Critical source files should have this header format:
```
// ⚠️ PROTECTED FILE — Risk: [CRITICAL/HIGH/MEDIUM]
// Dependencies: [list files that read/write this file]
// Side effects: [what happens if this file changes]
// Read first: CONSTRAINTS.md, LESSONS_LEARNED.md #NNN
// Consumers: [which systems use this file: Studio/Agent/Mockup/Website]
```

### Generated vs Source Files — Know the Difference

| Generated (DON'T hand-edit) | Source (edit these instead) |
|-----------------------------|-----------------------------|
| `data/photos.json` | `01_Portfolio/*/_photos.json` |
| `gallery.html` inline `const G=[...]` | `data/photos.json` (via sync_gallery_data.py) |
| `_site/` output | Source HTML/JS/CSS files |

### Three-System Impact Check

Before modifying shared files, verify impact on all three systems:

| System | How to test | What to check |
|--------|------------|---------------|
| **Studio** | Open Electron app | All 12 tabs load, deploy pipeline runs |
| **Agent** | Start Agent from Studio | All 7 tabs load, Dashboard shows ONLINE |
| **Mockup** | Start Mockup from Studio | All 4 tabs load, preview generates |

---

## Preferences

- Default to .docx for documents (not .md) unless it's actual code
- Senior engineer-level technical depth
- Frame leadership topics through servant leadership
- Auto-correct voice-to-text errors without asking
- wolf@archive-35.com for ALL business communications
- wolfbroadcast@gmail.com is personal — do not use for Archive-35 business
