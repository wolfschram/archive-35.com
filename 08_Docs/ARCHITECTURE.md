# Archive-35 System Architecture
**Version 1.0** | Last Updated: 2026-02-07 | Living Document

---

## QUICK NAVIGATION
- [System Overview](#system-overview) - High-level component map
- [Data Flow Diagrams](#data-flow-diagrams) - How data moves through the system
- [File System Map](#file-system-map) - Where everything lives
- [Storage Architecture](#storage-architecture) - File types & locations
- [API & Services](#api--services) - External integrations
- [Google Drive Integration](#google-drive-integration-original-storage) - Original photo storage & fulfillment
- [MCP Server Architecture](#mcp-server-architecture) - Claude desktop integration
- [Electron Studio App](#electron-studio-app) - Mac-native desktop app
- [Deployment Pipeline](#deployment-pipeline) - Publishing to live site
- [Known Issues](#known-issues) - Current limitations & tech debt
- [Environment Variables](#environment-variables) - All required config
- [Key Decisions Log](#key-decisions-log) - Why we built it this way

---

## SYSTEM OVERVIEW

Archive-35 is a multi-layered photography portfolio and print fulfillment system. Components work independently but integrate through clearly-defined APIs and data formats.

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    archive-35.com (Website)                 │
│  GitHub Pages + Cloudflare CDN (Static HTML/CSS/JS/Images) │
└──────────────────────┬──────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼─────┐  ┌────▼─────┐  ┌───▼──────┐
    │  Stripe  │  │ Pictorem │  │  Webhook │
    │Payments  │  │  Prints  │  │(Fulfillm)│
    └──────────┘  └──────────┘  └──────────┘
         │             │             │
         └─────────────┼─────────────┘
                       │
    ┌──────────────────▼──────────────────┐
    │   Cloudflare Functions (API)        │
    │  - create-checkout-session          │
    │  - stripe-webhook (auto-fulfill)    │
    └──────────────────────────────────────┘
         │
    ┌────▼────────────────────────────────┐
    │  Archive-35 Studio (Electron App)   │
    │  - Photo ingestion & organizing     │
    │  - Portfolio metadata editor        │
    │  - Generate photos.json             │
    │  - Deploy to GitHub                 │
    └────────────────────────────────────┘
         │
    ┌────▼────────────────────────────────┐
    │   MCP Server (archive35_mcp.py)     │
    │   Claude Desktop Integration        │
    │  - File read/write/edit             │
    │  - Git operations                   │
    │  - Portfolio automation             │
    └────────────────────────────────────┘
         │
    ┌────▼────────────────────────────────┐
    │  GitHub Repository                  │
    │  - Website source + images          │
    │  - Portfolio metadata               │
    │  - Deployment history               │
    └────────────────────────────────────┘
```

### Running Environments

| Component | Platform | Status | Notes |
|-----------|----------|--------|-------|
| **Website** | GitHub Pages + Cloudflare | Always on | CDN-served, zero-config |
| **Studio App** | macOS (Electron) | On demand | Runs on Mac when needed |
| **MCP Server** | macOS | Running locally | Integrated with Claude Desktop |
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
Generate photos.json + web-optimized images
    ↓
images/{collection}/ (on GitHub, CDN-served)
    ↓
archive-35.com (displayed on website)
```

**Key Points:**
- Originals (8-35MB) stay on Mac, synced to Google Drive (planned)
- Web copies (300-800KB) go to GitHub for CDN distribution
- Thumbnails (30-75KB) indexed in photos.json for search/filtering
- photos.json is the master content index

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
GitHub Pages rebuild
    ↓
Cloudflare cache invalidate
    ↓
New photos live on archive-35.com (30s delay)
```

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
│   ├── Africa/
│   │   ├── originals/
│   │   ├── metadata.json
│   │   └── photos/
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
│   │   ├── preload.js                  ← IPC bridge (security)
│   │   └── package.json
│   ├── src/
│   │   ├── App.jsx                     ← React main component
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
├── functions/
│   └── api/
│       ├── stripe-webhook.js           ← Auto-fulfill orders from Stripe
│       └── create-checkout-session.js  ← Create Stripe Checkout session
│
├── images/
│   ├── africa/
│   │   ├── a-001-full.jpg              ← Web-optimized (300-800KB)
│   │   ├── a-001-thumb.jpg             ← Thumbnail (30-75KB)
│   │   └── ...
│   ├── grand-teton/
│   └── [Other collections...]
│
├── js/
│   ├── main.js                         ← Website entry point
│   ├── cart.js                         ← Shopping cart (localStorage)
│   ├── product-selector.js             ← Print options UI
│   ├── stripe-links.js                 ← Generated Stripe payment links
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

| File Type | Location | Size | On GitHub? | On Google Drive? | Availability |
|-----------|----------|------|-----------|-----------------|--------------|
| **Original Photos (RAW)** | `01_Portfolio/*/originals/` | 8-35MB each | ❌ NO | ✅ PLANNED | Local Mac only |
| **Print Masters (high-res JPEG)** | `01_Portfolio/*/originals/` | 8-35MB each | ❌ NO | ✅ PLANNED | Local Mac only |
| **Web-Optimized (full)** | `images/{collection}/` | 300-800KB | ✅ YES | ❌ NO | CDN (Cloudflare) |
| **Web-Optimized (thumbnails)** | `images/{collection}/` | 30-75KB | ✅ YES | ❌ NO | CDN (Cloudflare) |
| **Portfolio Metadata (JSON)** | `01_Portfolio/{gallery}/` | <50KB | ✅ YES | ❌ NO | GitHub + CDN |
| **Photo Index** | `data/photos.json` | ~2-3MB | ✅ YES | ❌ NO | Fetched by website |
| **Social Queue** | `02_Social/Queue/` | <10MB | ✅ YES | ❌ NO | Manual check + publish |
| **Brand Assets** | `03_Brand/` | <50MB | ✅ YES | ❌ NO | Reference only |

### Why This Structure?

- **Originals stored locally + Google Drive**: High-res files too large for GitHub, needed for printing. Cloud backup provides redundancy.
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
| **Authentication** | `STRIPE_SECRET_KEY` (server), `STRIPE_PUBLISHABLE_KEY` (client) |
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
| **Endpoints** | `/api/create-checkout-session`, `/api/stripe-webhook` |
| **Status** | ✅ **WORKING** — Handling payment flows |
| **Related Files** | `/functions/api/` |

### Google Drive (Cloud Storage - Original Photo Storage)

| Aspect | Details |
|--------|---------|
| **What It Does** | Store & serve original high-res photos for print fulfillment |
| **How We Access It** | Google Drive API (Service Account) |
| **Authentication** | `GOOGLE_DRIVE_CREDENTIALS` (Service Account JSON), `GOOGLE_DRIVE_FOLDER_ID` |
| **Critical Functions** | Studio uploads originals after processing; Webhook retrieves for Pictorem |
| **Status** | 🟡 **IN PROGRESS** — Architecture defined, implementation starting |
| **Related Files** | `/05_Studio/` (upload integration), `/functions/api/stripe-webhook.js` (retrieval) |

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

### Google Analytics (Analytics - FUTURE)

| Aspect | Details |
|--------|---------|
| **What It Does** | Track website traffic, user behavior, conversion funnel |
| **How We Access It** | Google Analytics 4 measurement ID |
| **Authentication** | `GOOGLE_ANALYTICS_ID` |
| **Status** | 🟠 **PLANNED** — Tracking not yet embedded in website |

### Email (Reporting - PLANNED)

| Aspect | Details |
|--------|---------|
| **What It Does** | Daily order summaries, analytics reports to Wolf |
| **How We Access It** | SMTP (Gmail) |
| **Authentication** | `SMTP_USER`, `SMTP_PASSWORD` (Gmail app password) |
| **Config** | `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587` |
| **Status** | 🟠 **PLANNED** — Infrastructure ready, automation not built |

---

## GOOGLE DRIVE INTEGRATION (ORIGINAL STORAGE)

### Architecture Overview

High-res original photos (8-35MB each) are stored on Google Drive for:
1. **Cloud backup** — Redundancy beyond Mac local storage
2. **Fulfillment access** — Pictorem needs originals for high-quality prints
3. **Remote access** — Wolf can access originals from anywhere
4. **Versioning** — Google Drive provides automatic version history

### Implementation Strategy: Service Account vs OAuth

| Approach | Use Case | Setup |
|----------|----------|-------|
| **Service Account** (chosen) | Server-to-server automation | Simpler, no user interaction needed |
| **OAuth** | User permission flow | More complex, requires user approval |

**Why Service Account?**
- Studio (Electron app) uploads originals after processing — no user interaction needed
- Webhook retrieves files to pass to Pictorem — no user context required
- Credentials stored in environment variables (Cloudflare + local .env)
- Wolf shares Drive folder with Service Account email — full access granted once

### Google Drive Folder Structure

```
Archive-35 (Shared Folder)
└── originals/
    ├── grand-teton/
    │   ├── gt-001.jpg          (8-35MB original)
    │   ├── gt-002.jpg
    │   └── ...
    ├── africa/
    │   ├── a-001.jpg
    │   ├── a-002.jpg
    │   └── ...
    ├── new-zealand/
    │   ├── nz-001.jpg
    │   └── ...
    └── [other collections...]
```

**Storage Calculation:**
- Grand Teton originals: ~250MB
- Africa originals: ~180MB
- New Zealand originals: ~77MB
- **Total:** ~507MB (well within 1TB available)

---

### Upload Flow: Studio → Google Drive

**Trigger:** When Studio imports and processes a new photo

```
Step 1: Photo Import
┌─────────────────────────────┐
│ User selects photos in      │
│ Studio (from Lightroom)     │
│ Assigns to gallery          │
└──────────────┬──────────────┘
               │
Step 2: Processing
┌──────────────▼──────────────────────┐
│ Studio reads original (RAW/JPG)     │
│ Extracts EXIF metadata              │
│ Generates AI metadata (tags, etc.)  │
└──────────────┬──────────────────────┘
               │
Step 3: Web Optimization
┌──────────────▼────────────────────────┐
│ Generate web copies:                 │
│ - Full size (300-800KB)              │
│ - Thumbnail (30-75KB)                │
│ Store in images/{collection}/        │
└──────────────┬────────────────────────┘
               │
Step 4: Upload Original to Google Drive
┌──────────────▼─────────────────────────────┐
│ Authenticate with Service Account          │
│ Upload original to Google Drive            │
│ Path: originals/{collection}/{filename}    │
│ Retrieve Google Drive file ID              │
└──────────────┬─────────────────────────────┘
               │
Step 5: Store Metadata
┌──────────────▼──────────────────────┐
│ Update _photos.json with:           │
│ - google_drive_file_id              │
│ - google_drive_download_link        │
│ - original_size, dimensions, etc.   │
└──────────────┬──────────────────────┘
               │
Step 6: Git Push
┌──────────────▼──────────────────────┐
│ git add data/photos.json            │
│ git add images/{collection}/*       │
│ git commit + push                   │
└──────────────────────────────────────┘
```

**Implementation Details (Studio):**

```javascript
// pseudo-code for Studio upload handler
const { google } = require('googleapis');

async function uploadOriginalToGoogleDrive(filePath, collection, filename) {
  // Load Service Account credentials
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_DRIVE_KEY_FILE,  // or inline GOOGLE_DRIVE_CREDENTIALS
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  const drive = google.drive({ version: 'v3', auth });

  // Create file metadata
  const fileMetadata = {
    name: `${filename}`,
    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    // Organize in subfolders: originals/{collection}/
    webViewLink: true  // Return shareable link
  };

  // Upload file
  const media = {
    mimeType: 'image/jpeg',
    body: fs.createReadStream(filePath)
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, webViewLink, size'
  });

  return {
    fileId: response.data.id,
    downloadLink: `https://drive.google.com/uc?export=download&id=${response.data.id}`,
    size: response.data.size
  };
}
```

---

### Fulfillment Flow: Webhook → Google Drive → Pictorem

**Trigger:** Stripe webhook fires on successful payment

```
Step 1: Webhook Receives Order
┌────────────────────────────────┐
│ Stripe payment successful       │
│ webhook fires (async, secure)  │
└──────────────┬─────────────────┘
               │
Step 2: Lookup Photo Metadata
┌──────────────▼──────────────────────┐
│ Read data/photos.json               │
│ Find photo by ID from order         │
│ Extract google_drive_file_id        │
└──────────────┬──────────────────────┘
               │
Step 3: Get Download Link from Google Drive
┌──────────────▼────────────────────────────┐
│ Authenticate with Service Account         │
│ Retrieve file metadata (size, link)       │
│ Generate temporary download link          │
│ (Or use Cloudflare Worker for proxying)   │
└──────────────┬────────────────────────────┘
               │
Step 4: Submit Order to Pictorem
┌──────────────▼──────────────────────┐
│ Call Pictorem API with:             │
│ - High-res image URL (Google Drive) │
│ - Product specifications            │
│ - Shipping address                  │
│ - Customer email                    │
└──────────────┬──────────────────────┘
               │
Step 5: Confirm Fulfillment
┌──────────────▼──────────────────────┐
│ Pictorem validates order            │
│ Begins print production              │
│ Send confirmation email to customer │
└──────────────────────────────────────┘
```

**Implementation Details (Webhook):**

```javascript
// pseudo-code for stripe-webhook.js enhancement
const { google } = require('googleapis');

async function fulfillOrder(stripeSessionId) {
  // 1. Get order details from Stripe session
  const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
  const photoId = session.metadata.photo_id;
  const quantity = session.metadata.quantity;

  // 2. Look up original from photos.json
  const photosData = require('../data/photos.json');
  const photo = findPhotoById(photosData, photoId);
  const googleDriveFileId = photo.google_drive_file_id;

  // 3. Get download link from Google Drive
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_DRIVE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  const drive = google.drive({ version: 'v3', auth });
  const downloadLink = `https://drive.google.com/uc?export=download&id=${googleDriveFileId}`;

  // 4. Submit to Pictorem with high-res image URL
  const pictorem = new PictoremAPI(process.env.PICTOREM_API_KEY);
  const orderResult = await pictorem.submitOrder({
    imageUrl: downloadLink,
    material: session.metadata.material,
    size: session.metadata.size,
    customerEmail: session.customer_email,
    shippingAddress: session.shipping_details
  });

  // 5. Send confirmation emails
  await sendCustomerEmail(session.customer_email, photo.title, orderResult);
  await sendWolfNotification(photo.title, orderResult);
}
```

**Alternative: Cloudflare Worker Proxy (More Reliable)**

Instead of passing raw Google Drive links to Pictorem, use a Cloudflare Worker as a proxy:

```javascript
// Cloudflare Worker: proxy-google-drive.js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('id');

    // Authenticate to Google Drive and stream the file
    // Pictorem receives: https://archive-35.com/api/google-drive-proxy?id=FILE_ID
    // Worker handles auth transparently
  }
};
```

**Advantage:** Pictorem never sees credentials, and we have audit logs of all fulfillment requests.

---

### Setup Requirements

#### 1. Google Cloud Project Setup

```bash
# Create Google Cloud project (or use existing)
# Enable Google Drive API:
# - Go to console.cloud.google.com
# - Search "Google Drive API"
# - Click "Enable"

# Create Service Account:
# - Go to "Service Accounts" in Google Cloud Console
# - Create new service account
# - Name: "Archive-35-Studio"
# - Grant role: "Editor" (or custom role with Drive access)
# - Create JSON key and download

# Copy key file to safe location (e.g., ~/Archive-35/.env.google-drive.json)
```

#### 2. Google Drive Setup

```bash
# Create folder structure:
# 1. Create "Archive-35" folder in Wolf's Google Drive
# 2. Create "originals" subfolder inside Archive-35
# 3. Share Archive-35 folder with Service Account email:
#    - Right-click folder → Share
#    - Add: [service-account-email]@iam.gserviceaccount.com
#    - Role: Editor
#    - Click Share

# Get folder ID from URL:
# https://drive.google.com/drive/folders/[FOLDER_ID]
```

#### 3. Environment Variables

Store in `.env` (Mac local) and Cloudflare environment variables:

```yaml
# ===== GOOGLE DRIVE (Original Photo Storage) =====
GOOGLE_DRIVE_CREDENTIALS={"type":"service_account","project_id":"..."}  # Full JSON in one line
GOOGLE_DRIVE_FOLDER_ID=1aBcDeFgHiJkLmNoPqRsTuVwXyZ123456  # Archive-35/originals folder ID
```

**For Cloudflare Functions:**
1. Go to Cloudflare Pages dashboard
2. Project Settings → Environment Variables
3. Add `GOOGLE_DRIVE_CREDENTIALS` and `GOOGLE_DRIVE_FOLDER_ID`

#### 4. Studio App Dependencies

Add to `/05_Studio/package.json`:

```json
{
  "dependencies": {
    "googleapis": "^118.0.0",
    "google-auth-library": "^9.0.0"
  }
}
```

Install:
```bash
cd /05_Studio
npm install googleapis google-auth-library
```

---

### Migration Plan (Existing Photos)

#### Phase 1: Setup (Week 1)
- [ ] Create Google Cloud project + Service Account
- [ ] Create Google Drive folder structure
- [ ] Share with Service Account email
- [ ] Store credentials in .env files

#### Phase 2: Upload Existing Originals (Week 2)
- [ ] Create upload script: `06_Automation/scripts/upload_originals_to_gdrive.py`
- [ ] Batch upload existing originals:
  - Grand Teton: 250MB
  - Africa: 180MB
  - New Zealand: 77MB
- [ ] Update `_photos.json` with Google Drive file IDs
- [ ] Verify all files uploaded successfully

#### Phase 3: Studio Integration (Week 3)
- [ ] Add Google Drive upload handler to Studio main.js
- [ ] On import → generate originals → upload to Drive
- [ ] Capture google_drive_file_id in photos.json
- [ ] Test with 5-10 new photos

#### Phase 4: Webhook Integration (Week 4)
- [ ] Update `stripe-webhook.js` to read Google Drive URLs
- [ ] Modify Pictorem order submission to use Drive links
- [ ] Test fulfillment with test order
- [ ] Verify Pictorem receives high-res images correctly

#### Phase 5: Verification & Fallback (Week 5)
- [ ] Monitor first 10 real orders through new pipeline
- [ ] Document any issues (Pictorem download failures, etc.)
- [ ] Implement fallback: if Google Drive fails, use local Mac copy
- [ ] Add logging to Cloudflare function for debugging

---

### Error Handling & Resilience

**What if Google Drive upload fails?**
```javascript
// In Studio: Retry with exponential backoff
async function uploadWithRetry(filePath, collection, filename, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await uploadOriginalToGoogleDrive(filePath, collection, filename);
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(Math.pow(2, i) * 1000); // 1s, 2s, 4s backoff
    }
  }
}
```

**What if Google Drive link expires?**
```javascript
// In webhook: Regenerate download link on-demand
async function getDownloadLink(googleDriveFileId) {
  const drive = google.drive({ version: 'v3', auth });
  const file = await drive.files.get({
    fileId: googleDriveFileId,
    fields: 'webViewLink'
  });
  return file.data.webViewLink;
}
```

**What if Pictorem can't access Google Drive URL?**
```javascript
// Fallback: Check local Mac copy if Drive URL fails
// (Webhook runs in Cloudflare, can't access local Mac directly)
// Instead: Use Cloudflare Worker to proxy + cache the file
```

---

### Monitoring & Maintenance

| Task | Frequency | Owner | Notes |
|------|-----------|-------|-------|
| Check Google Drive storage quota | Monthly | Wolf | Alert at 80% usage |
| Review upload failures in logs | Weekly | Automation | Check Cloudflare function logs |
| Test fulfillment pipeline | Per order | Automatic | Log each webhook execution |
| Verify photo IDs in photos.json | Monthly | Manual | Ensure all IDs are valid |
| Backup Drive folder structure | Quarterly | Manual | Export folder list |

---

## MCP SERVER ARCHITECTURE

### What is MCP?

MCP (Model Context Protocol) allows Claude Desktop to interact directly with local files and systems on your Mac. Archive-35's MCP server enables Claude to read code, generate content, and automate portfolio tasks.

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

**How It Works:**
1. Claude requests operation (e.g., "read photos.json")
2. MCP server validates the path (prevents directory traversal)
3. Operation executes (file read, git command, etc.)
4. Result returned to Claude

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

## ELECTRON STUDIO APP

### Purpose
Desktop app for Wolf to manage the photography portfolio locally on Mac:
- Import photos from camera/Lightroom
- Organize into galleries
- Edit metadata (title, description, tags, location)
- Generate photos.json
- Deploy to GitHub (publish live)

### Tech Stack
- **Framework:** Electron (Node.js + Chromium)
- **UI:** React (in development, see `/05_Studio/src/`)
- **IPC:** Electron ipcMain/ipcRenderer for secure communication
- **Entry Point:** `/05_Studio/app/main.js`

### Key IPC Handlers (main.js)

```javascript
ipcMain.handle('select-folder')      // Open folder dialog
ipcMain.handle('select-files')       // Open file dialog (images)
ipcMain.handle('get-env')            // Read environment variables
ipcMain.handle('get-base-path')      // Get Archive-35 repo root
ipcMain.handle('read-portfolio')     // Load portfolio structure
ipcMain.handle('write-metadata')     // Save gallery metadata
ipcMain.handle('generate-photos-json') // Generate photos.json
ipcMain.handle('git-status')         // Check git status
ipcMain.handle('git-push')           // Deploy to GitHub
```

### Workflow: Ingesting Photos

1. **Select folder** → `05_Studio/app` opens file dialog
2. **Choose gallery** → Select which portfolio folder (Grand Teton, Africa, etc.)
3. **Import images** → Copy originals to `01_Portfolio/{gallery}/originals/`
4. **Generate thumbnails** → Create web-optimized versions
5. **Edit metadata** → Title, description, tags, date, location
6. **Generate photos.json** → Combine all metadata
7. **Deploy** → `git add . && git commit && git push`
8. **Live on website** → GitHub Pages + Cloudflare CDN (30 seconds)

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
Step 3: Web Optimization
┌──────────────────▼──────────────┐
│ Studio generates web images     │
│ 300-800KB full size             │
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
Step 5: GitHub Pages Build (automatic)
┌──────────────────▼──────────────────────┐
│ GitHub detects push                     │
│ Builds static site                      │
│ Publishes to github.io                  │
└──────────────────┬──────────────────────┘
                   │
Step 6: Cloudflare Cache (automatic)
┌──────────────────▼──────────────────────┐
│ Cloudflare CDN detects new content      │
│ Invalidates cache                       │
│ Caches new images globally              │
└──────────────────┬──────────────────────┘
                   │
Step 7: LIVE (30 seconds total)
┌──────────────────▼──────────────────────┐
│ Photos visible on archive-35.com        │
│ Optimized image delivery worldwide      │
└──────────────────────────────────────────┘
```

**Timing:**
- **Typical**: 2-5 minutes from Studio push to live
- **Fastest**: 30 seconds (Cloudflare propagation)
- **Manual**: Studio App has "Deploy" button (one click)

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
| Originals only on Mac (no cloud backup) | Risk of data loss | Manually backup to external drive | 🔴 HIGH |
| No automatic sync to Google Drive | Must remember to upload | Set calendar reminder weekly | 🔴 HIGH |
| Some portfolio folders have trailing underscores (Grand_Teton_) | Naming inconsistency in paths | Manually rename folders | 🟡 LOW |
| Pictorem fulfillment requires Mac to be online | If Mac sleeps, webhook can't submit | Wake Mac before expected webhook | 🟠 MEDIUM |

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

# ===== EMAIL (Resend - Transactional) =====
RESEND_API_KEY=                # Resend API key for order confirmation emails
WOLF_EMAIL=wolfbroadcast@gmail.com  # Where to send order notifications (optional)

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

### Why GitHub Pages (Not Cloudflare Pages, Vercel, etc.)?

**Decision:** Use GitHub Pages for website hosting.

**Reasons:**
- Free tier is unlimited (no overage fees)
- Built into GitHub workflow (push → deploy)
- Works perfectly for static sites (100% of Archive-35)
- Cloudflare provides edge caching separately (added layer)
- No vendor lock-in; can migrate to Vercel anytime
- Deploy history visible in GitHub commits

**Tradeoff:** Slightly slower initial response time vs. Cloudflare Pages. Offset by Cloudflare CDN layer.

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

### Why Originals Must Move to Cloud Storage

**Current State:** High-res masters (8-35MB each) only on Mac's local drive.

**Risks:**
- Single point of failure (if Mac is stolen/fails, originals are gone)
- No backup (except manual external drive backup)
- Can't access originals remotely
- Backup workflow is manual (easy to forget)

**Solution:** Move originals to Google Drive (encrypted, redundant, versioned).

**Why Google Drive?**
- Free tier: 15GB (enough for ~500-1000 originals)
- Built-in versioning & recovery
- Shareable if needed (future team collaboration)
- Can integrate with MCP server for smart backups
- Partner with Lightroom (Wolf's existing workflow)

**Timeline:** Planned for Q1 2026. Needs MCP server integration to automate.

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

**Document Status:** ✅ Complete — All components documented. Updated as system evolves.

**Last Reviewed:** 2026-02-07

**Next Review:** 2026-03-07 (monthly)
