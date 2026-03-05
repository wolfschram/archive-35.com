# PIPELINE_ARCHITECTURE.md
# Wolf Schram · Job Application Pipeline · v1.0 · March 2026
# ─────────────────────────────────────────────────────────
# PURPOSE: Technical architecture document.
# Describes the complete system design, data flows, stack decisions,
# and the reasoning behind every major architectural choice.
# Built from Gemini's stress-test review + Wolf's operational constraints.
# ─────────────────────────────────────────────────────────

---

## 1. DESIGN PRINCIPLES

Five rules that govern every decision in this system:

1. **One machine. No sync.** Everything runs on the M3 Max. No network dependencies, no iCloud sync conflicts, no placeholder files triggering false events.
2. **Database is truth. Folders are storage.** pipeline.db owns all state. Folders hold files for reference only. No agent makes a decision based on folder contents alone.
3. **Never stop the pipeline.** One failed job never blocks others. Retry → Self-Heal → Quarantine → Continue. Always.
4. **Wolf approves outbound. Machine handles everything else.** The only hard human gate is: sending emails and submitting applications. Everything before and after that is automated.
5. **Stay inside Claude Pro where possible.** Claude Code (API) is used only for background MCP servers where it's unavoidable. Claude Cowork and Claude in Chrome run on the flat-rate Pro subscription.

---

## 2. SYSTEM OVERVIEW

```
[JOB SOURCES]
    │
    ▼
[INGESTION LAYER]
Thunderbit Chrome Extension → CSV → JSON → ~/job-pipeline/incoming/
    │
    ├─ ALERT: If /incoming/ empty for 24h → email Wolf
    │
    ▼
[JOB EVALUATOR MCP]  ←── Claude Sonnet API (~$0.68/day for 50 jobs)
    │
    ├─ Score ≥50 → /scored/ + pipeline.db status: SCORED
    └─ Score <50  → /archived/ + pipeline.db status: ARCHIVED
         │
         ▼
[COWORK — COVER LETTER WRITER]  ←── Claude Pro (flat rate, no API cost)
    │  Reads task from cowork-queue.json
    │  Generates: cover_letter.md, resume_bullets.md, qa_answers.md
    │  Self-scores. Regenerates if <7/10.
    │
    ▼
[/ready/[job_id]/]  ←── Complete application package
    │
    ▼
[WOLF — DAILY DIGEST EMAIL]
    │  Approves / Skips / Flags for edit
    │
    ├─ Direct email jobs → Gmail MCP sends autonomously
    └─ ATS portal jobs  → Wolf + Chrome extension (supervised, 10-20 min/day)
         │
         ▼
[APPLICATION LOGGER]
    │  Records submission, method, timestamp
    │  Updates pipeline.db status: SUBMITTED
    │
    ▼
[GMAIL MCP — RESPONSE MONITOR]
    │  15-min polling cycle
    │  Parses responses, saves to /responses/
    │  Updates pipeline.db: RESPONSE_RECEIVED → REJECTED / INTERVIEW / OFFER
    │
    ▼
[FEEDBACK ANALYZER]
    │  Identifies patterns in outcomes
    │  Updates cover letter templates
    └─ Sunday 8am: weekly report email to Wolf
```

---

## 3. TECHNOLOGY STACK

### Runtime
| Component | Technology | Reason |
|---|---|---|
| Operating system | macOS (M3 Max) | Single machine, always-on |
| Process manager | launchd | Native macOS, auto-start on login, no dependencies |
| MCP framework | Python FastMCP | Lightweight, Claude-native, Wolf's established stack |
| Database | SQLite (better-sqlite3) | Zero config, single file, no server process, fast |
| Dashboard | Node.js + Express | Minimal deps, runs entirely local, easy to extend |
| Cover letter generation | Claude Cowork | Pro subscription — no API cost |
| ATS form filling | Claude in Chrome | Pro subscription — no API cost |
| Background AI calls | Claude Sonnet API | Job scoring + feedback analysis only |

### Estimated API Cost
| Operation | Daily volume | Cost/day |
|---|---|---|
| Job scoring (Sonnet) | 50 jobs | ~$0.68 |
| Cover letter self-critique | 10 letters | ~$0.15 |
| Feedback analysis | 5 responses | ~$0.05 |
| **Total** | | **~$0.90/day (~$27/month)** |

Cowork and Chrome run on flat-rate Claude Pro — zero additional cost.

---

## 4. DATA ARCHITECTURE

### Why SQLite (not file-based message bus)

The original AGENT_CHARTER v1.0 used a JSON file message bus (agent-bus/inbox/).
This was identified as a critical failure point:
- No native file lock guarantees in macOS for concurrent read/write
- JSON written by one agent can be read mid-write by another → parser crash
- Files stuck in transit have no recovery mechanism

**SQLite gives us:**
- Atomic writes (ACID compliant)
- Row-level state — every job always has exactly one status
- Full audit trail (agent_log table)
- Recovery from any state (re-queue a job by updating its status column)
- Dashboard can query it directly — no additional API layer needed

### pipeline.db Schema (summary)

```
jobs            — one row per job, full lifecycle status
agent_log       — every action by every agent, timestamped
errors          — failed operations with retry counts, resolved flag
qa_bank         — Wolf's answers to application questions, auto-populated
cover_letters   — generated letters linked to job IDs, self-scores
applications    — submitted applications with method and outcome
```

Full schema: see AGENT_CHARTER.md Part 2.

---

## 5. INGESTION LAYER

### Current Method: Thunderbit Chrome Extension
- Wolf runs Thunderbit on LinkedIn/job boards
- Exports CSV → converted to JSON → dropped in /incoming/
- Filesystem MCP detects new files → triggers Job Evaluator

### Fragility Acknowledged
Thunderbit depends on LinkedIn's DOM. If LinkedIn changes its layout, the extension breaks.

### Mitigation Built In
- 24-hour ingestion alert: if /incoming/ is empty for 24h → email Wolf immediately
- Fallback: Wolf can manually create a job JSON and drop it in /incoming/
- JSON schema is simple — any job source can produce it

### Minimum Job JSON Schema
```json
{
  "id": "job_2026_001",
  "company": "Acme Broadcasting",
  "role": "VP Engineering",
  "location": "Los Angeles, CA",
  "remote": true,
  "url": "https://jobs.acme.com/vp-eng",
  "description": "Full job description text here...",
  "source": "linkedin",
  "date_added": "2026-03-04T08:00:00Z",
  "contact_email": null
}
```

---

## 6. ATS SUBMISSION LAYER

### The Hard Stop Decision
Fully autonomous ATS form submission was evaluated and rejected for the following reasons:

- Greenhouse, Lever, and Workday all use dynamic React components
- Shadow DOM structures defeat standard DOM-traversal automation
- Cloudflare Turnstile and similar CAPTCHAs are deployed specifically to block this
- Silent failures (the form appears to submit but doesn't) are undetectable without human verification
- A rejected application due to bot detection damages Wolf's reputation at that company

### The Supervised Model (Claude in Chrome)
- Wolf opens /ready/ folder, reviews approved packages
- Opens Chrome, navigates to each ATS portal
- Claude Chrome extension fills forms from the pre-generated Q&A and cover letter
- Wolf reviews pre-filled form, clicks Submit
- Takes 10–20 minutes per day for 5–10 applications
- 100% submission success rate

### Direct Email Submissions (Fully Automated)
When a contact email is found in the job JSON:
- Gmail MCP sends the approved cover letter + resume after Wolf's daily approval
- No Chrome required
- Fully autonomous after the approval gate

### Future Consideration
Open-source ATS auto-fillers on GitHub can be evaluated if supervised Chrome submission
becomes too time-consuming. This requires a separate build decision from Wolf.

---

## 7. ERROR HANDLING ARCHITECTURE

### The 10-Minute Rule
Every agent follows: Retry → Self-Heal (max 10 min) → Quarantine → Continue

See AGENT_CHARTER.md Part 4 for full protocol.

### Error Classification
| Error Type | Auto-recoverable | Action |
|---|---|---|
| API timeout | Yes | Retry after 30s |
| Malformed JSON | Yes (re-parse) | Self-heal |
| Rate limit hit | Yes | Backoff + retry |
| Missing template file | No | Quarantine + escalate |
| DB write failure | No | Quarantine + escalate |
| Gmail auth expired | No | Escalate immediately |
| CAPTCHA block | Expected | Log, notify Wolf, skip |

### What Never Auto-Recovers
- Auth/credential failures → always escalate to Wolf
- Same error type 3+ times in 24h → escalate to Wolf even if individual retries succeed

---

## 8. MONITORING DASHBOARD

### Architecture
```
M3 Max: localhost:3000
    ├── Express server (Node.js)
    ├── SQLite queries via better-sqlite3 (read-only for display)
    ├── WebSocket or 60-second poll for live updates
    └── Static HTML/CSS/JS frontend (no framework needed)
```

### Access
- Local: http://localhost:3000
- Network: http://[M3-Max-local-IP]:3000 (accessible from phone, iPad, etc. on same WiFi)
- No internet exposure. No authentication needed (local network only).

### Five Dashboard Tabs
See AGENT_CHARTER.md Part 6 for full tab specifications.

### Functional Test Buttons (Tab 3)
Each MCP server endpoint has a test button that:
1. Sends a known test payload
2. Shows raw response
3. Reports pass/fail with latency
4. Logs test result to agent_log table

### Self-Test Runner
One button runs all endpoint tests in sequence.
Output: pass/fail per agent, total health score (e.g., "6/7 agents healthy").
Alerts Wolf by email if health score drops below 5/7.

---

## 9. COST MANAGEMENT

### Monthly Budget Estimate
| Item | Cost |
|---|---|
| Claude Pro subscription | $20/month (flat) |
| Claude API (scoring + analysis) | ~$27/month |
| **Total** | **~$47/month** |

### Cost Control Rules
- Cowork handles all document generation (flat rate — no API cost)
- Chrome extension handles all ATS form filling (flat rate — no API cost)
- Sonnet API used only for: job scoring, feedback analysis, self-critique
- No GPT-4 or other paid models
- If monthly API cost exceeds $50: Lead Agent emails Wolf with usage breakdown

### Token Optimization
- Worker MCP servers (Evaluator, Generator) use lean system prompts only
- Full AGENT_CHARTER and CLAUDE.md loaded only by Lead Agent
- Worker agents receive job-specific context only — no global charter ingestion

---

## 10. WHAT WAS CHANGED FROM V1.0 (GEMINI REVIEW INCORPORATED)

| Issue Identified | V1.0 Design | V2.0 Fix |
|---|---|---|
| Two-machine sync conflicts | Intel i7 + M3 Max | M3 Max only |
| File-based message bus concurrency | agent-bus/ JSON files | SQLite ACID transactions |
| Autonomous ATS submission failures | Claude in Chrome unattended | Supervised Chrome only |
| Context bloat on worker agents | All agents load full charter | Workers get lean prompts only |
| No state recovery for stuck files | File folders as state | pipeline.db owns all state |
| Ingestion layer fragility (Thunderbit) | No alert | 24h empty inbox alert |
| Token cost undefined | Not specified | ~$27/month estimated, capped at $50 |

---

*End of PIPELINE_ARCHITECTURE.md v1.0*
*This is a living document. Update when architecture decisions change.*
*Always update alongside AGENT_CHARTER.md — they are companion documents.*
