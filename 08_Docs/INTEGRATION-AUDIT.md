# INTEGRATION-AUDIT.md
Generated: March 23, 2026

## ⚠️ URGENT — Expiring Tokens

| Integration | Expiry | Risk |
|---|---|---|
| **Pinterest token** | **March 27, 2026 — 4 DAYS** | HIGH — refresh immediately |
| **Instagram token** | April 20, 2026 | MEDIUM — refresh within 2 weeks |

---

## Integration Status

### Stripe
- Code: ✅ Present and complete
- checkout-session.js: fully implemented, test mode supported
- stripe-webhook.js: full flow — Pictorem fulfillment + Resend email on checkout.session.completed
- Env vars needed: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_TEST_SECRET_KEY
- Status: **FUNCTIONAL** — assuming env vars are set in Cloudflare

### Pictorem
- Code: ✅ Present in stripe-webhook.js with full MATERIAL_MAP
- Dynamic preorder code builder implemented
- Env vars needed: PICTOREM_API_KEY
- Status: **FUNCTIONAL** — wired into Stripe webhook correctly

### Cloudflare R2
- Code: ✅ Referenced in serve-original.js and license endpoint
- Binding name: ORIGINALS
- Status: **UNKNOWN** — need to verify R2 binding is active in Cloudflare dashboard

### Resend (transactional email)
- Code: ✅ Referenced in stripe-webhook.js for order confirmation emails
- Env var: RESEND_API_KEY (root .env line 112)
- Status: **UNKNOWN** — need to verify API key is set in Cloudflare env

### Etsy
- Code: ✅ Present in Agent integrations
- Token: May expire — auto-refresh writes to .env
- API limit: max 100 per request (not 200)
- Status: **PARTIAL** — approved for personal access, token health unknown

### Instagram
- Code: ✅ Present in Agent integrations
- Token expires: April 20, 2026
- Mode: Development only — cannot post publicly yet
- Status: **LIMITED** — development mode blocks public posting

### Pinterest
- Code: ✅ Present in Agent integrations
- Token expires: **March 27, 2026 — THIS WEEK**
- Mode: Trial access — read only, cannot create pins
- Status: **URGENT** — token expires in 4 days, API approval still pending

### Anthropic API
- Code: ✅ Referenced in Agent
- Env var: root .env line 33
- Status: **ASSUMED WORKING** — Agent is running

### Cloudflare Analytics
- Code: ✅ Implemented in Agent — /analytics/cloudflare and /analytics/athos endpoints
- Zone IDs documented in CLAUDE.md
- Limit: 1-day max range on free tier adaptive groups
- Status: **FUNCTIONAL**

---

## Missing or Unverified
- No evidence of Indiewalls integration in code (manually managed)
- Reddit API: new app creation blocked Nov 2025, using copy-paste workflow
- No automated Pinterest posting working (trial = read only)
