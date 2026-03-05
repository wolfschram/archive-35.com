# MASTER ARCHITECTURE — Job Pipeline v2.0
# Wolf Schram · Automated Job Search & Application System
# ─────────────────────────────────────────────────────────
# PURPOSE: Single source of truth for the entire system.
# Covers all components (built + planned), all decisions,
# all data flows, and the complete build sequence.
# Hand this document to ANY reviewer (human or AI) and they
# should be able to identify gaps, contradictions, or risks.
# ─────────────────────────────────────────────────────────
# Version: 2.0 · Last updated: 2026-03-05
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

2. **Database is truth. Folders are storage.** `pipeline.db` (SQLite) owns all state. Folders hold files for reference only. No agent decides based on folder contents alone.

3. **Never stop the pipeline.** One failed job never blocks others. Retry → Self-Heal → Quarantine → Continue. Always.

4. **Wolf approves outbound. Machine handles everything else.** The only hard human gates: approving cover letters and confirming application submissions.

5. **Cost-conscious automation.** Claude API for scoring + cover letter generation + hallucination filtering. Budget: ~$50/month API ceiling. Track costs per operation.

---

## 3. COMPONENT MAP

### 3.1 Built Components (Phase 1-6 — Complete)

| # | Component | Technology | File(s) | Status |
|---|-----------|-----------|---------|--------|
| 1 | **Express API Server** | Node.js + Express 4.21 | `server.js` | COMPLETE — 11 REST endpoints, port 3000 |
| 2 | **SQLite Database** | better-sqlite3 + WAL mode | `pipeline.db` via `init-db.js` | COMPLETE — 4 tables, 1 view, 4 indexes |
| 3 | **Job Scorer** | Node.js CLI, keyword-based | `job-scorer.js` | COMPLETE — 7-dimension scoring, 0-100 scale |
| 4 | **MCP Server** | Node.js, JSON-RPC 2.0 | `mcp-server.js` | COMPLETE — 9 tools for Claude Desktop |
| 5 | **Feedback Analyzer** | Node.js CLI | `feedback-analyzer.js` | COMPLETE — Template version A/B tracking |
| 6 | **Dashboard v1** | Single-file HTML/CSS/JS | `PIPELINE_DASHBOARD.html` | COMPLETE — 5-tab SPA, dark theme, auto-refresh |
| 7 | **Cover Letter Template** | Markdown prompt | `prompts/cover-letter-template.md` | COMPLETE — P→P→R framework |
| 8 | **Test Suite** | Node.js integration tests | `test-all.js` | COMPLETE — 86 assertions across 7 categories |

### 3.2 Planned Components (Phase 7-13 — To Build)

| # | Component | Technology | Purpose |
|---|-----------|-----------|---------|
| 9 | **Command Center v2** | HTML/CSS/JS modular files | New 6-tab dashboard replacing v1 (§6.1) |
| 10 | **Conductor** | Node.js, better-queue, node-cron | Pipeline orchestrator — schedules, queues, state machine (§3.3) |
| 11 | **Chrome Bridge Extension** | Manifest V3, Chrome APIs | Bridges Claude browser extension ↔ Express API for file drop-off (§3.4) |
| 12 | **Application Bot** | Playwright (headed mode) | Form filling, file upload, ATS navigation — Wolf watches on 2nd monitor (§3.5) |
| 13 | **Cover Letter Generator** | Anthropic SDK (Claude API) | Direct API calls + hallucination filter, replaces Cowork (§3.6) |
| 14 | **Gmail MCP Server** | Node.js, Google OAuth | Inbox monitoring, response parsing, verification code extraction (§3.7) |
| 15 | **Hallucination Filter** | Node.js + context file comparison | Verifies cover letter claims against Wolf's actual experience files (§3.8) |
| 16 | **Multi-Platform Search** | Node.js scrapers/API clients | LinkedIn, Indeed, Glassdoor, executive recruiter boards (§3.9) |

### 3.3 Conductor (Orchestrator)

**Purpose:** Central brain that coordinates all pipeline operations on a schedule.

**Technology:** Node.js process using `better-queue` (SQLite-backed job queue) + `node-cron` for scheduling. No Redis.

**Responsibilities:**
- Schedule job scraping runs (configurable cron)
- Queue jobs for scoring as they arrive
- Queue cover letter generation for scored HIGH/MEDIUM jobs
- Trigger daily digest email at 7am
- Monitor Gmail every 15 minutes for responses
- Track queue health and alert on stalls
- Manage state machine transitions for each job

**State machine (per job):**
```
NEW → SCRAPED → SCORED → COVER_LETTER_QUEUED → COVER_LETTER_READY →
PENDING_APPROVAL → APPROVED → SUBMITTING → SUBMITTED →
RESPONSE_RECEIVED → [INTERVIEW | REJECTED | GHOSTED | OFFER]
```

**Error states:** `SCORING_FAILED`, `GENERATION_FAILED`, `SUBMISSION_FAILED`, `ERROR_BLOCKED`

**Process management:** pm2 for the Conductor process + macOS launchd for auto-start on login.

### 3.4 Chrome Bridge Extension

**Purpose:** Minimal Manifest V3 extension that allows the Claude browser extension to drop files (cover letters, Q&A sheets, research notes) to the Express API.

**Scope (intentionally narrow):**
- Intercept specific Claude browser extension output
- POST file contents to `localhost:3000/api/bridge/upload`
- No scraping, no form filling, no page manipulation
- Passive — triggered only by user action in Claude browser

**Why needed:** Claude's browser extension can research companies and draft content, but has no way to push that content into the pipeline database. This bridge closes that gap.

### 3.5 Application Bot (Playwright)

**Purpose:** Automate ATS form filling in a visible browser. Wolf watches on secondary monitor.

**Technology:** Playwright in headed mode (visible browser window) with a separate Chrome profile.

**Capabilities:**
- Navigate to ATS portal URLs
- Fill standard form fields (name, email, phone, LinkedIn, location)
- Upload resume PDF from `job-pipeline/templates/`
- Paste cover letter text into cover letter fields
- Fill Q&A responses from pre-generated answers
- Handle multi-page application flows
- Pause before final submit for Wolf's confirmation

**Configuration:**
- Separate Chrome profile (doesn't touch Wolf's main browser)
- Runs on secondary display (dual-monitor setup confirmed)
- Playwright in headed mode — Wolf can see exactly what it's doing
- Human gate: Bot fills forms but does NOT click Submit unless Wolf confirms

**What it does NOT do:**
- CAPTCHA solving (pauses and alerts Wolf)
- Account creation on new ATS platforms (Wolf does manually first time)
- Bypass bot detection (runs in headed mode at human speed)

### 3.6 Cover Letter Generator

**Purpose:** Generate tailored P→P→R cover letters using Claude API directly.

**Technology:** Anthropic SDK (`@anthropic-ai/sdk`), Claude Sonnet model.

**Flow:**
1. Receive scored job data + company research notes
2. Load Wolf's context files (capability_profile.md, cover_letter_examples/)
3. Call Claude API with P→P→R prompt template + job-specific data
4. Run hallucination filter (§3.8) on output
5. Self-score output (must be ≥7/10)
6. If <7, regenerate once with feedback
7. If second attempt <7, flag as DRAFT for Wolf's review
8. Store in database + write to `/ready/[job_id]/`

**Why API instead of Cowork:**
- Fully automatable (no manual copy-paste)
- Enables hallucination filter pipeline
- Enables batch generation
- Cost: ~$0.15–$0.50 per letter (Claude Sonnet)

### 3.7 Gmail MCP Server

**Purpose:** Read-only inbox monitoring + approved email sending.

**Technology:** Node.js, Google Gmail API, OAuth 2.0.

**Account:** jobs.wolfschram@gmail.com

**Capabilities:**
- Monitor inbox every 15 minutes for application responses
- Parse response type: REJECTION, INTERVIEW, REQUEST_INFO, OFFER
- Extract verification codes from account creation emails
- Send pre-approved cover letters + resume after Wolf approves
- Label and categorize job-related emails

**OAuth:** Wolf has prior experience with Google Cloud Console / OAuth setup.

**Cannot do without Wolf's approval:**
- Send any email not staged in approved queue
- Delete emails
- Change account settings

### 3.8 Hallucination Filter

**Purpose:** Verify that AI-generated cover letters only claim things Wolf has actually done.

**How it works:**
1. Parse cover letter for factual claims (dates, numbers, company names, technologies, outcomes)
2. Compare each claim against Wolf's context files:
   - `templates/capability_profile.md` — verified career history
   - `templates/cover_letter_examples/` — approved stories
   - qa_bank table — verified Q&A answers
3. Flag any claim not found in context files
4. Return pass/fail + list of unverified claims
5. On fail: regenerate with explicit instruction to only use verified facts

**Why this matters:** At the VP level, a single fabricated claim in a cover letter can end a candidacy permanently. This filter prevents the AI from "hallucinating" accomplishments Wolf never had.

### 3.9 Multi-Platform Search

**Purpose:** Discover jobs across multiple platforms, not just LinkedIn/Thunderbit.

**Platforms:**
- LinkedIn (primary — existing Thunderbit flow continues)
- Indeed (API or scraper)
- Glassdoor (API or scraper)
- Executive recruiter boards (custom)
- Company career pages (targeted list)

**Ingestion format:** All sources normalize to the standard job JSON schema (§5.3) and drop into `/incoming/`.

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
│  Multi-platform scrapers → Normalize to JSON → /incoming/           │
│  24h empty alert → Email Wolf if no new jobs                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  JOB SCORER                                                         │
│  7-dimension keyword analysis (local, no API)                       │
│  Score 0–100 → HIGH (≥75) / MEDIUM (50–74) / SKIP (<50)           │
│  SKIP → /archived/    HIGH/MEDIUM → /scored/ + DB status: SCORED   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COVER LETTER GENERATOR (Claude API + Anthropic SDK)                │
│  Load context files → Generate P→P→R letter → Hallucination filter │
│  Self-score ≥7/10 → /ready/[job_id]/                               │
│  <7 after 2 tries → DRAFT for Wolf review                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  🧑 WOLF APPROVAL (Human Gate #1)                                   │
│  Daily digest email at 7am → Wolf replies YES / NO / EDIT           │
│  Approved jobs → status: APPROVED                                   │
└──────────┬───────────────────────────────┬──────────────────────────┘
           │                               │
     Email jobs                       ATS portal jobs
           │                               │
           ▼                               ▼
┌──────────────────────┐    ┌──────────────────────────────────────┐
│  GMAIL MCP           │    │  🧑 APPLICATION BOT (Human Gate #2)  │
│  Sends cover letter  │    │  Playwright fills forms               │
│  + resume            │    │  Wolf watches on 2nd monitor          │
│  Fully autonomous    │    │  Wolf confirms submit                 │
│  after approval      │    │  ATS with CAPTCHA → Wolf handles      │
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
Conductor (node-cron + better-queue + state machine)
├── Every 4 hours: Trigger multi-platform job scraping
├── On new job in /incoming/: Queue for scoring
├── On job scored HIGH/MEDIUM: Queue for cover letter generation
├── 7:00 AM daily: Compile and send daily digest
├── Every 15 min: Trigger Gmail response check
├── Every Sunday 8am: Trigger weekly feedback report
├── Continuous: Monitor queue health, retry failed items
└── On error: Retry → Self-Heal → Quarantine → Continue
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
                   CHECK(status IN ('NEW','SCRAPED','SCORED','APPLIED',
                   'INTERVIEW','REJECTED','OFFER')),
  score            INTEGER,
  source           TEXT,
  url              TEXT,
  cover_letter     TEXT,
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
CREATE VIEW template_metrics AS
SELECT template_version,
  COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')) AS total_applied,
  COUNT(*) FILTER (WHERE status = 'INTERVIEW') AS interviews,
  COUNT(*) FILTER (WHERE status = 'OFFER') AS offers,
  COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejections,
  ROUND(
    CAST(COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) AS REAL) /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')), 0) * 100, 1
  ) AS conversion_rate
FROM jobs GROUP BY template_version;
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
  job_id         INTEGER REFERENCES jobs(id),
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

**Table: `conductor_queue`** — better-queue persistence
```sql
CREATE TABLE conductor_queue (
  id          TEXT PRIMARY KEY,
  job_id      INTEGER REFERENCES jobs(id),
  task_type   TEXT NOT NULL CHECK(task_type IN ('score','generate_letter',
              'submit_email','submit_ats','check_response','scrape')),
  priority    INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'queued' CHECK(status IN ('queued','processing',
              'completed','failed','blocked')),
  payload     TEXT,          -- JSON blob with task-specific data
  retry_count INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  started_at  TEXT,
  completed_at TEXT,
  error       TEXT
);
```

**Table: `cover_letter_versions`** — Track all generated letter drafts
```sql
CREATE TABLE cover_letter_versions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            INTEGER NOT NULL REFERENCES jobs(id),
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

**New indexes:**
- `idx_challenges_job_id` on challenges(job_id)
- `idx_challenges_category` on challenges(category)
- `idx_conductor_queue_status` on conductor_queue(status)
- `idx_cover_letter_versions_job_id` on cover_letter_versions(job_id)
- `idx_submissions_job_id` on application_submissions(job_id)

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

### 5.4 Status Enum (Expanded for v2)

The jobs.status column needs to expand for the full lifecycle:

```
NEW → SCRAPED → SCORED → COVER_LETTER_QUEUED → COVER_LETTER_READY →
PENDING_APPROVAL → APPROVED → SUBMITTING → SUBMITTED →
RESPONSE_RECEIVED → [INTERVIEW | REJECTED | GHOSTED | OFFER]
```

Error states: `SCORING_FAILED`, `GENERATION_FAILED`, `SUBMISSION_FAILED`, `ERROR_BLOCKED`

Skip states: `ARCHIVED` (score too low), `SKIPPED` (Wolf rejected)

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
| GET | `/api/conductor/status` | Queue health, pending/active/failed counts |
| GET | `/api/conductor/queue` | Current queue items |
| POST | `/api/conductor/trigger/:taskType` | Manually trigger a task type |
| POST | `/api/conductor/retry/:id` | Retry a failed queue item |

**Chrome Bridge**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/bridge/upload` | Receive content from Chrome Bridge extension |

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
| **Job Scorer** | Score jobs 0-100, 7 dimensions | CLI (triggered by Conductor) |
| **Cover Letter Generator** | Generate P→P→R letters via Claude API | API call (triggered by Conductor) |
| **Hallucination Filter** | Verify letter claims against context | Module (called by Generator) |
| **Application Bot** | Fill ATS forms via Playwright | Playwright process (triggered manually or by Conductor) |
| **Gmail MCP** | Send emails, monitor inbox | MCP server (launchd managed) |
| **Feedback Analyzer** | Analyze outcomes, A/B test templates | CLI (triggered by Conductor) |
| **Chrome Bridge** | Receive content from Claude browser | Chrome extension (passive) |
| **Multi-Platform Search** | Scrape jobs from multiple platforms | CLI/scripts (triggered by Conductor) |

### Permission Matrix

| Agent | Read | Write |
|-------|------|-------|
| Lead Agent | Everything | Everything in ~/job-pipeline/ |
| Conductor | pipeline.db, conductor_queue | pipeline.db (status transitions), conductor_queue |
| Job Scorer | /incoming/, jobs table | /scored/, /archived/, jobs table (score + status) |
| Cover Letter Generator | /scored/, jobs, personal_info, company_research | /ready/, cover_letter_versions, jobs (status) |
| Hallucination Filter | /templates/, qa_bank, cover_letter_versions | cover_letter_versions (hallucination_check, flagged_claims) |
| Application Bot | /ready/, jobs, personal_info | application_submissions, jobs (status) |
| Gmail MCP | /ready/*/send_ready/ | /responses/, application_submissions (response fields) |
| Feedback Analyzer | /responses/, jobs, application_submissions | /learnings/, insights.json |
| Chrome Bridge | None (passive receiver) | /incoming/ (POST to API only) |

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
| ATS submission | Playwright in headed mode | Wolf watches on 2nd monitor, confirms submit |
| Chrome profile | Separate profile for Playwright | Doesn't interfere with Wolf's logged-in sessions |
| Cover letters | Claude API direct + hallucination filter | Fully automatable, enables verification pipeline |
| Dashboard | Rebuild as Command Center v2 (6 tabs) | Fresh start with new tab structure |
| Orchestrator | Conductor (better-queue + node-cron) | Central brain for scheduling and state management |
| Chrome Bridge | Yes, build it | Closes the gap between Claude browser and pipeline |
| Job queue backend | better-queue + SQLite (no Redis) | Minimal deps, single-file persistence |
| Process management | pm2 + macOS launchd | pm2 for Conductor, launchd for auto-start |
| Database | SQLite with WAL mode (no change) | Already proven in Phase 1-6 |
| Gmail OAuth | Wolf sets up (prior experience) | Required for Gmail MCP server |
| Anthropic API key | Wolf has one | Required for cover letter generation |
| Display setup | Dual monitors | Playwright visible on 2nd display |
| Resume location | `job-pipeline/templates/` | Wolf will place PDF here |
| Model for cover letters | Claude Sonnet (via Anthropic SDK) | Balance of quality and cost |
| Model for scoring | Local keyword-based (no API) | Already built, zero cost |

---

## 11. COST MODEL

### Monthly Budget

| Item | Cost |
|------|------|
| Claude Pro subscription (Wolf's existing) | $20/month |
| Claude API — cover letters (~20/week × $0.30 avg) | ~$24/month |
| Claude API — hallucination filter (~20/week × $0.05) | ~$4/month |
| Claude API — feedback analysis | ~$3/month |
| **Total** | **~$51/month** |

### Cost Controls
- API budget ceiling: $50/month (configurable)
- If exceeded: Conductor pauses generation, emails Wolf
- Job scoring: zero API cost (local keyword matching)
- Token tracking: per-operation cost stored in `cover_letter_versions.cost_estimate` and `conductor_queue` logs
- Dashboard shows running cost total

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

**Goal:** Replace Cowork with API-driven generation pipeline.

```
8A: Anthropic SDK integration + cover letter generation endpoint
8B: Hallucination filter module (parse claims, compare to context files)
8C: Self-scoring loop (generate → filter → score → retry if needed)
8D: cover_letter_versions table tracking
8E: Dashboard integration (show letter versions, scores, flagged claims)
```

**Test gate:** Generate letter for seed job, hallucination filter catches a planted false claim, self-score works, versions tracked in DB.

### Phase 9 — Conductor (Orchestrator)

**Goal:** Central brain driving the entire pipeline automatically.

```
9A: better-queue setup with SQLite persistence
9B: node-cron scheduler (scraping, digest, response check, weekly report)
9C: State machine for job lifecycle transitions
9D: Queue health monitoring + stall detection
9E: pm2 configuration for process management
9F: Dashboard Conductor status panel
```

**Test gate:** Conductor starts, processes a test job through score → generate → ready. Queue survives restart (pm2 restart). Stall alert fires.

### Phase 10 — Application Bot (Playwright)

**Goal:** Automated form filling with human supervision.

```
10A: Playwright setup with separate Chrome profile
10B: Standard form field filling (name, email, resume upload)
10C: Cover letter paste + Q&A field filling
10D: Multi-page flow handling
10E: Pause-before-submit gate (Wolf confirms)
10F: CAPTCHA detection (pause and alert)
10G: Integration with Conductor queue
```

**Test gate:** Bot fills a test form on a staging ATS, Wolf can see it on 2nd monitor, bot pauses at submit, resume uploads successfully.

### Phase 11 — Gmail MCP Server

**Goal:** Email monitoring and autonomous sending after approval.

```
11A: Google OAuth setup (Gmail API credentials)
11B: Inbox polling (15-min cycle)
11C: Response parsing (rejection/interview/offer detection)
11D: Autonomous email send (after Wolf approval)
11E: Verification code extraction (for ATS account creation)
11F: Integration with Conductor schedule
```

**Test gate:** OAuth works, inbox check retrieves test email, response parser correctly classifies rejection/interview, send works for approved job.

### Phase 12 — Chrome Bridge Extension

**Goal:** Claude browser extension can push content to pipeline.

```
12A: Manifest V3 extension skeleton
12B: Content script to intercept Claude browser output
12C: POST to Express API /api/bridge/upload
12D: Dashboard notification when content received
```

**Test gate:** Extension loads in Chrome, captures test content, POSTs to API, content appears in pipeline.

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

### Job Scoring
- Score 0–100 (never null)
- Reasoning: minimum 2 sentences
- Fit label: HIGH (≥75) / MEDIUM (50–74) / SKIP (<50)
- Red flag detection: "hold accountable", "move fast break things", "hands-on coding required", "10x engineer"
- 7 dimensions: Leadership (25%), Seniority (20%), Industry (15%), Culture (15%), Transformation (10%), Scope (10%), Location (5%)

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
├── ready/                   ← Complete application packages
│   └── [job_id]/
│       ├── cover_letter.md
│       ├── resume_bullets.md
│       ├── qa_answers.md
│       ├── metadata.json
│       └── send_ready/
│           └── approved.flag  ← Created only after Wolf approves
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
├── chrome-bridge/           ← Chrome Bridge extension source
│   ├── manifest.json
│   ├── background.js
│   └── content.js
├── conductor/               ← Conductor orchestrator
│   ├── index.js
│   ├── state-machine.js
│   └── scheduler.js
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
| ATS platforms detect Playwright | Application blocked or flagged | Headed mode, human speed, separate profile, Wolf watches |
| LinkedIn changes DOM (breaks scrapers) | Ingestion stalls | 24h alert, multiple sources, manual fallback |
| Gmail OAuth token expires | Email monitoring stops | Auto-refresh token, error alert to Wolf |
| Hallucination filter false positives | Good letters rejected | Configurable strictness, Wolf can override |
| SQLite WAL growth | Disk usage | Periodic VACUUM, monitor file size |
| Anthropic API rate limits | Generation delayed | Queue with backoff, batch during off-peak |
| Cover letter quality drift | Wolf's voice becomes generic | Regular review of generated letters, template iteration |
| pm2 crash without restart | Conductor stops | launchd watches pm2, auto-restart on failure |

### Architecture Risks (For External Reviewer)
1. **Single machine dependency** — If M3 Max is unavailable, entire pipeline stops. Mitigation: all state in SQLite (portable), no cloud lock-in.
2. **SQLite concurrency** — Multiple writers (Conductor, API server, CLI tools) hitting one DB. Mitigation: WAL mode handles this well for read-heavy/write-light workloads. Connection pooling if needed.
3. **Playwright fragility** — ATS platforms change DOM frequently. Mitigation: headed mode means Wolf sees failures immediately. Element selectors need maintenance.
4. **Scope creep** — 13 phases is ambitious for a solo operator. Mitigation: each phase is independently functional. Wolf can stop at any phase and have a working system.

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
