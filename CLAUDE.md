# CLAUDE.md — Archive-35.com (Live Production Site)

> **Read this file completely before doing anything.**
> Last updated: 2026-02-17

---

## 🔴 SITE IS LIVE — PRODUCTION RULES

**Archive-35.com is LIVE. Real customers are browsing, signing up, and purchasing.**

Every change must be treated as a production deployment:

- **Test before pushing.** Health-check all critical pages after deploy (home, gallery, login, account, checkout flow)
- **Never break checkout.** Stripe integration, cart, and payment flow are revenue-critical
- **Never break auth.** Magic link login, sessions, and account pages must stay functional
- **Never break email.** Welcome emails, order confirmations, and Wolf notifications must keep flowing
- **Never break the Google Sheet webhook.** Order and signup logging is how Wolf tracks the business
- **Back up before major refactors.** If touching gallery.html, stripe-webhook.js, or send-magic-link.js — read the full file first
- **No experiments on main.** If something is risky, discuss with Wolf before pushing
- **Mobile matters.** Many visitors come from iPhone/Instagram links. Test mobile viewport behavior
- **Performance matters.** Gallery has CoverFlow animations — don't regress the idle-throttling or event listener cleanup
- **Self-test EVERY change.** After every commit+push, wait for Cloudflare deploy (~15-30s), then hard-refresh the live site in the browser and: (1) take a screenshot to visually verify, (2) check the browser console for JS errors, (3) test basic interactions (click, scroll, navigate). Never tell Wolf "it's deployed" without actually verifying it works. You have Chrome browser access — use it.

---

## Owner

**Wolf (Wolfgang Schram)** — Solo operator, photographer, VP of Engineering (25+ yrs broadcast/AV/enterprise)
- ADHD/dyslexia — keep answers short, scannable, clear visual hierarchy
- Bilingual German/English, prefers English responses
- Servant leadership philosophy
- Business email: wolf@archive-35.com (ALL business email goes here)
- Personal email: wolfbroadcast@gmail.com (Stripe account owner login only)

---

## Architecture

| Layer | Technology |
|-------|------------|
| Hosting | Cloudflare Pages (static + Functions) |
| Payments | Stripe (live mode) |
| Auth | Magic link via Resend email + Cloudflare KV |
| Email | Resend API (from orders@archive-35.com and wolf@archive-35.com) |
| Print Fulfillment | Pictorem (auto-submitted via API) |
| Order/Signup Logging | Google Sheets via Apps Script webhook |
| Analytics | GA4 + Cloudflare Web Analytics |
| DNS/CDN | Cloudflare |
| Repo | GitHub (wolfschram/archive-35.com) |

## Key KV Namespaces

| Binding | ID | Purpose |
|---------|----|---------|
| AUTH_SESSIONS | 77987ba99c464d468aba0ce357a6c7f2 | Login sessions (30-day TTL) |
| AUTH_MAGIC_LINKS | 61a70f5d48a24791bbee79121fbe5907 | Magic link tokens (15-min TTL) |

## Email Flow (All BCC'd to wolf@archive-35.com)

| Trigger | Customer Gets | Wolf Gets |
|---------|--------------|----------|
| New signup | Welcome email | [New Signup] notification + BCC of welcome |
| Magic link request | Login link email | — |
| Print purchase | Order confirmation | New Order notification + BCC of confirmation |
| License purchase | License confirmation | New License notification + BCC of confirmation |

## Critical Files

| File | What it does | Risk level |
|------|-------------|------------|
| functions/api/stripe-webhook.js | Handles payments, order emails, Pictorem, Google Sheet | 🔴 CRITICAL |
| functions/api/auth/send-magic-link.js | Login + welcome email + signup logging | 🔴 CRITICAL |
| functions/api/auth/verify.js | Magic link verification + session creation | 🔴 CRITICAL |
| functions/api/auth/session.js | Session lookup for auth state | 🟡 HIGH |
| functions/api/account/update.js | Profile editing (name → Stripe sync) | 🟡 HIGH |
| gallery.html | Main gallery with CoverFlow + all photo data | 🟡 HIGH |
| login.html | Signup/login form | 🟡 HIGH |
| account.html | Customer account page with order history | 🟡 HIGH |
| js/cart.js + js/cart-ui.js | Shopping cart and checkout | 🔴 CRITICAL |
| data/gallery-data.json | Photo metadata driving the gallery | 🟡 HIGH |

## Environment Variables (Cloudflare Pages)

- STRIPE_SECRET_KEY
- RESEND_API_KEY
- GOOGLE_SHEET_WEBHOOK_URL
- PICTOREM_API_KEY
- WOLF_EMAIL (fallback: wolf@archive-35.com)

## Deploy Process

1. Commit to main → auto-deploys via Cloudflare Pages
2. After deploy, verify: `curl -s -o /dev/null -w '%{http_code}' https://archive-35.com`
3. Check critical paths: /, /gallery, /login, /account.html, /api/auth/session

---

## Preferences

- Default to .docx for documents (not .md) unless it's actual code
- Senior engineer-level technical depth
- Frame leadership topics through servant leadership
- Auto-correct voice-to-text errors without asking
- wolf@archive-35.com for ALL business communications
- wolfbroadcast@gmail.com is personal — do not use for Archive-35 business
