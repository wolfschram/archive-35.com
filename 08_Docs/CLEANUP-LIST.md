# CLEANUP-LIST.md — Files Safe to Archive or Delete
Generated: March 23, 2026

## DO NOT TOUCH — Misidentified as safe to delete
The _files_to_delete/ folder currently contains:
- llms.txt — LIVE FILE. Deployed to archive-35.com/llms.txt. Do not delete.
- llms-full.txt — LIVE FILE. Referenced by AI agents. Do not delete.
- robots.txt — LIVE FILE. SEO critical. Do not delete.

These three files must be REMOVED from _files_to_delete/ immediately to prevent accidental deletion.

---

## Safe to Archive (move to 10_older documentation/)

| File | Reason |
|---|---|
| PHASE-2-BUILD.md | Historical build spec, superseded |
| PHASE-3-EMAIL-MCP.md | Historical build spec, superseded |
| PHASE-4-DASHBOARD-V2.md | Historical build spec, superseded |
| PHASE-5-DASHBOARD-REDESIGN.md | Historical build spec, superseded |
| PHASE-6-VISUAL-POLISH.md | Historical build spec, superseded |
| PHASE-7-DATA-INTELLIGENCE.md | Historical build spec, superseded |
| PHASE-8-FIX-EVERYTHING.md | Historical build spec, superseded |
| OVERNIGHT-BUILD.md | Historical spec, 64KB, superseded by FINAL-BUILD.md |
| FIX-ALL-METADATA.md | Completed task, archive |
| FIX-METADATA.md | Completed task, archive |
| MORNING-FIXES.md | Completed task, archive |
| PIPELINE_V3_REWRITE.md | Historical, check if still active |
| ATHOS_HANDOVER_SESSION7.md | ATHOS project doc in wrong repo — belongs in ATHOS repo |
| DISCOVERY.md | Early discovery doc, superseded |

## Safe to Delete

| File | Reason |
|---|---|
| mcp-publisher (18.6MB binary) | Binary in git root, should not be committed |
| bec4410ec1fa5d67379a63e652ce0c4d.txt | Domain verification file, likely expired |
| create_implementation_plan.js (40KB) | Build script, one-time use, check if still needed |
| prototype-v2.html | Prototype, not linked to live site |
| archive35-pinterest-demo.mp4 (668KB) | Video in git repo, should be stored externally |

## Untracked Files Needing Decision

| File | Action Needed |
|---|---|
| 06_Automation/.mcpregistry_github_token | Token file — confirm gitignored, never commit |
| 06_Automation/.mcpregistry_registry_token | Token file — confirm gitignored, never commit |
| 01_Portfolio/Bonneville_Salt_Flats/_gallery.json | New gallery — needs sync and deploy |
| 01_Portfolio/Boston/_gallery.json | New gallery — needs sync and deploy |
| 01_Portfolio/santiago_de_Chile/_gallery.json | New gallery — needs sync and deploy |
