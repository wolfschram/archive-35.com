# Critical Fixes Handoff — Claude Code
Last updated: March 19, 2026
Priority: Fix in order. Stop after each fix and verify.

---

## READ FIRST
- `CLAUDE.md` (project overview + behavioral rules)
- `08_Docs/LESSONS-LEARNED-2026-03-19.md` (what not to repeat)
- `.claude/agents/safe-catalog-editor.md` (catalog rules)

---

## Fix 1: Missing `/api/micro-license/serve` endpoint (CUSTOMERS CAN'T DOWNLOAD)

**Problem:** `download.js` generates a download URL pointing to `/api/micro-license/serve?session_id=X&key=Y` — but **that endpoint doesn't exist**. Customers who buy a micro-license pay via Stripe but get a 404 when trying to download.

**Location:** `functions/api/micro-license/` — `download.js` exists (line 149 references `/api/micro-license/serve`), but `serve.js` does NOT exist.

**What to build:** `functions/api/micro-license/serve.js`
- Accepts `GET /api/micro-license/serve?session_id=X&key=Y`
- Verifies the session_id is a paid Stripe session (same check as download.js)
- Reads the image from R2 bucket (`env.ORIGINALS`) using the `key` parameter
- Returns the image as a binary response with `Content-Disposition: attachment`
- Add expiry check (72 hours from purchase)
- Add CORS headers

**Verify:** After creating, test:
```bash
curl -I https://archive-35.com/api/micro-license/serve?session_id=test&key=test
# Should return 400 or 402, NOT 404
```

---

## Fix 2: Etsy token auto-refresh in scheduler

**Problem:** Etsy token expires periodically. The refresh endpoint exists (`POST /etsy/oauth/refresh`) but the scheduler never calls it. When the token expires, all Etsy operations fail silently.

**Location:** `Archive 35 Agent/src/pipeline/scheduler.py`

**What to build:** Add a periodic task that runs every 6 hours:
```python
@huey.periodic_task(crontab(hour='*/6'))
def refresh_etsy_token():
    """Auto-refresh Etsy token before it expires."""
    from integrations.etsy import EtsyClient
    client = EtsyClient()
    if client.has_valid_token():
        # Check if expiring within 2 hours
        from datetime import datetime, timedelta
        expires = client.get_token_expiry()
        if expires and expires < datetime.now(expires.tzinfo) + timedelta(hours=2):
            client.refresh_access_token()
            log_action('etsy', 'token_auto_refreshed', {'triggered_by': 'scheduler'})
    else:
        client.refresh_access_token()
        log_action('etsy', 'token_auto_refreshed', {'triggered_by': 'scheduler_expired'})
```

**Also add to:** All Etsy API operations — call `ensure_valid_token()` before any API call.

**Verify:**
```bash
curl -s http://localhost:8035/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('Etsy listings:', d.get('etsy_listings', 'ERROR'))"
```

---

## Fix 3: Credits system is a stub

**Problem:** `/api/credits/purchase.js` creates a Stripe session for $25 credit packs. But:
- The Stripe webhook does NOT handle `orderType: credit_pack` — credits are never stored
- `balance.js` doesn't read from any storage
- `redeem.js` doesn't deduct credits or return download URLs

**Location:** `functions/api/credits/` and `functions/api/stripe-webhook.js`

**What to build:**

1. **In `stripe-webhook.js`:** Add handler for `metadata.orderType === 'credit_pack'`:
   - Read `metadata.creditAmount` (default 25)
   - Calculate credits: `Math.floor(amount / 2.50)`
   - Store in Cloudflare KV: key = `credits:${customer_email}`, value = credit count
   - Use `env.AGENT_REQUESTS` KV namespace (already bound)

2. **In `balance.js`:** Read from KV:
   - Accept `?email=X` query param
   - Return `{ email, credits, last_updated }`

3. **In `redeem.js`:** Deduct credit and return download URL:
   - Accept POST `{ email, image_id, tier }`
   - Check balance >= 1
   - Deduct 1 credit from KV
   - Return download URL (same pattern as `download.js`)

**Verify:** Test full cycle:
```bash
# Check balance
curl https://archive-35.com/api/credits/balance?email=test@test.com
# Should return { credits: 0 }
```

---

## Fix 4: Stripe webhook accepts unsigned events

**Problem:** In `stripe-webhook.js` around line 890, if both `STRIPE_WEBHOOK_SECRET` and `STRIPE_TEST_WEBHOOK_SECRET` are missing, the webhook skips signature verification entirely. Anyone can send fake webhook events.

**Location:** `functions/api/stripe-webhook.js`

**What to fix:** If no webhook secrets are configured, reject ALL events:
```javascript
if (!webhookSecret) {
  return new Response(
    JSON.stringify({ error: 'Webhook signature verification not configured' }),
    { status: 500, headers: corsHeaders }
  );
}
```

**Verify:** Check that both secrets are set in Cloudflare Pages environment variables.

---

## Fix 5: R2 upload error handling in Agent

**Problem:** `Archive 35 Agent/src/integrations/r2_upload.py` line 94 — `client.upload_file()` has no try-except. Network failure crashes the endpoint.

**Location:** `Archive 35 Agent/src/integrations/r2_upload.py`

**What to fix:** Wrap in try-except:
```python
try:
    client.upload_file(local_path, bucket_name, r2_key)
    return {"success": True, "key": r2_key}
except Exception as e:
    logger.error(f"R2 upload failed for {r2_key}: {e}")
    return {"success": False, "error": str(e), "key": r2_key}
```

**Verify:** Check the function returns a dict with success/error, not an unhandled exception.

---

## Fix 6: Pictorem fulfillment failures return 200

**Problem:** In `stripe-webhook.js`, if Pictorem order creation fails, the webhook still returns 200 to Stripe. This means Stripe won't retry, and the customer's order is lost.

**What to fix:** Return 500 on Pictorem failure so Stripe retries the webhook.

---

## After all fixes: Deploy

```bash
python3 sync_gallery_data.py
git add -A
git commit -m "Critical fixes: serve endpoint, token refresh, credits, webhook security"
git push origin main
```

Then restart Docker agent:
```bash
cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent
docker compose down && docker compose up -d
```

---

## DO NOT
- Rebuild existing cart.js or cart-ui.js
- Touch Stripe keys or webhook endpoints without Wolf
- Merge catalog files
- Skip verification after each fix
