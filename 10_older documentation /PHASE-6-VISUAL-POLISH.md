# PHASE 6 BUILD — Visual Polish: Match the ChatGPT Control Center Mockup
## Claude Code: Read this top to bottom. Build everything. Do not stop until done.
## Owner: Wolf Schram | Date: March 18, 2026
## Context: Phase 5 layout is functional. This phase is PURELY visual polish + bug fixes.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK
**Log every decision to `Archive 35 Agent/data/build_log.json`**

---

## WHAT THIS IS

The dashboard layout (left rail, tabs, KPI cards, email split panel) is working. But it looks flat and boring compared to the ChatGPT mockup Wolf approved. This phase makes it look like that mockup. Every change here is CSS/HTML presentation — no new API endpoints needed.

## THE REFERENCE MOCKUP (from ChatGPT)

Wolf approved a specific mockup with these visual characteristics:
1. **Status chips at very top**: `1 Critical` (red pill), `2 Warning` (amber pill), `5 Healthy` (green pill) — horizontal row above everything
2. **Hero headline**: "Command Center, redesigned for quick reading" with subtitle explaining the layout
3. **Action buttons top-right**: Start Agent, Pause, Refresh, Open Logs — as a horizontal button group
4. **KPI cards with colored left borders and icons**: System Status (amber left border + warning icon), Agents Live (blue left border + sync icon), Sales Today (green left border + dollar icon), API Spend (blue left border + clock icon)
5. **"Immediate Action" section with structured cards**: Each card has an icon, module name, status chip, description, and 2 action buttons
6. **Live Feed as a timeline**: colored dots with timestamps and short descriptions
7. **Platform Controls as compact tiles**: icon + name + chip + one line + 2 buttons per tile, arranged in a 2-column grid
8. **Connectivity panel**: separate card showing external systems (Cloudflare, Google, Stripe, Bing) with connection status chips
9. **Performance/Sales progress**: progress bar at bottom right
10. **Rounded corners everywhere**: 12-16px border radius
11. **Subtle card depth**: box shadows that create layered feel
12. **Clean typography**: Inter font, clear size hierarchy (24px KPI numbers, 14px body, 12px labels)

---

## RULES
1. ONLY modify `agent-dashboard.html`
2. Do NOT change any JavaScript fetch() URLs or API logic
3. Do NOT break any working functionality
4. Keep all existing tab switching, email reading, button actions
5. Deploy: `python3 sync_gallery_data.py && git add agent-dashboard.html && git commit && git push`

---

# TASK 1: STATUS SUMMARY PILLS AT TOP
**Time: 15 min**

Add a row of status summary pills between the top bar and the left rail content area. These show the aggregate health at a glance:

```html
<div class="status-pills">
  <span class="pill pill-critical" id="pill-critical">0 Critical</span>
  <span class="pill pill-warning" id="pill-warning">0 Warning</span>
  <span class="pill pill-healthy" id="pill-healthy">0 Healthy</span>
</div>
```

```css
.status-pills {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.pill {
  padding: 4px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.pill-critical { background: rgba(251,113,133,0.15); color: #FB7185; }
.pill-warning { background: rgba(251,191,36,0.15); color: #FBBF24; }
.pill-healthy { background: rgba(52,211,153,0.15); color: #34D399; }
```

Place this at the top of the main content area (inside the overview panel, above the KPI cards).

Count logic (in the health polling JS):
- Critical = any agent with errors or connectivity down
- Warning = stale data (>2h since last run), Instagram token expiring soon, Etsy API errors
- Healthy = everything else that's connected and running

---

# TASK 2: KPI CARDS WITH COLORED LEFT BORDERS AND ICONS
**Time: 30 min**

The current KPI cards are plain boxes. Add:
1. **4px colored left border** (color matches status)
2. **Small icon** top-right corner of each card
3. **Larger number** (bump to 28-32px)
4. **Softer subtitle** text

```css
.kpi-card {
  position: relative;
  padding-left: 20px;
  border-left: 4px solid var(--status-idle);
}
.kpi-card.status-online { border-left-color: var(--status-healthy); }
.kpi-card.status-warning { border-left-color: var(--status-warning); }
.kpi-card.status-critical { border-left-color: var(--status-critical); }
.kpi-card .kpi-icon {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  background: rgba(255,255,255,0.05);
}
.kpi-card .kpi-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
}
.kpi-card .kpi-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.kpi-card .kpi-subtitle {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}
```

Icons (use simple Unicode/emoji — no external icon library needed):
- System Status: ⚡ (or ⚠ when warning)
- Agents Live: ⟳
- Sales Today: $
- API Spend: ◷

---

# TASK 3: NEEDS ATTENTION CARDS — STRUCTURED LIKE MOCKUP
**Time: 45 min**

Each "Needs Attention" item should be a proper card with:

```
┌──────────────────────────────────────────────────────────┐
│ 📮 Reddit Publisher                    ⚠ Queue blocked   │
│                                                          │
│ Next queued posts are not advancing. 30 posts waiting,   │
│ 0 posted so far.                                         │
│                                                          │
│ [Fix Queue]     [View Logs]                              │
└──────────────────────────────────────────────────────────┘
```

```css
.attention-card {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 20px;
  border-left: 4px solid var(--status-warning);
  margin-bottom: 12px;
}
.attention-card.critical { border-left-color: var(--status-critical); }
.attention-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.attention-card-title {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.attention-card-body {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.5;
}
.attention-card-actions {
  display: flex;
  gap: 8px;
}
```

Current attention items are just text lines. Rebuild them into these structured cards. The data is already there — just wrap it better.

Items to show:
- Instagram: "Not configured" → Show with action: [Set Up Meta API] [View Docs]
- Reddit: "30 queued, 0 posted" → Show with: [Open Social Tab] [Generate New]
- Indiewalls: "No reply in 14 days" → Show with: [Send Follow-Up] [Open Indiewalls]
- Email briefing stale (if >2h since scan) → Show with: [Scan Now] [Open Gmail]

---

# TASK 4: LIVE FEED AS TIMELINE WITH COLORED DOTS
**Time: 30 min**

The activity feed currently shows raw JSON in the details. Clean it up:

```css
.feed-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(51,65,85,0.3);
  font-size: 13px;
}
.feed-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}
.feed-dot.success { background: var(--status-healthy); }
.feed-dot.error { background: var(--status-critical); }
.feed-dot.warning { background: var(--status-warning); }
.feed-dot.info { background: var(--status-info); }
.feed-time {
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
  min-width: 50px;
}
.feed-action {
  color: var(--text-primary);
}
.feed-detail {
  color: var(--text-dim);
  font-size: 11px;
}
```

Format the feed entries as human-readable one-liners:
- "Instagram post published" (green dot)
- "Queue error in Reddit scheduler" (red dot)
- "SEO audit completed — score 79.3" (green dot)
- "Content generated for photo af8964..." (blue dot)

Strip the raw JSON. Show only: timestamp + dot + action + optional detail.

If the raw JSON is too complex to parse cleanly, at minimum show: `component` + `action` as the summary, hide the JSON `details` behind a click-to-expand.

---

# TASK 5: PLATFORM CONTROL TILES — COMPACT 2-COLUMN GRID
**Time: 30 min**

The platform tiles in the overview tab should be compact:

```css
.platform-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.platform-tile {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.platform-tile-icon {
  font-size: 20px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.05);
  border-radius: 8px;
  flex-shrink: 0;
}
.platform-tile-content {
  flex: 1;
  min-width: 0;
}
.platform-tile-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.platform-tile-name {
  font-size: 14px;
  font-weight: 600;
}
.platform-tile-desc {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.platform-tile-actions {
  display: flex;
  gap: 6px;
}
.platform-tile-actions .btn {
  font-size: 11px;
  padding: 4px 12px;
}
```

Tile content:
| Tile | Icon | Name | Chip | Desc | Actions |
|------|------|------|------|------|---------|
| Instagram | 📷 | Instagram | ✓ Healthy | 12 posts today, batch ready | [Post Now] [Batch 3] |
| Pinterest | 📌 | Pinterest | ✓ Healthy | Pin generator online | [Gen Pins] [Preview] |
| Etsy SEO | 🏪 | Etsy SEO | ⚠ Review | Score 79.3, audit available | [Run Audit] [→ Shop] |
| Broadcast | 📡 | Broadcast | ○ Idle | Ready to trigger full run | [Broadcast] [History] |
| Email | 📧 | Email | ✓ Healthy | 3 accounts, 22 new | [Scan Now] [→ Gmail] |
| Content | ✏️ | Content Gen | ○ Idle | Generator ready | [Run Pipeline] [Queue] |

---

# TASK 6: CONNECTIVITY PANEL
**Time: 20 min**

Add a "Connectivity" card to the overview tab, right side, showing external system connections:

```html
<div class="card connectivity-card">
  <div class="card-title">External Systems</div>
  <div class="connectivity-list" id="connectivity-list">
    <!-- populated by JS -->
  </div>
</div>
```

Each item:
```html
<div class="conn-item">
  <span class="conn-icon">☁️</span>
  <span class="conn-name">Cloudflare</span>
  <span class="chip chip-healthy">Connected</span>
</div>
```

Systems to show:
- Cloudflare → always Connected (static, since we deploy there)
- Stripe → check if Stripe key is set in API
- Google Search Console → check if verified (or show "Needs setup")
- Bing Webmaster → check if verified (or show "Needs auth")
- Pictorem → static Connected (fulfillment partner)

---

# TASK 7: SALES PROGRESS BAR — BIGGER AND PRETTIER
**Time: 20 min**

The current sales thermometer is tiny. Make it bigger and use a gradient fill:

```css
.sales-progress {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 20px;
}
.sales-bar-track {
  height: 20px;
  background: rgba(255,255,255,0.05);
  border-radius: 10px;
  overflow: hidden;
  margin: 12px 0;
}
.sales-bar-fill {
  height: 100%;
  border-radius: 10px;
  background: linear-gradient(90deg, var(--accent-gold), #E5C158);
  transition: width 1s ease-out;
  min-width: 4px;
}
.sales-amount {
  font-size: 24px;
  font-weight: 700;
}
.sales-goal {
  font-size: 14px;
  color: var(--text-dim);
}
.sales-breakdown {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
```

Animate the fill bar on page load with a CSS transition.

---

# TASK 8: GLOBAL TYPOGRAPHY AND SPACING
**Time: 20 min**

Apply consistent typography across the entire dashboard:

```css
/* Headings */
h1, .page-title { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
h2, .section-title { font-size: 16px; font-weight: 600; letter-spacing: 0; color: var(--text-secondary); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
h3, .card-title { font-size: 14px; font-weight: 600; }

/* Section spacing */
.section { margin-bottom: 24px; }
.card + .card { margin-top: 12px; }

/* Section labels */
.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 12px;
}
```

Apply `.section-label` to: "IMMEDIATE ACTION", "LIVE FEED", "PLATFORM CONTROLS", "SALES GOAL", etc.

---

# TASK 9: LEFT RAIL POLISH
**Time: 15 min**

Make the left rail feel more like the mockup:

```css
.left-rail {
  background: var(--bg-rail);
  border-right: 1px solid var(--border);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 8px;
  margin: 2px 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}
.nav-item:hover {
  background: rgba(255,255,255,0.05);
  color: var(--text-primary);
}
.nav-item.active {
  background: rgba(201,168,76,0.1);
  color: var(--accent-gold);
  border-left: 3px solid var(--accent-gold);
  font-weight: 600;
}
```

Add a small gear icon (⚙) next to each nav item that has a settings panel.
Add email count badge (small coral circle) next to Email nav item when there are action items.

---

# TASK 10: CARD HOVER EFFECTS
**Time: 10 min**

All clickable cards should have a subtle hover effect:

```css
.card {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.card:hover:not(.no-hover) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -8px rgba(0,0,0,0.4);
}
```

Add `.no-hover` class to cards that shouldn't lift (like the email reader panel, the KPI cards).

---

# TASK 11: EMPTY STATES
**Time: 15 min**

When sections have no data, show a friendly empty state instead of blank space or "Loading...":

```css
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-dim);
}
.empty-state-icon {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.5;
}
.empty-state-text {
  font-size: 14px;
}
```

Examples:
- No sales: "No sales yet — the broadcast is running, give it time ⏳"
- No agent visits: "No AI agent requests yet. Broadcast is seeding the network 📡"
- All systems healthy in Needs Attention: "✓ Everything running smoothly" (green text)
- No emails: "Inbox zero. Nice work 📭"

---

# ORDER OF OPERATIONS

```
Task 8:  Typography and spacing (foundation) — 20 min
Task 9:  Left rail polish — 15 min
Task 10: Card hover effects — 10 min
Task 2:  KPI cards with borders and icons — 30 min
Task 1:  Status summary pills — 15 min
Task 3:  Attention cards structured — 45 min
Task 4:  Live feed timeline — 30 min
Task 5:  Platform tiles compact grid — 30 min
Task 6:  Connectivity panel — 20 min
Task 7:  Sales progress bar — 20 min
Task 11: Empty states — 15 min
```

Total: ~4-5 hours

---

# DEPLOYMENT

```bash
cd ~/Documents/ACTIVE/archive-35
python3 sync_gallery_data.py
git add agent-dashboard.html
git commit -m "[dashboard-v4] Visual polish: status pills, KPI borders, attention cards, timeline feed, compact tiles, connectivity panel"
git push
```

---

# ESTIMATED TOTAL TIME: 4-5 hours
# THIS IS CSS/HTML ONLY. NO NEW API ENDPOINTS.
# MAKE IT LOOK LIKE THE CHATGPT MOCKUP WOLF APPROVED.
# LOG EVERYTHING TO build_log.json.

---

*Phase 6 specification created March 18, 2026. Visual polish pass to match ChatGPT Control Center mockup aesthetic.*
