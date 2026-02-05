# Archive-35 Documentation

## Overview
Archive-35 is a fine art photography business selling prints via archive-35.com.

**Owner:** Wolfgang Schram
**Email:** wolfbroadcast@gmail.com
**Domain:** archive-35.com
**Tagline:** "Light. Place. Time."

## System Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Portfolio | 01_Portfolio/ | Photography storage and metadata |
| Social | 02_Social/ | Social media content and scheduling |
| Brand | 03_Brand/ | Brand assets, hashtags, voice |
| Website | 04_Website/ | Static site deployed to GitHub Pages |
| Studio App | 05_Studio/ | Archive-35 Studio desktop application |
| Automation | 06_Automation/ | MCP servers, scripts, cron jobs |
| Analytics | 07_Analytics/ | Metrics, reports, tracking |
| Docs | 08_Docs/ | This folder - all documentation |
| Backups | 09_Backups/ | Automated backups |

## Quick Links

- **Website:** https://archive-35.com
- **GitHub Repo:** https://github.com/wolfschram/archive-35.com
- **GitHub Pages:** Settings → Pages
- **Squarespace DNS:** https://account.squarespace.com/domains/managed/archive-35.com/dns/dns-settings

## Key Files

- `.env` — API keys (root folder, gitignored)
- `01_Portfolio/_master.json` — All galleries index
- `02_Social/_queue.json` — Scheduled posts
- `_CLAUDE/SYSTEM_PROMPT.md` — Claude Desktop instructions

## Documentation Index

### Credentials (08_Docs/credentials/)
Login details for all services. KEEP SECURE.

### Setup Guides (08_Docs/setup/)
How to configure each service from scratch.

### Procedures (08_Docs/procedures/)
Step-by-step instructions for common tasks.

---
Last updated: 2026-02-03
