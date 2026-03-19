# MORNING FIXES — March 19, 2026
## Claude Code: Fix all of these. Test each one. Log results.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK
**Log to `Archive 35 Agent/data/build_log.json`**

---

## FIX 1: Reddit Image Thumbnails
Reddit posts on the Social tab show title + subreddit but no photo.
Each post in `reddit_queue.json` has an `image_id` field.

In agent-dashboard.html, where Reddit posts are rendered, add an image tag:
```html
<img src="http://localhost:8035/photos/${post.image_id}/thumbnail?size=200"
     style="width:120px;height:80px;object-fit:cover;border-radius:8px;float:left;margin-right:12px;"
     onerror="this.style.display='none'">
```

If the image_id doesn't match (different format from photos DB), check licensing-catalog.json for the mapping.

**Test:** Social tab Reddit section shows image thumbnails next to post titles.

---

## FIX 2: Filter Bot Probes from Top Pages
The Website Traffic top pages shows `/.env.backup`, `/api/credentials`, `/dev/.env` — these are security scanners.

In the Cloudflare analytics display code in agent-dashboard.html, filter out known bot paths:
```javascript
const botPaths = ['.env', 'wp-admin', 'credentials', 'config.json', 'xmlrpc', 'wp-login', '.git', 'phpmyadmin'];
const filteredPages = topPages.filter(p => !botPaths.some(bp => p.path.includes(bp)));
```

**Test:** Top pages shows real pages (/, /gallery.html, /licensing.html) not bot probes.

---

## FIX 3: API Spend — Show Anthropic Billing
The API Spend KPI card should show Anthropic API costs, not internal dashboard action costs.

Option A: If Anthropic has a usage API, call it.
Option B: Pull from the audit_log where component='content' and action='generate' — these all have cost fields that represent Claude API calls. Sum costs for today.

The current code likely sums all audit_log costs. Just make sure it's labeled "Anthropic API" and sums the right entries.

**Test:** API Spend KPI shows today's Anthropic API cost (should be ~$0.00 if no content generation ran today).

---

## FIX 4: Agents Live —/—
The Agents Live KPI card shows `--/--`. This should show how many Docker services are running.

Call `GET /agents/status` (if it exists) or calculate from health data:
- Count agents that have recent activity in agent_state/*.json
- Or hardcode: "3 services" (api, scheduler, telegram) and check Docker status

At minimum, show "3/3" when the API is online (since all 3 Docker containers are up).

**Test:** Agents Live shows "3/3" or similar.

---

## FIX 5: Dashboard Pricing Shows Old Tiers
The Analytics tab Micro-Licensing section still shows $0.01 / $0.50 / $2.50.

Update to: Web $2.50 / Commercial $5.00 / Prepaid Credits $25 pack.

Search agent-dashboard.html for "0.01" and "0.50" and update all pricing references.

**Test:** Analytics tab shows correct $2.50 / $5.00 pricing.

---

## FIX 6: Verify micro-licensing.html Prices
Check if `micro-licensing.html` was updated by FINAL-BUILD to show $2.50/$5.00 or still shows old $0.50.
Also check `functions/api/micro-license/checkout.js` for the actual Stripe price.

If still old prices, update both the HTML and the checkout function.

**Test:** `curl -s https://archive-35.com/micro-licensing.html | grep -o '\$[0-9.]*' | sort -u`

---

## FIX 7: Scan Mode — Don't Hide Healthy Tiles
Wolf says: "Nothing should be hidden." Both "Needs Attention" and "All Systems" should show all tiles.

The difference between modes should be visual emphasis, not visibility:
- **Needs Attention**: Warning/error tiles get prominent colored borders. Healthy tiles are dimmed (opacity 0.6) but still visible.
- **All Systems**: All tiles at full opacity and equal emphasis.

Remove any `display:none` logic for healthy tiles in scan mode.

**Test:** Click "Needs Attention" — all tiles still visible, warnings highlighted. Click "All Systems" — all tiles equal.

---

## FIX 8: Add Password Protection Back
Wolf says the dashboard is a public page and needs password protection.

Re-add the login screen that was removed. Simple approach:
- Show a login overlay on page load
- Single password field
- Store in sessionStorage after successful login
- Password: check if there's an existing password in the code history, or use a simple one Wolf can change

The password should be stored as a hash, not plaintext. But for now, a simple check is fine — Wolf will change it later.

**Test:** Opening the dashboard URL shows login screen first.

---

## FIX 9: Create Prepaid Credits Function
The `/api/credits/balance` endpoint returns 404. The credits system needs to be created as Cloudflare Functions.

Create:
- `functions/api/credits/purchase.js` — creates Stripe checkout for $25 credit pack
- `functions/api/credits/balance.js` — returns credit balance for an API key
- `functions/api/credits/redeem.js` — deducts credits and returns download URL

Use Cloudflare KV (bind a new namespace `CREDITS`) for storing balances.

**Test:**
```bash
curl -s https://archive-35.com/api/credits/purchase -X POST -H "Content-Type: application/json" -d '{"amount": 25}'
# Should return Stripe checkout URL
```

---

## FIX 10: Pinterest Manual Workflow
Pinterest API is in trial mode (can't write pins). Token expires March 27.

For the dashboard:
1. Show Pinterest status as "Trial Access — Manual Upload Required"
2. Add a "Download Pin Pack" button that zips the 52 pin images + CSV for manual upload
3. Add link to Pinterest create pin page: `https://www.pinterest.com/pin-creation-tool/`
4. Remove any buttons that try to use the Pinterest write API (they'll just fail with 403)

For the token: Check if the refresh endpoint works to extend it past March 27. If the token is trial-only, refreshing won't help — we need full API approval from Pinterest.

**Test:** Pinterest section shows "Trial Access" and has manual upload instructions.

---

## DEPLOYMENT

```bash
cd ~/Documents/ACTIVE/archive-35
docker compose -f "Archive 35 Agent/docker-compose.yml" restart agent-api
python3 sync_gallery_data.py
git add agent-dashboard.html functions/api/credits/
git commit -m "[morning-fixes] Reddit thumbnails, bot filter, pricing update, scan mode, login, credits endpoint"
git push
```

---

# FIX ALL 10 ITEMS. TEST EACH ONE. LOG RESULTS.
