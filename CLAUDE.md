# CLAUDE.md — archive-35
Last updated: March 2026

> Read this COMPLETELY before touching anything.
> This is a LIVE business with real customers and real payments.

---

## What is this?
Fine art photography e-commerce. LIVE at archive-35.com.
Brand: **The Restless Eye** | Tagline: Light. Place. Time.
Owner: Wolf Schram | wolf@archive-35.com

## Stack
| Layer | Technology |
|-------|------------|
| Frontend | React (Cloudflare Pages, git push auto-deploy) |
| Agent API | Python FastAPI, uvicorn, port **8035** |
| Studio app | Electron + React (react-scripts), port **3001** |
| Mockup service | Node.js, port **8036** |
| Payments | Stripe (wolfbroadcast@gmail.com) |
| Fulfillment | Pictorem |
| DNS/CDN | Cloudflare |

## Port map — MEMORIZE THIS
| Service | Port |
|---------|------|
| Agent (Python) | 8035 |
| Mockup service | 8036 |
| Studio (react-scripts) | **3001** (set via .env) |
| job-pipeline | 3000 (separate project) |

## NEVER do this
- Deploy without running sync_gallery_data.py first
- Touch checkout, auth, email flows, or Google Sheet webhook without full test
- Change Stripe keys or webhook endpoints without Wolf
- Use port 3000 for Studio (job-pipeline owns 3000)

## Three-system rule
Any change to a shared file = test ALL THREE: Studio + Agent + Mockup

## How to start Studio
```bash
cd ~/Documents/ACTIVE/archive-35/05_Studio/app
npm run dev
# Opens on http://localhost:3001
```

## How to start Agent
```bash
cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent
python3 src/api.py
# Runs on http://127.0.0.1:8035
```

## Deploy website
```bash
# ALWAYS run this first:
python3 sync_gallery_data.py
# Then:
git add . && git commit -m "..." && git push
# Cloudflare auto-deploys
```

## Active threads (check STATUS.md for details)
- Photografique Issue 002 submission
- Pinterest API resubmission
- Indiewalls profile (address bug)
- Etsy API approval
- Meta API
- CaFE Chrome extension

## Key repos
- Website: github.com/wolfschram/archive-35.com
- MCP server: ~/Documents/ACTIVE/archive-35/06_Automation/archive35_mcp.py
