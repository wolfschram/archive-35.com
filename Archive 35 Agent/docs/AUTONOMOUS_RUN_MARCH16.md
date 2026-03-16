# Autonomous Run — March 16 2026
**Wolf is away. Run everything below without stopping to ask questions.**
**If something fails — log it, skip it, continue to next task.**
**Nothing here is life-critical. No financial risk. Just build.**

---

## HOW TO START

```bash
cd /Users/wolfgangschram/Documents/ACTIVE/archive-35
claude --dangerously-skip-permissions
```

Then paste the entire PROMPT section below.

---

## PROMPT — paste this in full

```
Read these files in order before doing anything:
1. Archive 35 Agent/CLAUDE.md
2. Archive 35 Agent/docs/AGENT_MASTER_HANDOVER.md
3. Archive 35 Agent/docs/BUILD_TRACKER.md

You are running autonomously. Wolf is away.
Rules for this session:
- Never stop to ask a question
- If blocked on a task — log the blocker to SESSION_LOG.md and move to the next task
- If a test fails — fix it and continue, do not stop
- If an API call fails — log it and skip that item, do not stop
- Commit after every completed task
- Update BUILD_TRACKER.md after every completed task

Complete these tasks in order:

## TASK 1 — T28: Instagram auto-posting (HIGHEST PRIORITY)

File: src/agents/instagram_agent.py (already scaffolded)

What to build:
- Pick a photo from the 79 live Etsy listings
- Upload it to Cloudflare R2 via src/integrations/r2_upload.py to get a public URL
- Generate a caption using Claude Vision + brand voice from docs/LISTING_REWRITE_BRIEF.md
  Caption format:
    Line 1: One sentence, the moment, present tense, no adjectives
    Line 2-3: 2 sentences story/context from story bank
    Line 4: empty
    Line 5: "Fine art print available — link in bio"
    Line 6: 5-7 hashtags including #archivephotography #fineart #[location]
- Post via Instagram Graph API (2-step: create container → publish)
  Endpoint: POST https://graph.instagram.com/v21.0/{INSTAGRAM_USER_ID}/media
  Then: POST https://graph.instagram.com/v21.0/{INSTAGRAM_USER_ID}/media_publish
- Images must be at a PUBLIC URL — use R2 public URL, not local path
- Schedule: 3x per day at 8am, 12pm, 7pm PST via scheduler
- Never repeat same image within 30 days — track in SQLite instagram_posts table
- Rate limit: max 25 posts per 24 hours (stay at 3/day)
- Log every post to SQLite
- Add API endpoint: POST /instagram/post/now (trigger immediate post for testing)
- Test: post one image right now via /instagram/post/now
  If Meta app is in Development Mode — note this in SESSION_LOG.md and continue
  Development Mode means only the account owner (Wolf) can receive posts — that is fine

IMPORTANT: If Instagram Graph API returns any error about app permissions or
development mode — log it clearly in SESSION_LOG.md but do NOT stop.
The wiring is what matters. Wolf will handle Meta app review separately.

## TASK 2 — T29: AUTO_APPROVE bypass

- Add AUTO_APPROVE=true to .env if not already there
- In src/telegram/queue.py — check for AUTO_APPROVE env var
- If AUTO_APPROVE=true — skip Telegram queue entirely, auto-approve all content
- Test: verify content flows through without Telegram
- Commit

## TASK 3 — T30: Agent dashboard (Cloudflare Worker)

Build a single HTML page served by a Cloudflare Worker at:
agent.archive-35.com OR use existing Cloudflare Pages at archive-35.com/agent

Simpler approach — build as a standalone HTML file in 04_Website/ that:
- Polls the Agent API (localhost:8035) every 30 seconds
- Shows: agent status, Etsy listings count, Instagram posts today, last 20 log entries
- Has an emergency stop button (calls POST /kill-switch)
- Password protected (env var DASHBOARD_PASSWORD)
- Accessible from any browser via archive-35.com/agent

If Cloudflare Worker deployment is complex — build the HTML dashboard file
and deploy via git push to Cloudflare Pages (auto-deploys from main).
Note: use the claude/job-pipeline-v2-5x9f7 branch, not main.

## TASK 4 — x402 Crypto Licensing Endpoint

Build: src/api_x402.py — a new FastAPI router mounted on the existing api.py

Endpoint: GET /api/license/{image_id}

Behavior:
1. Check if image_id exists in data/photos.json
2. Return HTTP 402 with payment details:
   {
     "price": "2.50",
     "currency": "USDC",
     "network": "base",
     "payTo": os.environ["COINBASE_WALLET_ADDRESS"],
     "description": f"Archive-35 commercial license — {image_title}",
     "image_preview": f"https://archive-35.com/images/{collection}/{filename}-thumb.jpg"
   }
3. On payment confirmation (POST /api/license/{image_id}/confirm with tx_hash):
   - Verify transaction on Base via simple HTTP call to Basescan API
   - If confirmed: return full-res image URL from R2
   - Log to SQLite: license_sales table

Price tiers (based on image metadata):
- editorial: $0.50 (thumbnail only, no commercial use)
- commercial: $2.50 (full-res, standard commercial license)
- exclusive: $25.00 (full-res, exclusive 30-day license)

Default all images to commercial ($2.50) unless tagged otherwise.

DO NOT use the CDP SDK for now — build a simple HTTP-based verification:
1. Return 402 with wallet address and price
2. Buyer pays USDC to the wallet address on Base
3. Buyer submits transaction hash to /confirm endpoint
4. Agent checks Basescan API to verify the transaction
5. If valid amount sent to correct address — serve the image URL

This is simpler than full x402 SDK integration and works immediately.
Full CDP SDK integration can be Phase 2.

Add endpoint: GET /api/license/gallery — returns JSON list of all licensable images
with thumbnails, titles, prices, and license endpoints.
This is the "AI agent marketplace" — any agent can discover and buy images.

## TASK 5 — Clean up .env duplicates

The .env file has duplicate COINBASE_WALLET_ADDRESS lines.
Remove the first empty one, keep the one with the actual address.
Do not touch any other values.

## TASK 6 — Commit everything and push

git add -A
git commit -m "[agent] T28 Instagram + T29 auto-approve + T30 dashboard + x402 licensing"
git push

Update BUILD_TRACKER.md with all completed tasks.
Write summary to SESSION_LOG.md.
```

---

## IF CLAUDE CODE GETS STUCK ON PERMISSIONS

Run with the skip flag:
```bash
claude --dangerously-skip-permissions
```

## IF INSTAGRAM FAILS DUE TO APP MODE

Note it and continue. The fix is:
- Go to developers.facebook.com
- Find the Archive-35 app
- App Review → Request advanced access for instagram_content_publish
Wolf will do this separately. The code is what matters right now.

## IF ANY API CALL FAILS

Log it. Skip it. Move on. Do not stop.

## SUCCESS CRITERIA FOR THIS RUN

- [ ] Instagram agent built and wired to scheduler
- [ ] AUTO_APPROVE=true bypassing Telegram
- [ ] Dashboard accessible at archive-35.com/agent
- [ ] x402 /api/license/{image_id} endpoint returning 402 with payment details
- [ ] /api/license/gallery returning full image catalogue for AI agents
- [ ] Everything committed and pushed

---
*Written: March 16 2026 — Wolf is away, run autonomous*
