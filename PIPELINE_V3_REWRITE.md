# Job Pipeline v3 — Master Rewrite Spec
**For Claude Code | March 2026 | Wolf Schram**
**This document IS the full build brief. Work top to bottom. Each step must be testable before moving to the next.**

---

## 1. Context & Why This Rewrite

Research (Gemini + ChatGPT, March 2026) confirms:
- LinkedIn scraping is legally and technically dead — Proxycurl sued into shutdown July 2025
- Auto-submit bots are flagged by Greenhouse (mouse/keystroke biometrics), Indeed, iCIMS
- Volume strategy actively hurts at VP/CTO level — 228 avg applications per posting, recruiters drowning in bot noise
- Executive hiring runs through retained search, warm intros, and recruiter relationships — NOT job board volume

**The new strategy:** Automate INTELLIGENCE (discovery, scoring, research, outreach briefs). Humans control EVERY submission. Build this as a product that could serve any executive job seeker — not just Wolf.

---

## 2. Tab Inventory — Keep / Kill / Rebuild

| Tab | Action | Notes |
|---|---|---|
| Pipeline | KEEP | Rename to "Dashboard". Remove ATS submit stages from pipeline flow. |
| Job Search | REBUILD | Major upgrade. Add Greenhouse/Lever/Ashby/SmartRecruiters APIs. Kill LinkedIn MCP entirely. See Section 5. |
| Email | KEEP | Working. 119 emails ingested. Leave as-is. |
| Research | KEEP | Useful for deep-dive on specific companies. |
| Challenges | **KILL** | Remove entirely. ATS bot is dead. |
| Applied | KEEP | Rename to "Applications". Manual tracking only. |
| Feedback | KEEP | Good learning loop. |
| Health | REBUILD | Replace ATS/CDP checks with API key health tests. See Section 6. |
| ATS Bot | **KILL** | Remove entirely from nav and codebase. |
| Personal Info | TRANSFORM | Rename to "Profile". Remove ATS password. Add resume upload + capability profile. See Section 7. |
| App Questions | **KILL** | No longer needed without ATS bot. |
| Import | KEEP | Manual import still valuable for when Wolf researches LinkedIn himself. |
| Settings | KEEP | Add API key management here. |

---

## 3. Complete Removal List — Do This First (Step 1)

### 3.1 API Routes to Delete from server.js

```
DELETE all routes matching /api/ats/*
  - /api/ats/status
  - /api/ats/connect
  - /api/ats/disconnect
  - /api/ats/queue
  - /api/ats/reset/:id
  - /api/ats/submit/:id
  - /api/ats/process-queue
  - /api/ats/mark-submitted/:id
  - /api/ats/resolve-url/:id
  - /api/ats/resume/:id

DELETE /api/submissions (GET + POST + PUT)
DELETE /api/challenges (GET + POST + PUT + DELETE)
DELETE /api/packages (GET + POST + archive)
DELETE /api/server/launch-cdp
```

### 3.2 Files to Delete

```
~/Documents/ACTIVE/job-pipeline/linkedin-mcp-client.js
~/Documents/ACTIVE/job-pipeline/linkedin-mcp-client.js.bak
```

### 3.3 Code to Remove from server.js

- All `require`s of linkedin-mcp-client
- All LinkedIn MCP spawn/process logic
- All CDP launch and Playwright imports/requires
- The `linkedinMCP` variable and all references
- `uvx` path detection logic

### 3.4 Tabs to Remove from command-center.html

- ATS Bot tab + all its JS
- App Questions tab + all its JS
- Challenges tab + all its JS
- LinkedIn MCP status badge

### 3.5 DB Changes

```sql
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS challenges;
DROP TABLE IF EXISTS ats_queue;
DELETE FROM personal_info WHERE key = 'ats_password';
-- Remove columns from jobs table if they exist:
-- ats_url, ats_status, ats_error
```

### 3.6 Pipeline Stages to Update

Remove `SUBMITTING` and `SUBMITTED` from the pipeline stage flow.
Replace with: `OUTREACH_SENT` and `MANUALLY_APPLIED`

New stage flow:
```
NEW → SCRAPED → SCORED → LETTER_GEN → LETTER_READY → PENDING_APPROVAL → APPROVED → OUTREACH_SENT → MANUALLY_APPLIED → CLOSED
```

---

## 4. New Source Architecture

### 4.1 Sources — Priority Order

| Source | Auth | Method | Status |
|---|---|---|---|
| Greenhouse Job Board API | None (public) | GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs | ADD |
| Lever Postings API | None (public) | GET https://api.lever.co/v0/postings/{company} | ADD |
| Ashby Job Postings API | None (public) | GET https://api.ashbyhq.com/posting-api/job-posting/{slug} | ADD |
| SmartRecruiters Posting API | None (public) | GET https://api.smartrecruiters.com/v1/companies/{id}/postings | ADD |
| Workday via JSON-LD | Public scrape | Extract JobPosting structured data — no browser needed | ADD |
| Indeed via ts-jobspy | None | Full descriptions, works today | KEEP |
| Google Jobs | None | ts-jobspy google param | ADD |
| ZipRecruiter | None | ts-jobspy | ADD |
| LinkedIn MCP | — | ToS violation, CAPTCHA, Proxycurl sued | **KILL** |

### 4.2 Removing LinkedIn from ts-jobspy Calls

In `server.js`, find the `scrapeJobs()` call and:
- Remove `'linkedin'` from `siteType` array
- Remove LinkedIn checkbox from Job Search UI
- Add `'google'` and `'zip_recruiter'` to siteType array
- Set `linkedinFetchDescription: false`

### 4.3 Company Watch List + ATS API Search (NEW)

The existing "Monitored Companies" section in Job Search becomes the Watch List engine.

**DB: add to monitored_companies table:**
```sql
ALTER TABLE monitored_companies ADD COLUMN ats_type TEXT; -- greenhouse|lever|ashby|smartrecruiters|workday|other
ALTER TABLE monitored_companies ADD COLUMN ats_token TEXT; -- board token / company slug for the API
```

**Auto-detection on "Add Company":**
When user enters a career URL, fingerprint the ATS:
- URL contains `greenhouse.io` → ats_type = greenhouse, extract board token from URL
- URL contains `lever.co` → ats_type = lever, extract company slug
- URL contains `ashbyhq.com` → ats_type = ashby, extract slug
- URL contains `smartrecruiters.com` → ats_type = smartrecruiters, extract company ID
- URL contains `myworkdayjobs.com` → ats_type = workday
- Otherwise → ats_type = other

**Search logic:**
For each company in watch list, call the appropriate ATS API, filter by title keywords matching Wolf's target titles, score and add to pipeline.

**Cron:** Check all watched companies once per 24h. Alert in Health tab if new matches found.

---

## 5. Job Search Tab — Rebuild Spec

### 5.1 UI Changes

Remove:
- LinkedIn checkbox
- LinkedIn MCP status badge
- "MCP ✓" indicator

Add source checkboxes:
`[ Indeed ] [ Google Jobs ] [ ZipRecruiter ] [ Greenhouse API ] [ Lever API ] [ Ashby API ] [ SmartRecruiters API ]`

Add:
- "Watch List Search" button — searches all watched companies via their ATS APIs

Keep:
- Company Direct Search
- Role title toggles
- Location field
- Min score threshold
- Search results table
- Add Selected to Pipeline button

### 5.2 Suggested Queries Update

Add:
- "Head of Engineering"
- "VP Technology"
- "Engineering Director, Platform"
- "VP Digital Transformation"

---

## 6. Scoring Engine Upgrade

### 6.1 Hard Rules

- **No description = score 0** — do NOT add to pipeline
- **Title hard-filter — auto-reject if title contains:**
  - "Staff Engineer", "Principal Engineer", "Senior Engineer", "Engineering Manager" (without VP/Director prefix)
  - "Intern", "Junior", "Associate Engineer", "Graduate"
- **Min score for pipeline:** raise default from 40 to **55**

### 6.2 Scoring Dimensions (updated weights)

```javascript
const DIMENSIONS = {
  leadership:       { weight: 28 },
  seniority:        { weight: 28 },
  transformation:   { weight: 18 }, // INCREASED — Wolf's key differentiator
  org_scale:        { weight: 10 }, // NEW — must be 50+ people org
  culture:          { weight: 8  },
  industry:         { weight: 4  }, // REDUCED — Wolf is cross-industry intentionally
  location:         { weight: 2  },
  reporting_line:   { weight: 2  }, // NEW — reports to CEO/COO/CTO preferred
};
```

### 6.3 LLM Scoring Prompt Addition

```
RULES:
- You MUST cite specific text from the job description to support each dimension score.
- Do NOT infer or assume experience requirements not stated in the posting.
- If the job description is fewer than 100 words, return score 0 for all dimensions.
- If the role appears to be IC (individual contributor) with no direct reports mentioned, apply seniority = 0.
```

### 6.4 notFit Terms (stored in Profile, editable)

Defaults:
- "relocation required"
- "must be in office 5 days"
- "startup of fewer than 20"
- "no remote"

Each match subtracts 20pts from total score.

---

## 7. Health Tab — Rebuild Spec

### 7.1 API Key Health Tests (replace all current checks)

| Service | Test | Required |
|---|---|---|
| Anthropic API | Send minimal completion, expect 200 | Yes — scoring + cover letters |
| Gmail OAuth | List 1 email thread | Yes — email tab |
| Indeed (ts-jobspy) | Search 1 keyword, expect ≥1 result | Yes — primary job source |
| Google Jobs (ts-jobspy) | Search 1 keyword, expect ≥1 result | Yes |
| Greenhouse API | GET `boards-api.greenhouse.io/v1/boards/netflix/jobs` | Yes — ATS source |
| Lever API | GET `api.lever.co/v0/postings/airbnb` | Yes — ATS source |
| Ashby API | GET a known company slug | Yes — ATS source |
| SmartRecruiters API | GET a known company | Yes — ATS source |

### 7.2 Remove from Health Tab

- Playwright/CDP status
- LinkedIn MCP status
- ATS queue stats
- Submission counters

### 7.3 Keep / Add

- SQLite status (keep)
- Gmail OAuth status (keep)
- Express API uptime (keep)
- pm2 status (keep)
- Disk space (keep)
- NEW: Last search timestamp + source breakdown
- NEW: Score distribution histogram (jobs by score band)
- NEW: Cover letters generated this week
- NEW: Watch list companies + last checked timestamp

---

## 8. Profile Tab (formerly Personal Info) — Rebuild Spec

### 8.1 Rename
Tab: `Personal Info` → `Profile`

### 8.2 Keep These Fields
- Full Name, Email, Phone, LinkedIn URL, Location
- Target Titles, Salary Range
- Positioning Statement, Resume Summary

### 8.3 Remove
- **ATS Account Password — PERMANENTLY REMOVED. No trace in UI or DB.**

### 8.4 Add These Fields

```
Resume Upload
  - Accept: .pdf, .docx
  - Parse to plain text, store as personal_info key 'resume_text'
  - Show: filename + upload date + character count
  - Used by: scoring engine, cover letter generator, outreach briefs

Capability Profile Upload
  - Accept: .pdf, .docx, .md
  - Parse to plain text, store as personal_info key 'capability_profile_text'
  - Used by: scoring, outreach briefs, cover letters

Key Industries (multi-select checkboxes)
  - Technology / SaaS
  - Media & Broadcast
  - Healthcare Tech
  - Financial Services
  - Aerospace & Defense
  - Retail & E-commerce
  - Energy & Utilities
  - Government & Civic Tech
  - Open to All (default checked)
  - Stored as: personal_info key 'target_industries' (JSON array)

NOT Interested In (textarea, one item per line)
  - Used as notFit terms in scoring
  - Stored as: personal_info key 'not_interested_terms'
  - Pre-populate with defaults from Section 6.4

Work Style Preference (radio)
  - Remote preferred | Hybrid OK | On-site OK
  - Stored as: personal_info key 'work_style'
```

---

## 9. Outreach Brief Generator (NEW — Core Feature)

For any job scoring ≥55, auto-generate an Outreach Brief.

### 9.1 Brief Contents

```
1. Role Mandate (1 paragraph)
   What problem this company is hiring this leader to solve.
   Sourced from: job description text only.

2. Wolf's Angle (3 bullet points)
   Specific reasons Wolf is relevant.
   Sourced from: resume_text + capability_profile_text from DB.
   RULE: Must cite actual experience. No invented claims.

3. First 90 Days Hypothesis (1 paragraph)
   What Wolf would focus on first.
   Sourced from: job description + Wolf's experience.

4. 5 Sharp Questions for Recruiter/HM
   Substantive questions about mandate, team, challenges.
   NOT generic questions.

5. Warm Intro Paths (placeholder for now)
   Static text: "Check your network for connections at [company]"
```

### 9.2 Where It Shows
- Job detail panel (click any job in Dashboard)
- "Generate Brief" button on any scored job ≥55
- Copy-to-clipboard button (plain text export)
- This IS the output of the automation — not the application

### 9.3 Prompt Rules
```
System: You are helping an executive prepare a targeted outreach brief.
- Only use information from the provided resume and job description.
- Do NOT invent metrics, claims, or experience not in the source documents.
- Do NOT use generic leadership buzzwords.
- Write in Wolf's voice: direct, confident, specific.
- If you cannot ground a claim in the source documents, omit it.
```

---

## 10. Cover Letter Generator — Updates

### 10.1 Grounding Rule (Critical)

Prompt must include:
```
You are generating a cover letter draft for Wolf Schram.
SOURCE DOCUMENTS PROVIDED:
- Resume: [resume_text from DB]
- Capability Profile: [capability_profile_text from DB]
- Job Description: [job_description]

RULES:
- Use ONLY information from the source documents above.
- Do NOT invent metrics, achievements, or experience.
- Do NOT use AI-sounding phrases.
- Maximum 3 paragraphs. Executive voice. Specific and direct.
- If you cannot ground a statement in the source documents, do not include it.
```

### 10.2 Human Review Gate
- Cover letter status: DRAFT → REVIEWED → APPROVED
- Wolf must click "Approve" before letter is marked ready
- Editable textarea in-UI
- Version history (v1, v2, v3 stored)

---

## 11. First-Run Onboarding (Enables Multi-User / Product Packaging)

**Trigger:** On app load, if `personal_info` table has no `full_name` entry → show onboarding wizard.

### 11.1 Wizard Steps

```
Step 1: Who are you?
  Full Name, Email, Phone, LinkedIn URL, Location

Step 2: What are you looking for?
  Target Titles, Salary Range, Work Style, NOT interested in (text)

Step 3: Upload your documents
  Resume (PDF or docx) + Capability Profile (optional)
  Show parse preview — first 300 chars of extracted text

Step 4: Set up your watch list
  Enter 3-5 company career page URLs
  Auto-detect ATS type, show confirmation

Step 5: Health check
  Auto-run all API tests, show green/red per service
  If Anthropic API key not set → link to Settings
  "You're ready!" → redirect to Dashboard
```

### 11.2 Landing Page (fresh install, no DB)
- Headline: "Your Private Job Intelligence Engine"
- 3 value props: Discover roles from 4 ATS platforms + job boards / Score fit against your actual experience / Generate outreach briefs that get responses
- Sub: "Local-first. Your data never leaves your machine."
- CTA: "Get Started →" → triggers onboarding

---

## 12. Settings Tab Updates

Add:
```
API Keys section:
  Anthropic API Key (masked input, save to .env)
  Test button per key → runs health check for that service

Scoring Preferences:
  Min score threshold (slider 40-80, default 55)
  notFit terms (synced with Profile tab)

Search Preferences:
  Default location
  Results per source (slider 10-50)
  Watch list check frequency (daily / every 12h / manual only)
```

---

## 13. Hard Rules — Never Violate

```
NEVER re-add LinkedIn scraping, LinkedIn MCP, or any LinkedIn automated access
NEVER re-add auto-submit — Wolf approves and manually submits every application
NEVER store ATS passwords or credentials anywhere
NEVER generate cover letter or outreach content without grounding in DB resume/profile
NEVER add a job to pipeline without a description — no description = score 0 = skip
NEVER hardcode Wolf-specific data in server.js or HTML — everything from DB via Profile tab

Node: /Users/wolfgangschram/.nvm/versions/node/v20.19.2/bin/node
DB: SQLite at ~/Documents/ACTIVE/job-pipeline/pipeline.db
Server: port 3000, pm2 managed
```

---

## 14. Build Sequence — Execute In This Order

### Step 1 — KILL THE DEAD STUFF
Remove ATS Bot tab, App Questions tab, Challenges tab, all `/api/ats/*` routes, all LinkedIn MCP code, CDP launch logic, linkedin-mcp-client.js files. Verify server starts clean on port 3000.

### Step 2 — Health Tab Rebuild
Replace current health checks with API key tests (Anthropic, Gmail, Indeed/ts-jobspy, Greenhouse/Lever/Ashby/SmartRecruiters using test companies like Netflix/Airbnb). Green/yellow/red per service.

### Step 3 — Profile Tab Rebuild
Add resume upload + text parsing, capability profile upload, not-interested terms, work style, target industries. Remove ATS password field. Wire all fields to DB.

### Step 4 — Job Search: ATS API Sources
Implement Greenhouse/Lever/Ashby/SmartRecruiters API calls. Add ats_type + ats_token to monitored_companies. Add auto-detection on career URL entry. Wire results into existing search UI.

### Step 5 — Job Search: Fix ts-jobspy Sources
Add Google Jobs + ZipRecruiter. Remove LinkedIn from siteType array. Raise min score default to 55.

### Step 6 — Scoring Engine Upgrade
New dimension weights. Require description for scoring. Add hard title filters. Add evidence-citation rule to LLM prompt.

### Step 7 — Outreach Brief Generator
Auto-generate for any job ≥55. Show in job detail panel. Copy button. Ground in DB resume/profile. Hallucination guard in prompt.

### Step 8 — Cover Letter Grounding
Update prompt to source from DB. Add hallucination guard. Add human edit + approve flow. Add version history.

### Step 9 — Onboarding Wizard
First-run detection. 5-step wizard. Makes app usable by any executive job seeker, not just Wolf.

### Step 10 — Pipeline Stage Cleanup
Remove SUBMITTING/SUBMITTED. Add OUTREACH_SENT and MANUALLY_APPLIED. Update dashboard counts.

---

*Steps 1–8 complete = Wolf has a working tool.*
*Step 9 complete = it's a product.*
