# SALES-BLOCKERS.md — Technical Reasons Customers Fail to Purchase
Generated: March 23, 2026

## Priority 1 — CRITICAL (Will definitely block sales)

### SB-01: Cloudflare env vars unverified
Both Stripe and x402 checkout paths silently return 503 if these are not set in Cloudflare Pages:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- COINBASE_WALLET_ADDRESS
- ORIGINAL_SIGNING_SECRET
- RESEND_API_KEY
- PICTOREM_API_KEY
Action: Log into Cloudflare dashboard → Pages → archive-35.com → Settings → Environment variables. Verify all 6 are present.

### SB-02: R2 bucket binding unverified
serve-original.js requires the ORIGINALS R2 bucket to be bound in Cloudflare Pages. If unbound, download URLs return 500 after payment.
Action: Verify ORIGINALS binding in Cloudflare Pages settings.

### SB-03: Stripe webhook endpoint not confirmed active
stripe-webhook.js exists and is well-implemented but the webhook must be registered in Stripe dashboard pointing to https://archive-35.com/api/stripe-webhook. If not registered, orders process payment but never trigger fulfillment or email.
Action: Check Stripe dashboard → Webhooks → confirm endpoint is registered and receiving events.

---

## Priority 2 — HIGH (Likely blocking sales)

### SB-04: micro/ folder images may not exist in R2
The download flow routes to micro/web/{image_id}.jpg and micro/commercial/{image_id}.jpg in R2. If the down-conversion pipeline didn’t populate these, payment succeeds but download fails.
Action: Spot-check R2 bucket — confirm micro/ folder contains images.

### SB-05: No customer discovery of x402 licensing
The x402 endpoint at /api/license/{image_id} is real and working in code, but AI agents need to know it exists. llms.txt and llms-full.txt are present — but do they reference the x402 endpoint directly? Unclear.
Action: Check llms.txt and llms-full.txt for x402 endpoint documentation.

### SB-06: Micro-licensing page cart UX
The micro-licensing.html checkout uses a fallback chain (primary endpoint → fallback → alert). If the primary endpoint fails silently, users see a generic error with no recovery path.
Action: Test the checkout flow end-to-end in a browser with Stripe test mode.

---

## Priority 3 — MEDIUM (Friction but not blocking)

### SB-07: No order status page for x402 purchases
Stripe purchases get a thank-you.html redirect. x402/USDC purchases return a JSON download URL — no human-friendly confirmation page.

### SB-08: Instagram in development mode
Cannot post publicly. Limits organic discovery and social proof.

### SB-09: Pinterest read-only
Cannot pin programmatically. 52 branded pins exist but must be posted manually.

---

## The Honest Truth on Zero Sales
Based on the audit, the most likely reason for zero sales is NOT broken code. It is:
1. Traffic — no evidence of significant inbound traffic
2. Discovery — x402/AI agent purchasing is very early market (2026), few agents are actually buying yet
3. Stripe checkout may never have been tested end-to-end in production
The code is well-built. The market isn’t there yet for AI crypto purchasing. Stripe is the viable revenue path — verify SB-01 through SB-03 first.
