# MASTER ARCHITECTURE — Job Pipeline v2.0
# Wolf Schram · Automated Job Search & Application System
# ─────────────────────────────────────────────────────────
# PURPOSE: Single source of truth for the entire system.
# Covers all components (built + planned), all decisions,
# all data flows, and the complete build sequence.
# Hand this document to ANY reviewer (human or AI) and they
# should be able to identify gaps, contradictions, or risks.
# ─────────────────────────────────────────────────────────
# Version: 2.1 · Last updated: 2026-03-05
# Changelog: v2.1 — Incorporated 17 fixes from external review (Gemini + ChatGPT)
# ─────────────────────────────────────────────────────────

---

## 1. SYSTEM OVERVIEW

### What This Is
A fully automated job search and application pipeline for VP/Director-level engineering leadership roles. The system discovers jobs, scores them for fit, generates tailored cover letters, submits applications, monitors responses, and learns from outcomes.

### Who It's For
**Wolf Schram** — VP of Engineering, 25+ years experience, career transition (laid off Jan 2026). Servant leadership philosophy. Core product: "Leadership for leaders — empowerment, people development, ownership culture."

- **Target roles:** VP Engineering, COO, SVP, Director of Engineering
- **Target compensation:** $230K–$350K base + 20–30% bonus (LA market)
- **ADHD/dyslexia:** UI must be scannable, short text, clear hierarchy, bold headers

### What Problem It Solves
Job searching at the VP level is a high-touch, high-volume process. Wolf needs to:
1. Find relevant roles across multiple platforms
2. Research each company thoroughly
3. Craft personalized cover letters anchored in his P→P→R (Problem→Product→Result) framework
4. Apply through both email and ATS portals
5. Track every application, response, and interview
6. Learn which approaches work and iterate

Without automation, this is 4–6 hours/day of manual work. This system reduces Wolf's daily involvement to:
- **~15 minutes:** Review daily digest, approve/reject jobs
- **~15 minutes:** Supervised ATS submissions via Playwright
- **Everything else:** Fully automated

### Human-in-the-Loop Gates (Only 2)
1. **Job approval** — Wolf reviews scored jobs + generated cover letters in daily digest. Approves, rejects, or edits.
2. **Final application submit** — For ATS portals, Playwright fills forms but Wolf watches on secondary monitor and confirms. For direct email, fully autonomous after approval.

---

## 2. DESIGN PRINCIPLES

Five rules that govern every decision:

1. **One machine. No sync.** Everything runs on Wolf's M3 Max MacBook Pro. No cloud dependencies, no multi-machine sync, no iCloud conflicts.

2. **Database is truth. Folders are storage.** `pipeline.db` (SQLite) owns all state. Folders hold artifacts (files, letters, research) for reference only. **No folder presence shall be a state machine input.** No `approved.flag`, no "check if file exists" gates. State transitions happen exclusively via DB updates. If a folder is out of sync with the DB, the DB wins.

3. **Never stop the pipeline.** One failed job never blocks others. Retry → Self-Heal → Quarantine → Continue. Always. **Task idempotency matters:** scraping, scoring, and letter generation are idempotent (safe to retry). ATS submissions and email sends are non-idempotent (require transactional checkpoints and do-not-repeat guards).

4. **Wolf approves outbound. Machine handles everything else.** The only hard human gates: approving cover letters and confirming application submissions.

5. **Cost-conscious automation.** Claude Haiku for scoring (~$0.001/job), Claude Sonnet for cover letter generation + hallucination filtering. Budget: daily cap $2/day, monthly ceiling $55. Max 5 cover letter generations/day (overflow queues for next day). Track costs per operation.

---

## 3. COMPONENT MAP

### 3.1 Built Components (Phase 1-6 — Complete)

| # | Component | Technology | File(s) | Status |
|---|-----------|-----------|---------|--------|
| 1 | **Express API Server** | Node.js + Express 4.21 | `server.js` | COMPLETE — 11 REST endpoints, port 3000 |
| 2 | **SQLite Database** | better-sqlite3 + WAL mode | `pipeline.db` via `init-db.js` | COMPLETE — 4 tables, 1 view, 4 indexes |
| 3 | **Job Scorer** | Node.js CLI → upgrading to Claude Haiku | `job-scorer.js` | COMPLETE (v1 keyword) — upgrading to Haiku for contextual accuracy |
| 4 | **MCP Server** | Node.js, JSON-RPC 2.0 | `mcp-server.js` | COMPLETE — 9 tools for Claude Desktop |
| 5 | **Feedback Analyzer** | Node.js CLI | `feedback-analyzer.js` | COMPLETE — Template version A/B tracking |
| 6 | **Dashboard v1** | Single-file HTML/CSS/JS | `PIPELINE_DASHBOARD.html` | COMPLETE — 5-tab SPA, dark theme, auto-refresh |
| 7 | **Cover Letter Template** | Markdown prompt | `prompts/cover-letter-template.md` | COMPLETE — P→P→R framework |
| 8 | **Test Suite** | Node.js integration tests | `test-all.js` | COMPLETE — 86 assertions across 7 categories |

### 3.2 Planned Components (Phase 7-13 — To Build)

| # | Component | Technology | Purpose |
|---|-----------|-----------|---------|
| 9 | **Command Center v2** | HTML/CSS/JS modular files | New 6-tab dashboard replacing v1 (§6.1) |
| 10 | **Conductor** | Node.js, native polling loop, node-cron | Pipeline orchestrator — schedules, queues, state machine (§3.3) |
| 11 | **Content Ingestion** | Dashboard paste UI + Express endpoint | Paste content from Claude browser into pipeline via dashboard (§3.4) |
| 12 | **Application Bot** | Playwright (headed, CDP connect) | Form filling, file upload, ATS navigation — Wolf watches on 2nd monitor (§3.5) |
| 13 | **Cover Letter Generator** | Anthropic SDK (Claude API) | Direct API calls + hallucination filter, replaces Cowork (§3.6) |
| 14 | **Gmail MCP Server** | Node.js, Google OAuth | Inbox monitoring, response parsing, verification code extraction (§3.7) |
| 15 | **Hallucination Filter** | Node.js + context file comparison | Verifies cover letter claims against Wolf's actual experience files (§3.8) |
| 16 | **Multi-Platform Search** | Node.js scrapers/API clients | LinkedIn, Indeed, Glassdoor, executive recruiter boards (§3.9) |

### 3.3 Conductor (Orchestrator)

**Purpose:** Central brain that coordinates all pipeline operations on a schedule. **Single DB writer** — all other components (CLI, dashboard API, Playwright logger) POST to the Conductor's Express API rather than writing to the database directly. This eliminates SQLite lock contention.

**Technology:** Node.js process using a **native polling loop** (`setInterval` every 5 seconds) + `node-cron` for scheduling. No Redis. No better-queue (abandoned package, lock risks).

**Polling loop** (`conductor/scheduler.js`):
```js
// Every 5 seconds: pick next queued task
setInterval(() => {
  const task = db.prepare(`
    BEGIN EXCLUSIVE;
    SELECT * FROM conductor_queue
    WHERE status = 'queued'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get();
  if (task) {
    db.prepare(`UPDATE conductor_queue SET status = 'processing', started_at = datetime('now') WHERE id = ?`).run(task.id);
    processTask(task);
  }
}, 5000);
```

**Responsibilities:**
- Schedule job scraping runs (configurable cron)
- Queue jobs for scoring as they arrive
- Queue cover letter generation for scored HIGH/MEDIUM jobs
- **Daily circuit breaker:** Max 5 cover letter generations per day. Overflow holds in COVER_LETTER_QUEUED until next day.
- Trigger daily digest email at 7am
- Monitor Gmail every 15 minutes for responses
- Track queue health and alert on stalls
- Manage state machine transitions for each job
- **Enforce idempotency:** Check `idempotency_key` before enqueuing to prevent duplicates

**State machine (per job):**
```
NEW → SCRAPED → SCORED → COVER_LETTER_QUEUED → COVER_LETTER_READY →
PENDING_APPROVAL → APPROVED → SUBMITTING → SUBMITTED → CLOSED
```
Note: Outcome tracking (INTERVIEW, REJECTED, GHOSTED, OFFER) lives in `application_submissions.response_type`, not `jobs.status`. The `jobs.status` column is lifecycle-only.

**Error states:** `SCORING_FAILED`, `GENERATION_FAILED`, `SUBMISSION_FAILED`, `ERROR_BLOCKED`

**Task idempotency classification:**

| Task Type | Idempotent? | Retry Policy | Unique Key |
|-----------|------------|--------------|------------|
| `scrape` | Yes | Auto-retry 3x with backoff | source + date |
| `score` | Yes | Auto-retry 3x | job_id |
| `generate_letter` | Yes | Auto-retry 2x, then flag | job_id + version |
| `submit_email` | **No** | Checkpoint + do-not-repeat | job_id + method |
| `submit_ats` | **No** | Checkpoint + resume token | job_id + platform |
| `check_response` | Yes | Auto-retry 3x | — |

**Process management:** pm2 for the Conductor process + macOS launchd for auto-start on login.

### 3.4 Content Ingestion (Dashboard Paste UI)

**Purpose:** Allow Wolf to paste content from the Claude browser extension (cover letters, Q&A sheets, research notes) into the pipeline via the Command Center dashboard.

**Why not a Chrome extension?** Building a Manifest V3 extension to intercept Claude's browser output is fragile — when Anthropic updates the Claude Web UI DOM, the extension breaks. A paste UI is unbreakable and takes seconds to use.

**How it works:**
1. Wolf copies content from Claude browser (CMD+C)
2. Opens Command Center dashboard → "Import Content" panel
3. Selects content type (cover_letter, research, qa_answers) and target job
4. Pastes content into textarea → clicks "Import"
5. Dashboard POSTs to `localhost:3000/api/bridge/ingest`

**Security:**
- Bearer token authentication (token from `BRIDGE_AUTH_TOKEN` env var)
- Strict JSON schema validation (content_type, job_id, content required; max payload 50KB)
- All ingestion events logged to append-only `bridge_events` table (audit trail)
- Only accepts requests from localhost

**Why this is better:** Zero Chrome permissions, no extension maintenance, no DOM coupling, works with any AI tool (not just Claude browser), 10 lines of frontend code.

### 3.5 Application Bot (Playwright)

**Purpose:** Automate ATS form filling in a visible browser. Wolf watches on secondary monitor.

**Technology:** Playwright connecting to a running Chrome/Brave instance via Chrome DevTools Protocol (`playwright.chromium.connectOverCDP()`).

**Why CDP instead of a separate profile?** Modern ATS systems (Workday, Greenhouse, Lever) use aggressive fingerprinting (Cloudflare Turnstile, Datadome). A clean Playwright profile has no browsing history, no cookies, and broadcasts a default automation fingerprint — it gets flagged instantly. By connecting to an actively-used browser via CDP, Playwright inherits a trusted, "warmed up" fingerprint with established cookies and browsing history. ATS systems treat it as a real user.

**Setup:** Wolf maintains a secondary browser (Chrome or Brave) that he occasionally uses for normal browsing. Playwright connects to it via `--remote-debugging-port=9222`.

**Trigger model: PULL, not PUSH.** ATS submissions are never triggered by cron. Instead:
- Dashboard Tab 5 shows "Approved for ATS" queue
- Wolf clicks **"Start ATS Submissions"** button when ready
- Bot processes the queue while Wolf watches on 2nd monitor
- This prevents Chrome stealing focus during Zoom calls or other work

**Platform Adapter Layer** (`conductor/platform_adapters/`):

ATS platforms are structurally different. A single generic bot will break constantly. V1 ships with:

| Adapter | File | Covers |
|---------|------|--------|
| Greenhouse | `greenhouse.js` | Login state, resume upload, cover letter field, question parsing, submit detection |
| Lever | `lever.js` | Similar but different DOM structure and multi-step flow |
| Generic | `generic.js` | Best-effort for simple HTML forms (name, email, file upload) |

Each adapter defines: `detectPlatform()`, `fillForm()`, `uploadResume()`, `pasteCoverLetter()`, `parseQuestions()`, `detectSubmitButton()`, `checkpoint()`.

**Workday** is intentionally excluded from V1 — its complexity warrants a dedicated Phase 14+ effort.

**Capabilities:**
- Navigate to ATS portal URLs
- Detect platform and load correct adapter
- Fill standard form fields (name, email, phone, LinkedIn, location)
- Upload resume PDF from `job-pipeline/templates/`
- Paste cover letter text into cover letter fields
- Fill Q&A responses from pre-generated answers
- Handle multi-page application flows
- **Checkpoint after each page** (save progress to `conductor_queue.checkpoint` so partially-filled forms can resume)
- Pause before final submit for Wolf's confirmation

**Non-idempotent safety:**
- Before filling any form, check `application_submissions` for existing submission to same company+role within 90 days
- After successful submit, immediately write to `application_submissions` (prevents double-apply on retry)
- If bot crashes mid-form, checkpoint data allows resume from last completed page

**What it does NOT do:**
- CAPTCHA solving (pauses and alerts Wolf)
- Account creation on new ATS platforms (Wolf does manually first time)
- Auto-trigger without Wolf clicking "Start" (pull-based only)

### 3.6 Cover Letter Generator

**Purpose:** Generate tailored P→P→R cover letters using Claude API directly.

**Technology:** Anthropic SDK (`@anthropic-ai/sdk`), Claude Sonnet model.

**Two-Call Pattern (Extract → Assemble):**

Instead of generating freely and filtering afterward (which creates hallucination retry loops), the generator uses two distinct API calls:

**Call 1 — Extraction** (Claude Sonnet):
```
Prompt: "Read this job description. Extract the exact quotes, metrics, and stories
from Wolf's capability_profile.md and cover_letter_examples/ that best address
these requirements. Output a JSON list of approved facts with source references."

Input: job description + Wolf's context files
Output: JSON array of { fact, source_file, source_line, relevance_to_job }
```

**Call 2 — Assembly** (Claude Sonnet):
```
Prompt: "Write the cover letter using ONLY the JSON facts provided below.
Use Wolf's P→P→R framework. Do not invent transitions that require new metrics.
Do not add accomplishments not in the facts list."

Input: JSON facts from Call 1 + P→P→R template + company name/role
Output: Cover letter text
```

**Post-Assembly:**
1. Run hallucination filter (§3.8) as safety net — should rarely trigger with this pattern
2. Self-score output (must be ≥7/10)
3. If <7, regenerate once with feedback
4. If second attempt <7, flag as DRAFT for Wolf's review
5. Store in database with version tracking

**Why two calls instead of one?** LLMs struggle with negative constraints. Telling it "don't hallucinate" doesn't work reliably. Forcing it to assemble from pre-approved facts eliminates the source of hallucinations. The filter becomes a safety net (catching edge cases) rather than the primary defense.

**Why API instead of Cowork:**
- Fully automatable (no manual copy-paste)
- Enables hallucination filter pipeline
- Enables batch generation
- Cost: ~$0.15–$0.50 per letter (Claude Sonnet, 2 calls)

### 3.7 Gmail MCP Server

**Purpose:** Read-only inbox monitoring + approved email sending.

**Technology:** Node.js, Google Gmail API, OAuth 2.0.

**Account:** jobs.wolfschram@gmail.com

**Capabilities:**
- Monitor inbox every 15 minutes for application responses
- Parse response type: REJECTION, INTERVIEW, REQUEST_INFO, OFFER, **UNKNOWN**
- **Confidence scoring:** Each classification includes a confidence score (0-1). Low confidence (<0.7) → flagged for Wolf's manual classification on dashboard
- Extract verification codes from account creation emails
- Send pre-approved cover letters + resume after Wolf approves
- Label and categorize job-related emails
- Store raw email text + parsed result + confidence in DB (allows correction + learning)

**OAuth:** Wolf has prior experience with Google Cloud Console / OAuth setup.

**OAuth 7-day risk:** Google Cloud projects in "Testing" mode expire tokens every 7 days. Mitigation options:
1. Push Google Cloud project to "Production" status (requires OAuth consent screen review)
2. Use App Password + IMAP instead of OAuth (simpler, no expiry)
3. Dashboard shows **Gmail Auth Status** indicator on Tab 3. If expired, "Re-authenticate" link triggers local OAuth flow.

**Cannot do without Wolf's approval:**
- Send any email not staged in approved queue
- Delete emails
- Change account settings

### 3.8 Hallucination Filter

**Purpose:** Safety net that verifies AI-generated cover letters only claim things Wolf has actually done. With the two-call Extract→Assemble pattern (§3.6), this filter should rarely trigger — but it catches edge cases.

**Claim Schema:**

Every factual assertion in the cover letter is classified into one of two types:

| Claim Type | Examples | Evidence Required? | On Failure |
|------------|---------|-------------------|------------|
| **Hard claim** | Numbers, dates, company names, team sizes, revenue figures, technologies, scope metrics | **YES** — must link to specific line in capability_profile.md or cover_letter_examples/ | Flag + block |
| **Soft claim** | "I lead teams", "I value ownership", "I believe in servant leadership" | **No** — allowed without evidence | Pass |

**How it works:**
1. Extract claims from cover letter into structured list: `{ type: "hard"|"soft", claim_text, entity, metric?, source_evidence? }`
2. For hard claims: fuzzy-match against Wolf's context files:
   - `templates/capability_profile.md` — verified career history
   - `templates/cover_letter_examples/` — approved stories
   - qa_bank table — verified Q&A answers
3. If hard claim has no evidence match → flag it
4. Return pass/fail + list of unverified claims with context
5. On fail: log flagged claims. Wolf can override with one click on dashboard (overrides tracked in `cover_letter_versions.flagged_claims`)

**What it does NOT do:**
- Regenerate automatically in a loop (the two-call pattern prevents this — see §3.6)
- Block soft claims like general leadership philosophy statements
- Require exact string matches (uses fuzzy matching for reasonable paraphrasing)

**Why this matters:** At the VP level, a single fabricated claim in a cover letter can end a candidacy permanently. This filter prevents the AI from "hallucinating" accomplishments Wolf never had.

### 3.9 Multi-Platform Search

**Purpose:** Discover jobs across multiple platforms, not just LinkedIn/Thunderbit.

**Platforms:**
- LinkedIn (primary — existing Thunderbit flow continues)
- Indeed (API or scraper)
- Glassdoor (API or scraper)
- Executive recruiter boards (custom)
- Company career pages (targeted list)

**Ingestion format:** All sources normalize to the standard job JSON schema (§5.3) and insert into the database via the Conductor API (not filesystem drop).

**24-hour alert:** If no new jobs from any source for 24 hours → email Wolf.

---

## 4. DATA FLOW

### 4.1 End-to-End Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        JOB SOURCES                                  │
│  LinkedIn · Indeed · Glassdoor · Recruiters · Company Pages         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INGESTION LAYER                                                    │
│  Multi-platform scrapers → Normalize to JSON → DB via Conductor API │
│  Dedup: job_fingerprint check (company+title+location, 90 days)     │
│  24h empty alert → Email Wolf if no new jobs                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  JOB SCORER (Claude Haiku — ~$0.001/job)                            │
│  7-dimension contextual analysis with explainability output          │
│  Score 0–100 → HIGH (≥75) / MEDIUM (50–74) / SKIP (<50)           │
│  Output includes per-dimension breakdown ("why this scored 82")     │
│  SKIP → status: ARCHIVED    HIGH/MEDIUM → status: SCORED           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COVER LETTER GENERATOR (Claude Sonnet — Two-Call Pattern)          │
│  Call 1: Extract approved facts from context files → JSON           │
│  Call 2: Assemble P→P→R letter from facts only                     │
│  Hallucination filter (safety net) → Self-score ≥7/10              │
│  <7 after 2 tries → DRAFT for Wolf review                          │
│  Daily limit: max 5 generations/day (overflow queues for tomorrow)  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  🧑 WOLF APPROVAL (Human Gate #1)                                   │
│  Daily digest email at 7am with one-click localhost links           │
│  http://localhost:3035/approve/job_123 → APPROVED                   │
│  http://localhost:3035/reject/job_123 → SKIPPED                     │
│  http://localhost:3035/edit/job_123 → Opens dashboard to that job   │
└──────────┬───────────────────────────────┬──────────────────────────┘
           │                               │
     Email jobs                       ATS portal jobs
           │                               │
           ▼                               ▼
┌──────────────────────┐    ┌──────────────────────────────────────┐
│  GMAIL MCP           │    │  🧑 APPLICATION BOT (Human Gate #2)  │
│  Sends cover letter  │    │  Wolf clicks "Start ATS Submissions"  │
│  + resume            │    │  Playwright (CDP) + platform adapters │
│  Fully autonomous    │    │  Wolf watches on 2nd monitor          │
│  after approval      │    │  Checkpoints per page, confirms submit│
└──────────┬───────────┘    └──────────┬───────────────────────────┘
           │                           │
           └───────────┬───────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  APPLICATION LOGGER                                                  │
│  Records: submission method, timestamp, status → SUBMITTED           │
│  Dedup: same company + role within 90 days → BLOCK                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GMAIL MCP — RESPONSE MONITOR                                       │
│  15-min polling → Parse: REJECTION / INTERVIEW / OFFER / GHOSTED   │
│  Update DB → Write to /responses/                                   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FEEDBACK ANALYZER                                                   │
│  Pattern recognition: which templates get interviews?                │
│  Template version A/B testing → insights.json                        │
│  Sunday 8am: weekly report email to Wolf                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Conductor Orchestration

The Conductor runs continuously (managed by pm2) and drives the pipeline:

```
Conductor (node-cron + native polling loop + state machine)
├── Every 4 hours: Trigger multi-platform job scraping
├── Every 5 sec: Poll conductor_queue for next task (BEGIN EXCLUSIVE)
├── On new job ingested: Queue for scoring (Haiku)
├── On job scored HIGH/MEDIUM: Queue for cover letter generation (max 5/day)
├── 7:00 AM daily: Compile and send daily digest (one-click approval links)
├── Every 15 min: Trigger Gmail response check (with confidence scoring)
├── Every Sunday 8am: Trigger weekly feedback report
├── Continuous: Monitor queue health, enforce idempotency keys, retry idempotent tasks
└── On error: Retry → Self-Heal → Quarantine → Continue (non-idempotent tasks: checkpoint + no-repeat)
```

---

## 5. DATABASE SCHEMA

### 5.1 Existing Tables (Built, Phase 1-6)

**Table: `jobs`** — Core job tracking
```sql
CREATE TABLE jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company          TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'NEW'
                   CHECK(status IN (
                     'NEW','SCRAPED','SCORED',
                     'COVER_LETTER_QUEUED','COVER_LETTER_READY',
                     'PENDING_APPROVAL','APPROVED','SUBMITTING','SUBMITTED','CLOSED',
                     'SCORING_FAILED','GENERATION_FAILED','SUBMISSION_FAILED','ERROR_BLOCKED',
                     'ARCHIVED','SKIPPED'
                   )),
  -- NOTE: Outcome tracking (INTERVIEW, REJECTED, GHOSTED, OFFER) lives in
  -- application_submissions.response_type, NOT here. jobs.status is lifecycle-only.
  score            INTEGER,
  score_reasoning  TEXT,          -- per-dimension breakdown ("why this scored 82")
  source           TEXT,
  url              TEXT,
  cover_letter     TEXT,
  job_fingerprint  TEXT,          -- normalized(company) + normalized(title) + location for dedup
  approved_at      TEXT,          -- when Wolf approved (replaces filesystem approved.flag)
  date_added       TEXT NOT NULL DEFAULT (datetime('now')),
  date_updated     TEXT NOT NULL DEFAULT (datetime('now')),
  notes            TEXT,
  template_version TEXT DEFAULT 'v1'
);
```

**Table: `agents`** — Automation agent status
```sql
CREATE TABLE agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT,
  status          TEXT NOT NULL DEFAULT 'idle'
                  CHECK(status IN ('idle','running','error')),
  last_run        TEXT,
  jobs_processed  INTEGER DEFAULT 0,
  errors          INTEGER DEFAULT 0
);
```

**Table: `errors`** — Error log
```sql
CREATE TABLE errors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER REFERENCES jobs(id),
  agent_id      INTEGER REFERENCES agents(id),
  error_message TEXT NOT NULL,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved      INTEGER DEFAULT 0
);
```

**Table: `qa_bank`** — Interview Q&A pairs
```sql
CREATE TABLE qa_bank (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  question         TEXT NOT NULL,
  answer           TEXT,
  category         TEXT CHECK(category IN ('behavioral','technical',
                   'cultural','leadership','situational')),
  template_version TEXT DEFAULT 'v1'
);
```

**View: `template_metrics`** — Aggregated success rates by template version
```sql
-- NOTE: Outcomes come from application_submissions, not jobs.status
-- jobs.status only tracks lifecycle (SUBMITTED, CLOSED, etc.)
CREATE VIEW template_metrics AS
SELECT j.template_version,
  COUNT(DISTINCT j.id) FILTER (WHERE j.status IN ('SUBMITTED','CLOSED')) AS total_submitted,
  COUNT(DISTINCT j.id) FILTER (WHERE s.response_type = 'interview') AS interviews,
  COUNT(DISTINCT j.id) FILTER (WHERE s.response_type = 'offer') AS offers,
  COUNT(DISTINCT j.id) FILTER (WHERE s.response_type = 'rejection') AS rejections,
  ROUND(
    CAST(COUNT(DISTINCT j.id) FILTER (WHERE s.response_type IN ('interview','offer')) AS REAL) /
    NULLIF(COUNT(DISTINCT j.id) FILTER (WHERE j.status IN ('SUBMITTED','CLOSED')), 0) * 100, 1
  ) AS conversion_rate
FROM jobs j
LEFT JOIN application_submissions s ON s.job_id = j.id
GROUP BY j.template_version;
```

**Indexes:**
- `idx_jobs_status` on jobs(status)
- `idx_jobs_template_version` on jobs(template_version)
- `idx_errors_timestamp` on errors(timestamp)
- `idx_qa_bank_category` on qa_bank(category)

### 5.2 New Tables (Phase 7-13)

**Table: `personal_info`** — Wolf's profile data (KV store)
```sql
CREATE TABLE personal_info (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```
Keys: `full_name`, `email`, `phone`, `linkedin_url`, `location`, `positioning_statement`, `resume_summary`, `cover_letter_defaults`, `target_titles`, `salary_range`

**Table: `company_research`** — Per-job research notes
```sql
CREATE TABLE company_research (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  research_notes  TEXT,
  company_summary TEXT,
  culture_notes   TEXT,
  key_people      TEXT,
  recent_news     TEXT,
  research_date   TEXT DEFAULT (datetime('now')),
  UNIQUE(job_id)
);
```

**Table: `challenges`** — Application challenge questions
```sql
CREATE TABLE challenges (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  question       TEXT NOT NULL,
  answer         TEXT,
  category       TEXT CHECK(category IN ('scenario','case_study','technical',
                 'behavioral','portfolio','essay','other')),
  reusable       INTEGER DEFAULT 1,
  source_company TEXT,
  date_added     TEXT DEFAULT (datetime('now')),
  date_updated   TEXT DEFAULT (datetime('now'))
);
```

**Table: `conductor_queue`** — Native task queue (polled every 5s by Conductor)
```sql
CREATE TABLE conductor_queue (
  id              TEXT PRIMARY KEY,
  job_id          INTEGER REFERENCES jobs(id),
  task_type       TEXT NOT NULL CHECK(task_type IN ('score','generate_letter',
                  'submit_email','submit_ats','check_response','scrape')),
  priority        INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'queued' CHECK(status IN ('queued','processing',
                  'completed','failed','blocked')),
  payload         TEXT,            -- JSON blob with task-specific data
  idempotent      INTEGER DEFAULT 1,  -- 0 for submit_email, submit_ats
  idempotency_key TEXT,            -- prevents duplicate enqueuing (e.g., job_id + task_type)
  checkpoint      TEXT,            -- JSON: resume token for non-idempotent tasks (ATS page progress)
  retry_count     INTEGER DEFAULT 0,
  max_retries     INTEGER DEFAULT 3,
  created_at      TEXT DEFAULT (datetime('now')),
  started_at      TEXT,
  completed_at    TEXT,
  error           TEXT,
  UNIQUE(idempotency_key)          -- enforces at-most-once for non-idempotent tasks
);
```

**Table: `cover_letter_versions`** — Track all generated letter drafts
```sql
CREATE TABLE cover_letter_versions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL DEFAULT 1,
  content           TEXT NOT NULL,
  self_score        INTEGER,
  hallucination_check TEXT CHECK(hallucination_check IN ('pass','fail','pending')),
  flagged_claims    TEXT,          -- JSON array of unverified claims
  model_used        TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  cost_estimate     REAL,
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE(job_id, version)
);
```

**Table: `application_submissions`** — Detailed submission records
```sql
CREATE TABLE application_submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES jobs(id),
  method          TEXT NOT NULL CHECK(method IN ('email','ats_portal',
                  'referral','recruiter','direct')),
  platform        TEXT,           -- Greenhouse, Lever, Workday, etc.
  submitted_at    TEXT DEFAULT (datetime('now')),
  cover_letter_id INTEGER REFERENCES cover_letter_versions(id),
  response_type   TEXT CHECK(response_type IN ('none','rejection','interview',
                  'request_info','offer','ghosted')),
  response_date   TEXT,
  response_notes  TEXT,
  follow_up_date  TEXT,
  contact_name    TEXT,
  contact_email   TEXT
);
```

**Table: `bridge_events`** — Append-only audit log for content ingestion
```sql
CREATE TABLE bridge_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type  TEXT NOT NULL CHECK(content_type IN ('cover_letter','research',
                'qa_answers','resume_notes','other')),
  job_id        INTEGER REFERENCES jobs(id),
  payload_hash  TEXT NOT NULL,      -- SHA-256 of raw content (dedup + integrity)
  payload_size  INTEGER NOT NULL,   -- bytes (max 50KB enforced at API layer)
  source        TEXT DEFAULT 'dashboard_paste',
  created_at    TEXT DEFAULT (datetime('now'))
);
-- This table is APPEND-ONLY. Never delete rows. Used for audit trail.
```

**Table: `prompt_registry`** — Track all prompt template versions
```sql
CREATE TABLE prompt_registry (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,       -- e.g., 'cover_letter_extract', 'cover_letter_assemble', 'job_scoring'
  template      TEXT NOT NULL,       -- full prompt text
  variables     TEXT,                -- JSON list of expected variables
  version       INTEGER NOT NULL DEFAULT 1,
  model_version TEXT,                -- e.g., 'claude-sonnet-4-5-20250929'
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(name, version)
);
-- When prompts change, insert a new version (never update in place).
-- This enables "what prompt was used for this letter?" debugging.
```

**View: `job_current_state`** — Derived view joining jobs + latest submission outcome
```sql
CREATE VIEW job_current_state AS
SELECT
  j.*,
  s.response_type AS current_outcome,
  s.response_date AS outcome_date,
  s.method AS submission_method,
  s.platform AS submission_platform,
  s.submitted_at,
  CASE
    WHEN s.response_type IS NOT NULL THEN s.response_type
    WHEN j.status = 'SUBMITTED' AND julianday('now') - julianday(s.submitted_at) > 30 THEN 'likely_ghosted'
    ELSE j.status
  END AS effective_status
FROM jobs j
LEFT JOIN application_submissions s ON s.job_id = j.id
  AND s.id = (SELECT MAX(id) FROM application_submissions WHERE job_id = j.id);
-- Use this view for dashboard display and reporting.
-- jobs.status = lifecycle state, effective_status = what Wolf actually sees.
```

**New indexes:**
- `idx_challenges_job_id` on challenges(job_id)
- `idx_challenges_category` on challenges(category)
- `idx_conductor_queue_status` on conductor_queue(status)
- `idx_conductor_queue_idempotency` on conductor_queue(idempotency_key)
- `idx_cover_letter_versions_job_id` on cover_letter_versions(job_id)
- `idx_submissions_job_id` on application_submissions(job_id)
- `idx_submissions_cover_letter_id` on application_submissions(cover_letter_id)
- `idx_jobs_fingerprint` on jobs(job_fingerprint)
- `idx_bridge_events_job_id` on bridge_events(job_id)
- `idx_prompt_registry_name` on prompt_registry(name, version)

### 5.3 Job JSON Schema (Ingestion Format)

All job sources must normalize to this format before dropping into `/incoming/`:

```json
{
  "company": "Acme Broadcasting",
  "role": "VP Engineering",
  "location": "Los Angeles, CA",
  "remote": true,
  "url": "https://jobs.acme.com/vp-eng",
  "description": "Full job description text...",
  "source": "linkedin",
  "date_found": "2026-03-04T08:00:00Z",
  "contact_email": null,
  "salary_range": "$250K-$300K"
}
```

### 5.4 Status Enum (v2.1 — Lifecycle Only)

The `jobs.status` column tracks **lifecycle only**. Outcomes (interview, rejection, offer, ghosted) live in `application_submissions.response_type`.

**Lifecycle states:**
```
NEW → SCRAPED → SCORED → COVER_LETTER_QUEUED → COVER_LETTER_READY →
PENDING_APPROVAL → APPROVED → SUBMITTING → SUBMITTED → CLOSED
```

**Error states:** `SCORING_FAILED`, `GENERATION_FAILED`, `SUBMISSION_FAILED`, `ERROR_BLOCKED`

**Skip states:** `ARCHIVED` (score too low), `SKIPPED` (Wolf rejected)

**Outcome tracking** (in `application_submissions.response_type`):
`none`, `rejection`, `interview`, `request_info`, `offer`, `ghosted`, `unknown`

**Derived display** (in `job_current_state` view):
The `effective_status` field combines lifecycle + outcome for dashboard display. E.g., a job with `status=SUBMITTED` and `response_type=interview` shows as "Interview" on the dashboard.

**Why this split?** Previous design had outcomes in both `jobs.status` AND `application_submissions.response_type`, causing drift. Now there's one source of truth for each concern.

---

## 6. API REFERENCE

### 6.1 Existing REST Endpoints (Built)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve dashboard HTML |
| GET | `/api/stats` | Pipeline stats: totals, by-status counts, conversion rate |
| GET | `/api/jobs` | List jobs. Params: `?status=SCORED&sort=score` |
| GET | `/api/jobs/:id` | Single job detail |
| POST | `/api/jobs` | Create job. Required: company, title |
| PUT | `/api/jobs/:id` | Update job fields |
| GET | `/api/agents` | List automation agents |
| GET | `/api/errors` | Last 50 errors with job/agent context |
| GET | `/api/template-metrics` | Template version success rates |
| GET | `/api/cover-letter-template` | Raw cover letter template markdown |
| GET | `/api/prompt/:id` | Generate P→P→R prompt for a scored job |

### 6.2 New REST Endpoints (Phase 7-13)

**Command Center v2 (Dashboard)**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v2` | Serve Command Center v2 HTML |

**Personal Info (Tab 2)**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/personal-info` | All KV pairs as JSON object |
| PUT | `/api/personal-info` | Upsert `{ key: value, ... }` |
| GET | `/api/personal-info/:key` | Single value lookup |

**Company Research (Tab 3)**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/research/:jobId` | Research notes for a job |
| PUT | `/api/research/:jobId` | Upsert research notes |
| GET | `/api/research-prompt` | Research prompt template |
| POST | `/api/research/:jobId/copy-prompt` | Generate research prompt with job data substituted |

**Challenges (Tab 4)**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/challenges` | List. Params: `?job_id=N&category=X&search=term` |
| GET | `/api/challenges/:id` | Single challenge |
| POST | `/api/challenges` | Create challenge |
| PUT | `/api/challenges/:id` | Update challenge |
| DELETE | `/api/challenges/:id` | Delete challenge |
| GET | `/api/challenges/reusable` | Reusable answers grouped by category |

**Cover Letter Generator**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/generate-letter/:jobId` | Trigger cover letter generation |
| GET | `/api/letters/:jobId` | All letter versions for a job |
| GET | `/api/letters/:jobId/:version` | Specific version |

**Application Submissions (Tab 5)**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/submissions` | All submissions. Params: `?status=&method=` |
| POST | `/api/submissions` | Record a submission |
| PUT | `/api/submissions/:id` | Update submission (response, follow-up) |

**Conductor**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/conductor/status` | Queue health, pending/active/failed counts, daily generation count |
| GET | `/api/conductor/queue` | Current queue items |
| POST | `/api/conductor/trigger/:taskType` | Manually trigger a task type |
| POST | `/api/conductor/retry/:id` | Retry a failed queue item |

**Content Ingestion (replaces Chrome Bridge)**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/bridge/ingest` | Receive pasted content from dashboard UI. Requires `Authorization: Bearer <BRIDGE_AUTH_TOKEN>`. Validates JSON schema. Logs to `bridge_events` table. |

**ATS Submission (pull-based)**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ats/queue` | List approved jobs ready for ATS submission |
| POST | `/api/ats/start` | Wolf clicks "Start ATS Submissions" → triggers Playwright queue processing |
| POST | `/api/ats/checkpoint/:id` | Save checkpoint data for in-progress ATS form |
| GET | `/api/ats/status` | Current ATS bot status (idle/running/paused) |

### 6.3 MCP Tools (Existing — 9 Tools for Claude Desktop)

| Tool | Purpose | Inputs |
|------|---------|--------|
| `pipeline_stats` | Pipeline overview | — |
| `list_jobs` | Filter/sort jobs | status?, sort?, limit? |
| `get_job` | Full job detail | id |
| `add_job` | Add new job | company, title, description?, source?, url?, notes? |
| `update_job` | Update job fields | id, then any field |
| `log_outcome` | Log interview/rejection | id, outcome, notes? |
| `template_metrics` | Template performance | — |
| `generate_cover_letter_prompt` | P→P→R prompt | id |
| `search_qa_bank` | Search Q&A bank | category?, search? |

### 6.4 New MCP Tools (Phase 7-13)

| Tool | Purpose |
|------|---------|
| `get_personal_info` | Read Wolf's profile data |
| `update_personal_info` | Update profile fields |
| `get_research` | Get company research for a job |
| `save_research` | Save company research notes |
| `add_challenge` | Add a challenge question |
| `search_challenges` | Search reusable challenge answers |
| `conductor_status` | Queue health check |
| `trigger_task` | Manually trigger a pipeline task |

### 6.5 WebSocket Events (Planned)

For real-time dashboard updates. Deferred to after core functionality works — the 60-second auto-refresh is adequate for single-user local use. When implemented:

| Event | Direction | Payload |
|-------|-----------|---------|
| `job:status_changed` | Server → Client | `{ jobId, oldStatus, newStatus }` |
| `queue:item_completed` | Server → Client | `{ queueId, taskType, result }` |
| `error:new` | Server → Client | `{ errorId, agent, message }` |
| `conductor:heartbeat` | Server → Client | `{ queueSize, activeJobs, health }` |

---

## 7. COMMAND CENTER V2 — DASHBOARD TABS

### Tab 1: Pipeline
**Replaces:** Current Overview + Inventory tabs combined

- **Quick Stats:** 4-card grid (Total Jobs, Conversion Rate, Active Interviews, Pending Offers)
- **Status Flow:** Visual columns showing job counts per status (NEW → SCORED → APPROVED → SUBMITTED → INTERVIEW/OFFER)
- **Job Table:** Sortable, filterable by status. Click to expand. "Copy Prompt" button for SCORED jobs
- **Conductor Status:** Small indicator showing queue health (jobs queued / active / failed)

### Tab 2: Personal Info
**New tab**

- Wolf's profile data used by automation to populate forms
- Editable fields: name, email, phone, LinkedIn, location, positioning statement, resume summary, target titles, salary range
- "Save" button → persists to `personal_info` table
- Read by Application Bot when filling ATS forms
- Read by Cover Letter Generator for personalization

### Tab 3: Research Prompt
**New tab**

- Research template for investigating companies before applying
- Left panel: Select a SCORED job from dropdown
- Right panel: Research prompt with company/role substituted + "Copy to Clipboard" button
- Below: Editable research notes fields (company summary, culture, key people, recent news)
- Saved per job to `company_research` table
- Research notes feed into Cover Letter Generator for personalization

### Tab 4: Challenges
**New tab**

- Track application challenge questions (scenario, case study, essay, etc.)
- Card-based layout (not table — better for long Q&A text)
- Each card: Question, Answer (expandable), Category badge, Source company, "Reusable" toggle
- "Add Challenge" button → inline form
- Sidebar: "Reusable Answer Bank" grouped by category — one-click copy
- Searchable by keyword
- Stored in `challenges` table; reusable answers available for future applications

### Tab 5: Applied
**New tab — replaces filtering to APPLIED+ in old Inventory**

- Filter bar: All Applied, Waiting, Interview, Rejected, Offered, Ghosted
- Table: Company, Role, Applied Date, Method, Status, Response, Days Since, Follow-up Date
- Click to expand: cover letter used, research notes, contact info
- Timeline indicator: color-coded by age (green <7d, yellow 7-21d, red >21d no response)
- "Mark as Ghosted" button for jobs >30 days with no response
- Data from `application_submissions` table

### Tab 6: Feedback
**Existing — enhanced**

- Template version comparison table (from `template_metrics` view)
- Conversion rate chart by template version
- "What's Working" section — top patterns from successful applications
- "Time to Response" averages by application method
- Cover letter performance scores
- Weekly summary snapshot

### Dashboard Design Principles
- **Dark theme:** Backgrounds #0d0f14, #161923. Accent blue #4f8ef7, purple #7c5cbf
- **Status colors:** Green #2ecc71 (success), yellow #f39c12 (warning), red #e74c3c (error)
- **Mobile-friendly:** Responsive grid, works on iPhone (Wolf gets traffic from Instagram links)
- **ADHD-friendly:** Bold headers, short text, scannable cards, clear visual hierarchy
- **Auto-refresh:** 60s interval (upgrade to WebSocket later)
- **File structure:** Modular — `COMMAND_CENTER.html` shell + `css/command-center.css` + `js/cc-*.js` per tab

---

## 8. AGENT ROLES & PERMISSIONS

### Role Definitions

| Agent | Role | Runs On |
|-------|------|---------|
| **Lead Agent** (Claude Code) | Orchestrator, builder, pipeline manager | Terminal / Claude Code CLI |
| **Conductor** | Schedule, queue, and state machine | pm2 managed Node.js process |
| **Job Scorer** | Score jobs 0-100 via Claude Haiku, 7 dimensions + explainability | CLI (triggered by Conductor) |
| **Cover Letter Generator** | Generate P→P→R letters via Claude API | API call (triggered by Conductor) |
| **Hallucination Filter** | Verify letter claims against context | Module (called by Generator) |
| **Application Bot** | Fill ATS forms via Playwright | Playwright process (triggered manually or by Conductor) |
| **Gmail MCP** | Send emails, monitor inbox | MCP server (launchd managed) |
| **Feedback Analyzer** | Analyze outcomes, A/B test templates | CLI (triggered by Conductor) |
| **Content Ingestion** | Receive pasted content from dashboard | Dashboard paste UI (user-driven) |
| **Multi-Platform Search** | Scrape jobs from multiple platforms | CLI/scripts (triggered by Conductor) |

### Permission Matrix

| Agent | Read | Write |
|-------|------|-------|
| Lead Agent | Everything | Everything in ~/job-pipeline/ |
| Conductor | pipeline.db, conductor_queue | pipeline.db (status transitions), conductor_queue |
| Job Scorer | jobs table | jobs table (score + score_reasoning + status) via Conductor API |
| Cover Letter Generator | /scored/, jobs, personal_info, company_research | /ready/, cover_letter_versions, jobs (status) |
| Hallucination Filter | /templates/, qa_bank, cover_letter_versions | cover_letter_versions (hallucination_check, flagged_claims) |
| Application Bot | /ready/, jobs, personal_info | application_submissions, jobs (status) |
| Gmail MCP | /ready/*/send_ready/ | /responses/, application_submissions (response fields) |
| Feedback Analyzer | /responses/, jobs, application_submissions | /learnings/, insights.json |
| Content Ingestion | None (user-driven paste) | bridge_events (audit), jobs/research via Conductor API |

### Communication Rules
Agents do NOT call each other directly. Two channels only:
1. **pipeline.db** — state changes, status transitions, queue assignments
2. **Conductor queue** — conductor_queue table for task orchestration

No file-based message bus. No agent-to-agent RPC. Database is the only coordination mechanism.

---

## 9. ERROR PROTOCOL

### The 10-Minute Rule

Every agent follows: **Retry → Self-Heal → Quarantine → Continue**

```
Strike 1: Error occurs.
  → Wait 30 seconds.
  → Retry the operation exactly once.

Strike 2: Fails again.
  → Log to pipeline.db errors table (retry_count = 2).
  → Enter Self-Heal window (max 10 minutes):
      - Check own logs for pattern
      - Attempt one corrective action
      - Retry one final time.

Strike 3: Still failing after self-heal.
  → Update job status to ERROR_BLOCKED.
  → Move job file to ~/job-pipeline/errors/[job_id]/
  → Write detailed error to errors table.
  → Email Wolf: [BLOCKED] Job Pipeline — <agent>: <error summary>
  → CONTINUE processing all other jobs immediately.
```

### Error Classification

| Error Type | Auto-recoverable? | Action |
|------------|-------------------|--------|
| API timeout | Yes | Retry after 30s |
| Malformed JSON | Yes (re-parse) | Self-heal |
| Rate limit | Yes | Exponential backoff |
| Missing template file | No | Quarantine + escalate |
| DB write failure | No | Quarantine + escalate |
| Gmail auth expired | No | Escalate immediately |
| CAPTCHA encountered | Expected | Log, alert Wolf, pause |
| Playwright element not found | Partial | Retry once, then pause for Wolf |

### What Never Auto-Recovers
- Auth/credential failures → always escalate to Wolf
- Same error type 3+ times in 24h → escalate even if individual retries succeed

---

## 10. LOCKED-IN TECHNICAL DECISIONS

All confirmed by Wolf on 2026-03-05:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ATS submission | Playwright in headed mode, **pull-based** | Wolf clicks "Start ATS Submissions" on dashboard, watches on 2nd monitor |
| Browser connection | **CDP connect to warm browser** (`connectOverCDP()`) | Inherits trusted fingerprint, avoids bot detection by ATS systems |
| Cover letters | **Two-call Extract→Assemble** + hallucination safety net | Eliminates hallucination retry loops, pre-approved facts only |
| Dashboard | Rebuild as Command Center v2 (6 tabs) | Fresh start with new tab structure |
| Orchestrator | **Conductor (native polling loop + node-cron)** | No better-queue (abandoned). setInterval + BEGIN EXCLUSIVE every 5s |
| Content ingestion | **Dashboard paste UI** (no Chrome extension) | Unbreakable, no extension maintenance, works with any AI tool |
| Job queue backend | **Native SQLite queue** (no Redis, no better-queue) | Zero deps, total control, trivially debuggable |
| DB writer pattern | **Conductor is single DB writer** | Other components POST to Conductor API. Eliminates SQLite lock contention |
| Process management | pm2 + macOS launchd | pm2 for Conductor, launchd for auto-start |
| Database | SQLite with WAL mode (no change) | Already proven in Phase 1-6 |
| Gmail OAuth | Wolf sets up (prior experience) | Required for Gmail MCP server. Dashboard shows auth status indicator |
| Anthropic API key | Wolf has one | Required for cover letter generation + scoring |
| Display setup | Dual monitors | Playwright visible on 2nd display |
| Resume location | `job-pipeline/templates/` | Wolf will place PDF here |
| Model for cover letters | Claude Sonnet (via Anthropic SDK) | Balance of quality and cost |
| Model for scoring | **Claude Haiku** (~$0.001/job) | Contextual accuracy prevents expensive downstream waste |
| Platform adapters | **Greenhouse + Lever + Generic** (V1) | Each adapter defines field mapping, upload, submit detection |
| Daily circuit breaker | **Max 5 cover letters/day** | Overflow holds in queue. Prevents overnight budget burst |
| Budget caps | **$2/day + $55/month** | Per-operation token limits tracked in conductor_queue |

---

## 11. COST MODEL

### Monthly Budget

| Item | Cost |
|------|------|
| Claude Pro subscription (Wolf's existing) | $20/month |
| Claude API — job scoring via Haiku (~50/week × $0.001) | ~$0.20/month |
| Claude API — cover letters via Sonnet (~20/week × $0.30 avg, 2 calls each) | ~$24/month |
| Claude API — hallucination filter safety net (~20/week × $0.05) | ~$4/month |
| Claude API — feedback analysis | ~$3/month |
| **Total** | **~$51/month** |

### Cost Controls
- **Daily budget cap: $2/day** (hard stop — Conductor pauses all API tasks if exceeded)
- **Monthly ceiling: $55/month** (configurable — Conductor pauses generation, emails Wolf)
- **Daily circuit breaker: max 5 cover letter generations/day** (overflow holds in COVER_LETTER_QUEUED, processes next day)
- **Per-operation max tokens:** scoring=2K, extraction=4K, assembly=4K, hallucination filter=2K
- **Regen loop limit:** max 2 retries per letter, then flag as DRAFT (never infinite loop)
- Token tracking: per-operation cost stored in `cover_letter_versions.cost_estimate` and `conductor_queue` logs
- Dashboard shows running cost total (daily + monthly)

### Cost Comparison vs Manual
- Wolf's time at VP rate (~$150/hr equivalent): 4-6 hrs/day × 22 days = $13K-$20K/month in opportunity cost
- Pipeline cost: ~$51/month + 30 min/day of Wolf's time
- ROI: massive

---

## 12. BUILD SEQUENCE (Phases 7-13)

### Phase 7 — Command Center v2 Dashboard

**Goal:** Replace v1 dashboard with 6-tab Command Center.

```
7A: Database migration (new tables + columns, additive only)
7B: New API endpoints (personal info, research, challenges, submissions)
7C: Dashboard shell + Tab 1 (Pipeline — port existing functionality)
7D: Tabs 2-4 (Personal Info, Research Prompt, Challenges)
7E: Tabs 5-6 (Applied, Feedback — enhanced)
7F: Mobile responsive testing + polish
7G: Merge new tests into test suite
```

**Test gate:** All 6 tabs render, all new endpoints return correct data, all old tests still pass, mobile viewport works.

### Phase 8 — Cover Letter Generator + Hallucination Filter

**Goal:** Replace Cowork with API-driven two-call Extract→Assemble generation pipeline.

```
8A: Anthropic SDK integration + two-call generation endpoint
     - Call 1: Extract approved facts from context files → JSON
     - Call 2: Assemble P→P→R letter from facts only
8B: Hallucination filter module with Claim Schema
     - Hard claims (numbers, dates, companies) require evidence linkage
     - Soft claims (general statements) allowed
     - Flagged claims logged; Wolf can override on dashboard
8C: Self-scoring loop (assemble → filter → score → retry max 2x)
8D: cover_letter_versions table tracking + prompt_registry versioning
8E: Dashboard integration (show letter versions, scores, flagged claims, override button)
8F: Daily circuit breaker (max 5 generations/day) + per-operation token limits
```

**Test gate:** Generate letter for seed job using two-call pattern. Extraction returns JSON with source references. Hallucination filter catches a planted false claim (hard claim with no evidence). Self-score works. Versions tracked in DB. Circuit breaker blocks 6th generation in same day.

### Phase 9 — Conductor (Orchestrator)

**Goal:** Central brain driving the entire pipeline. Single DB writer — all other components POST to Conductor API.

```
9A: Native polling loop (setInterval 5s + BEGIN EXCLUSIVE transaction)
9B: node-cron scheduler (scraping, digest, response check, weekly report)
9C: State machine for job lifecycle transitions (lifecycle-only status enum)
9D: Idempotency enforcement (idempotency_key unique constraint, checkpoint for non-idempotent tasks)
9E: Daily circuit breaker logic (max 5 cover letters/day, $2/day budget cap)
9F: Queue health monitoring + stall detection
9G: pm2 configuration for process management
9H: Dashboard Conductor status panel (queue depth, daily cost, generation count)
9I: Job fingerprint dedup check on ingestion (normalized company+title+location, 90-day window)
```

**Test gate:** Conductor starts, processes a test job through score → generate → ready. Polling loop picks up queued tasks. Queue survives restart (pm2 restart). Stall alert fires. Duplicate job (same fingerprint within 90 days) is blocked. 6th cover letter generation in same day is held in queue.

### Phase 10 — Application Bot (Playwright + Platform Adapters)

**Goal:** Automated form filling with human supervision. Pull-based (Wolf clicks "Start").

```
10A: Playwright CDP setup (connectOverCDP to warm browser on port 9222)
10B: Platform adapter layer (conductor/platform_adapters/)
     - greenhouse.js: login state, field mapping, upload, submit detection
     - lever.js: multi-step flow, field mapping
     - generic.js: best-effort for simple HTML forms
10C: Standard form field filling (name, email, resume upload)
10D: Cover letter paste + Q&A field filling
10E: Multi-page flow handling with checkpoint after each page
10F: Pause-before-submit gate (Wolf confirms)
10G: CAPTCHA detection (pause and alert)
10H: "Start ATS Submissions" button on dashboard (pull-based trigger)
10I: Non-idempotent safety: dedup check before filling, immediate DB write after submit
10J: Integration with Conductor queue (checkpoint data in conductor_queue.checkpoint)
```

**Test gate:** Bot connects to running Chrome via CDP. Greenhouse adapter fills a test form correctly. Bot checkpoints after page 1 of multi-page form. Wolf can see it on 2nd monitor. Bot pauses at submit. Resume uploads. Duplicate submission to same company+role is blocked.

### Phase 11 — Gmail MCP Server

**Goal:** Email monitoring and autonomous sending after approval.

```
11A: Google OAuth setup (Gmail API credentials)
     - Push to Production status OR use App Password + IMAP (avoids 7-day token expiry)
11B: Inbox polling (15-min cycle)
11C: Response parsing with confidence scoring
     - Classifications: rejection, interview, request_info, offer, ghosted, unknown
     - Confidence score 0-1 per classification
     - Low confidence (<0.7) → flagged for Wolf's manual review on dashboard
     - Store raw email text + parsed result + confidence in DB
11D: Autonomous email send (after Wolf approval via one-click localhost link)
11E: Verification code extraction (for ATS account creation)
11F: Integration with Conductor schedule
11G: Dashboard Gmail Auth Status indicator (connected/expired + re-auth link)
```

**Test gate:** OAuth works (or App Password connects). Inbox check retrieves test email. Response parser correctly classifies rejection (high confidence) and ambiguous email (low confidence → "unknown"). Dashboard shows Gmail auth status. Send works for approved job.

### Phase 12 — Content Ingestion (Dashboard Paste UI)

**Goal:** Wolf can paste content from any AI tool into the pipeline via the dashboard.

```
12A: "Import Content" panel on Command Center dashboard
     - Content type selector (cover_letter, research, qa_answers, resume_notes)
     - Target job selector (dropdown of active jobs)
     - Textarea for pasting content
     - "Import" button
12B: Express endpoint /api/bridge/ingest with bearer token auth
     - BRIDGE_AUTH_TOKEN env var
     - JSON schema validation (content_type, job_id, content required; max 50KB)
12C: bridge_events audit table (append-only logging)
12D: Dashboard notification when content ingested ("Content imported for Job #123")
12E: Conductor processes ingested content (routes to correct table based on content_type)
```

**Test gate:** Paste cover letter text into dashboard UI. POST succeeds with valid token, fails without. Schema validation rejects missing fields. bridge_events table logs the event. Content appears on correct job record. Oversized payload (>50KB) rejected.

### Phase 13 — Multi-Platform Search + Hardening

**Goal:** Expand job sources and harden the entire system.

```
13A: Indeed scraper/API integration
13B: Glassdoor scraper/API integration
13C: Executive recruiter board integration
13D: Company career page monitor (targeted list)
13E: Duplicate detection across all sources (company + role within 90 days)
13F: Full error protocol for all new agents
13G: End-to-end test: discover → score → generate → approve → submit → response → feedback
13H: Token cost tracking dashboard
13I: launchd plists for all services
13J: Wolf signs off: "Pipeline is live."
```

**Test gate:** Jobs arrive from 2+ sources, dedup works, full pipeline runs end-to-end.

---

## 13. QUALITY STANDARDS

### Cover Letter (Non-Negotiable)
- Opens with a problem statement (never "I am writing to apply")
- Problem→Product→Result structure throughout
- Wolf's authentic voice — servant leadership, systems thinking, empowerment
- Under 350 words (400 absolute max)
- Specific to this company and role
- Zero AI clichés: no "delve", "leverage", "utilize", "synergy", "passionate about"
- Self-score ≥7/10 before saving
- Hallucination filter: PASS (no unverified claims)

### Wolf's 3 Key Stories (for P→P→R)
1. **Ownership Culture** — Post-merger, unified 250 engineers, 6-point accountability framework, leaders ask questions not directives → self-organizing teams
2. **Developing the Developer** — Weekly coaching (not status updates), let them fail safely → now leads their own team
3. **The Complex Mind** — "Difficult" engineer was just unheard. Gave ownership + protection from politics → highest performer, now mentors others

### Wolf's Positioning
- Product: "Leadership for leaders — empowerment, people development, ownership culture"
- Frame: Problem→Product→Result in every outbound communication
- Never lead with Wolf's title. Lead with the problem Wolf solves.
- International perspective: Germany → UK → US (three cultural contexts)
- High-stakes credibility: Live broadcast, U2/Rolling Stones touring (failure visible to millions)

### Job Scoring (Claude Haiku)
- Score 0–100 (never null)
- **Explainability output:** Every score includes per-dimension breakdown explaining "why this scored 82"
  - Example: `{ leadership: 22/25, seniority: 18/20, industry: 10/15, culture: 12/15, transformation: 8/10, scope: 8/10, location: 4/5, total: 82, reasoning: "Strong people leadership focus, VP-level scope, media/broadcast industry match..." }`
- Fit label: HIGH (≥75) / MEDIUM (50–74) / SKIP (<50)
- Red flag detection: "hold accountable", "move fast break things", "hands-on coding required", "10x engineer"
- 7 dimensions: Leadership (25%), Seniority (20%), Industry (15%), Culture (15%), Transformation (10%), Scope (10%), Location (5%)
- Stored in `jobs.score` (integer) and `jobs.score_reasoning` (JSON breakdown)

---

## 14. FOLDER STRUCTURE

```
~/job-pipeline/
├── docs/                    ← Architecture docs (this file)
│   └── MASTER-ARCHITECTURE-v2.md
├── incoming/                ← New job JSONs from all sources
├── scored/                  ← HIGH/MEDIUM scored jobs
├── archived/                ← SKIP scored jobs (<50)
├── tasks/                   ← Task files for agent coordination
├── ready/                   ← Complete application packages (artifacts only)
│   └── [job_id]/
│       ├── cover_letter.md
│       ├── resume_bullets.md
│       ├── qa_answers.md
│       └── metadata.json
│       # NOTE: Approval state lives in DB (jobs.approved_at), NOT filesystem.
│       # No approved.flag — folders are storage, DB is truth.
├── applied/                 ← Submitted applications (archived)
├── responses/               ← Parsed email responses
├── errors/                  ← Quarantined failed jobs
├── logs/                    ← Session logs, handoffs, health checks
├── learnings/               ← insights.json, weekly reports
├── templates/               ← Wolf's context files
│   ├── capability_profile.md
│   ├── master_resume.md (or .pdf)
│   ├── qa_bank.json
│   └── cover_letter_examples/
├── prompts/                 ← Prompt templates
│   ├── cover-letter-template.md
│   └── research-template.md
├── css/                     ← Command Center v2 styles
│   └── command-center.css
├── js/                      ← Command Center v2 modules
│   ├── cc-core.js
│   ├── cc-pipeline.js
│   ├── cc-personal.js
│   ├── cc-research.js
│   ├── cc-challenges.js
│   ├── cc-applied.js
│   └── cc-feedback.js
├── conductor/               ← Conductor orchestrator (single DB writer)
│   ├── index.js             ← Entry point, Express API for internal writes
│   ├── state-machine.js     ← Lifecycle transitions
│   ├── scheduler.js         ← Native polling loop (setInterval 5s + BEGIN EXCLUSIVE)
│   └── platform_adapters/   ← ATS platform-specific form filling
│       ├── greenhouse.js
│       ├── lever.js
│       └── generic.js
├── server.js                ← Express API server
├── init-db.js               ← Database initialization
├── migrate-v2.js            ← Additive migration for new tables
├── job-scorer.js            ← Job scoring CLI
├── mcp-server.js            ← MCP tools for Claude Desktop
├── feedback-analyzer.js     ← Template version analysis
├── test-all.js              ← Integration test suite
├── test-v2.js               ← v2 endpoint tests
├── COMMAND_CENTER.html      ← New 6-tab dashboard
├── PIPELINE_DASHBOARD.html  ← Old dashboard (backup)
├── pipeline.db              ← SQLite database
├── package.json             ← Dependencies
├── AGENT_CHARTER_v2.md      ← Original agent charter
├── PIPELINE_ARCHITECTURE.md ← Original architecture doc
├── BUILD_SEQUENCE.md        ← Original build sequence
├── NOTES.md                 ← Implementation notes
├── LESSONS_LEARNED.md       ← Playbook
└── README.md                ← Quick start
```

---

## 15. OPEN QUESTIONS & KNOWN RISKS

### Open Questions
1. **Resume PDF filename** — Wolf will place it in `templates/`. Exact filename TBD.
2. **Context files** — `capability_profile.md` and `cover_letter_examples/` need to be created or copied from Wolf's existing docs. Required for hallucination filter.
3. **Gmail OAuth credentials** — Wolf will set up Google Cloud project and provide OAuth client ID/secret.
4. **Indeed/Glassdoor access** — Some platforms have anti-scraping measures. May need official API access or alternative approaches.
5. **Anthropic API budget** — The $51/month estimate assumes ~20 letters/week. If volume increases, budget may need adjustment.

### Known Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ATS platforms detect Playwright | Application blocked or flagged | **CDP connect to warm browser** (trusted fingerprint), headed mode, human speed, Wolf watches |
| LinkedIn changes DOM (breaks scrapers) | Ingestion stalls | 24h alert, multiple sources, manual fallback |
| Gmail OAuth 7-day token expiry | Email monitoring stops weekly | Push Google Cloud project to Production status, OR use App Password + IMAP. Dashboard shows auth status indicator + re-auth link |
| Hallucination filter false positives | Good letters rejected | Two-call Extract→Assemble pattern minimizes triggers. Claim Schema: soft claims always pass. Wolf can override hard claim flags with one click |
| Budget burst (overnight batch) | $25+ API bill overnight | **Daily circuit breaker:** max 5 cover letters/day, $2/day budget cap, overflow queues for next day |
| SQLite lock contention | DB write failures, dashboard freezes | **Single DB writer pattern:** Conductor owns all writes, other components POST to Conductor API |
| SQLite WAL growth | Disk usage | Periodic VACUUM, monitor file size |
| Anthropic API rate limits | Generation delayed | Queue with backoff, batch during off-peak |
| Cover letter quality drift | Wolf's voice becomes generic | Prompt versioning via `prompt_registry` table. Regular review, template iteration |
| ATS double-apply | Looks unprofessional | Non-idempotent tasks have do-not-repeat guards + `job_fingerprint` dedup (90-day window) |
| Gmail classification errors | Wrong outcome tracking | **Confidence scoring:** low confidence → "unknown" → manual review. Raw email stored for correction |
| pm2 crash without restart | Conductor stops | launchd watches pm2, auto-restart on failure |

### Architecture Risks (For External Reviewer)
1. **Single machine dependency** — If M3 Max is unavailable, entire pipeline stops. Mitigation: all state in SQLite (portable), no cloud lock-in.
2. **SQLite concurrency** — Solved by single-writer pattern. Conductor is the only process that writes to the database. All other components (CLI, dashboard API, Playwright) POST to the Conductor's Express API.
3. **Playwright fragility** — ATS platforms change DOM frequently. Mitigation: **platform adapter layer** isolates platform-specific selectors. Greenhouse + Lever adapters for V1. Headed mode means Wolf sees failures immediately.
4. **Scope creep** — 13 phases is ambitious for a solo operator. Mitigation: each phase is independently functional. Wolf can stop at any phase and have a working system.
5. **Prompt regression** — Iterating prompts without tracking causes "it worked yesterday" bugs. Mitigation: `prompt_registry` table with version tracking. Every LLM call records which prompt version + model version was used.

---

## 16. WHAT SUCCESS LOOKS LIKE

### Minimum Viable Pipeline (Phase 7-9 complete)
- Wolf opens Command Center v2, sees all jobs organized across 6 tabs
- Conductor automatically scores new jobs and generates cover letters
- Wolf reviews daily digest, approves with one click
- Cover letters pass hallucination filter before Wolf ever sees them
- All data tracked in SQLite with full history

### Full Automation (Phase 7-13 complete)
- Jobs discovered automatically from 4+ platforms
- Scored, letters generated, research compiled — all before Wolf wakes up
- Daily digest at 7am with everything ready to approve
- Approved email applications sent automatically
- ATS applications filled by Playwright, Wolf confirms on 2nd monitor
- Responses parsed, outcomes tracked, templates iterated
- Wolf's total daily involvement: ~30 minutes

---

*End of MASTER-ARCHITECTURE-v2.md*
*This is the single source of truth. All other docs are supporting material.*
*Hand this to any reviewer — they should be able to identify every gap.*
