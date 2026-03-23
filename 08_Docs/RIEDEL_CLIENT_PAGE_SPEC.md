# Riedel Client Page — Claude Code Build Instructions

**Date:** March 2026  
**File to build:** `clients/riedel.html`  
**Status:** Prototype exists. Needs full rebuild — images not loading correctly.

---

## READ FIRST — MANDATORY

1. Read `CLAUDE.md` completely before touching anything
2. Read `css/styles.css` — this is the design system. Use it. Do not invent new styles.
3. Read `hospitality.html` — this page is the reference design. The Riedel page must look and feel identical.
4. The existing `clients/riedel.html` is a prototype. Use it as a reference for scene config and zone data. Rebuild it properly.

---

## What This Page Is

A **private, login-gated client page** for Riedel Communications. It lives at `archive-35.com/clients/riedel.html`. It is noindex — never appears in search. Riedel employees log in with a password and use it to visualize Archive-35 fine art photography on the actual walls of their offices, then request or purchase prints.

---

## File Locations — MEMORIZE

```
archive-35/
  clients/
    riedel.html                          ← THE FILE TO BUILD
  css/styles.css                         ← Design system — use this
  hospitality.html                       ← Reference design — copy the pattern
  data/photos.json                       ← Photo catalog (photos.data array, 1174 images)
  js/cart.js                             ← Cart logic
  js/cart-ui.js                          ← Cart UI
  js/auth.js                             ← Auth
  images/                                ← Photo thumbnails live here
  Riedel office photo mock up/           ← ALL Riedel scene images
    Riedel office wall 1.png             ← Scene: Wide Shot
    Riedel office wall 1 close up.png    ← Scene: Close-up
    Cubicle .png                         ← Scene: Cubicle
    conference room .png                 ← Scene: Conference Room
    training room final .png             ← Scene: Training Room
    training room wall 2.png             ← Scene: Training Wall 2
    foregrounds/
      wall1_fg.png                       ← Foreground layer: Wide Shot
      closeup_fg.png                     ← Foreground layer: Close-up
      cubicle_fg.png                     ← Foreground layer: Cubicle
      confroom_fg.png                    ← Foreground layer: Conference Room
      training_fg.png                    ← Foreground layer: Training Room
      training2_fg.png                   ← Foreground layer: Training Wall 2
```

---

## Design Rules — NON-NEGOTIABLE

- Use `../css/styles.css` — same CSS variables, same glass card components, same typography
- Font: Inter (already in styles.css) — do NOT use Cormorant, Jost, or any other font
- Colors: use `var(--accent)`, `var(--bg-primary)`, `var(--glass-border)` etc — never hardcode
- Nav: identical to hospitality.html — same `.header` / `.logo` / `.nav` / `.nav-toggle` structure
- Footer: identical to hospitality.html
- Gallery browser: COPY the exact two-level browser from hospitality.html (collections → photos)
- Canvas: COPY the `.visualizer-canvas-wrap` pattern from hospitality.html
- Template carousel: COPY `.template-carousel` / `.template-thumb` pattern from hospitality.html
- Page is NOT full-screen — it is a normal scrollable page like hospitality.html
- Maximum canvas width: 960px (hospitality uses 1200px — Riedel should be slightly more compact)

---

## Login Gate

- On page load, show a full-screen login gate (dark, matches site theme)
- Password: `riedel2026`
- On correct password: hide gate, show page, store `localStorage.setItem('riedel_auth','1')`
- On page load: if `localStorage.getItem('riedel_auth') === '1'`, skip gate automatically
- Wrong password: show inline error message, do not reload
- The gate should show the ARCHIVE-35 logo and "Private Preview — Riedel Communications"

---

## Scene Configuration

All scene images are in `Riedel office photo mock up/` relative to the repo root.
From `clients/riedel.html` the relative path is `../Riedel office photo mock up/`.

All images are 1536×1024px.

**The zone pixel coordinates define the CENTER REFERENCE POINT for art placement.**
Zone is NOT the minimum size — it is the spatial anchor. Images scale from small to large,
always centered at the zone's center point.

```javascript
const SCENES = [
  {
    id: 'wall1',
    label: 'Wide Shot',
    file: '../Riedel office photo mock up/Riedel office wall 1.png',
    fg:   '../Riedel office photo mock up/foregrounds/wall1_fg.png',
    w: 1536, h: 1024,
    zones: [
      { id:'left_wall',  label:'Left Wall',  px:{x1:312,y1:217,x2:615,y2:383} },
      { id:'right_wall', label:'Right Wall', px:{x1:910,y1:219,x2:1214,y2:391} },
    ]
  },
  {
    id: 'closeup',
    label: 'Close-up',
    file: '../Riedel office photo mock up/Riedel office wall 1 close up.png',
    fg:   '../Riedel office photo mock up/foregrounds/closeup_fg.png',
    w: 1536, h: 1024,
    zones: [
      { id:'left_wall',  label:'Left Wall',  px:{x1:414,y1:381,x2:604,y2:482} },
      { id:'right_wall', label:'Right Wall', px:{x1:884,y1:382,x2:1075,y2:488} },
    ]
  },
  {
    id: 'cubicle',
    label: 'Cubicle',
    file: '../Riedel office photo mock up/Cubicle .png',
    fg:   '../Riedel office photo mock up/foregrounds/cubicle_fg.png',
    w: 1536, h: 1024,
    zones: [
      { id:'right_wall', label:'Wall', px:{x1:578,y1:294,x2:895,y2:483} },
    ]
  },
  {
    id: 'confroom',
    label: 'Conference Room',
    file: '../Riedel office photo mock up/conference room .png',
    fg:   '../Riedel office photo mock up/foregrounds/confroom_fg.png',
    w: 1536, h: 1024,
    zones: [
      { id:'center', label:'Main Wall', px:{x1:646,y1:395,x2:878,y2:511} },
    ]
  },
  {
    id: 'training',
    label: 'Training Room',
    file: '../Riedel office photo mock up/training room final .png',
    fg:   '../Riedel office photo mock up/foregrounds/training_fg.png',
    w: 1536, h: 1024,
    zones: [
      { id:'left',   label:'Left',   px:{x1:275,y1:428,x2:449,y2:522} },
      { id:'center', label:'Center', px:{x1:652,y1:430,x2:825,y2:521} },
      { id:'right',  label:'Right',  px:{x1:1039,y1:422,x2:1211,y2:514} },
    ]
  },
  {
    id: 'training2',
    label: 'Training Wall 2',
    file: '../Riedel office photo mock up/training room wall 2.png',
    fg:   '../Riedel office photo mock up/foregrounds/training2_fg.png',
    w: 1536, h: 1024,
    zones: [
      { id:'left',  label:'Left',  px:{x1:913,y1:384,x2:1118,y2:489} },
      { id:'right', label:'Right', px:{x1:573,y1:389,x2:773,y2:489} },
    ]
  },
];
```

---

## Canvas Rendering — CRITICAL

This is a three-layer compositing system:

**Layer 1 — Background (bottom)**  
The office scene photo. Drawn at full canvas size.

**Layer 2 — Artwork (middle)**  
The selected Archive-35 photo, rendered centered at the zone's center point.
Scale is controlled by the size slider (0=small, 1=large).

**Layer 3 — Foreground (top)**  
The `_fg.png` file for the current scene. This is an RGBA PNG with the wall area transparent and the furniture (chairs, tables, monitors) opaque. It sits on top so furniture appears in front of the artwork.

### Canvas setup — RETINA SHARP
```javascript
const dpr = window.devicePixelRatio || 1;
canvas.width  = SCENE.w * dpr;
canvas.height = SCENE.h * dpr;
canvas.style.width  = SCENE.w + 'px';
canvas.style.height = SCENE.h + 'px';
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```
Do this on EVERY render call, not just on init. This is what makes it sharp on Retina/HiDPI screens.

### Art placement logic
```javascript
// Zone center — this is the anchor point
const cx = (zone.x1 + zone.x2) / 2;
const cy = (zone.y1 + zone.y2) / 2;

// Zone px dimensions establish a scale reference
// The zone was calibrated against real room geometry
// Use zone width as the horizontal scale reference
const zoneW = zone.x2 - zone.x1;
const zoneH = zone.y2 - zone.y1;
const ppiX = zoneW / 48;  // pixels per inch horizontal (48" reference width)
const ppiY = zoneH / 32;  // pixels per inch vertical (32" reference height)

// Print size from slider (sizeT = 0.0 to 1.0)
// Min: 20" on shortest side
// Max: image pixel count / 150 DPI, capped at Pictorem metal max 96x48"
const artRatio = photo.w / photo.h;
const maxW = Math.min(photo.w / 150, 96);
const maxH = Math.min(photo.h / 150, 48);
// Preserve aspect ratio at max
let finalMaxW = maxW, finalMaxH = maxW / artRatio;
if (finalMaxH > maxH) { finalMaxH = maxH; finalMaxW = maxH * artRatio; }
// Min size
const minShort = 20;
let finalMinW, finalMinH;
if (artRatio >= 1) { finalMinW = minShort * artRatio; finalMinH = minShort; }
else               { finalMinH = minShort * (1/artRatio); finalMinW = minShort; }
// Interpolate
const printW = finalMinW + (finalMaxW - finalMinW) * sizeT;
const printH = finalMinH + (finalMaxH - finalMinH) * sizeT;

// Render dimensions in scene pixels
const drawW = printW * ppiX;
const drawH = printH * ppiY;

// Draw centered at zone center
ctx.drawImage(photoImg, cx - drawW/2, cy - drawH/2, drawW, drawH);

// Print size label above artwork
ctx.fillStyle = 'rgba(0,0,0,0.75)';
ctx.fillRect(cx - drawW/2, cy - drawH/2 - 22, 200, 18);
ctx.fillStyle = '#e8b84d';
ctx.font = 'bold 12px Inter, sans-serif';
ctx.fillText(`${Math.round(printW)}" × ${Math.round(printH)}" — HD Metal`, cx - drawW/2 + 6, cy - drawH/2 - 8);
```

### Image loading — use the `full` field NOT thumbnail replacement
The photos.json has a `full` field: `"full": "images/alps/_MG_1871-full.jpg"`  
Use this directly: `photoImg.src = '../' + photo.full`  
Do NOT use string replacement on the thumbnail path — it breaks for some collections.
Always cache loaded images in a `imgCache = {}` object keyed by `photo.id`.

---

## Size Slider

- Range: 0 to 100, default: 50
- Label above slider shows current print size: `48" × 32"` (updates live as slider moves)
- Below slider left: `Smallest` | right: `Max XX" × YY"` (calculated from photo pixel count)
- Quality badge:
  - DPI ≥ 200: green `✓ Excellent — NNN DPI`
  - DPI 150–199: amber `○ Good — NNN DPI`  
  - DPI < 150: red `⚠ Reduce size — NNN DPI`
- DPI = `photo.w / printW` (width only, horizontal is the constraint)

---

## Gallery Browser — COPY FROM hospitality.html

Two-level browser, identical to hospitality.html:

**Level 1 — Collections grid**
- Load `data/photos.json` (field is `data.photos`)
- Group by `photo.collection` slug
- Each collection card shows: cover thumbnail, collection title, image count
- Click → drill into that collection

**Level 2 — Photos grid**
- Show all photos in the selected collection
- Each photo tile: thumbnail, title on hover
- Click → selects photo, loads full image, renders on canvas
- Active photo gets gold border

**Header row:**
- `← Back` button (hidden at level 1, visible at level 2)
- Breadcrumb: `All Collections` or collection name
- Count: `47 collections` or `23 images`

Grids use `.gb-grid` and `.gb-grid.photo-level` classes from styles.css (add them to this page's `<style>` block, copied from hospitality.html).

---

## Zone Pills

When a scene has more than one zone, show pills above the canvas:
- One pill per zone, labeled with zone's `label` field
- Selected zone gets active styling (gold border, gold text)
- Clicking a zone pill switches the active zone — art re-renders at new zone center
- If scene has only ONE zone, hide the pills entirely

---

## Scene Thumbnail Carousel

Copy `.template-carousel` / `.template-thumb` exactly from hospitality.html.
- One thumbnail per scene
- Use the scene's `file` path as the thumbnail image src
- Label overlay at bottom with scene name
- Active scene gets gold border
- No separate preview images — the raw scene file is the thumbnail

---

## Basket

- "Add to Basket" button — disabled until a photo is selected
- Each click adds one item: `{ title, printW, printH, scene, zone }`
- Show basket summary above gallery browser when items exist
- Each item shows: photo title, print size, scene name, zone name
- No checkout integration needed for v1 — basket is visual only
- "Request This Print" button opens: `mailto:wolf@archive-35.com` with subject and body pre-filled with selected photo title, size, and scene

---

## Photo Data Structure

From `data/photos.json`:
```json
{
  "photos": [
    {
      "id": "alps-001",
      "title": "Peaks Above the Frozen Valley",
      "thumbnail": "images/alps/_MG_1871-thumb.jpg",
      "full": "images/alps/_MG_1871-full.jpg",
      "collection": "alps",
      "collectionTitle": "Alps",
      "dimensions": {
        "width": 5472,
        "height": 2473
      }
    }
  ]
}
```

When loading a photo for canvas:
- Thumbnail: `src = '../' + photo.thumbnail` (for grid display)
- Full image: `src = '../' + photo.full` (for canvas render — USE THIS FIELD DIRECTLY)

---

## Nav Structure — COPY EXACTLY FROM hospitality.html

```html
<header class="header">
  <div class="header-inner">
    <a href="../index.html" class="logo"><span class="logo-white">ARCHIVE</span><span class="logo-gold">-35</span></a>
    <nav class="nav">
      <a href="../gallery.html">Gallery</a>
      <a href="../licensing.html">Licensing</a>
      <a href="../contact.html">Contact</a>
    </nav>
    <button class="nav-toggle" aria-label="Toggle navigation"><span></span><span></span><span></span></button>
  </div>
</header>
```

Include mobile nav toggle script (copy from hospitality.html).

---

## Scripts to Include

```html
<script src="https://js.stripe.com/v3/"></script>
<script>fetch('../data/stripe-config.json').then(r=>r.json()).then(c=>{window.STRIPE_PUBLIC_KEY=c.publishableKey;window.STRIPE_MODE=c.mode;}).catch(()=>{});</script>
<script src="../js/cart.js"></script>
<script src="../js/cart-ui.js?v=6"></script>
<script src="../js/auth.js?v=1"></script>
<script src="../js/image-protection.js"></script>
```

---

## Page Structure (top to bottom)

1. `<head>` — title, noindex meta, styles.css, GA4, page-specific styles
2. Login gate (fixed overlay, hidden after auth)
3. `<header>` — standard site nav
4. Hero section — small, centered: badge + title + one-line description
5. Visualizer section:
   a. Scene thumbnail carousel
   b. Zone pills (hidden if scene has 1 zone)
   c. Canvas (max-width 960px, centered)
   d. Size slider + quality badge
   e. Basket summary (hidden until items added)
   f. Gallery browser (collections → photos)
   g. CTA bar (Add to Basket + Request This Print)
6. `<footer>` — standard site footer
7. Scripts

---

## Deployment

After building and testing locally:
```bash
python3 sync_gallery_data.py
git add clients/riedel.html
git commit -m "Add Riedel client preview page"
git push
```

The `clients/` folder is NOT in `.cfignore` — verify it deploys.
If it doesn't deploy, add `clients/` to the deploy allowlist in `.cfignore` or `build.sh`.

Live URL will be: `https://archive-35.com/clients/riedel.html`

---

## Verification Checklist

Before reporting done, verify each of these:

- [ ] Login gate works — correct password shows page, wrong shows error
- [ ] Auto-login works on page reload after first login
- [ ] Scene thumbnails load and are clickable
- [ ] Switching scenes changes the canvas background
- [ ] Zone pills appear for multi-zone scenes, hidden for single-zone scenes
- [ ] Gallery browser loads — shows collection grid
- [ ] Clicking a collection shows photo grid
- [ ] Back button returns to collections
- [ ] Clicking a photo loads it on the canvas in the correct zone
- [ ] Artwork is centered in the zone, not top-left aligned
- [ ] Furniture/foreground layer renders ON TOP of the artwork
- [ ] Artwork does NOT bleed outside the canvas
- [ ] Size slider changes the rendered print size live
- [ ] Size label updates live as slider moves
- [ ] Quality badge shows correct DPI rating
- [ ] "Add to Basket" is disabled until photo selected
- [ ] Basket accumulates items correctly
- [ ] "Request This Print" opens pre-filled email
- [ ] Canvas is SHARP on Retina screen (not blurry)
- [ ] Page matches Archive-35 design — same font, same colors, same components
- [ ] Mobile nav toggle works
- [ ] Page loads without console errors
- [ ] Deploys to Cloudflare Pages correctly

---

## What NOT To Do

- Do NOT use a different font (no Cormorant, no Jost, no Roboto)
- Do NOT hardcode colors — use CSS variables
- Do NOT make the canvas full-screen
- Do NOT replace thumbnail src using string replacement — use the `full` field from photos.json
- Do NOT load full images for the gallery grid — thumbnails only there
- Do NOT skip the foreground layer — furniture must appear in front of artwork
- Do NOT commit without running sync_gallery_data.py first
- Do NOT add this page to the site nav (it's private)
- Do NOT add a sitemap entry
- Do NOT remove the noindex meta tag
