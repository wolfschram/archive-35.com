# Micro-Licensing Checkout Overhaul — Handoff for Claude Code
Last updated: March 19, 2026

---

## The Problem

The micro-licensing page (`micro-licensing.html`) has NO shopping cart. Every image purchase is a separate Stripe Checkout Session. The main site (prints, full licensing) has a full cart system (`cart.js` + `cart-ui.js`) with slide-out panel, multi-item support, and single-session checkout.

This means:
- A human buying 5 micro-license images pays 5× the $0.30 Stripe fixed fee ($1.50 wasted vs $0.30 with cart)
- The UX is jarring — click Buy, redirected to Stripe, come back, repeat
- The $25 credit pack exists (`/api/credits/purchase`) but has no redemption UI
- AI agents (x402/Commerce MCP) can only buy one image per transaction

## Three Priorities — Build in Order

---

### Priority 1: Wire Existing Cart into Micro-Licensing Page

**Goal:** Let humans add multiple micro-license images to cart, check out once.

**What already exists (DO NOT rebuild):**
- `js/cart.js` — ShoppingCart class, localStorage persistence, custom events
- `js/cart-ui.js` — CartUI class, slide-out panel, badge, checkout flow
- `/api/create-checkout-session` — Handles multi-line-item Stripe sessions with license metadata
- `stripe-webhook.js` — Already handles `orderType: 'micro-license'` fulfillment

**What needs to change:**

1. **`micro-licensing.html`** — Add script tags for cart.js and cart-ui.js:
   ```html
   <script src="js/cart.js"></script>
   <script src="js/cart-ui.js"></script>
   ```

2. **`micro-licensing.html` modal** — Change the buy buttons from instant-checkout to add-to-cart:
   - Current: `onclick="buyLicense('${img.id}', 'web')"` → instant Stripe redirect
   - New: `onclick="addMicroToCart('${img.id}', 'web')"` → adds to cart, shows toast
   - Keep a "Buy Now" option for single-image instant purchase (some users prefer it)
   - Add "Add to Cart" as the primary action

3. **New function `addMicroToCart(imageId, tier)`** in micro-licensing.html:
   ```javascript
   function addMicroToCart(imageId, tier) {
     const img = catalog.find(i => i.id === imageId);
     if (!img) return;
     
     const prices = { web: 2.50, commercial: 5.00 };
     const tierNames = { web: 'Web / Social License', commercial: 'Commercial License' };
     
     window.cart.addToCart({
       photoId: imageId,
       title: img.title,
       material: 'license',
       size: tier === 'web' ? '2400px' : '4000px',
       price: prices[tier],
       thumbnail: img.thumbnail,
       metadata: {
         photoId: imageId,
         material: 'license',
         licenseTier: tier,
         licenseClassification: img.classification || 'STANDARD',
         photoFilename: img.original_filename || img.filename,
         collection: img.collection || '',
         width: 0,
         height: 0
       }
     });
     
     if (window.cartUI) window.cartUI.showToast(`Added to cart: ${img.title}`);
     closeModal();
   }
   ```

4. **Verify the checkout flow works end-to-end:**
   - Cart checkout calls `/api/create-checkout-session` with multiple line items
   - That endpoint already separates `printItems` vs `licenseItems` in the request
   - The webhook already handles license fulfillment
   - Test: add 3 micro-license images to cart → checkout → verify webhook fires for all 3

**Verification checklist:**
- [ ] Cart icon appears on micro-licensing.html header
- [ ] "Add to Cart" button works in image modal
- [ ] Cart slide-out shows micro-license items with correct prices
- [ ] Cart total is correct
- [ ] Single Stripe Checkout Session created with all items
- [ ] Webhook processes all items (not just first)
- [ ] Download links work for all purchased images
- [ ] "Buy Now" still works for single-item instant purchase

---

### Priority 2: Wire Up Credit Pack Redemption

**Goal:** The $25 credit pack (10 images) exists as a purchase endpoint but has no redemption flow.

**What already exists:**
- `/api/credits/purchase.js` — Creates Stripe session for $25 credit pack
- `/api/credits/balance.js` — Returns credit balance (needs to be checked — may be stub)
- `/api/credits/redeem.js` — Redeems credit for image (needs to be checked — may be stub)

**What needs to be built:**

1. **Credit storage** — After credit pack purchase, webhook must store credits somewhere:
   - Option A: Cloudflare KV (already bound to project, per LESSONS-LEARNED)
   - Option B: Stripe customer metadata
   - Recommendation: Cloudflare KV with key = Stripe customer ID, value = credit count

2. **Credit balance check** — `balance.js` needs to actually read from KV

3. **Credit redemption flow on micro-licensing.html:**
   - If user has credits > 0, show "Use Credit" button alongside "Add to Cart" and "Buy Now"
   - "Use Credit" calls `/api/credits/redeem` with image_id + tier
   - Server deducts 1 credit from KV, returns download URL
   - No Stripe involved — instant delivery

4. **Credit pack UI** — Add a "Buy 10 for $25" banner/button on micro-licensing.html
   - Currently no UI exists for this
   - Should be prominent — saves $2.50 per image vs individual purchase

**Verification checklist:**
- [ ] Credit pack purchase creates Stripe session correctly
- [ ] Webhook stores credits in KV after successful payment
- [ ] Balance endpoint returns correct count
- [ ] Redeem endpoint deducts credit and returns download URL
- [ ] "Use Credit" button appears when balance > 0
- [ ] Credits work for both web and commercial tiers (1 credit = 1 web OR 1 commercial)

---

### Priority 3: Batch API for AI Agents

**Goal:** AI agents can purchase multiple images in one transaction.

**What already exists:**
- `/api/license/[image_id].js` — x402 single-image purchase
- `/api/commerce/feed.json.js` — Catalog feed for AI agents
- `/api/commerce/checkout_sessions.js` — Commerce checkout
- `06_Automation/archive35_commerce_mcp.py` — MCP server for agent discovery

**What needs to be built:**

1. **`/api/commerce/batch-license.js`** — New Cloudflare Function:
   ```
   POST /api/commerce/batch-license
   Body: {
     images: [
       { image_id: "xxx", tier: "web" },
       { image_id: "yyy", tier: "commercial" }
     ],
     payment_method: "stripe" | "x402"
   }
   ```
   
   For Stripe: Creates single checkout session with multiple line items, returns session URL
   For x402: Returns total USDC amount needed, single payment address, callback URL
   
   On payment confirmation: Returns array of download URLs for all images

2. **Update Commerce MCP** — Add `batch_purchase` tool:
   - Input: list of image IDs + tiers
   - Calls batch-license endpoint
   - Returns checkout URL or payment instructions

3. **Update `feed.json.js`** — Add `batch_endpoint` field to catalog metadata so agents know the batch URL exists

**Verification checklist:**
- [ ] Batch endpoint accepts array of images
- [ ] Single Stripe session created with correct total
- [ ] All images delivered after payment
- [ ] Commerce MCP tool works for batch purchases
- [ ] Agent can browse catalog → select images → batch purchase → receive downloads

---

## Files You'll Touch

| File | Change |
|------|--------|
| `micro-licensing.html` | Add cart scripts, add-to-cart function, credit UI |
| `js/cart-ui.js` | May need minor tweaks for license item display |
| `functions/api/credits/balance.js` | Implement KV read |
| `functions/api/credits/redeem.js` | Implement KV deduct + download URL |
| `functions/api/stripe-webhook.js` | Add credit pack fulfillment (KV write) |
| `functions/api/commerce/batch-license.js` | NEW — batch purchase endpoint |
| `06_Automation/archive35_commerce_mcp.py` | Add batch_purchase tool |
| `functions/api/commerce/feed.json.js` | Add batch_endpoint to metadata |

## Stripe Fee Math (Why This Matters)

| Scenario | Revenue | Stripe Fees | Net | Fee % |
|----------|---------|-------------|-----|-------|
| 5 images × $2.50 individual | $12.50 | 5 × ($0.30 + 2.9%) = $1.86 | $10.64 | 14.9% |
| 5 images × $2.50 in cart | $12.50 | 1 × ($0.30 + 2.9%) = $0.66 | $11.84 | 5.3% |
| 10 images via $25 credit pack | $25.00 | 1 × ($0.30 + 2.9%) = $1.03 | $23.97 | 4.1% |

The cart pays for itself on the FIRST multi-image purchase.

## DO NOT

- Rebuild cart.js or cart-ui.js — they work, just wire them in
- Break the existing single-item `buyLicense()` flow — keep it as "Buy Now" option
- Touch the print/full-license checkout flow — it already works with the cart
- Modify Stripe keys or webhook endpoints without Wolf
- Skip the verification checklists
