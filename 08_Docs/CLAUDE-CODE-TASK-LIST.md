# Archive-35 — Complete Claude Code Task List

**37 Tasks | Studio + Agent + Cloudflare Functions | Everything Must Work**

Execute in order. Verify after EACH task. Do not skip ahead. Do not ship broken things.

> **STATUS (March 19 evening):** Tasks 1-9, 16-28, 30-34 DONE. Tasks 10-15 need finishing (KV bindings now configured). Tasks 35-37 are NEW from UI audit.

---

## Read These Files First

- `CLAUDE.md` — Project overview, stack, mandatory behavioral rules
- `08_Docs/LESSONS-LEARNED-2026-03-19.md` — 20 lessons, what not to repeat
- `.claude/agents/safe-catalog-editor.md` — Two-catalog architecture rules
- `08_Docs/CRITICAL-FIXES-HANDOFF.md` — Detailed specs for critical fixes
- `08_Docs/MICRO-CHECKOUT-HANDOFF.md` — Cart, credits, AI agent batch specs
- `08_Docs/STUDIO-HANDOFF.md` — Studio upload workflow (5 image versions)

---

## Master Task Table — 34 Tasks

**Red = Critical | Orange = Warning | Teal = Polish**

| # | Severity | Task | File(s) |
|---|----------|------|---------|
| 1 | 🔴 CRITICAL | Create missing serve.js endpoint | `functions/api/micro-license/serve.js` |
| 2 | 🔴 CRITICAL | Etsy token auto-refresh (scheduler) | `scheduler.py` |
| 3 | 🔴 CRITICAL | Etsy token guard on all API calls | `etsy.py`, `src/routes/etsy_*.py` |
| 4 | 🔴 CRITICAL | Credits storage on purchase | `stripe-webhook.js` |
| 5 | 🔴 CRITICAL | Credits balance endpoint | `functions/api/credits/balance.js` |
| 6 | 🔴 CRITICAL | Credits redeem endpoint | `functions/api/credits/redeem.js` |
| 7 | 🔴 CRITICAL | Webhook signature verification | `stripe-webhook.js` |
| 8 | 🔴 CRITICAL | R2 upload error handling | `r2_upload.py` |
| 9 | 🟠 WARNING | Wire cart into micro-licensing page | `micro-licensing.html`, `js/cart.js` |
| 10 | 🟠 WARNING | Multi-item micro Stripe checkout | `functions/api/micro-license/checkout.js` |
| 11 | 🟠 WARNING | Cart UI on micro-licensing page | `micro-licensing.html`, `js/cart-ui.js` |
| 12 | 🟠 WARNING | Credit redemption flow in cart | `micro-licensing.html`, `js/cart.js` |
| 13 | 🟠 WARNING | AI agent batch purchase endpoint | `functions/api/micro-license/batch.js` |
| 14 | 🟠 WARNING | Agent batch + x402 integration | `functions/api/micro-license/batch.js` |
| 15 | 🟠 WARNING | Batch download (zip) endpoint | `functions/api/micro-license/batch-download.js` |
| 16 | 🟠 WARNING | Instagram token auto-refresh | `scheduler.py` |
| 17 | 🟠 WARNING | Pinterest access tier check | `pinterest.py` |
| 18 | 🟠 WARNING | Standardize download expiry (72hr) | All download endpoints |
| 19 | 🟠 WARNING | Health endpoint — no live Etsy call | `/health` route |
| 20 | 🟠 WARNING | Pictorem failure → 500 for retry | `stripe-webhook.js` |
| 21 | 🟠 WARNING | Atomic catalog saves (.tmp + rename) | All catalog write paths |
| 22 | 🟠 WARNING | Etsy rate limiter (4 req/sec) | `etsy.py` |
| 23 | 🟠 WARNING | Instagram API version from .env | Instagram route files |
| 24 | 🟠 WARNING | Studio: generate thumbnail (800px) | `main.js` finalize-ingest |
| 25 | 🟠 WARNING | Studio: generate watermarked preview (1600px) | `main.js` finalize-ingest |
| 26 | 🟠 WARNING | Studio: generate micro web (2400px + IPTC) | `main.js` finalize-ingest |
| 27 | 🟠 WARNING | Studio: generate micro commercial (4000px + IPTC) | `main.js` finalize-ingest |
| 28 | 🟠 WARNING | Studio: update both catalogs on finalize | `main.js` finalize-ingest |
| 29 | 🟢 POLISH | CORS — restrict origins | All `functions/api/` files |
| 30 | 🟢 POLISH | WAL checkpoint on DB connect | `db.py` |
| 31 | 🟢 POLISH | Delete corrupt DB file | `data/archive35.db.corrupt2` |
| 32 | 🟢 POLISH | Tab persistence in ContentIngest | `ContentIngest.js` |
| 33 | 🟢 POLISH | C2PA pre-sign file check | `c2pa-sign.js` |
| 34 | 🟢 POLISH | Centralize MOCKUP_PORT | `main.js` |
| 35 | 🟢 POLISH | ~~DONE~~ Health card CSS — fix text truncation | `Pages.css`, `WebsiteControl.js` |
| 36 | 🟢 POLISH | ~~DONE~~ Sitemap orphan collection refs | `sitemap.xml` |
| 37 | 🟢 POLISH | Finish tasks 10-15 (KV bindings now live) | `checkout.js`, `batch.js`, `cart.js` |

---

## Detailed Specifications

Full specs for critical and complex tasks. For tasks 9-15 see `MICRO-CHECKOUT-HANDOFF.md`. For tasks 24-28 see `STUDIO-HANDOFF.md`.

### Task 1: /api/micro-license/serve.js (MONEY-LOSING BUG)

`download.js` line 149 generates URL: `/api/micro-license/serve?session_id=X&key=Y`. That file does not exist. Every micro-license purchase = paid but 404 on download.

- Accept GET with `session_id` and `key` params
- Verify `session_id` is paid Stripe session (same logic as download.js lines 46-66)
- Check 72-hour expiry from session creation date
- Read image from R2 via `env.ORIGINALS` bucket binding using `key` param
- Return binary image with `Content-Disposition: attachment; filename="{image_id}.jpg"`
- CORS headers: `Access-Control-Allow-Origin: *`

**Verification:**
- `curl -I .../serve?session_id=fake` → 400 or 402, NOT 404
- Real paid session → 200 + image binary
- Session older than 72hr → appropriate expiry error

### Tasks 2-3: Etsy Token Auto-Refresh

Token expires periodically. Current system only refreshes on manual API call. Scheduler must handle this automatically.

**Task 2:** Add `@huey.periodic_task(crontab(hour='*/6'))` to `scheduler.py`
- Check if token expires within 2 hours; if yes, call `refresh_access_token()`
- Log action: `log_action('etsy', 'token_auto_refreshed', {details})`

**Task 3:** Add `ensure_valid_token()` at start of EVERY function in `etsy.py` that calls Etsy API. Also add to any route files in `src/routes/` that import Etsy client.

### Tasks 4-6: Credits System (Currently Dead)

$25 credit pack purchase creates Stripe session but credits never stored. Full cycle must work.

**Task 4:** In `stripe-webhook.js`, handle `metadata.orderType === 'credit_pack'`
- Calculate credits: `Math.floor(amount_cents / 250)`
- Store in KV: key = `credits:{customer_email}`, value = JSON `{credits: N, last_updated: ISO}`
- Use `env.AGENT_REQUESTS` KV namespace (already bound to project)

**Task 5:** `balance.js` reads KV, returns `{email, credits, last_updated}`

**Task 6:** `redeem.js` accepts POST `{email, image_id, tier}`, checks balance >= 1, deducts, returns download URL

### Task 7: Webhook Security

`stripe-webhook.js` ~line 890: if no webhook secrets configured, events are accepted without verification. Fix: reject with 500.

### Task 8: R2 Upload Error Handling

Agent `r2_upload.py` line 94: `client.upload_file()` has no try-except. Wrap it. Return `{success: False, error: str(e)}` on failure.

### Tasks 16-23: Agent Hardening

- **Task 16:** Instagram auto-refresh — same pattern as Etsy (tasks 2-3)
- **Task 17:** Pinterest pin creation — check access tier, return clear error for trial mode
- **Task 18:** All download endpoints — standardize to 72hr expiry
- **Task 19:** `/health` — read etsy_listings count from SQLite cache, not live API
- **Task 20:** Pictorem failure — return 500 to Stripe so it retries the webhook
- **Task 21:** Catalog saves — write to `.tmp` file first, then `fs.rename()` (atomic)
- **Task 22:** Etsy rate limiter — `asyncio.Semaphore` or token bucket, max 4 req/sec
- **Task 23:** Instagram API version — read `IG_API_VERSION` from `.env`, default `v21.0`

### Tasks 29-34: Polish

- **Task 29:** CORS — restrict to `https://archive-35.com` and `https://archive-35-com.pages.dev`
- **Task 30:** WAL checkpoint — add `PRAGMA wal_checkpoint(TRUNCATE)` to `db.py` on connection init
- **Task 31:** Delete `data/archive35.db.corrupt2` (5.5MB dead file from Feb 19)
- **Task 32:** `ContentIngest.js` — persist approval state in component ref or context so tab switches preserve it
- **Task 33:** `c2pa-sign.js` — add `fs.existsSync(inputPath)` check before signing, log warning if missing
- **Task 34:** Centralize `MOCKUP_PORT = 8036` in config object at top of `main.js`, replace all hardcoded references

### Tasks 35-36: ALREADY DONE (Cowork session March 19 evening)

- **Task 35:** ~~DONE~~ Health card CSS — widened grid min-width from 200px→260px, changed `overflow: hidden` to `overflow-x: hidden; overflow-y: auto`, added `flex: 1; minWidth: 0; wordBreak: 'break-word'` to CheckRow detail span
- **Task 36:** ~~DONE~~ Sitemap orphan refs — `sitemap.xml` had `yosemite` and `white-sands` but photos.json uses `yosemite-national-park` and `white-sands-national-park`. Fixed to match.

### Task 37: Finish tasks 10-15 (KV bindings now live)

The `CREDIT_BALANCES` KV namespace is now bound in Cloudflare Pages → Settings → Bindings. The code references `env.CREDIT_BALANCES` (not `env.AGENT_REQUESTS`). Finish wiring:
- Task 10: Multi-item micro Stripe checkout (checkout.js accepts array of items)
- Task 11: Cart UI integration on micro-licensing page
- Task 12: Credit redemption flow in cart
- Task 13: AI agent batch purchase endpoint
- Task 14: Agent batch + x402 integration
- Task 15: Batch download (zip) endpoint

See `MICRO-CHECKOUT-HANDOFF.md` for full specs.

---

## Non-Negotiable Rules

- **READ** the actual file before writing code that modifies it
- **VERIFY** after EACH task — re-read files, count records, curl endpoints
- **SMALL** tasks (50 lines max), verify between each
- **NEVER** merge `licensing-catalog.json` and `micro-licensing-catalog.json`
- **NEVER** put standard photos in `licensing-catalog.json` (only `large-scale-photography-stitch`)
- **NEVER** commit `.env` files or credentials to git
- **NEVER** touch Stripe keys or webhook endpoints without Wolf
- **ALWAYS** run `sync_gallery_data.py` before deploying
- **ALWAYS** test all three systems if touching shared files (Studio + Agent + Mockup)
- GitHub repo is **PUBLIC** — NEVER commit sellable images (originals, zoom, micro versions)
- "It should work" is not verification. **Run the test.**

---

## Deploy Checklist (After All 34 Tasks)

1. `python3 sync_gallery_data.py`
2. `git add <specific files>` (NOT `git add -A`)
3. `git commit -m "Complete audit fixes: serve endpoint, token refresh, credits, security, agent hardening, polish"`
4. `git push origin main`
5. Restart Docker: `cd Archive\ 35\ Agent && docker compose down && docker compose up -d`
6. Run `/verify-pages` to confirm all pages load
7. Run `/test-endpoints` to verify all API endpoints
8. Run verifier agent for full quality check
9. Test micro-license purchase end-to-end (checkout → download)
10. Test Etsy token refresh cycle
11. Confirm health endpoint returns fast without Etsy API call
