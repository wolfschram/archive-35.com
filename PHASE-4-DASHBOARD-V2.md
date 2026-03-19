# PHASE 4 BUILD — Dashboard V2: Full Operator Command Center Redesign
## Claude Code: Read this top to bottom. Build everything. Test everything. Do not stop until done.
## Owner: Wolf Schram | Date: March 18, 2026
## Context: Phases 1-3 COMPLETE. Agent API is ONLINE on port 8035 via Docker.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK

**You have ALL permissions. Do not stop to ask for permission at any point.**
**Log every decision to `Archive 35 Agent/data/build_log.json`**

---

## WHAT THIS IS

Complete redesign of agent-dashboard.html into a tabbed, mobile-responsive operator command center. This replaces the current scrolling page with a proper web app with tab navigation, visual previews, inline feedback (NO popups), sales goal thermometer, embedded email client, platform links in every widget, and Cloudflare Analytics integration.

Wolf has ADHD and dyslexia. Every design decision must prioritize:
- **Scannable** — big visual indicators, color-coded status, minimal dense text
- **Actionable** — every piece of information has a button to act on it
- **No popups** — all feedback inline with button color state changes
- **High contrast** — use bright text on dark backgrounds, never below #999 for secondary text

---

## RULES BEFORE YOU TOUCH ANYTHING

1. Read CLAUDE.md first
2. NEVER change Stripe keys or webhook endpoints
3. NEVER deploy without running `python3 sync_gallery_data.py` first
4. Agent API = port 8035, Mockup = port 8036, Studio = port 3001, NEVER use port 3000
5. DO NOT break the live Etsy store, website, or Stripe checkout
6. The dashboard is a SINGLE HTML file: `~/Documents/ACTIVE/archive-35/agent-dashboard.html`
7. All data comes from the API on port 8035 via fetch()
8. The .cfignore controls Cloudflare deployment — agent-dashboard.html deploys to archive-35.com/agent-dashboard

---

## EXISTING INFRASTRUCTURE — READ THESE FIRST

- `Archive 35 Agent/src/api.py` — 4500+ lines, 100+ endpoints already exist
- `Archive 35 Agent/.env` — all credentials (Instagram, Etsy, Pinterest, Stripe, email)
- `Archive 35 Agent/data/agent_state/` — 7 state files for all agents
- `Archive 35 Agent/data/reddit_queue.json` — 30 queued Reddit posts
- `Archive 35 Agent/data/etsy_seo_report.json` — SEO analysis of 31 listings
- `Archive 35 Agent/data/email_briefings/latest.json` — email briefing data
- `Archive 35 Agent/data/broadcast_log.json` — broadcast history
- `02_Social/pinterest/pins/` — 50 generated pin images
- `02_Social/pinterest/tailwind_upload.csv` — Pinterest CSV ready
- `03_Brand/voice_guide.md` — brand voice rules
- `08_Docs/LESSONS_LEARNED.md` — critical project knowledge

---

# TASK 1: REMOVE LOGIN SCREEN
**Estimated time:** 5 minutes

Remove the password login screen entirely. The dashboard should load directly into the main view. No auth prompt, no clicks to get in.

Find and remove:
- The login overlay/modal HTML
- The password check JavaScript
- Any sessionStorage auth token checks
- The login CSS

The dashboard should be immediately visible on page load.

## Done Criteria
- [ ] Page loads directly to dashboard content — no login screen
- [ ] No password prompt anywhere
- [ ] No auth-related JavaScript errors in console

---

# TASK 2: TAB NAVIGATION — ONE SECTION AT A TIME
**Estimated time:** 2-3 hours

Replace the scrolling layout with a tabbed interface. Only one section visible at a time.

## Tab Bar Design

Fixed horizontal tab bar below the status bar. Tabs:

```
[ HOME ] [ AGENTS ] [ SOCIAL ] [ EMAIL ] [ ANALYTICS ] [ BROADCAST ] [ LEARNING ] [ LINKS ]
```

- Active tab: gold background (#c9a84c) with dark text
- Inactive tabs: transparent with #999 text, hover → #ccc
- Tab bar sticky below status bar
- Mobile: tabs wrap to 2 rows or become a horizontal scroll

## Tab Contents

### HOME (default landing page)
- Sales goal thermometer (big, visual, top center)
- System health overview — grid of connectivity dots (green = connected, red = down)
  - Agent API: green/red
  - Instagram: green/red
  - Etsy: green/red
  - Pinterest: green/red
  - Email (3 accounts): green/red
  - Broadcast: green/red (based on last broadcast < 24h ago)
- Quick stats row: Total Revenue | Etsy Listings | IG Posts Today | Reddit Queue | Email Unread
- Recent activity feed (last 10 events, compact)

### AGENTS (current agent control panel)
- All agent cards as they exist now
- But with visual previews added (see Task 3)

### SOCIAL (Instagram + Reddit + Pinterest combined)
- Sub-tabs or sections within: Instagram | Reddit | Pinterest
- Visual post previews with images and captions
- Platform links in each section header

### EMAIL
- Full email client interface (see Task 6)

### ANALYTICS
- Cloudflare Analytics embed
- AI Agent Discovery Intelligence
- Etsy Performance
- Micro-Licensing stats

### BROADCAST
- Broadcast & Discovery Status
- IndexNow history
- Search engine indexing status

### LEARNING
- Embedded ATHOS Vocab Trainer (iframe to https://athos-obs.com/vocab/)
- Future: ability to add more training modules

### LINKS
- Quick links to all platforms (see Task 8)

## Technical Implementation
- Use CSS display:none/block to show/hide tab content
- Store active tab in sessionStorage so refresh stays on same tab
- URL hash routing (#home, #agents, #social, etc.) so bookmarks work
- Keyboard shortcuts: Ctrl+1 through Ctrl+8 for tabs

## Done Criteria
- [ ] Tab bar renders with all 8 tabs
- [ ] Clicking a tab shows only that section
- [ ] Active tab persists across page refresh
- [ ] URL hash updates when switching tabs
- [ ] Mobile responsive (tabs wrap or scroll)

---

# TASK 3: VISUAL POST PREVIEWS — INSTAGRAM, REDDIT, PINTEREST
**Estimated time:** 3-4 hours

Wolf needs to SEE what's being posted — images and captions visible before and after posting.

## Instagram Preview

In the Instagram agent card (AGENTS tab) AND the SOCIAL > Instagram section:

```
┌─────────────────────────────────────────────────────────────┐
│ INSTAGRAM                    archive35photo    [→ Instagram] │
│ Status: Connected | Today: 7 posts | Token valid until Apr 20│
├─────────────────────────────────────────────────────────────┤
│ NEXT 3 POSTS                                                │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                        │
│ │ [image] │ │ [image] │ │ [image] │                        │
│ │ 400x400 │ │ 400x400 │ │ 400x400 │                        │
│ └─────────┘ └─────────┘ └─────────┘                        │
│ "The light falls     "Desert silence    "Mountain holds     │
│  differently here..." at White Sands..." its breath..."     │
│                                                              │
│ [POST 1 NOW]  [POST BATCH (3)]  [RESTART]                  │
│                                                              │
│ RECENT POSTS (last 5)                                        │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐│
│ │ [thumb] │ │ [thumb] │ │ [thumb] │ │ [thumb] │ │[thumb] ││
│ │ 3/17 8pm│ │ 3/17 7pm│ │ 3/17 6pm│ │ 3/16    │ │ 3/16   ││
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Image source**: The Instagram agent uses photos from the portfolio. Load thumbnails via the existing `/photos/{photo_id}/thumbnail` endpoint or from `images/` directory.

**"→ Instagram" link**: Opens `https://www.instagram.com/archive35photo/` in a new browser tab.

**Recent posts**: Call `GET /instagram/media` to get the last 5 posts with thumbnails.

## Reddit Preview

In the Reddit agent card AND SOCIAL > Reddit section:

```
┌─────────────────────────────────────────────────────────────┐
│ REDDIT                                           [→ Reddit] │
│ Queued: 30 | Posted: 0 | Posts today: 0/5                   │
├─────────────────────────────────────────────────────────────┤
│ NEXT POST                                                    │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ ┌─────────┐  r/EarthPorn                                 ││
│ │ │ [image] │  Desert Dunes: Vast Solitude, southern        ││
│ │ │ preview │  California [OC] [31714x7907]                 ││
│ │ └─────────┘                                               ││
│ │                                                           ││
│ │ TITLE (click to copy):                                    ││
│ │ ┌─────────────────────────────────────────────────┐       ││
│ │ │ Desert Dunes: Vast Solitude, southern California ││      ││
│ │ │ [OC] [31714x7907]                                │       ││
│ │ └─────────────────────────────────────────────────┘       ││
│ │                                                           ││
│ │ BODY (click to copy):                                     ││
│ │ ┌─────────────────────────────────────────────────┐       ││
│ │ │ The wind carves these dunes over decades. I      │       ││
│ │ │ spent three hours waiting for the shadows to...  │       ││
│ │ └─────────────────────────────────────────────────┘       ││
│ │                                                           ││
│ │ HASHTAGS (click to copy):                                 ││
│ │ #photography #desert #landscape #fineart #wallart          ││
│ │                                                           ││
│ │ [OPEN REDDIT SUBMIT]  [MARK AS POSTED]  [SKIP]  [NEXT]   ││
│ └───────────────────────────────────────────────────────────┘│
│                                                              │
│ [GENERATE NEW POST]                                          │
└─────────────────────────────────────────────────────────────┘
```

**Click to copy**: Each field (title, body, hashtags) has a copy icon. Clicking copies to clipboard and briefly flashes green.

**"OPEN REDDIT SUBMIT"**: Opens `https://old.reddit.com/r/{subreddit}/submit` in new tab.

**"MARK AS POSTED"**: Calls `POST /reddit/mark-posted` with the post ID. Button turns green.

**"GENERATE NEW POST"**: Calls `POST /reddit/generate-single` (generate ONE new post, not 30).

**Reddit link**: "→ Reddit" opens `https://www.reddit.com/user/` (Wolf's profile) in new tab.

## Pinterest Preview

In the Pinterest agent card AND SOCIAL > Pinterest section:

```
┌─────────────────────────────────────────────────────────────┐
│ PINTEREST                                      [→ Pinterest] │
│ Pins generated: 50 | Last batch: March 17                    │
├─────────────────────────────────────────────────────────────┤
│ GENERATED PINS (sample)                                      │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│ │ [pin]   │ │ [pin]   │ │ [pin]   │ │ [pin]   │           │
│ │ 200x300 │ │ 200x300 │ │ 200x300 │ │ 200x300 │           │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│ Tailwind CSV ready: 50 pins                                 │
│                                                              │
│ [GENERATE NEW PINS]  [DOWNLOAD CSV]  [RESTART]              │
└─────────────────────────────────────────────────────────────┘
```

**Pin images**: Load from `02_Social/pinterest/pins/` via a new endpoint `GET /pinterest/pin-image/{filename}`.

**"→ Pinterest"**: Opens `https://www.pinterest.com/archive35photo/` in new tab.

## New API Endpoints Needed

```python
# Serve Pinterest pin images
@app.get("/pinterest/pin-image/{filename}")
# Serves image from 02_Social/pinterest/pins/

# Generate single Reddit post
@app.post("/reddit/generate-single")
# Generates ONE new post and appends to queue

# Get Instagram next posts preview
@app.get("/instagram/next-posts")
# Returns next 3 images in rotation with captions and thumbnails
```

## Done Criteria
- [ ] Instagram shows next 3 images with captions and thumbnails
- [ ] Instagram shows last 5 posted images
- [ ] Reddit shows full post preview with copy-to-clipboard for each field
- [ ] Reddit "Open Reddit Submit" opens correct subreddit submit page
- [ ] Pinterest shows sample pin images
- [ ] All platform link buttons open correct URLs in new tabs
- [ ] Click-to-copy works and shows visual feedback

---

# TASK 4: NO MORE POPUPS — INLINE STATUS FEEDBACK
**Estimated time:** 1-2 hours

Replace EVERY `alert()` call in the dashboard with inline status feedback.

## Button State System

Every action button follows this pattern:

```
IDLE:       Gold background (#c9a84c), dark text → "BROADCAST NOW"
WORKING:    Orange background (#f59e0b), text → "Broadcasting..."
SUCCESS:    Green background (#4ade80), text → "Done ✓" (reverts to IDLE after 3s)
FAILED:     Red background (#f87171), text → "Failed: {reason}" (stays red until clicked)
```

## Implementation

Create a reusable function:

```javascript
async function actionButton(btn, apiCall, successMsg) {
  const originalText = btn.textContent;
  const originalBg = btn.style.background;

  btn.textContent = 'Working...';
  btn.style.background = '#f59e0b';
  btn.disabled = true;

  try {
    const result = await apiCall();
    btn.textContent = successMsg || 'Done ✓';
    btn.style.background = '#4ade80';
    btn.style.color = '#000';

    // Show result details below button if applicable
    if (result.message) {
      showInlineStatus(btn, result.message, 'success');
    }

    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = originalBg;
      btn.style.color = '';
      btn.disabled = false;
    }, 3000);

  } catch(e) {
    btn.textContent = 'Failed';
    btn.style.background = '#f87171';
    showInlineStatus(btn, e.message, 'error');

    btn.onclick = () => {
      btn.textContent = originalText;
      btn.style.background = originalBg;
      btn.style.color = '';
      btn.disabled = false;
    };
  }
}

function showInlineStatus(btn, message, type) {
  // Create/update a small status line below the button
  let statusEl = btn.nextElementSibling;
  if (!statusEl || !statusEl.classList.contains('inline-status')) {
    statusEl = document.createElement('div');
    statusEl.classList.add('inline-status');
    btn.parentNode.insertBefore(statusEl, btn.nextSibling);
  }
  statusEl.textContent = message;
  statusEl.style.color = type === 'error' ? '#f87171' : '#4ade80';
  statusEl.style.fontSize = '11px';
  statusEl.style.marginTop = '4px';

  if (type === 'success') {
    setTimeout(() => statusEl.remove(), 5000);
  }
}
```

Replace ALL existing `alert()` calls with this pattern. Search for every `alert(` in the HTML file.

Also: prevent double-clicks. If a button is in WORKING state, clicking it again does nothing.

Also: if a broadcast or any repeatable action is clicked multiple times, it should NOT queue multiple executions. Debounce all action buttons.

## Done Criteria
- [ ] Zero `alert()` calls remain in the HTML
- [ ] All buttons show yellow → orange → green/red flow
- [ ] Failed state shows the reason WHY it failed
- [ ] Double-click prevention works
- [ ] Status messages appear inline below buttons

---

# TASK 5: SALES GOAL THERMOMETER
**Estimated time:** 1 hour

Big visual thermometer on the HOME tab showing progress toward $5,000 goal.

## Design

```
┌─────────────────────────────────────────────────────────────┐
│                    REVENUE GOAL                              │
│                                                              │
│     $0                              $5,000                   │
│     ├──────────────────────────────────────┤                │
│     │██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│                │
│     ├──────────────────────────────────────┤                │
│     $0.00 earned                                             │
│                                                              │
│     Sources:                                                 │
│     Etsy: $0.00 | Website: $0.00 | Micro-licenses: $0.00    │
│                                                              │
│     Days active: 21 | Avg/day needed: $238.10                │
└─────────────────────────────────────────────────────────────┘
```

- Bar uses gradient: gold (#c9a84c) fill on dark background
- Animate the fill on page load
- Pull data from:
  - Etsy: `GET /etsy/receipts` (count revenue from orders)
  - Stripe: Check if there's a revenue endpoint, or read from audit_log
  - Micro-licenses: `GET /api/license/insights` (revenue field)
- If no revenue data exists yet, show $0 with "No sales yet — let's change that"

## Done Criteria
- [ ] Thermometer renders on HOME tab
- [ ] Shows $X of $5,000 with visual progress bar
- [ ] Sources breakdown shows per-channel revenue
- [ ] Animates on page load

---

# TASK 6: EMAIL TAB — FULL EMAIL CLIENT
**Estimated time:** 3-4 hours

The EMAIL tab is a standalone email interface powered by the email MCP/briefing agent.

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ EMAIL                                          [SCAN NOW]   │
│ 3 accounts | Last scan: 44m ago | 22 new emails             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌─ BRIEFING SUMMARY ─────────────────────────────────────┐  │
│ │ ACTION REQUIRED (2)                                     │  │
│ │ ▸ [Archive-35] CaFE deadline March 19 — Tampa Airport   │  │
│ │ ▸ [Archive-35] Indiewalls — still no reply (14 days)    │  │
│ │                                                         │  │
│ │ SECURITY ALERTS (1)                                     │  │
│ │ ▸ ⚠ PHISHING: Fake Etsy order from Webflow — DO NOT    │  │
│ │   CLICK [Delete from all accounts]                      │  │
│ │                                                         │  │
│ │ BUSINESS (4)                                            │  │
│ │ ▸ Etsy billing: $12.80 | Pinterest: March updates       │  │
│ │ ▸ Stripe: Sessions 2026 | Etsy Sellers: What shoppers.. │  │
│ └─────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌─ ALL EMAILS ──────────────────────────────────────────┐   │
│ │ Filter: [All] [Archive-35] [Gmail] [iCloud]           │   │
│ │                                                        │   │
│ │ ┌────────────────────────────────────────────────────┐ │   │
│ │ │ ● CaFE — Tampa International Airport Call...       │ │   │
│ │ │   wolf@archive-35.com | Mar 13 | [Read] [Archive]  │ │   │
│ │ ├────────────────────────────────────────────────────┤ │   │
│ │ │ ● Etsy — Fresh finds loading                       │ │   │
│ │ │   wolf@archive-35.com | Mar 16 | [Read] [Delete]   │ │   │
│ │ ├────────────────────────────────────────────────────┤ │   │
│ │ │ ⚠ PHISHING — Your shop had a happy moment today    │ │   │
│ │ │   wolf@archive-35.com | Feb 26 | [Delete]          │ │   │
│ │ └────────────────────────────────────────────────────┘ │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ ┌─ EMAIL READER ────────────────────────────────────────┐   │
│ │ (click any email above to read it here)                │   │
│ │                                                        │   │
│ │ From: CaFE <contactcafe@callforentry.org>              │   │
│ │ To: wolf@archive-35.com                                │   │
│ │ Date: Mar 13, 2026                                     │   │
│ │ Subject: Apply now to Tampa International Airport...    │   │
│ │                                                        │   │
│ │ [email body rendered here — plain text]                 │   │
│ │                                                        │   │
│ │ [Reply] [Archive] [Delete] [Open in Gmail]             │   │
│ └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## New API Endpoints Needed

```python
# Delete email (move to trash)
@app.post("/email/delete")
# Body: {"account": "archive35", "uid": "12345"}
# Connects via IMAP, moves to [Gmail]/Trash or Deleted Items

# Archive email (remove from inbox)
@app.post("/email/archive")
# Body: {"account": "archive35", "uid": "12345"}
# Moves to [Gmail]/All Mail (removes INBOX label)

# Mark as read
@app.post("/email/mark-read")
# Body: {"account": "archive35", "uid": "12345"}
```

These need IMAP write access. Update the email_mcp.py or create email management functions in the agent API.

## Briefing Summary
- Call `GET /email/briefing` on tab load
- The briefing agent already categorizes emails — display the categories with Wolf's ADHD-friendly format
- Each category is collapsible
- Action Required items should have a prominent colored left border (orange)
- Security alerts have red left border
- Summaries must be Wolf-style: 1-line per email, what it is and what to do about it

## "Open in Gmail" Button
For each email, provide a link that opens the email in Gmail's web interface:
`https://mail.google.com/mail/u/wolf@archive-35.com/#all/{messageId}`

## Done Criteria
- [ ] EMAIL tab shows briefing summary with categories
- [ ] Email list shows all recent emails across 3 accounts
- [ ] Account filter buttons work
- [ ] Clicking an email shows full body in the reader panel
- [ ] Delete button moves email to trash via IMAP
- [ ] Archive button removes from inbox
- [ ] "Open in Gmail" opens correct email in browser
- [ ] Phishing emails flagged with red warning
- [ ] Scan Now triggers new briefing

---

# TASK 7: CLOUDFLARE ANALYTICS + SEARCH CONSOLE SETUP
**Estimated time:** 2-3 hours

## Part 1: Cloudflare Web Analytics

The site already has Cloudflare (DNS + Pages). Enable Cloudflare Web Analytics:

1. Check if Cloudflare Web Analytics beacon is already in the HTML files
   - Search for `cloudflareinsights` or `beacon.min.js` in the HTML files
   - If present, just wire it into the dashboard

2. If not present, add the Cloudflare Analytics snippet to all HTML pages:
   ```html
   <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "BEACON_TOKEN"}'></script>
   ```
   Note: Wolf needs to get the beacon token from Cloudflare dashboard → Analytics → Web Analytics

3. Create a dashboard section (in ANALYTICS tab) that shows:
   - Link to Cloudflare Analytics dashboard
   - Or embed via iframe if Cloudflare allows it

## Part 2: Bing Webmaster Tools Setup

Create a setup guide/script that:
1. Adds Bing site verification meta tag to index.html
2. Submits sitemap.xml to Bing
3. Provides link to Bing Webmaster dashboard

File: `06_Automation/scripts/setup_bing_webmaster.py`

## Part 3: Google Search Console Setup

Create a setup guide/script that:
1. Adds Google site verification meta tag to index.html
2. Submits sitemap.xml to Google
3. Provides link to Search Console dashboard

## Part 4: Analytics Tab Content

```
┌─────────────────────────────────────────────────────────────┐
│ ANALYTICS                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ WEBSITE TRAFFIC (from Cloudflare)                           │
│ [→ Open Cloudflare Analytics]                               │
│ Visitors today: -- | This week: -- | This month: --          │
│ Top pages: -- | Bounce rate: --                              │
│                                                              │
│ SEARCH ENGINE STATUS                                         │
│ [→ Bing Webmaster Tools]  [→ Google Search Console]          │
│ Bing: -- pages indexed | Google: -- pages indexed            │
│                                                              │
│ AI AGENT DISCOVERY                                           │
│ (moved from separate section — same content as before)       │
│ Total requests: 0 | Unique agents: 0                         │
│ Trending searches | Agent types | Unmet demand | Revenue     │
│                                                              │
│ ETSY PERFORMANCE                                             │
│ (moved from separate section)                                │
│ Live: 93 | SEO Score: 79.3/100 | Orders: 0                  │
│ Top 5 worst listings: [list with one-click fix buttons]      │
│ [→ Open Etsy Shop Manager]                                   │
│                                                              │
│ MICRO-LICENSING                                              │
│ (moved from separate section)                                │
│ Revenue: $0 | Catalog: 166 | Licenses sold: 0               │
│ [Generate Micro Versions]                                    │
└─────────────────────────────────────────────────────────────┘
```

## Done Criteria
- [ ] Cloudflare Analytics beacon added to HTML pages (or confirmed existing)
- [ ] Bing Webmaster setup script created
- [ ] Google Search Console setup script created
- [ ] ANALYTICS tab shows all analytics sections
- [ ] Platform links open correct dashboards in new tabs
- [ ] Etsy top 5 worst listings displayed from SEO report

---

# TASK 8: PLATFORM LINKS IN EVERY WIDGET + LINKS TAB
**Estimated time:** 30 minutes

Every widget that references an external platform gets a link button in its header.

## Widget Links

| Widget | Link | URL |
|--------|------|-----|
| Instagram | → Instagram | https://www.instagram.com/archive35photo/ |
| Reddit | → Reddit | https://www.reddit.com/ |
| Pinterest | → Pinterest | https://www.pinterest.com/archive35photo/ |
| Etsy | → Etsy Shop | https://www.etsy.com/shop/Archive35Photo |
| Etsy Manager | → Shop Manager | https://www.etsy.com/your/shops/me/dashboard |
| Broadcast | → Cloudflare | https://dash.cloudflare.com/ |
| Email | → Gmail | https://mail.google.com/mail/u/wolf@archive-35.com/ |
| Stripe | → Stripe | https://dashboard.stripe.com/ |
| CaFE | → CaFE | https://artist.callforentry.org/ |
| Indiewalls | → Indiewalls | https://artwork.indiewalls.com/ |
| ATHOS | → ATHOS | https://athos-obs.com/ |
| Archive-35 | → Website | https://archive-35.com/ |
| Bing Webmaster | → Bing | https://www.bing.com/webmasters/ |
| Google Search | → Google | https://search.google.com/search-console/ |
| Pictorem | → Pictorem | https://www.pictorem.com/ |

## Link Style
Small button in widget header, right-aligned:
```css
.platform-link {
  font-size: 11px;
  color: #999;
  text-decoration: none;
  border: 1px solid #444;
  padding: 2px 8px;
  border-radius: 3px;
}
.platform-link:hover {
  color: #c9a84c;
  border-color: #c9a84c;
}
```

All links open in `target="_blank"`.

## LINKS Tab

The LINKS tab shows ALL platform links in a clean grid:

```
┌─────────────────────────────────────────────────────────────┐
│ QUICK LINKS                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ MY WEBSITES                                                  │
│ [Archive-35.com]  [ATHOS]  [Micro-Licensing]                │
│                                                              │
│ SALES CHANNELS                                               │
│ [Etsy Shop]  [Etsy Manager]  [Indiewalls]  [CaFE]          │
│                                                              │
│ SOCIAL MEDIA                                                 │
│ [Instagram]  [Pinterest]  [Reddit]                          │
│                                                              │
│ INFRASTRUCTURE                                               │
│ [Cloudflare]  [Stripe]  [Pictorem]  [GitHub]                │
│                                                              │
│ SEARCH ENGINES                                               │
│ [Bing Webmaster]  [Google Search Console]                    │
│                                                              │
│ EMAIL                                                        │
│ [Gmail - Archive-35]  [Gmail - Personal]  [iCloud]          │
└─────────────────────────────────────────────────────────────┘
```

## Done Criteria
- [ ] Every widget has a platform link in its header
- [ ] LINKS tab shows all links in organized grid
- [ ] All links open in new tabs
- [ ] Links are styled consistently

---

# TASK 9: INDIEWALLS FOLLOW-UP
**Estimated time:** 30 minutes

Wolf was accepted to Indiewalls on March 3. He reported an address validation bug on March 4. No response in 14 days.

## Add to Email Briefing as Action Item

The daily briefing should flag:
- "Indiewalls: No response in 14 days to your address validation bug report. Follow up?"

## Draft Follow-Up Email

Create a draft follow-up email. Save to `Archive 35 Agent/data/drafts/indiewalls_followup.md`:

```
To: support@indiewalls.com
Subject: Follow-up: Profile activation — address validation bug (Wolf Schram)

Hi Indiewalls Support,

Following up on my email from March 4 regarding the address validation bug preventing me from activating my artist profile. I haven't received a response yet and am eager to get started.

Quick recap: Every US address I enter (including major commercial addresses) triggers a validation error. Browser console confirms the form data is correct — the issue appears to be server-side.

Account: Wolfgang Schram / wolf@archive-35.com

Would love to get this resolved so I can start uploading my inventory. Happy to jump on a quick call if that helps.

Best,
Wolf Schram
Archive-35 | The Restless Eye
wolf@archive-35.com
```

## Add Indiewalls to Dashboard

Add an "INDIEWALLS" card to the AGENTS tab or a note in the LINKS tab:
- Status: "Pending — address bug reported March 4, no reply"
- Link: https://artwork.indiewalls.com/
- Button: "Send Follow-Up" (opens email draft in Gmail compose)

## Done Criteria
- [ ] Follow-up email draft saved
- [ ] Indiewalls status visible on dashboard
- [ ] Link to Indiewalls in appropriate widget
- [ ] Briefing agent flags the pending follow-up

---

# TASK 10: LEARNING TAB — ATHOS VOCAB TRAINER
**Estimated time:** 15 minutes

## Embed ATHOS

The LEARNING tab embeds the ATHOS Vocab Trainer in an iframe:

```html
<div id="tab-learning" class="tab-content">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
    <h2>LEARNING</h2>
    <a href="https://athos-obs.com/vocab/" target="_blank" class="platform-link">→ Open Full Page</a>
  </div>
  <iframe src="https://athos-obs.com/vocab/"
    style="width:100%; height:calc(100vh - 120px); border:1px solid var(--border); border-radius:8px;"
    allow="clipboard-read; clipboard-write">
  </iframe>
</div>
```

## Done Criteria
- [ ] LEARNING tab shows embedded ATHOS vocab trainer
- [ ] "Open Full Page" link works
- [ ] iframe fills available space
- [ ] Trainer is fully interactive inside the iframe

---

# TASK 11: MOBILE RESPONSIVE DESIGN
**Estimated time:** 1-2 hours

The dashboard must work on iPhone/iPad.

## Breakpoints

```css
/* Desktop: > 1024px — current layout */
/* Tablet: 768-1024px — 2-column grid for agent cards */
/* Mobile: < 768px — single column, stacked everything */

@media (max-width: 768px) {
  .tab-bar {
    overflow-x: auto;
    white-space: nowrap;
    -webkit-overflow-scrolling: touch;
  }
  .agent-grid {
    grid-template-columns: 1fr;
  }
  .status-bar {
    font-size: 10px;
    overflow-x: auto;
  }
  .email-reader {
    font-size: 14px;
  }
  .thermometer {
    width: 100%;
  }
}
```

## Key Mobile Changes
- Tab bar: horizontal scroll with momentum
- Agent cards: full width, stacked
- Email reader: full width
- Status bar: scrollable or wrap to 2 rows
- Post previews: single column
- Touch-friendly: all buttons min 44px height
- No hover states (convert to active states)

## Done Criteria
- [ ] Dashboard renders correctly on iPhone (375px wide)
- [ ] Dashboard renders correctly on iPad (768px wide)
- [ ] Tab bar scrolls horizontally on mobile
- [ ] All buttons are touch-friendly (44px min)
- [ ] No horizontal scroll on main content

---

# TASK 12: CONTENT GENERATOR — RENAME AND EXPLAIN
**Estimated time:** 15 minutes

Rename "CONTENT PIPELINE" to "CONTENT GENERATOR" in the dashboard.

Add a brief explanation inside the card:

```
┌─────────────────────────────────────────────────────────────┐
│ ● CONTENT GENERATOR                              [ON/OFF]   │
│                                                              │
│ Generates Instagram captions, photo descriptions, and        │
│ social media content using AI. Reviews and queues posts      │
│ for your approval before publishing.                         │
│                                                              │
│ Pending: 0 | Approved: 0 | Published today: 0               │
│                                                              │
│ [GENERATE CONTENT]  [VIEW QUEUE]  [RESTART]                 │
└─────────────────────────────────────────────────────────────┘
```

## Done Criteria
- [ ] Card renamed from "Content Pipeline" to "Content Generator"
- [ ] Brief explanation of what it does added
- [ ] Buttons still work

---

# TASK 13: GREEN DOTS = CONNECTIVITY ONLY
**Estimated time:** 15 minutes

On the HOME tab, the connectivity dots should ONLY be green when there is a live, verified connection. Everything else = red or gray.

Rules:
- **Green dot**: API endpoint responds successfully
- **Red dot**: API endpoint fails or times out
- **Gray dot**: Not configured / no credentials

Test each:
- Agent API: `GET /health` responds
- Instagram: `GET /instagram/status` returns valid token
- Etsy: `GET /etsy/status` returns valid token
- Pinterest: `GET /pinterest/status` returns connected
- Email: `GET /email/briefing` returns data (or check IMAP connection)
- Broadcast: Last broadcast was within 24 hours

Don't show green dots for decorative purposes anywhere else on the dashboard.

## Done Criteria
- [ ] HOME tab shows connectivity dots
- [ ] Only green when actually connected
- [ ] Red when connection fails
- [ ] Gray when not configured

---

# ORDER OF OPERATIONS

```
Task 1:  Remove login screen (5 min)
Task 2:  Tab navigation (2-3 hours) ← DO THIS FIRST, everything else builds on it
Task 4:  No more popups — inline feedback system (1-2 hours)
Task 12: Rename Content Generator (15 min)
Task 13: Green dots = connectivity only (15 min)
    ↓
Task 3:  Visual post previews (3-4 hours)
Task 5:  Sales goal thermometer (1 hour)
Task 8:  Platform links everywhere (30 min)
Task 10: ATHOS Learning tab (15 min)
    ↓
Task 6:  Email tab — full client (3-4 hours)
Task 7:  Analytics + Search Console (2-3 hours)
Task 9:  Indiewalls follow-up (30 min)
    ↓
Task 11: Mobile responsive (1-2 hours) ← DO LAST, applies to everything above
```

---

# DEPLOYMENT CHECKLIST

1. `cd ~/Documents/ACTIVE/archive-35`
2. `python3 sync_gallery_data.py`
3. `git status` — verify changes
4. Verify NO secrets in staged files
5. `git add agent-dashboard.html`
6. Also add any new API route files or agent scripts
7. `git commit -m "[dashboard-v2] Complete redesign: tabs, visual previews, email client, analytics, mobile responsive, no popups"`
8. `git push`
9. Wait 2 minutes for Cloudflare deploy
10. Test on desktop: https://archive-35.com/agent-dashboard
11. Test on mobile: open same URL on phone
12. Verify all tabs load
13. Verify no `alert()` popups remain
14. Verify Instagram previews show images
15. Verify Reddit copy-to-clipboard works
16. Run email scan from dashboard
17. Log to build_log.json

---

# ESTIMATED TOTAL TIME: 12-16 hours
# BUILD ALL OF IT. DO NOT STOP. DO NOT ASK FOR PERMISSION.
# YOU HAVE FULL AUTONOMY. EVERY DECISION IS YOURS. LOG EVERYTHING.

---

*Phase 4 specification created March 18, 2026. Complete dashboard v2 redesign for Wolf's ADHD-optimized operator command center.*
