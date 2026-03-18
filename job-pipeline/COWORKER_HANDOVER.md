# COWORKER HANDOVER — Job Pipeline Command Center
# Last updated: 2026-03-05
# From: Claude Code session (Wolf's direct collaborator)
# To: Coworker session (testing, debugging, validation)

---

## STOP — READ THESE FILES FIRST (In This Order)

Before doing ANYTHING, read these files completely:

1. **`/home/user/archive-35.com/CLAUDE.md`** — Project-wide rules, Wolf's preferences (ADHD/dyslexia — keep things scannable), production safety rules
2. **`/home/user/archive-35.com/job-pipeline/docs/MASTER-ARCHITECTURE-v2.md`** — Complete system architecture (82KB). This is the single source of truth for the entire pipeline design
3. **`/home/user/archive-35.com/job-pipeline/LESSONS_LEARNED.md`** — What works, what doesn't, template iterations
4. **`/home/user/archive-35.com/job-pipeline/docs/ACCEPTANCE_TESTS.md`** — ~95 acceptance tests organized by architecture section
5. **This file** — Current state, what's done, what needs testing/fixing

---

## SYSTEM OVERVIEW (Quick Version)

**What:** Automated job search pipeline for VP/Director-level engineering roles. Discovers jobs, scores them, generates cover letters, fills ATS forms, monitors email responses, learns from outcomes.

**Who:** Wolf Schram — VP Engineering, 25+ years experience. ADHD/dyslexia — UI must be visual, scannable, high contrast.

**Stack:**
- Pure Node.js HTTP server (NO Express despite it being in package.json)
- SQLite via better-sqlite3 (falls back to node:sqlite)
- WAL journal mode, foreign keys enabled
- Vanilla HTML/CSS/JS dashboard (no React, no build step)
- Anthropic Claude API for AI features
- Google OAuth2 for Gmail integration
- Playwright CDP for ATS form filling

---

## HOW TO START THE SERVER

```bash
cd /home/user/archive-35.com/job-pipeline

# Kill any existing server first
pkill -f "node server.js" 2>/dev/null

# Start fresh
node server.js

# You should see:
#   ✓ Job Pipeline Server v2 running
#   ✓ Command Center: http://localhost:3000
```

**IMPORTANT:** If you see `EADDRINUSE` error, the old server is still running. Kill it first with `pkill -f "node server.js"`.

---

## HOW TO TEST THE SERVER

```bash
# Core endpoints
curl -s http://localhost:3000/api/stats | python3 -m json.tool
curl -s http://localhost:3000/api/health | python3 -m json.tool
curl -s http://localhost:3000/api/email/status | python3 -m json.tool
curl -s http://localhost:3000/api/application-questions | python3 -m json.tool
curl -s http://localhost:3000/api/email/summary | python3 -m json.tool
curl -s http://localhost:3000/api/jobs | python3 -m json.tool
curl -s http://localhost:3000/api/settings | python3 -m json.tool

# Test saving data
curl -s -X PUT http://localhost:3000/api/application-questions \
  -H 'Content-Type: application/json' \
  -d '{"us_work_auth":{"value":"Yes","category":"legal"}}' | python3 -m json.tool

# Test email scan (will fail without OAuth — that's correct)
curl -s -X POST http://localhost:3000/api/email/scan \
  -H 'Content-Type: application/json' \
  -d '{"days_back":7}'
# Expected: {"error":"Gmail not configured..."} — this is correct if OAuth not done yet
```

---

## CURRENT STATE OF THE CODEBASE

### What's DONE and WORKING (verified via curl):

| Feature | Endpoint(s) | Status |
|---------|------------|--------|
| Job CRUD | GET/POST/PUT /api/jobs | ✅ Working |
| Pipeline stats | GET /api/stats | ✅ Working |
| Personal info | GET/PUT /api/personal-info | ✅ Working |
| Company research | GET/PUT /api/research/:jobId | ✅ Working |
| AI research (Claude) | POST /api/research/:jobId/run | ✅ Working (needs API key) |
| Custom research query | POST /api/research/:jobId/run with body.query | ✅ Working |
| Research save | PUT /api/research/:jobId | ✅ Working |
| Challenges (Q&A bank) | GET/POST/PUT/DELETE /api/challenges | ✅ Working |
| Submissions tracking | GET/POST/PUT /api/submissions | ✅ Working (atomic transactions) |
| Cover letter generation | POST /api/generate-letter/:jobId | ✅ Working (needs API key) |
| Cover letter versions | GET /api/letters/:jobId | ✅ Working |
| Hallucination override | PUT /api/letters/:jobId/:version/override | ✅ Working |
| Conductor queue | GET/POST /api/conductor/* | ✅ Working |
| Job state transitions | POST /api/conductor/transition/:jobId | ✅ Working |
| ATS bot (Playwright) | GET/POST /api/ats/* | ✅ Working (needs Chrome CDP) |
| Job search | POST /api/search/run | ✅ Working |
| Monitored companies | GET/POST/DELETE /api/search/monitored | ✅ Working |
| Content import | POST /api/bridge/ingest | ✅ Working |
| Settings (API keys) | GET/PUT /api/settings | ✅ Working |
| Anthropic key test | POST /api/settings/test-anthropic | ✅ Working |
| Google OAuth flow | POST google-auth-url + GET callback | ✅ Working (needs browser) |
| System health | GET /api/health | ✅ Working |
| Cost tracking | GET /api/costs | ✅ Working |
| **Email status** | GET /api/email/status | ✅ NEW — Working |
| **Email scan** | POST /api/email/scan | ✅ NEW — Working (needs OAuth) |
| **Email messages** | GET/PUT /api/email/messages | ✅ NEW — Working |
| **Email summary** | GET /api/email/summary | ✅ NEW — Working |
| **App questions** | GET/PUT /api/application-questions | ✅ NEW — Working |

### Dashboard Tabs (13 total):

1. **Pipeline** — Job table with status flow, filters, generate letter buttons
2. **Personal Info** — Name, email, phone, LinkedIn, positioning statement, resume summary
3. **Research** — Job selector, custom query input, auto-generated prompt, research fields, save
4. **Challenges** — Q&A bank with categories, search, add/delete
5. **Applied** — Submission tracking with response types, ghosted detection
6. **Feedback** — Template metrics, response breakdown charts, summary stats
7. **Health** — Pipeline flow graph, connection health cards, job heatmap, budget
8. **ATS Bot** — CDP connection, approved queue, form filling controls
9. **Email** — **NEW** — Gmail scanning, response classification, job matching
10. **App Questions** — **NEW** — ATS form pre-fill answers (work auth, salary, etc.)
11. **Import** — Content ingestion from any source
12. **Job Search** — Multi-platform search, dedup, monitored companies
13. **Settings** — API keys, Google OAuth, budget limits

---

## WHAT NEEDS TESTING & FIXING

### Priority 1: Visual Verification (REQUIRES BROWSER)

Wolf says he sees "zero changes" — he needs to kill old server, restart, hard-refresh. Once the UI loads, verify:

- [ ] All 13 tabs visible in tab navigation bar
- [ ] **Email tab** loads without JS errors (check browser console)
- [ ] **App Questions tab** loads with all form fields
- [ ] Email tab shows stats cards (Gmail Status, Total Scanned, Matched, Last Scan)
- [ ] Email tab scan buttons exist ("Scan Inbox Last 30 Days", "Last 7 Days")
- [ ] Email tab filter buttons work (All, Interview, Received, Rejection, etc.)
- [ ] App Questions tab has 4 sections: Legal, Compensation, Experience, Diversity
- [ ] App Questions "Save All Answers" button saves and shows "Saved!" toast
- [ ] All EXISTING tabs still work (Pipeline, Research, Challenges, etc.)
- [ ] No JS console errors on page load

### Priority 2: Gmail OAuth Flow (REQUIRES BROWSER + WOLF'S GOOGLE ACCOUNT)

1. Go to Settings tab
2. Verify Google Client ID shows: `265270079997-...`
3. Verify Google Client Secret shows: `GOCSPX-...` (masked)
4. Click "Authorize Gmail Access"
5. Complete OAuth in popup (uses Wolf's wolfbroadcast@gmail.com)
6. After redirect back, verify Settings shows "Authorized" in green
7. Go to Email tab → click "Scan Inbox (Last 30 Days)"
8. Verify emails appear in table
9. Verify auto-classification works (interview/rejection/offer labels)
10. Verify job matching works (emails from known companies get linked)

### Priority 3: End-to-End Smoke Test

Test the full pipeline flow:
1. Pipeline tab → verify 5 seed jobs show (Spotify, Datadog, Netflix, Stripe, WBD)
2. Click a SCORED job → expand row → verify description shows
3. Click "Generate Letter" on a scored job → confirm API call works (needs Anthropic key)
4. Research tab → select a job → type custom query → click "Run Research"
5. Challenges tab → click "Add Challenge" → fill form → save → verify it appears
6. Applied tab → verify submissions show with response type filters
7. Health tab → verify health cards show green/yellow/red status
8. ATS tab → verify it shows "Disconnected" (expected — no Chrome CDP)
9. Import tab → paste text → select type → import → verify in history
10. Search tab → enter query → click Search → verify results appear
11. Settings tab → click "Test Anthropic Key" → verify it says "Valid"

### Priority 4: Known Issues to Investigate

1. **Seed data still shows old submissions** — The `init-db.js` was fixed (Stripe/WBD now SCORED instead of APPLIED/INTERVIEW), but the running database still has old data. Running `npm run init-db && npm run migrate` would reset it, but that DELETES all data. Only do this if Wolf says OK.

2. **Email scan requires OAuth** — Until Wolf completes the Google OAuth flow in the browser, email scanning will return an error. This is expected behavior, not a bug.

3. **ATS bot requires Chrome CDP** — The Playwright-based form filler needs Chrome running with `--remote-debugging-port=9222`. This is expected to show "Disconnected" in normal use.

4. **Resume summary field** — Wolf asked "what is resume summary for?" Answer: It's used by the AI cover letter generator to extract relevant experience/accomplishments for personalization. The hint text in the UI says this, but Wolf may not have noticed.

---

## KEY FILES & WHAT THEY DO

| File | Size | Purpose | Risk |
|------|------|---------|------|
| `server.js` | ~1600 lines | ALL API routes, HTTP server, Gmail integration, settings | HIGH |
| `public/command-center.html` | ~2200 lines | Single-page dashboard (HTML + CSS + JS, all inline) | HIGH |
| `lib/cover-letter-generator.js` | 513 lines | Two-call extract→assemble pipeline, hallucination filter | MEDIUM |
| `lib/db.js` | 49 lines | Database wrapper (better-sqlite3 / node:sqlite) | LOW |
| `conductor/scheduler.js` | 496 lines | State machine, polling, auto-queue, circuit breaker | MEDIUM |
| `conductor/application-bot.js` | 404 lines | Playwright CDP-based ATS form filler | MEDIUM |
| `conductor/platform_adapters/` | 3 files | Greenhouse, Lever, Generic ATS adapters | LOW |
| `init-db.js` | 215 lines | Creates fresh DB with schema + seed data | LOW |
| `migrate-v2.js` | 441 lines | Additive migration to v2 schema | LOW |
| `job-scorer.js` | ~300 lines | Weighted keyword scoring for jobs | LOW |
| `mcp-server.js` | ~600 lines | MCP server for Claude Desktop integration | LOW |
| `.env` | 6 keys | API keys, OAuth creds, budget limits | CRITICAL |

---

## DATABASE SCHEMA (Key Tables)

The DB has these tables (created by init-db + migrate-v2 + server startup):

**Core:**
- `jobs` — Main pipeline, 16 status values (NEW→SUBMITTED→CLOSED + error states)
- `personal_info` — Key-value pairs (name, email, positioning, resume summary)
- `company_research` — Per-job research notes (summary, culture, people, news)
- `challenges` — Q&A bank with categories and reusability flag
- `application_submissions` — Tracks where/when applied, response type
- `cover_letter_versions` — Versioned letters per job, with AI scores

**Conductor:**
- `conductor_queue` — Task orchestration (score, generate, submit, check)
- `bridge_events` — Content ingestion audit log
- `prompt_registry` — Versioned AI prompts

**New (created at server startup):**
- `email_messages` — Gmail scan results with classification and job matching
- `application_questions` — ATS form pre-fill answers (work auth, salary, etc.)

**Other:**
- `agents` — Automation agent status tracking
- `errors` — Error log with job/agent FK
- `monitored_companies` — Career pages checked daily
- `qa_bank` — Legacy Q&A (v1, kept for compatibility)

**Views:**
- `job_current_state` — Jobs with effective status
- `template_metrics` — Cover letter version performance

---

## API CREDENTIALS (Already in .env)

| Key | Status | Purpose |
|-----|--------|---------|
| ANTHROPIC_API_KEY | ✅ Configured | Claude API for cover letters + research |
| GOOGLE_CLIENT_ID | ✅ Configured | Gmail OAuth |
| GOOGLE_CLIENT_SECRET | ✅ Configured | Gmail OAuth |
| GOOGLE_REFRESH_TOKEN | ❌ NOT YET | Needs OAuth flow in browser |
| DAILY_BUDGET | ✅ $2.00 | Max API spend per day |
| MONTHLY_BUDGET | ✅ $55.00 | Max API spend per month |
| MAX_COVER_LETTERS_PER_DAY | ✅ 5 | Circuit breaker |

---

## GIT STATUS

- **Branch:** `claude/job-pipeline-v2-5x9f7`
- **Last commit:** `e7bce64` — "Add Gmail email integration, Email tab, Application Questions tab, fix seed data"
- **Remote:** Up to date with origin
- **Working tree:** Clean

### Recent Commits:
```
e7bce64 Add Gmail email integration, Email tab, Application Questions tab, fix seed data
0c9c3f0 Fix 30+ bugs in job-pipeline server: SQL injection, atomicity, validation, error handling
56d23af Add SQLite WAL runtime files to .gitignore
a1daf71 Update pipeline.db with monitored_companies table from Phase 13 migration
4becfdd Phase 12 + 13: Content Ingestion + Multi-Platform Search
19e56a4 Phase 11: Settings tab + Cover Letter integration + Dashboard fixes
```

---

## WOLF'S COMMUNICATION STYLE

- **ADHD/dyslexia** — Keep answers short, scannable, clear visual hierarchy
- **Types fast with errors** — Auto-correct voice-to-text and typos without asking
- **Senior VP level** — Understands deep technical concepts, don't over-explain
- **Servant leadership** — Frames everything through people development
- **Bilingual German/English** — Prefers English
- **Email:** wolf@archive-35.com (business), wolfbroadcast@gmail.com (personal/Google account)
- **When he says "fix all of them"** — He means it. Do them all, don't ask for permission on each one.

---

## ARCHITECTURE DECISIONS TO RESPECT

1. **Pure Node.js HTTP** — No Express. Server uses custom regex routing. Don't add Express.
2. **Vanilla JS dashboard** — No React, no build step. Everything is inline in one HTML file.
3. **SQLite only** — No Postgres, no Redis. WAL mode + better-sqlite3.
4. **Two-call cover letter pattern** — Extract facts first, then assemble letter. Never combine.
5. **Human-in-the-loop gates** — Wolf approves jobs and confirms ATS submissions. Never auto-submit.
6. **Pull-based ATS** — Wolf triggers submissions, bot fills but pauses for review.
7. **Circuit breaker** — 5 letters/day, $2/day budget. Don't bypass.
8. **Job fingerprint dedup** — company+title+location hash, 90-day window.

---

## WHAT TO DO IF THINGS BREAK

### Server won't start
```bash
pkill -f "node server.js"   # Kill existing
node -c server.js            # Syntax check
node server.js               # Start fresh
```

### Database issues
```bash
# Check if DB exists
ls -la pipeline.db

# If corrupted, reinitialize (LOSES ALL DATA — ask Wolf first):
npm run init-db && npm run migrate
```

### Port already in use
```bash
pkill -f "node server.js"
# OR find the PID:
lsof -i :3000
kill <PID>
```

### Module not found errors
```bash
npm install   # Reinstall dependencies
```

---

## QUICK COMMAND REFERENCE

```bash
cd /home/user/archive-35.com/job-pipeline

# Server
node server.js                          # Start server
pkill -f "node server.js"              # Kill server

# Database
npm run init-db                         # Fresh DB (DESTRUCTIVE)
npm run migrate                         # Add v2 tables (safe, idempotent)

# Testing
node -c server.js                       # Syntax check
curl -s http://localhost:3000/api/stats  # Quick health check
curl -s http://localhost:3000/api/health # Full health report

# Git
git status
git log --oneline -10
git push -u origin claude/job-pipeline-v2-5x9f7
```
