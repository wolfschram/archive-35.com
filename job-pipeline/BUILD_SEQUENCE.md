# BUILD_SEQUENCE.md
# Wolf Schram · Job Application Pipeline · v2.0 · March 2026
# ─────────────────────────────────────────────────────────
# PURPOSE: Exact build order for Claude Code.
# Start here. Build in this sequence. Do not skip ahead.
# Each phase must be functional before the next begins.
# ─────────────────────────────────────────────────────────

---

## BEFORE YOU BUILD ANYTHING

Run GENERATE_CLAUDE_MD.md first.
Paste it into Claude Code in ~/job-pipeline/.
Let it scan, generate CLAUDE.md, confirm with Wolf.
Only then start Phase 1.

---

## PHASE 1 — FOUNDATION (Build first. Everything depends on this.)

**Goal:** Database running. Folders created. Dashboard skeleton live.

```
[ ] 1.1  Create ~/job-pipeline/ folder structure (all subfolders per AGENT_CHARTER Part 9)
[ ] 1.2  Create pipeline.db with full schema (all 6 tables from AGENT_CHARTER Part 2)
[ ] 1.3  Seed pipeline.db with 2–3 fake test jobs (for dashboard testing)
[ ] 1.4  Build dashboard skeleton at localhost:3000
          - 5 tabs (labels only, placeholder content)
          - Confirms DB connection on load
          - Shows job count from jobs table
[ ] 1.5  Verify dashboard reads from pipeline.db correctly
[ ] 1.6  Write session-handoff log
```

**Test before moving on:** Open browser → localhost:3000 → see job count from DB.

---

## PHASE 2 — INGESTION + SCORING (The top of the funnel)

**Goal:** Drop a job JSON in /incoming/ → it gets scored → shows in dashboard.

```
[ ] 2.1  Build Filesystem MCP (watch /incoming/ folder, trigger on new files)
[ ] 2.2  Build 24-hour ingestion alert (no files in /incoming/ → email Wolf)
[ ] 2.3  Build Job Evaluator MCP
          - Reads job JSON from /incoming/
          - Calls Claude Sonnet API with capability_profile.md
          - Writes score + label + reasoning to pipeline.db
          - Moves file to /scored/ or /archived/
          - Updates job status in pipeline.db
[ ] 2.4  Add launchd plist for Filesystem MCP (auto-start on login)
[ ] 2.5  Add launchd plist for Job Evaluator MCP
[ ] 2.6  Update dashboard Tab 2 (Job Inventory) with real data
[ ] 2.7  Add Tab 3 test button for Job Evaluator endpoint
```

**Test before moving on:** Drop test job JSON in /incoming/ → wait → see it scored in dashboard.

---

## PHASE 3 — COVER LETTER GENERATION (Cowork integration)

**Goal:** Scored HIGH/MEDIUM jobs trigger Cowork → complete package in /ready/.

```
[ ] 3.1  Build cover letter task writer in Lead Agent
          - Queries pipeline.db for SCORED status jobs
          - Writes cowork-queue.json task file
          - Updates status to COVER_LETTER_QUEUED
[ ] 3.2  Configure Cowork to read cowork-queue.json
          - Load Wolf's voice examples from /templates/cover_letter_examples/
          - Generate cover_letter.md, resume_bullets.md, qa_answers.md
          - Self-score, regenerate if <7
          - Flag DRAFT if second attempt still <7
          - Write to /ready/[job_id]/
          - Write completion flag back to task JSON
[ ] 3.3  Lead Agent polls for Cowork completion → updates pipeline.db to COVER_LETTER_READY
[ ] 3.4  Update dashboard Tab 2 to show COVER_LETTER_READY status
[ ] 3.5  Add Tab 3 test button for Cowork task queue
```

**Test before moving on:** Score a HIGH job → see Cowork generate letter → verify in /ready/ → see status update in dashboard.

---

## PHASE 4 — WOLF APPROVAL + EMAIL SUBMISSION

**Goal:** Wolf gets daily digest → approves → direct email sent autonomously.

```
[ ] 4.1  Build daily digest email generator
          - Queries pipeline.db for all COVER_LETTER_READY jobs
          - Formats digest: company, role, score, fit label, cover letter preview
          - Sends via Gmail MCP at 7am daily
          - Subject: [FYI] Job Pipeline — Daily Digest · <date>
[ ] 4.2  Build Gmail MCP reply parser
          - Monitors for Wolf's YES/NO/EDIT replies
          - YES → creates approved.flag in /ready/[job_id]/send_ready/
          - NO → updates status to SKIPPED
          - EDIT → updates status to PENDING_REVISION, emails Wolf with letter for edit
[ ] 4.3  Build autonomous email sender
          - Triggers on approved.flag + contact_email present in job record
          - Sends cover letter + resume via Gmail MCP
          - Updates status to SUBMITTED
          - Records submission method: EMAIL
[ ] 4.4  Update dashboard Tab 1 (Pipeline Overview) with approval queue count
[ ] 4.5  Add Tab 3 test button for Gmail MCP send endpoint
```

**Test before moving on:** Create a test job with contact_email → approve it → verify email sent → see SUBMITTED in dashboard.

---

## PHASE 5 — ATS PORTAL WORKFLOW

**Goal:** Approved ATS jobs appear in Wolf's daily checklist with all materials ready.

```
[ ] 5.1  Add ATS portal jobs to daily digest (separate section from email jobs)
[ ] 5.2  Build /ready/[job_id]/ viewer link in digest
          - Wolf clicks link → sees cover letter, Q&A, ATS portal URL in one view
          - Optimized for quick copy-paste into Chrome extension
[ ] 5.3  Wolf reviews in Chrome with Claude extension → submits → marks complete
[ ] 5.4  Build "Mark as Submitted" email reply handler
          - Wolf replies SUBMITTED to digest
          - System updates pipeline.db status: SUBMITTED, method: ATS_PORTAL
[ ] 5.5  Update dashboard with ATS submission tracking
```

**Test before moving on:** Full run — job scored → letter generated → approved → ATS workflow shown → mark submitted → see in dashboard.

---

## PHASE 6 — RESPONSE MONITORING + FEEDBACK LOOP

**Goal:** Incoming emails update job status. System learns from outcomes.

```
[ ] 6.1  Build Gmail MCP response monitor
          - 15-min polling cycle
          - Identifies replies to submitted applications
          - Parses response type: REJECTION / INTERVIEW / REQUEST_INFO / OFFER / GHOSTED
          - Writes to /responses/ and updates pipeline.db
[ ] 6.2  Build Feedback Analyzer MCP
          - Reads /responses/ and pipeline.db outcomes
          - Identifies patterns (which templates get interviews vs. rejections)
          - Updates insights.json
          - Flags underperforming templates to Lead Agent
[ ] 6.3  Build Sunday weekly report
          - Compiles outcomes, patterns, template performance
          - Emails Wolf: [WEEKLY REPORT] Job Pipeline — Week of <date>
[ ] 6.4  Auto-populate qa_bank from Wolf's email replies
[ ] 6.5  Complete dashboard Tab 5 (Feedback & Learnings)
```

**Test before moving on:** Simulate a rejection email → see it parsed → see status update in dashboard → see insights.json updated.

---

## PHASE 7 — HARDENING + FULL SELF-TEST

**Goal:** System is production-ready. Error handling proven. Dashboard complete.

```
[ ] 7.1  Implement full error protocol (Retry → Self-Heal → Quarantine → Continue)
          for all MCP servers
[ ] 7.2  Complete dashboard Tab 3 — all test buttons functional
[ ] 7.3  Build self-test runner (one button → tests all 7 agents → health score)
[ ] 7.4  Complete dashboard Tab 4 (Error Log) with re-queue button
[ ] 7.5  Add duplicate detection (same company + role within 90 days → BLOCK)
[ ] 7.6  Add token cost tracking per agent per day → show in dashboard
[ ] 7.7  Set up all launchd plists for all MCP servers
[ ] 7.8  Run full end-to-end test: ingest → score → generate → approve → submit → response → feedback
[ ] 7.9  Write final CLAUDE.md with complete project state
[ ] 7.10 Wolf signs off: "Pipeline is live."
```

---

## REFERENCE — What Each Phase Costs

| Phase | Claude API calls | Estimated cost |
|---|---|---|
| 1–3 (build + test) | ~100 test calls | ~$0.50 one-time |
| 4–6 (build + test) | ~50 test calls | ~$0.25 one-time |
| 7 (hardening) | ~50 test calls | ~$0.25 one-time |
| **Ongoing (production)** | ~600/day | **~$0.90/day** |

---

## REFERENCE — Agent Build Order Summary

```
Phase 1: pipeline.db → Dashboard skeleton
Phase 2: Filesystem MCP → Job Evaluator MCP
Phase 3: Cover Letter task writer → Cowork integration
Phase 4: Daily digest → Gmail reply parser → Email sender
Phase 5: ATS workflow → submission tracking
Phase 6: Response monitor → Feedback Analyzer → Weekly report
Phase 7: Error hardening → Self-test runner → Go live
```

---

*End of BUILD_SEQUENCE.md*
*Follow phases in order. Test after each phase. Never skip ahead.*
