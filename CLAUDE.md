# Archive-35 Development Protocol

<operational_principles>
## DISPLAY THESE 8 RULES AT THE START OF EVERY RESPONSE

1. I will verify the EXISTING folder structure before ANY action — check `05_Studio/app/` for Studio code
2. I will grep/search BEFORE writing — never create duplicate files or functionality
3. I need TWO evidence sources (file content + existing code) before ANY conclusion
4. I will get explicit y/n confirmation before ANY file creation, modification, or deletion
5. I will make the SMALLEST possible change — ONE issue at a time, integrate into EXISTING files
6. I will run the app (`cd 05_Studio/app && npm run dev`) and verify after changes
7. I will NEVER create new apps/folders when existing ones serve the purpose
8. I will update this CLAUDE.md after every significant change

If I skip this display, I am drifting. User should say "RESET" to bring me back.
</operational_principles>

---

## WHAT THIS PROJECT IS

**Archive-35** is a fine art landscape photography business by Wolf Schram.
- Website: archive-35.com (Cloudflare Pages via GitHub)
- Studio: Electron + React app for content/sales management (05_Studio/app/)
- Print fulfillment: **Pictorem** (PRO account, 15% rebate, API token: "archive-35")
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
│   ├── process_licensing_images.py     # Full pipeline: scan → thumbnail → watermark → metadata
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
│   ├── iceland-ring-road/              # 67 photos
│   ├── africa/, tanzania/, etc.
│   └── large-scale-photography-stitch/ # Panoramic licensing source images
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

### Key Z-Index Stack
| Layer | Z-Index | Element |
|-------|---------|---------|
| Room/walls | 1-5 | #room, #back-wall, gradients |
| Cover Flow | 10 | #cf |
| Info text | 15 | #info |
| Dots | 20 | #dots |
| Preview panel | 30 | #cprev |
| Header | 100 | header |
| Full gallery | 200 | #fgal |
| Lightbox | 9999 | #lb |

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
1. Drop high-res panoramic images in `09_Licensing/originals/`
2. Run `process_licensing_images.py` — generates thumbnails, watermarks, metadata
3. Output: `data/licensing-catalog.json` with 45 entries
4. `build.sh` copies thumbnails + watermarked to `_site/09_Licensing/`

### Licensing Page (licensing.html)
- Self-contained with inline CSS
- Loads `data/licensing-catalog.json` dynamically
- Filter buttons: ALL, ULTRA, PREMIUM, STANDARD
- Image retry logic (staggered 150ms) handles CDN rate-limiting
- Title cleanup: strips `.jpg`, converts `IMG_0140-Pano` → `Panoramic IMG 0140`
- Tiers: Ultra ($500+, 20K+ pixels), Premium ($400+), Standard ($300+)

### Image Paths
- Thumbnails: `09_Licensing/thumbnails/A35-{date}-{num}.jpg`
- Watermarked: `09_Licensing/watermarked/A35-{date}-{num}.jpg`

---

## E-COMMERCE FLOW

```
Gallery/Collection → Click photo → Lightbox → BUY PRINT / LICENSE
    ↓
Product Selector Modal (product-selector.js)
├── ORDER PRINT tab: Canvas, Metal, Acrylic, Fine Art Paper, Wood
├── LICENSE IMAGE tab: Personal, Commercial, Enterprise tiers
├── Size options calculated from photo dimensions/aspect ratio
└── Price displayed → ADD TO CART
    ↓
Cart (cart.js + cart-ui.js)
├── Cart icon in header (auto-injected by cart-ui.js into .nav element)
├── Slide-out panel from right
└── CHECKOUT → Stripe
    ↓
Stripe (with promotion code support) → Pictorem fulfillment
```

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

### Deploy Pipeline (main.js)
- Build: runs `build.sh`
- Push: `git add _site && git commit && git push`
- Verify: fetches live `photos.json`, checks `liveData?.photos` array length
- **Fixed**: verify step now handles `{photos: [...]}` wrapper (was `Array.isArray(liveData)`)

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
| Licensing page "squeezed" layout | ⚠️ OPEN | Wolf wants bigger content layout like About page. Grid is 4-col but may need wider max-width. |
| Mobile homepage "archive covering archive 35" | ⚠️ NEEDS PHONE TEST | Homepage looked fine in browser test but Wolf reported overlap on iPhone. |

---

## RECENT CHANGES LOG (February 9-11, 2026)

| Commit | Change |
|--------|--------|
| 1531f82 | Fix gallery click-blocking after Buy Print cancel (image-protection.js pointer-events bug) |
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
- [ ] Verify mobile layout on actual iPhone (gallery nav overlap, homepage text overlap)
- [ ] Licensing page layout — Wolf wants bigger/wider grid like About page
- [ ] Add deduplication check to ingest pipeline (prevent future duplicate photos)
- [ ] End-to-end test checkout flow in test mode (verify metadata 4-layer defense)

### Backlog
- [ ] Pictorem API automated order submission
- [x] ~~WELCOME10 promo code in Stripe~~ → Full PromoCodeManager built
- [x] ~~Gallery data goes stale~~ → Automated via sync_gallery_data.py in build.sh
- [x] ~~Folder sync~~ → FolderSync.js (Source → iCloud)
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

---

*Last updated: 2026-02-11 (Gallery sync automation, LESSONS_LEARNED.md, folder sync, promo codes, architecture v2.1)*

---

