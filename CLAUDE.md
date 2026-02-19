# CLAUDE.md — Archive-35.com (Live Production Site)

> **Read this file completely before doing anything.**
> Last updated: 2026-02-19 (workflow docs added)

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
- Creates web-optimized: 2000px full-size + 400px thumbnail
- Signs with C2PA content credentials (provenance)
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

#### Agent Photo Import Flow

Agent's `import_photos.py` imports from `01_Portfolio/*/originals/` — these are photos that have ALREADY been through Studio's full ingest pipeline. The Agent is a downstream consumer of Studio-processed photos.

```
01_Portfolio/{collection}/originals/*.jpg  →  Agent import_photos.py  →  archive35.db
01_Portfolio/{collection}/_photos.json     →  EXIF + Studio metadata available
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

## Preferences

- Default to .docx for documents (not .md) unless it's actual code
- Senior engineer-level technical depth
- Frame leadership topics through servant leadership
- Auto-correct voice-to-text errors without asking
- wolf@archive-35.com for ALL business communications
- wolfbroadcast@gmail.com is personal — do not use for Archive-35 business
