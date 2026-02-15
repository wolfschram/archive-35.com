# Archive-35 System Architecture
**Version 2.1** | Last Updated: 2026-02-11 | Living Document

> See also: [LESSONS_LEARNED.md](LESSONS_LEARNED.md) — "Do Not Replicate" knowledge base (mistakes, root causes, prevention rules)

---

## QUICK NAVIGATION
- [System Overview](#system-overview) - High-level component map
- [Data Flow Diagrams](#data-flow-diagrams) - How data moves through the system
- [File System Map](#file-system-map) - Where everything lives
- [Storage Architecture](#storage-architecture) - File types & locations
- [API & Services](#api--services) - External integrations
- [R2 Storage](#cloudflare-r2-storage-original-photos) - Original photo storage & fulfillment
- [MCP Server (Cloud)](#mcp-server-cloud---ai-agent-catalog-access) - Cloudflare Function for AI agents
- [MCP Server (Local)](#mcp-server-local---claude-desktop-integration) - Claude desktop integration
- [C2PA Content Credentials](#c2pa-content-credentials) - Provenance & authenticity
- [Commerce Protocol](#openai-agentic-commerce-protocol) - AI agent shopping endpoints
- [Electron Studio App](#electron-studio-app) - Mac-native desktop app
- [Deployment Pipeline](#deployment-pipeline) - Publishing to live site
- [Known Issues](#known-issues) - Current limitations & tech debt
- [Environment Variables](#environment-variables) - All required config
- [Key Decisions Log](#key-decisions-log) - Why we built it this way
- [Recent Changes (Feb 9-11)](#recent-changes-feb-9-11-2026) - Latest updates

---

## SYSTEM OVERVIEW

Archive-35 is a multi-layered photography portfolio and print fulfillment system. Components work independently but integrate through clearly-defined APIs and data formats.

### Component Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                      archive-35.com (Website)                        │
│   Cloudflare Pages (Static HTML/CSS/JS/Images + Serverless Functions)│
└────────────────────────────┬─────────────────────────────────────────┘
                             │
         ┌───────────┬───────┼───────┬──────────────┐
         │           │       │       │              │
    ┌────▼─────┐ ┌───▼────┐ ┌▼─────┐ ┌▼───────────┐ ┌▼──────────────┐
    │  Stripe  │ │Pictorem│ │Webhook│ │ MCP Server │ │   Commerce    │
    │ Payments │ │ Prints │ │(Order)│ │(AI Agents) │ │  Protocol     │
    └──────────┘ └────────┘ └──────┘ └────────────┘ │(ChatGPT Shop) │
         │           │         │          │          └───────────────┘
         └───────────┼─────────┼──────────┘
                     │         │
    ┌────────────────▼─────────▼──────────────────┐
    │   Cloudflare Functions (API)                │
    │  - create-checkout-session                  │
    │  - stripe-webhook (auto-fulfill)            │
    │  - serve-original (R2 images)               │
    │  - test-mode-status                         │
    │  - mcp (JSON-RPC 2.0 AI agent interface)    │
    │  - api/commerce/feed.json (product catalog) │
    │  - api/commerce/checkout_sessions (ACP)     │
    └──────────────────┬──────────────────────────┘
                       │
    ┌──────────────────▼──────────────────┐
    │  Cloudflare R2 Storage              │
    │  - High-res originals               │
    │  - HMAC-signed URL access           │
    └─────────────────────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │  Archive-35 Studio (Electron App)       │
    │  - Photo ingestion & organizing         │
    │  - C2PA Content Credentials signing     │
    │  - Portfolio metadata editor            │
    │  - R2 upload/delete (lifecycle mgmt)    │
    │  - Generate photos.json                 │
    │  - Deploy to GitHub                     │
    └────────────────────────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │   MCP Server Local (archive35_mcp.py)   │
    │   Claude Desktop Integration            │
    │  - File read/write/edit                 │
    │  - Git operations                       │
    │  - Portfolio automation                 │
    └────────────────────────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │  GitHub Repository                      │
    │  - Website source + images              │
    │  - Portfolio metadata                   │
    │  - Deployment history                   │
    └────────────────────────────────────────┘
```

### Running Environments

| Component | Platform | Status | Notes |
|-----------|----------|--------|-------|
| **Website** | Cloudflare Pages | Always on | CDN-served, zero-config |
| **Studio App** | macOS (Electron) | On demand | Runs on Mac when needed |
| **MCP Server (Cloud)** | Cloudflare Function | Always on | JSON-RPC 2.0 at `/mcp` — serves AI agents |
| **MCP Server (Local)** | macOS | Running locally | Integrated with Claude Desktop |
| **Commerce Protocol** | Cloudflare Function | Always on | ACP endpoints at `/api/commerce/` |
| **C2PA Signing** | Studio App (Python) | On ingest | Auto-signs new images during import |
| **Pictorem API** | Cloud | Always on | Print fulfillment partner |
| **Stripe** | Cloud | Always on | Payment processing |

---

## DATA FLOW DIAGRAMS

### 1. Photo Ingest & Publishing Pipeline

```
Camera (RAW)
    ↓
Lightroom (Organization + Editing)
    ↓
Studio App (Import + Portfolio Assignment)
    ↓
01_Portfolio/{Gallery}/originals/ (high-res masters, NOT on GitHub)
    ↓
Upload original to Cloudflare R2 (print fulfillment backup)
    ↓
Generate web-optimized full (2000px max, 85% JPEG quality)
    ↓
Sign web image with C2PA Content Credentials (provenance metadata)
    ↓
Generate thumbnail (400px max, 80% JPEG quality)
    ↓
Write _photos.json (per-collection metadata including c2pa: true/false)
    ↓
[Deploy button] → Aggregate all _photos.json → data/photos.json
    ↓
git push → Cloudflare Pages rebuild → Live on archive-35.com
    ↓
MCP Server + Commerce Protocol auto-discover new images
```

**Key Points:**
- Originals (8-35MB) stay on Mac, backed up to Cloudflare R2
- Web copies (300-800KB) go to GitHub for CDN distribution
- Thumbnails (30-75KB) indexed in photos.json for search/filtering
- photos.json is the master content index
- C2PA credentials embed provenance in every web image (author, copyright, location)
- MCP server and Commerce Protocol read data/photos.json dynamically — no manual sync needed

### 2. Purchase & Fulfillment Flow

```
Customer on Website
    ↓
Browse Gallery → Select Photo
    ↓
Product Selector (Choose Material + Size)
    ↓
Add to Cart (localStorage)
    ↓
Stripe Checkout Session
    ↓
Stripe Payment Processing
    ↓
✓ Payment Complete → stripe-webhook.js
    ↓
Pictorem API Validation
    ↓
Auto-submit Order to Pictorem
    ↓
Pictorem Fulfillment (Print + Ship)
    ↓
Customer Receives Product
```

**Key Points:**
- Cart persists in browser localStorage
- Stripe Checkout is hosted by Stripe (not custom)
- Webhook automatically submits to Pictorem
- No manual order processing required
- Material → Pictorem preordercode mapping defined in stripe-webhook.js

### 3. Deploy & Content Publish Flow

```
Studio App (on Mac)
    ↓
Read photos from 01_Portfolio/
    ↓
Generate/Update photos.json
    ↓
Copy web images to images/
    ↓
Git add + commit + push
    ↓
build.sh runs (Cloudflare Pages build command):
    ├─ sync_gallery_data.py → regenerates gallery.html inline data from photos.json
    ├─ cp *.html _site/     → copies freshly synced gallery.html + all pages
    ├─ cp -r css js images data logos _site/
    └─ cp robots.txt sitemap.xml llms.txt _site/
    ↓
Cloudflare Pages deploys _site/
    ↓
Cloudflare CDN cache invalidate (1-3 minutes)
    ↓
New photos live on archive-35.com
```

**CRITICAL (Lesson Learned 001):** `sync_gallery_data.py` MUST run before HTML copy.
gallery.html has inline `const G=[]` data that goes stale if not regenerated.
See `08_Docs/LESSONS_LEARNED.md` for full root cause analysis.

**Timing:**
- Typically 2-5 minutes from Studio push to live
- Manual trigger from Studio App UI
- Can also manually run git commands

### 4. Content Automation Pipeline (PLANNED)

```
Claude API Request
    ↓
MCP Server (archive35_mcp.py)
    ↓
Read Portfolio + Recent Photos
    ↓
Generate Social Media Captions + Hashtags
    ↓
Create Image Variants (1080x1350 for IG, etc)
    ↓
Write to 02_Social/Queue/
    ↓
Later.com / Buffer API (scheduled posting)
    ↓
Instagram + TikTok + LinkedIn + X/Twitter
```

**Status:** Captions can be generated manually via MCP; scheduling not yet built.

---

## FILE SYSTEM MAP

```
Archive-35.com/
│
├── 00_Inbox/
│   └── Staging area for new photos before portfolio assignment
│
├── 01_Portfolio/
│   ├── _master.json                    ← Master index (all galleries & metadata)
│   ├── _index.csv                      ← Photo index (for automation)
│   ├── Grand_Teton/
│   │   ├── originals/                  ← HIGH-RES MASTERS (8-35MB) — NOT on GitHub
│   │   ├── metadata.json               ← Gallery info (dates, location, tags)
│   │   └── photos/
│   │       ├── gt-001.json             ← Individual photo metadata
│   │       ├── gt-002.json
│   │       └── ...
│   ├── (Africa/ — REMOVED Feb 2026, was duplicate of Tanzania)
│   └── [Other galleries...]
│
├── 02_Social/
│   ├── Queue/                          ← Posts waiting to be scheduled
│   ├── Posted/                         ← Archive of published posts
│   ├── _schedule.csv                   ← Publishing calendar
│   └── templates/                      ← Caption & hashtag templates
│
├── 03_Brand/
│   ├── Brand_Guidelines.md
│   ├── Color_Palette.json
│   ├── Typography.md
│   └── Logo_Usage_Rules.md
│
├── 04_Website/
│   ├── src/
│   │   ├── index.html
│   │   ├── gallery.html
│   │   ├── about.md
│   │   ├── collections.md
│   │   └── ...
│   ├── dist/                           ← Published HTML/CSS (on GitHub)
│   ├── templates/                      ← Handlebars templates
│   └── [Content pages in Markdown]
│
├── 05_Business/
│   ├── Pricing_Strategy.md
│   ├── Sales_Goals.md
│   └── [Business docs — .env excluded]
│
├── 05_Studio/
│   ├── app/
│   │   ├── main.js                     ← Electron main process (IPC handlers)
│   │   ├── c2pa-sign.js                ← C2PA signing module (calls Python c2pa-python)
│   │   ├── preload.js                  ← IPC bridge (security)
│   │   └── package.json
│   ├── src/
│   │   ├── App.jsx                     ← React main component
│   │   ├── pages/
│   │   │   ├── ContentManagement.js    ← Photo grid, edit metadata, archive/delete
│   │   │   ├── SalesArtelo.js          ← Sales channels overview (Stripe, Pictorem, ChatGPT, MCP)
│   │   │   └── ...
│   │   ├── components/                 ← UI components
│   │   └── ...
│   ├── public/
│   │   └── index.html
│   └── [React app files]
│
├── 06_Automation/
│   ├── archive35_mcp.py                ← MCP Server (Claude integration)
│   ├── config.yaml                     ← Social media config
│   ├── scripts/
│   │   ├── submit_order.py             ← Manual order submission to Pictorem
│   │   ├── pictorem_api.py             ← Pictorem API client
│   │   ├── generate_photos_json.py     ← Build photos.json from portfolio
│   │   └── ...
│   └── requirements.txt
│
├── 07_Analytics/
│   ├── Google_Analytics_Config.md
│   └── [Analytics tracking setup]
│
├── 08_Docs/
│   ├── ARCHITECTURE.md                 ← THIS FILE
│   ├── DEPLOYMENT_GUIDE.md
│   ├── LOCAL_DEV_SETUP.md
│   ├── API_REFERENCE.md
│   └── [Other documentation]
│
├── 09_Backups/
│   └── [Periodic backups of critical data]
│
├── Photography/
│   └── [Raw archive of all photos shot by Wolf]
│
├── css/
│   ├── style.css                       ← Main stylesheet
│   ├── dark-theme.css
│   └── [Component stylesheets]
│
├── data/
│   └── photos.json                     ← MASTER PHOTO INDEX (generated by Studio)
│
├── 07_C2PA/
│   ├── chain.pem                       ← Certificate chain (signer + CA)
│   ├── ca.pem                          ← Self-signed Root CA certificate
│   ├── signer.pem                      ← End-entity signing certificate
│   ├── signer_pkcs8.key                ← Private key (NEVER committed — .gitignore)
│   └── sign_all.py                     ← Batch signing script for all images
│
├── functions/
│   ├── mcp.js                          ← MCP Server (JSON-RPC 2.0 for AI agents)
│   └── api/
│       ├── create-checkout-session.js  ← Create Stripe Checkout session
│       ├── serve-original.js           ← Serve high-res from R2 (HMAC signed)
│       ├── stripe-webhook.js           ← Auto-fulfill orders from Stripe
│       ├── test-mode-status.js         ← Backend test/live mode status
│       └── commerce/
│           ├── feed.json.js            ← ACP product feed (all variants)
│           ├── checkout_sessions.js    ← ACP checkout create/get
│           └── checkout_sessions/
│               └── [id]/
│                   ├── complete.js     ← ACP checkout complete
│                   └── cancel.js       ← ACP checkout cancel
│
├── images/
│   ├── (africa/ — REMOVED Feb 2026, was duplicate of Tanzania)
│   ├── grand-teton/
│   └── [Other collections...]
│
├── js/
│   ├── main.js                         ← Website entry point
│   ├── cart.js                         ← Shopping cart (localStorage)
│   ├── cart-ui.js                      ← Cart drawer UI
│   ├── product-selector.js             ← Print options UI
│   ├── schema-inject.js                ← Dynamic Schema.org JSON-LD for lightbox
│   ├── stripe-links.js                 ← Generated Stripe payment links
│   ├── test-mode-banner.js             ← Test mode visual indicator
│   └── lightbox.js                     ← Image viewer
│
├── logos/
│   ├── archive-35-primary.svg
│   ├── archive-35-mark.svg
│   └── [Logo variants]
│
├── _files_to_delete/
│   └── [Safe staging for files pending deletion]
│
├── .gitignore                          ← Git ignore rules (originals, large files)
├── .env                                ← API credentials (NEVER commit)
├── CNAME                               ← GitHub Pages domain (archive-35.com)
└── package.json                        ← Node.js dependencies (if any)
```

---

## STORAGE ARCHITECTURE

### Where Different File Types Live

| File Type | Location | Size | On GitHub? | On R2? | Availability |
|-----------|----------|------|-----------|--------|--------------|
| **Original Photos (RAW)** | `01_Portfolio/*/originals/` | 8-35MB each | ❌ NO | ✅ YES | R2 + Local Mac |
| **Print Masters (high-res JPEG)** | `01_Portfolio/*/originals/` | 8-35MB each | ❌ NO | ✅ YES | R2 + Local Mac |
| **Web-Optimized (full, C2PA signed)** | `images/{collection}/` | 300-800KB | ✅ YES | ❌ NO | CDN (Cloudflare) |
| **Web-Optimized (thumbnails)** | `images/{collection}/` | 30-75KB | ✅ YES | ❌ NO | CDN (Cloudflare) |
| **Portfolio Metadata (JSON)** | `01_Portfolio/{gallery}/` | <50KB | ✅ YES | ❌ NO | GitHub + CDN |
| **Photo Index** | `data/photos.json` | ~2-3MB | ✅ YES | ❌ NO | Fetched by website + MCP + ACP |
| **C2PA Certificates** | `07_C2PA/` | <10KB | ✅ YES (no key) | ❌ NO | Local only |
| **Social Queue** | `02_Social/Queue/` | <10MB | ✅ YES | ❌ NO | Manual check + publish |
| **Brand Assets** | `03_Brand/` | <50MB | ✅ YES | ❌ NO | Reference only |

### Why This Structure?

- **Originals stored locally + Cloudflare R2**: High-res files too large for GitHub, needed for printing. Cloud backup provides redundancy.
- **Web copies on GitHub**: CDN distribution, fast delivery, version control.
- **Metadata on GitHub**: JSON files track portfolio structure, enable search/filtering.
- **Social queue on GitHub**: Allows MCP server to schedule and audit posts.

---

## API & SERVICES

### Stripe (Payment Processing)

| Aspect | Details |
|--------|---------|
| **What It Does** | Processes customer purchases, handles payments, provides checkout UI |
| **How We Access It** | Stripe.js SDK (client-side) + Stripe API (server-side in Cloudflare Functions) |
| **Authentication** | `STRIPE_SECRET_KEY` + `STRIPE_TEST_SECRET_KEY` (server), `STRIPE_PUBLISHABLE_KEY` (client) |
| **Critical Functions** | `create-checkout-session.js` creates sessions; `stripe-webhook.js` listens for payment confirmation |
| **Status** | ✅ **WORKING** — Live payment processing active |
| **Related Files** | `/functions/api/create-checkout-session.js`, `/functions/api/stripe-webhook.js`, `/js/stripe-links.js` |

### Pictorem (Print Fulfillment)

| Aspect | Details |
|--------|---------|
| **What It Does** | Print-on-demand fulfillment (canvas, metal, acrylic, paper, wood) |
| **How We Access It** | REST API with artFlowKey authentication |
| **Authentication** | `PICTOREM_API_KEY` |
| **Critical Functions** | Validate product configs, submit orders, track status |
| **Status** | ✅ **WORKING** — Fulfilling orders in production |
| **Related Files** | `/06_Automation/scripts/pictorem_api.py`, `/06_Automation/scripts/submit_order.py` |

### Resend (Transactional Email)

| Aspect | Details |
|--------|---------|
| **What It Does** | Send branded order confirmation emails to customers and Wolf |
| **How We Access It** | REST API (resend.com) |
| **Authentication** | `RESEND_API_KEY` (Cloudflare environment variable) |
| **Email Provider** | Free tier: 100 emails/day (sufficient for art print business) |
| **Sender Address** | `orders@archive-35.com` (requires DNS verification in Resend dashboard) |
| **Critical Functions** | Customer confirmation emails, Wolf order notifications |
| **Status** | ✅ **WORKING** — Triggered by Stripe webhook |
| **Related Files** | `/functions/api/stripe-webhook.js` (contains email templates) |

**Email Flow (triggered by Stripe webhook):**

1. **Customer Confirmation** → Sent to customer email from Stripe session
   - Branded Archive-35 HTML template (black/gold theme)
   - Product thumbnail from `https://archive-35.com/images/{collection}/{filename}-full.jpg`
   - Order details: photo title, material, size, price
   - Timeline: production 5-7 days, shipping 5-9 days, ~3 weeks total
   - Order reference number (Stripe session ID)

2. **Wolf Notification** → Sent to `wolfbroadcast@gmail.com` (configurable via `WOLF_EMAIL` env var)
   - All customer details: name, email, shipping address
   - Order specifics: photo ID, material, size, Pictorem preorder code
   - Financial: customer paid amount, Pictorem wholesale cost, margin
   - Pictorem API response status
   - Product thumbnail

**Setup Requirements:**

1. Create Resend account at resend.com
2. Verify `archive-35.com` domain in Resend (add DNS records)
3. Get API key from Resend dashboard
4. Add `RESEND_API_KEY` to Cloudflare Pages environment variables
5. (Optional) Set `WOLF_EMAIL` env var (defaults to wolfbroadcast@gmail.com)

**Email Template Location:**
- Templates are inline in `functions/api/stripe-webhook.js`
- `buildCustomerEmail()` — customer-facing branded template
- `buildWolfNotificationEmail()` — Wolf's order notification

### Anthropic Claude API (Content Generation)

| Aspect | Details |
|--------|---------|
| **What It Does** | AI-powered caption generation, hashtag creation, social media content |
| **How We Access It** | REST API + MCP server integration |
| **Authentication** | `ANTHROPIC_API_KEY` |
| **Status** | ✅ **WORKING** — MCP server active, manual captions available |
| **Related Files** | `/06_Automation/archive35_mcp.py` |

### GitHub (Repository & Pages)

| Aspect | Details |
|--------|---------|
| **What It Does** | Version control, website hosting (GitHub Pages), deployment target |
| **How We Access It** | Git CLI + GitHub API (optional) |
| **Authentication** | `GITHUB_TOKEN` (optional, currently empty) |
| **Critical Workflows** | Studio → git push → GitHub Pages rebuild |
| **Status** | ✅ **WORKING** — Website auto-deployed on push |
| **Related Files** | `.gitignore` defines what's excluded |

### Cloudflare (CDN & Serverless)

| Aspect | Details |
|--------|---------|
| **What It Does** | CDN caching, serverless functions, DDoS protection |
| **How We Access It** | Functions deployed in `/functions/` directory |
| **Authentication** | Auto-managed by Cloudflare Pages integration |
| **Endpoints** | `/api/create-checkout-session`, `/api/stripe-webhook`, `/api/serve-original`, `/api/test-mode-status`, `/mcp`, `/api/commerce/feed.json`, `/api/commerce/checkout_sessions` |
| **Status** | ✅ **WORKING** — Handling payment flows, MCP, and commerce protocol |
| **Related Files** | `/functions/api/`, `/functions/mcp.js` |

### Cloudflare R2 (Original Photo Storage)

| Aspect | Details |
|--------|---------|
| **What It Does** | Store & serve original high-res photos for print fulfillment |
| **How We Access It** | R2 binding in Cloudflare Pages Functions, HMAC-signed URLs |
| **Authentication** | `ORIGINAL_SIGNING_SECRET` (HMAC signing), R2 bucket binding (`ORIGINALS`) |
| **Critical Functions** | Webhook generates signed URLs; serve-original.js serves images to Pictorem |
| **Status** | ✅ **WORKING** — R2 bucket bound, serve-original.js deployed |
| **Related Files** | `/functions/api/serve-original.js`, `/functions/api/stripe-webhook.js` |

### Meta/Instagram (Social Media - PLANNED)

| Aspect | Details |
|--------|---------|
| **What It Does** | Publish photos + captions to Instagram/Facebook |
| **How We Access It** | Meta Graph API |
| **Authentication** | `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN` |
| **Status** | 🟠 **PLANNED** — Config ready, posting not automated |
| **Related Files** | `/06_Automation/config.yaml` |

### TikTok (Social Media - PLANNED)

| Aspect | Details |
|--------|---------|
| **What It Does** | Publish short-form video content |
| **How We Access It** | TikTok Creator Marketplace API |
| **Authentication** | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN` |
| **Status** | 🟠 **PLANNED** — Config ready, not yet integrated |

### LinkedIn (Social Media - PLANNED)

| Aspect | Details |
|--------|---------|
| **What It Does** | Share portfolio & behind-the-scenes content |
| **How We Access It** | LinkedIn API |
| **Authentication** | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN` |
| **Status** | 🟠 **PLANNED** — Config ready, not yet integrated |

### X/Twitter (Social Media - PLANNED)

| Aspect | Details |
|--------|---------|
| **What It Does** | Share photography announcements & engagement |
| **How We Access It** | X/Twitter API v2 |
| **Authentication** | `X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` |
| **Status** | 🟠 **PLANNED** — Config ready, not yet integrated |

### Bluesky (Social Media - PLANNED)

| Aspect | Details |
|--------|---------|
| **What It Does** | Decentralized social network presence |
| **How We Access It** | Bluesky API (ATProto) |
| **Authentication** | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |
| **Status** | 🟠 **PLANNED** — Config ready, not yet integrated |

### Google Analytics 4

| Aspect | Details |
|--------|---------|
| **What It Does** | Track website traffic, user behavior, conversion funnel |
| **How We Access It** | Google Analytics 4 measurement ID: `G-SE2WETEK5D` |
| **Authentication** | GA4 Measurement ID embedded in all pages |
| **Privacy** | `anonymize_ip: true`, `allow_google_signals: false`, `allow_ad_personalization_signals: false` |
| **Status** | ✅ **LIVE** — Tracking active on all pages |
| **Related Files** | `js/analytics.js`, GA4 script tags in all HTML files |

### Email (Reporting - PLANNED)

| Aspect | Details |
|--------|---------|
| **What It Does** | Daily order summaries, analytics reports to Wolf |
| **How We Access It** | SMTP (Gmail) |
| **Authentication** | `SMTP_USER`, `SMTP_PASSWORD` (Gmail app password) |
| **Config** | `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587` |
| **Status** | 🟠 **PLANNED** — Infrastructure ready, automation not built |

---

## CLOUDFLARE R2 STORAGE (ORIGINAL PHOTOS)

### Architecture Overview

High-res original photos (8-35MB each) are stored in Cloudflare R2 for:
1. **Print fulfillment** — Pictorem needs originals for high-quality prints
2. **Cloud backup** — Redundancy beyond Mac local storage
3. **Secure access** — HMAC-signed URLs with 24-hour expiry prevent unauthorized access
4. **Performance** — Cloudflare's global network delivers images quickly to Pictorem

### R2 Bucket Configuration

| Property | Value |
|----------|-------|
| **Bucket Name** | `archive-35-originals` |
| **Binding Name** | `ORIGINALS` (in Cloudflare Pages) |
| **Access Method** | `serve-original.js` Cloudflare Function |
| **URL Signing** | HMAC-SHA256 with `ORIGINAL_SIGNING_SECRET` |
| **URL Expiry** | 24 hours |
| **File Structure** | `{collection}/{filename}.jpg` (e.g., `grand-teton/gt-001.jpg`) |

### Fulfillment Flow: Webhook → R2 → Pictorem

```
Step 1: Webhook Receives Order
┌────────────────────────────────┐
│ Stripe payment successful       │
│ webhook fires (async, secure)  │
└──────────────┬─────────────────┘
               │
Step 2: Generate Signed URL
┌──────────────▼──────────────────────┐
│ Webhook generates HMAC-signed URL   │
│ for original in R2 bucket           │
│ URL expires in 24 hours             │
└──────────────┬──────────────────────┘
               │
Step 3: Submit Order to Pictorem
┌──────────────▼──────────────────────┐
│ Call Pictorem API with:             │
│ - Signed R2 URL for high-res image │
│ - Product specifications            │
│ - Shipping address                  │
│ - Customer email                    │
└──────────────┬──────────────────────┘
               │
Step 4: Confirm Fulfillment
┌──────────────▼──────────────────────┐
│ Pictorem validates order            │
│ Begins print production              │
│ Send confirmation emails            │
└──────────────────────────────────────┘
```

### Security Model

- **No public access** — R2 bucket is private; only serve-original.js can read from it
- **Signed URLs** — HMAC-SHA256 signature includes key + expiry timestamp
- **Time-limited** — URLs expire after 24 hours
- **No caching** — `Cache-Control: private, no-store` prevents CDN caching of originals

### Related Files

| File | Purpose |
|------|---------|
| `functions/api/serve-original.js` | Verifies signature, streams original from R2 |
| `functions/api/stripe-webhook.js` | Generates signed URL, passes to Pictorem |

---

## MCP SERVER (CLOUD) — AI AGENT CATALOG ACCESS

### What is it?

A Cloudflare Pages Function at `/mcp` implementing the MCP (Model Context Protocol) over JSON-RPC 2.0 via HTTP. This lets any AI agent (Claude, ChatGPT, etc.) search and browse the Archive-35 product catalog programmatically.

### Endpoint

**URL:** `https://archive-35.com/mcp`
**Protocol:** JSON-RPC 2.0 over HTTP POST
**Data Source:** Fetches `/data/photos.json` dynamically on each request

### Available Tools

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `archive35_search_products` | `query` (string) | Matching photos with pricing | Search catalog by keyword |
| `archive35_get_product` | `product_id` (string) | Full product + 25 variants | Get single product details |
| `archive35_get_collection` | `collection_id` (string) | All photos in collection | Browse by collection |
| `archive35_get_catalog_summary` | — | Collection counts + stats | Overview of entire catalog |

### Available Resources

| URI | Description |
|-----|-------------|
| `archive35://catalog` | Full product catalog JSON |
| `archive35://policies` | Shipping, returns, pricing policies |
| `archive35://artist` | About Wolf / Archive-35 bio |

### How It Works

1. AI agent sends JSON-RPC 2.0 request to `/mcp`
2. Function reads `/data/photos.json` from the live site
3. Processes the request (search, filter, enrich with pricing)
4. Returns JSON-RPC 2.0 response with product data
5. Each product includes 25 variants (5 materials x 5 sizes) with pricing

### Testing

All 10 endpoint tests pass: initialize, tools/list, tools/call (search, get_product, get_collection), resources/list, resources/read (policies, artist), error handling.

**Related File:** `functions/mcp.js`

---

## MCP SERVER (LOCAL) — CLAUDE DESKTOP INTEGRATION

### What is MCP?

MCP (Model Context Protocol) allows Claude Desktop to interact directly with local files and systems on your Mac. Archive-35's local MCP server enables Claude to read code, generate content, and automate portfolio tasks.

### Current MCP Server: archive35_mcp.py

**Location:** `/06_Automation/archive35_mcp.py`

**Technologies:**
- Python 3
- FastMCP framework (Anthropic's MCP SDK)
- Subprocess (for git commands)

**Available Tools:**

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `archive35_read_file` | path, line_start, line_end | File content | Read portfolio files |
| `archive35_write_file` | path, content | Status | Create/update files |
| `archive35_edit_file` | path, old_text, new_text, replace_all | Status | Find & replace text |
| `archive35_search_code` | pattern, glob | Matching lines | Search codebase |
| `archive35_list_dir` | path, recursive | Directory listing | Browse folders |
| `archive35_git_status` | — | Git status | Check branch, dirty files |
| `archive35_git_diff` | — | Diff output | View uncommitted changes |
| `archive35_git_commit` | message, files, push | Commit hash | Stage, commit, optionally push |
| `archive35_run_command` | command, timeout | Output | Execute shell commands |
| `archive35_overview` | — | Project summary | Quick project status |

**Security Features:**
- Path validation (requests must be within repo root)
- Timeout on shell commands (30 seconds default)
- Read-only by default (write requires explicit Claude request)

### Planned MCP Servers

| Server | Purpose | Status |
|--------|---------|--------|
| `social-poster-mcp` | Schedule posts to Instagram, TikTok, LinkedIn, X | 🟠 PLANNED |
| `analytics-collector-mcp` | Fetch analytics from Google Analytics, social platforms | 🟠 PLANNED |
| `pictorem-sync-mcp` | Check order status, sync fulfillment updates | 🟠 PLANNED |
| `content-processor-mcp` | Batch generate captions, create image variants | 🟠 PLANNED |

---

## C2PA CONTENT CREDENTIALS

### What is C2PA?

C2PA (Coalition for Content Provenance and Authenticity) embeds cryptographic provenance metadata directly into image files. This proves authorship, copyright, and creation context — critical for AI-era content authenticity.

### Implementation

**Signing Library:** `c2pa-python` 0.28.0
**Algorithm:** ES256 (ECDSA P-256)
**Certificate Chain:** Self-signed Root CA → End-entity signing certificate

### Certificate Files (07_C2PA/)

| File | Purpose | In Git? |
|------|---------|---------|
| `chain.pem` | Full certificate chain (signer + CA) | Yes |
| `ca.pem` | Self-signed Root CA certificate | Yes |
| `signer.pem` | End-entity signing certificate | Yes |
| `signer_pkcs8.key` | ES256 private key (PKCS#8 format) | **NO** (.gitignore) |
| `sign_all.py` | Batch signing script for all images | Yes |

### What Gets Embedded

Each signed image contains:

- **stds.schema-org.CreativeWork** assertion:
  - Author: Wolf (Person, url: archive-35.com)
  - Copyright year and holder
  - Title, description, location
- **c2pa.actions** assertion:
  - Action: `c2pa.created`
  - Software agent: Canon EOS
- **Claim generator:** `Archive-35-Studio/1.0`

### Auto-Signing Pipeline

When new photos are ingested via Studio:

1. Studio creates web-optimized JPEG (2000px max, 85% quality)
2. `c2pa-sign.js` module calls Python `c2pa-python` via child_process
3. Image is signed in-place with C2PA manifest
4. `c2pa: true/false` flag stored in `_photos.json` metadata
5. Signing is non-blocking — if it fails, ingest continues without credentials

### Batch Signing

All 181 existing full-size images were batch-signed using `07_C2PA/sign_all.py` (covers 4 collections: Grand Teton, Iceland Ring Road, New Zealand, South Africa). Each image gained ~171KB of embedded credential data.

**Related Files:**
- `05_Studio/app/c2pa-sign.js` — Node.js signing utility (used during ingest)
- `07_C2PA/sign_all.py` — Python batch signing script
- `07_C2PA/chain.pem` — Certificate chain

---

## OPENAI AGENTIC COMMERCE PROTOCOL

### What is ACP?

The OpenAI Agentic Commerce Protocol (ACP) enables AI agents (like ChatGPT) to browse, search, and purchase products on behalf of users. Archive-35 implements ACP endpoints so our prints appear in ChatGPT Shopping and similar AI-powered marketplaces.

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/commerce/feed.json` | GET | Full product catalog with variants |
| `/api/commerce/checkout_sessions` | POST | Create a checkout session |
| `/api/commerce/checkout_sessions` | GET | Service info or session lookup |
| `/api/commerce/checkout_sessions/[id]/complete` | POST | Mark session complete |
| `/api/commerce/checkout_sessions/[id]/cancel` | POST | Cancel a session |

### Product Feed

- **Total products:** 3,801 (181 parent photos x ~21 variants each)
- **Variant format:** `{photo_id}_{material}_{width}x{height}` (e.g., `a-001_canvas_24x16`)
- **Materials:** Canvas, Metal, Acrylic, Fine Art Paper, Wood
- **Size range:** 12x8" to 60x40" (filtered by aspect ratio compatibility)
- **Price range:** $60 (smallest paper) to $750 (largest acrylic)

### Checkout Flow

1. AI agent creates checkout session with line items
2. System calculates subtotal, tax (8%), shipping (free US/CA)
3. Returns `checkout_url` pointing to Stripe Checkout
4. Agent can check status, complete, or cancel the session

### ChatGPT Shopping Registration

- **Merchant portal:** `chatgpt.com/merchants/`
- **Status:** Pending approval (application submitted)
- **Schema.org:** Store JSON-LD embedded in `index.html` for discovery

### Related Files

| File | Purpose |
|------|---------|
| `functions/api/commerce/feed.json.js` | Product feed generator |
| `functions/api/commerce/checkout_sessions.js` | Checkout create/get |
| `functions/api/commerce/checkout_sessions/[id]/complete.js` | Complete checkout |
| `functions/api/commerce/checkout_sessions/[id]/cancel.js` | Cancel checkout |
| `index.html` | Contains Store JSON-LD for discovery |
| `js/schema-inject.js` | Dynamic Product+VisualArtwork JSON-LD per photo |

---

## ELECTRON STUDIO APP

### Purpose
Desktop app for Wolf to manage the photography portfolio locally on Mac:
- Import photos from camera/Lightroom
- Organize into galleries
- Edit metadata (title, description, tags, location)
- Sign images with C2PA Content Credentials
- Upload originals to R2 for print fulfillment
- Generate photos.json
- Deploy to GitHub (publish live)

### Tech Stack
- **Framework:** Electron (Node.js + Chromium)
- **UI:** React (in development, see `/05_Studio/src/`)
- **IPC:** Electron ipcMain/ipcRenderer for secure communication
- **Entry Point:** `/05_Studio/app/main.js`
- **C2PA Signing:** `05_Studio/app/c2pa-sign.js` (calls Python c2pa-python)
- **R2 Client:** AWS SDK S3Client (PutObjectCommand, DeleteObjectCommand, HeadObjectCommand)

### Studio Pages (05_Studio/app/src/pages/)

| Page | File | Purpose |
|------|------|---------|
| Ingest | ContentIngest.js | Import photos from Lightroom |
| Manage | ContentManagement.js | Organize portfolios, metadata |
| Gallery | GalleryPreview.js | Preview gallery layout |
| Website | WebsiteControl.js | Deploy, service status |
| Licensing | LicensingManager.js | Run licensing pipeline |
| Sales | SalesPictorem.js | Pictorem integration |
| **Promos** | **PromoCodeManager.js** | **Stripe promo code CRUD** (added Feb 10) |
| **Sync** | **FolderSync.js** | **One-way folder sync Source → iCloud** (added Feb 11) |
| Social | SocialMedia.js | Placeholder |
| Analytics | Analytics.js | GA4 + Cloudflare + Stripe |
| Settings | Settings.js | Mode (test/live), API keys |

### Key IPC Handlers (main.js)

```javascript
// --- Core ---
ipcMain.handle('select-folder')      // Open folder dialog
ipcMain.handle('select-files')       // Open file dialog (images)
ipcMain.handle('get-env')            // Read environment variables
ipcMain.handle('get-base-path')      // Get Archive-35 repo root
ipcMain.handle('read-portfolio')     // Load portfolio structure
ipcMain.handle('write-metadata')     // Save gallery metadata
ipcMain.handle('finalize-ingest')    // Process photos: resize + R2 upload + C2PA sign
ipcMain.handle('deploy-website')     // Aggregate data, copy images, git push
ipcMain.handle('soft-delete-photos') // Move to _files_to_delete + R2 cleanup
ipcMain.handle('archive-photos')     // Move to _archived/
ipcMain.handle('git-status')         // Check git status
ipcMain.handle('git-push')           // Deploy to GitHub

// --- Stripe Promo Codes (added Feb 10) ---
ipcMain.handle('list-stripe-coupons')       // List Stripe coupons
ipcMain.handle('create-stripe-coupon')      // Create coupon (% or $ off)
ipcMain.handle('delete-stripe-coupon')      // Delete coupon
ipcMain.handle('list-stripe-promo-codes')   // List promotion codes
ipcMain.handle('create-stripe-promo-code')  // Create promo code for coupon
ipcMain.handle('deactivate-stripe-promo-code') // Deactivate promo code

// --- Folder Sync (added Feb 11) ---
ipcMain.handle('get-sync-config')    // Read .studio-sync-config.json
ipcMain.handle('save-sync-config')   // Write sync config
ipcMain.handle('run-folder-sync')    // One-way sync with progress events
```

### Workflow: Ingesting Photos

1. **Select folder** → `05_Studio/app` opens file dialog
2. **Choose gallery** → Select which portfolio folder (Grand Teton, Tanzania, etc.)
3. **Import images** → Copy originals to `01_Portfolio/{gallery}/originals/`
4. **Upload to R2** → High-res original backed up to Cloudflare R2
5. **Generate web images** → 2000px full + 400px thumbnail
6. **C2PA sign** → Embed content credentials in web-optimized image
7. **Edit metadata** → Title, description, tags, date, location
8. **Deploy** → Aggregate _photos.json → data/photos.json → git push
9. **Live on website** → Cloudflare Pages CDN (30 seconds)

### Workflow: Deleting Photos

1. **Select photos** → Check photos in Content Management grid
2. **Soft delete** → Confirm action
3. **Move files** → Originals moved to `_files_to_delete/`
4. **R2 cleanup** → DeleteObjectCommand removes from R2 bucket
5. **Update metadata** → Photo removed from _photos.json
6. **Deploy** → Updated photos.json pushed to live site

---

## DEPLOYMENT PIPELINE

### How Does a Photo Get on the Website?

```
Step 1: Import in Studio
┌─────────────────────────────┐
│ Select photos from Lightroom │
│ Assign to gallery folder    │
│ Edit metadata               │
└──────────────────┬──────────┘
                   │
Step 2: Generate photos.json
┌──────────────────▼──────────────┐
│ Studio reads 01_Portfolio/      │
│ Builds photos.json index        │
│ Copies to data/photos.json      │
└──────────────────┬──────────────┘
                   │
Step 3: Web Optimization + C2PA Signing
┌──────────────────▼──────────────┐
│ Studio generates web images     │
│ 300-800KB full size             │
│ C2PA Content Credentials signed │
│ 30-75KB thumbnails              │
│ Copies to images/{collection}/  │
└──────────────────┬──────────────┘
                   │
Step 4: Git Push
┌──────────────────▼──────────────────────┐
│ Stage changes (JSON + images)           │
│ git add data/photos.json images/...     │
│ git commit "Add Grand Teton photos"     │
│ git push origin main                    │
└──────────────────┬──────────────────────┘
                   │
Step 5: Cloudflare Pages Build (automatic)
┌──────────────────▼──────────────────────┐
│ Cloudflare detects push to main         │
│ Runs: bash build.sh                     │
│   ├─ sync_gallery_data.py (regen G=[])  │
│   ├─ cp *.html _site/                   │
│   ├─ cp -r css js images data logos     │
│   └─ cp robots.txt sitemap.xml llms.txt │
│ Deploys _site/ to Cloudflare CDN        │
└──────────────────┬──────────────────────┘
                   │
Step 6: Cloudflare CDN Propagation
┌──────────────────▼──────────────────────┐
│ CDN distributes new content globally    │
│ 1-3 minutes for full propagation        │
└──────────────────┬──────────────────────┘
                   │
Step 7: LIVE
┌──────────────────▼──────────────────────┐
│ Photos visible on archive-35.com        │
│ gallery.html has updated Cover Flow     │
│ All pages have latest data              │
└──────────────────────────────────────────┘
```

**Timing:**
- **Typical**: 2-5 minutes from Studio push to live
- **Fastest**: 30 seconds (Cloudflare propagation)
- **Manual**: Studio App has "Deploy" button (one click)

---

## INFRASTRUCTURE REGISTRY

### Domain & DNS Configuration

| Property | Value |
|----------|-------|
| **Primary Domain** | `archive-35.com` |
| **DNS Provider** | Cloudflare (Full DNS setup) |
| **Nameservers** | `etienne.ns.cloudflare.com`, `karsyn.ns.cloudflare.com` |
| **CDN** | Cloudflare (Proxied) |
| **Hosting** | Cloudflare Pages (was GitHub Pages, migrated) |
| **Pages Project** | `archive-35-com` |
| **Deploy Branch** | `main` |
| **SSL** | Cloudflare Universal SSL (auto-renewed) |

#### DNS Records (Cloudflare)

| Type | Name | Content | Proxy | Purpose |
|------|------|---------|-------|---------|
| CNAME | `archive-35.com` | `archive-35-com.pages.dev` | Proxied | Main site |
| CNAME | `www` | `wolfschram.github.io` | Proxied | www redirect |
| CNAME | `_domainconnect` | `_domainconnect.domains.s...` | Proxied | Domain connect |
| MX | `archive-35.com` | `aspmx.l.google.com` | DNS only | Google Workspace email (pri 1) |
| MX | `archive-35.com` | `alt1-4.aspmx.l.google.com` | DNS only | Google Workspace email (pri 5-10) |
| TXT | `archive-35.com` | `v=spf1 include:_spf.google...` | DNS only | Google SPF |
| TXT | `archive-35.com` | `*google-site-verification=...` | DNS only | Google verification |
| TXT | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` | DNS only | DMARC policy |
| **TXT** | **`resend._domainkey`** | **DKIM key (p=MIGfMA0...)** | DNS only | **Resend DKIM verification** |
| **MX** | **`send`** | **`feedback-smtp.us-east-1.amazonses.com`** (pri 10) | DNS only | **Resend SPF (MX)** |
| **TXT** | **`send`** | **`v=spf1 include:amazonses.com ~all`** | DNS only | **Resend SPF (TXT)** |
| NS | `archive-35.com` | `ns-cloud-d1-d4.googledomains.com` | DNS only | Google domain NS |

### Service Dashboards & Access

| Service | Dashboard URL | Login Method | Account |
|---------|-------------|--------------|---------|
| **Cloudflare** | `dash.cloudflare.com` | Email + password | wolfbroadcast@gmail.com |
| **Stripe** | `dashboard.stripe.com` | Email + password | wolfbroadcast@gmail.com |
| **Resend** | `resend.com` | GitHub OAuth | wolfbroadcast (GitHub) |
| **GitHub** | `github.com/wolfschram` | GitHub login | wolfschram |
| **Pictorem** | `pictorem.com` (PRO account) | Email + password | archive-35 username |
| **Google Domains** | `domains.google.com` | Google account | wolfbroadcast@gmail.com |
| **Google Cloud** | `console.cloud.google.com` | Google account | (planned - not yet created) |

### Credential Locations

| Credential | Stored In | How to Access |
|------------|-----------|---------------|
| `STRIPE_SECRET_KEY` (sk_live_...) | Cloudflare Pages env vars | Cloudflare → Pages → archive-35-com → Settings → Environment Variables |
| `STRIPE_PUBLISHABLE_KEY` (pk_live_...) | Hardcoded in HTML `<script>` tags | All HTML files: `window.STRIPE_PUBLIC_KEY = 'pk_live_51SxIaW...'` |
| `STRIPE_WEBHOOK_SECRET` (whsec_...) | Cloudflare Pages env vars | Cloudflare → Pages → Settings → Environment Variables |
| `PICTOREM_API_KEY` | Cloudflare Pages env vars | Default: "archive-35" |
| `RESEND_API_KEY` (re_...) | Cloudflare Pages env vars (pending) | Resend → API Keys → Create API key |
| `WOLF_EMAIL` | Cloudflare Pages env vars | Defaults to wolfbroadcast@gmail.com |
| `STRIPE_TEST_SECRET_KEY` (sk_test_...) | Cloudflare Pages env vars | Cloudflare → Pages → Settings → Environment Variables |
| `STRIPE_TEST_WEBHOOK_SECRET` (whsec_...) | Cloudflare Pages env vars | Cloudflare → Pages → Settings → Environment Variables |
| `ORIGINAL_SIGNING_SECRET` | Cloudflare Pages env vars | Cloudflare → Pages → Settings → Environment Variables |
| `ANTHROPIC_API_KEY` | Local `.env` on Mac | Mac: `~/Archive-35.com/.env` |
| `GITHUB_TOKEN` | Local `.env` on Mac (optional) | GitHub → Settings → Developer settings → Personal access tokens |

### Stripe Configuration

| Property | Value |
|----------|-------|
| **Account ID** | `acct_1SxIaWIyLqYsy9lv` |
| **Mode** | Live (production) |
| **Test Mode API Keys** | Available at `dashboard.stripe.com/test/apikeys` |
| **Live Publishable Key** | `pk_live_51SxIaWIyLqYsy9lv...` (in HTML) |
| **Webhook Endpoint** | `https://archive-35.com/api/stripe-webhook` |
| **Webhook Events** | `checkout.session.completed` |
| **Checkout Success URL** | `/thank-you.html?session_id={CHECKOUT_SESSION_ID}` |
| **Checkout Cancel URL** | `/gallery.html` |
| **Shipping Countries** | US, CA, GB, AU, DE, NZ, AT, CH, FR, IT, ES, NL, BE, IE, JP |
| **Branding** | Configured at `dashboard.stripe.com/.../settings/branding` |

### Resend Email Configuration

| Property | Value |
|----------|-------|
| **Domain** | `archive-35.com` |
| **Domain ID** | `eacc319c-0651-4ca4-ba8f-7299ac2d3929` |
| **Region** | North Virginia (us-east-1) |
| **Sender Address** | `orders@archive-35.com` |
| **DNS Status** | Pending verification (DNS records added to Cloudflare) |
| **Free Tier** | 100 emails/day, 3000/month |
| **API Key** | Pending creation (Resend → API Keys) |

### Pictorem Fulfillment API

| Property | Value |
|----------|-------|
| **API Base URL** | `https://www.pictorem.com/artflow/` |
| **Endpoints** | `validatepreorder`, `getprice`, `sendorder` |
| **Authentication** | `artFlowKey` parameter (env: `PICTOREM_API_KEY`) |
| **Username** | `archive-35` |
| **Currency** | USD |
| **Materials** | Canvas, Metal (al), Acrylic (ac220), Fine Art Paper (art), Wood (wood) |

---

## END-TO-END TESTING

### Stripe Test Mode

Stripe provides isolated test/live environments. Switch by using test API keys (`sk_test_...`, `pk_test_...`) instead of live keys.

**Dashboard:** `dashboard.stripe.com` → Toggle "View test data" in top nav

**Test Credit Cards:**

| Card Number | Result |
|-------------|--------|
| `4242 4242 4242 4242` | Success (Visa) |
| `5555 5555 5555 4444` | Success (Mastercard) |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 0127` | Incorrect CVC |

Use any future expiry date, any 3-digit CVC.

**Test Webhook Flow:**

1. Install Stripe CLI: `stripe login`
2. Forward events locally: `stripe listen --forward-to localhost:8788/api/stripe-webhook`
3. Use the CLI's webhook signing secret (`whsec_test_...`) in your local env
4. Make a test payment → webhook fires → fulfillment logic runs

### Pictorem Test Mode

Pictorem does **NOT** have a documented sandbox/test environment. Options:

1. **Mock API** (recommended): Set `PICTOREM_USE_MOCK=true` env var to return fake responses from `validatepreorder`, `getprice`, `sendorder` without placing real orders
2. **Contact Pictorem**: Ask about staging endpoints (may have undocumented test mode)
3. **Small test order**: Place a minimal real order (~$20) to verify full pipeline

### Recommended Test Architecture

```
STRIPE TEST MODE (sk_test_...)
    ↓ Test card: 4242 4242 4242 4242
    ↓
STRIPE WEBHOOK (test event)
    ↓
PICTOREM MOCK (PICTOREM_USE_MOCK=true)
    ↓ Returns fake order ID
    ↓
RESEND EMAIL (real — sends to Wolf's email)
    ↓
VERIFY: Customer email + Wolf notification received
```

This tests the entire chain without spending money or creating real print orders.

---

## KNOWN ISSUES

### Visual/UX Issues

| Issue | Impact | Workaround | Fix Priority |
|-------|--------|-----------|--------------|
| Stripe checkout all-white (no dark mode) | Jarring contrast in dark site | Use in daylight; update Stripe CSS | 🔴 HIGH |
| Product selector modal needs refine | Small text, cramped on mobile | Use desktop for purchases | 🟠 MEDIUM |
| Search filter slow with large datasets | User experience lag | Limit search to 50 items | 🟡 LOW |
| Gallery thumbnails sometimes unoptimized | Performance on 2G networks | Re-generate photos.json | 🟡 LOW |

### Data & Sync Issues

| Issue | Impact | Workaround | Fix Priority |
|-------|--------|-----------|--------------|
| ~~gallery.html inline data stale~~ | ~~Missing photos in Cover Flow~~ | ~~Manual regen~~ | ✅ **FIXED** (sync_gallery_data.py) |
| ~~Duplicate entries in photos.json~~ | ~~Wrong counts, wasted data~~ | ~~Manual cleanup~~ | ✅ **FIXED** (cleaned 82 dupes) |
| ~~Misspelled image folders~~ | ~~Silent duplicates~~ | ~~Manual move~~ | ✅ **FIXED** (moved to _files_to_delete) |
| Some originals not yet in R2 | R2 bucket partially populated | Upload remaining via wrangler CLI | 🟠 MEDIUM |
| No dedup check in ingest pipeline | Duplicate photos can accumulate | Manual review after ingest | 🟠 MEDIUM |
| Some portfolio folders have trailing underscores (Grand_Teton_) | Naming inconsistency in paths | Manually rename folders | 🟡 LOW |

### Automation Gaps

| Gap | Status | Plan |
|-----|--------|------|
| Social media posting (Instagram, TikTok, etc.) | Not automated | Build social-poster MCP server |
| Analytics collection | Not automated | Build analytics-collector MCP server |
| Order status tracking | Manual only | Integrate Pictorem sync API |
| Daily report emails | Not built | Add SMTP integration |
| Automatic image optimization | Manual | Add image pipeline to Studio |

---

## ENVIRONMENT VARIABLES

### Overview
All credentials, API keys, and config stored in `.env` (not committed to Git).

### Required Environment Variables

```yaml
# ===== PRINT FULFILLMENT (Pictorem) =====
PICTOREM_API_KEY=              # API key from Pictorem dashboard
PICTOREM_USERNAME=archive-35   # Pictorem account username
PICTOREM_API_URL=https://www.pictorem.com/artflow/  # Base API URL
PICTOREM_CURRENCY=USD          # Pricing currency

# ===== PAYMENTS (Stripe) =====
STRIPE_SECRET_KEY=             # Live secret key (sk_live_...)
STRIPE_PUBLISHABLE_KEY=        # Live publishable key (pk_live_...)
STRIPE_WEBHOOK_SECRET=         # Webhook signing secret
STRIPE_TEST_SECRET_KEY=        # Test mode secret key (sk_test_...)
STRIPE_TEST_WEBHOOK_SECRET=    # Test mode webhook signing secret

# ===== EMAIL (Resend - Transactional) =====
RESEND_API_KEY=                # Resend API key for order confirmation emails
WOLF_EMAIL=wolfbroadcast@gmail.com  # Where to send order notifications (optional)

# ===== STORAGE (Cloudflare R2) =====
ORIGINAL_SIGNING_SECRET=       # HMAC secret for R2 signed URLs

# ===== AI SERVICES (Claude) =====
ANTHROPIC_API_KEY=             # Anthropic API key for MCP server

# ===== VERSION CONTROL (GitHub) =====
GITHUB_TOKEN=                  # GitHub personal access token (optional)

# ===== SOCIAL MEDIA (Meta/Instagram) =====
META_APP_ID=                   # Meta App ID
META_APP_SECRET=               # Meta App Secret
META_ACCESS_TOKEN=             # Facebook/Instagram access token

# ===== SOCIAL MEDIA (TikTok) =====
TIKTOK_CLIENT_KEY=             # TikTok API key
TIKTOK_CLIENT_SECRET=          # TikTok API secret
TIKTOK_ACCESS_TOKEN=           # TikTok access token

# ===== SOCIAL MEDIA (LinkedIn) =====
LINKEDIN_CLIENT_ID=            # LinkedIn App ID
LINKEDIN_CLIENT_SECRET=        # LinkedIn App Secret
LINKEDIN_ACCESS_TOKEN=         # LinkedIn access token

# ===== SOCIAL MEDIA (X/Twitter) =====
X_API_KEY=                     # X API key (v2)
X_API_SECRET=                  # X API secret
X_BEARER_TOKEN=                # X Bearer token
X_ACCESS_TOKEN=                # X OAuth token
X_ACCESS_TOKEN_SECRET=         # X OAuth token secret

# ===== SOCIAL MEDIA (Bluesky) =====
BLUESKY_HANDLE=                # Bluesky handle (e.g., @archive35.bsky.social)
BLUESKY_APP_PASSWORD=          # Bluesky app password

# ===== ANALYTICS =====
GOOGLE_ANALYTICS_ID=           # Google Analytics 4 measurement ID

# ===== EMAIL (Reporting) =====
SMTP_HOST=smtp.gmail.com       # Gmail SMTP server
SMTP_PORT=587                  # TLS port
SMTP_USER=wolfbroadcast@gmail.com  # Gmail address
SMTP_PASSWORD=                 # Gmail app password (not regular password)
REPORT_EMAIL=wolfbroadcast@gmail.com  # Where to send daily reports
```

### Where Each Component Uses Env Vars

| Component | Env Vars Used |
|-----------|---------------|
| **Stripe Checkout** | `STRIPE_PUBLISHABLE_KEY` (frontend), `STRIPE_SECRET_KEY` (Cloudflare function) |
| **Stripe Webhook** | `STRIPE_SECRET_KEY`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_TEST_WEBHOOK_SECRET`, `PICTOREM_API_KEY`, `RESEND_API_KEY`, `WOLF_EMAIL`, `ORIGINAL_SIGNING_SECRET` |
| **Original Image Serving** | `ORIGINAL_SIGNING_SECRET`, `ORIGINALS` (R2 binding) |
| **Test Mode Status** | `STRIPE_SECRET_KEY`, `STRIPE_TEST_SECRET_KEY` |
| **Pictorem Fulfillment** | `PICTOREM_API_KEY`, `PICTOREM_USERNAME` |
| **MCP Server** | `ANTHROPIC_API_KEY` |
| **Studio App** | Reads via Electron IPC (e.g., `ipcMain.handle('get-env')`) |
| **Social Media Posting** | All `META_*`, `TIKTOK_*`, `LINKEDIN_*`, `X_*`, `BLUESKY_*` |
| **Email Reports** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `REPORT_EMAIL` |
| **Analytics** | `GOOGLE_ANALYTICS_ID` |

### How to Update Env Vars

1. **Local Mac:** Edit `/Archive-35.com/.env` (never commit)
2. **Cloudflare Pages:** Set in Cloudflare dashboard → Settings → Environment Variables
3. **GitHub Secrets:** Set in GitHub → Settings → Secrets (for CI/CD, if any)
4. **Never commit:** `.env` is in `.gitignore` for safety

---

## KEY DECISIONS LOG

### Why Cloudflare Pages (Migrated from GitHub Pages)?

**Decision:** Migrated to Cloudflare Pages for website hosting.

**Reasons:**
- Serverless Functions built-in (no separate infrastructure for API endpoints)
- R2 storage integration (native bindings for original photo serving)
- Single platform for hosting + CDN + functions + storage
- Faster global deployment (Cloudflare's edge network)
- Free tier generous (unlimited bandwidth, 500 builds/month)
- GitHub integration preserved (auto-deploy on push to main)

**Tradeoff:** Vendor consolidation on Cloudflare. GitHub repo remains portable if needed.

### Why Pictorem for Print Fulfillment (Not Printful, Redbubble, etc.)?

**Decision:** Use Pictorem for all print-on-demand fulfillment.

**Reasons:**
- Superior quality (hand-inspected prints)
- Wide material selection (canvas, metal, acrylic, paper, wood)
- Better pricing at scale (volume discounts)
- Well-documented API for automation
- Faster turnaround (2-3 days vs. 5-7 days competitors)
- Direct support from founder (Wolfgang's network)

**Tradeoff:** Requires manual webhook integration. Handles 100% of current volume.

### Why Stripe for Payments (Not PayPal, Square, etc.)?

**Decision:** Use Stripe for all payment processing.

**Reasons:**
- Industry standard (widest customer trust)
- Excellent API documentation
- Hosted checkout experience (PCI compliance handled)
- Built-in webhook support (real-time order notifications)
- Dashboard provides transaction audit trail
- Integrates seamlessly with Cloudflare Functions
- Supports global payments + multi-currency (future)

**Tradeoff:** 2.9% + $0.30 per transaction. Worth it for reliability.

### Why Static Site (No Backend Server)?

**Decision:** Archive-35 is a static site (no Express/Node backend).

**Reasons:**
- **Simplicity:** No server to manage, patch, or monitor
- **Scalability:** CDN handles traffic spikes naturally
- **Cost:** GitHub Pages + Cloudflare Functions are essentially free
- **Reliability:** 99.99% uptime (leverages GitHub/Cloudflare infrastructure)
- **Security:** Smaller attack surface (no authentication, session management)
- **Content:** Photos don't change in real-time; JSON generation is offline

**Backend Functions:** Only Cloudflare Functions handle Stripe webhooks (serverless, not a traditional server).

**Future:** If inventory or user accounts needed, can add Node backend then.

### Why Cloudflare R2 for Original Storage (Not Google Drive)?

**Decision:** Use Cloudflare R2 instead of initially planned Google Drive.

**Reasons:**
- Native integration with Cloudflare Pages Functions (R2 bindings)
- No authentication complexity (Service Account, OAuth, etc.)
- HMAC-signed URLs provide secure, time-limited access
- Same platform as hosting = simpler architecture
- No API rate limits or quota concerns
- Cost-effective (free tier: 10GB storage, 10M reads/month)

**Tradeoff:** No built-in versioning like Google Drive. Can be added via R2 lifecycle policies if needed.

**Status:** ✅ Implemented. serve-original.js deployed, R2 bucket bound.

### Why MCP Server Over Traditional Backend API?

**Decision:** Use MCP (Model Context Protocol) for automation instead of building REST API.

**Reasons:**
- **Claude Integration:** Works directly with Claude Desktop (Wolf's existing workflow)
- **Local-First:** Runs on Mac, no need for cloud server
- **Files-as-API:** Treats filesystem as database (Git already version controls it)
- **No Auth:** File system permissions = access control
- **Simple:** ~300 lines of Python vs. 2000+ lines of Node backend code
- **Future-Proof:** Anthropic investing in MCP as standard protocol

**Tradeoff:** Only Claude (via MCP) can trigger automation (not random HTTP clients). That's intentional.

### Why C2PA Content Credentials (Not Watermarking)?

**Decision:** Embed C2PA provenance metadata in every web-optimized image.

**Reasons:**
- **Industry standard:** C2PA is backed by Adobe, Microsoft, Google, BBC — becoming the default
- **Invisible:** No visual watermarks that degrade the artwork
- **Cryptographic proof:** Digitally signed — can't be faked or stripped without detection
- **AI-ready:** AI agents and platforms increasingly check C2PA for authenticity
- **Future-proof:** As AI-generated content proliferates, provenance becomes essential for trust

**Implementation:** ES256 (ECDSA P-256) signing via `c2pa-python` 0.28.0. Self-signed CA chain (07_C2PA/). Auto-signs during Studio ingest.

**Tradeoff:** ~171KB overhead per image. Negligible for web delivery. Private key must be protected.

### Why OpenAI Agentic Commerce Protocol?

**Decision:** Implement ACP endpoints so AI agents can browse and purchase prints.

**Reasons:**
- **New sales channel:** ChatGPT Shopping puts products in front of millions of users
- **Zero marginal cost:** Serverless endpoints on existing Cloudflare infrastructure
- **Standard protocol:** ACP is becoming the default for AI-to-merchant transactions
- **Composable:** Same product data serves website, MCP, and ACP — no duplication
- **Early mover:** Most fine art photographers haven't adopted AI commerce yet

**Implementation:** Cloudflare Functions at `/api/commerce/`. Product feed auto-generates from `data/photos.json`. Checkout sessions integrate with existing Stripe flow.

**Tradeoff:** Pending ChatGPT merchant approval. Protocol is still evolving.

### Why React in Studio (Not Vue, Svelte, etc.)?

**Decision:** Use React for Electron desktop app UI.

**Reasons:**
- **Ecosystem:** Largest library selection, most Stack Overflow answers
- **Electron Friendly:** Best-documented React + Electron combo
- **Team Knowledge:** Wolf has React experience
- **Components:** Reusable UI components for complex portfolio management
- **Dev Tools:** React DevTools integrates with Electron

**Tradeoff:** More boilerplate than Vue. Worth it for ecosystem support.

---

## GETTING HELP

If you're lost:

1. **System overview?** Start with [SYSTEM OVERVIEW](#system-overview)
2. **Data flow?** Read [DATA FLOW DIAGRAMS](#data-flow-diagrams)
3. **Which file does what?** Check [FILE SYSTEM MAP](#file-system-map)
4. **API not working?** See [API & SERVICES](#api--services)
5. **Deployment broken?** Read [DEPLOYMENT PIPELINE](#deployment-pipeline)
6. **Need to add something?** Check [KNOWN ISSUES](#known-issues)

**For Claude (via MCP):**
```python
# Read this doc
archive35_read_file(path='08_Docs/ARCHITECTURE.md')

# See all available tools
archive35_overview()

# Search for something specific
archive35_search_code(pattern='Stripe', glob='*.js')
```

---

## APPENDIX: Common Tasks

### Task: Add a New Photo to the Website

1. Import in Studio: Select photo → Assign to gallery
2. Edit metadata: Title, description, tags, date, location
3. Studio generates photos.json + web images
4. Studio deploys: `git push`
5. Done! (Live in 30 seconds)

### Task: Process a Customer Order

**Automatic (webhook):**
- Customer pays → Stripe webhook fires → Pictorem receives order automatically ✅

**Manual fallback (if webhook fails):**
```bash
cd /path/to/Archive-35.com/06_Automation/scripts
python submit_order.py --order PI_xxx
```

### Task: Generate Social Media Captions (with Claude)

```python
# Via MCP in Claude Desktop
archive35_read_file(path='data/photos.json')
# Claude analyzes photo metadata and generates caption
```

### Task: Update Stripe Pricing

1. Edit pricing in `/js/product-selector.js`
2. Regenerate Stripe payment links (currently manual)
3. Update `/js/stripe-links.js` with new URLs
4. Deploy to GitHub

---

---

## RECENT CHANGES (Feb 9-11, 2026)

### Build Pipeline Automation (Feb 11)
- **`sync_gallery_data.py`** — Regenerates gallery.html inline `const G=[]` from photos.json
- **`build.sh` updated** — Calls sync script before HTML copy (prevents stale gallery data)
- Root cause: gallery.html inline data was never regenerated after photo ingest (Lesson 001)

### Data Cleanup (Feb 11)
- Removed 67 duplicate iceland-ring-road entries from photos.json (identical to iceland)
- Removed 15 duplicate Grand Teton entries
- Moved 7 misspelled/duplicate image folders to `_files_to_delete/misspelled_dupes/`
- photos.json: 479 → 397 entries (27 collections)

### Folder Sync Feature (Feb 11)
- **FolderSync.js** — New Studio page for one-way Source → iCloud sync
- Recursive directory walk, mtime+size change detection, optional orphan deletion
- Config persisted in `.studio-sync-config.json`
- 4 new IPC handlers + progress events via `sync-progress` channel

### Enterprise Promo Code System (Feb 10)
- **PromoCodeManager.js** — Studio page for Stripe promo code CRUD
- 6 new IPC handlers for coupon + promo code lifecycle
- Presets: 10%, 15%, 20%, 25%, 50%, 100% off + $50, $100, $250 off
- Metadata: client_name, client_email, notes, tier

### 4-Layer Metadata Validation (Feb 10)
- cart.js → cart-ui.js → create-checkout-session.js → stripe-webhook.js
- Each layer validates and falls back independently
- Prevents Pictorem fulfillment failures from missing metadata

### Launch Pricing (Feb 10)
- 30% margin reduction across all print sizes and materials
- Applied to product-selector.js pricing tables

### Gallery Fixes (Feb 9-11)
- Cover Flow: larger cards, better positioning, full-res images
- Lightbox: z-index 9999, opaque background, no bleed-through
- Mobile: reduced swipe sensitivity, proper card sizing at 768px/420px breakpoints
- closeLb() + closeFg(): orphaned modal cleanup to prevent click-blocking

### Stripe Tax (Feb 10)
- Stripe Tax activated for automatic tax calculation on checkout

### Documentation (Feb 11)
- **LESSONS_LEARNED.md** — "Do Not Replicate" knowledge base (15 lessons)
- ARCHITECTURE.md updated to v2.1
- CLAUDE.md updated with all recent changes

---

**Document Status:** ✅ Complete — All components documented. Updated as system evolves.

**Last Reviewed:** 2026-02-11

**Next Review:** 2026-03-11 (monthly)
