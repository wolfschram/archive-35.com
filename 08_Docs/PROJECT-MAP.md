# PROJECT-MAP.md — Archive-35 Full System Map
Generated: March 23, 2026

## What This Business Is
Fine art photography e-commerce. Brand: The Restless Eye. Owner: Wolf Schram.
Live at archive-35.com. 744 images, 40 galleries. Revenue via Stripe (prints) and x402 USDC (AI agent licensing).

---

## System 1: Website (archive-35.com)
- **Tech:** Static HTML/CSS/JS on Cloudflare Pages. Auto-deploys from git push to main.
- **Key pages:** index.html, gallery.html (205KB), licensing.html (62KB), micro-licensing.html (47KB), agent-dashboard.html (148KB)
- **Deploy rule:** ALWAYS run sync_gallery_data.py before git push
- **Status:** LIVE

## System 2: Cloudflare Functions (/functions)
- **Tech:** JavaScript, runs on Cloudflare Pages edge
- **Key endpoints:**
  - /api/create-checkout-session — Stripe checkout for prints
  - /api/micro-license/checkout — Stripe checkout for micro-licenses
  - /api/stripe-webhook — Fulfillment trigger → Pictorem + email
  - /api/license/{image_id} — x402 USDC payment for AI agents
  - /api/serve-original — Signed download URL handler (R2)
  - /api/commerce/* — AI agent search and catalog API
- **Dependencies:** Stripe, Pictorem, Cloudflare R2, Resend
- **Status:** CODE COMPLETE — env var verification needed

## System 3: Python Agent (Docker, port 8035)
- **Tech:** FastAPI + uvicorn, 3 Docker services (api, scheduler, telegram)
- **Location:** Archive 35 Agent/
- **Main file:** src/api.py (5500+ lines, 100+ endpoints)
- **Jobs:** Social posting, Etsy management, email briefing, analytics, content generation, Reddit queue, Pinterest pins
- **Dashboard:** agent-dashboard.html (operator command center)
- **Status:** RUNNING — Docker active

## System 4: Studio App (Electron, port 3001)
- **Tech:** Electron + React (react-scripts)
- **Location:** 05_Studio/app/
- **Jobs:** Photo management, catalog editing, upload pipeline, image preparation
- **Status:** WORKING on M3 Max MBP

## System 5: Mockup Service (Node.js, port 8036)
- **Tech:** Node.js
- **Location:** mockup-service/
- **Jobs:** Generate room mockup previews for hospitality/print sales
- **Status:** BUILT — active status unknown

## System 6: Commerce MCP Server
- **Tech:** Python
- **Location:** 06_Automation/archive35_commerce_mcp.py
- **Jobs:** Allows AI agents to search and purchase images via MCP protocol
- **Status:** BUILT — integration status unknown

## System 7: Email MCP (port unknown)
- **Tech:** Python
- **Location:** 06_Automation/email_mcp/
- **Jobs:** IMAP access to 3 email accounts, daily briefing, phishing detection
- **Status:** BUILT — active status unknown

---

## External Integrations
| Service | Purpose | Status |
|---|---|---|
| Stripe | Print + micro-license payments | ACTIVE |
| Pictorem | Print fulfillment | ACTIVE |
| Cloudflare R2 | High-res image storage | NEEDS VERIFICATION |
| Resend | Order confirmation emails | NEEDS VERIFICATION |
| Etsy | Marketplace listings | PARTIAL — token may expire |
| Instagram | Social posting | LIMITED — dev mode only |
| Pinterest | Pin creation | READ ONLY — trial access |
| Cloudflare Analytics | Traffic data | ACTIVE |
| x402/Coinbase | USDC crypto payments | BUILT, UNTESTED IN PROD |
