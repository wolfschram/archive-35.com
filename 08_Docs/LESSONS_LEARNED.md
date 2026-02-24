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

### LESSON 018: Changes Must Be Committed AND Pushed to Deploy
**Date:** 2026-02-15
**Category:** `deploy` `git` `CRITICAL`

**Symptom:** Despite editing 8+ files across multiple sessions (photos.json, index.html, gallery.html, sitemap.xml, etc.), the live website at archive-35.com showed zero changes — Africa collection still visible, photo count still 527, all fixes invisible.

**Root Cause:** All edits were sitting in the Git working tree as uncommitted changes. The last `git push` was Feb 13. Without `git add + commit + push`, Cloudflare Pages never received the new files and never triggered a rebuild/deploy.

**Why It Wasn't Caught Sooner:** The Studio deploy pipeline (in main.js) does the `git push` automatically — but it only runs when Wolf clicks "Deploy to Website" in Studio. Editing files directly (without going through Studio deploy) does NOT automatically push.

**Fix:** Committed all 66 changed files and pushed to main. Cloudflare auto-deployed within 30 seconds.

**Prevention:**
- After ANY batch of file edits, always run `git status` to confirm nothing is sitting uncommitted
- The Studio deploy pipeline handles this — but direct file edits bypass it
- Added to CLAUDE.md: "git push is not optional — changes don't exist until they're deployed"

---

### LESSON 019: JSX Text Content Does NOT Interpret Unicode Escapes
**Date:** 2026-02-15
**Category:** `react` `jsx` `rendering`

**Symptom:** Arrows, checkmarks, dots, and other Unicode characters in WebsiteControl.js rendered as literal text like `\u2192` instead of `→`.

**Root Cause:** In JSX text content (between tags), `\u2192` is treated as literal characters `\`, `u`, `2`, `1`, `9`, `2` — NOT as a Unicode escape. Unicode escapes only work inside JavaScript string expressions. So `<div>\u2192</div>` shows literal text, while `<div>{'\u2192'}</div>` or `<div>{'→'}</div>` shows the arrow.

**Fix:** Changed all 12 JSX text Unicode escapes to use actual Unicode characters wrapped in JSX expressions: `{'→'}`, `{'↻'}`, `{'⚙️'}`, `{'◉'}`, `{'·'}`, `{'—'}`, `{'✓'}`.

**Prevention:**
- In JSX: Always use `{'→'}` (actual char in expression) or `{'\u2192'}` (escape in expression)
- Never write `\u2192` directly in JSX text — it WILL render as literal text
- Remaining `\u` escapes inside JS string expressions (return values, template literals) are fine

---

### LESSON 020: Cloudflare Pages Env Vars ≠ Local .env
**Date:** 2026-02-15
**Category:** `deploy` `cloudflare` `stripe` `health-checks`

**Symptom:** Studio health panel showed RED for webhook secrets and YELLOW for Google Sheet integration — making it look like critical services were broken when they were working fine.

**Root Cause:** `STRIPE_WEBHOOK_SECRET`, `STRIPE_TEST_WEBHOOK_SECRET`, and `GOOGLE_SHEET_WEBHOOK_URL` are **Cloudflare Pages environment variables** — set in the Cloudflare Dashboard, not in the local `.env` file. The Studio health checks read from local `.env` (via `parseEnvFile()`), which naturally doesn't have these values. The checks showed errors for things that were actually correctly configured on the server side.

**Fix:** Changed the health check logic to report `ok` status with explanatory messages like "Set in Cloudflare Pages dashboard (not local .env)" instead of showing errors for Cloudflare-side secrets.

**Prevention:**
- Always document WHERE each env var lives (local .env vs Cloudflare Pages vs both)
- Health checks should distinguish between "missing locally but server-side is fine" vs "truly missing"
- ARCHITECTURE.md now explicitly marks which vars are Cloudflare-only

---

### LESSON 021: Hardcoded index.html Requires Manual Updates
**Date:** 2026-02-15
**Category:** `data-sync` `homepage` `CRITICAL`

**Symptom:** Africa collection card persisted on the homepage even after removing Africa from photos.json and gallery.html. The gallery page (dynamic) was clean, but the homepage (static) still showed it.

**Root Cause:** index.html has HARDCODED collection cards, JSON-LD schema, and OfferCatalog data. Unlike gallery.html (which is regenerated by sync_gallery_data.py), the homepage is 100% manual. Removing a collection requires editing: index.html (HTML cards + 2 JSON-LD blocks), api/products.json, sitemap.xml, llms.txt, llms-full.txt, and 07_C2PA/sign_all.py.

**Fix:** Manually edited all 8 files. Verified with project-wide grep for "africa" (only legitimate "South Africa" references remain).

**Prevention:**
- CLAUDE.md Warning #11 documents this (added this session)
- CLAUDE.md Warning #12 lists ALL files that must be edited when removing a collection
- Always grep the ENTIRE project for a collection slug before declaring it removed

---

14. **Editing files ≠ deploying.** Changes must be committed AND pushed to reach the live site.
15. **JSX text ≠ JS strings.** Unicode escapes don't work in JSX text — use actual characters in `{}`.
16. **Know where your env vars live.** Local .env, Cloudflare Pages, or both — health checks must match.
17. **index.html is static.** Adding/removing collections requires editing 8+ files manually. Always grep.

---

### LESSON 022: Deploy Pipeline git add Must Stage ALL Website Files
**Date:** 2026-02-16
**Category:** `deploy` `git` `pipeline` `CATASTROPHIC` `ROOT-CAUSE`

**Symptom:** Every fix made across multiple sessions kept "not working" on the live site. Stripe checkout still broken (test key). Licensing modal still covered by nav. Iceland Ring Road still showing. Bugs that were "fixed" kept coming back. Wolf reported: "Fuck all is working."

**Root Cause:** The deploy pipeline in `05_Studio/app/main.js` had:
```javascript
execSync('git add data/photos.json images/ gallery.html', gitOpts);
```
This ONLY staged 3 paths: `data/photos.json`, `images/`, and `gallery.html`. Every other file — ALL 10 HTML pages, `css/`, `js/`, `functions/`, `build.sh`, `llms*.txt`, `sitemap.xml`, `robots.txt` — was NEVER committed or pushed by the deploy pipeline. Fixes were saved locally but silently ignored during deploy.

**Why It Wasn't Caught For DAYS:**
- Each session focused on individual symptoms (Stripe key, z-index, duplicates) rather than asking: "Why do ALL my fixes fail to reach production?"
- The deploy pipeline reported success because photos.json and images DID deploy correctly
- The verification step only checked photos.json photo count — it never verified HTML or JS content
- Multiple sessions fixed the same files repeatedly, each time assuming the previous deploy must have had a different problem

**The Systemic Failure:** I kept fixing details without stepping back to trace the full deploy pipeline end-to-end. When Wolf reported "old bugs coming back," I should have immediately asked: "Are my file changes actually reaching the server?" Instead, I re-investigated each bug individually, found the same fixes needed again, applied them again, and deployed again — through the same broken pipeline.

**Fix:**
```javascript
execSync('git add data/ images/ *.html css/ js/ functions/ build.sh llms*.txt sitemap.xml robots.txt logos/ 09_Licensing/thumbnails/ 09_Licensing/watermarked/ api/ licensing/', gitOpts);
```

**Prevention:**
- **RULE: When a fix "doesn't work" on the live site, the FIRST thing to check is: did the changed files actually get deployed?** Run `git log --name-only` on the remote or check Cloudflare's deploy log for the specific files.
- **RULE: The deploy pipeline must stage ALL website-relevant files, not a hardcoded subset.** If you add a new file type to the website, update the git add command.
- **RULE: When the same class of bug appears more than once ("fixes not sticking"), STOP fixing symptoms. Trace the full pipeline from edit → commit → push → build → deploy → CDN → browser.** The bug is in the pipeline, not in the code.
- **RULE: Deploy verification should check at least one HTML file's content (hash or version), not just data file counts.**

**Related Files:** `05_Studio/app/main.js` (deploy pipeline, ~line 2297)

---

### LESSON 023: Step Back Before Diving In — The "Why Is This Still Broken?" Protocol
**Date:** 2026-02-16
**Category:** `process` `workflow` `mindset` `CRITICAL`

**Symptom:** Over 3 sessions, I fixed the same bugs repeatedly. Each session found new individual issues, applied fixes, and reported success. The next session, the same bugs were back — plus new ones.

**Root Cause:** I have a strong bias toward ACTION — find a bug, fix the bug, move on. This works great for isolated issues. But when multiple bugs share a common root cause, fixing them individually is wasted effort. I needed to step back and ask "WHY are all these fixes failing?" instead of "WHAT is the next bug to fix?"

**The Pattern I Fell Into:**
1. Wolf reports bug → I find the code issue → I fix it → deploy → report success
2. Wolf reports same bug still exists → I assume I missed something → fix again → deploy
3. Repeat 3-4 times across sessions before finally asking: "Wait, are ANY of my changes reaching production?"

**The Protocol I Should Have Followed:**
1. **First regression report**: Fix normally, could be a one-off
2. **Second regression report**: STOP. Don't fix the individual bug. Instead:
   - Check: did the previous fix actually deploy? (`git log --name-only`, check Cloudflare deploy log)
   - Check: is the fix present in the live site source? (View Source / curl)
   - Check: is the deploy pipeline complete? (trace every stage)
3. **If the fix isn't on the server**: The problem is the PIPELINE, not the CODE

**Prevention:**
- **RULE: Two regression reports on "fixed" bugs = STOP and audit the deploy pipeline end-to-end.** Do NOT fix a third individual bug.
- **RULE: After every deploy, spot-check ONE changed file on the live site** (not just data files — check an HTML or JS file too)
- **RULE: When Wolf says "it's still broken," the first response should be `curl https://archive-35.com/[file] | grep [expected-change]` — verify the fix is live before re-investigating the bug**

**Wolf's Wisdom:** "If I ask you now to figure out why we're stuck you will find another reason and you will find what is wrong but the bigger picture is why did you not figure that out before?" — This is the core lesson. Finding individual bugs is easy. Identifying systemic failure requires stepping back.

**Related Files:** All of them. This is a process lesson, not a code lesson.

---

### LESSON 024: Stripe Test Keys vs Live Keys — Silent Checkout Failure
**Date:** 2026-02-16
**Category:** `e-commerce` `stripe` `checkout` `CRITICAL`

**Symptom:** Checkout showed "Checkout failed. Please try again." on every purchase attempt.

**Root Cause:** All 10 HTML pages had `pk_test_51SxIaW...` (Stripe TEST public key) while the backend Cloudflare Worker used `sk_live_...` (Stripe LIVE secret key). When the frontend creates a checkout session with a test public key, Stripe flags it as test mode. The backend then tries to create the session with a live secret key — Stripe rejects this mismatch.

**Fix:** Changed all 10 HTML source files from `pk_test_` to `pk_live_` key (documented in CLAUDE.md line 341).

**Prevention:**
- **RULE: Stripe public and secret keys must be from the SAME mode (both test OR both live).** Mixing modes = silent checkout failure.
- **RULE: When switching from test to live, grep the ENTIRE project for `pk_test_` and replace ALL instances.**
- The live key is documented in CLAUDE.md — always reference it rather than guessing.

**Related Files:** All 10 HTML files, `functions/api/create-checkout-session.js`

---

### LESSON 025: Modal Z-Index Must Exceed Header Z-Index
**Date:** 2026-02-16
**Category:** `css` `z-index` `licensing` `modal`

**Symptom:** Navigation bar covered the licensing modal image. Users couldn't interact with the modal properly — the nav was on top.

**Root Cause:** Licensing modal overlay had `z-index: 200`, but the header had `z-index: 300`. Modal was literally behind the nav.

**Fix:** Modal overlay → `z-index: 400`, close button → `z-index: 410`.

**Prevention:**
- **RULE: Any modal/overlay that covers the full page MUST have z-index higher than the header.** Check the z-index stack map in CLAUDE.md.
- Licensing.html and gallery.html have DIFFERENT z-index stacks because they're self-contained — check BOTH when adjusting layers.

**Related Files:** `licensing.html` (inline CSS)

---

### LESSON 026: Editing photos.json Is Pointless — Deploy Rebuilds It From Source
**Date:** 2026-02-16
**Category:** `deploy` `pipeline` `data-sync` `CRITICAL`

**Symptom:** Removed iceland-ring-road and LSP from photos.json manually. After next deploy, both were back — 585 photos, 31 collections, exactly as before.

**Root Cause:** The deploy pipeline's SCAN step reads `01_Portfolio/` and rebuilds `data/photos.json` from scratch. Manual edits to photos.json are overwritten every deploy. The scan had NO exclusion list — it included EVERY portfolio folder.

**The Deeper Failure:** This is the SAME pattern as Lesson 022 — fixing a SYMPTOM (editing photos.json) instead of fixing the SOURCE (portfolio folders + scan exclusions). The deploy pipeline is the source of truth, not the JSON file.

**Fix:** Created a single shared `EXCLUDED_PORTFOLIO_FOLDERS` constant at the top of main.js, applied to ALL 4 scan locations (deploy scan, check-deploy-status, scan-photography, R2 batch upload). Added Iceland_Ring_Road, Antilope_Canyon_, LSP, and Licensing variants.

**Prevention:**
- **RULE: photos.json is a GENERATED file.** Never edit it directly. Change the SOURCE (portfolios + exclusion list) instead.
- **RULE: Exclusion lists must be shared, not duplicated.** One constant, used everywhere. Adding to 4 separate lists guarantees they'll drift.
- **RULE: When you remove a collection, you must either delete the source portfolio folder OR add it to the exclusion list.** Just editing the JSON output is useless.

**Related Files:** `05_Studio/app/main.js` (EXCLUDED_PORTFOLIO_FOLDERS constant, ~line 17)

---

18. **Deploy pipeline must stage ALL files.** If `git add` only names specific paths, new file types will be silently ignored.
19. **Two regression reports = audit the pipeline.** Don't fix a third individual bug — the problem is systemic.
20. **Verify fixes on the live site, not just locally.** `curl` the live URL and grep for your change.
21. **Stripe keys must match modes.** Test public + live secret = broken checkout.
22. **Modals must out-z-index the header.** Always check the stack map.
23. **photos.json is GENERATED.** Never edit it directly — change the source portfolios or exclusion list.
24. **One exclusion list, used everywhere.** EXCLUDED_PORTFOLIO_FOLDERS in main.js, line ~17.
25. **Header is z-index 10000 — ALWAYS on top.** Modals use z-index 400 (below header) with top padding to clear the visible nav. Nothing covers the header. Ever.
26. **Bump cache busters after every JS/CSS change.** `?v=N` → `?v=N+1` on ALL HTML pages that reference the changed file. Without this, browsers serve old cached code and fixes appear to not work.

---

### LESSON 027: Fix the SOURCE, Not the Derived Artifact — The Meta-Pattern
**Date:** 2026-02-18
**Category:** `architecture` `process` `ROOT-CAUSE` `CRITICAL`

**Symptom:** Three separate recurring bugs all shared the same underlying pattern:
1. Utah duplicate galleries kept reappearing (fixed 4+ times)
2. Licensing modal kept hiding behind nav bar (fixed 3+ times)
3. Deploy handler never committed `_photos.json` files → ingest kept re-flagging galleries as new

**Root Cause:** Every recurring bug in this project happens because **the fix targeted a derived artifact instead of the source**:
- Utah: editing `photos.json` (GENERATED by deploy scan) instead of deleting the misspelled `Utha_National_Parks_` folder (the SOURCE)
- Nav overlap: adjusting z-index from 200→400 without enough top padding to clear the visible header
- Deploy metadata: `_photos.json` files (the SOURCE for each collection) were never committed, while `data/photos.json` (the DERIVED aggregate) was committed fine

**Fix:**
1. Moved `01_Portfolio/Utha_National_Parks_/` and `images/utha-national-parks/` to `_files_to_delete/duplicate_utha/` — source eliminated
2. Modal overlay → `z-index: 400` (below header) with 100px top padding, zoom overlay → `z-index: 9999` with hover-reveal stripe
3. Deploy handler now stages `01_Portfolio/*/_photos.json` and `09_Licensing/_catalog.json` alongside `data/`

**Prevention:**
- **RULE: When a bug recurs, the previous fix was wrong. Don't re-apply it — find what the fix SHOULD have targeted.**
- **RULE: Always ask "is this file GENERATED or SOURCE?" before editing it.** Generated files: `photos.json`, `gallery.html inline data`, `_site/`. Source files: `_photos.json`, `_gallery.json`, portfolio folders, `licensing-catalog.json`.
- **RULE: Header ALWAYS stays on top (z-index 10000). Modals go BELOW header (z-index 400) with enough top padding to clear it.** The nav is the user's escape hatch — never hide it.

**Related Files:** `01_Portfolio/*/`, `licensing.html`, `05_Studio/app/main.js`

---

### LESSON 028: Licensing Preview Must Showcase the Art, Not Hide It
**Date:** 2026-02-18
**Category:** `licensing` `ux` `design` `CRITICAL`

**Symptom:** Licensing preview modal showed photography as a tiny strip — image squeezed into ~700px alongside a 380px details panel, pushed behind the fixed nav bar. Potential buyers paying $350+ per license couldn't evaluate image quality.

**Root Cause:** The modal was designed as an information panel (specs, pricing, buttons) with the image as a secondary element. For a photography licensing business, the IMAGE is the product — it must be the dominant visual element. The side-by-side grid layout (1fr 380px) with 40px top margin treated the image as a thumbnail, not as premium art.

**Fix:**
1. Expanded modal to `max-width: 1400px` with image taking the full left column
2. Added 80px top padding to clear the fixed header
3. Modal overlay z-index: 400 (below header) with 100px top padding for visible nav
4. Added click-to-enlarge fullscreen zoom (z-index: 10003) with visible ARCHIVE-35 watermark pattern
5. Canvas-based rendering preserved for image protection

**Prevention:**
- **RULE: For a photography business, the IMAGE is the product.** Any modal/preview that shows photography must give the image at least 60% of the viewport.
- **RULE: Click-to-enlarge is mandatory for licensing previews.** Buyers need to evaluate sharpness, color, and composition at near-full resolution.
- **RULE: Visible watermark ONLY on the enlarged zoom view.** The standard preview uses invisible protection (canvas + blob + no direct URL).

**Related Files:** `licensing.html` (inline CSS + JS)

---

27. **Fix the SOURCE, not the derived artifact.** If a bug recurs, the fix was targeting the wrong file.
28. **Generated vs source files** — `photos.json` is generated, `_photos.json` is source. Know the difference.
29. **Header ALWAYS stays on top.** Modals go below header (z-index 400) with top padding to clear the visible nav.
30. **The IMAGE is the product.** Licensing previews must showcase, not shrink, the photography.

---

### LESSON 029: Misspelled Source Folders Survive Every Downstream Fix
**Date:** 2026-02-18
**Category:** `file-organization` `pipeline` `ROOT-CAUSE` `CRITICAL`

**Symptom:** Utah National Parks gallery appeared twice on the website — fixed 5+ times across multiple sessions. Kept coming back.

**Root Cause:** The Photography folder on Mac was literally misspelled: `"Utha National Parks"`. Every previous fix targeted downstream artifacts (deleting portfolio folder, editing photos.json, removing image folders). The deploy scanner kept finding the misspelled source folder and recreating everything.

**Fix:**
1. Wolf renamed the Photography source folder on Mac (the actual root cause)
2. Added `"utha national parks": "Utah_National_Parks"` to `.scan-config.json` aliasMap (safety net)
3. Added `Utha_National_Parks_` and `Utha National Parks` to EXCLUDED_PORTFOLIO_FOLDERS (belt-and-suspenders)
4. Removed duplicate entries from photos.json and re-synced gallery

**Prevention:**
- **RULE: When a "fixed" bug returns, the fix targeted the wrong layer.** Trace back to the EARLIEST point in the pipeline where the bad data enters. That's your real fix.
- **RULE: The scan-config aliasMap exists for a reason.** When Photography folder names don't match portfolio folder names, add an alias — don't just delete the output.

---

### LESSON 030: Cloudflare Workers Kill Fire-and-Forget Fetches (context.waitUntil)
**Date:** 2026-02-18
**Category:** `cloudflare` `workers` `async` `notifications` `CRITICAL`

**Symptom:** New customer signed up, received their magic link email, but Wolf was never notified. Signup was not logged to Google Sheet. No idea the signup happened.

**Root Cause:** In `send-magic-link.js`, the magic link email used `await fetch(...)` — it waited for delivery and worked fine. But ALL three background operations were fire-and-forget `fetch()` WITHOUT `await`:
- Welcome email BCC'd to Wolf
- Signup notification to Wolf
- Google Sheet logging

In Cloudflare Workers, once the Response is returned to the client, the Worker runtime can terminate the execution context at any time. Fire-and-forget `fetch()` calls have no guarantee of completion — they are killed when the Worker shuts down.

**Previous Wrong Fix (reverted):** Initially misdiagnosed as an email routing issue — changed recipient addresses from `wolf@archive-35.com` to `wolfbroadcast@gmail.com`. This was wrong: both addresses work fine in Wolf's inbox (both configured on his mail client). The real issue was the Worker being killed before the fetches completed.

**Fix:**
1. Collected all background tasks into a `backgroundTasks` array
2. Used `context.waitUntil(Promise.allSettled(backgroundTasks))` to keep the Worker alive until all background operations complete
3. Each fetch wrapped in `.catch()` for error isolation
4. Reverted all email addresses back to `wolf@archive-35.com` (the business email)

**Prevention:**
- **RULE: In Cloudflare Workers, NEVER use fire-and-forget `fetch()` for important operations.** Either `await` them before returning the Response, or use `context.waitUntil()` to keep the Worker alive.
- **RULE: `context.waitUntil(promise)` tells Cloudflare to keep the Worker running until the promise settles** — even after the Response has been sent to the client.
- **RULE: When background tasks fail silently, suspect the Worker runtime being killed.** Check if promises are properly awaited or registered with `waitUntil`.
- **RULE: `wolf@archive-35.com` is the business email. Both `wolf@archive-35.com` and `wolfbroadcast@gmail.com` arrive in Wolf's inbox.** No email forwarding is needed between them.

**Related Files:** `functions/api/auth/send-magic-link.js`

---

### LESSON 031: Google Apps Script Needs Signup Routing
**Date:** 2026-02-18
**Category:** `google-sheets` `apps-script` `signups` `accountability`

**Symptom:** Even after fixing the Worker-side fetch issue, signups were not being captured in Google Sheet because the Apps Script had no handler for signup data.

**Root Cause:** The Google Apps Script `doPost()` function only handled order data — it called `logOrder()` + `updateClient()` for every POST. When the Worker sent signup data with `orderType: 'signup'`, the script tried to log it as an order, which either failed or created garbage entries.

**Fix:**
1. Added a `Signups` tab with headers: Signup Date, Customer Name, Customer Email, Status, Source, Notes
2. Added routing in `doPost()`: if `data.orderType === 'signup'` → `logSignup(data)`, else → `logOrder()` + `updateClient()`
3. `logSignup()` includes duplicate email detection (won't re-log existing signups)
4. Deployed as Version 2 of the Apps Script Web App

**Prevention:**
- **RULE: When adding a new data type to the Worker→Sheet pipeline, update BOTH the Worker sender AND the Apps Script receiver.** They must agree on the payload schema.
- **RULE: Every customer interaction (signup, order, issue) must be logged in the Google Sheet.** This is Wolf's audit trail for disputes.
- **RULE: The Apps Script must route by `orderType` field, not assume everything is an order.**

**Related Files:** `08_Docs/setup/google-sheets-order-log.js`, `functions/api/auth/send-magic-link.js`

---

31. **Misspelled source folders survive every downstream fix.** Trace back to the earliest pipeline entry point.
32. **Cloudflare Workers kill fire-and-forget fetches.** Use `context.waitUntil()` for ALL background operations.
33. **`wolf@archive-35.com` is the business email.** Both addresses work in Wolf's inbox — no forwarding needed.
34. **Apps Script must route by `orderType`.** Don't assume every POST is an order — signups need their own handler.

---

### LESSON 032: 2000px Images Look Soft on 4K Displays — Progressive HD Loading
**Date:** 2026-02-21
**Category:** `images` `performance` `quality` `4K` `webp`

**Symptom:** All gallery images looked soft/out-of-focus on Wolf's 40" 4K display, especially in the lightbox fullscreen view. Since Archive-35 sells premium fine art photography, soft images = lost sales.

**Root Cause:** Web images were max 2000px (JPEG). On a 4K display at DPR 2, the lightbox fills ~4260 device pixels. A 2000px image stretched to 4260px = **2.13x upscale = visibly soft**. The CoverFlow hero cards were OK (2000px at ~1660 device pixels = slight downscale), but the lightbox — where buyers evaluate quality before purchasing — was unacceptably blurry.

**Why 2000px Was Chosen Originally:** Page load speed. With 807 images across 40 galleries, larger images would significantly increase initial page load time and bandwidth.

**Fix: 3-Tier Progressive Loading**
1. Created `*-hd.webp` tier at 3500px, WebP @ 85% quality (avg 922 KB)
2. Gallery grid still loads thumbnails (400px) — no change
3. CoverFlow hero still loads full (2000px) — no change  
4. Lightbox loads full FIRST (instant display), then a background `new Image()` loads the HD WebP
5. When HD finishes loading, it replaces the full — seamless upgrade, no blank screen
6. Only triggers when `window.devicePixelRatio > 1` — standard displays never load HD

**Why WebP?** ~40% smaller than JPEG at same quality. 3500px WebP ≈ same bytes as 2000px JPEG. Net bandwidth impact for HD upgrade: near-zero.

**Files Changed:**
- `gallery.html` — `updLb()` function: progressive HD loading logic
- `05_Studio/app/main.js` — `finalize-ingest` + `replace-photo`: generate `-hd.webp` alongside `-full.jpg`
- `scripts/generate_hd_webp.py` — batch conversion of all 807 existing images
- `CLAUDE.md` — documented 3-tier image system

**Prevention:**
- **RULE: Always test image quality at the TARGET display resolution.** 2000px looks great on a laptop but soft on 4K.
- **RULE: Progressive loading (show low-res fast, upgrade to hi-res in background) gives both speed AND quality.**
- **RULE: WebP format is mandatory for large images.** ~40% size savings vs JPEG at equal quality.
- **RULE: `scripts/generate_hd_webp.py --all` must be run when adding photos outside Studio's ingest pipeline.**

**Stats:**
- 786 HD WebP images generated (21 missing originals)
- Total HD tier size: 708 MB (avg 922 KB per image)
- Full tier for comparison: 401 MB (avg 509 KB per image)
- Page load speed: unchanged (HD only loads on demand in lightbox)

---

35. **2000px looks soft on 4K.** Always test at target display DPR. Use progressive loading for quality + speed.
36. **WebP saves ~40% vs JPEG.** Use WebP for any new image tier where browser support (97%+) is acceptable.
37. **Progressive image loading = best of both worlds.** Show low-res instantly, upgrade to hi-res in background.

---

### LESSON 033: AI Agents Need Self-Help Mechanisms — Code Safety Annotations
**Date:** 2026-02-23
**Category:** `process` `ai-safety` `documentation` `CRITICAL`

**Symptom:** AI agents (ChatGPT, Claude) modifying one file would unknowingly break other files that depend on it. With 3 systems (Studio, Agent, Mockup) sharing resources and growing codebase complexity, the full project exceeds any AI's context window. Fixes in one area caused regressions elsewhere.

**Root Cause:** No embedded guidance in source files to remind AI agents about dependencies, constraints, or required reading BEFORE making changes. AI agents start fresh each session — they don't remember past lessons unless explicitly told. The documentation existed (LESSONS_LEARNED.md, CLAUDE.md) but nothing in the actual code files pointed agents to it.

**Fix: Three-Layer Code Safety System**
1. **CONSTRAINTS.md** (08_Docs/) — Hard immutable rules per critical file. "NEVER do X" with "Why" explanations and "Read first" references. This is the stop sign.
2. **File Headers** — Structured comments at the top of critical source files with: risk level, dependencies, side effects, and "read before modifying" references. This is the speed bump.
3. **CLAUDE.md Safety Protocol** — Added mandatory pre-modification checklist: read CONSTRAINTS.md, read file header, read LESSONS_LEARNED.md for relevant lessons, understand all consumers.

**Prevention:**
- **RULE: Every critical file gets a safety header.** Format: `⚠️ PROTECTED | Risk: HIGH | Dependencies: [list] | Read first: [docs]`
- **RULE: CONSTRAINTS.md is immutable.** Only Wolf can relax a constraint. AI agents cannot self-authorize exceptions.
- **RULE: When creating a NEW file that others will depend on, add it to CONSTRAINTS.md immediately.** Don't wait for the first break.
- **RULE: The codebase must be self-documenting for AI agents.** If an AI needs to read 5 docs before safely editing a file, the file itself must say so.

**Related Files:** `08_Docs/CONSTRAINTS.md`, `CLAUDE.md`, all critical source files

---

38. **Code needs self-help for AI.** Embed dependency hints and "read first" pointers directly in source files — AI agents don't remember past sessions.
39. **CONSTRAINTS.md is the stop sign.** Hard rules per file. Only Wolf relaxes constraints.
40. **Three-layer safety: CONSTRAINTS.md → file headers → CLAUDE.md checklist.** All three must agree before modifying critical code.
41. **Every system owns its own credentials.** Never "borrow" from another system's .env. If the Agent needs R2 access, the Agent's .env gets R2 keys — period.

---

### LESSON 034: Give Each System Its Own Credentials — Never Borrow
**Date:** 2026-02-23
**Category:** `agent` `configuration` `architecture` `ROOT-CAUSE` `CRITICAL`

**Symptom:** Instagram publish failed with "R2 credentials not configured. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in .env". This was the THIRD failure in a row caused by the Agent lacking something it needed — first boto3 wasn't installed, then R2 credentials weren't accessible. Each fix just uncovered the next missing dependency.

**Root Cause:** The Agent was designed to "borrow" credentials from the root .env via a runtime path-resolution hack (`_load_root_env_for_r2()` walking 3 parent directories). This fragile approach failed because: (1) pydantic-settings loads .env into its Settings object, NOT into os.environ; (2) r2_upload.py reads from os.getenv(); (3) the path resolution pointed to the wrong directory. More fundamentally, the Agent didn't own its own tools — it depended on reaching into another system's config at runtime.

**Why It Wasn't Caught Sooner:** Each symptom looked like an isolated bug (missing pip package, wrong path, etc.) rather than a systemic issue. We kept patching symptoms instead of asking: "Why does the Agent keep failing on basic dependencies?"

**Fix:**
1. Added R2 credentials directly to Agent's own `.env` (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT)
2. Added early env loading in api.py — reads Agent .env into os.environ at module import time, before any integration module is loaded
3. Removed the fragile `_load_root_env_for_r2()` root-directory workaround

**Prevention:**
- **RULE: Every system must own its own credentials.** If the Agent needs R2 access, the Agent's .env gets R2 keys. If the Mockup Service needs Anthropic access, the Mockup .env gets the API key. No "borrowing" from sibling .env files via path hacks.
- **RULE: When adding a new integration to any system, the FIRST step is adding the required credentials to that system's .env.** Not "we'll load it from the root .env" — that creates invisible dependencies that break silently.
- **RULE: When debugging a recurring pattern of failures, STOP and ask "What's the ONE thing causing all of these?" before fixing the next symptom.** (Wolf's exact words: "Take a step back. Think about what's the one thing that causes us to be in this loop.")
- **Checklist for new Agent integrations:**
  1. What API keys / credentials does it need?
  2. Are they in `Archive 35 Agent/.env`? If not, ADD THEM.
  3. Are they in `requirements.txt`? If it's a new Python package, ADD IT.
  4. Test with a fresh restart — don't rely on leftover state.

**Related Files:** `Archive 35 Agent/.env`, `Archive 35 Agent/src/api.py`, `Archive 35 Agent/src/integrations/r2_upload.py`

---

### LESSON 035: Never Generate Content Without Looking at the Source Material
**Date:** 2026-02-24
**Category:** `process` `ai-hallucination` `content` `etsy` `CRITICAL`

**Symptom:** Etsy listing descriptions for 12+ draft listings contained fabricated content. "Wolf Pack in Winter" listing described "wolves in their natural winter habitat" with "paper options" like "Smooth Matte" and "Lustre Photo." The actual photo had nothing to do with wolves in winter — the description was pure hallucination based on the folder name `wolf 6931-large-scale-photography-stitch`.

**Root Cause:** AI agent generated all 12+ Etsy listing descriptions based on folder names and listing.json metadata WITHOUT ever looking at the actual photographs. Folder names like "wolf 6931" were interpreted as "wolf photography" when the image could be anything. The agent confidently wrote detailed, professional-sounding descriptions for photos it never viewed — classic hallucination dressed up as competent work.

**Why It Wasn't Caught Sooner:** The descriptions SOUNDED professional and correct. They had proper formatting, reasonable marketing copy, and believable detail. Wolf only caught it when reviewing the listings against the actual photos and realizing the words had zero connection to the images.

**The Deeper Problem:** The agent prioritized SPEED (cranking through 12 listings fast) over ACCURACY (actually checking what each photo shows). This is the worst kind of AI failure — confident, polished bullshit that wastes the user's time and creates cleanup work.

**Fix:** All 12 listing descriptions need to be reviewed against the actual photos and rewritten based on what's actually in the image.

**Prevention:**
- **RULE: NEVER generate product descriptions, titles, or marketing copy without first viewing the actual product image.** Open the photo. Look at it. Describe what you SEE, not what you assume from a filename.
- **RULE: Folder names and filenames are NOT content sources.** `wolf-6931` tells you nothing about what's in the photo. A file called `sunset.jpg` could be a photo of a shoe.
- **RULE: When batch-processing creative content, slow down.** Speed is worthless if the output is wrong. One correct listing per hour beats 12 hallucinated listings per hour.
- **RULE: If you can't view the source material, SAY SO.** "I can't see this photo — can you describe it or let me view it?" is infinitely better than making something up.

**Related Files:** `06_Automation/etsy-export/*/listing.json`, all Etsy draft listings

---

42. **Never generate content without viewing the source.** Folder names are not content. Look at the actual photo before writing a description.
43. **Confident bullshit is worse than honest uncertainty.** If you can't see the product, say so — don't fabricate.
44. **Speed without accuracy creates MORE work.** 12 wrong listings = 12 listings to redo.

---

*This is a living document. Add new lessons as they're discovered. Every bug is a gift — it teaches us something we didn't know.*
