# Archive-35 Cost Model

> Monthly cost tracking. Updated after each phase change.

---

## Phase 1 Monthly Fixed Costs

| Item | Monthly | Notes |
|------|---------|-------|
| Claude API (Haiku + Sonnet) | $15–$30 | Haiku batch for vision, Sonnet for complex content |
| Late API (social posting) | $19 | Starter tier, 13 platforms |
| Etsy listing fees | $2–$4 | 10-20 listings × $0.20 |
| Domain + DNS | $1–$2 | archive-35.com |
| Test prints (amortized) | $15–$25 | ~$200 upfront ÷ 8 months |
| Returns reserve | $5–$10 | 2-3% of revenue set aside |
| Packaging materials | $5–$10 | Mailers, tissue, brand stickers |
| **Total fixed** | **$62–$101/mo** | |

## Variable Costs (Per Sale)

| Cost | Amount | Notes |
|------|--------|-------|
| POD production | $16–$45 | Depends on paper/size |
| Etsy transaction fee | 6.5% | On sale price |
| Etsy payment processing | 3% + $0.25 | On sale price |
| Shipping (if included) | $4.69–$10 | Or buyer-paid |

## Phase 1 Break-Even

- At $75/sale with $25 POD cost: **$42.40 net margin**
- Break-even at **~2 sales/month** (covers $85 fixed costs)
- At $75/sale with $40 POD cost: **$27.40 net margin**
- Break-even at **~3 sales/month**

## Daily Budget Cap

`DAILY_BUDGET_USD=5.00` in .env
- Prevents runaway API costs
- Rate limiter enforces this per-API and globally
- If budget exceeded, agents queue work for tomorrow

## Revenue Targets

| Month | Est. Revenue | Net (after COGS) | Cumulative |
|-------|-------------|-------------------|-----------|
| 1 | $0–$75 | -$62 to +$13 | -$62 to +$13 |
| 2 | $50–$150 | -$12 to +$88 | -$74 to +$101 |
| 3 | $100–$300 | +$38 to +$238 | -$36 to +$339 |
| 6 | $500–$1,000 | +$400 to +$900 | +$764 to +$3,039 |
| 12 | $2,000–$5,000 | +$1,800 to +$4,800 | +$11,564 to +$31,839 |
