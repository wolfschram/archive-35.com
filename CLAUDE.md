# CLAUDE.md — archive-35
Last updated: March 18, 2026

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
| Agent API | Python FastAPI, uvicorn, Docker, port **8035** |
| Studio app | Electron + React (react-scripts), port **3001** |
| Mockup service | Node.js, port **8036** |
| Payments | Stripe (wolfbroadcast@gmail.com) |
| Fulfillment | Pictorem |
| DNS/CDN/Analytics | Cloudflare |
| Email | IMAP MCP (3 accounts: wolf@archive-35.com, wolfbroadcast@gmail.com, wolfbroadcast@icloud.com) |

## Port map — MEMORIZE THIS
| Service | Port |
|---------|------|
| Agent (Python/Docker) | **8035** |
| Mockup service | **8036** |
| Studio (react-scripts) | **3001** (set via .env) |
| job-pipeline | 3000 (separate project — NEVER use 3000 here) |

---

## How to Start the Agent (Docker)
```bash
cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent
docker compose up -d
# API runs on http://localhost:8035
# Health: http://localhost:8035/health
# Swagger: http://localhost:8035/docs
```

### Docker Architecture
- **agent-api**: FastAPI REST server (port 8035)
- **agent-scheduler**: Huey task queue (daily pipeline, content gen, posting)
- **agent-telegram**: Telegram bot (optional, needs TELEGRAM_BOT_TOKEN)

### Docker Volume Mounts
- `./data:/app/data` — SQLite DB, photos, content (persistent)
- `./logs:/app/logs` — Daily log files
- `./.env:/app/.env` — Credentials (so token refresh can write back)
- `./src:/app/src` — Source code (live mount for development)

### Restart Agent
```bash
cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent
docker compose restart agent-api  # Restart API only
docker compose down && docker compose up -d  # Full restart
```

## How to Start Studio
```bash
cd ~/Documents/ACTIVE/archive-35/05_Studio/app
npm run dev
# Opens on http://localhost:3001
```

---

## Deploy Website
```bash
# ALWAYS run sync first — never skip:
python3 sync_gallery_data.py
git add . && git commit -m "..." && git push
# Cloudflare auto-deploys from main branch
```

The `.cfignore` controls what deploys. Only root HTML, css/, js/, images/, data/, functions/ deploy. 04_Website/ is IGNORED.

---

## Dashboard
Operator Command Center at: https://archive-35.com/agent-dashboard
Single HTML file: `agent-dashboard.html` (root of repo)

Tabs: Overview | Social | Email | Analytics | Broadcast | Learning | Links

All data pulled from API at localhost:8035. Dashboard is a static HTML page on Cloudflare that talks to the local agent.

---

## Automation Systems Built (March 18, 2026)

### Overnight Build (Phase 1) — ALL COMPLETE
1. **IndexNow** — Push URLs to Bing/ChatGPT/Copilot on every deploy
2. **Schema.org JSON-LD** — Structured data on all HTML pages
3. **Pinterest Pin Generator** — 52 branded pins + Tailwind CSV
4. **Reddit Content Generator** — 30 posts in queue, copy-paste workflow
5. **Sitemaps** — sitemap.xml (28 URLs) + sitemap-images.xml (166 images)
6. **Micro-Licensing Page** — micro-licensing.html with Stripe checkout
7. **Image Preparation Pipeline** — Multi-resolution generator
8. **Commerce MCP Server** — AI agents can search/buy images
9. **Etsy SEO Analyzer** — 31 listings analyzed, score 79.3/100
10. **Etsy Stats Monitor** — Weekly report generator
11. **Reddit Post Queue Dashboard** — Queue management UI
12. **Reddit Comment Monitor** — Keyword detection for purchase intent
13. **AI Broadcast Campaign** — Active push to search engines
14. **Operator Command Center** — Full dashboard overhaul
15. **State Recovery + Auto-Start** — Persistent agent states, LaunchAgent

### Email MCP (Phase 3)
- IMAP access to 3 accounts (wolf@archive-35.com, wolfbroadcast@gmail.com, wolfbroadcast@icloud.com)
- Daily briefing with phishing detection
- Credentials in `06_Automation/email_mcp/.env`

### Cloudflare Analytics (Phase 7)
- API Token: `CLOUDFLARE_API_TOKEN` in Agent .env
- archive-35.com Zone ID: `6c038d09db05960fd9e68491407bdea8`
- athos-obs.com Zone ID: `c4d910b00018793d3db58d3fb2e867ff`
- Endpoints: `/analytics/cloudflare` and `/analytics/athos`
- GraphQL API with 1-day limit on adaptive groups (top pages)

---

## Key Credentials Location
| Credential | File |
|-----------|------|
| Stripe keys | Root `.env` (lines 18-27) |
| Etsy OAuth | `Archive 35 Agent/.env` (lines 24-25, 57-60) |
| Instagram token | `Archive 35 Agent/.env` (lines 14-22), expires 2026-04-20 |
| Pinterest token | `Archive 35 Agent/.env` (lines 28-33), expires 2026-03-27 |
| Cloudflare R2 | Root `.env` (lines 77-86) |
| Cloudflare Analytics | `Archive 35 Agent/.env` (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID) |
| Email IMAP | `06_Automation/email_mcp/.env` |
| Resend (transactional email) | Root `.env` line 112 |
| Anthropic API | Root `.env` line 33 |
| Pictorem | Root `.env` lines 7-10 |

All .env files are gitignored. NEVER commit credentials.

---

## Active Threads (March 2026)
- Pinterest API: Trial access only (can read, cannot write pins). API approval pending.
- Reddit API: New app creation blocked (Responsible Builder Policy Nov 2025). Using copy-paste workflow.
- Indiewalls: Accepted but address validation bug. Follow-up email sent March 4, no reply.
- Etsy API: Approved for personal access. Token needs periodic refresh.
- Etsy token: May expire — auto-refresh writes to .env (needs .env mounted in Docker)
- Instagram: Development mode (only testers can post). Token valid until April 20.

---

## NEVER do this
- Deploy without running `sync_gallery_data.py` first
- Touch checkout, auth, email flows, or Google Sheet webhook without full test
- Change Stripe keys or webhook endpoints without Wolf
- Use port 3000 for Studio (job-pipeline owns 3000)
- Commit .env files or credentials to git
- Break the live Etsy store, website, or Stripe checkout

## Three-system rule
Any change to a shared file = test ALL THREE: Studio + Agent + Mockup

---

## Directory Structure
```
~/Documents/ACTIVE/archive-35/
  01_Portfolio/           # Raw image assets
  02_Social/              # Social media content + Pinterest pins
  03_Brand/               # Brand assets, voice guide
  04_Website/             # React frontend source
  05_Studio/              # Electron Studio app (port 3001)
  05_Business/            # Business docs
  06_Automation/          # MCP servers, scripts, email MCP
  07_C2PA/                # Content authenticity
  07_Extensions/          # Chrome extensions (CaFE uploader)
  08_Docs/                # Documentation, architecture, lessons learned
  09_Licensing/           # Watermarked images, thumbnails, micro-license versions
  Archive 35 Agent/       # Python FastAPI agent (Docker, port 8035)
    src/api.py            # Main API (5500+ lines, 100+ endpoints)
    src/routes/           # Reddit routes, variations, library
    src/agents/           # Reddit, Etsy SEO, email briefing agents
    src/integrations/     # Instagram, Etsy, Pinterest API clients
    src/notifications/    # Email notification system
    data/                 # SQLite DB, queues, state files, briefings
    docker-compose.yml    # 3 services: api, scheduler, telegram
  agent-dashboard.html    # Operator Command Center (single HTML file)
  CLAUDE.md               # THIS FILE
  PHASE-*.md              # Build specifications (Phases 1-8)
```

## Key Repos
- Website: github.com/wolfschram/archive-35.com
- MCP server: 06_Automation/archive35_mcp.py
- Commerce MCP: 06_Automation/archive35_commerce_mcp.py
