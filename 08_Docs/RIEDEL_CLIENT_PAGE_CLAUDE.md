# Riedel Client Page — CLAUDE.md

This file exists so Claude never repeats the same mistakes on this project.
Read this BEFORE touching riedel.html.

---

## THE MOST IMPORTANT RULE

**LOOK AT THE ACTUAL IMAGE FILES BEFORE TOUCHING ZONE COORDINATES.**

Use `Claude in Chrome:computer` to screenshot each scene image with a pixel grid.
Do NOT guess, do NOT rely on old coords, do NOT trust filenames.
The grid tool is in riedel.html comments — just load the image URL and draw a canvas grid.

---

## FILE LOCATIONS

- Page: `riedel.html` (repo root)
- Scene images: `images/riedel-scenes/*.png`
- Foreground masks: `images/riedel-scenes/foregrounds/*_fg.png`
- Pricing/product logic: `js/product-selector.js` — DO NOT MODIFY
- Deploy: `python3 sync_gallery_data.py && git add riedel.html && git commit && git push`
- Live URL: `https://archive-35.com/riedel.html` (password: `riedel2026`)

---

## SCENE IMAGE FACTS (verified by screenshot grid, March 2026)

| File | What it actually shows | Label in page |
|---|---|---|
| `closeup.png` | Wide open room, two benches, two wall sections | "Wide Shot" |
| `wall1.png` | Two cramped rooms split by white line | NOT USED — removed |
| `cubicle.png` | Single cubicle wall | "Cubicle" |
| `confroom.png` | Conference room, one main wall | "Conference Room" |
| `training.png` | Training room, three wall panels | "Training Room" |
| `training2.png` | Break room / lounge, one large wall | "Training Wall 2" |

**KEY LESSON:** The filename `closeup.png` is actually the WIDE SHOT. `wall1.png` is NOT used.
This was discovered by screenshotting both images. Never trust filenames alone.

---

## VERIFIED ZONE COORDINATES (measured from screenshot grid)

All coordinates are in the 1536×1024 scene pixel space.

```javascript
// Wide Shot (closeup.png)
left_wall:  { x1:280, y1:250, x2:690,  y2:570 }  // above left bench
right_wall: { x1:760, y1:250, x2:1270, y2:570 }  // above right bench

// Cubicle (cubicle.png) — not re-measured, use with caution
wall: { x1:578, y1:294, x2:895, y2:483 }

// Conference Room (confroom.png) — +15% from original
center: { x1:629, y1:386, x2:895, y2:520 }

// Training Room (training.png) — not re-measured, visually confirmed working
left:   { x1:275, y1:428, x2:449, y2:522 }
center: { x1:652, y1:430, x2:825, y2:521 }
right:  { x1:1039, y1:422, x2:1211, y2:514 }

// Training Wall 2 (training2.png) — one large wall, split left/right
left:  { x1:490, y1:290, x2:870, y2:620 }  // left half of wall
right: { x1:890, y1:290, x2:1270, y2:620 } // right half of wall
```

**HOW TO RE-MEASURE if coords are ever wrong:**
1. Navigate to `https://archive-35.com/images/riedel-scenes/[filename].png`
2. Run this JS to draw a 100px grid:
```javascript
const img = document.querySelector('img');
const c = document.createElement('canvas');
c.width=1536; c.height=1024;
c.style.cssText='position:fixed;top:0;left:0;width:100vw;height:auto;z-index:9999;';
const ctx=c.getContext('2d');
ctx.drawImage(img,0,0);
ctx.strokeStyle='rgba(255,0,0,0.5)'; ctx.lineWidth=1;
for(let x=0;x<=1536;x+=100){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,1024);ctx.stroke();ctx.fillStyle='red';ctx.font='12px sans-serif';ctx.fillText(x,x+2,15);}
for(let y=0;y<=1024;y+=100){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1536,y);ctx.stroke();ctx.fillStyle='red';ctx.fillText(y,2,y+12);}
document.body.innerHTML=''; document.body.appendChild(c);
```
3. Take a screenshot. Read the grid coordinates visually.
4. Identify the wall zone boundaries. Set x1/y1 to top-left corner, x2/y2 to bottom-right.

---

## RENDER MATH (HOW IMAGES ARE SIZED ON CANVAS)

```javascript
// DO NOT use inches/ppi math. Use zone-relative scaling.
var zoneW = px.x2 - px.x1;
var maxDrawW = zoneW * 0.92;  // largest print fills 92% of zone width
var scale = sz[0] / maxSz[0]; // current size / largest available size
var drawW = maxDrawW * scale;
var drawH = drawW / photoAR;  // preserve photo aspect ratio
// Center in zone:
ctx.drawImage(img, cx - drawW/2, cy - drawH/2, drawW, drawH);
```

**WHY:** The old `ppiX = zoneW/48` approach gave 150-200px wide images (postage stamps).
The zone-relative approach always produces visible, proportional images.

---

## ARCHITECTURE

### What riedel.html contains
- Login gate (password: `riedel2026`, stored as plain string in JS)
- Scene carousel (thumbnails of 5 rooms)
- Zone pills (Left Wall / Right Wall / etc per scene)
- Canvas visualizer (draws background + photos + foreground mask)
- Inline config panel: material dropdown, frame dropdown, mat dropdown, size slider, DPI badge, price
- Room total price breakdown (shows per-zone prices + total)
- Gallery browser (collections → photos, click to assign to current zone)
- Basket (add/remove items, running total)
- Nav basket icon with count badge

### What riedel.html does NOT contain
- Payment processing — handled by `js/product-selector.js` + Stripe
- Product catalog — loaded from `js/product-selector.js`
- Photo data — fetched from `data/photos.json`

### PRICE_TABLE in riedel.html
This is a COPY of the data in `js/product-selector.js`.
If prices change, update BOTH files.
The table must include ALL size keys that AR_SIZES references — if a key is missing, price shows blank.

### Thumbnail-first loading
photos load thumbnail first for instant canvas preview, full-res swaps in the background.
Cache keys: `ph.id + '_thumb'` and `ph.id + '_full'`.

---

## LESSONS LEARNED (hard way)

### 1. Always screenshot images before touching zone coords
Three sessions were wasted guessing. One screenshot with a pixel grid gives exact truth.
The Zone Calibrator HTML tool at `Riedel office photo mock up/ZONE_CALIBRATOR.html` also works.

### 2. Filenames are backwards
`closeup.png` = the WIDE SHOT. `wall1.png` = cramped close-up (not used).
This caused multiple rounds of wrong label swaps. The images ARE the truth; filenames are not.

### 3. Never swap labels without screenshotting first
Swapping `label: 'Wide Shot'` and `label: 'Close-up'` multiple times caused
complete confusion. The rule: look at the image, name it for what it shows.

### 4. ppiX/48 render math produces invisible images
The old render approach: `drawW = printSize_inches * (zonePixels / 48)`
gave ~150-200px wide images on a 1536px canvas — invisible postage stamps.
Fixed by using zone-relative scaling (92% of zone width for largest size).

### 5. Script tag ordering causes initVisualizer scope errors
If login IIFE and `function initVisualizer()` are in separate `<script>` blocks,
the IIFE runs before the function is defined — ReferenceError.
Fix: merge into one `<script>` block so function hoisting works.

### 6. display:none -> display:block causes layout shift (wobble)
The login gate used `display:none` on `#page-content`, then switched to `display:block`.
This causes a scrollbar to appear/disappear, shifting the page layout.
Fix: use `opacity:0` + `pointer-events:none` instead, plus `overflow-y:scroll` on body.

### 7. Thumbnail-first loading prevents slider from being unresponsive
Loading full-res images (8000px+ files) before rendering means the slider is
unresponsive for 3-5 seconds on photo selection.
Fix: load thumbnail immediately for canvas preview, full-res in background.

### 8. Zone coords must be re-verified after ANY image file change
If someone replaces a scene image, all coords for that scene must be re-measured.

### 9. Don't remove scenes without visually confirming which file is which
Close-up was removed based on filename. But `closeup.png` was actually the better
image (wide shot). The wrong file was being used for months.

### 10. Collections order matters to Wolf
Priority: Large Scale Stitch → Black & White → New York → LA → National Parks →
Mexico → Canada → California → Iceland → Tanzania → rest alphabetical.
This is coded in `COLLECTION_PRIORITY` array in the JS.

---

## WHAT WORKS (as of latest deploy)

- Login gate + auto-login via localStorage
- 5 scenes in carousel: Wide Shot, Cubicle, Conference Room, Training Room, Training Wall 2
- Default photos placed on all zones at load (NY, Iceland, Antelope Canyon, Grand Teton, Tanzania)
- Zone pills with checkmark when photo assigned
- Both zones render simultaneously (no flip-flopping)
- Config panel: material, frame, mat dropdowns
- Size slider: defaults to best DPI (>=200), drag to resize, canvas updates live
- DPI quality badge: Museum/Excellent/Good/Low
- Price updates live per material + size
- Room total breakdown when 2+ zones have photos
- Basket: add items, see list, remove, running total
- Nav basket icon with count badge
- Collections ordered by priority
- Header fixed/sticky matches rest of site
- No layout wobble on login
- Thumbnail-first loading for instant response

## KNOWN REMAINING ISSUES (as of March 2026)

- Wide Shot and Training Wall 2 zones may need fine-tuning after latest coord update
- Conference Room zone was increased +15% but not re-verified visually
- Cubicle and Training Room zones not re-measured (were visually confirmed working earlier)
