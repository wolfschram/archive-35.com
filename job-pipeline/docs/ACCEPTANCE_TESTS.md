# ACCEPTANCE TESTS — Job Pipeline v2.1.1

> Merged from independent reviews by Gemini (16 tests) and ChatGPT (84 tests).
> Corrected for v2.1.1 spec: APPLIED→SUBMITTED, better-queue→native polling, keyword→Haiku scoring,
> Chrome extension→paste UI, DRAFT→PENDING_APPROVAL+needs_review, unknown added to response_type.
> Additional tests added for: visual monitoring, daily circuit breaker, job_fingerprint, prompt_registry,
> bridge_events, needs_review flag, /api/health endpoint, claim schema, job_current_state view.
>
> Last updated: 2026-03-05
> Source spec: MASTER-ARCHITECTURE-v2.md (v2.1.1)

---

## How to Use This File

- **Before building a phase:** Read all tests for that phase
- **After building a phase:** Run every test marked for that phase
- **Pass/Fail column:** Fill in during testing. Leave blank until tested.
- Tests marked ⚠️ were corrected from v2.0 originals (see notes)
- Tests marked 🆕 were added for v2.1.1 features not in original punchlists

---

## Phase 7 — Command Center v2 + DB Migration + New Endpoints

### Database & Schema

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-001 | migrate-v2.js | Run migration on existing Phase 1–6 pipeline.db with real data. Then run again. | First run adds new tables/indexes; second run is idempotent (no errors, no duplicates). | Migration fails, drops/rewrites existing tables, or second run errors. | GPT | |
| T-002 | SQLite schema | After migration, query sqlite_master for: personal_info, company_research, challenges, conductor_queue, cover_letter_versions, application_submissions, bridge_events, prompt_registry. | All tables exist with columns matching spec. | Missing table/column or wrong constraint types. | GPT+v2.1 | |
| T-003 | SQLite indexes | Query PRAGMA index_list(<table>) for all specified new indexes. | All indexes exist and attached to correct columns. | Missing indexes or wrong target columns. | GPT | |
| T-004 | company_research | Insert a company_research row for a job_id; attempt second insert same job_id. | Second insert fails due to UNIQUE(job_id). | Two rows exist for same job_id. | GPT | |
| T-005 | FK CASCADE | Create job → add company_research, challenges, cover_letter_versions; delete the job. | Dependent rows removed (ON DELETE CASCADE). | Orphaned rows remain. | GPT | |
| T-006 | jobs.status CHECK | Attempt DB update setting jobs.status = 'APPLIED'. | DB rejects it (APPLIED not in allowed statuses). | Update succeeds. | GPT | |
| T-007 | template_metrics view | Insert jobs with status SUBMITTED; add application_submissions with response_type = interview, rejection, offer; query template_metrics. | ⚠️ View counts correctly using SUBMITTED + LEFT JOIN to application_submissions (v2.1 fix). | View returns 0 because it filters on APPLIED (old bug). | GPT/fixed | |
| T-008 | job_fingerprint dedup | Insert job for "Acme Corp / VP Eng / San Francisco". Insert same company+title+location within 90 days. | Second insert blocked by job_fingerprint uniqueness check. | Two identical applications exist. | Gemini+v2.1 | |
| T-009 | response_type CHECK | Attempt to insert application_submission with response_type = 'unknown'. | 🆕 DB accepts it (unknown added to CHECK in v2.1.1). | DB rejects 'unknown'. | v2.1.1 | |
| T-010 | conductor_queue schema | Inspect conductor_queue table for columns: idempotent, idempotency_key, checkpoint. | All three columns exist with correct types. | Missing columns. | v2.1 | |
| T-011 | needs_review column | Inspect cover_letter_versions table for needs_review column. | Column exists, INTEGER DEFAULT 0. | Missing column. | v2.1.1 | |

### API & Dashboard

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-012 | GET /v2 | Request GET http://localhost:3000/v2 | HTML response with references to modular css/command-center.css and js/cc-*.js. | 404, serves old dashboard, or missing module references. | GPT | |
| T-013 | Tab 1 Pipeline | Open /v2, switch to Tab 1, wait for data load. | 4-card stats render; job status columns render counts; job table populates. | Empty UI, JS console errors, or API call failures. | GPT | |
| T-014 | Auto-refresh | Open /v2, insert a job via DB, wait 60-70 seconds. | UI updates without manual reload. | Requires manual refresh. | GPT | |
| T-015 | Mobile viewport | Open /v2 in iPhone viewport (DevTools), navigate all tabs. | No horizontal scroll for core layouts; controls usable. | Tabs unusable, columns overflow, buttons unreachable. | GPT+Gemini | |
| T-016 | GET /api/personal-info | Seed several keys in personal_info; call endpoint. | JSON object { key: value } for all rows. | Returns array or missing keys. | GPT | |
| T-017 | PUT /api/personal-info | PUT { "full_name": "X", "email": "Y" }, then PUT again with updated email. | One row per key; updated_at changes; GET returns updated values. | Duplicate rows or values not updated. | GPT | |
| T-018 | GET /api/personal-info/:key | Request existing key and missing key. | Existing returns value; missing returns 404. | Missing returns 200 null. | GPT | |
| T-019 | GET/PUT /api/research/:jobId | PUT notes for job; GET; PUT updated; GET again. | Single row per job_id; updates replace fields. | Multiple rows or stale data. | GPT | |
| T-020 | POST /api/research/:jobId/copy-prompt | Create job with company/title; call copy-prompt. | Returned prompt contains substituted company/role values. | Template still has placeholders. | GPT | |
| T-021 | /api/challenges CRUD | POST challenge; GET list with job_id filter; GET by id; PUT update; DELETE; confirm. | Correct CRUD semantics; filters work. | Wrong filtering or deleted items still returned. | GPT | |
| T-022 | challenges.category CHECK | Try POST with invalid category value. | API returns 400; DB rejects invalid category. | Invalid category stored. | GPT | |
| T-023 | GET /api/challenges/reusable | Create reusable=1 challenges across categories; call endpoint. | Grouped by category with correct items. | Not grouped, includes reusable=0. | GPT | |
| T-024 | GET /api/submissions | Insert submissions with various response_type; call with filters. | Filter by response_type works correctly. | Filter does nothing or errors. | GPT | |
| T-025 | Tab 5 Applied | Seed submissions; open Tab 5; validate columns. | Tab shows correct rows and computed "Days Since". | Tab empty or mismatched data. | GPT | |
| T-026 | "Mark as Ghosted" | For submission >30 days with response_type=none, click "Mark as Ghosted". | Submission response_type becomes ghosted; UI updates. | No change persisted. | GPT | |

### 🆕 Visual Monitoring (v2.1.1)

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-027 | GET /api/health | Call endpoint with all services running. | Returns JSON with all 6 components (sqlite, gmail, playwright, express, pm2, disk) + budget info. | Missing component or malformed response. | v2.1.1 | |
| T-028 | Tab 7 System Health | Open Tab 7 in dashboard. | Pipeline flow graph renders with correct nodes; health grid shows 6 cards; job heatmap shows 30 days. | Tab empty, elkjs fails to load, or cards missing. | v2.1.1 | |
| T-029 | Health card colors | Mock Gmail token expiring in 2 days; check health grid. | Gmail card shows yellow status. | Card stays green despite warning condition. | v2.1.1 | |
| T-030 | Alert banner | Mock Gmail token expiring in 12 hours. | Red alert banner appears at top of dashboard (visible on all tabs). | No banner or only visible on Tab 7. | v2.1.1 | |
| T-031 | Pipeline graph click | Click on "Scorer" node in pipeline flow graph. | Inline panel expands showing recent jobs at SCORED stage. | Nothing happens or page navigates away. | v2.1.1 | |
| T-032 | Job heatmap click | Click on a day with jobs in the heatmap. | Tab 1 job table filters to that date. | No filter applied or wrong date. | v2.1.1 | |

---

## Phase 8 — Cover Letter Generator + Hallucination Filter

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-033 | POST /api/generate-letter/:jobId | Create scored job + research + context files; call generate-letter. | cover_letter_versions row created: version=1, content populated, hallucination_check not null, cost fields populated. | No DB row or content only on filesystem. | GPT | |
| T-034 | Two-call pattern | Inspect logs/DB for two distinct Claude calls (extract facts → assemble letter). | ⚠️ Two separate API calls observable: Call 1 returns JSON facts, Call 2 assembles from facts (v2.1 pattern). | Only one call or no evidence of separation. | GPT/fixed | |
| T-035 | Hallucination filter | Temporarily remove a known fact from context files; force generator to include it. | hallucination_check=fail and flagged_claims includes the claim. | Passes despite missing evidence. | GPT+Gemini | |
| T-036 | Claim Schema | Generate letter with dates, numbers, company names, technologies; run filter. | 🆕 Hard claims (numbers, dates, companies) have evidence linkage. Soft claims allowed. flagged_claims is valid JSON array. | Claims not categorized as hard/soft or missing evidence links. | v2.1 | |
| T-037 | Regeneration loop | Force first output to self_score < 7; trigger generation. | ⚠️ Second attempt occurs exactly once; if still <7 then job set to PENDING_APPROVAL with cover_letter_versions.needs_review=1 (v2.1.1 fix — not "DRAFT"). | Infinite loop, >2 attempts, or no retry. | GPT/fixed | |
| T-038 | needs_review flag | Force 2 failures (<7 self-score). Check cover_letter_versions. | 🆕 Latest version has needs_review=1. Job status is PENDING_APPROVAL. | needs_review still 0 or job in undefined status. | v2.1.1 | |
| T-039 | Daily circuit breaker | Generate 5 cover letters in one day. Attempt 6th. | 🆕 6th generation blocked; job stays in COVER_LETTER_QUEUED; processes next day. | 6th generation proceeds or no queue holdover. | v2.1 | |
| T-040 | Budget ceiling | Set config budget very low; attempt generation. | Generation blocked/paused and Wolf email triggered. | Generation continues past budget. | GPT+Gemini | |
| T-041 | Banned cliché filter | Generate letter; scan output for: "delve", "leverage", "utilize", "synergy", "passionate about". | None appear. | Any banned word present. | GPT | |
| T-042 | Word count limit | Generate letter; compute word count. | ≤350 (≤400 absolute max). | Exceeds 400. | GPT | |
| T-043 | Letters list endpoint | Generate 2 versions; call GET /api/letters/:jobId and /api/letters/:jobId/:version. | First returns both versions in order; second returns exact match. | Wrong version mapping or missing history. | GPT | |
| T-044 | Prompt registry | After generation, check prompt_registry table. | 🆕 Entry exists with prompt version + model version used for this generation. | No registry entry or missing model info. | v2.1 | |

---

## Phase 9 — Conductor (Queue, Scheduling, Idempotency, Circuit Breakers)

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-045 | Conductor start | Start via pm2; verify running. | Process runs continuously; restarts on login via launchd. | Not running after restart. | GPT | |
| T-046 | Queue persistence | Enqueue tasks; restart pm2; check queue. | ⚠️ Pending tasks remain in conductor_queue SQLite table (native polling, not better-queue — v2.1 fix). | Queue cleared or duplicates. | GPT/fixed | |
| T-047 | Polling loop | Observe conductor scheduler.js setInterval behavior. | ⚠️ 5-second polling interval with BEGIN EXCLUSIVE transactions (v2.1 — replaces better-queue). | Uses better-queue or npm package. | v2.1 | |
| T-048 | Scrape scheduling | Set scheduler to short interval in test mode; observe scrape task insertion. | Scrape tasks appear on schedule. | No tasks or wrong interval. | GPT | |
| T-049 | Gmail polling | Observe check_response tasks at 15-min interval. | Tasks inserted and processed. | Drift, missed cycles, or duplicates. | GPT | |
| T-050 | Daily digest | Force scheduler time trigger; confirm digest generation. | Digest email created/sent at 7am with one-click localhost approval links. | No digest or wrong timezone. | GPT | |
| T-051 | State machine | Run test job: NEW→SCRAPED→SCORED→COVER_LETTER_QUEUED→COVER_LETTER_READY→PENDING_APPROVAL. | Each status update recorded with date_updated changed. | Illegal transitions or skipped statuses. | GPT | |
| T-052 | Idempotency: score | Enqueue two identical score tasks for same job_id concurrently. | Job ends with one score; no duplicate scored files. | Conflicting status or duplicate scores. | GPT+Gemini | |
| T-053 | Idempotency: generate | Enqueue two generate_letter tasks for same job_id. | Only one executes, or second becomes version 2 deterministically. | Two "version 1" rows or UNIQUE constraint errors. | GPT | |
| T-054 | Idempotency key | Check conductor_queue for non-idempotent tasks (submit_ats, send_email). | 🆕 idempotency_key populated; do-not-repeat guard prevents re-execution. | No key set or guard missing. | v2.1 | |
| T-055 | Circuit breaker escalation | Force same error type 3 times in 24h. | Escalation email sent per spec. | No escalation. | GPT | |
| T-056 | Stall detection | Freeze a worker so processing stops past threshold. | Dashboard shows unhealthy; alert triggers. | Silent stall. | GPT+Gemini | |
| T-057 | Manual trigger | POST /api/conductor/trigger/:taskType with valid/invalid types. | Valid inserts queue item; invalid returns 400. | Accepts invalid types or doesn't enqueue. | GPT | |
| T-058 | Retry failed item | POST /api/conductor/retry/:id on failed queue item. | retry_count increments; status returns to queued. | No change or duplicate item. | GPT | |
| T-059 | Single DB writer | Run API server + conductor concurrently; execute 100 mixed operations. | 🆕 Conductor owns all writes via BEGIN EXCLUSIVE; no "database locked" errors. | Persistent lock errors or corruption. | GPT+v2.1 | |

---

## Phase 10 — ATS Bot (Playwright, CDP, Adapters, Checkpoint/Resume)

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-060 | CDP connect | Launch bot; verify it connects to warm browser via CDP. | ⚠️ playwright.chromium.connectOverCDP() to running Chrome (v2.1 — not separate profile). | Uses vanilla profile or headless mode. | GPT/fixed | |
| T-061 | Pull-based trigger | Click "Start ATS Submissions" on dashboard; observe bot behavior. | ⚠️ Bot starts processing approved queue (pull-based, not cron — v2.1 fix). | Bot runs on schedule without user trigger. | GPT/fixed | |
| T-062 | Personal info fill | Populate personal_info; run bot on staging form with standard fields. | Fields populated from DB values exactly. | Hardcoded values or wrong mapping. | GPT | |
| T-063 | Resume upload | Place resume PDF in templates/; run upload step. | Bot finds and uploads resume. | Bot fails due to filename. | GPT | |
| T-064 | Cover letter paste | Ensure ready folder exists; run bot on form with cover letter field. | Cover letter text pasted accurately from DB/filesystem. | Content truncated or mismatched. | GPT | |
| T-065 | Multi-page flow | Run on multi-step staging application with Next/Back. | Completes all pages, populates required fields on each. | Stops mid-way or loses data. | GPT | |
| T-066 | Pause-before-submit | Run up to final submit button. | Bot pauses and requires Wolf's confirmation; does NOT click submit. | Bot submits autonomously. | GPT+Gemini | |
| T-067 | CAPTCHA detection | Use page that triggers CAPTCHA (or simulate selector). | Bot pauses, logs event, alerts Wolf. | Bot loops, crashes, or tries to bypass. | GPT | |
| T-068 | Platform adapter: Greenhouse | Run on Greenhouse staging form. | 🆕 greenhouse.js adapter selected; logs show adapter name. | Hardcoded selectors with no adapter concept. | v2.1 | |
| T-069 | Platform adapter: Lever | Run on Lever staging form. | 🆕 lever.js adapter selected; different selector strategy from Greenhouse. | Same selectors used regardless of platform. | v2.1 | |
| T-070 | Checkpoint/resume | Force crash mid-application; restart bot for same job. | ⚠️ Resumes from checkpoint stored in conductor_queue.checkpoint column (v2.1). | Duplicates submission or cannot continue. | GPT/fixed | |
| T-071 | Dual monitor | Start bot with dual monitors; verify window placement. | Opens on secondary display. | Always opens on primary. | GPT | |
| T-072 | Duplicate submission guard | Attempt to submit to same company+role that already has SUBMITTED status. | 🆕 Non-idempotent guard blocks re-submission. job_fingerprint check prevents it. | Double application sent. | v2.1 | |

---

## Phase 11 — Gmail MCP (OAuth, Polling, Classification, Send)

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-073 | OAuth happy path | Complete OAuth once; restart service; perform inbox read. | Token persists; no re-auth on restart. | Requires OAuth every run. | GPT | |
| T-074 | OAuth failure | Revoke token; run polling. | Immediate escalation email/log; no silent retry loops. | Keeps retrying without escalation. | GPT | |
| T-075 | OAuth 7-day expiry | 🆕 Check token refresh behavior near 7-day boundary. | Token auto-refreshes before expiry; dashboard shows days remaining (via /api/health). | Token expires silently requiring manual re-auth. | v2.1 | |
| T-076 | Inbox polling | In test mode shorten 15-min interval; verify periodic API calls. | Polling occurs on schedule; results processed once. | Duplicate processing or missed polls. | GPT | |
| T-077 | Classification: clear emails | Send 4 test emails (rejection, interview, request_info, offer). | Each classified correctly → application_submissions.response_type + response_date. | Misclassification or no DB write. | GPT+Gemini | |
| T-078 | Classification: ambiguous email | Send ambiguous email; inspect classification. | 🆕 response_type = 'unknown' with low confidence score. Wolf sees it for manual review. | Forced into wrong category or crashes on ambiguity. | v2.1.1 | |
| T-079 | Confidence scoring | Classify clear vs ambiguous emails; compare confidence. | 🆕 Confidence score 0-1 stored per classification. Clear emails = high confidence, ambiguous = low. | No confidence value stored or all scores identical. | v2.1 | |
| T-080 | Verification code | Send "Account Verification Code: 123456" email. | Code extracted and stored in accessible location. | Code ignored or only in logs. | GPT | |
| T-081 | Send flow approval | Attempt send for job in APPROVED status. | ⚠️ Send proceeds (approval lives in DB status, not approved.flag — v2.1 fix). | Send blocked despite APPROVED status. | GPT/fixed | |
| T-082 | Dashboard auth indicator | Check Gmail section on dashboard. | 🆕 Shows OAuth status, token expiry date, connection health. | No indicator visible. | v2.1 | |

---

## Phase 12 — Content Ingestion (Dashboard Paste UI)

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-083 | Paste UI exists | Open Command Center v2; look for "Import Content" panel. | ⚠️ UI exists in dashboard with content type selector, job selector, textarea, Import button (v2.1 — replaces Chrome extension). | No UI or references Chrome extension. | GPT/fixed | |
| T-084 | POST /api/bridge/ingest | POST known payload with valid bearer token. | API returns success; content appears in correct DB table. | 401/403/500 or content dropped. | GPT | |
| T-085 | Auth token required | Call /api/bridge/ingest without token, then with BRIDGE_AUTH_TOKEN. | Without token: 401. With token: success. | Accepts without token. | GPT | |
| T-086 | Schema validation | Upload malformed JSON (missing content_type or job_id), then valid JSON. | Malformed rejected with 400 + error details; valid accepted. | Malformed accepted. | GPT | |
| T-087 | Size limit | POST payload >50KB. | Rejected with clear error. | Oversized payload accepted. | v2.1 | |
| T-088 | bridge_events audit | Upload content; query bridge_events table. | 🆕 Append-only audit record exists with timestamp, source, content_type, job_id. | No audit trail. | v2.1 | |
| T-089 | Content routing | Paste cover_letter type content; paste research type content. | Each routes to correct table (cover_letter_versions vs company_research). | Content stored in wrong table. | v2.1 | |
| T-090 | Dashboard notification | Ingest content via paste UI. | Dashboard shows notification "Content imported for Job #123". | Silent import with no feedback. | GPT | |

---

## Phase 12.5 — System Health Tab (Visual Monitoring)

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-091 | /api/health response | Call endpoint with all services running. | 🆕 Returns JSON: 6 components + budget (daily_spent, daily_limit, monthly_spent, cover_letters_today). | Missing components or no budget info. | v2.1.1 | |
| T-092 | /api/health thresholds | Mock various degraded states (high disk, expiring OAuth). | 🆕 Component status changes: ok→warning→error at defined thresholds (§17.2 of spec). | Status stays "ok" regardless of state. | v2.1.1 | |
| T-093 | elkjs lazy loading | Open Tabs 1-6, verify no elkjs loaded. Open Tab 7. | 🆕 elkjs loads only when Tab 7 is active. Network tab shows CDN request only on tab switch. | elkjs loaded on page load (wasted bandwidth). | v2.1.1 | |
| T-094 | Pipeline graph edges | Add jobs to queue; observe graph. | 🆕 CSS pulse animation on edges between nodes with queue_depth > 0. | Static edges regardless of flow. | v2.1.1 | |
| T-095 | Alert banner across tabs | Trigger alert condition; navigate between tabs. | 🆕 Banner visible on ALL tabs (not just Tab 7). | Banner only on Tab 7 or disappears on navigation. | v2.1.1 | |
| T-096 | Budget display in health | Check budget section of /api/health after generating 3 cover letters. | 🆕 cover_letters_today = 3, daily_spent reflects actual API costs. | Stale or zero budget numbers. | v2.1.1 | |

---

## Phase 13 — Multi-Platform Search + Hardening + End-to-End

| ID | Component | What to Do | Expected Result | Failure Indicator | Source | Pass/Fail |
|----|-----------|-----------|-----------------|-------------------|--------|-----------|
| T-097 | Multi-source ingestion | Run LinkedIn + one additional source (Indeed or Glassdoor). | At least 2 sources produce normalized job records matching schema. | Only one source works or schemas differ. | GPT+Gemini | |
| T-098 | 24-hour no-jobs alert | Disable all scrapers; wait/fast-forward interval. | Email Wolf when no jobs for 24h. | Silence. | GPT+Gemini | |
| T-099 | Dedup: exact match | Insert job A; submit; ingest same company+title+location at day 30. | System blocks with clear reason via job_fingerprint. | Submission proceeds. | GPT | |
| T-100 | Dedup: boundary | Same company + slightly different title ("VP Engineering" vs "VP of Engineering"). | Behavior is deterministic and logged. | Random/inconsistent decisions. | GPT | |
| T-101 | Dedup: 91-day window | Same company+title+location but 91 days later. | Allowed through (outside 90-day window). | Still blocked. | v2.1 | |
| T-102 | E2E: email path | Ingest → score → generate → approve → submit via email → response. | Job ends SUBMITTED; application_submissions row method=email; email sent. | Any step requires manual DB edits. | GPT | |
| T-103 | E2E: ATS path | Ingest → score → generate → approve → ATS submit (Playwright) → pause → confirm. | application_submissions row method=ats_portal with platform set; job SUBMITTED. | Bot can't map job or submission not logged. | GPT | |
| T-104 | E2E: response → feedback | After submission, send interview + rejection emails; run poll; run feedback analyzer. | DB updated; template_metrics reflects outcomes; insights tracked. | Outcomes not linked to template_version. | GPT | |
| T-105 | Error protocol Strike 1/2/3 | Induce deterministic failure; observe retry 30s, self-heal window, quarantine. | Strike 3: ERROR_BLOCKED, job quarantined, email Wolf, other jobs continue. | Pipeline halts or no quarantine. | GPT | |
| T-106 | Quarantine isolation | Run 5 jobs; force one to Strike 3; verify remaining 4 continue. | 4 jobs complete; 1 quarantined. | Queue stalls or global stop. | GPT | |
| T-107 | 60s refresh baseline | Confirm UI updates all tabs within 60 seconds without WebSockets. | All updates visible within 60s. | Requires WebSockets or manual refresh. | GPT | |
| T-108 | launchd plists | Install plists; reboot; verify Express + Conductor + Gmail MCP come up. | All services start automatically. | Any service requires manual start. | GPT | |
| T-109 | job_current_state view | Query view after jobs are in various stages with submissions. | 🆕 View returns jobs.* + latest application_submission for derived effective_status. | View missing, errors, or doesn't join correctly. | v2.1 | |

---

## Summary

| Phase | Test Range | Count | Category |
|-------|-----------|-------|----------|
| 7 | T-001 → T-032 | 32 | DB + API + Dashboard + Visual Monitoring |
| 8 | T-033 → T-044 | 12 | Cover Letters + Hallucination + Circuit Breaker |
| 9 | T-045 → T-059 | 15 | Conductor + Queue + Idempotency |
| 10 | T-060 → T-072 | 13 | ATS Bot + CDP + Adapters |
| 11 | T-073 → T-082 | 10 | Gmail OAuth + Classification |
| 12 | T-083 → T-090 | 8 | Content Ingestion (Paste UI) |
| 12.5 | T-091 → T-096 | 6 | System Health Tab |
| 13 | T-097 → T-109 | 13 | Multi-Platform + E2E + Hardening |
| **Total** | | **109** | |

### Corrections from v2.0 originals (⚠️ marked)
- T-007: template_metrics now uses SUBMITTED + LEFT JOIN (not APPLIED)
- T-034: Two-call pattern is Extract→Assemble, not generate+filter
- T-037: Failed letters → PENDING_APPROVAL + needs_review=1 (not "DRAFT")
- T-046: Queue persistence uses SQLite conductor_queue (not better-queue npm package)
- T-047: Native 5s polling loop with BEGIN EXCLUSIVE (not better-queue)
- T-060: CDP connect to warm browser (not separate Chrome profile)
- T-061: Pull-based trigger via dashboard button (not cron)
- T-070: Checkpoint column on conductor_queue (not filesystem)
- T-081: Approval lives in DB status (not approved.flag file)
- T-083: Dashboard paste UI (not Chrome extension)

### New tests for v2.1.1 features (🆕 marked)
- T-009: unknown in response_type CHECK
- T-010: conductor_queue new columns
- T-011: needs_review column
- T-027-032: System Health tab + /api/health
- T-036: Claim Schema (hard/soft claims)
- T-038: needs_review flag behavior
- T-039: Daily circuit breaker (5/day limit)
- T-044: Prompt registry
- T-054: Idempotency key for non-idempotent tasks
- T-059: Single DB writer pattern
- T-068-069: Platform adapters (Greenhouse/Lever)
- T-072: Duplicate submission guard
- T-075: OAuth 7-day expiry
- T-078-079: Unknown classification + confidence scoring
- T-082: Dashboard Gmail auth indicator
- T-087-089: Bridge size limit + audit + routing
- T-091-096: Phase 12.5 health tab tests
- T-101: Dedup 91-day boundary
- T-109: job_current_state view
