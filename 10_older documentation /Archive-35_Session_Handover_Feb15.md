# Archive-35 Session Handover — February 15, 2026

## COPY THIS INTO A NEW CHAT TO CONTINUE

---

```
I'm continuing work on Archive-35, a fine art photography website (archive-35.com).

READ CLAUDE.md FIRST — it has all project rules, structure, and history.
READ 08_Docs/LESSONS_LEARNED.md — it has 21 lessons from past failures.
READ 08_Docs/ARCHITECTURE.md — it has the full technical architecture.

## WHAT JUST HAPPENED (Feb 15 Session)

### Deployed Successfully
- Africa collection FULLY removed from all 8+ files (index.html, sitemap, llms.txt, etc.)
- Large-scale-photography-stitch purged from photos.json (527→483 photos, 30→29 collections)
- Live site verified: 483 photos, 29 collections, no Africa, no LSP
- Commit: 6380c5d (data cleanup) + dd2cbc0 (docs) + 175f5d7 (safety net)

### Safety Net Built (NEW — in deploy pipeline)
The deploy pipeline now has 11 stages: Scan→Images→C2PA→R2→Data→Sync→Validate→Git→Push→Verify→Done

Two new stages added:
1. **Sync** — runs sync_gallery_data.py automatically (previously skipped by Studio deploy, causing stale gallery.html)
2. **Validate** — 6 pre-deploy checks that BLOCK bad deploys:
   - Schema validation (required fields on every photo)
   - Duplicate ID detection → HARD BLOCK
   - Empty/null collection slug detection → HARD BLOCK
   - Orphan reference detection (index.html, sitemap, llms.txt reference non-existent collection) → WARNING
   - Photo count sanity (>20% drop vs live site) → WARNING
   - Gallery.html freshness (inline data matches photos.json) → HARD BLOCK

### Other Fixes
- JSX Unicode rendering fixed in WebsiteControl.js (12 locations: arrows, dots, checkmarks)
- Health checks fixed: STRIPE_WEBHOOK_SECRET and GOOGLE_SHEET_WEBHOOK_URL are Cloudflare Pages env vars, not local .env — checks now show OK with explanation
- 4 new lessons added to LESSONS_LEARNED.md (018-021)

## WHAT WOLF NEEDS TO DO
1. Restart Studio (Cmd+Q, relaunch) — main.js and WebsiteControl.js were modified
2. Click "Upload All Originals to R2" in Website Control — backfill gallery originals
3. Delete orphan folder locally: rm -rf images/large-scale-photography-stitch/
4. Verify Studio health panel shows green (webhook secrets should now show OK)

## WHAT'S NEXT (Priority Order)
1. Run R2 batch upload (Wolf must do in Studio after restart)
2. End-to-end live checkout test (print + license) after Monday go-live (Feb 17)
3. Address external AI audit findings (Archive-35_Pipeline_Audit.docx in repo root)
4. Add cross-gallery duplicate detection (hash-based comparison)
5. Re-test checkout: verify customer email + amount in notification emails

## KNOWN STATE
- photos.json: 483 photos, 29 collections (verified)
- Live site: deployed and verified Feb 15
- R2 bucket: licensing originals confirmed, gallery originals need backfill
- Stripe: live keys configured, webhook secrets in Cloudflare Pages
- Pictorem: PRO + Premium, go-live Monday Feb 17

## CRITICAL RULES (from CLAUDE.md)
- Display the 10 operational rules at start of EVERY response
- gallery.html is self-contained (all CSS/JS inline)
- index.html has HARDCODED collection cards (not generated)
- Removing a collection requires editing 8+ files (grep the entire project)
- preload.js changes require FULL APP RESTART (Cmd+Q)
- NEVER GUESS. NEVER ASSUME. Project-wide search = proof.
```

---

*This file is for handover purposes. Copy the content between the ``` markers into a new chat.*
