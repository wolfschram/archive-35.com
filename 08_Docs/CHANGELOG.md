# Archive-35 Changelog

All notable changes to the Archive-35 system are documented here, in reverse chronological order.

---

## 2026-02-08 (Session 3)

### Added — Phase 4: MCP Server (Cloud)
- **MCP Server as Cloudflare Function** (`functions/mcp.js`)
  - JSON-RPC 2.0 protocol over HTTP at `/mcp`
  - 4 tools: search_products, get_product, get_collection, get_catalog_summary
  - 3 resources: catalog, policies, artist bio
  - Reads `data/photos.json` dynamically — auto-discovers new images on deploy
  - All 10 endpoint tests verified passing

### Added — Phase 5: C2PA Content Credentials
- **Batch-signed all 108 full-size images** with C2PA provenance metadata
  - ES256 (ECDSA P-256) algorithm via `c2pa-python` 0.28.0
  - Self-signed CA chain: Root CA + end-entity signer certificate
  - Assertions: CreativeWork (author, copyright, title, location) + c2pa.created action
  - ~171KB overhead per image
- **Certificate infrastructure** in `07_C2PA/`
  - `chain.pem` (certificate chain), `ca.pem`, `signer.pem`
  - Private key (`signer_pkcs8.key`) gitignored
  - `sign_all.py` batch signing script
- **Auto-signing in Studio ingest pipeline**
  - `c2pa-sign.js` module calls Python via child_process
  - Hooks into `finalize-ingest` after web-optimized image creation
  - Non-blocking — ingest continues if signing fails
  - `c2pa: true/false` flag stored in photo metadata

### Added — Phase 6: OpenAI Agentic Commerce Protocol
- **Product feed endpoint** (`/api/commerce/feed.json`)
  - 2,323 products with variants (108 photos x 5 materials x sizes)
  - Pricing from $60 (small paper) to $750 (large acrylic)
- **Checkout sessions API** (`/api/commerce/checkout_sessions`)
  - Create, get, complete, cancel checkout sessions
  - Tax calculation (8%), free shipping US/CA
  - Integrates with existing Stripe Checkout flow
- **Schema.org Store JSON-LD** embedded in `index.html`
- **Dynamic Product+VisualArtwork JSON-LD** via `js/schema-inject.js`

### Fixed — Studio App
- **Replaced all Artelo references with Pictorem** across 4 files
  - ContentManagement.js: delete dialog now says "Delete from R2 bucket (Pictorem fulfillment)"
  - SalesArtelo.js: completely rewritten as Sales Channels overview (Stripe, Pictorem, ChatGPT Shopping, MCP Server)
  - Pages.css: `.status-badge.artelo` → `.status-badge.pictorem`
  - ContentManagement.js.bak: fixed both references
- **R2 bucket cleanup on photo delete**
  - `soft-delete-photos` handler now calls DeleteObjectCommand
  - Resolves collection slug from `_gallery.json`
  - Respects test/live mode prefix
  - Returns `r2DeletedKeys` in result

### Changed
- ARCHITECTURE.md updated to v2.0 with C2PA, MCP Cloud, and Commerce Protocol sections
- Updated component diagram, file system map, storage table, and data flow diagrams
- Added Key Decisions entries for C2PA and ACP

---

## 2026-02-07 (Session 2)

### Added — Phases 1-3 Implementation
- **Phase 1: Legal Foundation**
  - robots.txt with AI crawler directives (Disallow for GPTBot, CCBot, etc.)
  - Terms of service page (`terms.html`)
  - DMCA/copyright notice page
  - XMP copyright metadata embedded in all 216 images (108 full + 108 thumb)
  - EXIF fields: Copyright, Creator, Rights, Usage Terms
- **Phase 2: Discovery & SEO**
  - Comprehensive sitemap.xml (static pages + dynamic gallery entries)
  - Schema.org JSON-LD: ImageGallery, Photograph, AggregateOffer per collection
  - Open Graph and Twitter Card meta tags on all pages
  - Canonical URLs configured
- **Phase 3: Content Protection**
  - Right-click disable on gallery images
  - CSS `-webkit-user-select: none` on image containers
  - Drag prevention on all `<img>` elements

### Changed
- Build command updated for Cloudflare Pages deployment
- Migrated deployment from GitHub Pages to Cloudflare Pages

---

## 2026-02-06

### Added
- **Shopping Cart System**
  - `cart.js` — localStorage-based cart with add/remove/quantity
  - `cart-ui.js` — Slide-out drawer UI with running total
  - Multi-item checkout via Stripe Checkout sessions
- **Product Selector UI** refinements
  - Panorama aspect ratio support (Wide Panorama 12:5 category)
  - Ultra-wide gap fix for extreme aspect ratios
  - Cache-bust versioning (v3)
- **Test Mode System**
  - Toggle between Stripe test/live modes in Studio app
  - `test-mode-banner.js` — visual indicator on website when in test mode
  - `test-mode-status.js` — backend API endpoint for mode checking
  - Webhook dual-mode signature verification (test + live secrets)
  - Mock Pictorem responses when in test mode
- **R2 Storage Integration**
  - R2 upload on photo import in Studio
  - R2 credentials management in Studio Settings
  - `serve-original.js` — HMAC-signed URL serving for print fulfillment
  - Webhook generates signed R2 URLs for Pictorem order submission
- **Africa Collection** — 44 photos deployed
- **New Zealand Collection** — 16 photos deployed
- **Grand Teton** — expanded to 48 photos (added 13 missing, fixed duplication)

### Fixed
- Stripe checkout: use server-side API instead of client-side Price IDs
- AutocompleteInput infinite re-render loop (memoize candidates array)
- `.env` parser regex to match digits for R2 keys
- Africa photo duplication: removed 44 duplicate entries
- Studio deploy: handle 'nothing added to commit' edge case
- Cart checkout flow: use `pages.dev` API endpoint

### Changed
- Removed Photography/ originals from git tracking (500MB+ savings)
- Consolidated scattered docs and cleaned up repo structure
- Added `.cfignore` to exclude large files from Cloudflare Pages deploy
- Monolith logo assets + OG/Twitter meta tags across all pages

---

## 2026-02-05

### Added
- **Stripe Webhook Fulfillment** (`stripe-webhook.js`)
  - Auto-submits orders to Pictorem API on successful payment
  - Material → Pictorem preordercode mapping
  - HMAC-signed R2 URLs for print-quality originals
- **Order Confirmation Emails** via Resend
  - Branded customer confirmation (black/gold Archive-35 theme)
  - Wolf notification with full order details, margin calculation
  - Triggered automatically by Stripe webhook
- **Infrastructure Registry** added to architecture docs
  - DNS records, service dashboards, credential locations
  - Stripe configuration details

### Changed
- Migrated from GitHub Pages to Cloudflare Pages
  - Serverless functions, R2 bindings, faster global CDN
  - DNS CNAME updated to `archive-35-com.pages.dev`

---

## 2026-02-04

### Changed
- **Replaced Artelo with Pictorem** for print fulfillment
  - Pictorem offers custom sizing (any aspect ratio)
  - Full REST API for automation
  - 0% commission (you set your markup)
  - Free shipping USA/Canada, white-label

### Added
- Pictorem PRO account (username: archive-35)
- API integration scripts in 06_Automation/scripts/
- Credential documentation in 08_Docs/credentials/pictorem.md
- **Product Selector UI** for website
  - Glass morphism design matching site aesthetic
  - 5 materials: Canvas, Metal, Acrylic, Fine Art Paper, Wood
  - 10 size options from 12x8" to 60x40"
  - Real-time pricing display
  - Replaces "Buy Print" button in lightbox
- **Archive-35 Studio** (Electron + React desktop app)
  - Photo ingest pipeline (AI description via Claude API, EXIF extraction)
  - Portfolio management (7 tabs: Ingest, Manage, Website, Sales, Social, Analytics, Settings)
  - Content Management page (photo grid, metadata editor, archive/delete)
  - Website glass morphism redesign (6 HTML pages)
- **Grand Teton Gallery** — 28 photos organized and analyzed
- **Documentation Suite** — ARCHITECTURE.md, CHANGELOG.md, CHECKLIST, WORKFLOW docs

---

## 2026-02-03

### Created
- Domain purchased: archive-35.com (Squarespace, expires Feb 2029)
- GitHub repo: wolfschram/archive-35.com
- Website deployed to GitHub Pages
- DNS configured (4 A records + CNAME)
- HTTPS pending certificate provisioning
- Artelo account created, API key obtained (later replaced by Pictorem)
- Grand Teton gallery: initial photos organized
- Folder structure established (00-09 numbered directories)

---

## Git Commit History (Key Commits)

| Hash | Date | Message |
|------|------|---------|
| `3452cea` | 2026-02-08 | docs: update session handoff with Phase 4-6 completion details |
| `41eb921` | 2026-02-08 | feat: add OpenAI Agentic Commerce Protocol endpoints |
| `1a5a52b` | 2026-02-08 | feat: embed C2PA Content Credentials in all 108 full-size photographs |
| `10dd4f2` | 2026-02-08 | feat: add MCP server for AI agent catalog access |
| `bd546db` | 2026-02-08 | docs: add Phase 4-6 implementation plan and updated session handoff |
| `507325b` | 2026-02-07 | chore: trigger redeploy with updated build command |
| `0269772` | 2026-02-07 | Implement legal, discovery, and content protection (Phases 1-3) |
| `05d7d96` | 2026-02-06 | Fix R2 pipeline: key naming, batch upload, webhook quality alerts |
| `69133d3` | 2026-02-06 | Fix cart checkout: use server-side API instead of client-side Price IDs |
| `80cf7e3` | 2026-02-06 | Add test/live mode toggle + R2 upload on photo import |
| `278e8eb` | 2026-02-06 | Add R2 high-res original support for Pictorem fulfillment |
| `4319968` | 2026-02-06 | Add shopping cart, Studio autocomplete, fix Grand Teton |
| `0da145f` | 2026-02-06 | Remove Photography/ originals from git tracking (500MB+) |

---
