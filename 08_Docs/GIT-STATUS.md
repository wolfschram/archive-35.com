# GIT-STATUS.md — Repository Sync State
Generated: March 23, 2026

## Modified But Uncommitted (PRODUCTION FILES — URGENT)

| File | Risk |
|---|---|
| Archive 35 Agent/src/api.py | CRITICAL — 5500+ line production API, changes lost on crash |
| Archive 35 Agent/docker-compose.yml | HIGH — service configuration |
| Archive 35 Agent/data/archive35.db | Expected — SQLite, should be gitignored |
| Archive 35 Agent/logs/* | Expected — logs, should be gitignored |
| Archive 35 Agent/decisions.json | LOW — agent state |
| data/licensing-catalog.json | HIGH — catalog changes not committed |

## Untracked Files Needing Attention

| File | Action |
|---|---|
| 01_Portfolio/Bonneville_Salt_Flats/_gallery.json | 3 new galleries not deployed |
| 01_Portfolio/Boston/_gallery.json | 3 new galleries not deployed |
| 01_Portfolio/santiago_de_Chile/_gallery.json | 3 new galleries not deployed |
| 06_Automation/dist/ | Build output, confirm gitignored |
| mcp-publisher | 18.6MB binary in repo root — should not be here |

## Recent Commit Health
Last 20 commits look clean and well-described. Commit cadence is active. Last deploy: March 19, 2026 (4 days ago).

## Immediate Actions Required
1. Commit api.py and docker-compose.yml changes NOW before any crash
2. Commit licensing-catalog.json if changes are intentional
3. Run sync_gallery_data.py and deploy the 3 new galleries (Bonneville, Boston, Santiago)
4. Confirm archive35.db and logs/ are in .gitignore
5. Remove mcp-publisher binary from repo
