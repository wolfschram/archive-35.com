# Lessons Learned — March 18-19, 2026 (Major Build Session)

---

## Architecture Lessons

### 1. Two-Catalog Architecture is Non-Negotiable
- `licensing-catalog.json` = ONLY Large Scale Photography Stitch (160 images). Buyers get full originals.
- `micro-licensing-catalog.json` = ALL 1,109 photos. Buyers get down-converted versions (2400px/4000px).
- `photos.json` = gallery display only, not a licensing file.
- We broke this twice by dumping all photos into licensing-catalog.json. Cost hours to fix.
- The `.claude/agents/safe-catalog-editor.md` now enforces this rule.

### 2. Down-Converted Delivery is Critical
- Micro-license buyers ($2.50/$5.00) must NOT get the original 10K-30K pixel file.
- Generated 2,002 micro delivery images (web: 2400px, commercial: 4000px) stored in R2 `micro/` prefix.
- download.js routes to `micro/web/` or `micro/commercial/` based on tier — never `originals/`.
- Full license ($280+) still serves from `originals/` prefix.

### 3. IPTC Metadata Must Be IN the JPEG
- XMP sidecar files (.xmp) are useless — agents and Google Images can't read them.
- Use `exiftool -overwrite_original` to embed directly into JPEG.
- 2,648 images now have embedded copyright, creator, license URL, C2PA notice.

### 4. Claude Code Project Structure Matters
- Without `.claude/commands/`, `.claude/agents/`, and `.claude/settings.json`, Claude Code operates blind.
- Added: deploy.md, test-endpoints.md, verify-pages.md, restart-agent.md, run-broadcast.md
- Added: verifier agent (self-reflection after builds), safe-catalog-editor (prevents catalog merging)
- Added: pre-commit-check.sh (catches secrets, missing fields)
- Monolithic spec documents (500+ lines) produce half-finished work. Use smaller, focused tasks with verification.

---

## Technical Lessons

### 5. Docker: Source Mount + .env Mount
- Source code must be volume-mounted (`./src:/app/src`) for live development.
- `.env` must be volume-mounted (`./.env:/app/.env`) so token refresh can write back.
- uvicorn must bind to `0.0.0.0` inside Docker, not `127.0.0.1`.
- `docker compose ps --format json` outputs a JSON array on newer Docker versions, not one object per line.

### 6. Cloudflare Build Command
- The inline build command in Cloudflare Pages settings is separate from `build.sh` in the repo.
- If you edit `build.sh`, you also need to update the Cloudflare build command (or change it to `bash build.sh`).
- Files not explicitly copied to `_site/` don't deploy. IndexNow key, `.well-known/`, and `sitemap-images.xml` were all missing.

### 7. Cloudflare Analytics GraphQL
- `httpRequestsAdaptiveGroups` has a 1-day max range on the free tier. Use `date_gt` filter set to yesterday, not 7 days ago.
- `httpRequests1dGroups` supports 7-day range with `date_gt` filter.
- Zone IDs are different from zone tags. The correct IDs: archive-35.com = `6c038d09db05960fd9e68491407bdea8`, athos-obs.com = `c4d910b00018793d3db58d3fb2e867ff`.

### 8. Etsy API
- Max `limit` parameter is 100, not 200. Requesting 200 causes 400 errors.
- Token auto-refresh works but requires `.env` file to be writable (Docker mount needed).

### 9. Instagram API
- Insights endpoint returns 400 for Development Mode apps (need Business account + 100 followers).
- Media endpoint (listing recent posts) works fine in Development Mode.
- Token valid until April 20, 2026.

### 10. Reddit API
- New app creation blocked since November 2025 (Responsible Builder Policy).
- PRAW is dead for new users. Use copy-paste workflow instead.
- Public JSON endpoints (append `.json` to URLs) work without authentication for read-only access.

### 11. Pinterest API
- Trial access = read-only. Can list boards and pins but cannot create pins.
- Token expires March 27, 2026.
- Use manual upload through pinterest.com/pin-creation-tool/ until full API approval.

---

## Payment Lessons

### 12. x402 USDC
- Facilitator URL: https://x402.org/facilitator
- npm packages: @x402/core, @x402/evm
- Cloudflare Function needs `COINBASE_WALLET_ADDRESS` environment variable.
- The `[image_id].js` endpoint must have no fallback for missing wallet — it returns 'Licensing not configured' without it.

### 13. Stripe Micro-License Economics
- $0.01 thumbnails lose money ($0.30 Stripe fee per transaction).
- $0.50 web licenses net $0.19 after fees.
- Minimum viable price: $2.50 (nets ~$2.13 after fees).
- Prepaid credits ($25 for 10 images) avoid per-transaction fees.

### 14. Cloudflare KV Bindings
- KV namespaces must be both CREATED and BOUND to the Pages project.
- Create in Workers KV section, bind in Pages > Settings > Bindings.
- Changes take effect on next deployment.

---

## Broadcasting Lessons

### 15. IndexNow
- Key file MUST be accessible at the exact URL. Cloudflare SPA routing can intercept .txt files.
- Key file must be included in the build command that copies to `_site/`.
- Bing caches verification status — may take 24h to accept after fixing the key file.
- Yandex is more forgiving — accepts immediately.

### 16. Google Search Console
- Auto-verifies if Cloudflare is the domain provider.
- Submit both sitemap.xml AND sitemap-images.xml.

### 17. MCP Registry
- Requires PyPI package with `mcp-name:` in README.
- Max description length: 100 characters.
- GitHub auth token expires fast — run `mcp-publisher publish` immediately after login.
- Archive-35 registered as: `io.github.wolfschram/archive35-photography`

---

## Phishing / Security Lessons

### 18. Fake Etsy Order Emails
- Received phishing emails from `no-reply-forms@webflow.com` impersonating Etsy.
- Fake order numbers, fake buyer names, links to `orweuiorwe.vu` (phishing domain).
- Etsy confirmed: zero actual orders.
- Email briefing agent now auto-detects this pattern.

---

## Process Lessons

### 19. Spec → Build → Break → Fix Cycle
- Writing 500-line spec documents for overnight builds produces quantity over quality.
- Claude Code builds the scaffolding but skips verification.
- Self-reflection (Section I in FINAL-BUILD) helps but is still insufficient.
- Better: smaller tasks, parallel agents, and the verifier agent checking each output.

### 20. Read Before You Think
- Wolf's repeated instruction: 'read the documentation, figure it out before you think.'
- Multiple bugs were caused by assumptions about file formats, API limits, or data structures.
- Always read the actual file/endpoint before writing code that uses it.
