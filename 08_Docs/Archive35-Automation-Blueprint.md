# Archive 35 — Full Automation Blueprint
## Zero Human Interference Architecture
### What Claude Code Builds. What Runs on Autopilot. What Wolf Never Touches.
### March 17, 2026

---

## THE PRINCIPLE

Nothing is manual. Every content post, every listing optimization, every AI agent ping, every Pinterest pin — automated or it doesn't exist. Wolf's time goes to shooting photos and making strategic decisions. Everything else is a machine.

---

## AUTOMATION 1: AI AGENT DISCOVERY BROADCASTER

### Problem
The x402 gallery and licensing system are built but invisible. Zero agent requests. AI search engines haven't discovered archive-35.com yet.

### Solution: Active Broadcasting (Not Passive Waiting)

**What Claude Code Builds:**

1. **Bing IndexNow Integration**
   - Bing powers ChatGPT search, Copilot, DuckDuckGo, Ecosia
   - Build a script that pings IndexNow every time content changes on archive-35.com
   - Submit ALL pages: index, gallery, licensing, hospitality, about, every collection page
   - Location: `06_Automation/scripts/indexnow_ping.py`
   - Runs automatically on every `git push` via GitHub Action

2. **Google Search Console Submission**
   - Submit sitemap.xml to Google Search Console
   - Use Google Indexing API to request crawl of key pages
   - Location: `06_Automation/scripts/google_index.py`

3. **MCP Server Registration**
   - Build an Archive 35 MCP server that registers in the official MCP Registry
   - Publish `/.well-known/mcp/server.json` on archive-35.com
   - The MCP server exposes: search images, get licensing info, get pricing, browse collections
   - When any AI assistant (Claude, ChatGPT, Copilot) installs it, they can search and recommend Archive 35 images directly
   - This is the "fishing" — we put the bait in every AI assistant's tool registry
   - Location: `06_Automation/archive35_commerce_mcp.py`

4. **Schema.org Structured Data**
   - Add JSON-LD structured data to every page on archive-35.com
   - ImageObject schema for every photo with: name, description, contentUrl, license, creator, copyrightHolder, dateCreated, locationCreated
   - Product schema for every print listing
   - Organization schema for Archive 35
   - This makes Google, Bing, and AI crawlers understand the content semantically
   - Location: Inject into HTML `<head>` of each page

5. **Perplexity Submission**
   - Perplexity crawls independently from Bing
   - Submit key pages via Perplexity's webmaster tools (if available) or ensure PerplexityBot is crawling via Cloudflare analytics

**Automation Trigger:** GitHub Action on every push + weekly scheduled re-ping

**Wolf Does:** Nothing. This runs on deploy.

---

## AUTOMATION 2: REDDIT CONTENT ENGINE

### Problem
Reddit API ToS restricts automated posting from bots. Reddit's spam detection catches new accounts posting with automated patterns.

### Solution: Semi-Automated Content Pipeline

**What Claude Code Builds:**

1. **Reddit Content Generator Agent**
   - Reads portfolio data (photos.json, licensing-catalog.json)
   - Uses the brand voice guide to generate authentic posts
   - Outputs a queue of ready-to-post content as structured JSON:
     ```json
     {
       "subreddit": "r/EarthPorn",
       "title": "Vestrahorn reflected in tidal pools at Stokksnes, Iceland [OC] [7907x3154]",
       "body": "...",
       "image_path": "01_Portfolio/Iceland/web/WOLF_vestrahorn.jpg",
       "scheduled_date": "2026-03-18",
       "status": "queued"
     }
     ```
   - Location: `Archive 35 Agent/src/agents/reddit_agent.py`
   - Generates 30 posts/month automatically

2. **Reddit Post Queue Dashboard**
   - Shows queued posts with preview
   - One-click "Post Now" button that uses PRAW to submit
   - Wolf clicks ONE button. That's it. No writing, no formatting, no subreddit research
   - The agent handles: subreddit rules compliance, title formatting, image selection, scheduling
   - Location: Add to existing agent-dashboard.html

3. **Reddit Comment Monitor**
   - Watches for comments on Archive 35 posts (via PRAW streaming)
   - Alerts Wolf via email when someone asks "do you sell prints?"
   - Optionally: drafts a reply in Wolf's voice for one-click send
   - Location: `Archive 35 Agent/src/agents/reddit_monitor.py`

**Why not fully automated:** Reddit bans automated self-promotional posting. The one human touch (clicking "Post Now") keeps it legal and authentic. But Wolf spends 30 seconds per post, not 30 minutes.

**Wolf Does:** Clicks "Post" once per day. 30 seconds.

---

## AUTOMATION 3: PINTEREST TRAFFIC ENGINE

### Problem
No Pinterest API access. Pinterest is the #1 long-term traffic source for visual products.

### Solution: Tailwind + Automated Content Generation

**What Claude Code Builds:**

1. **Pinterest Pin Generator**
   - Takes every image in the portfolio
   - Creates vertical pin images (1000x1500px, 2:3 ratio) with:
     - Photo as background
     - Text overlay: title + "archive-35.com"
     - Archive 35 branding bar at bottom
   - Generates SEO pin descriptions with keywords
   - Outputs to `02_Social/pinterest/pins/` directory
   - Location: `Archive 35 Agent/src/agents/pinterest_agent.py`

2. **Pin Content CSV for Bulk Upload**
   - Generates a CSV file compatible with Tailwind's bulk upload format:
     ```csv
     image_url,title,description,link,board
     /path/to/pin.jpg,"Grand Teton Panorama","Fine art landscape...","https://etsy.com/listing/xxx","Landscape Photography"
     ```
   - Wolf uploads the CSV to Tailwind ONCE per month
   - Tailwind auto-schedules 5-10 pins/day for the month
   - Location: `02_Social/pinterest/tailwind_upload.csv`

3. **Board Strategy Auto-Setup**
   - Creates Pinterest board names and descriptions optimized for search:
     - "Landscape Photography Prints | Fine Art Wall Decor"
     - "Iceland Photography | Nature Wall Art"
     - "African Wildlife Prints | Safari Decor"
     - "National Park Photography | Mountain Art"
     - "Modern Wall Art | Office & Home Decor"

**Tailwind Free Tier:** 5 pins/month free, $15/month for unlimited. Worth it once first sale comes in.

**Alternative if no Tailwind:** Pinterest native scheduler allows 100 pins queued. Claude Code generates the pins, Wolf bulk-uploads via Pinterest web UI once/month.

**Wolf Does:** Uploads one CSV per month OR bulk-uploads pin images. 15 minutes/month.

---

## AUTOMATION 4: ETSY LISTING OPTIMIZER

### Problem
87+ listings need continuous SEO optimization based on Etsy search trends and competitor analysis.

### Solution: Automated Analysis + Push via Existing Etsy Agent

**What Claude Code Builds:**

1. **Etsy SEO Analyzer**
   - Scrapes top-performing competitor listings weekly
   - Compares your titles, tags, and descriptions against winners
   - Identifies keyword gaps and optimization opportunities
   - Outputs a prioritized change list
   - Location: `Archive 35 Agent/src/agents/etsy_seo_agent.py`

2. **Auto-Optimize Pipeline**
   - Takes the SEO analysis output
   - Rewrites titles to front-load highest-converting keywords
   - Adjusts tags to maximize search coverage
   - Adds C2PA/authenticity differentiator to descriptions
   - Pushes changes via the existing `etsy_agent.py` infrastructure
   - Runs weekly on schedule

3. **Etsy Stats Monitor**
   - Tracks views, favorites, and conversion rates per listing
   - Identifies which listings are getting traffic but not converting (description problem)
   - Identifies which listings are not getting traffic (SEO problem)
   - Emails Wolf a weekly 3-line summary: "Top performers, underperformers, changes made"

**Wolf Does:** Reads a weekly email. Zero action required.

---

## AUTOMATION 5: MICRO-LICENSING STOREFRONT

### Problem
The $280+ licensing tier misses the high-volume $1-$25 market. No automated delivery for digital downloads.

### Solution: Self-Service Micro-License Store

**What Claude Code Builds:**

1. **Micro-License Gallery Page**
   - New page: archive-35.com/micro-licensing
   - Grid of thumbnails with instant pricing
   - Filter by: subject, mood, location, orientation, resolution tier
   - Location: `micro-licensing.html` at repo root

2. **Stripe Checkout for Digital Downloads**
   - Buyer clicks "License" → Stripe Checkout opens
   - Payment succeeds → webhook fires → signed download URL generated
   - Buyer gets email with download link (72-hour expiry)
   - No human involvement in the entire transaction
   - Uses existing Stripe integration (wolfbroadcast@gmail.com)
   - Location: `functions/api/micro-license/` (Cloudflare Functions)

3. **Image Preparation Pipeline**
   - Script that takes any image from the archive and generates:
     - Thumbnail version (1200x630)
     - Web Standard version (2400x1600)
     - Web Premium version (4000x2667)
     - Watermarked preview
     - C2PA credentials applied to all versions
   - Location: `06_Automation/scripts/prepare_micro_license.py`

4. **AI Agent Purchase API**
   - REST endpoint: `GET /api/micro-license/search?subject=landscape&mood=dramatic`
   - Returns available images with thumbnails, pricing, and purchase URLs
   - AI agents can browse, select, and purchase programmatically
   - Integrates with x402 agent tracking
   - Location: `functions/api/micro-license/search.js`

**Wolf Does:** Nothing after initial catalog selection. Sales happen on autopilot.

---

## AUTOMATION 6: AI AGENT COMMERCE MCP SERVER

### Problem
AI assistants (Claude, ChatGPT, etc.) can't currently search or purchase Archive 35 images from within their interfaces.

### Solution: Publishable MCP Server

**What Claude Code Builds:**

1. **Archive 35 Commerce MCP Server**
   - Tools exposed:
     - `search_images(query, mood, location, orientation)` → returns matching images with thumbnails
     - `get_image_details(image_id)` → returns full metadata, pricing, licensing options
     - `get_licensing_options(image_id)` → returns all tiers with pricing
     - `purchase_license(image_id, tier)` → returns Stripe checkout URL
     - `browse_collections()` → returns all collections with sample images
   - Registers at `/.well-known/mcp/server.json`
   - Submit to MCP Registry (github.com/modelcontextprotocol/registry)
   - Location: `06_Automation/archive35_commerce_mcp.py`

2. **Why This Matters**
   - When someone asks Claude or ChatGPT "where can I find authentic landscape photography for my hotel lobby?" — your MCP server means the AI can search your catalog, show thumbnails, and provide a purchase link
   - You become one of the first photographers with an AI-native storefront
   - Every AI assistant that installs the MCP becomes a sales channel

**Wolf Does:** Nothing. The MCP server runs as a Cloudflare Worker.

---

## CLAUDE CODE TASK LIST

These are the specific tasks to hand to Claude Code, in priority order:

### PRIORITY 1 — This Week

| # | Task | Estimated Time | Dependency |
|---|---|---|---|
| T1 | Build IndexNow integration + GitHub Action for auto-ping on deploy | 1-2 hours | None |
| T2 | Add Schema.org JSON-LD structured data to all HTML pages | 2-3 hours | None |
| T3 | Build Pinterest Pin Generator (vertical images + text overlay + CSV output) | 3-4 hours | Pillow/PIL |
| T4 | Build Reddit Content Generator (reads portfolio, outputs queue JSON) | 2-3 hours | None |
| T5 | Submit sitemap to Bing Webmaster Tools + Google Search Console | 1 hour | Wolf's Google/Microsoft accounts |

### PRIORITY 2 — Next Week

| # | Task | Estimated Time | Dependency |
|---|---|---|---|
| T6 | Build micro-licensing page (archive-35.com/micro-licensing) | 4-6 hours | Stripe webhook |
| T7 | Build Stripe checkout for digital download delivery | 3-4 hours | T6 |
| T8 | Build image preparation pipeline (resize + watermark + C2PA) | 3-4 hours | None |
| T9 | Build Archive 35 Commerce MCP Server | 4-6 hours | T6, T7 |
| T10 | Build Etsy SEO Analyzer agent | 3-4 hours | None |

### PRIORITY 3 — Month 1

| # | Task | Estimated Time | Dependency |
|---|---|---|---|
| T11 | Submit MCP Server to MCP Registry | 1 hour | T9 |
| T12 | Build Reddit Post Queue dashboard (one-click posting) | 2-3 hours | T4 |
| T13 | Build Reddit Comment Monitor with email alerts | 2-3 hours | T4 |
| T14 | Build Etsy Stats Monitor with weekly email | 2-3 hours | T10 |
| T15 | Build AI Agent Purchase API endpoint | 3-4 hours | T6, T7 |

---

## WOLF'S TOTAL TIME COMMITMENT (After Automation Built)

| Activity | Frequency | Time |
|---|---|---|
| Click "Post" on Reddit queue | Daily | 30 seconds |
| Upload Pinterest CSV to Tailwind | Monthly | 15 minutes |
| Read weekly Etsy performance email | Weekly | 2 minutes |
| Select new images for micro-licensing catalog | Monthly | 1 hour |
| Review and approve Etsy SEO changes | Weekly | 5 minutes |
| **TOTAL** | | **~2 hours/month** |

Everything else runs without human interference.

---

## REVENUE PROJECTIONS (With Full Automation)

| Month | Etsy Prints | Micro-Licenses | AI Agent Sales | Licensing | Total |
|---|---|---|---|---|---|
| 1 | $300-$600 | $50-$150 | $0 | $0 | $350-$750 |
| 2 | $600-$1,200 | $200-$500 | $50-$200 | $280-$350 | $1,130-$2,250 |
| 3 | $1,000-$2,000 | $500-$1,000 | $200-$500 | $560-$1,050 | $2,260-$4,550 |
| 6 | $2,000-$4,000 | $1,000-$2,500 | $500-$1,500 | $1,400-$3,500 | $4,900-$11,500 |
| 12 | $3,000-$6,000 | $2,000-$4,000 | $1,000-$3,000 | $2,800-$7,000 | $8,800-$20,000 |

**Break-even on $5,000 target: Month 3-4 with full automation running.**

---

## WHAT TO BUILD FIRST (TODAY)

If Claude Code is available right now, start with:

1. **T1: IndexNow integration** — fastest path to AI agent discovery
2. **T2: Schema.org structured data** — makes every page machine-readable
3. **T3: Pinterest Pin Generator** — highest ROI traffic source

These three tasks can run in parallel. No dependencies between them.

---

*Architecture document — March 17, 2026. Designed for zero-human-interference operation. Claude Code builds the machines. The machines run the business.*
