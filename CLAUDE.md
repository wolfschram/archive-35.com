# Archive-35 Development Protocol

<operational_principles>
## DISPLAY THESE 10 RULES AT THE START OF EVERY RESPONSE

1. I will verify the EXISTING folder structure before ANY action — check `05_Studio/app/` for Studio code
2. I will grep/search BEFORE writing — never create duplicate files or functionality
3. I need TWO evidence sources (file content + existing code) before ANY conclusion
4. I will get explicit y/n confirmation before ANY file creation, modification, or deletion
5. I will make the SMALLEST possible change — ONE issue at a time, integrate into EXISTING files
6. I will run the app (`cd 05_Studio/app && npm run dev`) and verify after changes
7. I will NEVER create new apps/folders when existing ones serve the purpose
8. I will update this CLAUDE.md after every significant change
9. **NEVER GUESS. NEVER ASSUME.** Before claiming something is fixed, I MUST grep/search ALL files for the thing I'm removing. If I say "Africa is removed" I must prove it by searching every file type (HTML, JSON, XML, TXT, PY) — not just the one file I edited. A fix is not done until a project-wide search returns ZERO results.
10. **VERIFY MY OWN WORK.** After every change, I will run a verification search to confirm the change actually took effect. "I edited photos.json" is not proof — I must READ the file back and confirm. If a user reports something isn't fixed, my FIRST action is a full project search, not another guess at what might be wrong.

If I skip this display, I am drifting. User should say "RESET" to bring me back.
</operational_principles>

---

## WHAT THIS PROJECT IS

**Archive-35** is a fine art landscape photography business by Wolf Schram.
- Website: archive-35.com (Cloudflare Pages via GitHub)
- Studio: Electron + React app for content/sales management (05_Studio/app/)
- Print fulfillment: **Pictorem** (PRO + Premium account, 15% rebate, 0% commission, API token: "archive-35")
  - Domain verified (archive-35.com): DNS OK, SSL OK
  - Certificate of Authenticity: enabled for ALL artwork (free with Premium)
  - Step-by-step order notifications: ON
  - Artist Profile: intro, bio, website URL all configured
  - Payment: PayPal Business account needed (30-day terms after customer receives artwork)
  - Go-live: Monday Feb 17, 2026 (48hr DNS propagation from Feb 13 upgrade)
- Payments: Stripe (live keys configured)
- Backups: Google Drive
- Photo source: Adobe Lightroom exports → Photography/ folder
- Licensing: Ultra-high-resolution panoramic images for commercial use (09_Licensing/)

**THIS IS NOT:**
- A new project — substantial code already exists
- Multiple separate apps — ONE Studio app at `05_Studio/app/`
- Artelo/Fine Art America — **SWITCHED TO PICTOREM**

---

## DEPLOYMENT

- **Host**: Cloudflare Pages (NOT GitHub Pages)
- **Build**: `bash build.sh` → runs `sync_gallery_data.py` THEN copies files → `_site/`
- **Deploy**: Push to `main` branch → Cloudflare auto-deploys from `_site/`
- **CDN Cache**: Changes may take 1-3 minutes to appear. Use `?v=N` cache busters for testing.
- **Domain**: archive-35.com (CNAME configured)
- **Studio deploy pipeline**: 05_Studio/app/main.js handles build → git push → verify cycle
- **CRITICAL**: `sync_gallery_data.py` MUST run before HTML copy — regenerates gallery.html inline data from photos.json. See LESSONS_LEARNED.md Lesson 001.

---

## COMPLETE PROJECT STRUCTURE (Verified 2026-02-11)

```
archive-35.com/                          # GitHub repo root
│
├── _site/                               # BUILD OUTPUT — Cloudflare deploys from here
│   ├── (all HTML, css/, js/, data/, images/, logos/, 09_Licensing/)
│   └── Built by build.sh
│
├── 01_Portfolio/                        # PHOTO GALLERIES (source files)
│   ├── Grand_Teton/originals/          # 48 full-res photos
│   ├── (20+ other collections)         # Iceland, Africa, Paris, etc.
│   └── _master.json
│
├── 05_Studio/                           # ELECTRON APP
│   └── app/
│       ├── main.js                     # Electron main process (IPC, deploy pipeline, verify)
│       ├── preload.js
│       ├── src/App.js                  # React router
│       └── src/pages/                  # ContentIngest, ContentManagement, WebsiteControl, etc.
│
├── 09_Licensing/                        # LICENSING SYSTEM
│   ├── originals/                      # 45 ultra-high-res panoramic source files
│   ├── thumbnails/                     # 800px wide thumbnails (deployed)
│   ├── watermarked/                    # Watermarked preview versions (deployed)
│   ├── metadata/                       # Per-image metadata JSON files
│   ├── _catalog.json                   # Master licensing catalog
│   ├── _config.json                    # Licensing config (tiers, pricing)
│   ├── upload_to_r2.py                 # R2 upload with local verify + HEAD check + backup tracking
│   ├── process_licensing_images.py     # Full pipeline: scan → thumbnail → watermark → R2 → catalog
│   ├── generate_thumbnail.py
│   ├── generate_watermark.py
│   └── scan_licensing_folder.py
│
├── css/                                # Website stylesheets
│   ├── styles.css                      # Main site styles (glass morphism, header, etc.)
│   ├── cart.css                        # Shopping cart panel styles
│   └── product-selector.css            # Product selector modal styles
│
├── js/                                 # Website JavaScript
│   ├── main.js                         # Homepage/collection gallery, lightbox, search
│   ├── product-selector.js             # Print/license selector modal (v7+)
│   ├── cart.js                         # Shopping cart logic
│   ├── cart-ui.js                      # Cart UI (icon in header, slide-out panel)
│   ├── image-protection.js             # Right-click/drag protection
│   ├── stripe-links.js                 # Stripe payment link mapping
│   ├── analytics.js                    # Google Analytics events
│   ├── schema-inject.js               # JSON-LD structured data
│   └── test-mode-banner.js            # Test mode indicator
│
├── data/                               # Website data files
│   ├── photos.json                     # All photos with dimensions, collections, metadata
│   └── licensing-catalog.json          # 45 licensing images (generated from 09_Licensing)
│
├── images/                             # Website images (30+ collection folders)
│   ├── grand-teton/                    # 48 photos (thumb + full)
│   ├── tanzania/, etc.
│   └── (africa/ REMOVED Feb 2026 — was duplicate of Tanzania)
│   └── (iceland-ring-road/ REMOVED Feb 16 — duplicate of Iceland)
│   └── (large-scale-photography-stitch/ REMOVED — licensing only)
│   └── (antilope-canyon/ REMOVED Feb 16 — old misspelling)
│
├── logos/                              # Brand logos, favicons, OG images
│
├── functions/                          # Cloudflare Workers (checkout, etc.)
│
├── *.html                              # Website pages (see below)
├── build.sh                            # Build script → _site/ (calls sync_gallery_data.py first!)
├── sync_gallery_data.py                # Regenerates gallery.html inline data from photos.json
├── CNAME                               # Domain config
├── robots.txt, sitemap.xml, llms.txt
└── CLAUDE.md                           # THIS FILE
```

---

## WEBSITE PAGES (All Live)

| Page | File | Nav | Cart | Notes |
|------|------|-----|------|-------|
| Homepage | index.html | ✅ styles.css header | ✅ | Hero, featured, collections |
| Gallery | gallery.html | ✅ glass-pill (inline) | ✅ | Cover Flow 3D + full gallery + lightbox |
| Collection | collection.html | ✅ styles.css header | ✅ | Single collection view |
| Licensing | licensing.html | ✅ glass-pill (inline) | ✅ | 45 panoramic images, tier filters |
| About | about.html | ✅ styles.css header | ✅ | Biography, philosophy |
| Contact | contact.html | ✅ styles.css header | ✅ | Form + Pictorem link |
| Search | search.html | ✅ styles.css header | ✅ | Full-text search with filters |
| Terms | terms.html | ✅ | - | License terms for image licensing |
| Privacy | privacy.html | ✅ | - | Privacy policy |
| Thank You | thank-you.html | ✅ | - | Post-purchase confirmation |

### Two Nav Architectures
- **Shared CSS pages** (index, about, collection, contact, search, terms, privacy, thank-you): Use `css/styles.css` with `.header` / `.header-inner` / `.nav` classes
- **Self-contained pages** (gallery.html, licensing.html): Have ALL CSS inline with matching glass-pill style. Nav class is `nav` (gallery) or `nav-links nav` (licensing)

---

## GALLERY.HTML — KEY ARCHITECTURE

gallery.html is **completely self-contained** — all CSS and JS inline, no external stylesheets (except cart.css, product-selector.css loaded at bottom).

### Cover Flow Engine
- `covSz()`: Card size = `min(50vh, 34vw, 540px)` desktop / `min(32vh, 52vw, 320px)` mobile
- Cards are **3:2 landscape** ratio (height = cs * 0.667) with `object-fit: contain` and dark background
- Card face images use **full-res** (`-full.jpg`, 2000px) not thumbnails
- `VH=9`: Visible cards on each side
- `sp=S*0.26`: Spacing between side cards
- `cZ=S*0.6`: Z-depth for center card
- `bO=S*0.5`: Base offset for first side card
- Opacity fade: `0.10` per position (slower fade = more visible cards at edges)
- `SA=68`: Rotation angle for side cards
- `#cf { top:8vh }` desktop, `12vh` at 768px, `14vh` at 420px

### Touch/Swipe Sensitivity
- Desktop: divisor=130, velocity=0.012, fling=3
- Mobile (touch): divisor=200, velocity=0.008, fling=2

### Key Z-Index Stack (HEADER IS ALWAYS TOP — like Excel frozen row)
| Layer | Z-Index | Element |
|-------|---------|---------|
| Room/walls | 1-5 | #room, #back-wall, gradients |
| Cover Flow | 10 | #cf |
| Info text | 15 | #info |
| Dots | 20 | #dots |
| Preview panel | 30 | #cprev |
| Full gallery | 200 | #fgal |
| Product selector | 3000 | .product-selector |
| Cart panel | 9999 | .cart-panel |
| Lightbox | 9999 | #lb |
| **HEADER** | **10000** | **header (ALWAYS ON TOP)** |
| Cart toast | 10001 | .cart-toast (only thing above header) |

### Lightbox Behavior
- Opens: `#fgal` hidden via `visibility:hidden`, `#lb.open` added
- Closes: `#lb.open` removed, `#fgal` visibility restored
- Background: `#050504` (fully opaque — NOT rgba)
- Buy button: centered below photo at `bottom:75px`
- Buy click: fetches `data/photos.json`, matches by filename, calls `openProductSelector(fullPhoto)`

### Mobile Breakpoints
- `@media(max-width:768px)`: Smaller header, gallery pushed to `top:12vh`, smaller fonts
- `@media(max-width:420px)`: Even smaller nav, gallery at `top:14vh`

---

## LICENSING SYSTEM

### Pipeline (09_Licensing/)
1. Select source folder containing high-res panoramic images (via Studio LicensingManager or CLI)
2. Run `process_licensing_images.py --source <folder>` — scans, generates previews, thumbnails, metadata
3. R2 upload: `upload_to_r2.py` uploads originals (PRIVATE) + previews + thumbnails to Cloudflare R2
   - **Originals MUST exist locally** before upload (hard fail if missing)
   - Every upload verified via HEAD request (size match)
   - Backup status tracked in metadata JSON (`r2_backup_status.original.verified`)
   - Use `--verify-only` to audit backup status without uploading
4. Output: `data/licensing-catalog.json` with 45 entries
5. `build.sh` copies thumbnails + previews to `_site/09_Licensing/`

### Copy Protection (Invisible — No Visible Watermark)
- **Old approach (removed):** Ugly tiled "ARCHIVE-35 | PREVIEW ONLY" text overlay at 30% opacity
- **New approach (Feb 12, 2026):** Multi-layer invisible protection:
  1. **Server-side:** Preview images are max 2000px, quality 45 JPEG, slight blur (0.5px), all EXIF stripped
  2. **Client-side (licensing.html):** Canvas-based rendering (blocks right-click save), blob URLs (no direct image URL), contextmenu/drag blocked on canvas
  3. **Existing:** image-protection.js blocks right-click/drag/long-press on all images
  4. **Legal:** C2PA credentials on originals prove ownership cryptographically
- Result: Clean, premium-looking previews that are commercially useless

### Gallery vs Licensing Separation
- **Gallery** (photos.json / gallery.html): Regular photography collections — prints for sale
- **Licensing** (licensing-catalog.json / licensing.html): Ultra-high-res panoramic images — licenses only
- `large-scale-photography-stitch` collection **removed from gallery** (Feb 12) — these are licensing-only
- Gallery ingest (`scan-photography` in main.js) auto-excludes: `Large Scale Photography Stitch`, `licensing`
- Licensing ingest goes through LicensingManager.js → `process_licensing_images.py`

### Licensing Page (licensing.html)
- Self-contained with inline CSS
- Loads `data/licensing-catalog.json` dynamically
- Filter buttons: ALL, ULTRA, PREMIUM, STANDARD
- **Modal uses canvas rendering** (not `<img>`) for copy protection
- Image retry logic (staggered 150ms) handles CDN rate-limiting
- Title cleanup: strips `.jpg`, converts `IMG_0140-Pano` → `Panoramic IMG 0140`
- Tiers: Ultra ($500+, 20K+ pixels), Premium ($400+), Standard ($300+)

### Image Paths
- Thumbnails: `09_Licensing/thumbnails/A35-{date}-{num}.jpg`
- Previews: `09_Licensing/watermarked/A35-{date}-{num}.jpg` (folder name kept for compatibility, but no watermark)

---

## E-COMMERCE FLOW

```
Gallery/Collection → Click photo → Lightbox → BUY PRINT / LICENSE
    ↓
Product Selector Modal (product-selector.js)
├── ORDER PRINT tab: Canvas, Metal, Acrylic, Fine Art Paper, Wood
│   ├── Size options calculated from photo dimensions/aspect ratio
│   └── Price displayed → ADD TO CART or BUY NOW → Stripe → Pictorem
├── LICENSE IMAGE tab: Web/Social, Editorial, Commercial, Billboard, Hospitality, Exclusive
│   ├── JPEG or TIFF format selection
│   └── Price displayed → LICENSE THIS IMAGE → Stripe → Download Link (72hr signed URL)
    ↓
PRINT PATH:
  Stripe checkout (with shipping) → webhook → Pictorem order (R2 original) → customer email + Wolf email
LICENSE PATH:
  Stripe checkout (no shipping) → webhook → signed R2 download URL → customer email + Wolf email
```

### Two Purchase Flows
- **Prints**: `metadata[orderType] = 'print'` → webhook sends to Pictorem for fulfillment
- **Licenses**: `metadata[orderType] = 'license'` → webhook generates HMAC-signed R2 download URL (72hr expiry), emails customer
- **Collection slug**: Passed explicitly in `metadata[collection]` from frontend → webhook uses it for R2 key lookup
- **Fallback**: If Stripe checkout fails, both flows fall back to contact form

### Promotion Code System
- **Stripe native**: `allow_promotion_codes: true` on all checkout sessions
- **Studio UI**: PromoCodeManager.js — create/manage/deactivate promo codes
- **IPC handlers**: 6 Stripe API handlers in main.js (coupons + promotion codes)
- **Flow**: Wolf creates coupon + promo code in Studio → gives code to client → client enters at Stripe checkout
- **Metadata**: Each code tracks client_name, client_email, notes, tier
- **Presets**: 10%, 15%, 20%, 25%, 50%, 100% off + $50, $100, $250 off

### Cart Metadata Validation (4-Layer Defense)
1. **cart.js**: Warns when items added without metadata
2. **cart-ui.js**: `pictorem` is never null — falls back to top-level item props + size string parsing
3. **create-checkout-session.js**: Server-side metadata completeness warning
4. **stripe-webhook.js**: Error response includes `missingFields` array for debugging

### Cart UI Integration
- `cart-ui.js` looks for `.nav` element to inject cart icon
- Requires CSS variables: `--text-primary`, `--accent`, `--bg-primary`, `--glass-*`, `--transition`, `--radius-sm`
- gallery.html and licensing.html define these in `:root` for compatibility

---

## STUDIO APP (05_Studio/app/)

### Deploy Pipeline (main.js) — 11-Stage with Safety Net
Pipeline stages: **Scan → Images → C2PA → R2 → Data → Sync → Validate → Git → Push → Verify → Done**

| Stage | What | Safety Level |
|-------|------|-------------|
| Scan | Read all portfolios | Info only |
| Images | Copy thumb + full to images/ | Warn on failure |
| C2PA | Count signed vs unsigned | Info only |
| R2 | Verify originals in R2 bucket | **HARD BLOCK** if missing |
| Data | Write photos.json | Required |
| **Sync** | Run sync_gallery_data.py (gallery.html inline data) | **NEW Feb 15** — prevents stale Cover Flow |
| **Validate** | 6 pre-deploy checks (see below) | **HARD BLOCK** on errors, WARN on warnings |
| Git | Stage + commit | Required |
| Push | git push origin main | Required |
| Verify | Poll live site for 3min | Timeout = amber warning |
| Done | Summary | Shows warnings + results |

### Pre-Deploy Validation Checks (Validate stage)
1. **Schema**: Every photo has id, collection, filename, thumbnail, full, title
2. **Duplicate IDs**: No two photos share the same id → **BLOCK**
3. **Empty slugs**: No null/empty collection slugs → **BLOCK**
4. **Orphan references**: index.html, sitemap.xml, llms.txt reference a collection not in photos.json → **WARN**
5. **Photo count sanity**: >20% drop vs live site → **WARN**
6. **Gallery freshness**: gallery.html inline collection count ≠ photos.json → **BLOCK**

### Studio Pages
| Page | File | Purpose |
|------|------|---------|
| Ingest | ContentIngest.js | Import photos from Lightroom |
| Manage | ContentManagement.js | Organize portfolios, metadata |
| Gallery | GalleryPreview.js | Preview gallery layout |
| Website | WebsiteControl.js | Deploy, service status |
| Licensing | LicensingManager.js | Run licensing pipeline |
| Sales | SalesPictorem.js | Pictorem integration |
| **Promos** | **PromoCodeManager.js** | **Stripe promo code CRUD** |
| **Sync** | **FolderSync.js** | **One-way folder sync (Source → iCloud)** |
| Social | SocialMedia.js | Placeholder |
| Analytics | Analytics.js | GA4 + Cloudflare + Stripe |
| Settings | Settings.js | Mode (test/live), API keys |

### Key IPC Handlers
- Photo management, portfolio operations, deploy pipeline
- Stripe promotion codes: list/create/delete coupons, list/create/deactivate promo codes
- Folder sync: get/save config, run one-way sync with progress events
- Run with: `cd 05_Studio/app && npm run dev`

---

## STRIPE CONFIGURATION

- **Public Key**: `pk_live_51SxIaWIyLqYsy9lvz6b9LBV2cMBz4JJgFb30aYvbrMxH0hromGU1mFWF2vu6tV97Co8LrczCM3dFJg89a9a4tT0U007cpVXRWM`
- Set via `window.STRIPE_PUBLIC_KEY` in each page that loads Stripe
- Pages with Stripe: gallery.html, licensing.html, collection.html, index.html

---

## KNOWN ISSUES / NEEDS VERIFICATION

| Issue | Status | Notes |
|-------|--------|-------|
| Mobile gallery layout | ✅ VERIFIED | iPhone test passed — nav pushed down, swipe sensitivity reduced, cards sized correctly. |
| Licensing page layout | ✅ WIDENED | Grid min 320→380px, padding 40→60px, max-width 1600→1800px. Needs visual verification. |
| Mobile homepage layout | ✅ VERIFIED | Wolf verified on actual iPhone Feb 13 — looks good. |

---

## HANDOVER: SESSION STATUS (Feb 14, 2026)

### What Just Happened (Pipeline Audit Session)
A test purchase revealed that NO gallery originals were in the R2 bucket. This triggered a full pipeline audit that found:
- **Africa gallery was a duplicate of Tanzania** (44 identical photos) — DELETED
- **large-scale-photography-stitch still in photos.json** (44 licensing-only photos) — PURGED
- **49 duplicate photo IDs** across collections (prefix collision) — FIXED (now uses full slug: `grand-teton-001`)
- **R2 batch upload was dead code** (handler existed but never wired to UI) — WIRED to preload.js + WebsiteControl
- **Deploy R2 check was fake** (only checked env vars, never counted objects) — REPLACED with real ListObjectsV2 comparison
- **R2 upload failures were silent** (console.warn only) — NOW sends UI warnings + tracks in return object
- **Webhook sent garbage to Pictorem** when R2 original missing — NOW hard blocks order + emails Wolf
- **Compositor Editor was built then removed** — FULLY cleaned from all files

### What Wolf Needs To Do RIGHT NOW
1. **Restart Studio** (Cmd+Q, relaunch) — main.js and WebsiteControl.js were modified
2. **Website Control → "Upload All Originals to R2"** — backfills all 483 photos to R2
3. **Website Control → "Deploy to Website"** — now includes Sync + Validate stages automatically
4. **Verify live site** — Africa gone, 483 photos, 29 collections (DEPLOYED Feb 15 ✅)
5. **Delete orphan folder locally**: `rm -rf images/large-scale-photography-stitch/`

### What's Coming Next (External AI Audit)
Wolf sent `Archive-35_Pipeline_Audit.docx` to ChatGPT and Gemini for independent review. Their reports will come back with questions/recommendations. The next session should:
- Read the audit document: `Archive-35_Pipeline_Audit.docx` (in repo root)
- Address any gaps identified by the external auditors
- Run end-to-end checkout tests (print + license) after R2 backfill
- Consider implementing the 7 known gaps listed in the audit doc Part 3

### Current State: Data
- **photos.json**: 483 photos, 29 collections, 483 unique IDs (zero collisions)
- **large-scale-photography-stitch**: REMOVED from photos.json (44 entries purged Feb 14)
- **R2 bucket**: Licensing originals (45) confirmed. Gallery originals need backfill via Studio UI button
- **Live website**: Still shows old data — DEPLOY NEEDED
- **build.sh**: Now explicitly removes orphan folders (_site/images/large-scale-photography-stitch, _site/images/africa)

### Files Changed This Session
| File | Change |
|------|--------|
| `05_Studio/app/main.js` | Removed compositor handlers, fixed ID generator, real R2 verification, R2 failures loud, DEEP SERVICE TESTS (6 services + dependencies, each returns checks[] array) |
| `05_Studio/app/preload.js` | Removed compositor bridges, added batchUploadR2 + onR2UploadProgress |
| `05_Studio/app/src/App.js` | Removed compositor import + TabPanel |
| `05_Studio/app/src/components/Sidebar.js` | Removed compositor tab |
| `05_Studio/app/src/pages/WebsiteControl.js` | REWRITTEN: permanent cards, deep service health tests (7 services w/ sub-checks), always-visible reset buttons, deploy Done stage fix, Dependencies service |
| `05_Studio/app/src/pages/CompositorEditor.js` | DELETED |
| `05_Studio/app/src/styles/CompositorEditor.css` | DELETED |
| `functions/api/stripe-webhook.js` | Added hard block: if R2 original missing, order blocked + alert email to Wolf |
| `data/photos.json` | Removed 88 phantom photos (44 Africa + 44 LSP), regenerated all IDs with full slug prefix |
| `01_Portfolio/Africa/` | DELETED (duplicate of Tanzania) |
| `images/africa/` | DELETED |
| `images/large-scale-photography-stitch/` | DELETED |

---

## RECENT CHANGES LOG (February 9-15, 2026)

| Commit | Change |
|--------|--------|
| dd2cbc0 | SAFETY NET: Pre-deploy validation (6 checks), gallery sync in deploy pipeline, pipeline stages Sync+Validate, JSX Unicode fixes, health check Cloudflare env var fix, Africa fully removed from all 8+ files |
| 6380c5d | PIPELINE AUDIT: Africa dupe deleted, LSP purged (527→483), IDs fixed (full slug), R2 batch upload wired, R2 deploy verification (ListObjectsV2), R2 failures loud, webhook hard block, compositor removed |
| (pending) | Google Sheet Order Log: Apps Script deployed as Web App, GOOGLE_SHEET_WEBHOOK_URL added to Cloudflare env vars, Cloudflare redeployed |
| (pending) | AI agent optimization: alt text, llms.txt rewrite, llms-full.txt, enhanced schema (Photograph+C2PA+license), licensing JSON-LD, canonical URLs, meta keywords, /api/products.json, build.sh updated |
| (pending) | Studio: deploy verify amber warning state, delete portfolio feature (IPC + UI + preload) |
| (pending) | Licensing page wider layout: grid min 380px, padding 60px, max-width 1800px |
| (pending) | Pictorem: PayPal email (wolfbroadcast@gmail.com) saved in Sales History |
| 8c4e8ce | Regenerate 45 licensing previews: clean, no watermark (2000px, q45, blur) |
| (thumb)  | Regenerate 45 licensing thumbnails from clean previews (800px) |
| 021232b | Remove large-scale-photography-stitch from gallery (44 photos), fix licensing nav z-index |
| 7607ae8 | Fix: serve-original forces download instead of inline display |
| befec8a | Fix thank-you page: license vs print content, customer email fallback |
| 67ff012 | Fix: licensing Stripe checkout (was stub), customer email extraction, amount logging |
| (pending) | upload_to_r2.py: guaranteed R2 backup with local verification + HEAD verify + metadata tracking |
| (pending) | Remove large-scale-photography-stitch from gallery (353 photos, 26 collections) |
| (pending) | Replace watermark with invisible copy protection (canvas + blob + low-quality) |
| (pending) | licensing.html: canvas-based rendering + blob URLs for previews |
| (pending) | Studio: auto-exclude licensing folders from gallery scan |
| (pending) | LicensingManager.js: Browse button + force-regen previews option |
| (pending) | Wire licensing purchase to Stripe checkout + signed R2 download delivery |
| (pending) | Add collection slug to checkout metadata for new gallery support |
| (pending) | Verify Cloudflare Pages: R2 binding (ORIGINALS) + all webhook secrets confirmed |
| 6f490b4 | Fix gallery click-blocking (image-protection.js pointer-events) + Lesson 016 |
| 1531f82 | Fix gallery click-blocking after Buy Print cancel |
| 65a0dc6 | Add LESSONS_LEARNED.md, update ARCHITECTURE.md v2.1, update CLAUDE.md |
| 824dbb3 | Fix gallery: regenerate all 397 photos from photos.json + cleanup |
| c3ba825 | Add folder sync: one-way Source→iCloud sync with Studio UI |
| 67705a3 | Fix gallery: position, scroll sensitivity, lightbox click-blocking |
| dcf55c4 | Deploy: update photos — Feb 11, 2026 |
| ada52a5 | Launch pricing: 30% margin reduction on prints + licensing |
| 9040b00 | Update CLAUDE.md: document promo code system, metadata validation |
| 53dc72f | Add enterprise promo code system: Stripe integration + Studio manager |
| d2f69fe | Add 4-layer metadata validation to prevent checkout failures |
| 0ec3676 | Fix lightbox click-blocking + Cover Flow quality/cropping/position |
| 2507be7 | Enlarge desktop cover flow + fix mobile gallery layout & swipe |
| 4ba6eaa | Fix lightbox bleed-through + add cart icon to gallery & licensing |
| f5a136f | Fix lightbox z-index: bump to 9999 |

---

## WHAT STILL NEEDS WORK

### Priority
- [x] ~~Run `python generate_watermark.py --force` on Mac~~ → 45 clean previews + thumbnails regenerated, no watermarks ✅
- [x] ~~Run upload_to_r2.py on Mac~~ → All 45 originals uploaded + verified (135 files total)
- [x] ~~R2 binding in Cloudflare Pages~~ → ORIGINALS bound to archive-35-originals ✅
- [x] ~~Webhook secrets~~ → Both STRIPE_WEBHOOK_SECRET and STRIPE_TEST_WEBHOOK_SECRET configured ✅
- [x] ~~Remove large-scale-photography-stitch from gallery~~ → 44 photos removed, 515 photos across 29 collections ✅
- [x] ~~Licensing page nav blocked by modal~~ → Header z-index bumped to 300 (above modal 200) ✅
- [x] ~~Print checkout end-to-end test~~ → Stripe → webhook → Pictorem mock → seller email ✅
- [x] ~~License checkout end-to-end test~~ → Stripe → webhook → R2 signed URL → download works ✅
- [x] ~~Serve-original inline display~~ → Changed to Content-Disposition: attachment ✅
- [x] ~~Pictorem Premium upgrade + portal audit~~ → All tabs reviewed, profile optimized, CoA enabled, notifications on ✅
- [x] ~~Upload images to Pictorem~~ → Profile Pic (wolf-profile.jpg), Gallery Logo (wordmark-600.png), Bio image all uploaded via Claude ✅
- [x] ~~PayPal setup for Pictorem~~ → Personal account (wolfbroadcast@gmail.com) entered in Pictorem Sales History, credit card linked + set as preferred ✅
- [x] ~~Verify mobile layout on actual iPhone~~ → Wolf verified Feb 13, looks good ✅
- [x] ~~Licensing page layout~~ → Grid widened: min 380px, padding 60px, max-width 1800px ✅
- [x] ~~AI agent optimization~~ → Alt text, llms.txt + llms-full.txt, schema (Photograph+C2PA+license), canonical URLs, meta keywords, /api/products.json ✅
- [x] ~~Studio deploy verification UI~~ → Amber warning state for CDN propagation delay ✅
- [x] ~~Delete Portfolio in Studio~~ → IPC handler + UI button + confirmation dialog ✅
- [x] ~~Google Sheet Order Log~~ → Apps Script deployed as Web App, GOOGLE_SHEET_WEBHOOK_URL added to Cloudflare env, auto-creates Orders/Clients/Issues tabs ✅
- [x] ~~Pipeline Audit~~ → Africa dupe removed, LSP purged, 49 ID collisions fixed, R2 batch upload wired, R2 deploy verification, R2 failures loud, webhook hard block ✅
- [x] ~~Compositor Editor~~ → Built then fully removed (all references cleaned) ✅
- [ ] **RUN R2 BATCH UPLOAD** — Wolf must click "Upload All Originals to R2" in Studio after restart
- [x] ~~**DEPLOY TO WEBSITE**~~ → Deployed Feb 15: 483 photos, 29 collections, Africa removed, live site verified ✅
- [x] ~~Add deduplication check~~ → Pre-deploy validation catches duplicate IDs automatically ✅
- [x] ~~Pre-deploy safety net~~ → 6-check validation (schema, dupes, orphans, count, freshness) BLOCKS bad deploys ✅
- [x] ~~Gallery sync in deploy pipeline~~ → sync_gallery_data.py now runs automatically during Studio deploy ✅
- [ ] Add cross-gallery duplicate detection (hash-based comparison)
- [ ] Re-test checkout: verify customer email + amount show in notification emails
- [ ] End-to-end live checkout test (print + license) after Monday go-live
- [ ] Address external AI audit findings (ChatGPT + Gemini reports pending)

### Backlog
- [x] ~~Pictorem API automated order submission~~ → stripe-webhook.js: full auto-fulfillment
- [x] ~~Licensing Stripe checkout~~ → product-selector.js → create-checkout-session.js → stripe-webhook.js license handler
- [x] ~~Collection slug hardcoded in webhook~~ → Now passed via metadata[collection] from frontend
- [x] ~~WELCOME10 promo code in Stripe~~ → Full PromoCodeManager built
- [x] ~~Gallery data goes stale~~ → Automated via sync_gallery_data.py in build.sh
- [x] ~~Folder sync~~ → FolderSync.js (Source → iCloud)
- [x] ~~Large-scale-photography-stitch in gallery~~ → Removed, licensing-only now
- [x] ~~Ugly watermarks on licensing previews~~ → Invisible protection (canvas + low-quality + blob)
- [x] ~~R2 backup guarantee for originals~~ → upload_to_r2.py: local verify + HEAD check + metadata tracking
- [ ] Stripe webhooks for order fulfillment
- [ ] Google Drive backup integration in Studio app
- [ ] SocialMedia.js page (placeholder)
- [ ] Analytics.js page (placeholder)
- [ ] Collection name validator in Studio (prevent misspelled folder names)

---

## WOLF'S PREFERENCES

- ADHD/dyslexia: bullets, scannable, clear visual hierarchy
- Default .docx for documents (not markdown)
- Senior engineer depth (SMPTE 2110, broadcast, enterprise)
- Servant leadership philosophy
- German/English bilingual (prefers English responses)
- Auto-correct voice-to-text errors without asking
- VP of Engineering at Diversified (25+ years experience)
- **Hates**: when changes break other things. Do ONE job at a time, verify, then next.
- **Prefers**: checking the live site after every deploy

---

## HIGH RISK OPERATIONS (MUST ASK FIRST)

- Creating NEW folders or apps
- Deleting anything
- Modifying package.json
- Changing IPC handlers in main.js
- Git operations (push, reset, etc.)

---

## CRITICAL WARNINGS

1. **gallery.html is self-contained** — ALL CSS/JS inline. Don't try to refactor it to use external files.
2. **Two nav systems exist** — shared (styles.css) and inline (gallery/licensing). Keep them in sync manually.
3. **CDN caching** — Cloudflare caches aggressively. Use `?v=N` params when testing.
4. **Build before deploy** — `build.sh` must run to copy files to `_site/`. The Studio deploy pipeline does this automatically.
5. **photos.json wraps in object** — Structure is `{photos: [...]}`, NOT a top-level array.
6. **Cart icon injection** — cart-ui.js needs `.nav` class on the nav element to inject the cart button.
7. **gallery.html inline data** — `const G=[]` is regenerated by `sync_gallery_data.py` in build.sh. NEVER edit this array manually.
8. **Preload.js changes** — After modifying preload.js, user MUST quit and restart Studio (Cmd+Q). Hot reload is insufficient.
9. **Modal cleanup** — Every close handler (closeLb, closeFg, closePrev) must remove orphaned product-selector-modal divs.
10. **READ 08_Docs/LESSONS_LEARNED.md** — Before any new feature, check the "Do Not Replicate" patterns.
11. **index.html has HARDCODED collection cards** — The homepage collections grid is static HTML, NOT generated from photos.json. Adding/removing a collection requires editing index.html directly. gallery.html is dynamic (from sync_gallery_data.py), but index.html is NOT.
12. **Removing a collection requires editing ALL these files** — photos.json, index.html (HTML + JSON-LD schema), api/products.json, sitemap.xml, llms.txt, llms-full.txt, 07_C2PA/sign_all.py. A grep for the collection slug across the entire project is MANDATORY.
13. **⚠️ DEPLOY PIPELINE git add MUST STAGE ALL FILES** — `main.js` deploy pipeline uses `git add` to stage files. If you add new file types to the website (new folders, new config files), UPDATE the git add command in main.js (~line 2297). See LESSONS_LEARNED.md Lesson 022 for the catastrophic failure this caused.
14. **⚠️ TWO REGRESSION REPORTS = AUDIT THE PIPELINE** — If Wolf reports a "fixed" bug is back, do NOT re-fix it. First verify: did the fix reach the live site? `curl` the URL, check `git log --name-only`. The problem is likely the deploy pipeline, not the code. See LESSONS_LEARNED.md Lesson 023.
15. **⚠️ VERIFY FIXES ON THE LIVE SITE** — After every deploy, spot-check at least one changed HTML/JS file on archive-35.com. Don't just check photos.json counts — check that actual code changes are present.
16. **Stripe keys must ALL be the same mode** — All 10 HTML pages must use `pk_live_` (documented above). Mixing `pk_test_` public + `sk_live_` secret = silent checkout failure. Grep for `pk_test_` before every deploy.
17. **⚠️ HEADER IS ALWAYS THE TOP LAYER (z-index: 10000)** — The header/nav with cart icon MUST be visible in ALL states: lightbox, modals, full gallery, licensing modal, product selector. Nothing goes above the header except cart toasts. This is like Excel's frozen top row — content scrolls/layers UNDER it, never over it. If you add a new overlay or modal, its z-index MUST be below 10000.

---

## SELF-AWARENESS NOTE (READ THIS FIRST)

I have a tendency to fix individual bugs without stepping back to see systemic issues.
When Wolf reports "this is still broken," my FIRST action should be:
1. Check if the fix actually reached the live site (`curl` / view-source)
2. Check `git log --name-only` to see what was actually deployed
3. Only THEN investigate the code

If multiple bugs are reported at once, I should look for a SINGLE root cause that explains all of them,
not fix them one by one. See `memory/context/working-with-claude.md` for full self-assessment.

---

*Last updated: 2026-02-16 (CRITICAL: deploy pipeline git add fixed to stage ALL files — Lesson 022-025, Stripe keys switched to live, licensing modal z-index fixed, Add to Cart for licensing, Iceland Ring Road + LSP removed, Done stage fix)*

---

