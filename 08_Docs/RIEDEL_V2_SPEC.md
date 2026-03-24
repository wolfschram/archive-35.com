# Riedel Client Page — V2 Rebuild Spec
**File:** `riedel.html` (root level, already deployed)
**Date:** March 2026

Read CLAUDE.md before touching anything. This is a live site.

---

## WHAT IS BROKEN RIGHT NOW

1. **Default image missing** — canvas shows bare room on load. Must show a default photo (New York collection) placed on the wall immediately.
2. **Canvas cropped/cut off** — scene images are not displaying at full size. Canvas must show the full room photo edge-to-edge.
3. **Wrong product selector** — currently has a basic size slider. Must use the EXACT same `product-selector.js` that gallery.html uses. No custom pricing. No custom size logic. Same system, same prices, same materials.
4. **Both zones must show simultaneously** — Wide Shot has left wall + right wall. Both must show a photo at the same time. Switching zone pills should select WHICH zone to configure next, not hide the other.
5. **Right wall not visible** — zone is outside the visible canvas area. Needs investigation.
6. **Basket is invisible** — items added to basket don't show anywhere visible.
7. **No material/border selector** — must have canvas, metal, acrylic, paper, wood selection + border/mat option, exactly as in gallery.html.
8. **Size options wrong** — must use exact sizes from ASPECT_RATIO_CATEGORIES in product-selector.js, not a free slider.

---

## THE GOLDEN RULE

**The product selector in `js/product-selector.js` already does EVERYTHING.**
Do NOT reinvent pricing, sizing, materials, borders, or checkout.
Call `openProductSelector(photoData)` exactly as gallery.html does.
That function handles: aspect-ratio sizes, all materials, borders, DPI quality, pricing, Stripe checkout.

---

## HOW THE GALLERY DOES IT (copy this pattern exactly)

In `gallery.html`, when user clicks "Buy Print / License":
```javascript
document.getElementById('lb-buy').addEventListener('click', async (e) => {
  const photo = currentPhoto; // { id, title, dimensions: { width, height, aspectRatio }, ... }
  openProductSelector(photo);
});
```

`openProductSelector(photoData)` is defined in `js/product-selector.js`.
It creates a modal with:
- Material tabs: Canvas / Metal / Acrylic / Fine Art Paper / Wood
- Sizes filtered by image aspect ratio (from ASPECT_RATIO_CATEGORIES)
- DPI quality indicator per size
- Real Pictorem pricing (50% margin built in)
- Border/mat options
- Stripe checkout button
- "Add to Cart" button

The photoData object must have:
```javascript
{
  id: photo.id,               // e.g. 'ny-001'
  title: photo.title,         // e.g. 'Manhattan at Dusk'
  dimensions: {
    width: photo.dimensions.width,    // pixel width
    height: photo.dimensions.height,  // pixel height
    aspectRatio: photo.dimensions.aspectRatio
  },
  thumbnail: photo.thumbnail,  // path for display
  full: photo.full             // full-res path
}
```

---

## REQUIRED CHANGES TO riedel.html

### 1. Add product-selector scripts and styles

In `<head>`, add BEFORE closing tag:
```html
<link rel="stylesheet" href="css/product-selector.css">
```

At bottom of body, BEFORE closing `</body>`, add:
```html
<script src="js/product-selector.js?v=11"></script>
```

### 2. Default photo on load

After photos.json loads, find a New York photo and place it on the canvas immediately.

In `loadPhotos()`, after `buildCollectionsMap()` and `showCollections()`, add:
```javascript
// Place default photo (New York) on canvas immediately
var defaultPhoto = allPhotos.find(function(p) {
  return p.collection === 'new-york';
}) || allPhotos[0];
if (defaultPhoto) selectPhoto(defaultPhoto, null);
```

### 3. Fix canvas display — full image, no cropping

In the CSS, the `.visualizer-canvas-wrap canvas` must not be constrained:
```css
.visualizer-canvas-wrap {
  position: relative;
  max-width: 100%;       /* full width */
  margin: 0 auto 1.5rem;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--glass-border);
}
.visualizer-canvas-wrap canvas {
  display: block;
  width: 100%;           /* scale to container */
  height: auto;          /* maintain aspect ratio */
}
```

In the render function, the canvas internal size must match the scene:
```javascript
function render() {
  var dpr = window.devicePixelRatio || 1;
  canvas.width  = currentScene.w * dpr;
  canvas.height = currentScene.h * dpr;
  canvas.style.width  = currentScene.w + 'px';
  canvas.style.height = currentScene.h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // ... rest of render
}
```

This is already correct in the current code. The problem is CSS constraining the canvas to a max-width that clips it. Remove any max-width on the canvas-wrap that's smaller than the scene image.

### 4. Both zones render simultaneously

The current code only renders the artwork in the SELECTED zone. It must render artwork in ALL zones that have a photo assigned.

Change the state model:
```javascript
// BEFORE (wrong — one global photo):
var currentPhoto = null;
var photoImg = null;

// AFTER (correct — each zone has its own photo):
// Add photoImg and photoData to each zone object in SCENES:
// zone = { id, label, px, photoImg: null, photoData: null }
```

When user selects a photo:
```javascript
function selectPhoto(p, clickedEl) {
  // Assign photo to CURRENT zone, not globally
  var zone = currentScene.zones[currentZoneIdx];
  zone.photoData = {
    id: p.id, title: p.title,
    w: (p.dimensions || {}).width || 6000,
    h: (p.dimensions || {}).height || 4000,
    full: p.full
  };

  if (!zone.photoImg || zone.photoImg._srcId !== p.id) {
    var img = new Image();
    img.onload = function() { zone.photoImg = img; zone.photoImg._srcId = p.id; render(); updateSizeDisplay(); };
    img.onerror = function() { console.warn('Photo failed:', p.full); };
    img.src = p.full;
    zone.photoImg = null; // clear while loading
  } else {
    render();
    updateSizeDisplay();
  }

  document.querySelectorAll('.gb-photo').forEach(function(el) { el.classList.remove('active'); });
  if (clickedEl) clickedEl.classList.add('active');
}
```

In the render function, loop ALL zones:
```javascript
// Layer 2: artwork in ALL zones that have a photo
currentScene.zones.forEach(function(zone, i) {
  if (!zone.photoImg || !zone.photoImg.complete || !zone.photoImg.naturalWidth) return;
  if (!zone.photoData) return;

  var px = zone.px;
  var cx = (px.x1 + px.x2) / 2;
  var cy = (px.y1 + px.y2) / 2;
  var zoneW = px.x2 - px.x1;
  var zoneH = px.y2 - px.y1;
  var ppiX = zoneW / 48;
  var ppiY = zoneH / 32;

  // Use THIS zone's sizeT if it's selected, else use default 0.5
  var t = (i === currentZoneIdx) ? sizeT : 0.5;
  var ps = calcPrintSizeForPhoto(zone.photoData, t);

  var drawW = ps.w * ppiX;
  var drawH = ps.h * ppiY;

  ctx.drawImage(zone.photoImg, cx - drawW/2, cy - drawH/2, drawW, drawH);

  // Size label — only show for selected zone
  if (i === currentZoneIdx) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - drawW/2, cy - drawH/2 - 22, 200, 18);
    ctx.fillStyle = '#e8b84d';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText(Math.round(ps.w) + '" \u00d7 ' + Math.round(ps.h) + '" \u2014 HD Metal', cx - drawW/2 + 6, cy - drawH/2 - 8);
  }
});
```

Also update `calcPrintSize` to accept a photoData parameter:
```javascript
function calcPrintSizeForPhoto(photo, t) {
  if (!photo) return { w: 48, h: 32, maxW: 48, maxH: 32 };
  var artRatio = photo.w / photo.h;
  var maxW = Math.min(photo.w / 150, 96);
  var maxH = Math.min(photo.h / 150, 48);
  var finalMaxW = maxW, finalMaxH = maxW / artRatio;
  if (finalMaxH > maxH) { finalMaxH = maxH; finalMaxW = maxH * artRatio; }
  var minShort = 20;
  var finalMinW, finalMinH;
  if (artRatio >= 1) { finalMinH = minShort; finalMinW = minShort * artRatio; }
  else { finalMinW = minShort; finalMinH = minShort / artRatio; }
  var printW = finalMinW + (finalMaxW - finalMinW) * t;
  var printH = finalMinH + (finalMaxH - finalMinH) * t;
  return { w: Math.round(printW), h: Math.round(printH), maxW: Math.round(finalMaxW), maxH: Math.round(finalMaxH) };
}
```

### 5. Replace size slider + buy button with product-selector

REMOVE from HTML:
- The `.size-controls` div (size slider, quality badge)
- The `.cta-bar` div (add to basket, request button)
- The `.basket-bar` div

REPLACE with a single "Configure & Buy" button:
```html
<div style="max-width:960px;margin:1rem auto;padding:0 1rem;display:flex;gap:1rem;align-items:center;justify-content:space-between;border-top:1px solid var(--glass-border);padding-top:1.25rem;">
  <div id="selectionInfo" style="font-size:0.8rem;color:var(--text-secondary);">Select a room, wall position, and image to begin</div>
  <div style="display:flex;gap:0.75rem;">
    <button id="configureBtn" class="btn-buy" disabled>Configure &amp; Buy</button>
    <button id="requestBtn" class="btn-request">Request This Print</button>
  </div>
</div>
```

Add CSS for btn-buy:
```css
.btn-buy {
  padding: 0.7rem 1.5rem;
  background: var(--accent);
  color: #000;
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-main);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all var(--transition);
}
.btn-buy:hover { background: var(--accent-hover); }
.btn-buy:disabled { opacity: 0.4; cursor: not-allowed; }
```

In the JS, wire the Configure & Buy button:
```javascript
document.getElementById('configureBtn').addEventListener('click', function() {
  var zone = currentScene.zones[currentZoneIdx];
  if (!zone.photoData) return;
  // Call the EXACT same product selector as gallery.html
  openProductSelector({
    id: zone.photoData.id,
    title: zone.photoData.title,
    dimensions: {
      width: zone.photoData.w,
      height: zone.photoData.h,
      aspectRatio: zone.photoData.w / zone.photoData.h
    },
    thumbnail: zone.photoData.thumbnail || '',
    full: zone.photoData.full
  });
});
```

Enable the button when a zone has a photo:
```javascript
// At end of selectPhoto():
var hasPhoto = currentScene.zones.some(function(z) { return z.photoData; });
document.getElementById('configureBtn').disabled = !hasPhoto;
```

Update selectionInfo:
```javascript
function updateSelectionInfo() {
  var zone = currentScene.zones[currentZoneIdx];
  var info = document.getElementById('selectionInfo');
  if (zone.photoData) {
    info.innerHTML = '<strong>' + zone.photoData.title + '</strong> &mdash; ' + currentScene.label + ' / ' + zone.label;
  } else {
    info.textContent = 'Select an image to place on ' + zone.label;
  }
}
```

### 6. Fix photoData to include thumbnail for product selector

In `selectPhoto()`:
```javascript
zone.photoData = {
  id: p.id,
  title: p.title,
  w: (p.dimensions || {}).width || 6000,
  h: (p.dimensions || {}).height || 4000,
  full: p.full,
  thumbnail: p.thumbnail   // ADD THIS
};
```

### 7. Remove sizeT slider state entirely

Since product-selector handles sizing, remove:
- `var sizeT = 0.5;`
- The `sizeSlider` event listener
- `calcPrintSize()` function (replace with `calcPrintSizeForPhoto()` above, using fixed t=0.5 for canvas render)
- `updateSizeDisplay()` function

### 8. Verify right wall zone is visible

Wide Shot right wall: `px:{x1:910,y1:219,x2:1214,y2:391}`
Scene width: 1536px

x2=1214 is within 1536 — zone IS within bounds. Problem is likely the canvas CSS being too narrow, cutting off the right portion of the image. Fixing the canvas CSS (step 3) should resolve this.

---

## KEEP THESE EXACTLY AS-IS

- Login gate (working correctly)
- Gallery browser (collections → photos, working)
- Scene carousel (working)
- Zone pills (working, just needs multi-zone render)
- Background + foreground layer rendering (working)
- All SCENES config with pixel coords (correct)
- `js/cart.js`, `js/cart-ui.js`, `js/auth.js` (already included)

---

## FILES TO MODIFY

1. `riedel.html` — all changes above

## FILES TO NOT TOUCH

- `js/product-selector.js` — do not modify
- `css/product-selector.css` — do not modify
- `js/cart.js` — do not modify
- `data/photos.json` — do not modify
- Any other page

---

## DEPLOYMENT

After changes:
```bash
python3 sync_gallery_data.py
bash build.sh
git add riedel.html
git commit -m '[feat] Riedel V2: product selector, multi-zone, default photo, full canvas'
git push
```

---

## VERIFICATION CHECKLIST

- [ ] Page loads, login gate shows, `riedel2026` works
- [ ] After login: Wide Shot scene loads with a New York photo already on the wall
- [ ] Canvas shows FULL room image — not cropped, not cut off
- [ ] Scene carousel works — switching scenes changes room
- [ ] Wide Shot: Left Wall pill shows photo on left wall, Right Wall pill shows right wall
- [ ] BOTH walls can have a photo at the same time — they don't replace each other
- [ ] Clicking a photo in the gallery assigns it to the CURRENTLY SELECTED zone pill
- [ ] Right wall zone is visible in the canvas (not cut off on the right)
- [ ] "Configure & Buy" button opens the product selector modal
- [ ] Product selector shows: Canvas / Metal / Acrylic / Paper / Wood tabs
- [ ] Sizes shown match the photo's aspect ratio
- [ ] Prices match what gallery.html shows for same size + material
- [ ] Border/mat options available
- [ ] Stripe checkout works
- [ ] No console errors
- [ ] Foreground layer (furniture) appears on top of artwork
