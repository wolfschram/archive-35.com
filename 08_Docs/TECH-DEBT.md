# TECH-DEBT.md — Top 10 Duplication & Debt Items
Generated: March 23, 2026

## TD-01: api.py is 5500+ lines — single monolithic file
The entire Agent API lives in one file. 100+ endpoints, all integrations, all business logic. High risk — one bad edit can break everything. Already partially addressed with routes/ folder but api.py is still the monolith.

## TD-02: PHASE-*.md sprawl in root (8 files, ~180KB)
PHASE-2 through PHASE-8 build specs are in the root directory. These are historical build instructions, not reference docs. They create confusion about what is actually built vs. planned.

## TD-03: Dual catalog architecture not enforced in code
licensing-catalog.json and micro-licensing-catalog.json rules are documented but not programmatically enforced. Any script that writes to the wrong catalog would corrupt both checkout flows silently.

## TD-04: agent-dashboard.html is 148KB single file
The entire operator dashboard is one massive HTML file. Hard to maintain, impossible to test in parts. Already documented in CLAUDE.md but not addressed.

## TD-05: Two .env files for the same project
Root .env and Archive 35 Agent/.env contain overlapping and interdependent credentials. Easy to update one and miss the other.

## TD-06: mcp-publisher binary in repo root (18.6MB)
mcp-publisher is an 18.6MB binary sitting in the repo root. Should not be committed to git.

## TD-07: _files_to_delete/ contains llms-full.txt, llms.txt, robots.txt
These are live website files (llms.txt and robots.txt are deployed). Having them in _files_to_delete/ is dangerous — wrong move deletes SEO-critical files.

## TD-08: gallery.html is 205KB
Gallery page is enormous. Likely contains all 744 images inline. Performance risk and maintenance burden.

## TD-09: Duplicate checkout logic
micro-licensing.html has a primary + fallback checkout chain. licensing.html likely has similar. Two checkout pages with similar but divergent logic that both need to stay in sync.

## TD-10: Uncommitted changes in critical files
git status shows api.py, docker-compose.yml, and licensing-catalog.json as modified but uncommitted. These are production files. Any crash loses these changes.
