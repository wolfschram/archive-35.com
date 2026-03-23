# PHASE 8 — FIX EVERYTHING
## Claude Code: This is a bug fix phase. Fix every broken thing. Test every fix. Do not stop.
## Owner: Wolf Schram | Date: March 18, 2026

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK
**Log every decision to `Archive 35 Agent/data/build_log.json`**

---

## CONTEXT

Wolf has been testing the dashboard all day. Multiple things are broken. This phase fixes ALL of them in one pass. No new features — just make everything that exists actually work.

The Agent API runs in Docker on port 8035. The dashboard is at agent-dashboard.html served from Cloudflare Pages.

Source code is volume-mounted into Docker at `./src:/app/src` so code changes take effect after `docker compose restart agent-api`.

---

## BUG 1: REDDIT ENDPOINTS MISSING FROM API (CRITICAL)

The dashboard calls 6 Reddit endpoints that return 404:
- `/reddit/status`
- `/reddit/queue`
- `/reddit/mark-posted`
- `/reddit/skip`
- `/reddit/generate`
- `/reddit/login`

The routes exist in `src/routes/reddit_routes.py` but **may not be registered in api.py** inside the Docker container.

### Fix:
1. Check if `reddit_routes.router` is included in `api.py` with `app.include_router()`
2. If not, add it:
```python
from src.routes.reddit_routes import router as reddit_router
app.include_router(reddit_router)
```
3. Verify by restarting Docker and testing: `curl http://localhost:8035/reddit/status`

### Test:
```bash
curl -s http://localhost:8035/reddit/status | python3 -m json.tool
curl -s http://localhost:8035/reddit/queue | python3 -m json.tool | head -10
```

---

## BUG 2: CLOUDFLARE ANALYTICS RACE CONDITION (HIGH)

`loadFunnel()` and `loadTraffic()` both call `/analytics/cloudflare` and both write to global `cfData`. They run in parallel, creating a race condition where one overwrites the other.

### Fix:
Make `loadTraffic()` NOT depend on `cfData` at all. Always fetch its own data:

In `agent-dashboard.html`, find `loadTraffic()` and ensure it does:
```javascript
const d = await apiFetch('/analytics/cloudflare');
```
NOT:
```javascript
const d = cfData && cfData.configured !== undefined ? cfData : await apiFetch('/analytics/cloudflare');
```

Also fix `loadFunnel()`: it should `await` the cloudflare call and use the result directly, not cache to global:
```javascript
const cf = await apiFetch('/analytics/cloudflare').catch(() => ({}));
// Use cf.totals directly, don't assign to cfData
```

Better yet: fetch Cloudflare data ONCE in the tab loader, pass it to both functions:
```javascript
case 'overview':
  const cfData = await apiFetch('/analytics/cloudflare').catch(() => ({}));
  pollStatus();
  loadFeed();
  loadFunnel(cfData);
  loadTraffic(cfData);
  updateConnectivityMetrics(cfData);
  break;
```

Then change `loadFunnel(cfData)` and `loadTraffic(cfData)` to accept the data as a parameter instead of fetching it themselves.

### Test:
Refresh the dashboard, check Overview tab. Both the Revenue Funnel TRAFFIC column and the WEBSITE TRAFFIC section should show 868 visitors / 9,838 page views.

---

## BUG 3: ATHOS ANALYTICS MISSING ERROR HANDLING (HIGH)

The `/analytics/athos` endpoint crashes when Cloudflare returns a GraphQL error because it uses direct dictionary access (`d["dimensions"]["date"]`) instead of safe `.get()` calls.

### Fix:
Copy the same error handling pattern from `/analytics/cloudflare` to `/analytics/athos`:

```python
# Handle GraphQL errors
if data.get("errors"):
    return {"configured": True, "error": data["errors"][0].get("message", "Unknown"), "raw_errors": data["errors"]}

viewer = data.get("data") or {}
viewer = viewer.get("viewer") or {}
zones = viewer.get("zones") or []
if not zones:
    return {"configured": True, "error": "No zone data returned", "zone_id_used": zone_id}

zone = zones[0] or {}
daily = zone.get("httpRequests1dGroups") or []
top_pages = zone.get("httpRequestsAdaptiveGroups") or []
```

And use safe `.get()` in the list comprehensions:
```python
"daily_stats": [{
    "date": d.get("dimensions", {}).get("date", ""),
    "visitors": d.get("uniq", {}).get("uniques", 0),
    "page_views": d.get("sum", {}).get("pageViews", 0),
} for d in daily],
```

### Test:
```bash
curl -s http://localhost:8035/analytics/athos | python3 -m json.tool | head -20
```
Should return real data (929 visitors / 5,931 page views) or a clean error message.

---

## BUG 4: ATHOS SECTION ON ANALYTICS TAB SHOWS "ADD ZONE ID" (HIGH)

The ATHOS section on the Analytics tab shows "Add CLOUDFLARE_ATHOS_ZONE_ID to .env" even though the zone ID IS set in .env.

### Root Cause:
The dashboard HTML hardcodes the setup message instead of calling the API. OR the API endpoint returns `configured: false` because the Docker container's .env doesn't have the ATHOS zone ID.

### Fix:
1. Verify the Agent .env has: `CLOUDFLARE_ATHOS_ZONE_ID=c4d910b00018793d3db58d3fb2e867ff`
2. Verify Docker sees it: `docker compose exec agent-api env | grep ATHOS`
3. If the env var is missing inside Docker, the .env file mount might not be working. Check docker-compose.yml has `- ./.env:/app/.env`
4. In the dashboard HTML, find the ATHOS section and make it call `/analytics/athos` instead of checking env vars

### Test:
Analytics tab should show ATHOS visitor data (929 visitors, top page: /vocab/).

---

## BUG 5: REVENUE FUNNEL SHOWS "--" FOR TRAFFIC (HIGH)

The Revenue Funnel on Overview shows `--` for visitors even though `/analytics/cloudflare` returns 868.

### Root Cause:
Same race condition as Bug 2. `loadFunnel()` calls the API but `cfData` is not populated in time.

### Fix:
Same fix as Bug 2 — pass Cloudflare data as parameter to `loadFunnel()`.

### Test:
Revenue Funnel TRAFFIC column should show "868 visitors (7d)" and "9838 page views".

---

## BUG 6: INSTAGRAM SHOWS "NOT CONFIGURED" IN ATTENTION ITEMS (MEDIUM)

The Immediate Action section shows Instagram as "Not configured" with a warning chip, but Instagram IS configured (token valid until April 20, 12 posts today).

### Root Cause:
The health endpoint now returns `instagram_configured: true` (we added this). But the dashboard's Attention Items builder may still check a different condition.

### Fix:
In the dashboard HTML, find where Attention Items are built (search for "instagram" + "not configured"). Make it check `health.instagram_configured === true` — if true, don't show the warning.

Also verify `health.instagram_configured` is actually being returned by checking:
```bash
curl -s http://localhost:8035/health | python3 -c "import sys,json; print(json.load(sys.stdin).get('instagram_configured'))"
```

If it returns `true`, the dashboard just needs to check it properly.

### Test:
Instagram should NOT appear in "Needs Your Attention Now" section.

---

## BUG 7: REDDIT POST QUEUE — NO IMAGE PREVIEWS (MEDIUM)

Reddit posts show title + subreddit but no photo preview. Each post has an `image_id` field but the dashboard never looks up the image.

### Fix:
1. Each Reddit queue item has `image_id` (e.g., `A35-20260210-0002`)
2. Add a thumbnail lookup: try `/photos/{image_id}/thumbnail` endpoint
3. If that doesn't match (different ID format), use the licensing catalog to find the image
4. In the dashboard, for each Reddit post card, add an `<img>` tag:
```html
<img src="http://localhost:8035/photos/${post.image_id}/thumbnail?size=200"
     style="width:120px; height:80px; object-fit:cover; border-radius:8px; margin-right:12px;"
     onerror="this.style.display='none'">
```

### Test:
Reddit posts on the Social tab should show image thumbnails next to each title.

---

## BUG 8: REDDIT "SUBMIT ON REDDIT" OPENS WRONG URL (LOW)

The "Submit on Reddit" button opens `old.reddit.com/r/{subreddit}/submit` but the subreddit field in the queue includes "r/" prefix (e.g., `r/EarthPorn`), so the URL becomes `old.reddit.com/r/r/EarthPorn/submit` (double r/).

### Fix:
Strip the `r/` prefix before building the URL:
```javascript
const sub = post.subreddit.replace(/^r\//, '');
const url = `https://old.reddit.com/r/${sub}/submit`;
```

### Test:
Clicking "Submit on Reddit" should open the correct subreddit submit page.

---

## BUG 9: CONNECTIVITY PANEL SHOWS "--" METRICS (LOW)

External Systems shows "Cloudflare Connected --" instead of "Cloudflare Connected 868 visitors this week".

### Root Cause:
Same cfData race condition. The `updateConnectivityMetrics()` function runs before cfData is populated.

### Fix:
Same fix as Bug 2 — pass Cloudflare data directly to the function.

### Test:
External Systems should show "Cloudflare Connected 868 visitors this week".

---

## BUG 10: LIVE FEED SHOWS RAW JSON (LOW)

The Live Feed shows entries like `social post_dry_run {"content_id": "a82e290d-c6f9..."` instead of human-readable summaries.

### Fix:
Format feed entries based on component + action:
```javascript
function formatFeedEntry(entry) {
  const component = entry.component;
  const action = entry.action;

  // Human-readable translations
  const translations = {
    'system_startup': 'System started',
    'pipeline_daily_complete': 'Daily pipeline completed',
    'social_post_dry_run': 'Social post queued (dry run)',
    'content_generate': 'Content generated',
    'instagram_post': 'Instagram post published',
    'instagram_published': 'Instagram image published',
    'broadcast_complete': 'Broadcast completed',
    'etsy_seo_audit': 'Etsy SEO audit ran',
  };

  const key = `${component}_${action}`;
  return translations[key] || `${component}: ${action}`;
}
```

Hide the raw JSON details by default. Show a clean one-liner per entry.

### Test:
Live feed should show "Instagram post published" not `{"content_id": "..."}`.

---

## BUG 11: SCAN MODE TOGGLE DOES NOTHING (LOW)

"Needs Attention" / "All Systems" buttons in the left rail have no visible effect.

### Fix:
When "Needs Attention" is active:
- Hide platform tiles that are healthy (add CSS class `.scan-attention .platform-tile.healthy { display: none; }`)
- Filter live feed to errors/warnings only
- Keep Revenue Funnel and Sales Goal visible

When "All Systems" is active:
- Show everything

Store mode in sessionStorage. Toggle a class on the main content div.

### Test:
Clicking "Needs Attention" should hide healthy platform tiles. Clicking "All Systems" shows everything.

---

## DEPLOYMENT

After fixing all bugs:
1. Restart Docker: `cd "Archive 35 Agent" && docker compose restart agent-api`
2. Test ALL endpoints: run the curl tests listed above
3. Deploy dashboard: `python3 sync_gallery_data.py && git add agent-dashboard.html && git commit -m "[fix-all] Phase 8: Reddit endpoints, Cloudflare race condition, ATHOS errors, Instagram status, image previews, feed formatting" && git push`
4. Wait 2 minutes for Cloudflare
5. Verify on https://archive-35.com/agent-dashboard:
   - Overview: Revenue Funnel shows real traffic numbers
   - Overview: Website Traffic shows 868 visitors, 9838 page views, top pages
   - Overview: Instagram NOT in Attention Items
   - Social: Reddit posts have image thumbnails
   - Social: "Submit on Reddit" opens correct URL
   - Analytics: ATHOS shows real visitor data
   - External Systems shows metrics next to connection status

---

# ESTIMATED TIME: 3-4 hours
# FIX ALL 11 BUGS. TEST EACH ONE. DO NOT STOP.
# LOG EVERYTHING TO build_log.json.

---

*Phase 8 created March 18, 2026. Pure bug fixes — no new features. Make everything that exists actually work.*
