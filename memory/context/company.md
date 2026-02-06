# Archive-35 Company Context

## What We Are
Fine art landscape photography business. Sell prints online via archive-35.com.

## Tools & Systems

| Tool | Used for | Notes |
|------|----------|-------|
| archive-35.com | Website (sales) | Cloudflare Pages |
| Archive-35 Studio | Content management | Electron + React (05_Studio/app/) |
| Stripe | Payment processing | Live keys configured |
| Pictorem | Print fulfillment | PRO account, 15% rebate, API token: archive-35 |
| GitHub | Source control | wolfschram/archive-35.com |
| Cloudflare | Hosting + Functions | Pages Functions for checkout + webhook |
| Google Drive | Photo backup | Every photo backed up |
| Google Workspace | Email (wolf@archive-35.com) | Business email |
| Claude (Anthropic) | AI assistant | MCP server for direct repo access |
| Adobe Lightroom | Photo editing | Exports to Photography/ folder |

## Automated Pipeline

```
Customer selects print on website
  → Stripe Checkout (Cloudflare Function)
  → Payment processed
  → Stripe webhook fires
  → Cloudflare Function submits order to Pictorem API
  → Pictorem prints and ships to customer
  → Zero manual intervention
```

## Key People

| Who | Role |
|-----|------|
| Wolf | Owner, photographer, VP Engineering at Diversified (day job) |

---

*Updated: 2026-02-06*