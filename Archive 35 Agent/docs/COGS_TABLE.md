# Archive-35 Cost of Goods Table

> ⚠️ PLACEHOLDER VALUES — Update with real costs when test prints arrive.
> Content Agent reads this to enforce price floors.

---

## Per-Unit Costs (POD)

| SKU Pattern | Paper | Size | POD Cost (est.) | Etsy Fees (9.7%) | Shipping | Total COGS | Min Price (40% margin) | Suggested Retail |
|-------------|-------|------|-----------------|-----------------|----------|-----------|----------------------|-----------------|
| *-8R-LUS-OE | Lustre | 8×10 | $16 | ~$5.30 | $4.69 | $25.99 | $44 | $55 |
| *-11R-LUS-OE | Lustre | 11×14 | $22 | ~$7.30 | $5.50 | $34.80 | $58 | $75 |
| *-16R-LUS-OE | Lustre | 16×20 | $25 | ~$7.30 | $6.50 | $38.80 | $65 | $75 |
| *-16R-HAH-OE | Hahnemühle | 16×20 | $35 | ~$9.20 | $6.50 | $50.70 | $85 | $95 |
| *-20R-HAH-OE | Hahnemühle | 20×24 | $45 | ~$11.60 | $8.00 | $64.60 | $108 | $120 |
| *-16R-HAH-LE | Hahnemühle | 16×20 | $35 | N/A (Shopify) | $6.50 | $41.50 | $70 | $350 |
| *-20R-HAH-LE | Hahnemühle | 20×24 | $45 | N/A (Shopify) | $8.00 | $53.00 | $89 | $450 |

## Fee Breakdown

### Etsy Fees (per sale)
- Listing fee: $0.20
- Transaction fee: 6.5% of sale price
- Payment processing: 3% + $0.25
- **Total effective rate: ~9.7% + $0.45**

### Shopify Fees (per sale)
- Monthly: $39 (Basic plan, Phase 2)
- Payment processing: 2.9% + $0.30

### Shipping (domestic, rolled tube)
- Small (8×10, 11×14): $4.69–$5.50
- Medium (16×20): $6.50
- Large (20×24, 24×30): $8.00–$10.00

## Decision Rules

1. **If POD cost > 50% of retail price** → Do not list that SKU on Etsy
2. **Hahnemühle on Etsy** → Only if retail ≥ $95
3. **Limited editions** → Shopify only (higher margins justify Shopify fee)
4. **Content Agent** must pull from this table and never suggest a price below Min Price
