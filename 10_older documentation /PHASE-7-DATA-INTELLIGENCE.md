# PHASE 7 BUILD — Data Intelligence: Make the Dashboard Tell the Story
## Claude Code: Read this top to bottom. Build everything. Do not stop until done.
## Owner: Wolf Schram | Date: March 18, 2026

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK
**Log every decision to `Archive 35 Agent/data/build_log.json`**

---

## THE PROBLEM — READ THIS CAREFULLY

The dashboard shows STATUS but not STORY. It shows "connected" but not "working." Wolf doesn't care that Cloudflare is connected — he cares how many people visited his site this week. He doesn't care that broadcasts ran 15 times — he cares whether Bing actually indexed his pages and whether AI agents are finding him.

Every widget currently answers: **"Is it on?"**
Every widget MUST answer: **"Is it working? Is it making money?"**

## THE REVENUE FUNNEL — THIS IS THE SPINE OF EVERYTHING

```
DISCOVERY (Broadcast, IndexNow, Schema.org)
  → You tell search engines "I exist"
  → Metric: Pages indexed by Bing/Google, URLs submitted

TRAFFIC (Cloudflare Analytics)
  → People and AI agents visit your site
  → Metric: Visitors/day, page views, avg time on site, top pages

ENGAGEMENT (Instagram, Reddit, Pinterest)
  → Social channels drive awareness
  → Metric: Impressions → profile visits → website clicks → follows

INTEREST (Etsy views, website licensing page, micro-licensing)
  → Visitors browse your work
  → Metric: Etsy views, favorites, licensing page visits

CONVERSION (Orders, licenses, revenue)
  → Money comes in
  → Metric: $X from Etsy + $X from Stripe + $X from micro-licenses

GOAL: $5,000
```

**Every single widget on the dashboard must show where it sits in this funnel and whether it's moving the needle toward $5,000.**

---

## RULES
1. Read CLAUDE.md
2. NEVER deploy without `python3 sync_gallery_data.py`
3. All dashboard changes in `agent-dashboard.html`
4. New API endpoints in `Archive 35 Agent/src/api.py`
5. Credentials in `.env` — never commit them

---

# TASK 1: CLOUDFLARE ANALYTICS API INTEGRATION
**Time: 2-3 hours**
**This is the #1 most important task. Real visitor data changes everything.**

## What We Need

Pull from Cloudflare Analytics API:
- **Visitors today / this week / this month**
- **Page views by page** (which photos are people looking at?)
- **Average visit duration** (are they staying or bouncing?)
- **Top pages** (what draws people in?)
- **Traffic by country** (where are buyers coming from?)
- **Unique visitors over time** (is traffic growing?)

## How to Get the API Token

Wolf's site runs on Cloudflare Pages. The Cloudflare API can return analytics.

1. Check if `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` exist in `.env`
2. If not, create the variables with placeholder values and log instructions:
   - Go to dash.cloudflare.com → My Profile → API Tokens → Create Token
   - Use the "Analytics Read" template
   - Zone: archive-35.com
   - Copy token to .env as `CLOUDFLARE_API_TOKEN`
   - Get Zone ID from the archive-35.com overview page → copy to `CLOUDFLARE_ZONE_ID`

## API Endpoint to Create

```python
@app.get("/analytics/cloudflare")
def get_cloudflare_analytics():
    """Pull real visitor data from Cloudflare Analytics API."""
    import httpx

    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID")

    if not token or not zone_id:
        return {
            "configured": False,
            "setup_instructions": "Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to .env. Get token from dash.cloudflare.com → API Tokens → Analytics Read template."
        }

    headers = {"Authorization": f"Bearer {token}"}

    # Cloudflare GraphQL Analytics API
    query = """
    query {
      viewer {
        zones(filter: {zoneTag: "%s"}) {
          httpRequests1dGroups(limit: 7, orderBy: [date_DESC]) {
            dimensions { date }
            sum {
              requests
              pageViews
              threats
              bytes
            }
            uniq { uniques }
          }
          httpRequestsAdaptiveGroups(limit: 20, filter: {date_gt: "%s"}, orderBy: [count_DESC]) {
            dimensions {
              clientRequestPath
            }
            count
          }
        }
      }
    }
    """ % (zone_id, (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d"))

    r = httpx.post(
        "https://api.cloudflare.com/client/v4/graphql",
        headers=headers,
        json={"query": query},
        timeout=15,
    )

    if r.status_code != 200:
        return {"error": f"Cloudflare API returned {r.status_code}"}

    data = r.json()

    # Parse into dashboard-friendly format
    daily = data.get("data", {}).get("viewer", {}).get("zones", [{}])[0].get("httpRequests1dGroups", [])
    top_pages = data.get("data", {}).get("viewer", {}).get("zones", [{}])[0].get("httpRequestsAdaptiveGroups", [])

    return {
        "configured": True,
        "daily_stats": [{
            "date": d["dimensions"]["date"],
            "visitors": d["uniq"]["uniques"],
            "page_views": d["sum"]["pageViews"],
            "requests": d["sum"]["requests"],
        } for d in daily],
        "top_pages": [{
            "path": p["dimensions"]["clientRequestPath"],
            "views": p["count"],
        } for p in top_pages[:10]],
        "totals": {
            "visitors_7d": sum(d["uniq"]["uniques"] for d in daily),
            "page_views_7d": sum(d["sum"]["pageViews"] for d in daily),
            "visitors_today": daily[0]["uniq"]["uniques"] if daily else 0,
            "page_views_today": daily[0]["sum"]["pageViews"] if daily else 0,
        }
    }
```

## Dashboard Display — ANALYTICS tab and OVERVIEW tab

### On OVERVIEW tab (KPI area or new section):

```
┌─────────────────────────────────────────────────────────────┐
│ WEBSITE TRAFFIC (last 7 days)                               │
│                                                              │
│ Visitors: 142    Page Views: 891    Avg: 6.3 pages/visit    │
│                                                              │
│ ▁▂▃▅▇▅▃  ← sparkline showing daily visitors                │
│ M T W T F S S                                                │
│                                                              │
│ TOP PAGES                                                    │
│ /gallery.html .............. 234 views                      │
│ /licensing.html ............ 156 views                      │
│ / (homepage) ............... 142 views                      │
│ /collection.html ........... 89 views                       │
│ /micro-licensing.html ...... 12 views                       │
└─────────────────────────────────────────────────────────────┘
```

If Cloudflare token not configured, show:
```
WEBSITE TRAFFIC
⚠ Not connected. Add your Cloudflare API token to see real visitor data.
[How to set up] ← links to instructions
```

### On ANALYTICS tab — full detail:
Show daily breakdown table, top pages, country breakdown, and a 7-day chart.

## Done Criteria
- [ ] `/analytics/cloudflare` endpoint created
- [ ] Returns real data when token configured
- [ ] Returns clear setup instructions when not configured
- [ ] Dashboard shows visitor count, page views, top pages
- [ ] Sparkline chart on overview tab
- [ ] ANALYTICS tab shows full detail

---

# TASK 2: INSTAGRAM INSIGHTS — ENGAGEMENT FUNNEL
**Time: 1-2 hours**

The Instagram Graph API already has insights. The token is valid until April 20.

## API Endpoint

```python
@app.get("/instagram/insights")
def get_instagram_insights():
    """Pull engagement metrics from Instagram Graph API."""
    from src.integrations.instagram import get_credentials

    creds = get_credentials()
    token = creds.get("access_token")
    user_id = creds.get("user_id") or creds.get("scoped_user_id")

    if not token:
        return {"configured": False}

    import httpx

    # Get account insights for last 7 days
    r = httpx.get(
        f"https://graph.instagram.com/v21.0/{user_id}/insights",
        params={
            "metric": "impressions,reach,profile_views,website_clicks,follower_count",
            "period": "day",
            "access_token": token,
        },
        timeout=15,
    )

    if r.status_code != 200:
        return {"error": r.text[:200]}

    data = r.json().get("data", [])

    # Also get recent media with insights
    media_r = httpx.get(
        f"https://graph.instagram.com/v21.0/{user_id}/media",
        params={
            "fields": "id,caption,media_type,timestamp,like_count,comments_count,permalink",
            "limit": 10,
            "access_token": token,
        },
        timeout=15,
    )

    media = media_r.json().get("data", []) if media_r.status_code == 200 else []

    return {
        "configured": True,
        "insights": {m["name"]: m.get("values", []) for m in data},
        "recent_media": [{
            "id": m.get("id"),
            "caption": (m.get("caption", "")[:100] + "..." if len(m.get("caption", "")) > 100 else m.get("caption", "")),
            "likes": m.get("like_count", 0),
            "comments": m.get("comments_count", 0),
            "timestamp": m.get("timestamp"),
            "permalink": m.get("permalink"),
        } for m in media],
    }
```

## Dashboard Display — SOCIAL tab Instagram section

```
┌─────────────────────────────────────────────────────────────┐
│ INSTAGRAM FUNNEL (last 7 days)                              │
│                                                              │
│ Impressions: 1,234 → Reach: 890 → Profile visits: 67       │
│ → Website clicks: 12 → Followers gained: +8                 │
│                                                              │
│ That's a 0.97% conversion from impression to website click  │
│                                                              │
│ TOP POSTS (by engagement)                                    │
│ Zebra herd .......... 45 likes, 3 comments                  │
│ White Sands dunes ... 38 likes, 1 comment                   │
│ Glacier panorama .... 32 likes, 2 comments                  │
└─────────────────────────────────────────────────────────────┘
```

This tells Wolf: "12 people clicked through to the website from Instagram this week." That's actionable. "12 posts today" is not.

## Done Criteria
- [ ] `/instagram/insights` endpoint returns real engagement data
- [ ] Dashboard shows the FUNNEL: impressions → reach → profile visits → website clicks
- [ ] Conversion rate calculated and displayed
- [ ] Top posts by engagement shown

---

# TASK 3: BROADCAST — SHOW THE STORY, NOT JUST STATUS CODES
**Time: 1 hour**

The broadcast section currently shows "202 Accepted" and red X marks. Wolf asked: "What are we broadcasting? Why? Is it working?"

## Rewrite the Broadcast Section

Instead of raw HTTP status codes, tell the story:

```
┌─────────────────────────────────────────────────────────────┐
│ BROADCAST & DISCOVERY                                       │
│                                                              │
│ WHAT WE'RE DOING                                            │
│ Broadcasting archive-35.com to AI search engines so that    │
│ when someone asks ChatGPT, Copilot, or Perplexity for      │
│ "fine art photography prints," YOUR images show up.          │
│                                                              │
│ LATEST BROADCAST — March 18, 11:50 AM                       │
│                                                              │
│ ✓ IndexNow: 17 pages pushed to Bing, Yandex, IndexNow API  │
│   → These pages can now appear in ChatGPT Search, Copilot,  │
│     DuckDuckGo, and Bing results                            │
│                                                              │
│ ✓ Sitemaps: Submitted to Bing + Google                      │
│   sitemap.xml: 28 pages | sitemap-images.xml: 166 images    │
│                                                              │
│ ✓ Discovery files: All 9 verified accessible                │
│   llms.txt ✓ | robots.txt ✓ | MCP server.json ✓            │
│                                                              │
│ ⚠ Google Indexing API: Not configured                       │
│   → Add google-credentials.json to enable direct Google     │
│     indexing (not required — sitemaps still work)            │
│                                                              │
│ RESULTS SO FAR                                               │
│ AI agent requests to your catalog: 0                         │
│ → This is normal for the first few days after broadcasting. │
│   Bing typically indexes within 24-48 hours.                │
│ → Check back tomorrow.                                       │
│                                                              │
│ [Run Broadcast Again]  [→ Bing Webmaster Tools]              │
└─────────────────────────────────────────────────────────────┘
```

**Key changes:**
1. "WHAT WE'RE DOING" section that explains the purpose in plain English
2. Results tell a story — not "202" but "17 pages pushed to Bing → can appear in ChatGPT Search"
3. "RESULTS SO FAR" connects broadcast to the AI discovery intelligence data
4. Context for empty data: "This is normal for the first few days" instead of just "No data"
5. Red X marks get explanation of WHAT failed and HOW to fix it

## Done Criteria
- [ ] Broadcast section explains what broadcasting IS and WHY
- [ ] Results show human-readable outcomes, not HTTP codes
- [ ] Empty states have context ("normal for first few days")
- [ ] Error states have fix instructions
- [ ] Connected to AI agent discovery data

---

# TASK 4: ETSY — PULL REAL STATS FROM ETSY API
**Time: 1-2 hours**

The Etsy token is configured. The API has shop stats. Pull them.

## Fix the Existing Bug First

The Etsy listings endpoint uses `limit=200` in some places. Etsy max is 100. Search for ALL instances and fix them:
```bash
grep -rn "limit=200\|limit=150" "Archive 35 Agent/src/"
```

## API Endpoint for Etsy Stats

```python
@app.get("/etsy/shop-stats")
def get_etsy_shop_stats():
    """Get real shop statistics from Etsy API."""
    from src.integrations.etsy import has_valid_token, get_listings

    if not has_valid_token():
        return {"configured": False, "message": "Etsy token expired. Reauthorize."}

    try:
        # Get active listings with stats
        data = get_listings(state="active", limit=100)
        listings = data.get("results", [])
        total_count = data.get("count", len(listings))

        # Calculate stats
        total_views = sum(l.get("views", 0) for l in listings)
        total_favorites = sum(l.get("num_favorers", 0) for l in listings)
        zero_view = [l for l in listings if l.get("views", 0) == 0]

        # Sort by views for top/worst performers
        by_views = sorted(listings, key=lambda l: l.get("views", 0), reverse=True)

        return {
            "configured": True,
            "total_listings": total_count,
            "total_views": total_views,
            "total_favorites": total_favorites,
            "zero_view_count": len(zero_view),
            "top_5": [{
                "title": l.get("title", "")[:60],
                "views": l.get("views", 0),
                "favorites": l.get("num_favorers", 0),
            } for l in by_views[:5]],
            "worst_5": [{
                "title": l.get("title", "")[:60],
                "views": l.get("views", 0),
                "favorites": l.get("num_favorers", 0),
            } for l in by_views[-5:]],
        }

    except Exception as e:
        return {"error": str(e)}
```

## Dashboard Display

```
┌─────────────────────────────────────────────────────────────┐
│ ETSY PERFORMANCE                           → Open Etsy Shop │
│                                                              │
│ 93 listings | 1,247 total views | 89 favorites | 0 orders   │
│                                                              │
│ TOP PERFORMERS                                               │
│ Grand Teton Panorama .......... 156 views, 12 favorites     │
│ White Sands Dunes ............. 134 views, 9 favorites      │
│ Disney Concert Hall ........... 98 views, 8 favorites       │
│                                                              │
│ NEEDS ATTENTION (0 views)                                    │
│ ⚠ 15 listings with zero views — these need SEO fixes        │
│ [View list]  [Run SEO Audit]                                │
│                                                              │
│ SEO SCORE: 79.3/100                                          │
│ Titles using full 140 chars: 2/31 ← biggest opportunity     │
│ Seasonal keywords: 1/31 ← add spring/Mother's Day terms     │
│ Room-type keywords: 1/31 ← add "office art", "bedroom"      │
└─────────────────────────────────────────────────────────────┘
```

## Done Criteria
- [ ] `/etsy/shop-stats` returns real view/favorite/listing data
- [ ] Dashboard shows total views, favorites, top performers
- [ ] Zero-view listings flagged with count
- [ ] SEO score with specific improvement recommendations

---

# TASK 5: THE FUNNEL ON THE OVERVIEW PAGE
**Time: 1-2 hours**

The Overview tab should show the complete revenue funnel as a visual flow:

```
┌─────────────────────────────────────────────────────────────┐
│ REVENUE FUNNEL (last 7 days)                                │
│                                                              │
│ DISCOVERY  ──→  TRAFFIC  ──→  ENGAGEMENT  ──→  SALES       │
│                                                              │
│ Broadcast:     Website:      Instagram:      Revenue:       │
│ 17 pages       142 visitors  1,234 impress.  $0.00          │
│ pushed         891 pageviews 67 profile vis.                │
│                              12 site clicks                  │
│                                                              │
│ Etsy:          Pinterest:    Reddit:                         │
│ 93 listings    50 pins       30 posts                       │
│ 1,247 views    ready         queued                         │
│ 89 favorites   to upload     0 posted                       │
│                                                              │
│ ─── Conversion path ─────────────────────────────────────── │
│ 17 pages indexed → 142 visitors → 89 Etsy favorites → $0   │
│                                                              │
│ ⚠ Gap: Traffic exists but not converting to sales.          │
│   Top recommendation: Post 1 Reddit photo to r/EarthPorn    │
│   and share your Etsy link in the comments.                  │
└─────────────────────────────────────────────────────────────┘
```

This connects everything. Wolf sees at a glance: "We have traffic. We have engagement. But no sales. Where's the gap?"

The funnel pulls data from:
- `/analytics/cloudflare` (Task 1)
- `/instagram/insights` (Task 2)
- `/broadcast/status` (existing)
- `/etsy/shop-stats` (Task 4)
- `/api/license/agent-intelligence` (existing)
- Sales from audit_log / Stripe

**When data is missing** (e.g., Cloudflare not configured), show the box grayed out with "Set up Cloudflare Analytics to see traffic data" — don't hide the funnel.

**The recommendation at the bottom** should be generated by simple rules:
- If traffic = 0: "Broadcast hasn't been picked up yet. Give it 24-48 hours."
- If traffic > 0 but sales = 0: "Traffic exists but not converting. Focus on Etsy SEO and Reddit posts."
- If Etsy favorites > 0 but orders = 0: "People are favoriting but not buying. Check pricing and shipping."
- If everything is zero: "System just launched. Run a broadcast and post to Reddit today."

## Done Criteria
- [ ] Funnel visualization on Overview tab
- [ ] Pulls from all available data sources
- [ ] Shows conversion path with actual numbers
- [ ] Gap analysis with recommendation
- [ ] Graceful handling of missing data sources

---

# TASK 6: SCAN MODE — MAKE IT ACTUALLY DO SOMETHING
**Time: 30 min**

The "Needs Attention" / "All Systems" toggle in the sidebar currently does nothing visible.

### "Needs Attention" mode:
- Overview: Only show items with warnings/errors. Hide healthy platform tiles.
- Live feed: Filter to errors and warnings only
- Sales goal: Always visible
- Funnel: Always visible

### "All Systems" mode:
- Show everything including healthy systems
- Live feed: Show all entries
- Platform tiles expanded

Implementation: Add a CSS class `.scan-needs-attention` to the main content div. When active, `.platform-tile.healthy { display: none; }` and `.feed-item.info { display: none; }`.

Store the mode in sessionStorage so it persists.

## Done Criteria
- [ ] Toggle switches between modes visually
- [ ] "Needs Attention" hides healthy systems
- [ ] "All Systems" shows everything
- [ ] Persists across page loads

---

# TASK 7: CONNECTIVITY — SHOW STATS, NOT JUST "CONNECTED"
**Time: 30 min**

The External Systems panel should show actual data alongside connection status:

```
EXTERNAL SYSTEMS

● Cloudflare   Connected   142 visitors this week
● Stripe       Connected   $0 revenue
● Google       Needs setup  Add search console verification
● Bing         Needs auth   Register at bing.com/webmasters
● Pictorem     Connected   0 orders fulfilled
```

Each line: icon + name + chip + one real metric. Not just "Connected."

Pull metrics from:
- Cloudflare: visitor count (from Task 1)
- Stripe: revenue (from audit_log or Stripe API)
- Google/Bing: show setup status
- Pictorem: order count from audit_log

## Done Criteria
- [ ] Each external system shows a real metric alongside status
- [ ] Missing config shows specific setup instruction

---

# TASK 8: ATHOS ANALYTICS
**Time: 30 min**

Wolf also wants ATHOS stats. athos-obs.com runs on Cloudflare too.

If we add a second zone ID for ATHOS, the same Cloudflare API call works:

Add to .env:
```
CLOUDFLARE_ATHOS_ZONE_ID=
```

Create endpoint:
```python
@app.get("/analytics/athos")
# Same as cloudflare analytics but for ATHOS zone
```

Show on ANALYTICS tab:
```
ATHOS (athos-obs.com)
Visitors: 23 this week | Top page: /vocab/ (18 views)
Avg session: 4.2 min | Returning: 12%
```

## Done Criteria
- [ ] ATHOS analytics endpoint created
- [ ] Shows on ANALYTICS tab
- [ ] Separate zone ID configuration

---

# ORDER OF OPERATIONS

```
Task 1: Cloudflare Analytics API (2-3h) ← MOST IMPORTANT
Task 2: Instagram Insights (1-2h)
Task 4: Etsy real stats (1-2h)
    ↓
Task 5: Revenue funnel on Overview (1-2h) — needs Tasks 1, 2, 4
Task 3: Broadcast story rewrite (1h)
    ↓
Task 6: Scan mode (30min)
Task 7: Connectivity with metrics (30min)
Task 8: ATHOS analytics (30min)
```

Total: ~8-10 hours

---

# API KEYS WOLF NEEDS TO PROVIDE

1. **Cloudflare API Token** — dash.cloudflare.com → My Profile → API Tokens → Create Token → "Analytics Read" template
2. **Cloudflare Zone ID** — dash.cloudflare.com → archive-35.com → Overview → right sidebar → Zone ID
3. **ATHOS Zone ID** — same process for athos-obs.com (optional, can be added later)

If these aren't in .env when the build runs, create the endpoints with clear setup instructions that display on the dashboard. Don't skip the tasks — build everything, show "not configured" messages where needed.

---

# DEPLOYMENT

```bash
cd ~/Documents/ACTIVE/archive-35
python3 sync_gallery_data.py
git add agent-dashboard.html "Archive 35 Agent/src/api.py"
git commit -m "[intelligence] Real analytics: Cloudflare visitors, Instagram funnel, Etsy stats, revenue funnel, broadcast story"
git push
```

---

# ESTIMATED TOTAL TIME: 8-10 hours
# THIS IS THE PHASE THAT MAKES THE DASHBOARD INTELLIGENT.
# STATUS IS BORING. STORY IS POWERFUL. TELL THE STORY.
# BUILD ALL OF IT. LOG EVERYTHING.

---

*Phase 7 specification created March 18, 2026. Transforms the dashboard from status display to intelligence system. Every widget answers: "Is it working? Is it making money?"*
