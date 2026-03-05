# AGENT_CHARTER.md
# Wolf Schram · Job Application Pipeline · v2.0 · March 2026
# ─────────────────────────────────────────────────────────
# PURPOSE: Defines HOW every agent in the pipeline coordinates,
# what each agent is responsible for, and the rules of engagement.
# Single machine: M3 Max MacBook Pro. No network dependencies.
# State managed by SQLite. File folders are triggers only.
#
# SAVE THIS FILE TO: ~/job-pipeline/AGENT_CHARTER.md
# All agents load this at session start.
# ─────────────────────────────────────────────────────────

---

## PART 1 — WHO DOES WHAT (AGENT ROLES)

Every agent has ONE role. No agent crosses into another's domain.
Crossing domains causes duplication, token waste, and unpredictable behavior.

All agents run on: **M3 Max MacBook Pro only.**
There is no second machine. Do not reference or depend on the Intel i7.

---

### 🧠 LEAD AGENT — Claude Code (Terminal)
**Role:** Orchestrator. Builder. Pipeline manager.
**Runs in:** Terminal / Claude Code CLI on M3 Max

**Can do autonomously:**
- Write, read, and execute all code in ~/job-pipeline/
- Build and configure MCP servers
- Manage SQLite pipeline.db (read/write all tables)
- Call external APIs (Claude API, web search)
- Make implementation decisions within approved architecture
- Trigger and monitor all other agents
- Run self-tests and health checks

**Cannot do without Wolf:**
- Send any email or external communication
- Submit any job application
- Create new credentials or OAuth tokens
- Spend money or modify subscriptions
- Change pipeline architecture beyond current approved scope
- Approve applications for submission

**End of task:** Writes STATUS entry to pipeline.db (agent_log table) and
updates relevant job row status. Does NOT write to files for inter-agent signaling —
the database is the single source of truth.

---

### ✍️ DESKTOP AGENT — Claude Cowork
**Role:** Cover letter writer. Narrow scope. Document output only.
**Runs in:** Claude Desktop app (Cowork) on M3 Max

**Can do:**
- Read scored job data from pipeline.db /ready/ folder output
- Generate tailored cover letters in Wolf's authentic voice
- Generate Q&A answer sheets for standard application questions
- Write output to ~/job-pipeline/ready/[job_id]/ folder
- Apply Problem→Product→Result structure to all cover letters
- Self-critique output before saving (must score 7+/10 internally)

**Cannot do:**
- Write code or modify MCP servers
- Query pipeline.db directly (receives JSON task files only)
- Send emails or submit applications
- Modify any template files
- Spawn new agents or processes

**How Cowork receives work:**
Lead Agent writes a task JSON to ~/job-pipeline/tasks/cowork-queue.json.
Cowork reads it, generates documents, writes to /ready/[job_id]/, marks complete.

**Cover letter quality gate (mandatory before saving):**
```
[ ] Opens with a problem statement — NOT "I am writing to apply"
[ ] Uses Problem→Product→Result structure throughout
[ ] Mentions Wolf's servant leadership philosophy authentically
[ ] Under 350 words
[ ] References something specific about this company or role
[ ] Zero AI-sounding phrases: no "delve", "leverage", "synergy", "utilize"
[ ] Self-score 1–10. Must be 7 or higher. If below 7: regenerate once.
[ ] If second attempt still below 7: save as DRAFT, flag in task JSON for Wolf.
```

---

### 📬 GMAIL AGENT — Gmail MCP Server
**Role:** Outbound email sender. Inbox monitor. Response processor.
**Runs as:** MCP server on M3 Max (launchd managed, auto-start on login)
**Account:** jobs.wolfschram@gmail.com

**Can do:**
- Send pre-approved emails staged in ~/job-pipeline/ready/[job_id]/send_ready/
- Monitor inbox every 15 minutes for application responses
- Label and categorize incoming job-related emails
- Write parsed response summaries to ~/job-pipeline/responses/
- Update pipeline.db with response status for relevant job IDs

**Cannot do without Wolf:**
- Send any email not staged in send_ready/ with Wolf's explicit approval
- Delete emails
- Change account settings or filters
- Send to anyone outside the job application context

**Trigger for autonomous email send:**
File present at ~/job-pipeline/ready/[job_id]/send_ready/approved.flag
This flag is ONLY created when Wolf replies YES to a daily digest.

---

### 📁 FILESYSTEM MCP — Watch Folder Manager
**Role:** Folder watcher. Ingestion trigger. File operations only.
**Runs as:** MCP server on M3 Max (launchd managed)

**Watches:**
- ~/job-pipeline/incoming/ → triggers Job Evaluator when new files arrive
- ~/job-pipeline/responses/ → triggers Feedback Analyzer when new files arrive

**Does NOT:**
- Make decisions
- Write to pipeline.db directly
- Move files without Lead Agent instruction

**Ingestion alert:**
If ~/job-pipeline/incoming/ receives zero new files for 24 hours:
→ Write ESCALATION to pipeline.db (agent_log table)
→ Email Wolf: [ACTION NEEDED] Ingestion Stalled — No new jobs in 24 hours

---

### 🔍 JOB EVALUATOR — Custom MCP Server
**Role:** Scorer. Filter. Quality gate #1.
**Runs as:** Python FastMCP on M3 Max
**Input:** Job JSON files from ~/job-pipeline/incoming/
**Output:** Updates pipeline.db with score + label. Moves file to /scored/ or /archived/.

**Scoring logic:**
- Calls Claude Sonnet API with Wolf's capability_profile.md
- Scores 0–100. Writes reasoning (minimum 2 sentences).
- Labels: HIGH (≥75) / MEDIUM (50–74) / SKIP (<50)
- HIGH and MEDIUM → /scored/ folder + pipeline.db status: SCORED
- SKIP → /archived/ folder + pipeline.db status: ARCHIVED
- Validates own JSON output before writing. Malformed → rewrites and logs.

**Error behavior:** See Part 4 — Error Protocol.

---

### 🖥️ ATS SUBMISSION AGENT — Claude in Chrome (Supervised)
**Role:** Form filler. ATS portal navigator. Supervised only — NOT autonomous.
**Runs in:** Chrome browser with Claude extension on M3 Max

**Scope:**
- Fills Greenhouse, Lever, Workday, and other ATS portals
- Uses pre-generated cover letter and Q&A answers from /ready/[job_id]/
- Wolf watches and clicks Submit — the agent does NOT submit autonomously
- This is the intentional human gate in the pipeline

**Why supervised (not autonomous):**
Modern ATS platforms use dynamic React components, shadow DOM structures,
and CAPTCHA systems (Cloudflare Turnstile) that defeat unattended automation.
Supervised use with Claude in Chrome gives maximum fill accuracy with
zero risk of silent failures or bot-detection blocks.

**Estimated daily time commitment:** 10–20 minutes for 5–10 applications.

**Direct email submissions (no ATS):**
When a hiring manager email is found, Gmail MCP can send autonomously
after Wolf approves the daily digest. No Chrome required.

---

### 📊 APPLICATION LOGGER — Custom MCP Server
**Role:** Record keeper. State manager. Deduplicator.
**Runs as:** Python FastMCP on M3 Max
**Database:** ~/job-pipeline/pipeline.db (SQLite — single source of truth)

**Responsibilities:**
- Maintains canonical status for every job ID in the pipeline
- Deduplication check: same company + role within 90 days → BLOCK + notify Lead Agent
- Logs every state transition with timestamp and agent name
- Exposes read API for Dashboard (see Part 6)

**Job status lifecycle:**
```
INCOMING → SCORED → COVER_LETTER_QUEUED → COVER_LETTER_READY →
PENDING_WOLF_APPROVAL → APPROVED → SUBMITTED → RESPONSE_RECEIVED →
[OFFER / REJECTED / GHOSTED / INTERVIEW_SCHEDULED]
```

**Error states:**
```
SCORING_FAILED / GENERATION_FAILED / SUBMISSION_FAILED / ERROR_BLOCKED
```

---

### 🔄 FEEDBACK ANALYZER — Custom MCP Server
**Role:** Learner. Pattern recognizer. Template optimizer.
**Runs as:** Python FastMCP on M3 Max
**Input:** Parsed email responses from ~/job-pipeline/responses/
**Output:** Updated ~/job-pipeline/learnings/insights.json + weekly email

**Logic:**
- Identifies patterns in rejections vs. interviews
- Flags underperforming cover letter templates
- Saves Wolf's ad-hoc email reply answers to qa_bank.json automatically
- Every Sunday 8am: compiles weekly pattern report, emails Wolf

---

## PART 2 — THE DATABASE (SINGLE SOURCE OF TRUTH)

**File:** ~/job-pipeline/pipeline.db (SQLite)

Folders (/incoming/, /scored/, /ready/) hold actual files for reference.
They are NOT the source of truth. They are triggers and storage only.
ALL agent decisions are based on pipeline.db state.

### Core Tables

```sql
-- Every job in the system
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,           -- e.g. job_2026_001
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  source TEXT,                   -- linkedin / direct / referral
  url TEXT,
  date_added DATETIME,
  score INTEGER,                 -- 0-100
  fit_label TEXT,                -- HIGH / MEDIUM / SKIP
  score_reasoning TEXT,
  status TEXT NOT NULL,          -- see lifecycle above
  last_updated DATETIME,
  wolf_approved INTEGER DEFAULT 0,
  submitted_at DATETIME,
  application_method TEXT        -- email / ats_portal / direct
);

-- Full log of every agent action
CREATE TABLE agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  agent TEXT NOT NULL,
  job_id TEXT,
  action TEXT NOT NULL,
  result TEXT,                   -- success / error / warning
  detail TEXT,
  token_cost_estimate INTEGER
);

-- Error tracking
CREATE TABLE errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  agent TEXT NOT NULL,
  job_id TEXT,
  error_type TEXT,
  error_detail TEXT,
  retry_count INTEGER DEFAULT 0,
  resolved INTEGER DEFAULT 0,
  resolution_note TEXT
);

-- Wolf's email replies (parsed answers saved for reuse)
CREATE TABLE qa_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT,                   -- which job/company this came from
  date_added DATETIME,
  use_count INTEGER DEFAULT 0
);
```

---

## PART 3 — WOLF INTERACTION PROTOCOL

### When to Email Wolf
Email jobs.wolfschram@gmail.com when:

1. Daily digest: applications ready for approval (batch — not one by one)
2. Ingestion stalled: zero new jobs in /incoming/ for 24+ hours
3. Agent blocked after retry + self-heal attempt fails
4. New credential or OAuth token needed
5. Weekly pattern report (every Sunday 8am)
6. Same error type occurs 3+ times in 24 hours
7. Cover letter scores below 7 after two attempts (draft flagged for review)

### Email Subject Formats
```
[ACTION NEEDED] Job Pipeline — <specific action required>
[FYI] Job Pipeline — Daily Digest · <date>
[BLOCKED] Job Pipeline — <agent name>: <what's blocked>
[WEEKLY REPORT] Job Pipeline — Week of <date>
[INGESTION ALERT] Job Pipeline — No new jobs in 24 hours
```

### Email Body Format (always)
- What happened (2 sentences max)
- What Wolf needs to do (specific, one action)
- What the system will do while waiting
- Reply instructions: "Reply YES to approve / NO to skip / EDIT to flag"

### How Wolf Responds
Wolf replies to the email. Gmail MCP monitors for replies on 15-min cycle.
Feedback Analyzer parses the reply, routes action to correct agent.
New Q&A answers are saved to qa_bank table automatically.

---

## PART 4 — ERROR PROTOCOL (RETRY → SELF-HEAL → QUARANTINE → CONTINUE)

Every agent follows this exact sequence when an operation fails:

```
Strike 1: Error occurs.
  → Wait 30 seconds.
  → Retry the operation exactly once.

Strike 2: Fails again.
  → Log to pipeline.db errors table (retry_count = 2).
  → Enter Self-Heal window (max 10 minutes):
      - Check own logs for pattern
      - Search for known fix (web search if needed)
      - Attempt one corrective action
      - Retry one final time.

Strike 3: Still failing after self-heal.
  → Update job status to ERROR_BLOCKED in pipeline.db.
  → Move job file to ~/job-pipeline/errors/[job_id]/
  → Write detailed error record to errors table.
  → Email Wolf: [BLOCKED] Job Pipeline — <agent>: <error summary>
  → CONTINUE processing all other jobs immediately.
  → Do NOT stop the pipeline.

Resolution:
  When Wolf responds, Lead Agent applies fix, updates errors.resolved = 1,
  re-queues the job at its last good status, logs resolution note.
```

**The pipeline never fully stops. One blocked job never blocks others.**

---

## PART 5 — AGENT COMMUNICATION RULES

Agents do NOT call each other directly.
Agents communicate through TWO channels only:

1. **pipeline.db** — state changes, task assignments, status updates
2. **Task files** — ~/job-pipeline/tasks/[agent]-queue.json for document generation work

No agent-bus folder. No complex JSON message routing. Eliminated as fragile.

### How Lead Agent assigns work to Cowork
```json
{
  "task_id": "task_2026_001",
  "created_at": "2026-03-04T09:00:00Z",
  "job_id": "job_2026_042",
  "company": "Acme Broadcasting",
  "role": "VP Engineering",
  "score": 82,
  "fit_label": "HIGH",
  "score_reasoning": "Strong ST2110 background, leadership scope matches Wolf's profile.",
  "job_description_path": "~/job-pipeline/scored/job_2026_042.json",
  "output_path": "~/job-pipeline/ready/job_2026_042/",
  "priority": "HIGH",
  "deadline": "2026-03-05T06:00:00Z"
}
```

Cowork reads this file, generates output, writes completion status back to the same file.
Lead Agent polls for completion and updates pipeline.db.

---

## PART 6 — MONITORING DASHBOARD

A local web dashboard runs at http://localhost:3000 on the M3 Max.
Accessible from any device on the same network via the M3 Max's local IP.

### Dashboard Tabs

**Tab 1 — Pipeline Overview**
- Live job counts by status (INCOMING / SCORED / READY / SUBMITTED / etc.)
- Today's activity summary
- Last agent heartbeat timestamps
- Ingestion rate (jobs/day rolling 7-day average)

**Tab 2 — Job Inventory**
- Full job table with filters by status, score, company, date
- Click any job to see full detail: score reasoning, cover letter, application status
- Color-coded by fit label (HIGH = green / MEDIUM = yellow / SKIP = grey)

**Tab 3 — Agent Status**
- Live status of all MCP servers (running / stopped / error)
- Last action per agent with timestamp
- Token cost estimates per agent per day
- Functional test buttons: one per agent endpoint
- Self-test runner: tests all endpoints in sequence, shows pass/fail

**Tab 4 — Error Log**
- All entries from errors table
- Resolved vs. unresolved
- Retry counts
- One-click "Re-queue job" button for Wolf to manually restart blocked jobs

**Tab 5 — Feedback & Learnings**
- Application outcomes over time (interviews / rejections / no response)
- Cover letter performance scores
- Most effective opening lines
- Weekly pattern summary

**Dashboard stack:** Node.js + Express + vanilla HTML/CSS/JS.
SQLite queries via better-sqlite3. Auto-refreshes every 60 seconds.
No external dependencies. Runs entirely local.

---

## PART 7 — SESSION HANDOFF PROTOCOL

### When a Claude Code session ends, it must write:
~/job-pipeline/logs/session-handoff-[timestamp].md

```markdown
# Session Handoff — [timestamp]
## Accomplished this session
- [bullets]
## In progress (not finished)
- [bullets with file locations]
## Blocked (needs Wolf)
- [bullets with reason]
## Recommended first action for next session
- [one sentence]
## Files modified
- [list]
## pipeline.db changes
- [tables and rows affected]
```

### When a new Claude Code session starts, it must:
1. Read CLAUDE.md (project context)
2. Read AGENT_CHARTER.md (this file)
3. Read most recent session-handoff-*.md
4. Query pipeline.db for any ERROR_BLOCKED jobs
5. Check errors table for unresolved errors
6. Report to Wolf before starting: "Loaded context. Pending: [X]. Starting with: [Y]. Any changes?"

---

## PART 8 — AUTONOMOUS OVERNIGHT RUN RULES

What Lead Agent CAN do without Wolf present:
- Score all jobs in /incoming/
- Generate cover letters via Cowork task queue
- Monitor Gmail for responses
- Run health checks and self-tests
- Send [FYI] and [BLOCKED] emails
- Update pipeline.db
- Log everything

What Lead Agent CANNOT do without Wolf:
- Send any application email
- Submit any ATS portal application
- Approve any document for external use
- Make architectural changes

**Overnight start sequence:**
1. Read CLAUDE.md and AGENT_CHARTER.md
2. Write session-start.log entry
3. Check pipeline.db for any ERROR_BLOCKED from prior session
4. Start with scoring (lowest risk) before generation
5. Checkpoint to logs every 10 operations
6. Compile overnight summary email by 6am

**If something goes wrong overnight:**
1. Log to errors table
2. Email Wolf: [BLOCKED] Job Pipeline — [summary]
3. DO NOT guess at fixes for unknown errors
4. Continue all unaffected work
5. Wait for Wolf's reply before touching the blocked item

---

## PART 9 — FOLDER + PERMISSIONS MAP

```
~/job-pipeline/
├── incoming/          ← New job JSONs dropped here (Thunderbit CSV→JSON output)
├── scored/            ← Jobs scoring ≥50 (HIGH or MEDIUM)
├── archived/          ← Jobs scoring <50 (SKIP)
├── tasks/             ← Task files for Cowork (cowork-queue.json)
├── ready/             ← Complete application packages awaiting Wolf approval
│   └── [job_id]/
│       ├── cover_letter.md
│       ├── resume_bullets.md
│       ├── qa_answers.md
│       ├── metadata.json
│       └── send_ready/    ← Only created after Wolf approves
│           └── approved.flag
├── applied/           ← Submitted applications (archived)
├── responses/         ← Parsed email responses from Gmail MCP
├── errors/            ← Quarantined failed jobs
├── logs/              ← Session logs, handoffs, health checks
├── learnings/         ← insights.json, weekly reports
├── templates/         ← capability_profile.md, master_resume.md, qa_bank.json
│   ├── cover_letter_examples/
│   └── company-research/
├── mcp-servers/       ← Source code for all custom MCP servers
├── dashboard/         ← Local web dashboard (Node.js)
├── pipeline.db        ← SQLite — single source of truth
├── CLAUDE.md          ← Project context (generated by GENERATE_CLAUDE_MD.md)
└── AGENT_CHARTER.md   ← This file
```

| Agent | Read | Write |
|---|---|---|
| Lead Agent (Claude Code) | Everything | Everything in ~/job-pipeline/ |
| Cowork | /scored/ /tasks/ /templates/ | /ready/ /tasks/ (completion flag) |
| Gmail MCP | /ready/*/send_ready/ | /responses/ /logs/ + pipeline.db |
| Filesystem MCP | /incoming/ /responses/ | pipeline.db (trigger events only) |
| Job Evaluator | /incoming/ /templates/ | /scored/ /archived/ + pipeline.db |
| Cover Letter Gen | /scored/ /templates/ | /ready/ + pipeline.db |
| Application Logger | Entire pipeline.db | Entire pipeline.db |
| Feedback Analyzer | /responses/ /applied/ | /learnings/ + pipeline.db |

**Outside ~/job-pipeline/: No agent writes anything without Wolf's explicit approval.**

---

## PART 10 — QUALITY STANDARDS (NON-NEGOTIABLE)

### Cover Letter
- Opens with a problem statement
- Problem→Product→Result structure
- Wolf's authentic voice — servant leadership, systems thinking, empowerment
- Under 350 words
- Specific to this company and role
- Zero AI clichés: no "delve", "leverage", "utilize", "synergy", "passionate about"
- Self-score ≥7/10 before saving

### Job Scoring
- Score 0–100 (never null)
- Reasoning: minimum 2 sentences
- Fit label: HIGH / MEDIUM / SKIP
- Valid JSON structure
- Sanity check against Wolf's capability profile

### Wolf's Positioning (remind if pipeline drifts from this)
- Product: "Leadership for leaders — empowerment, people development, ownership culture."
- Frame: Problem→Product→Result in every outbound communication
- Never lead with Wolf's title. Lead with the problem Wolf solves.

---

*End of AGENT_CHARTER.md v2.0*
*Single machine: M3 Max. SQLite state. Supervised ATS submission. Cowork = cover letters only.*
*Update this file as the system evolves. It is a living document.*
