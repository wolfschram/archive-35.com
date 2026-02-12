# Archive-35 Lessons Learned
**Living Document** | Started: 2026-02-11 | Updated after every significant learning

> "For every mistake we make, we should say thank you for being able to learn something.
> It only becomes a learning curve if we actually document what we learned."
> — Wolf, Feb 11 2026

---

## HOW TO USE THIS DOCUMENT

This is a **"Do Not Replicate" knowledge base**. Before starting ANY new feature or fix:

1. **Read the relevant section** — Ctrl+F for your topic (gallery, data, deploy, etc.)
2. **Check the patterns** — each lesson has a ROOT CAUSE and PREVENTION rule
3. **Update this file** — when you learn something new, add it here immediately
4. **Reference in CLAUDE.md** — critical patterns should also be in CLAUDE.md for quick access

### Lesson Format
Each entry follows this structure:
- **Date**: When it happened
- **Symptom**: What we saw (the bug/problem)
- **Root Cause**: Why it actually happened (the real issue)
- **Fix**: What we did to solve it
- **Prevention**: What we put in place so it never happens again
- **Category Tags**: For searchability

---

## TABLE OF CONTENTS

1. [Data Sync & Pipeline](#1-data-sync--pipeline)
2. [Gallery & Cover Flow](#2-gallery--cover-flow)
3. [E-Commerce & Checkout](#3-e-commerce--checkout)
4. [Electron Studio App](#4-electron-studio-app)
5. [Deployment & Build](#5-deployment--build)
6. [File Organization](#6-file-organization)
7. [Process & Workflow](#7-process--workflow)

---

## 1. DATA SYNC & PIPELINE

### LESSON 001: Inline Data Goes Stale When Source Updates
**Date:** 2026-02-11
**Category:** `data-sync` `gallery` `pipeline` `CRITICAL`

**Symptom:** Argentina collection showed only 3 photos on the website gallery (Cover Flow), but photos.json had 35. Multiple other collections were also incomplete — 226 photos visible out of 479 total.

**Root Cause:** gallery.html embeds photo data inline as `const G=[...]` for performance (no fetch delay on page load). The Studio ingest pipeline updates `data/photos.json` but NEVER regenerated gallery.html's inline data. This meant every new photo added through Studio was invisible in the Cover Flow gallery — they only appeared on collection.html and search.html which fetch from photos.json dynamically.

**Why It Wasn't Caught Sooner:** The gallery looked "fine" because it had some photos. Nobody noticed collections were incomplete until Wolf specifically counted Argentina photos and saw 3 instead of 35.

**Fix:**
1. Created `sync_gallery_data.py` — reads photos.json, regenerates `const G=[...]` in gallery.html
2. Added to `build.sh` as the FIRST step before copying HTML files
3. If the script fails, build prints a WARNING (doesn't silently break)

**Prevention:**
- `build.sh` ALWAYS runs `sync_gallery_data.py` before deploying
- Any page with inline data MUST have an automated sync mechanism
- **RULE: Never hardcode data that also exists in a JSON source. If you must inline it for performance, automate the sync.**

**Related Files:** `sync_gallery_data.py`, `build.sh`, `gallery.html`

---

### LESSON 002: Duplicate Data Accumulates Silently
**Date:** 2026-02-11
**Category:** `data-integrity` `photos.json` `duplicates`

**Symptom:** photos.json had 479 entries but only 397 unique photos existed. Iceland appeared twice (as "iceland" and "iceland-ring-road" with 67 identical filenames). Grand Teton had 15 duplicate entries with slightly different metadata.

**Root Cause:** No deduplication check in the ingest pipeline. When photos were re-imported or a collection was renamed, old entries were never removed — they just accumulated. The Iceland duplicate happened because the same collection was ingested under two different slug names.

**Fix:** Manual cleanup — removed 67 iceland-ring-road duplicates + 15 Grand Teton duplicates. photos.json went from 479 to 397 entries.

**Prevention:**
- Ingest pipeline should check for existing filename before adding (deduplicate on filename)
- When renaming a collection slug, old entries under the previous slug must be removed
- **RULE: photos.json should be treated as a database — enforce unique constraints on filenames.**

**Related Files:** `data/photos.json`, `05_Studio/app/src/pages/ContentIngest.js`

---

## 2. GALLERY & COVER FLOW

### LESSON 003: Z-Index Wars — Layered UI Needs a Stack Map
**Date:** 2026-02-09 through 2026-02-11
**Category:** `css` `gallery` `z-index` `lightbox`

**Symptom:** Multiple overlapping bugs:
- Lightbox opened behind the gallery grid (invisible)
- Product selector modal blocked clicks after closing
- Back button stopped working after opening lightbox

**Root Cause:** gallery.html has 8+ z-index layers (room, cover flow, info, dots, preview, header, full gallery, lightbox). When new features were added (product selector, cart), they weren't assigned z-index values that fit the existing stack. The product selector modal also wasn't being cleaned up on close, leaving an invisible overlay blocking all clicks.

**Fix:**
1. Established clear z-index stack map (documented in CLAUDE.md)
2. Bumped lightbox to z-index 9999
3. Added stale modal cleanup to both `closeLb()` and `closeFg()` functions

**Prevention:**
- Z-index stack map is documented in CLAUDE.md under "Key Z-Index Stack"
- **RULE: Before adding ANY new overlay/modal/panel to gallery.html, check the z-index stack map. Assign a value that fits the hierarchy.**
- **RULE: Every modal/overlay MUST have cleanup code that removes it from DOM on close. Check for orphaned elements.**

**Related Files:** `gallery.html` (inline CSS + JS)

---

### LESSON 004: Self-Contained Pages Are Fragile but Necessary
**Date:** 2026-02-09
**Category:** `architecture` `gallery` `css`

**Symptom:** Attempted to refactor gallery.html to use external stylesheets, which broke the Cover Flow layout.

**Root Cause:** gallery.html has ~2000 lines of inline CSS and JS that are tightly coupled. The Cover Flow engine relies on precise CSS variable calculations (`covSz()` function), and extracting styles to external files introduced timing issues and cascade conflicts.

**Fix:** Reverted to inline approach. Documented that gallery.html is intentionally self-contained.

**Prevention:**
- gallery.html and licensing.html are self-contained by design
- **RULE: Never extract gallery.html CSS/JS to external files. The tight coupling is intentional for performance and reliability.**
- Shared components (cart, product-selector) are the ONLY external resources loaded

**Related Files:** `gallery.html`, `licensing.html`

---

### LESSON 005: closeFg() Must Mirror closeLb() Cleanup
**Date:** 2026-02-11
**Category:** `gallery` `modal` `cleanup`

**Symptom:** After opening a collection in the full gallery view, viewing a photo in lightbox, then closing back to gallery — the product selector modal was orphaned in DOM, blocking all further clicks. User could not reopen any collection.

**Root Cause:** `closeLb()` (close lightbox) had been fixed to remove orphaned product-selector-modal divs. But `closeFg()` (close full gallery) did NOT have the same cleanup. When a user: opened full gallery → opened lightbox → selected Buy → closed lightbox → closed full gallery — the modal remained.

**Fix:** Added identical stale modal cleanup to `closeFg()`:
```javascript
const staleModal = document.getElementById('product-selector-modal');
if (staleModal) staleModal.remove();
```

**Prevention:**
- **RULE: When you fix cleanup in one close function, check ALL close functions for the same issue.** gallery.html has: `closeLb()`, `closeFg()`, `closePrev()` — all must clean up modals.
- Consider a single `cleanupModals()` utility function that all close handlers call.

**Related Files:** `gallery.html` (inline JS)

---

## 3. E-COMMERCE & CHECKOUT

### LESSON 006: Metadata Must Flow End-to-End (4-Layer Defense)
**Date:** 2026-02-10
**Category:** `e-commerce` `metadata` `stripe` `pictorem`

**Symptom:** Stripe checkout sessions were created with missing Pictorem fulfillment metadata (material code, size, SKU). This would cause order fulfillment to fail silently.

**Root Cause:** Metadata was set in the product selector modal but could be lost at multiple points: cart serialization, checkout session creation, webhook processing. Each layer assumed the previous layer had the complete data.

**Fix:** Implemented 4-layer defense:
1. **cart.js**: Warns when items added without complete metadata
2. **cart-ui.js**: `pictorem` object is never null — falls back to parsing from item properties
3. **create-checkout-session.js**: Server-side validation, warns on missing fields
4. **stripe-webhook.js**: Error response includes `missingFields` array for debugging

**Prevention:**
- **RULE: Any data that must survive from UI → server → external API needs validation at EVERY layer.** Don't trust upstream. Validate and fallback at each step.
- Metadata schema should be defined once and validated consistently

**Related Files:** `js/cart.js`, `js/cart-ui.js`, `functions/api/create-checkout-session.js`, `functions/api/stripe-webhook.js`

---

### LESSON 007: photos.json Wraps in Object, Not Top-Level Array
**Date:** 2026-02-10
**Category:** `data-format` `api` `studio`

**Symptom:** Studio deploy verification step reported "0 photos live" after successful deploy. Website worked fine.

**Root Cause:** Verification code did `Array.isArray(liveData)` — but photos.json wraps data as `{photos: [...]}`. The check passed when photos.json was a bare array (old format) but failed after the format was standardized.

**Fix:** Changed verify to check `liveData?.photos` array instead.

**Prevention:**
- **RULE: Document data format contracts. photos.json is `{photos: [...]}` — ALWAYS access via `.photos` property.**
- When changing data format, grep for ALL consumers and update them

**Related Files:** `data/photos.json`, `05_Studio/app/main.js` (verify handler)

---

## 4. ELECTRON STUDIO APP

### LESSON 008: Preload.js Changes Need Full App Restart
**Date:** 2026-02-11
**Category:** `electron` `studio` `hot-reload`

**Symptom:** After adding new IPC handlers (folder sync APIs), calling them from React threw "window.electronAPI.saveSyncConfig is not a function".

**Root Cause:** Electron's preload script is loaded once when BrowserWindow opens. React hot-reload (Vite/webpack) reloads renderer code but NOT the preload bridge. New `contextBridge.exposeInMainWorld` entries don't appear until full app restart.

**Fix:** User quit Studio (Cmd+Q) and relaunched. New APIs appeared immediately.

**Prevention:**
- **RULE: After modifying preload.js, ALWAYS tell the user to quit and restart Studio.** Hot reload is insufficient.
- Consider adding a version check: preload exports a version number, React checks it on mount and warns if outdated.

**Related Files:** `05_Studio/app/preload.js`, `05_Studio/app/main.js`

---

## 5. DEPLOYMENT & BUILD

### LESSON 009: Build Script Must Be the Single Source of Truth
**Date:** 2026-02-11
**Category:** `deployment` `build` `pipeline`

**Symptom:** Gallery showed stale data because `build.sh` just copied files without any data transformation.

**Root Cause:** The build was a simple file copy (`cp *.html _site/`). No pre-processing, no validation, no sync. This meant any page with derived/generated data could go stale.

**Fix:** Added `sync_gallery_data.py` as a build step. Build script now:
1. Runs sync_gallery_data.py (regenerates gallery.html inline data)
2. THEN copies HTML files to _site/

**Prevention:**
- **RULE: build.sh is the deployment gatekeeper. ANY data transformation must happen IN build.sh, not manually.**
- If a file depends on another file's data, the sync must be automated in the build
- Add a comment in build.sh explaining WHY each step exists

**Related Files:** `build.sh`, `sync_gallery_data.py`

---

### LESSON 010: CDN Caching Hides Bugs
**Date:** 2026-02-09
**Category:** `deployment` `cloudflare` `caching`

**Symptom:** Deployed a fix, verified it was pushed to GitHub, but the live site still showed the old version for 5+ minutes.

**Root Cause:** Cloudflare CDN caches aggressively. HTML and JS files can be served from cache even after GitHub updates the source.

**Prevention:**
- Use `?v=N` cache-buster parameters on JS/CSS file references when testing
- Wait 1-3 minutes after deploy before verifying
- For critical fixes, use Cloudflare dashboard to purge cache
- **RULE: After every deploy, wait 2 minutes, then verify the live site. Don't assume instant propagation.**

**Related Files:** All HTML files (cache-bust params on script/CSS tags)

---

## 6. FILE ORGANIZATION

### LESSON 011: Misspelled Folders Create Silent Duplicates
**Date:** 2026-02-11
**Category:** `file-organization` `naming` `duplicates`

**Symptom:** Found 6 misspelled image folders: `argentinna`, `death-vally`, `flowers-and-leavs`, `lake-powel`, `monument-vally`, `the-valley-of-fire`. Each contained exact duplicates of photos in correctly-named folders.

**Root Cause:** During photo upload, Wolf created folders manually with typos. Studio ingested photos from these misspelled folders, creating duplicate entries. Later, correctly-spelled folders were also created with the same photos.

**Fix:** Moved all misspelled folders to `_files_to_delete/misspelled_dupes/`. Verified all photos exist in correctly-named folders first.

**Prevention:**
- Studio ingest should validate folder names against a whitelist or suggest corrections
- **RULE: Before creating a new collection folder, search for similar existing names. Fuzzy match to catch typos.**
- Consider adding a "collection name validator" to Studio that checks for common misspellings

**Related Files:** `images/` folder structure, `05_Studio/app/src/pages/ContentIngest.js`

---

### LESSON 012: _files_to_delete Is a Safety Net, Not a Trash Can
**Date:** 2026-02-11
**Category:** `file-organization` `safety`

**Symptom:** N/A (preventive pattern)

**Root Cause:** Deleting files from a git repo is irreversible without careful recovery. We needed a staging area for "probably should delete" files.

**Pattern:** Always move files to `_files_to_delete/` with a descriptive subfolder name before actual deletion. This gives Wolf time to verify nothing important is being removed.

**Prevention:**
- **RULE: NEVER delete files directly. Move to `_files_to_delete/{reason}/` first.** Wolf confirms, then we actually remove.
- `_files_to_delete/` is .gitignored so it doesn't bloat the repo

**Related Files:** `_files_to_delete/`, `.gitignore`

---

## 7. PROCESS & WORKFLOW

### LESSON 013: One Change At a Time, Verify, Then Next
**Date:** 2026-02-09
**Category:** `process` `workflow` `CRITICAL`

**Symptom:** Multiple bugs introduced simultaneously made debugging extremely difficult. Couldn't tell which change caused which regression.

**Root Cause:** Making 3-4 changes at once (CSS + JS + data) in gallery.html without verifying between each change.

**Prevention:**
- **RULE: Make ONE change → build → test → verify on live site → THEN next change.** This is in CLAUDE.md Rule #5 for a reason.
- Small commits with descriptive messages help rollback if needed

---

### LESSON 014: Always Count Both Sides of the Data
**Date:** 2026-02-11
**Category:** `process` `verification` `data-integrity`

**Symptom:** Collections appeared to have the right photos but were actually incomplete.

**Root Cause:** Nobody compared disk file count vs. photos.json entry count vs. gallery.html inline count. Each data layer had different numbers.

**Prevention:**
- **RULE: When investigating data issues, count at EVERY layer**: disk files → photos.json → gallery.html inline → website render
- Build a verification script that checks all layers match
- Consider adding a "data integrity check" to the build pipeline

**Related Files:** `data/photos.json`, `gallery.html`, `images/` folders

---

### LESSON 015: Ask "Who Else Consumes This Data?"
**Date:** 2026-02-11
**Category:** `process` `architecture` `data-consumers`

**Symptom:** Fixed photos.json but gallery was still broken (Lesson 001). Fixed closeLb() but closeFg() was still broken (Lesson 005).

**Root Cause:** Only fixing the immediate consumer without checking who else reads/uses the same data or follows the same pattern.

**Prevention:**
- **RULE: When fixing a data source or pattern, grep for ALL consumers.** Fix them all at once.
- When fixing a function, check for sister functions that do the same thing (close handlers, render functions, etc.)

---

### LESSON 016: Inline Styles Override CSS Inheritance (image-protection.js Click Blocker)
**Date:** 2026-02-11
**Category:** `css` `gallery` `lightbox` `image-protection` `CRITICAL`

**Symptom:** After opening a photo → clicking Buy Print → closing the product selector → gallery images could not be clicked. User was completely stuck — no photo in the gallery grid responded to clicks.

**Root Cause:** `image-protection.js` runs a MutationObserver that sets `img.style.pointerEvents = 'auto'` as an **inline style** on ALL images (including `#lb-img` in the lightbox). gallery.html's lightbox `#lb` uses `pointer-events: none` (when closed) + `opacity: 0` at z-index 9999 to hide without removing from DOM. Child elements should inherit `pointer-events: none`, but the inline style from image-protection.js overrode the inheritance — making `#lb-img` an invisible, full-viewport click interceptor at z-index 9999 that caught every click before it reached the gallery grid below.

**Why It Was Hard to Find:** The DOM inspection showed no orphaned modals, no overlays, no visible blocking elements. `#lb` itself had `pointer-events: none`. The bug was that a *child* of a `pointer-events: none` parent had an inline style override — invisible in normal debugging.

**Fix:**
1. Removed `img.style.pointerEvents = 'auto'` from `image-protection.js` — it was unnecessary (images default to `pointer-events: auto`, and the actual protection comes from event listeners for contextmenu/dragstart/touch)
2. Added `document.getElementById('lb-img').style.pointerEvents=''` to `closeLb()` in gallery.html as belt-and-suspenders defense — clears any inline pointer-events when lightbox closes

**Prevention:**
- **RULE: Never set `pointer-events` via inline styles on images.** It overrides CSS inheritance from parent elements that rely on `pointer-events: none` for hiding.
- **RULE: When debugging "clicks don't work," check `document.elementFromPoint(x, y)` — it reveals invisible elements intercepting clicks.**
- Scripts that modify ALL elements via MutationObserver are dangerous — they can override intentional CSS patterns elsewhere

**Related Files:** `js/image-protection.js`, `gallery.html` (inline JS `closeLb()`)

---

### LESSON 017: Separate Content Pipelines for Separate Products
**Date:** 2026-02-12
**Category:** `architecture` `workflow` `licensing` `gallery`

**Symptom:** Gallery contained 44 images from `large-scale-photography-stitch` that duplicated licensing content. Licensing page showed ugly watermarked previews. No clear separation between "gallery prints" and "licensing images."

**Root Cause:** Same images being ingested through two different paths (gallery ingest AND licensing pipeline) without any guard. Watermark approach was designed for security but destroyed the premium look.

**Fix:**
1. Removed `large-scale-photography-stitch` from `photos.json` (397 → 353 photos)
2. Added hardcoded `LICENSING_EXCLUSIONS` to `scan-photography` in main.js — gallery scan auto-skips folders like `Large Scale Photography Stitch` and `Licensing`
3. Replaced visible watermark with multi-layer invisible protection:
   - Server: max 2000px, quality 45, 0.5px blur, EXIF stripped
   - Client: canvas rendering, blob URLs, contextmenu/drag blocked
4. Updated `LicensingManager.js` with Browse button + force-regen option

**Prevention:**
- **RULE: Different products need different ingest pipelines.** Gallery photos → gallery ingest. Licensing images → licensing pipeline. Never mix.
- **RULE: "Protect" doesn't mean "uglify."** Invisible degradation (compression + blur + resolution cap) is more effective than visible watermarks that make your premium art look cheap.

**Related Files:** `data/photos.json`, `05_Studio/app/main.js`, `09_Licensing/generate_watermark.py`, `licensing.html`, `05_Studio/app/src/pages/LicensingManager.js`

---

## APPENDIX: QUICK REFERENCE — TOP RULES

These are the highest-impact prevention rules from above. Print these out.

1. **Never hardcode data that also exists in a JSON source.** If you inline it, automate the sync.
2. **build.sh is the deployment gatekeeper.** ALL transformations happen there.
3. **When fixing one consumer, grep for ALL consumers.** Fix them all.
4. **One change at a time.** Build, test, verify, then next.
5. **Count at every data layer.** Disk → JSON → inline → render must match.
6. **Preload.js changes = full app restart.** Hot reload won't pick them up.
7. **Z-index stack map exists.** Check it before adding overlays.
8. **Modals MUST have cleanup on close.** Check for orphaned DOM elements.
9. **CDN caches for minutes.** Wait before verifying deploys.
10. **Never delete directly.** Stage in `_files_to_delete/` first.
11. **Never set `pointer-events` via inline styles on images.** It overrides CSS inheritance and creates invisible click blockers.
12. **Different products need different ingest pipelines.** Gallery → gallery ingest. Licensing → licensing pipeline. Never mix.
13. **"Protect" doesn't mean "uglify."** Invisible degradation beats visible watermarks for premium content.

---

*This is a living document. Add new lessons as they're discovered. Every bug is a gift — it teaches us something we didn't know.*
