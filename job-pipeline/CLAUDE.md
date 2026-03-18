# Job Pipeline — CLAUDE.md
# Wolf Schram · Automated Job Search & Application System
# ───────────────────────────────────────────────────────
# EVERY agent (Claude Code, Cowork, any AI) MUST read this
# file COMPLETELY before taking ANY action on this project.
# ───────────────────────────────────────────────────────

<operational_principles>
## DISPLAY THESE 8 RULES AT THE START OF EVERY RESPONSE

1. I will read CLAUDE.md, AGENT_CHARTER_v2.md, and MASTER-ARCHITECTURE-v2.md BEFORE writing any code
2. I will grep/search BEFORE writing — never guess file paths, line numbers, or function names
3. I need TWO evidence sources (file content + command output) before ANY conclusion
4. I will get explicit y/n confirmation before ANY file creation, modification, or deletion
5. I will make the SMALLEST possible change — ONE issue at a time, NO refactoring unless asked
6. I will run `node -c` syntax check and `git diff` after EVERY edit — show the output
7. I will NEVER modify tests to match broken code, LICENSE files, or package.json without permission
8. I will display all 8 principles at the START of every response

If I skip this display, I am drifting. Wolf should say "RESET" to bring me back.
</operational_principles>

## RESPONSE FORMAT (MANDATORY)

Every response must begin with:
```
**Principles:** [1-8 listed or "Acknowledged"]

**Intent:** [1 sentence — what I'm doing]

**Verified:**
- [evidence 1: file:line or command output]
- [evidence 2: second source]

**Next:**
- [action 1]
- [action 2]
```

---

## SECTION 0: ENVIRONMENT CHECK (RUN FIRST EVERY SESSION)

```bash
pwd                                    # Must be in job-pipeline root
which node                             # Verify node path
node --version                         # Verify node version
ls server.js conductor/scheduler.js    # Verify core files exist
```

**Path on Wolf's Mac:** `~/Documents/Archive-35.com/job-pipeline/`
**Path in Cowork VM:** `/sessions/*/mnt/job-pipeline/`
**Server runs on Wolf's Mac, NOT in Cowork VM.** Cowork can read/edit files but cannot serve localhost:3000.

---

## SECTION 1: WOLF'S EXACT WORKFLOW (THE WHOLE POINT)

Wolf's daily interaction is 4 steps. Everything else is automated.
**The more manual steps Wolf takes, the bigger the failure.**

### Step 1: SEARCH — Find jobs, read descriptions, add to pipeline
- Wolf clicks "Search Jobs" in Command Center
- System searches LinkedIn + Indeed via ts-jobspy (or Claude in Chrome for deep search)
- Results appear with company name, title, description, score
- Wolf clicks "Add to Pipeline" on jobs that look good
- **Automated:** Searching, scoring, deduplication, company research

### Step 2: GENERATE — Review pipeline, generate cover letters
- Wolf opens Pipeline tab, sees scored jobs
- Clicks "Generate Cover Letter" on a job
- System generates a P→P→R cover letter using Claude API
- Cover letter appears for review
- **Automated:** Letter generation, hallucination filtering, self-scoring

### Step 3: APPROVE & APPLY — One click triggers everything
- Wolf reviews cover letter, clicks "Approve & Apply"
- System creates company folder in `/ready/[Company_Name]/`:
  - `cover_letter.docx` (with Wolf's LinkedIn URL embedded as a hyperlink)
  - `Wolfgang_Schram_Resume.pdf` (copied from templates)
  - `metadata.json` (job details, URLs, timestamps)
  - `qa_answers.md` (pre-filled application questions)
- System connects to Chrome via CDP
- System navigates to the job listing URL
- System clicks "Apply" → follows redirect to company ATS
- System detects platform (Greenhouse/Lever/Workday/generic)
- System fills all form fields, uploads resume, pastes cover letter
- System pauses BEFORE final submit
- **Automated:** Folder creation, file packaging, ATS navigation, form filling, file upload

### Step 4: SUBMIT — Wolf clicks one button
- A flashing red notification appears: "ACTION NEEDED: Review & Submit [Company Name]"
- Wolf reviews the filled form on his secondary monitor
- Wolf clicks the final Submit button
- System marks job as SUBMITTED, archives package to `/applied/`
- **Automated:** Status update, package archival, response monitoring

### What Wolf NEVER does:
- Log into company websites manually (system handles account creation)
- Upload resume/cover letter files manually
- Fill out form fields
- Copy-paste between tabs
- Navigate to career pages

---

## SECTION 2: CRITICAL DOCUMENTATION (READ ORDER)

Before ANY work, read these in order:

1. **This file** — `CLAUDE.md` (you're reading it)
2. **`AGENT_CHARTER_v2.md`** — Agent roles, DB schema, folder structure, communication rules
3. **`docs/MASTER-ARCHITECTURE-v2.md`** — Complete system design, component specs, build phases
4. **`COWORKER_HANDOVER.md`** — Current state, what's tested, known issues
5. **`LESSONS_LEARNED.md`** — What works, what doesn't, template insights

Do NOT start coding until you've read at minimum files 1-3.

---

## SECTION 3: SYSTEM ARCHITECTURE (QUICK REFERENCE)

### Stack
- **Server:** Pure Node.js HTTP (NOT Express despite package.json listing it)
- **Database:** SQLite via better-sqlite3, WAL mode, foreign keys
- **Dashboard:** Vanilla HTML/CSS/JS at `public/command-center.html`
- **ATS Bot:** Playwright CDP connecting to Chrome via port 9222
- **Cover Letters:** Anthropic Claude API (2-call extract→assemble pattern)
- **Email:** Google OAuth2 → Gmail API via `jobs.wolfschram@gmail.com`

### Key Files
| What | Where |
|------|-------|
| Server (all endpoints) | `server.js` |
| Dashboard UI | `public/command-center.html` |
| ATS form filler | `conductor/application-bot.js` |
| Platform adapters | `conductor/platform_adapters/*.js` |
| Cover letter generator | `lib/cover-letter-generator.js` |
| Application packager | `lib/package-builder.js` |
| Conductor scheduler | `conductor/scheduler.js` |
| Database init | `init-db.js` |
| Wolf's profile | `templates/capability_profile.md` |
| Resume PDF | `templates/Wolfgang Schram Resume PDF Feb 2026.pdf` |
| Cover letter examples | `templates/cover_letter_examples/` |

### Job Status Lifecycle
```
SCORED → COVER_LETTER_READY → PENDING_APPROVAL → APPROVED → SUBMITTING → SUBMITTED
```

### Folder Structure (from AGENT_CHARTER Part 9)
```
~/job-pipeline/
├── incoming/          ← New job JSONs
├── scored/            ← Jobs scoring ≥50
├── archived/          ← Jobs scoring <50
├── tasks/             ← Task files for agents
├── ready/             ← Application packages per company
│   └── [Company_Name]/
│       ├── cover_letter.md/.txt/.docx
│       ├── Wolfgang_Schram_Resume.pdf
│       ├── qa_answers.md
│       └── metadata.json
├── applied/           ← Submitted (archived from ready/)
├── responses/         ← Parsed email responses
├── errors/            ← Quarantined failed jobs
├── logs/              ← Session logs, handoffs
├── learnings/         ← insights.json, weekly reports
├── templates/         ← Wolf's resume, profile, examples
├── conductor/         ← ATS bot, scheduler, adapters
├── lib/               ← Cover letter generator, package builder
├── public/            ← Command Center HTML
├── pipeline.db        ← SQLite — single source of truth
├── CLAUDE.md          ← This file
└── AGENT_CHARTER_v2.md
```

---

## SECTION 4: CROSS-REFERENCE — PLANNED vs BUILT vs BROKEN

### What's BUILT and WORKING:
| Feature | Status | Files |
|---------|--------|-------|
| Server with REST API | WORKING | `server.js` |
| SQLite DB (18 tables) | WORKING | `pipeline.db`, `init-db.js` |
| Command Center dashboard (13 tabs) | WORKING | `public/command-center.html` |
| Job scoring (keyword-based) | WORKING | `job-scorer.js` |
| Cover letter generation (Claude API) | WORKING | `lib/cover-letter-generator.js` |
| MCP server (9 tools for Claude Desktop) | WORKING | `mcp-server.js` |
| Feedback analyzer (template A/B) | WORKING | `feedback-analyzer.js` |
| Application Q&A system | WORKING | server.js endpoints |
| Job search (LinkedIn guest scraper) | FRAGILE | `server.js` (inline) |
| Gmail inbox monitoring | WORKING | server.js + OAuth |
| Email response parsing | WORKING | server.js |
| Company research storage | WORKING | `company_research` table |
| Personal info for forms | WORKING | `personal_info` table |
| Bridge/import content | WORKING | server.js `/api/bridge/ingest` |
| Application packages (/ready/) | BUILT | `lib/package-builder.js` |
| Platform adapters (4) | BUILT | `conductor/platform_adapters/` |
| Start/stop scripts | WORKING | `start.sh`, `stop.sh` |

### What's PLANNED but NOT BUILT:
| Feature | Spec Location | Status | Impact |
|---------|--------------|--------|--------|
| `agent_log` table | Charter Part 2 | MISSING | No agent action audit trail |
| Filesystem MCP (folder watcher) | Charter, Arch §3.4 | NOT BUILT | No auto-ingestion from /incoming/ |
| Gmail MCP Server (standalone) | Charter, Arch §3.7 | PARTIAL | Gmail works via server.js, not as MCP |
| Hallucination filter | Arch §3.8 | NOT BUILT | Cover letters not fact-checked against profile |
| Session handoff logs | Charter Part 7 | NOT BUILT | No `/logs/session-handoff-*.md` files |
| Overnight autonomous run | Charter Part 8 | NOT BUILT | No scheduled overnight processing |
| Daily digest email | Charter Part 3 | NOT BUILT | No batch approval email to Wolf |
| Weekly pattern report | Charter §Feedback | NOT BUILT | No Sunday insight email |
| Flashing red "Action Needed" button | Wolf's workflow Step 4 | NOT BUILT | Wolf has no visual alert for submit |
| Cover letter as .docx with embedded LinkedIn | Wolf's requirement | NOT BUILT | Package only has .md/.txt, no .docx |
| Automated account creation on ATS sites | Wolf's instructions | NOT BUILT | Wolf still needs to create accounts manually |
| `approved.flag` in send_ready/ | Charter Part 9 | NOT APPLICABLE | Arch v2 says DB-only state, no flag files |
| Conductor queue health alerts | Arch §3.3 | NOT BUILT | No stall detection |
| Multi-platform search (Indeed, Glassdoor) | Arch §3.9 | NOT BUILT | Only fragile LinkedIn guest scraper |
| pm2 process management | Arch §3.3 | NOT CONFIGURED | Manual `node server.js` start |

### What's BUILT but UNTESTED:
| Feature | Risk |
|---------|------|
| ATS application-bot.js | NEVER tested end-to-end on a real job |
| Greenhouse adapter | Never tested against real Greenhouse form |
| Lever adapter | Never tested against real Lever form |
| Workday adapter | Never tested against real Workday form |
| Generic adapter | Never tested against real form |
| Package builder → ATS bot flow | Integration never tested |
| application_submissions table | 0 rows — never used in production |

### What's BROKEN or MISALIGNED:
| Issue | Detail |
|-------|--------|
| Cover letter not saved as .docx | Package builder creates .md/.txt but Wolf wants .docx with LinkedIn embedded |
| No flashing notification | Wolf expects a prominent visual alert when his Submit action is needed |
| ATS bot can't auto-login | Wolf wants automated account creation; bot assumes pre-existing session |
| Job search unreliable | LinkedIn guest API rate-limited after ~300 calls, could break anytime |
| No Indeed search | Architecture spec lists Indeed but only LinkedIn implemented |
| server.js is 156KB | Monolithic; Arch spec says Conductor is separate single-DB-writer |
| No cost tracking | Charter says track API costs per operation; not implemented |
| `qa_bank` has 3 rows | Should be growing from Wolf's email replies; auto-save not working |
| `bridge_events` has 0 rows | Import/paste feature exists but apparently never used |
| Template version tracking | Schema exists but all jobs default to 'v1' |

---

## SECTION 5: WOLF'S PREFERENCES (ADHD/DYSLEXIA)

- **Keep answers short and scannable** — bullet points, clear visual hierarchy
- **Get to the point fast** — Wolf grasps big concepts quickly but struggles with dense detail
- **Default to .docx** for all documents (except actual code files)
- **Senior engineer-level technical depth** — broadcast, SMPTE 2110, AV systems, enterprise tech
- **Servant leadership philosophy** — frame team topics through empowerment and ownership culture
- **Bilingual German/English** — may input in either, prefers English responses
- **Voice-to-text input** — auto-correct all transcription errors without asking

---

## SECTION 6: WORKFLOW — DETECT → PROPOSE → CHANGE → VERIFY → SUMMARIZE

### 1. DETECT (Mandatory First)
```bash
grep -n "searchTerm" server.js conductor/*.js lib/*.js
grep -n "addEventListener" public/command-center.html | head -30
```
- SHOW grep output before proposing changes
- NEVER guess — if grep returns nothing, ASK

### 2. PROPOSE
- Max 5 bullets
- Each bullet: **File** + **Why** + **How I verified it exists**
- STOP and wait for user "y" before proceeding

### 3. CHANGE
- ONE issue only
- Smallest possible edit
- NO drive-by fixes, NO refactoring, NO "while I'm here" changes

### 4. VERIFY (Non-negotiable)
```bash
node -c server.js                      # Syntax check server
node -c conductor/application-bot.js   # Syntax check bot
node -c lib/package-builder.js         # Syntax check packager
git diff                               # Show exact changes
```
- If `node -c` fails → REVERT immediately, do not proceed
- Show BOTH outputs in response

### 5. SUMMARIZE
- What changed (file:line)
- What was verified (command outputs)
- What remains unknown/risky

---

## SECTION 7: GROUND TRUTH HIERARCHY

1. **Terminal output** = ground truth
2. **Repo files** = ground truth
3. **This CLAUDE.md + Architecture docs** = project truth
4. **My memory/training** = NOT ground truth

If about to say "I think" or "should work" → STOP → run command to verify instead.

---

## SECTION 8: HIGH RISK OPERATIONS (MUST ASK FIRST)

- `rm` anything (even test files)
- `git reset`, `git clean`, force push, rebase
- Bulk find/replace across multiple files
- Modifying: `package.json`, `.env`, `main.js` IPC handlers
- Changing authentication, security, or encryption logic
- Renaming API endpoints or changing request/response schemas
- Creating new files (might duplicate existing functionality)
- Modifying `init-db.js` (database schema changes)
- Changing the job status lifecycle

---

## SECTION 9: FORBIDDEN BEHAVIORS

| Never Do This | Do This Instead |
|---------------|-----------------|
| Guess file paths | `grep -rn "term" .` to find |
| Start coding before reading docs | Read CLAUDE.md + Architecture first |
| Use `?.` to fix undefined errors | Find WHY it's undefined, fix root cause |
| Empty catch blocks | `catch(e) { console.error('[X]', e); throw e; }` |
| Modify tests to match broken code | Fix the code to pass the test |
| Leave old code when rewriting | Remove obsolete code completely |
| Run `git commit` or `git push` | Wolf handles all git operations |
| Read entire large directories | Targeted `grep` only |
| Say "it should work" | Run `node -c` and prove it |
| Build half a feature | Complete the full flow or don't start |
| Add a manual step for Wolf | Automate it — that's the whole point |

---

## SECTION 10: WHEN TO ASK (ONLY THESE CASES)

- Missing required input (file path, function name, specific requirement)
- Two+ valid approaches with different tradeoffs
- About to do HIGH RISK operation (Section 8)
- Grep returns nothing / can't locate the code
- Unclear which doc takes precedence on a conflict

**Do NOT ask** "Should I continue?" when there's only one reasonable next step.

---

## SECTION 11: SESSION MANAGEMENT

- Maintain mental model of: completed items, current task, blockers
- After ~10 messages, restate: "Current task: X. Known facts: Y."
- If behavior seems off, Wolf will say "RESET" → re-read this file, restart workflow
- Wolf handles `/clear` and `/compact` decisions

### Session Handoff (when session ends):
Write to `~/job-pipeline/logs/session-handoff-[timestamp].md`:
```
# Session Handoff — [timestamp]
## Accomplished
- [bullets]
## In Progress (not finished)
- [bullets with file locations]
## Blocked (needs Wolf)
- [reason]
## Recommended First Action for Next Session
- [one sentence]
## Files Modified
- [list]
```

---

## SECTION 12: COST RULES

- Do NOT read: `node_modules/`, any folder >100 files
- Use `grep -n` instead of reading entire files (server.js is 156KB!)
- One file at a time, not batch operations
- For server.js: always grep for the specific function, never read the whole file

---

## SECTION 13: QUICK REFERENCE COMMANDS

| What | Command |
|------|---------|
| Find any function | `grep -n "functionName" server.js conductor/*.js lib/*.js` |
| Find API endpoints | `grep -n "urlParts\|method ===" server.js` |
| Find event listeners | `grep -n "addEventListener" public/command-center.html` |
| Syntax check server | `node -c server.js` |
| Syntax check bot | `node -c conductor/application-bot.js` |
| Show DB tables | `python3 -c "import sqlite3; [print(r[0]) for r in sqlite3.connect('pipeline.db').execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()]"` |
| Job status counts | `python3 -c "import sqlite3; [print(f'{r[0]}: {r[1]}') for r in sqlite3.connect('pipeline.db').execute('SELECT status, COUNT(*) FROM jobs GROUP BY status').fetchall()]"` |
| Show changes | `git diff` |
| Start server (on Mac) | `cd ~/Documents/Archive-35.com/job-pipeline && node server.js` |
| Start with CDP | `bash start.sh` |

---

## SECTION 14: IF THINGS GO WRONG

If stuck in a loop or confused:
1. STOP executing commands
2. Re-read this CLAUDE.md (focus on Section 4 cross-reference)
3. State what I know vs. what I'm uncertain about
4. Ask ONE specific clarifying question
5. Wait for Wolf's guidance

User intervention phrases:
- **"RESET"** → Re-display principles, restart workflow
- **"STOP"** → Halt immediately, summarize state
- **"UNDO"** → Describe how to revert last change

---

## REMEMBER

- Wolf is a VP of Engineering with 25+ years experience — treat him accordingly
- Speed is worthless if changes break things
- Every edit must be: verified before, verified after
- When uncertain: grep first, ask second, act last
- The more manual steps for Wolf = the bigger the failure
- Wolf's terminal output and test results override my assumptions
- READ THE DOCS BEFORE WRITING CODE — this is rule #1 for a reason
