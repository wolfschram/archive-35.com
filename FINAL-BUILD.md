# FINAL BUILD — Make Everything Real
## Claude Code: This is the last spec. Do it right. Verify your own work. No skeletons.
## Owner: Wolf Schram | Date: March 18, 2026 (evening)

---

## READ THIS FIRST — EVERY WORD

Previous builds left skeletons: endpoints that return 402 with "coming soon," dashboard sections that show "loading..." forever, payment systems that advertise crypto but only accept Stripe. Wolf has spent an entire day testing and finding broken things.

**This build has ONE rule: nothing ships as a skeleton.**

If you build an endpoint, it must work end to end. If you add a button, clicking it must do something real. If you advertise USDC payments, agents must be able to actually pay in USDC.

**VERIFICATION REQUIREMENT:**
When you finish ALL tasks, go back to the top of this document and re-read every single task. For each one, run the test command listed. If it fails, fix it before moving on. Log every test result to `Archive 35 Agent/data/build_log.json`. This is not optional.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK
**Log every decision to `Archive 35 Agent/data/build_log.json`**

## RULES
1. Read CLAUDE.md first
2. NEVER change Stripe keys or webhook endpoints without testing
3. NEVER deploy without `python3 sync_gallery_data.py`
4. Agent API = port 8035 (Docker, source mounted at ./src:/app/src)
5. After code changes: `docker compose restart agent-api` (source is live-mounted)
6. After dashboard changes: `python3 sync_gallery_data.py && git add agent-dashboard.html && git commit && git push`
7. DO NOT leave anything as a TODO or "coming soon" — finish it or don't build it

---

# SECTION A: FINISH THE x402 USDC PAYMENT SYSTEM

This is the #1 priority. The x402 endpoints exist but payment verification is a stub. Fix it.

## A1: INSTALL x402 PACKAGES

The x402 protocol has official packages. Since the gallery endpoint runs on Cloudflare Functions (Node.js), install the Node packages:

```bash
cd ~/Documents/ACTIVE/archive-35
npm install @x402/core @x402/evm
```

If using Cloudflare Workers/Functions, these may need to be bundled. Check if `functions/` uses wrangler or if Cloudflare Pages Functions auto-bundle node_modules. If not, the x402 verification can also be done via a direct HTTP call to the facilitator.

## A2: IMPLEMENT PAYMENT VERIFICATION IN [image_id].js

File: `functions/api/license/[image_id].js`

The current code at the payment verification section says: "On-chain verification not yet implemented — coming with CDP SDK integration"

**Replace the stub with real verification:**

```javascript
// The x402 facilitator handles verification
const FACILITATOR_URL = "https://x402.org/facilitator";

async function verifyPayment(paymentHeader, expectedAmount, expectedRecipient) {
  // The x402 protocol sends payment proof in the X-PAYMENT header
  // The facilitator verifies the on-chain transaction
  try {
    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment: paymentHeader,
        expectedAmount: expectedAmount,
        expectedRecipient: expectedRecipient,
        network: "base",
        currency: "USDC",
      }),
    });

    if (!response.ok) {
      return { valid: false, error: `Facilitator returned ${response.status}` };
    }

    const result = await response.json();
    return {
      valid: result.valid === true,
      txHash: result.txHash || null,
      error: result.error || null,
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
```

**Update the request handler:**

When a request comes in with `X-PAYMENT` header:
1. Extract the payment header
2. Call `verifyPayment()` with the expected amount for the requested tier
3. If valid: generate signed download URL and return the image
4. If invalid: return 402 with error details

When a request comes in WITHOUT `X-PAYMENT` header:
1. Return 402 with the payment requirements (this already works)

**Test:**
```bash
# Should return 402 with payment requirements (no payment header)
curl -s -o /dev/null -w "%{http_code}" https://archive-35.com/api/license/A35-20260210-0001
# Expected: 402
```

## A3: UPDATE gallery.js TO USE OFFICIAL x402 RESPONSE FORMAT

The gallery.js discovery endpoint should return x402-compliant response headers. Check the x402 spec for the exact `PAYMENT-REQUIRED` header format. The response should include:
- `X-Payment-Required: true`
- `X-Payment-Network: base`
- `X-Payment-Currency: USDC`
- `X-Payment-Facilitator: https://x402.org/facilitator`
- Per-image payment amounts

## A4: ADD STRIPE CHECKOUT WITH $2.50 MINIMUM

In `functions/api/micro-license/checkout.js`:
- Change the web tier from $0.50 to $2.50
- Remove the $0.01 thumbnail tier entirely (loses money after Stripe fees)
- Keep commercial at $2.50 or raise to $5.00

Update micro-licensing.html to reflect new prices.

## A5: IMPLEMENT PREPAID CREDITS

Create a new Cloudflare Function: `functions/api/credits/purchase.js`

Flow:
1. Agent or human purchases $25 credit pack via Stripe
2. System creates a credit balance record (KV storage)
3. Agent can then request images using their API key + credit balance
4. Each image deducts from credit balance ($0.50 for web, $2.50 for commercial)
5. No per-transaction Stripe fees after initial purchase

Endpoints:
- `POST /api/credits/purchase` — creates Stripe checkout for $25 credit pack
- `GET /api/credits/balance?api_key={key}` — returns remaining credits
- `POST /api/credits/redeem` — deducts credits and returns signed download URL

**Test:**
```bash
# Should create a checkout session
curl -s -X POST https://archive-35.com/api/credits/purchase -H "Content-Type: application/json" -d '{"amount": 25}'
```

---

# SECTION B: EXPAND LICENSING CATALOG TO 500+ IMAGES

## B1: GENERATE LICENSING CATALOG FROM FULL PHOTO LIBRARY

The current licensing catalog has 166 images. The photos.json has 1,109. Expand the catalog.

File to modify: The script that generates `data/licensing-catalog.json`

If no generation script exists, create one at: `06_Automation/scripts/expand_catalog.py`

The script should:
1. Read `data/photos.json` (1,109 images)
2. For each image, determine classification (ULTRA/PREMIUM/STANDARD based on resolution)
3. Generate pricing tiers based on classification
4. Check if the image exists in `09_Licensing/` or `01_Portfolio/` for source files
5. Output expanded `data/licensing-catalog.json` with 500+ images minimum
6. Preserve existing 166 entries (don't break anything already working)

Classification rules:
- ULTRA: 15000px+ on longest side → starting at $350
- PREMIUM: 8000px+ → starting at $280
- STANDARD: 4000px+ → starting at $200

## B2: RUN IMAGE PREPARATION PIPELINE ON ALL NEW IMAGES

Use existing `06_Automation/scripts/prepare_micro_license.py` to generate micro-license versions for all catalog images:
- thumbnail (1200x630, 85q)
- web (2400xH, 92q)
- premium (4000xH, 95q)
- watermarked preview

Run it on at least 500 images. Store output in `09_Licensing/micro/`

**Test:**
```bash
ls 09_Licensing/micro/ | wc -l
# Expected: 2000+ files (4 versions × 500+ images)
```

---

# SECTION C: EMBED IPTC/XMP METADATA IN ALL IMAGES

## C1: CREATE IPTC METADATA EMBEDDING SCRIPT

File: `06_Automation/scripts/embed_iptc_metadata.py`

For every image in `09_Licensing/micro/` and `09_Licensing/watermarked/`:

Embed these IPTC/XMP fields:
- **Copyright**: "© 2026 Wolf Schram / Archive-35. All rights reserved."
- **Creator**: "Wolf Schram"
- **Credit**: "Archive-35 / The Restless Eye"
- **Source**: "archive-35.com"
- **Contact**: "wolf@archive-35.com"
- **Rights Usage Terms**: "Licensed image. Terms at https://archive-35.com/terms.html"
- **Web Statement of Rights**: "https://archive-35.com/terms.html"
- **Licensor URL**: "https://archive-35.com/licensing.html"
- **Special Instructions**: "C2PA verified authentic photography. NOT AI generated. License required for any use."

Use `piexif` or `iptcinfo3` or `Pillow` with XMP sidecar. Choose whichever library is available or install what's needed.

**Test:**
```bash
python3 -c "
from PIL import Image
img = Image.open('09_Licensing/micro/A35-20260210-0001_web.jpg')
print(img.info.get('exif', b'')[:100])
"
# Should show embedded metadata
```

---

# SECTION D: SCHEMA.ORG LICENSE URLS ON ALL IMAGES

## D1: ADD acquireLicensePage AND license TO SCHEMA.ORG

Modify `06_Automation/scripts/inject_schema.py` to add per-image license properties.

On `licensing.html` and `micro-licensing.html`, the schema.org JSON-LD should include:

```json
{
  "@type": "ImageGallery",
  "mainEntity": {
    "@type": "ItemList",
    "itemListElement": [
      {
        "@type": "ImageObject",
        "name": "Desert Dunes: Vast Solitude",
        "contentUrl": "https://archive-35.com/images/watermarked/A35-20260210-0002.jpg",
        "thumbnailUrl": "https://archive-35.com/images/thumbnails/A35-20260210-0002.jpg",
        "license": "https://archive-35.com/terms.html",
        "acquireLicensePage": "https://archive-35.com/micro-licensing.html?image=A35-20260210-0002",
        "creditText": "Wolf Schram / Archive-35",
        "copyrightNotice": "© 2026 Wolf Schram",
        "creator": {
          "@type": "Person",
          "name": "Wolf Schram"
        }
      }
    ]
  }
}
```

This tells Google Images and AI agents: "This image is licensable. Here's where to buy it."

You don't need a separate URL per image. The `acquireLicensePage` points to micro-licensing.html with a query parameter. The page can scroll to or highlight that specific image.

**Test:**
Validate JSON-LD at https://search.google.com/test/rich-results after deploy.

---

# SECTION E: UPDATE llms.txt WITH MICRO-LICENSING

## E1: ADD MICRO-LICENSING SECTION TO llms.txt

The current llms.txt only mentions full licensing ($350+). Add a section for micro-licensing:

```
## Micro-Licensing (AI Agents & Web Use)

For automated image procurement, web thumbnails, blog posts, and social media:

- Web/Social license: $2.50 per image (2400px, 1-year license)
- Commercial license: $5.00 per image (full resolution, 2-year license + certificate)
- Prepaid credits: $25 for 10 web licenses ($2.50 each) — bulk pricing available
- Payment: USDC on Base network (x402 protocol) OR Stripe (USD)

API Endpoint: https://archive-35.com/api/license/gallery
Search by: subject, mood, location, orientation, use_case
Protocol: HTTP 402 (x402) — agents pay automatically via USDC
Facilitator: https://x402.org/facilitator (Coinbase, 1000 free tx/month)

Catalog: 500+ images from 55+ countries
All images: C2PA verified authentic photography (NOT AI generated)
Metadata: IPTC rights embedded in all licensed files

MCP Server: .well-known/mcp/server.json
OpenAPI Spec: .well-known/openapi.json
```

---

# SECTION F: MCP REGISTRY SUBMISSION + OPENAPI SPEC

## F1: GENERATE OPENAPI SPEC

Create `/.well-known/openapi.json` describing the licensing API:

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Archive-35 Photography Licensing API",
    "version": "1.0.0",
    "description": "Search and license authentic fine art photography. 500+ C2PA verified images from 55+ countries.",
    "contact": { "email": "wolf@archive-35.com" }
  },
  "servers": [
    { "url": "https://archive-35.com" }
  ],
  "paths": {
    "/api/license/gallery": {
      "get": {
        "summary": "Search photography catalog",
        "parameters": [
          { "name": "subject", "in": "query", "schema": { "type": "string", "enum": ["landscape","wildlife","urban","abstract","travel","architecture","ocean","desert","aerial"] } },
          { "name": "mood", "in": "query", "schema": { "type": "string", "enum": ["dramatic","minimalist","warm","cold","documentary","serene"] } },
          { "name": "location", "in": "query", "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 50 } }
        ],
        "responses": {
          "200": { "description": "Search results with images and pricing" }
        }
      }
    },
    "/api/license/{image_id}": {
      "get": {
        "summary": "License a specific image",
        "parameters": [
          { "name": "image_id", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "tier", "in": "query", "schema": { "type": "string", "enum": ["web","commercial"], "default": "web" } }
        ],
        "responses": {
          "402": { "description": "Payment required — includes x402 payment details in headers" },
          "200": { "description": "Licensed image download URL (after payment verified)" }
        }
      }
    }
  }
}
```

## F2: SUBMIT TO MCP REGISTRY

The MCP registry is at modelcontextprotocol.io. To submit:

1. Check if there's a submission form or GitHub PR process
2. If PR-based: fork the registry repo, add Archive-35 entry, submit PR
3. If form-based: fill in the details from `.well-known/mcp/server.json`

If neither is immediately possible, at minimum ensure:
- `.well-known/mcp/server.json` is deployed and accessible
- `/.well-known/openapi.json` is deployed and accessible
- `llms.txt` references both files
- `robots.txt` allows crawling of both files

---

# SECTION G: FIX ALL DASHBOARD BUGS (FROM PHASE 8)

These are the 11 bugs from PHASE-8-FIX-EVERYTHING.md. Fix ALL of them.

## G1: Reddit endpoints 404
The `reddit_routes.py` router must be included in `api.py`. Verify with:
```bash
curl -s http://localhost:8035/reddit/status | python3 -m json.tool
```

## G2: Cloudflare analytics race condition
`loadTraffic()` and `loadFunnel()` must each fetch their own data or share a single fetch. No global `cfData` race.

## G3: ATHOS analytics error handling
Copy the robust error handling from cloudflare endpoint to athos endpoint.

## G4: ATHOS "add zone ID" message
Verify `CLOUDFLARE_ATHOS_ZONE_ID=c4d910b00018793d3db58d3fb2e867ff` is in Agent .env and Docker sees it.

## G5: Revenue Funnel shows "--" for traffic
Same fix as G2. After fix, verify funnel shows: 700+ visitors, 9000+ page views.

## G6: Instagram false "not configured" warning
Health endpoint returns `instagram_configured: true`. Dashboard must check this field.

## G7: Reddit posts missing image thumbnails
Each post has `image_id`. Load thumbnail via `/photos/{image_id}/thumbnail`.

## G8: Reddit submit URL double r/
Strip `r/` prefix: `post.subreddit.replace(/^r\//, '')`

## G9: Connectivity panel "--" metrics
Pass Cloudflare data to connectivity update function.

## G10: Live feed raw JSON
Format entries as human-readable one-liners. Hide raw JSON.

## G11: Scan mode toggle
"Needs Attention" hides healthy tiles. "All Systems" shows all.

**Test each bug after fixing:**
```bash
# G1
curl -s http://localhost:8035/reddit/status | python3 -c "import sys,json; print(json.load(sys.stdin))"
# G2/G5
# Refresh dashboard, check Revenue Funnel TRAFFIC column shows numbers not "--"
# G4
curl -s http://localhost:8035/analytics/athos | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totals',{}).get('visitors_7d','FAILED'))"
# G6
curl -s http://localhost:8035/health | python3 -c "import sys,json; print('IG:', json.load(sys.stdin).get('instagram_configured'))"
```

---

# SECTION H: DEPLOY AND VERIFY

## H1: RESTART DOCKER
```bash
cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent
docker compose restart agent-api
```

## H2: TEST ALL API ENDPOINTS
Run every test command from Sections A-G. Log results.

## H3: DEPLOY DASHBOARD
```bash
cd ~/Documents/ACTIVE/archive-35
python3 sync_gallery_data.py
git add .
git commit -m "[final-build] x402 USDC live, catalog expanded, IPTC metadata, schema.org licenses, MCP/OpenAPI published, all bugs fixed"
git push
```

## H4: VERIFY PRODUCTION
After Cloudflare deploys (2 minutes):
- https://archive-35.com/agent-dashboard — all sections have real data
- https://archive-35.com/api/license/gallery — returns catalog with x402 pricing
- https://archive-35.com/api/license/A35-20260210-0001 — returns 402 with payment requirements
- https://archive-35.com/.well-known/openapi.json — valid OpenAPI spec
- https://archive-35.com/.well-known/mcp/server.json — valid MCP descriptor
- https://archive-35.com/llms.txt — includes micro-licensing section
- https://archive-35.com/micro-licensing.html — shows $2.50 minimum price

---

# SECTION I: SELF-VERIFICATION (MANDATORY)

**After completing ALL sections above:**

1. Re-read this entire document from the top
2. For each section, verify:
   - Did I build it or skip it?
   - If I built it, does it actually work?
   - Run the test command. Does it pass?
3. If ANY test fails: go back and fix it before logging completion
4. Log the final verification results to build_log.json:

```json
{
  "timestamp": "ISO8601",
  "task": "FINAL-BUILD Self-Verification",
  "action": "Re-read entire spec, tested all endpoints",
  "results": {
    "A_x402_payment": "pass/fail — reason",
    "B_catalog_expansion": "pass/fail — image count",
    "C_iptc_metadata": "pass/fail — sample check",
    "D_schema_license_urls": "pass/fail — validation",
    "E_llms_txt": "pass/fail — micro-licensing present",
    "F_openapi_mcp": "pass/fail — accessible",
    "G_dashboard_bugs": "pass/fail — list any remaining"
  }
}
```

5. If anything is "fail," fix it NOW — don't log and move on

---

# ESTIMATED TOTAL TIME: 10-14 hours
# THIS IS THE FINAL BUILD. NO MORE SKELETONS. NO MORE "COMING SOON."
# EVERYTHING WORKS OR IT DOESN'T SHIP.
# VERIFY YOUR OWN WORK BEFORE SAYING YOU'RE DONE.

---

*Final Build specification created March 18, 2026 evening. Cross-referenced against ChatGPT micro-licensing research paper and full system audit. Self-verification required.*

Sources referenced:
- [x402 Protocol Documentation](https://docs.cdp.coinbase.com/x402/welcome)
- [Coinbase x402 GitHub](https://github.com/coinbase/x402)
- [x402 Implementation Guide](https://www.quicknode.com/guides/infrastructure/how-to-use-x402-payment-required)
- [CDP SDK Python](https://github.com/coinbase/cdp-sdk-python)
