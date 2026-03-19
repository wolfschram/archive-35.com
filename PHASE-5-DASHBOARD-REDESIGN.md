# PHASE 5 BUILD — Dashboard Redesign: Control Center UX Overhaul
## Claude Code: Read this top to bottom. Build everything. Do not stop until done.
## Owner: Wolf Schram | Date: March 18, 2026
## Context: Phase 4 dashboard is functional but visually flat and UX-broken. This is a COMPLETE visual and interaction redesign.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK

**You have ALL permissions. Do not stop to ask for permission at any point.**
**Log every decision to `Archive 35 Agent/data/build_log.json`**

---

## THE PROBLEM

The current dashboard is a wall of identical-weight cards. Everything looks the same. Nothing screams "look here first." An ADHD brain opens it and sees noise — not signal. The email tab is read-only. Buttons trigger popups. Reddit POST gives 404s. Connectivity dots are wrong. It's functional plumbing with no UX.

## THE VISION

Think: **Apple Control Center meets ops cockpit.** Not an admin panel. A command center where you open it and in 2 seconds you know: what's broken, what made money, what needs action now.

## DESIGN REFERENCE

Wolf had ChatGPT generate a mockup with these key ideas. FOLLOW THIS DIRECTION:
- Left rail navigation (cockpit sidebar, not top tabs)
- "Needs Attention Now" priority lane at top of overview
- Status chips with icons + labels (✓ Healthy, ⚠ Warning, ✗ Blocked, ◷ Stale)
- Healthy systems collapse to one line by default
- Control tiles: icon, name, chip, one-sentence, 2 action buttons
- KPI cards at top: System Status, Agents Live, Sales Today, API Spend
- Scan mode toggle: "Needs Attention" vs "All Systems"
- Kill switch isolated in sidebar
- Live activity feed with colored dots
- Sales progress thermometer
- Deep slate blue background (#0F172A), NOT pure black
- Elevated cards (#1E293B) with subtle shadows and hover lift
- Inter font (sans-serif), NOT monospace for body text

---

## DESIGN PRINCIPLES (NON-NEGOTIABLE)

1. **Attention-first**: Broken/stale/blocked items SCREAM at the top. Healthy systems collapse to one line.
2. **Left rail navigation**: Not top tabs. A cockpit sidebar — always visible, always reachable.
3. **Status chips with icons + labels**: Never color alone. Always: icon + color + word.
4. **Control tiles, not info dumps**: Each module shows: icon, name, status chip, one-sentence state, 1 primary + 1 secondary action. That's it.
5. **No popups ever**: Inline feedback. Button states: idle → working → done/failed with reason.
6. **ADHD/Dyslexia-friendly**: Sans-serif font (Inter), generous spacing, short labels, chunked sections, progressive disclosure.
7. **Dark mode done right**: Background `#0F172A` (deep slate blue). Cards `#1E293B`.
8. **Accent colors with meaning**:
   - Critical/broken: Coral red `#FB7185`
   - Active/healthy: Mint green `#34D399`
   - Warning/stale: Amber `#FBBF24`
   - Info/new: Electric blue `#38BDF8`
   - Idle/neutral: Slate `#64748B`
   - Gold accent (brand): `#C9A84C`

---

## RULES

1. Read CLAUDE.md first
2. NEVER deploy without `python3 sync_gallery_data.py`
3. This is ONE HTML file: `agent-dashboard.html`
4. All data from API on port 8035 via fetch()
5. Keep ALL existing API endpoint calls — just redesign the presentation layer
6. DO NOT break any working functionality while redesigning

---

## LAYOUT STRUCTURE

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ARCHIVE-35 Operator Center                    [Start Agent] [Pause] [↻] │
│ ● 1 Critical  ● 2 Warning  ● 5 Healthy              Updated 1:30 PM   │
├────────────┬─────────────────────────────────────────────────────────────┤
│            │                                                             │
│ LEFT RAIL  │  MAIN CONTENT AREA                                         │
│            │  (changes based on selected nav item)                       │
│ ┌────────┐ │                                                             │
│ │Overview│ │                                                             │
│ │Social  │ │                                                             │
│ │Email   │ │                                                             │
│ │Analyti.│ │                                                             │
│ │Broadc. │ │                                                             │
│ │Learning│ │                                                             │
│ │Links   │ │                                                             │
│ │        │ │                                                             │
│ │Scan:   │ │                                                             │
│ │[Needs  │ │                                                             │
│ │ Attn]  │ │                                                             │
│ │[All    │ │                                                             │
│ │ Sys]   │ │                                                             │
│ │        │ │                                                             │
│ │[KILL   │ │                                                             │
│ │ SWITCH]│ │                                                             │
│ └────────┘ │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
```

---

## CSS FOUNDATION

```css
:root {
  --bg-base: #0F172A;
  --bg-rail: #0B1120;
  --bg-card: #1E293B;
  --bg-card-hover: #263548;
  --text-primary: #F1F5F9;
  --text-secondary: #94A3B8;
  --text-dim: #64748B;
  --status-critical: #FB7185;
  --status-warning: #FBBF24;
  --status-healthy: #34D399;
  --status-info: #38BDF8;
  --status-idle: #64748B;
  --accent-gold: #C9A84C;
  --border: #334155;
  --border-light: #475569;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --shadow-card: 0 4px 6px -1px rgba(0,0,0,0.3);
  --shadow-hover: 0 10px 15px -3px rgba(0,0,0,0.4);
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
}

body {
  font-family: var(--font-sans);
  background: var(--bg-base);
  color: var(--text-primary);
  line-height: 1.6;
}
```

Load Inter font:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Card styling**: rounded 12px, subtle shadow, hover lift (translateY -2px).
**Status chips**: pill shape, transparent tinted background + colored text + small icon.
**Buttons**: gold primary, transparent bordered secondary. States: idle/working/success/failed.

---

## OVERVIEW TAB (DEFAULT)

### Row 1: Four KPI Cards
System Status | Agents Live (4/6) | Sales Today ($0) | API Spend ($1.90)
Each card: left border colored by status, large number, subtitle, small icon.

### Row 2: IMMEDIATE ACTION — "Needs Your Attention Now"
Only broken/stale/blocked items. Cards with coral/amber left borders.
When everything healthy: "✓ All systems running" with green checkmark.

Include Indiewalls stuck item (14 days no reply) with [Send Follow-Up] button.

### Row 3: Live Feed (left) + Sales Progress (right)
Feed: colored dots + timestamp + action description.
Sales: animated gradient gold bar, $0/$5,000, per-channel breakdown.

### Row 4: Platform Controls
Collapsed tiles when in "Needs Attention" mode. Expand in "All Systems" mode.
Each tile: icon + name + chip + one sentence + 2 buttons + platform link.

---

## SOCIAL TAB

### Instagram
- Next 3 posts with thumbnail images and captions
- Last 5 posted with thumbnails
- [POST 1 NOW] [POST BATCH (3)]
- → Open Instagram link

### Reddit
- Full post preview with image
- Copy-to-clipboard buttons for title, body, tags (flash green on copy)
- [OPEN r/{subreddit} SUBMIT] opens old.reddit.com in new tab
- [MARK POSTED] calls `/reddit/mark-posted` (FIX: currently calls wrong endpoint)
- [SKIP →] advances to next post
- [GENERATE NEW POST] creates single new post

### Pinterest
- Pin previews from `/pinterest/pin-image/` endpoint
- [GENERATE PINS] [DOWNLOAD CSV]
- → Open Pinterest link

---

## EMAIL TAB — ACTUALLY FUNCTIONAL

Split panel: left = email list from briefing, right = email reader.

Click email → loads full body in reader → action buttons: [Archive] [Delete] [Open in Gmail]

Color-coded categories:
- 🔴 Action Required (coral left border)
- 🔴 Security alerts (red background tint)
- 🔵 Business (blue left border)
- ⚪ FYI (no border, dimmer text)

API endpoints already exist: `/email/read`, `/email/archive`, `/email/delete`. Wire them up.

---

## ANALYTICS TAB

- AI Agent Discovery Intelligence (from existing endpoint)
- Etsy Performance with SEO score + top 5 worst listings
- Micro-Licensing stats
- External analytics links (Cloudflare, Bing, Google, Stripe)

---

## BROADCAST TAB

- Last broadcast results with check/cross per step
- [RUN FULL BROADCAST] button with inline status
- IndexNow history

---

## LEARNING TAB

- Embedded ATHOS vocab trainer (iframe to https://athos-obs.com/vocab/)
- → Open in New Tab link

---

## LINKS TAB

All 15+ platform links in card grid. Organized by category:
My Websites | Sales Channels | Social Media | Infrastructure | Search Engines | Email

---

## CRITICAL BUGS TO FIX

1. **Reddit POST 404**: Dashboard calls `/reddit/post` but endpoint is `/reddit/mark-posted`. Fix the JS fetch URL.
2. **Instagram red dot**: Check `/instagram/status` for `token_valid` not just connection.
3. **Etsy 0 listings**: Token may need refresh. Show "Needs reauth" if expired.
4. **Email read-only**: Wire click handlers → `/email/read` → render in panel → Archive/Delete buttons.
5. **Pinterest no pins**: Verify `/pinterest/pin-image/{filename}` endpoint serves from `02_Social/pinterest/pins/`.
6. **Remaining alert() calls**: Replace ALL with inline status system.

---

## MOBILE RESPONSIVE

Left rail → bottom tab bar (icons only) on screens < 768px.
KPI cards → 2x2 grid.
Email split panel → stacked (list on top, reader below).
All buttons min 44px touch target.

---

## DONE CRITERIA

- [ ] Left rail navigation works on desktop and mobile
- [ ] Overview: KPI cards, Needs Attention lane, live feed, sales thermometer
- [ ] Healthy systems collapse. Broken systems prominent.
- [ ] Status chips: icon + color + label everywhere
- [ ] Social: Instagram previews, Reddit copy-paste works (no 404), Pinterest pins
- [ ] Email: click → read → archive/delete/open in Gmail
- [ ] No alert() popups anywhere
- [ ] Inter font, deep slate background, elevated cards with hover lift
- [ ] All platform links in widgets + Links tab
- [ ] Mobile responsive
- [ ] Kill switch in sidebar
- [ ] Scan mode toggle: Needs Attention / All Systems

---

## DEPLOYMENT

```bash
cd ~/Documents/ACTIVE/archive-35
python3 sync_gallery_data.py
git add agent-dashboard.html
git commit -m "[dashboard-v3] Control center redesign: left rail, attention-first UX, status chips, ADHD-optimized"
git push
```

---

# ESTIMATED TOTAL TIME: 8-12 hours
# BUILD ALL OF IT. DO NOT STOP. DO NOT ASK FOR PERMISSION.
# THIS IS THE FINAL DASHBOARD. MAKE IT BEAUTIFUL AND FUNCTIONAL.
# LOG EVERYTHING TO build_log.json.

---

*Phase 5 specification created March 18, 2026. Design direction from Apple Control Center + ChatGPT mockup analysis + Wolf's ADHD/dyslexia requirements.*
