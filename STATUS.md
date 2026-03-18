# STATUS.md — archive-35
Last updated: March 2026

## What this is
Fine art photography e-commerce. LIVE at archive-35.com.
Brand: The Restless Eye | Tagline: Light. Place. Time.

## Current state
- Site LIVE — real customers, real payments (Stripe)
- 744 images, 40 galleries published
- Studio Electron app running (M3 Max MBP)
- Agent (Python FastAPI port 8035) integrated in Studio

## Active threads
- [ ] Photografique Issue 002 submission via CaFÉ
- [ ] Pinterest API resubmission (needs live OAuth demo video)
- [ ] Indiewalls profile (address validation bug — contact support@indiewalls.com)
- [ ] Etsy API approval (App ID 1467100815400)
- [ ] Meta API Instagram/Facebook posting
- [ ] CaFÉ Chrome extension (MV3, dedup working)
- [ ] Licensing vertical (high-res panoramics)

## Blocked
- Pinterest: needs new demo video showing live OAuth browser flow
- Indiewalls: server-side bug, awaiting support

## Next action
- Submit Photografique Issue 002
- Follow up Indiewalls

## Critical rules
- ALWAYS run sync_gallery_data.py before deploy
- Never break: checkout, auth, email, Google Sheet webhook
- Three-system test: Studio + Agent + Mockup after any shared file change
- Repo: github.com/wolfschram/archive-35.com
