/**
 * ARCHIVE-35 PRODUCT SELECTOR V2.1.0
 *
 * Aspect-ratio aware print product selector for Pictorem fulfillment.
 * This is a complete drop-in replacement for the original product-selector.js
 *
 * Features:
 * - Dynamically shows print sizes based on photo's aspect ratio
 * - Quality indicators (DPI-based museum/excellent/good ratings)
 * - Dynamic pricing per material and size
 * - Stripe integration for checkout
 * - Pictorem metadata for fulfillment
 * - Dark theme with gold (#c4973b) accents
 *
 * Usage:
 *   const photoData = { id: 'gt-001', dimensions: {...}, title: '...' };
 *   openProductSelector(photoData);
 */

// ============================================================================
// ASPECT RATIO CATEGORIES
// ============================================================================

const ASPECT_RATIO_CATEGORIES = {
  standard_3_2: {
    name: 'Standard 3:2',
    range: [1.4, 1.6],
    sizes: [
      { width: 12, height: 8, inches: 96 },
      { width: 18, height: 12, inches: 216 },
      { width: 24, height: 16, inches: 384 },
      { width: 36, height: 24, inches: 864 },
      { width: 48, height: 32, inches: 1536 },
      { width: 60, height: 40, inches: 2400 }
    ]
  },
  wide_16_9: {
    name: 'Wide 16:9',
    range: [1.6, 1.9],
    sizes: [
      { width: 16, height: 9, inches: 144 },
      { width: 24, height: 14, inches: 336 },
      { width: 32, height: 18, inches: 576 },
      { width: 48, height: 27, inches: 1296 }
    ]
  },
  four_3: {
    name: '4:3 Ratio',
    range: [1.2, 1.4],
    sizes: [
      { width: 16, height: 12, inches: 192 },
      { width: 20, height: 16, inches: 320 },
      { width: 24, height: 18, inches: 432 },
      { width: 40, height: 30, inches: 1200 }
    ]
  },
  square: {
    name: 'Square',
    range: [0.95, 1.05],
    sizes: [
      { width: 12, height: 12, inches: 144 },
      { width: 20, height: 20, inches: 400 },
      { width: 30, height: 30, inches: 900 }
    ]
  },
  panorama_2_1: {
    name: 'Panorama 2:1',
    range: [1.9, 2.2],
    sizes: [
      { width: 24, height: 12, inches: 288 },
      { width: 36, height: 18, inches: 648 },
      { width: 48, height: 24, inches: 1152 }
    ]
  },
  panorama_12_5: {
    name: 'Wide Panorama 12:5',
    range: [2.2, 2.7],
    sizes: [
      { width: 24, height: 10, inches: 240 },
      { width: 36, height: 15, inches: 540 },
      { width: 48, height: 20, inches: 960 },
      { width: 60, height: 25, inches: 1500 }
    ]
  },
  panorama_3_1: {
    name: 'Panorama 3:1',
    range: [2.7, 3.3],
    sizes: [
      { width: 36, height: 12, inches: 432 },
      { width: 48, height: 16, inches: 768 },
      { width: 60, height: 20, inches: 1200 }
    ]
  },
  ultra_wide_4_1: {
    name: 'Ultra-Wide 4:1+',
    range: [3.3, Infinity],
    sizes: [
      { width: 42, height: 12, inches: 504 },
      { width: 56, height: 16, inches: 896 },
      { width: 60, height: 15, inches: 900 },
      { width: 72, height: 18, inches: 1296 }
    ]
  }
};

// ============================================================================
// MATERIALS
// ============================================================================

const MATERIALS = {
  canvas: {
    name: 'Canvas',
    maxInches: 2400,
    description: 'Museum-quality canvas wrap with professional stretching',
    image: '/images/products/canvas.jpg'
  },
  metal: {
    name: 'Metal',
    maxInches: 2400,
    description: 'Vibrant ChromaLuxe HD metal with standoff mounting',
    image: '/images/products/metal-hd.jpg'
  },
  acrylic: {
    name: 'Acrylic',
    maxInches: 2400,
    description: 'Premium acrylic with stunning color depth',
    image: '/images/products/acrylic.jpg'
  },
  paper: {
    name: 'Fine Art Paper',
    maxInches: 2400,
    description: 'Archival fine art paper with matte finish',
    image: '/images/products/paper.jpg'
  },
  wood: {
    name: 'Wood',
    maxInches: 2400,
    description: 'Rustic wood print on premium plywood',
    image: '/images/products/wood.jpg'
  }
};

// Frame moulding image paths
const FRAME_IMAGES = {
  '303-19': '/images/products/frame-303-19.jpg',
  '303-12': '/images/products/frame-303-12.jpg',
  '317-22': '/images/products/frame-317-22.jpg',
  '241-29': '/images/products/frame-241-29.jpg',
  '241-22': '/images/products/frame-241-22.jpg',
  '724-12': '/images/products/frame-724-12.jpg',
};

// ============================================================================
// PRICE LOOKUP TABLE — Based on REAL Pictorem API costs (2026-03-02)
// retail = round(Pictorem_cost × 2) → exact 50% margin on every size
// Metal: HD subtype + standoff mounting (default)
// Acrylic: ac220 + standoff mounting (default)
// Canvas: gallery wrap (semigloss, mirror edge, 1.5" depth)
// Paper: fine art paper bare
// Wood: rustic plywood bare (french cleat is free)
// ============================================================================

const PRICE_TABLE = {
  canvas: { '12x8': 101, '16x9': 109, '12x12': 90, '16x12': 98, '18x12': 120, '24x10': 124, '24x12': 113, '20x16': 137, '24x14': 140, '24x16': 129, '20x20': 151, '24x18': 156, '36x12': 137, '42x12': 168, '36x15': 174, '32x18': 179, '36x18': 191, '48x16': 192, '36x24': 208, '56x16': 232, '30x30': 214, '60x15': 233, '48x20': 242, '48x24': 255, '40x30': 282, '60x20': 282, '48x27': 298, '72x18': 459, '60x25': 331, '48x32': 337, '60x40': 640 },
  metal: { '12x8': 90, '16x9': 110, '12x12': 110, '16x12': 130, '18x12': 140, '24x10': 150, '24x12': 170, '20x16': 183, '24x14': 190, '24x16': 210, '20x20': 217, '24x18': 230, '36x12': 230, '42x12': 260, '36x15': 275, '32x18': 290, '36x18': 320, '48x16': 370, '36x24': 409, '56x16': 423, '30x30': 424, '60x15': 424, '48x20': 449, '48x24': 529, '40x30': 549, '60x20': 549, '48x27': 589, '72x18': 750, '60x25': 674, '48x32': 689, '60x40': 1209 },
  acrylic: { '12x8': 123, '16x9': 142, '12x12': 142, '16x12': 160, '18x12': 170, '24x10': 179, '24x12': 197, '20x16': 210, '24x14': 216, '24x16': 234, '20x20': 240, '24x18': 253, '36x12': 253, '42x12': 281, '36x15': 294, '32x18': 308, '36x18': 336, '48x16': 382, '36x24': 419, '56x16': 432, '30x30': 433, '60x15': 433, '48x20': 456, '48x24': 530, '40x30': 549, '60x20': 549, '48x27': 586, '72x18': 747, '60x25': 664, '48x32': 678, '60x40': 1173 },
  paper: { '12x8': 33, '16x9': 37, '12x12': 37, '16x12': 42, '18x12': 44, '24x10': 46, '24x12': 50, '20x16': 53, '24x14': 54, '24x16': 59, '20x20': 60, '24x18': 63, '36x12': 63, '42x12': 69, '36x15': 72, '32x18': 75, '36x18': 82, '48x16': 92, '36x24': 101, '56x16': 104, '30x30': 104, '60x15': 104, '48x20': 109, '48x24': 126, '40x30': 131, '60x20': 131, '48x27': 139, '72x18': 139, '60x25': 157, '48x32': 160, '60x40': 237 },
  wood: { '12x8': 54, '16x9': 66, '12x12': 66, '16x12': 79, '18x12': 85, '24x10': 92, '24x12': 104, '20x16': 113, '24x14': 117, '24x16': 130, '20x20': 134, '24x18': 143, '36x12': 143, '42x12': 162, '36x15': 171, '32x18': 181, '36x18': 200, '48x16': 231, '36x24': 257, '56x16': 265, '30x30': 266, '60x15': 266, '48x20': 282, '48x24': 333, '40x30': 346, '60x20': 346, '48x27': 371, '72x18': 533, '60x25': 425, '48x32': 435, '60x40': 825 },
};

// ============================================================================
// PRODUCT CATALOG (loaded from data/product-catalog.json)
// ============================================================================

let PRODUCT_CATALOG = null;

// Sub-option state — module-level so top-level functions can access them
let selectedSubtype = null;
let selectedMounting = null;
let selectedFinish = null;
let selectedEdge = null;
let selectedFrame = null; // Phase 4: optional frame moulding code (e.g., '303-19')
let selectedMat = null;   // Phase 5: mat/border option ('none', 'whitematboard', 'blackmatboard')
let selectedMatWidth = 2; // Phase 5: mat width in inches (default 2")

/**
 * Load product catalog JSON. Called once on first modal open.
 * Falls back gracefully — sub-options simply won't render if load fails.
 */
async function loadProductCatalog() {
  if (PRODUCT_CATALOG) return PRODUCT_CATALOG;
  try {
    const res = await fetch('/data/product-catalog.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    PRODUCT_CATALOG = await res.json();
    console.log('[ARCHIVE-35] Product catalog loaded v' + PRODUCT_CATALOG.version);
    return PRODUCT_CATALOG;
  } catch (err) {
    console.warn('[ARCHIVE-35] Product catalog unavailable, using defaults:', err.message);
    return null;
  }
}

// ============================================================================
// PRICING CALCULATION — Lookup table (exact 50% margin per API data)
// ============================================================================

function calculatePrice(materialKey, sizeInches, width, height) {
  // Primary: exact lookup from PRICE_TABLE
  const sizeKey = `${width}x${height}`;
  if (PRICE_TABLE[materialKey] && PRICE_TABLE[materialKey][sizeKey]) {
    return PRICE_TABLE[materialKey][sizeKey];
  }
  // Fallback: try reversed dimensions (portrait vs landscape)
  const altKey = `${height}x${width}`;
  if (PRICE_TABLE[materialKey] && PRICE_TABLE[materialKey][altKey]) {
    return PRICE_TABLE[materialKey][altKey];
  }
  // Emergency fallback: should never hit this with complete table
  console.warn(`[ARCHIVE-35] Price lookup miss: ${materialKey} ${sizeKey} (${sizeInches} sq in)`);
  return 0;
}

// ============================================================================
// DPI & QUALITY CALCULATION
// ============================================================================

function calculateDPI(photoWidth, photoHeight, printWidth, printHeight) {
  // True print DPI: pixels divided by inches
  const dpiW = photoWidth / printWidth;
  const dpiH = photoHeight / printHeight;
  return Math.round(Math.min(dpiW, dpiH));
}

function getQualityBadge(dpi) {
  if (dpi >= 300) {
    return { level: 'Museum Quality', class: 'quality-museum', icon: '★★★' };
  } else if (dpi >= 200) {
    return { level: 'Excellent', class: 'quality-excellent', icon: '★★' };
  } else if (dpi >= 150) {
    return { level: 'Good', class: 'quality-good', icon: '★' };
  }
  return null; // Don't show if below minimum
}

// ============================================================================
// ASPECT RATIO MATCHING
// ============================================================================

function getMatchingCategory(photoAspectRatio, tolerance = 0.1) {
  // Pass 1: exact range match (no tolerance) — most precise
  for (const [key, category] of Object.entries(ASPECT_RATIO_CATEGORIES)) {
    const [min, max] = category.range;
    if (photoAspectRatio >= min && photoAspectRatio <= max) {
      return { key, ...category };
    }
  }

  // Pass 2: best tolerance match — pick category whose sizes survive filtering
  let bestMatch = null;
  let bestSizeCount = 0;
  for (const [key, category] of Object.entries(ASPECT_RATIO_CATEGORIES)) {
    const [min, max] = category.range;
    if (
      photoAspectRatio >= min * (1 - tolerance) &&
      photoAspectRatio <= max * (1 + tolerance)
    ) {
      const filtered = filterSizesByAspectRatio(category.sizes, photoAspectRatio, tolerance);
      if (filtered.length > bestSizeCount) {
        bestSizeCount = filtered.length;
        bestMatch = { key, ...category };
      }
    }
  }
  if (bestMatch) return bestMatch;

  // Default to standard 3:2 if no match
  return ASPECT_RATIO_CATEGORIES.standard_3_2;
}

function filterSizesByAspectRatio(sizes, photoAspectRatio, tolerance = 0.1) {
  return sizes.filter((size) => {
    const sizeRatio = size.width / size.height;
    return (
      sizeRatio >= photoAspectRatio * (1 - tolerance) &&
      sizeRatio <= photoAspectRatio * (1 + tolerance)
    );
  });
}

// ============================================================================
// LICENSING TIERS & PRICING
// ============================================================================

const LICENSE_TIERS = {
  web_social:       { name: 'Web / Social',      duration: '1 year',  geography: 'Worldwide', maxUsers: 5,          sort: 1 },
  editorial:        { name: 'Editorial',          duration: '1 year',  geography: 'Worldwide', maxUsers: 5,          sort: 2 },
  commercial_print: { name: 'Commercial Print',   duration: '2 years', geography: 'Worldwide', maxUsers: 10,         sort: 3 },
  billboard_ooh:    { name: 'Billboard / OOH',    duration: '1 year',  geography: 'Worldwide', maxUsers: 10,         sort: 4 },
  hospitality:      { name: 'Hospitality',        duration: 'Perpetual', geography: 'Worldwide', maxUsers: 'Unlimited', sort: 5 },
  exclusive:        { name: 'Exclusive',           duration: '2-5 years', geography: 'Worldwide', maxUsers: 'Unlimited', sort: 6 }
};

const LICENSE_PRICING = {
  web_social:       { STANDARD: 175,  PREMIUM: 280,  ULTRA: 350 },
  editorial:        { STANDARD: 350,  PREMIUM: 525,  ULTRA: 700 },
  commercial_print: { STANDARD: 700,  PREMIUM: 1050, ULTRA: 1400 },
  billboard_ooh:    { STANDARD: 1050, PREMIUM: 1750, ULTRA: 2450 },
  hospitality:      { STANDARD: 1400, PREMIUM: 2450, ULTRA: 3500 },
  exclusive:        { STANDARD: 3500, PREMIUM: 7000, ULTRA: 10500 }
};

function classifyForLicensing(width) {
  if (width >= 15000) return 'ULTRA';
  if (width >= 8000) return 'PREMIUM';
  if (width >= 4000) return 'STANDARD';
  return null;
}

// ============================================================================
// MODAL UI GENERATION
// ============================================================================

function createProductSelectorModal(photoData) {
  // Validate photo data
  if (!photoData.dimensions) {
    console.error('Photo data missing dimensions object', photoData);
    return;
  }

  const {
    id,
    title,
    dimensions: { width: photoWidth, height: photoHeight, aspectRatio, megapixels }
  } = photoData;

  // Get matching aspect ratio category
  const category = getMatchingCategory(aspectRatio);
  const applicableSizes = filterSizesByAspectRatio(category.sizes, aspectRatio);

  // Licensing classification
  const licenseClass = classifyForLicensing(photoWidth) || 'STANDARD';
  const classColors = { ULTRA: '#c9a84c', PREMIUM: '#b0b0b0', STANDARD: '#cd7f32' };

  // Create modal HTML
  const modal = document.createElement('div');
  modal.className = 'product-selector-modal';
  modal.id = 'product-selector-modal';

  modal.innerHTML = `
    <div class="product-selector-overlay" data-close="true"></div>
    <div class="product-selector-content">
      <button class="close-button" aria-label="Close selector">&times;</button>

      <div class="selector-header">
        <h2>"${title}"</h2>
        <p class="selector-subtitle">
          ${photoWidth} × ${photoHeight} px &middot; ${megapixels} MP &middot; ${category.name}
        </p>
        <!-- Tab Bar -->
        <div class="selector-tabs">
          <button class="selector-tab active" data-tab="print">Order Print</button>
          <button class="selector-tab" data-tab="license">License Image</button>
        </div>
      </div>

      <!-- ===== PRINT TAB ===== -->
      <div class="selector-body tab-content" id="tab-print">
        <!-- Material Selection -->
        <div class="material-section">
          <h3>Step 1: Choose Material</h3>
          <div class="material-grid">
            ${Object.entries(MATERIALS)
              .map(
                ([key, material]) => {
                  const fromText = key === 'paper' ? 'from $33' :
                                   key === 'wood' ? 'from $54' :
                                   key === 'metal' ? 'from $90' :
                                   key === 'canvas' ? 'from $90' :
                                   key === 'acrylic' ? 'from $123' : '';
                  const hangReady = (key !== 'paper') ? '<span class="hang-ready-tag">Hang Ready</span>' : '<span class="needs-frame-tag">Needs Framing</span>';
                  return `
              <div class="material-option" data-material="${key}">
                <input type="radio" id="material-${key}" name="material" value="${key}" />
                <label for="material-${key}">
                  <div class="material-thumb"><img src="${material.image}" alt="${material.name}" loading="lazy" /></div>
                  <div class="material-name">${material.name}</div>
                  <div class="material-description">${material.description}</div>
                  <div class="material-meta">${fromText} ${hangReady}</div>
                </label>
              </div>
            `;
                })
              .join('')}
          </div>
        </div>

        <!-- Sub-Options (populated dynamically per material) -->
        <div id="subtype-section" class="sub-option-section" style="display:none;">
          <h3>Material Type</h3>
          <div class="sub-option-grid" id="subtype-grid"></div>
        </div>

        <div id="mounting-section" class="sub-option-section" style="display:none;">
          <h3>Mounting Hardware</h3>
          <div class="sub-option-grid" id="mounting-grid"></div>
        </div>

        <div id="finish-section" class="sub-option-section" style="display:none;">
          <h3>Finish / Varnish</h3>
          <div class="sub-option-grid" id="finish-grid"></div>
        </div>

        <div id="edge-section" class="sub-option-section" style="display:none;">
          <h3>Edge Treatment</h3>
          <div class="sub-option-grid" id="edge-grid"></div>
        </div>

        <div id="frame-section" class="sub-option-section" style="display:none;">
          <h3>Add Frame <span style="font-size:0.75em;color:#888;">(optional)</span></h3>
          <div class="sub-option-grid" id="frame-grid"></div>
        </div>

        <div id="mat-section" class="sub-option-section" style="display:none;">
          <h3>Border / Mat <span style="font-size:0.75em;color:#888;">(optional)</span></h3>
          <div class="sub-option-grid" id="mat-grid"></div>
        </div>

        <!-- Frame Preview Mockup -->
        <div id="frame-preview-section" style="display:none;">
          <h3 style="margin:0 0 12px;font-size:14px;color:#c4973b;text-transform:uppercase;letter-spacing:1px;">Preview</h3>
          <div id="frame-preview-container" class="frame-preview-container">
            <div id="frame-preview-outer" class="frame-preview-outer">
              <div id="frame-preview-mat" class="frame-preview-mat">
                <img id="frame-preview-image" class="frame-preview-image" src="" alt="Preview" />
              </div>
            </div>
            <div id="frame-preview-label" class="frame-preview-label"></div>
          </div>
        </div>

        <!-- Size Selection -->
        <div class="size-section">
          <h3 id="size-step-heading">Step 2: Choose Size</h3>
          <div class="size-grid" id="size-grid">
            <!-- Dynamically populated based on selected material -->
          </div>
        </div>

        <!-- Price Summary -->
        <div class="price-summary">
          <div class="summary-row">
            <span>Material:</span>
            <span id="summary-material">Select material</span>
          </div>
          <div class="summary-row" id="summary-subtype-row" style="display:none;">
            <span>Type:</span>
            <span id="summary-subtype">—</span>
          </div>
          <div class="summary-row" id="summary-mounting-row" style="display:none;">
            <span>Mounting:</span>
            <span id="summary-mounting">—</span>
          </div>
          <div class="summary-row" id="summary-finish-row" style="display:none;">
            <span>Finish:</span>
            <span id="summary-finish">—</span>
          </div>
          <div class="summary-row" id="summary-edge-row" style="display:none;">
            <span>Edge:</span>
            <span id="summary-edge">—</span>
          </div>
          <div class="summary-row" id="summary-frame-row" style="display:none;">
            <span>Frame:</span>
            <span id="summary-frame">—</span>
          </div>
          <div class="summary-row" id="summary-mat-row" style="display:none;">
            <span>Border/Mat:</span>
            <span id="summary-mat">—</span>
          </div>
          <div class="summary-row">
            <span>Size:</span>
            <span id="summary-size">Select size</span>
          </div>
          <div class="summary-row">
            <span>Quality:</span>
            <span id="summary-quality">—</span>
          </div>
          <div class="summary-row total">
            <span>Total Price:</span>
            <span id="summary-price">$0</span>
          </div>
        </div>

        <!-- Additional Info -->
        <div class="product-info">
          <div class="info-item">
            <strong>Production Time:</strong> 5-7 business days
          </div>
          <div class="info-item">
            <strong>Shipping:</strong> Standard 3-5 days (within USA)
          </div>
          <div class="info-item">
            <strong>Pictorem Provider:</strong> Professional prints via www.pictorem.com
          </div>
        </div>

        <!-- Terms Acknowledgment -->
        <div class="terms-acknowledgment">
          <label class="terms-checkbox-label">
            <input type="checkbox" id="terms-checkbox" />
            <span class="terms-checkbox-text">
              I understand that this is a <strong>fine art photograph</strong>, that art appreciation is subjective, and that <strong>all sales are final</strong>. I accept the <a href="terms.html" target="_blank">Terms of Sale</a> including the no-return policy. Color variations between screen and print are normal and expected.
            </span>
          </label>
        </div>

        <!-- Action Buttons -->
        <div class="product-actions">
          <button class="add-to-cart-button" id="add-to-cart-button" disabled>
            Add to Cart
          </button>
          <button class="buy-now-button" id="buy-now-button" disabled>
            Buy Now
          </button>
        </div>
      </div>

      <!-- ===== LICENSE TAB ===== -->
      <div class="selector-body tab-content" id="tab-license" style="display:none;">
        <div class="license-classification">
          <span class="license-badge" style="background:${classColors[licenseClass]};color:#000;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:1px;">${licenseClass}</span>
          <span style="color:#999;font-size:13px;margin-left:8px;">
            Max print @300dpi: ${Math.round(photoWidth/300)}" × ${Math.round(photoHeight/300)}"
          </span>
        </div>

        <!-- Tier Selection -->
        <div class="material-section">
          <h3>Step 1: Choose License Tier</h3>
          <div class="license-tier-grid">
            ${Object.entries(LICENSE_TIERS)
              .sort((a,b) => a[1].sort - b[1].sort)
              .map(([key, tier]) => {
                const price = LICENSE_PRICING[key]?.[licenseClass] || 0;
                return `
              <div class="license-tier-option" data-tier="${key}">
                <input type="radio" id="tier-${key}" name="license-tier" value="${key}" />
                <label for="tier-${key}">
                  <div class="material-name">${tier.name}</div>
                  <div class="material-description">${tier.duration} &middot; ${tier.geography} &middot; ${tier.maxUsers} users</div>
                  <div class="size-price" style="margin-top:6px;">$${price.toLocaleString()}</div>
                </label>
              </div>`;
              }).join('')}
          </div>
        </div>

        <!-- Format Selection -->
        <div class="size-section">
          <h3>Step 2: Choose Delivery Format</h3>
          <div class="license-format-grid">
            <div class="size-option">
              <input type="radio" id="format-jpeg" name="license-format" value="jpeg" checked />
              <label for="format-jpeg">
                <div class="size-dimensions">JPEG</div>
                <div class="size-dpi">Included</div>
              </label>
            </div>
            <div class="size-option">
              <input type="radio" id="format-tiff" name="license-format" value="tiff" />
              <label for="format-tiff">
                <div class="size-dimensions">TIFF</div>
                <div class="size-dpi">+$100</div>
              </label>
            </div>
          </div>
        </div>

        <!-- License Price Summary -->
        <div class="price-summary">
          <div class="summary-row">
            <span>License Tier:</span>
            <span id="license-summary-tier">Select tier</span>
          </div>
          <div class="summary-row">
            <span>Format:</span>
            <span id="license-summary-format">JPEG (included)</span>
          </div>
          <div class="summary-row">
            <span>Duration:</span>
            <span id="license-summary-duration">—</span>
          </div>
          <div class="summary-row total">
            <span>License Fee:</span>
            <span id="license-summary-price">$0</span>
          </div>
        </div>

        <!-- License Info -->
        <div class="product-info">
          <div class="info-item">
            <strong>Delivery:</strong> Download link within 24 hours
          </div>
          <div class="info-item">
            <strong>Certificate:</strong> Signed provenance certificate included
          </div>
          <div class="info-item">
            <strong>Original Resolution:</strong> ${photoWidth.toLocaleString()} × ${photoHeight.toLocaleString()} px (${megapixels} MP)
          </div>
        </div>

        <!-- License Terms -->
        <div class="terms-acknowledgment">
          <label class="terms-checkbox-label">
            <input type="checkbox" id="license-terms-checkbox" />
            <span class="terms-checkbox-text">
              I have read and agree to the <a href="licensing/terms.html" target="_blank"><strong>Image License Agreement</strong></a>. I understand that this license is <strong>non-transferable</strong> and usage is limited to the selected tier.
            </span>
          </label>
        </div>

        <!-- License Action -->
        <div class="product-actions">
          <button class="add-to-cart-button" id="license-add-cart-button" disabled>
            Add to Cart
          </button>
          <button class="add-to-cart-button" id="license-buy-button" disabled>
            License Now
          </button>
        </div>
      </div>
    </div>
  `;

  return { modal, category, applicableSizes, photoData, licenseClass };
}

// ============================================================================
// EVENT HANDLERS & INTERACTIONS
// ============================================================================

function setupProductSelectorEvents(modal, category, applicableSizes, photoData, licenseClass) {
  const overlay = modal.querySelector('.product-selector-overlay');
  const closeBtn = modal.querySelector('.close-button');
  const materialOptions = modal.querySelectorAll('.material-option');
  const sizeGrid = modal.querySelector('#size-grid');
  const addToCartBtn = modal.querySelector('#add-to-cart-button');
  const buyNowBtn = modal.querySelector('#buy-now-button');
  const termsCheckbox = modal.querySelector('#terms-checkbox');

  let selectedMaterial = null;
  let selectedSize = null;
  let termsAccepted = false;

  // Sub-option state — reset on each modal open (declared at module level)
  selectedSubtype = null;
  selectedMounting = null;
  selectedFinish = null;
  selectedEdge = null;
  selectedFrame = null;
  selectedMat = null;
  selectedMatWidth = 2;

  // ── Tab switching ────────────────────────────────────────────────
  const tabs = modal.querySelectorAll('.selector-tab');
  const tabPrint = modal.querySelector('#tab-print');
  const tabLicense = modal.querySelector('#tab-license');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.tab === 'print') {
        tabPrint.style.display = '';
        tabLicense.style.display = 'none';
      } else {
        tabPrint.style.display = 'none';
        tabLicense.style.display = '';
      }
    });
  });

  // ── Licensing tier events ────────────────────────────────────────
  const tierOptions = modal.querySelectorAll('.license-tier-option');
  const licenseBuyBtn = modal.querySelector('#license-buy-button');
  const licenseAddCartBtn = modal.querySelector('#license-add-cart-button');
  const licenseTermsCheckbox = modal.querySelector('#license-terms-checkbox');
  const formatInputs = modal.querySelectorAll('input[name="license-format"]');
  let selectedTier = null;
  let selectedFormat = 'jpeg';
  let licenseTermsAccepted = false;

  function updateLicensePrice() {
    if (!selectedTier) return;
    const basePrice = LICENSE_PRICING[selectedTier]?.[licenseClass || 'STANDARD'] || 0;
    const formatSurcharge = selectedFormat === 'tiff' ? 100 : 0;
    const total = basePrice + formatSurcharge;
    modal.querySelector('#license-summary-tier').textContent = LICENSE_TIERS[selectedTier].name;
    modal.querySelector('#license-summary-format').textContent = selectedFormat === 'tiff' ? 'TIFF (+$100)' : 'JPEG (included)';
    modal.querySelector('#license-summary-duration').textContent = LICENSE_TIERS[selectedTier].duration;
    modal.querySelector('#license-summary-price').textContent = '$' + total.toLocaleString();
    licenseBuyBtn.disabled = !(selectedTier && licenseTermsAccepted);
    if (licenseAddCartBtn) licenseAddCartBtn.disabled = !(selectedTier && licenseTermsAccepted);
  }

  tierOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      tierOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      opt.querySelector('input').checked = true;
      selectedTier = opt.dataset.tier;
      updateLicensePrice();
    });
  });

  formatInputs.forEach(input => {
    input.addEventListener('change', () => {
      selectedFormat = input.value;
      updateLicensePrice();
    });
  });

  if (licenseTermsCheckbox) {
    licenseTermsCheckbox.addEventListener('change', () => {
      licenseTermsAccepted = licenseTermsCheckbox.checked;
      licenseBuyBtn.disabled = !(selectedTier && licenseTermsAccepted);
      if (licenseAddCartBtn) licenseAddCartBtn.disabled = !(selectedTier && licenseTermsAccepted);
    });
  }

  // License Add to Cart
  if (licenseAddCartBtn) {
    licenseAddCartBtn.addEventListener('click', () => {
      if (!selectedTier || !licenseTermsAccepted) return;
      const tierName = LICENSE_TIERS[selectedTier].name;
      const basePrice = LICENSE_PRICING[selectedTier]?.[licenseClass || 'STANDARD'] || 0;
      const formatSurcharge = selectedFormat === 'tiff' ? 100 : 0;
      const total = basePrice + formatSurcharge;

      const cartItem = {
        photoId: photoData.id,
        title: `${photoData.title} — ${tierName} License`,
        material: `${tierName} License`,
        size: selectedFormat.toUpperCase(),
        price: total,
        thumbnail: photoData.thumbnail,
        metadata: {
          photoId: photoData.id,
          photoFilename: photoData.filename || photoData.id,
          collection: photoData.collection || '',
          material: 'license',
          width: '0',
          height: '0',
          licenseTier: selectedTier,
          licenseFormat: selectedFormat,
          originalPhotoWidth: String(photoData.dimensions?.width || 0),
          originalPhotoHeight: String(photoData.dimensions?.height || 0)
        }
      };

      if (window.cart && window.cart.addToCart) {
        window.cart.addToCart(cartItem);
        if (window.cartUI && window.cartUI.showToast) {
          window.cartUI.showToast('License added to cart');
        }
        closeModal();
      }
    });
  }

  if (licenseBuyBtn) {
    licenseBuyBtn.addEventListener('click', () => {
      if (!selectedTier || !licenseTermsAccepted) return;
      const basePrice = LICENSE_PRICING[selectedTier]?.[licenseClass || 'STANDARD'] || 0;
      const total = basePrice + (selectedFormat === 'tiff' ? 100 : 0);
      const tierName = LICENSE_TIERS[selectedTier].name;
      const priceInCents = total * 100;

      licenseBuyBtn.textContent = 'Processing...';
      licenseBuyBtn.disabled = true;

      // Detect test mode from Stripe public key prefix
      const isTestMode = window.STRIPE_PUBLIC_KEY && window.STRIPE_PUBLIC_KEY.startsWith('pk_test_');

      const checkoutData = {
        lineItems: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${photoData.title} — ${tierName} License`,
              description: `${selectedFormat.toUpperCase()} · ${photoData.dimensions.width} × ${photoData.dimensions.height} px`,
              metadata: {
                photoId: photoData.id,
                licenseTier: selectedTier,
                licenseFormat: selectedFormat,
                originalWidth: String(photoData.dimensions.width),
                originalHeight: String(photoData.dimensions.height)
              }
            },
            unit_amount: priceInCents
          },
          quantity: 1
        }],
        successUrl: `${window.location.origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}&type=license`,
        cancelUrl: window.location.href,
        license: {
          photoId: photoData.id,
          photoTitle: photoData.title,
          photoFilename: photoData.filename || photoData.id,
          collection: photoData.collection || '',
          tier: selectedTier,
          tierName: tierName,
          format: selectedFormat,
          classification: licenseClass,
          resolution: `${photoData.dimensions.width}x${photoData.dimensions.height}`
        },
        testMode: isTestMode || false
      };

      const apiBase = 'https://archive-35-com.pages.dev';
      fetch(`${apiBase}/api/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutData)
      })
        .then(res => {
          if (!res.ok) throw new Error('Checkout endpoint not available');
          return res.json();
        })
        .then(data => {
          if (data.url) {
            window.location.href = data.url;
            return;
          }
          if (data.sessionId && window.Stripe && window.STRIPE_PUBLIC_KEY) {
            window.Stripe(window.STRIPE_PUBLIC_KEY).redirectToCheckout({ sessionId: data.sessionId });
          } else {
            throw new Error('Stripe not configured');
          }
        })
        .catch(err => {
          console.warn('License checkout unavailable, falling back to contact form:', err.message);
          const msg = encodeURIComponent(
            `License Request:\n\nPhoto: ${photoData.title}\nTier: ${tierName}\nFormat: ${selectedFormat.toUpperCase()}\nResolution: ${photoData.dimensions.width} × ${photoData.dimensions.height} px\nPrice: $${total.toLocaleString()}\n\nPlease send me the license agreement and payment link.`
          );
          window.location.href = `contact.html?message=${msg}`;
        });
    });
  }

  // ── Print tab events (existing) ──────────────────────────────────
  // Terms checkbox handler
  termsCheckbox.addEventListener('change', () => {
    termsAccepted = termsCheckbox.checked;
    updateButtonStates();
  });

  function updateButtonStates() {
    const canPurchase = selectedMaterial && selectedSize && termsAccepted;
    addToCartBtn.disabled = !canPurchase;
    buyNowBtn.disabled = !canPurchase;
  }

  // Close modal
  const closeModal = () => {
    modal.remove();
  };

  overlay.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);

  // ── Sub-option rendering (Phase 2) ─────────────────────────────
  function renderSubOptions(materialKey) {
    const subtypeSection = modal.querySelector('#subtype-section');
    const mountingSection = modal.querySelector('#mounting-section');
    const finishSection = modal.querySelector('#finish-section');
    const edgeSection = modal.querySelector('#edge-section');
    const frameSection = modal.querySelector('#frame-section');
    const subtypeGrid = modal.querySelector('#subtype-grid');
    const mountingGrid = modal.querySelector('#mounting-grid');
    const finishGrid = modal.querySelector('#finish-grid');
    const edgeGrid = modal.querySelector('#edge-grid');
    const frameGrid = modal.querySelector('#frame-grid');

    const matSection = modal.querySelector('#mat-section');
    const matGrid = modal.querySelector('#mat-grid');
    const framePreviewSection = modal.querySelector('#frame-preview-section');

    // Reset all sub-option sections
    [subtypeSection, mountingSection, finishSection, edgeSection, frameSection, matSection].forEach(s => { if (s) s.style.display = 'none'; });
    [subtypeGrid, mountingGrid, finishGrid, edgeGrid, frameGrid].forEach(g => { if (g) g.innerHTML = ''; });
    if (matGrid) matGrid.innerHTML = '';
    if (framePreviewSection) framePreviewSection.style.display = 'none';
    selectedSubtype = null;
    selectedMounting = null;
    selectedFinish = null;
    selectedEdge = null;
    selectedFrame = null;
    selectedMat = null;
    selectedMatWidth = 2;

    // Hide summary rows
    ['summary-subtype-row', 'summary-mounting-row', 'summary-finish-row', 'summary-edge-row', 'summary-frame-row', 'summary-mat-row'].forEach(id => {
      const row = modal.querySelector('#' + id);
      if (row) row.style.display = 'none';
    });

    if (!PRODUCT_CATALOG || !PRODUCT_CATALOG.materials[materialKey]) return;

    const matConfig = PRODUCT_CATALOG.materials[materialKey];

    // Render subtype picker (if more than 1 subtype)
    if (matConfig.subtypes && Object.keys(matConfig.subtypes).length > 1) {
      subtypeSection.style.display = '';
      subtypeGrid.innerHTML = Object.entries(matConfig.subtypes).map(([code, sub]) => `
        <div class="sub-option-card${sub.default ? ' selected' : ''}" data-sub-key="${code}">
          <input type="radio" name="subtype" value="${code}" ${sub.default ? 'checked' : ''} />
          <label>
            <div class="sub-option-name">${sub.name}${sub.recommended ? ' <span class="rec-badge">Recommended</span>' : ''}</div>
            <div class="sub-option-desc">${sub.shortDescription || ''}</div>
            ${sub.thickness ? `<div class="sub-option-meta">${sub.thickness}</div>` : ''}
          </label>
        </div>
      `).join('');

      // Set default
      const defaultSub = Object.entries(matConfig.subtypes).find(([,s]) => s.default);
      if (defaultSub) {
        selectedSubtype = defaultSub[0];
        modal.querySelector('#summary-subtype-row').style.display = '';
        modal.querySelector('#summary-subtype').textContent = defaultSub[1].name;
      }

      // Click handlers
      subtypeGrid.querySelectorAll('.sub-option-card').forEach(card => {
        card.addEventListener('click', () => {
          subtypeGrid.querySelectorAll('.sub-option-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          card.querySelector('input').checked = true;
          selectedSubtype = card.dataset.subKey;
          const subName = matConfig.subtypes[selectedSubtype]?.name || selectedSubtype;
          modal.querySelector('#summary-subtype-row').style.display = '';
          modal.querySelector('#summary-subtype').textContent = subName;
        });
      });
    } else {
      // Single subtype — auto-select it
      const onlySub = Object.entries(matConfig.subtypes)[0];
      if (onlySub) selectedSubtype = onlySub[0];
    }

    // Render mounting options
    if (matConfig.mountingOptions && Object.keys(matConfig.mountingOptions).length > 1) {
      mountingSection.style.display = '';
      mountingGrid.innerHTML = Object.entries(matConfig.mountingOptions).map(([code, opt]) => `
        <div class="sub-option-card${opt.default ? ' selected' : ''}" data-sub-key="${code}">
          <input type="radio" name="mounting" value="${code}" ${opt.default ? 'checked' : ''} />
          <label>
            <div class="sub-option-name">${opt.name}${opt.recommended ? ' <span class="rec-badge">Recommended</span>' : ''}</div>
            <div class="sub-option-desc">${opt.shortDescription || ''}</div>
            ${opt.warning ? `<div class="sub-option-warning">${opt.warning}</div>` : ''}
          </label>
        </div>
      `).join('');

      const defaultMount = Object.entries(matConfig.mountingOptions).find(([,o]) => o.default);
      if (defaultMount) {
        selectedMounting = defaultMount[0];
        modal.querySelector('#summary-mounting-row').style.display = '';
        modal.querySelector('#summary-mounting').textContent = defaultMount[1].name;
      }

      mountingGrid.querySelectorAll('.sub-option-card').forEach(card => {
        card.addEventListener('click', () => {
          mountingGrid.querySelectorAll('.sub-option-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          card.querySelector('input').checked = true;
          selectedMounting = card.dataset.subKey;
          const mountName = matConfig.mountingOptions[selectedMounting]?.name || selectedMounting;
          modal.querySelector('#summary-mounting-row').style.display = '';
          modal.querySelector('#summary-mounting').textContent = mountName;
        });
      });
    } else if (matConfig.mountingOptions) {
      const onlyMount = Object.entries(matConfig.mountingOptions)[0];
      if (onlyMount) selectedMounting = onlyMount[0];
    }

    // Render finish options (canvas)
    if (matConfig.finishOptions && Object.keys(matConfig.finishOptions).length > 1) {
      finishSection.style.display = '';
      finishGrid.innerHTML = Object.entries(matConfig.finishOptions).map(([code, opt]) => `
        <div class="sub-option-card${opt.default ? ' selected' : ''}" data-sub-key="${code}">
          <input type="radio" name="finish" value="${code}" ${opt.default ? 'checked' : ''} />
          <label>
            <div class="sub-option-name">${opt.name}${opt.recommended ? ' <span class="rec-badge">Recommended</span>' : ''}</div>
            <div class="sub-option-desc">${opt.shortDescription || ''}</div>
          </label>
        </div>
      `).join('');

      const defaultFinish = Object.entries(matConfig.finishOptions).find(([,o]) => o.default);
      if (defaultFinish) {
        selectedFinish = defaultFinish[0];
        modal.querySelector('#summary-finish-row').style.display = '';
        modal.querySelector('#summary-finish').textContent = defaultFinish[1].name;
      }

      finishGrid.querySelectorAll('.sub-option-card').forEach(card => {
        card.addEventListener('click', () => {
          finishGrid.querySelectorAll('.sub-option-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          card.querySelector('input').checked = true;
          selectedFinish = card.dataset.subKey;
          const finishName = matConfig.finishOptions[selectedFinish]?.name || selectedFinish;
          modal.querySelector('#summary-finish-row').style.display = '';
          modal.querySelector('#summary-finish').textContent = finishName;
        });
      });
    }

    // Render edge options (canvas)
    if (matConfig.edgeOptions && Object.keys(matConfig.edgeOptions).length > 1) {
      edgeSection.style.display = '';
      edgeGrid.innerHTML = Object.entries(matConfig.edgeOptions).map(([code, opt]) => `
        <div class="sub-option-card${opt.default ? ' selected' : ''}" data-sub-key="${code}">
          <input type="radio" name="edge" value="${code}" ${opt.default ? 'checked' : ''} />
          <label>
            <div class="sub-option-name">${opt.name}</div>
            <div class="sub-option-desc">${opt.shortDescription || ''}</div>
          </label>
        </div>
      `).join('');

      const defaultEdge = Object.entries(matConfig.edgeOptions).find(([,o]) => o.default);
      if (defaultEdge) {
        selectedEdge = defaultEdge[0];
        modal.querySelector('#summary-edge-row').style.display = '';
        modal.querySelector('#summary-edge').textContent = defaultEdge[1].name;
      }

      edgeGrid.querySelectorAll('.sub-option-card').forEach(card => {
        card.addEventListener('click', () => {
          edgeGrid.querySelectorAll('.sub-option-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          card.querySelector('input').checked = true;
          selectedEdge = card.dataset.subKey;
          const edgeName = matConfig.edgeOptions[selectedEdge]?.name || selectedEdge;
          modal.querySelector('#summary-edge-row').style.display = '';
          modal.querySelector('#summary-edge').textContent = edgeName;
        });
      });
    }

    // Render frame options (Phase 4+5: visual cards, mat/border, preview mockup)
    if (PRODUCT_CATALOG && PRODUCT_CATALOG.frameOptions && PRODUCT_CATALOG.frameOptions.enabled) {
      const frameOpts = PRODUCT_CATALOG.frameOptions;
      let frameType = null;
      let mouldings = null;
      if (frameOpts.floatingFrames && frameOpts.floatingFrames.applicableMaterials.includes(materialKey)) {
        frameType = 'floating';
        mouldings = frameOpts.floatingFrames.mouldings;
      } else if (frameOpts.pictureFrames && frameOpts.pictureFrames.applicableMaterials.includes(materialKey)) {
        frameType = 'picture';
        mouldings = frameOpts.pictureFrames.mouldings;
      }

      if (mouldings && frameSection && frameGrid) {
        frameSection.style.display = '';

        // Build enhanced visual frame cards
        let frameHTML = `
          <div class="frame-visual-card selected" data-frame-code="">
            <input type="radio" name="frame" value="" checked />
            <label>
              <div class="frame-card-preview" style="background:#222;border:2px dashed #444;">
                <span style="color:#666;font-size:11px;">No Frame</span>
              </div>
              <div class="frame-card-name">Print Only</div>
              <div class="frame-card-price">Included</div>
            </label>
          </div>
        `;

        frameHTML += Object.entries(mouldings).map(([code, frame]) => {
          // Real frame moulding image (with CSS gradient fallback)
          const frameImgSrc = FRAME_IMAGES[code] || '';
          const fallbackBg = frame.color === 'natural' ? 'linear-gradient(135deg, #c4a882 0%, #a88960 40%, #d4b894 60%, #b89a72 100%)'
            : frame.color === 'white' ? 'linear-gradient(135deg, #f5f5f0 0%, #e8e8e3 50%, #f5f5f0 100%)'
            : frame.color === 'black' ? 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 50%, #333 100%)'
            : frame.colorHex;
          const frameStrip = frameImgSrc ? `
            <div class="frame-card-preview">
              <img class="frame-card-img" src="${frameImgSrc}" alt="${frame.name}" loading="lazy" />
            </div>` : `
            <div class="frame-card-preview">
              <div class="frame-card-sample" style="background: ${fallbackBg};">
                <div class="frame-card-inner-preview"></div>
              </div>
            </div>`;
          return `
            <div class="frame-visual-card" data-frame-code="${code}">
              <input type="radio" name="frame" value="${code}" />
              <label>
                ${frameStrip}
                <div class="frame-card-name">${frame.name}${frame.recommended ? ' <span class="rec-badge">Rec</span>' : ''}</div>
                <div class="frame-card-price" id="frame-price-${code}">+ pricing by size</div>
              </label>
            </div>`;
        }).join('');

        frameGrid.innerHTML = frameHTML;

        // Helper: update frame preview mockup with real textures
        function updateFramePreview() {
          if (!framePreviewSection) return;
          const previewImg = modal.querySelector('#frame-preview-image');
          const previewOuter = modal.querySelector('#frame-preview-outer');
          const previewMat = modal.querySelector('#frame-preview-mat');
          const previewLabel = modal.querySelector('#frame-preview-label');

          if (!selectedFrame) {
            framePreviewSection.style.display = 'none';
            return;
          }

          // Show preview with photo thumbnail
          framePreviewSection.style.display = '';
          const thumbSrc = photoData.thumbnail || photoData.thumbUrl || '';
          if (previewImg && thumbSrc) {
            previewImg.src = thumbSrc;
          }

          // Frame styling: beveled CSS frame (realistic light/shadow)
          const frameInfo = mouldings[selectedFrame];
          const frameColor = frameInfo ? frameInfo.colorHex : '#333';
          const frameWidth = 18; // px — visual frame border thickness

          if (previewOuter) {
            // Reset all frame styles
            previewOuter.style.borderImage = '';
            previewOuter.style.border = '';
            previewOuter.style.background = '';
            previewOuter.style.padding = '';

            // Beveled frame using graduated border colors
            // Top/left = highlight, bottom/right = shadow (classic frame look)
            const fc = frameInfo?.color || 'black';
            let topC, rightC, bottomC, leftC, bgC;
            if (fc === 'natural') {
              topC = '#d4b894'; rightC = '#a88960'; bottomC = '#8a7050'; leftC = '#b89a72'; bgC = '#c4a882';
            } else if (fc === 'white') {
              topC = '#ffffff'; rightC = '#d8d8d3'; bottomC = '#c0c0bb'; leftC = '#e8e8e3'; bgC = '#f0f0eb';
            } else {
              // Black and default
              topC = '#444'; rightC = '#1a1a1a'; bottomC = '#0a0a0a'; leftC = '#2a2a2a'; bgC = '#222';
            }
            previewOuter.style.borderStyle = 'solid';
            previewOuter.style.borderWidth = `${frameWidth}px`;
            previewOuter.style.borderTopColor = topC;
            previewOuter.style.borderRightColor = rightC;
            previewOuter.style.borderBottomColor = bottomC;
            previewOuter.style.borderLeftColor = leftC;
            previewOuter.style.background = bgC;
            previewOuter.style.padding = '0';
            previewOuter.style.borderRadius = '2px';
            previewOuter.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)';
          }

          // Mat border — proportional to selected width
          if (previewMat) {
            if (selectedMat && selectedMat !== 'none') {
              const matColor = selectedMat === 'blackmatboard' ? '#1a1a1a' : '#f5f5f0';
              // Scale: 1" mat ≈ 8px, 5" mat ≈ 40px in preview
              const matPx = Math.round(selectedMatWidth * 8);
              previewMat.style.background = matColor;
              previewMat.style.padding = `${matPx}px`;
              // Subtle bevel effect for matboard realism
              previewMat.style.boxShadow = selectedMat === 'blackmatboard'
                ? 'inset 0 1px 3px rgba(255,255,255,0.06)'
                : 'inset 0 1px 3px rgba(0,0,0,0.08)';
            } else {
              previewMat.style.background = 'transparent';
              previewMat.style.padding = '0';
              previewMat.style.boxShadow = 'none';
            }
          }

          // Label: frame + mat description
          if (previewLabel) {
            let label = frameInfo ? frameInfo.name : '';
            if (selectedMat && selectedMat !== 'none') {
              const matName = selectedMat === 'blackmatboard' ? 'Black Mat' : 'White Mat';
              label += ` + ${selectedMatWidth}" ${matName}`;
            }
            previewLabel.textContent = label;
          }
        }

        // Helper: show/hide mat section based on frame selection
        function updateMatSection() {
          if (!matSection || !matGrid) return;
          if (!selectedFrame) {
            matSection.style.display = 'none';
            selectedMat = null;
            const matRow = modal.querySelector('#summary-mat-row');
            if (matRow) matRow.style.display = 'none';
            return;
          }

          // Show mat options when a frame is selected
          matSection.style.display = '';
          matGrid.innerHTML = `
            <div class="sub-option-card selected" data-mat-type="none">
              <input type="radio" name="mat" value="none" checked />
              <label>
                <div class="sub-option-name">No Border</div>
                <div class="sub-option-desc">Print fills the frame edge to edge</div>
              </label>
            </div>
            <div class="sub-option-card" data-mat-type="whitematboard">
              <input type="radio" name="mat" value="whitematboard" />
              <label>
                <div class="sub-option-name">
                  <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#f5f5f0;border:1px solid #555;vertical-align:middle;margin-right:4px;"></span>
                  White Mat
                </div>
                <div class="sub-option-desc">Acid-free matboard with beveled window. Classic gallery look.</div>
                <div class="mat-width-control" style="margin-top:8px;display:none;">
                  <label style="font-size:10px;color:#999;cursor:default;">Width:
                    <select class="mat-width-select" style="background:#333;color:#fff;border:1px solid #555;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:4px;">
                      <option value="0.5">½"</option>
                      <option value="1">1"</option>
                      <option value="1.5">1½"</option>
                      <option value="2" selected>2"</option>
                      <option value="3">3"</option>
                      <option value="4">4"</option>
                      <option value="5">5"</option>
                    </select>
                  </label>
                </div>
              </label>
            </div>
            <div class="sub-option-card" data-mat-type="blackmatboard">
              <input type="radio" name="mat" value="blackmatboard" />
              <label>
                <div class="sub-option-name">
                  <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#1a1a1a;border:1px solid #555;vertical-align:middle;margin-right:4px;"></span>
                  Black Mat
                </div>
                <div class="sub-option-desc">Dramatic contrast for high-impact photography.</div>
                <div class="mat-width-control" style="margin-top:8px;display:none;">
                  <label style="font-size:10px;color:#999;cursor:default;">Width:
                    <select class="mat-width-select" style="background:#333;color:#fff;border:1px solid #555;border-radius:4px;padding:2px 6px;font-size:11px;margin-left:4px;">
                      <option value="0.5">½"</option>
                      <option value="1">1"</option>
                      <option value="1.5">1½"</option>
                      <option value="2" selected>2"</option>
                      <option value="3">3"</option>
                      <option value="4">4"</option>
                      <option value="5">5"</option>
                    </select>
                  </label>
                </div>
              </label>
            </div>
          `;

          selectedMat = null;
          const matSummaryRow = modal.querySelector('#summary-mat-row');
          if (matSummaryRow) matSummaryRow.style.display = 'none';

          // Mat click handlers
          matGrid.querySelectorAll('.sub-option-card').forEach(card => {
            card.addEventListener('click', (e) => {
              // Don't steal click from select dropdown
              if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
              matGrid.querySelectorAll('.sub-option-card').forEach(c => c.classList.remove('selected'));
              card.classList.add('selected');
              card.querySelector('input').checked = true;
              selectedMat = card.dataset.matType;

              // Show/hide width controls
              matGrid.querySelectorAll('.mat-width-control').forEach(ctrl => ctrl.style.display = 'none');
              if (selectedMat && selectedMat !== 'none') {
                const widthCtrl = card.querySelector('.mat-width-control');
                if (widthCtrl) widthCtrl.style.display = '';
              }

              // Update summary
              if (matSummaryRow) {
                if (selectedMat && selectedMat !== 'none') {
                  matSummaryRow.style.display = '';
                  const matName = selectedMat === 'blackmatboard' ? 'Black Mat' : 'White Mat';
                  modal.querySelector('#summary-mat').textContent = `${selectedMatWidth}" ${matName}`;
                } else {
                  matSummaryRow.style.display = 'none';
                }
              }

              updateFramePreview();
              if (selectedSize) {
                updatePriceSummary(modal, selectedMaterial, selectedSize, photoData);
              }
            });
          });

          // Mat width change handlers
          matGrid.querySelectorAll('.mat-width-select').forEach(sel => {
            sel.addEventListener('change', (e) => {
              e.stopPropagation();
              selectedMatWidth = parseFloat(sel.value) || 2;
              if (matSummaryRow && selectedMat && selectedMat !== 'none') {
                const matName = selectedMat === 'blackmatboard' ? 'Black Mat' : 'White Mat';
                modal.querySelector('#summary-mat').textContent = `${selectedMatWidth}" ${matName}`;
              }
              updateFramePreview();
            });
          });
        }

        // Frame card click handlers
        frameGrid.querySelectorAll('.frame-visual-card').forEach(card => {
          card.addEventListener('click', () => {
            frameGrid.querySelectorAll('.frame-visual-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            card.querySelector('input').checked = true;
            selectedFrame = card.dataset.frameCode || null;
            const frameRow = modal.querySelector('#summary-frame-row');
            const frameSummary = modal.querySelector('#summary-frame');
            if (selectedFrame && mouldings[selectedFrame]) {
              frameRow.style.display = '';
              frameSummary.textContent = mouldings[selectedFrame].name;
            } else {
              frameRow.style.display = 'none';
              frameSummary.textContent = '—';
            }
            updateMatSection();
            updateFramePreview();
            if (selectedSize) {
              updatePriceSummary(modal, selectedMaterial, selectedSize, photoData);
            }
          });
        });

        // Store updateFramePreview so it can be called from size selection
        modal._updateFramePreview = updateFramePreview;
        // Store a function to update frame addon prices when size is selected
        modal._updateFrameAddonPrices = function(size) {
          if (!size || !window.PictoremPricing) return;
          // Get base price (no frame) for comparison
          const baseOpts = buildCurrentSubOptions();
          baseOpts.frame = '';
          window.PictoremPricing.getRetailPrice(selectedMaterial, size.width, size.height, baseOpts)
            .then(baseResult => {
              const basePrice = baseResult.retail;
              // Get price for each frame moulding
              Object.keys(mouldings).forEach(code => {
                const priceEl = modal.querySelector(`#frame-price-${code}`);
                if (!priceEl) return;
                priceEl.textContent = '...';
                const frameOpts = buildCurrentSubOptions();
                frameOpts.frame = code;
                window.PictoremPricing.getRetailPrice(selectedMaterial, size.width, size.height, frameOpts)
                  .then(frameResult => {
                    const delta = frameResult.retail - basePrice;
                    priceEl.textContent = delta > 0 ? `+ $${delta}` : 'included';
                  })
                  .catch(() => { priceEl.textContent = '+ $' + getFrameAddOnPrice(size); });
              });
              // Update frame summary
              const frameSummary = modal.querySelector('#summary-frame');
              if (selectedFrame && mouldings[selectedFrame] && frameSummary) {
                const selOpts = buildCurrentSubOptions();
                window.PictoremPricing.getRetailPrice(selectedMaterial, size.width, size.height, selOpts)
                  .then(selResult => {
                    const delta = selResult.retail - basePrice;
                    frameSummary.textContent = mouldings[selectedFrame].name + (delta > 0 ? ` (+$${delta})` : '');
                  });
              }
            });
        };
      }
    }

    // Update step numbering for size
    const sizeHeading = modal.querySelector('#size-step-heading');
    if (sizeHeading) {
      const hasSubOptions = subtypeSection.style.display !== 'none' ||
                            mountingSection.style.display !== 'none' ||
                            finishSection.style.display !== 'none' ||
                            edgeSection.style.display !== 'none';
      sizeHeading.textContent = hasSubOptions ? 'Step 3: Choose Size' : 'Step 2: Choose Size';
    }
  }

  // Material selection
  materialOptions.forEach((option) => {
    option.addEventListener('click', () => {
      // Remove previous selection
      materialOptions.forEach((o) => o.classList.remove('selected'));

      // Mark as selected
      option.classList.add('selected');
      const input = option.querySelector('input[type="radio"]');
      input.checked = true;
      selectedMaterial = input.value;

      // Track material selection
      if (window.A35Track) {
        window.A35Track.event('config_change', { field: 'material', value: selectedMaterial, photoId: photoData.id });
      }

      // Update summary
      const materialName = MATERIALS[selectedMaterial].name;
      modal.querySelector('#summary-material').textContent = materialName;

      // Reset size selection when material changes
      selectedSize = null;
      sizeGrid.innerHTML = '';
      modal.querySelector('#summary-size').textContent = 'Select size';
      modal.querySelector('#summary-quality').textContent = '—';
      modal.querySelector('#summary-price').textContent = '$0';
      updateButtonStates();

      // Render sub-options from catalog (Phase 2)
      renderSubOptions(selectedMaterial);

      // Populate sizes for this material
      populateSizes(sizeGrid, applicableSizes, photoData, selectedMaterial, modal, (size) => {
        selectedSize = size;
        updatePriceSummary(modal, selectedMaterial, selectedSize, photoData);
        updateButtonStates();
      });
    });
  });

  // Size selection happens in populateSizes callback
  // Add to cart
  addToCartBtn.addEventListener('click', () => {
    if (selectedMaterial && selectedSize) {
      addToCart(photoData, selectedMaterial, selectedSize);
      closeModal();
    }
  });

  // Buy now
  buyNowBtn.addEventListener('click', () => {
    if (selectedMaterial && selectedSize) {
      initiateStripeCheckout(photoData, selectedMaterial, selectedSize);
    }
  });
}

function populateSizes(container, sizes, photoData, materialKey, modal, onSelect) {
  const { width: photoWidth, height: photoHeight } = photoData.dimensions;

  // Render with fallback prices first, then update with real-time API prices
  container.innerHTML = sizes
    .map((size) => {
      const dpi = calculateDPI(photoWidth, photoHeight, size.width, size.height);
      const quality = getQualityBadge(dpi);
      const fallbackPrice = calculatePrice(materialKey, size.inches, size.width, size.height);

      if (!quality) return '';

      return `
        <div class="size-option" data-size="${size.width}x${size.height}">
          <input type="radio" id="size-${size.width}x${size.height}"
                 name="size" value="${size.width}x${size.height}" />
          <label for="size-${size.width}x${size.height}">
            <div class="size-dimensions">${size.width}" × ${size.height}"</div>
            <div class="size-dpi">${dpi} DPI</div>
            <div class="quality-badge ${quality.class}">${quality.level}</div>
            <div class="size-price" id="size-price-${size.width}x${size.height}">$${fallbackPrice}</div>
          </label>
        </div>
      `;
    })
    .join('');

  // Fetch real-time prices for each size
  if (window.PictoremPricing) {
    const opts = buildCurrentSubOptions();
    sizes.forEach(size => {
      const dpi = calculateDPI(photoWidth, photoHeight, size.width, size.height);
      if (!getQualityBadge(dpi)) return;
      window.PictoremPricing.getRetailPrice(materialKey, size.width, size.height, opts)
        .then(result => {
          const el = container.querySelector(`#size-price-${size.width}x${size.height}`);
          if (el && result.retail) el.textContent = `$${result.retail}`;
        });
    });
  }

  // Add event listeners to size options
  const sizeInputs = container.querySelectorAll('input[type="radio"]');
  sizeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      const [w, h] = input.value.split('x').map(Number);
      const selectedSize = { width: w, height: h, inches: (w * h) };
      if (window.A35Track) {
        window.A35Track.event('config_change', { field: 'size', value: w + 'x' + h });
      }
      onSelect(selectedSize);
    });
  });
}

// Phase 6: Real-time Pictorem pricing (replaces static frame addon tiers)
// getFrameAddOnPrice kept as emergency fallback only — real prices come from PictoremPricing.getRetailPrice()
function getFrameAddOnPrice(size) {
  const area = size.width * size.height;
  if (area <= 144) return 65;
  if (area <= 288) return 75;
  if (area <= 480) return 85;
  if (area <= 864) return 130;
  if (area <= 1536) return 170;
  return 235;
}

/**
 * Build the current sub-options object for PictoremPricing
 */
function buildCurrentSubOptions() {
  return {
    subType: selectedSubtype || '',
    mounting: selectedMounting || '',
    finish: selectedFinish || '',
    edge: selectedEdge || '',
    frame: selectedFrame || '',
    mat: selectedMat || '',
    matWidth: (selectedMat && selectedMat !== 'none') ? String(selectedMatWidth) : ''
  };
}

function updatePriceSummary(modal, materialKey, size, photoData) {
  const { width: photoWidth, height: photoHeight } = photoData.dimensions;
  const dpi = calculateDPI(photoWidth, photoHeight, size.width, size.height);
  const quality = getQualityBadge(dpi);

  modal.querySelector('#summary-size').textContent =
    `${size.width}" × ${size.height}"`;
  modal.querySelector('#summary-quality').textContent = quality ? quality.level : '—';

  // Show loading state
  const priceEl = modal.querySelector('#summary-price');
  priceEl.textContent = '...';

  // Real-time Pictorem pricing
  const opts = buildCurrentSubOptions();
  if (window.PictoremPricing) {
    window.PictoremPricing.getRetailPrice(materialKey, size.width, size.height, opts)
      .then(result => {
        priceEl.textContent = result.retail ? `$${result.retail}` : '$0';
        if (result.fallback) priceEl.title = 'Estimated price (API unavailable)';
        else priceEl.title = '';
        // Store resolved price for addToCart/checkout
        modal._lastResolvedPrice = result.retail;
      })
      .catch(err => {
        console.error('[ARCHIVE-35] Price fetch failed:', err);
        let price = calculatePrice(materialKey, size.inches, size.width, size.height);
        if (selectedFrame) price += getFrameAddOnPrice(size);
        priceEl.textContent = `$${price}`;
        modal._lastResolvedPrice = price;
      });
  } else {
    // Fallback: static table + frame addon
    let price = calculatePrice(materialKey, size.inches, size.width, size.height);
    if (selectedFrame) price += getFrameAddOnPrice(size);
    priceEl.textContent = `$${price}`;
    modal._lastResolvedPrice = price;
  }

  // Update frame addon prices for selected size
  if (modal._updateFrameAddonPrices) {
    modal._updateFrameAddonPrices(size);
  }
  // Update frame preview
  if (modal._updateFramePreview) {
    modal._updateFramePreview();
  }
}

// ============================================================================
// ADD TO CART INTEGRATION
// ============================================================================

function addToCart(photoData, materialKey, size) {
  const { id, title, thumbnail, dimensions } = photoData;
  const material = MATERIALS[materialKey];
  const modal = document.getElementById('product-selector-modal');
  // Use real-time resolved price; fall back to static calculation
  let price = (modal && modal._lastResolvedPrice) || calculatePrice(materialKey, size.inches, size.width, size.height);
  if (!modal?._lastResolvedPrice && selectedFrame) {
    price += getFrameAddOnPrice(size);
  }
  const sizeStr = `${size.width}" × ${size.height}"`;

  // Create cart item
  const cartItem = {
    photoId: id,
    title: title,
    material: material.name,
    size: sizeStr,
    price: price,
    thumbnail: thumbnail,
    // stripePrice will be set to empty for now - handled via backend API
    stripePrice: null,
    metadata: {
      photoId: id,
      photoFilename: photoData.filename || id,
      collection: photoData.collection || '',
      material: materialKey,
      subType: selectedSubtype || '',
      mounting: selectedMounting || '',
      finish: selectedFinish || '',
      edge: selectedEdge || '',
      frame: selectedFrame || '',
      mat: selectedMat || '',
      matWidth: selectedMat && selectedMat !== 'none' ? selectedMatWidth.toString() : '',
      width: size.width.toString(),
      height: size.height.toString(),
      originalPhotoWidth: dimensions.width.toString(),
      originalPhotoHeight: dimensions.height.toString(),
      dpi: calculateDPI(
        dimensions.width,
        dimensions.height,
        size.width,
        size.height
      ).toString()
    }
  };

  // Add to cart
  if (window.cart && window.cart.addToCart) {
    window.cart.addToCart(cartItem);

    // Show toast notification
    if (window.cartUI && window.cartUI.showToast) {
      window.cartUI.showToast(`Added "${title}" to cart`);
    }
  } else {
    console.error('Cart not available');
    alert('Cart system is not initialized. Please refresh the page.');
  }
}

// ============================================================================
// STRIPE CHECKOUT INTEGRATION
// ============================================================================

function initiateStripeCheckout(photoData, materialKey, size) {
  const { id, title, dimensions } = photoData;
  const material = MATERIALS[materialKey];
  const modal = document.getElementById('product-selector-modal');
  let price = (modal && modal._lastResolvedPrice) || calculatePrice(materialKey, size.inches, size.width, size.height);
  if (!modal?._lastResolvedPrice && selectedFrame) {
    price += getFrameAddOnPrice(size);
  }
  const priceInCents = price * 100;

  // Create line item for Stripe
  const lineItem = {
    price_data: {
      currency: 'usd',
      product_data: {
        name: `${title} - ${material.name}`,
        description: `${size.width}" × ${size.height}" Print${selectedFrame ? ' + Frame' : ''}${selectedMat && selectedMat !== 'none' ? ' + ' + selectedMatWidth + '" Mat' : ''}`,
        metadata: {
          photoId: id,
          material: materialKey,
          subType: selectedSubtype || '',
          mounting: selectedMounting || '',
          finish: selectedFinish || '',
          edge: selectedEdge || '',
          frame: selectedFrame || '',
          width: size.width.toString(),
          height: size.height.toString(),
          originalPhotoWidth: dimensions.width.toString(),
          originalPhotoHeight: dimensions.height.toString(),
          dpi: calculateDPI(
            dimensions.width,
            dimensions.height,
            size.width,
            size.height
          ).toString()
        }
      },
      unit_amount: priceInCents
    },
    quantity: 1
  };

  // Create checkout session (requires backend endpoint)
  const checkoutData = {
    lineItems: [lineItem],
    successUrl: `${window.location.origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: window.location.href,
    pictorem: {
      photoId: id,
      photoTitle: title,
      photoFilename: photoData.filename || id,
      collection: photoData.collection || '',
      material: materialKey,
      subType: selectedSubtype || '',
      mounting: selectedMounting || '',
      finish: selectedFinish || '',
      edge: selectedEdge || '',
      frame: selectedFrame || '',
      mat: selectedMat || '',
      matWidth: selectedMat && selectedMat !== 'none' ? selectedMatWidth : 0,
      dimensions: {
        width: size.width,
        height: size.height,
        originalWidth: dimensions.width,
        originalHeight: dimensions.height,
        dpi: calculateDPI(dimensions.width, dimensions.height, size.width, size.height)
      }
    }
  };

  // Close the modal while processing
  const modal = document.getElementById('product-selector-modal');
  const checkoutBtn = modal?.querySelector('#checkout-button');
  if (checkoutBtn) {
    checkoutBtn.textContent = 'Processing...';
    checkoutBtn.disabled = true;
  }

  // Detect test mode from Stripe public key prefix
  const isTestMode = window.STRIPE_PUBLIC_KEY && window.STRIPE_PUBLIC_KEY.startsWith('pk_test_');
  if (isTestMode) {
    checkoutData.testMode = true;
    console.log('[ARCHIVE-35] Test mode detected — using test Stripe keys');
  }

  // Try Stripe checkout first, fall back to contact form
  // Use pages.dev endpoint for API calls (custom domain function routing may lag)
  const apiBase = 'https://archive-35-com.pages.dev';
  fetch(`${apiBase}/api/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkoutData)
  })
    .then((res) => {
      if (!res.ok) throw new Error('Checkout endpoint not available');
      return res.json();
    })
    .then((data) => {
      // Log mode confirmation from backend
      if (data.mode) {
        console.log(`[ARCHIVE-35] Checkout session created in ${data.mode.toUpperCase()} mode`);
      }
      // Prefer direct URL redirect (Stripe's recommended approach)
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // Fallback to redirectToCheckout for older integration
      if (data.sessionId && window.Stripe && window.STRIPE_PUBLIC_KEY) {
        window.Stripe(window.STRIPE_PUBLIC_KEY).redirectToCheckout({
          sessionId: data.sessionId
        });
      } else {
        throw new Error('Stripe not configured');
      }
    })
    .catch((err) => {
      console.warn('Stripe checkout unavailable, redirecting to contact form:', err.message);
      // Fallback: redirect to contact page with order details
      const orderSummary = encodeURIComponent(
        `I would like to order:\n\nPhoto: ${title}\nMaterial: ${material.name}\nSize: ${size.width}" \u00d7 ${size.height}"\nPrice: $${price}\n\nPlease send me a payment link.`
      );
      window.location.href = `contact.html?message=${orderSummary}`;
    });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Open product selector modal for a photo
 * @param {Object} photoData - Photo object from photos.json with dimensions
 */
async function openProductSelector(photoData) {
  // Track product selector open
  if (window.A35Track) {
    window.A35Track.event('product_open', { photoId: photoData.id, title: photoData.title });
  }

  // Load product catalog (non-blocking — sub-options just won't show if it fails)
  loadProductCatalog();

  // Inject styles if not already present
  if (!document.getElementById('product-selector-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'product-selector-styles';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  // Close existing modal if open
  const existing = document.getElementById('product-selector-modal');
  if (existing) {
    existing.remove();
  }

  // Validate dimensions exist
  if (!photoData.dimensions) {
    console.warn('Product selector: photo missing dimensions', photoData.id || photoData.title);
    alert('Print ordering is not available for this photo yet. Dimensions data is missing.');
    return;
  }

  // Create new modal
  const { modal, category, applicableSizes, licenseClass } =
    createProductSelectorModal(photoData);

  // Add to page
  document.body.appendChild(modal);

  // Setup events
  setupProductSelectorEvents(modal, category, applicableSizes, photoData, licenseClass);

  // Trigger transition animation
  setTimeout(() => {
    modal.classList.add('visible');
  }, 10);
}

// ============================================================================
// STYLES (should be in separate CSS file, but included here for reference)
// ============================================================================

const STYLES = `
  /* Product Selector Modal */
  .product-selector-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }

  .product-selector-modal.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .product-selector-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    cursor: pointer;
  }

  .product-selector-content {
    position: relative;
    background: #1a1a1a;
    color: #fff;
    border-radius: 12px;
    max-width: 800px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    z-index: 1000000;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .close-button {
    position: absolute;
    top: 16px;
    right: 16px;
    background: none;
    border: none;
    color: #c4973b;
    font-size: 28px;
    cursor: pointer;
    z-index: 10001;
    padding: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-button:hover {
    opacity: 0.8;
  }

  .selector-header {
    padding: 32px 24px 24px;
    border-bottom: 1px solid #333;
  }

  .selector-header h2 {
    margin: 0 0 8px 0;
    font-size: 24px;
    color: #fff;
  }

  .selector-subtitle {
    margin: 0;
    font-size: 14px;
    color: #999;
  }

  .selector-body {
    padding: 24px;
  }

  .material-section,
  .size-section {
    margin-bottom: 32px;
  }

  .material-section h3,
  .size-section h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    color: #c4973b;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .material-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .material-option {
    position: relative;
  }

  .material-option input[type='radio'] {
    position: absolute;
    opacity: 0;
  }

  .material-option label {
    display: block;
    padding: 0;
    border: 2px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #222;
    overflow: hidden;
  }

  .material-thumb {
    width: 100%;
    height: 90px;
    overflow: hidden;
    background: #1a1a1a;
  }

  .material-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.3s ease;
  }

  .material-option:hover .material-thumb img {
    transform: scale(1.05);
  }

  .material-option input[type='radio']:checked + label {
    border-color: #c4973b;
    background: rgba(196, 151, 59, 0.1);
  }

  .material-name {
    font-weight: 600;
    margin-bottom: 4px;
    padding: 12px 12px 0 12px;
  }

  .material-description {
    font-size: 12px;
    color: #999;
    line-height: 1.3;
    padding: 0 12px;
  }

  .material-meta {
    font-size: 11px;
    color: #777;
    margin-top: 6px;
    padding: 0 12px 12px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .hang-ready-tag {
    font-size: 9px;
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .needs-frame-tag {
    font-size: 9px;
    background: rgba(255, 193, 7, 0.2);
    color: #ffc107;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .size-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }

  .size-option {
    position: relative;
  }

  .size-option input[type='radio'] {
    position: absolute;
    opacity: 0;
  }

  .size-option label {
    display: block;
    padding: 12px;
    border: 2px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #222;
    text-align: center;
  }

  .size-option input[type='radio']:checked + label {
    border-color: #c4973b;
    background: rgba(196, 151, 59, 0.1);
  }

  .size-dimensions {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .size-dpi {
    font-size: 12px;
    color: #999;
    margin-bottom: 4px;
  }

  .quality-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
    margin-bottom: 6px;
    display: inline-block;
  }

  .quality-museum {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  .quality-excellent {
    background: rgba(255, 193, 7, 0.2);
    color: #ffc107;
  }

  .quality-good {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
  }

  .size-price {
    font-weight: 600;
    color: #c4973b;
  }

  .price-summary {
    background: #222;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 16px;
    margin: 24px 0;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 14px;
    color: #ccc;
  }

  .summary-row.total {
    border-top: 1px solid #333;
    padding-top: 12px;
    margin-top: 12px;
    font-size: 18px;
    font-weight: 600;
    color: #c4973b;
  }

  .product-info {
    background: rgba(196, 151, 59, 0.05);
    border-left: 3px solid #c4973b;
    padding: 16px;
    margin: 24px 0;
    border-radius: 4px;
  }

  .info-item {
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 8px;
  }

  .info-item:last-child {
    margin-bottom: 0;
  }

  .product-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 8px;
  }

  /* Terms Acknowledgment Checkbox */
  .terms-acknowledgment {
    background: rgba(255, 60, 60, 0.05);
    border: 1px solid rgba(255, 60, 60, 0.2);
    border-radius: 8px;
    padding: 16px;
    margin: 16px 0 8px;
  }

  .terms-checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1.5;
    color: #ccc;
  }

  .terms-checkbox-label input[type='checkbox'] {
    margin-top: 2px;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: #c4973b;
    cursor: pointer;
  }

  .terms-checkbox-text strong {
    color: #fff;
  }

  .terms-checkbox-text a {
    color: #c4973b;
    text-decoration: underline;
  }

  .terms-checkbox-text a:hover {
    color: #d4a755;
  }

  .add-to-cart-button,
  .buy-now-button {
    padding: 14px 24px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .add-to-cart-button {
    background: #c4973b;
    color: #000;
  }

  .add-to-cart-button:not(:disabled):hover {
    background: #d4a755;
    transform: translateY(-2px);
  }

  .buy-now-button {
    background: transparent;
    color: #c4973b;
    border: 1px solid #c4973b;
  }

  .buy-now-button:not(:disabled):hover {
    background: rgba(196, 151, 59, 0.1);
    border-color: #d4a755;
    color: #d4a755;
    transform: translateY(-2px);
  }

  .add-to-cart-button:disabled,
  .buy-now-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 600px) {
    .product-actions {
      grid-template-columns: 1fr;
    }
  }

  /* Tab bar */
  .selector-tabs {
    display: flex;
    gap: 0;
    margin-top: 16px;
    border-bottom: 1px solid #333;
  }

  .selector-tab {
    padding: 10px 24px;
    background: none;
    border: none;
    color: #999;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s ease;
  }

  .selector-tab:hover { color: #ccc; }

  .selector-tab.active {
    color: #c4973b;
    border-bottom-color: #c4973b;
  }

  /* Licensing tier grid */
  .license-tier-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }

  .license-tier-option {
    position: relative;
  }

  .license-tier-option input[type='radio'] {
    position: absolute;
    opacity: 0;
  }

  .license-tier-option label {
    display: block;
    padding: 16px;
    border: 2px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #222;
  }

  .license-tier-option.selected label,
  .license-tier-option input[type='radio']:checked + label {
    border-color: #c4973b;
    background: rgba(196, 151, 59, 0.1);
  }

  .license-classification {
    margin-bottom: 20px;
    padding: 12px 0;
    display: flex;
    align-items: center;
  }

  .license-format-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    max-width: 300px;
  }

  /* Sub-option sections (Phase 2 — material subtypes, mounting, finish, edge) */
  .sub-option-section {
    margin-bottom: 24px;
  }

  .sub-option-section h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
    color: #c4973b;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .sub-option-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }

  .sub-option-card {
    position: relative;
    cursor: pointer;
  }

  .sub-option-card input[type='radio'] {
    position: absolute;
    opacity: 0;
  }

  .sub-option-card label {
    display: block;
    padding: 12px 14px;
    border: 2px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #222;
  }

  .sub-option-card:hover label {
    border-color: #555;
  }

  .sub-option-card.selected label,
  .sub-option-card input[type='radio']:checked + label {
    border-color: #c4973b;
    background: rgba(196, 151, 59, 0.1);
  }

  .sub-option-name {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 3px;
    color: #fff;
  }

  .sub-option-desc {
    font-size: 11px;
    color: #999;
    line-height: 1.3;
  }

  .sub-option-meta {
    font-size: 10px;
    color: #777;
    margin-top: 4px;
  }

  .sub-option-warning {
    font-size: 10px;
    color: #ff6b6b;
    margin-top: 4px;
  }

  .rec-badge {
    font-size: 9px;
    background: rgba(196, 151, 59, 0.3);
    color: #c4973b;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    vertical-align: middle;
  }

  /* Phase 5: Visual Frame Cards */
  .frame-visual-card {
    position: relative;
    cursor: pointer;
  }

  .frame-visual-card input[type='radio'] {
    position: absolute;
    opacity: 0;
  }

  .frame-visual-card label {
    display: block;
    padding: 10px;
    border: 2px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #222;
    text-align: center;
  }

  .frame-visual-card:hover label {
    border-color: #555;
  }

  .frame-visual-card.selected label,
  .frame-visual-card input[type='radio']:checked + label {
    border-color: #c4973b;
    background: rgba(196, 151, 59, 0.1);
  }

  .frame-card-preview {
    width: 100%;
    height: 64px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
    overflow: hidden;
  }

  .frame-card-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 4px;
  }

  .frame-card-sample {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
  }

  .frame-card-inner-preview {
    width: 60%;
    height: 70%;
    background: #0a0a0a;
    border-radius: 2px;
  }

  .frame-card-name {
    font-weight: 600;
    font-size: 12px;
    color: #fff;
    margin-bottom: 2px;
  }

  .frame-card-price {
    font-size: 11px;
    color: #c4973b;
  }

  /* Phase 5: Frame Preview Mockup — Gallery Wall Simulation */
  .frame-preview-container {
    background: linear-gradient(180deg, #1a1916 0%, #1e1c19 50%, #16150f 100%);
    border: 1px solid #333;
    border-radius: 8px;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 24px;
    position: relative;
    /* Subtle wall texture noise */
    background-image:
      radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.03) 0%, transparent 70%),
      linear-gradient(180deg, #1a1916 0%, #1e1c19 50%, #16150f 100%);
  }

  .frame-preview-outer {
    display: inline-block;
    max-width: 100%;
    transition: all 0.3s ease;
    /* Drop shadow as if hanging on a wall */
    filter: drop-shadow(0 12px 24px rgba(0,0,0,0.6)) drop-shadow(0 2px 4px rgba(0,0,0,0.4));
  }

  .frame-preview-mat {
    display: inline-block;
    transition: all 0.3s ease;
    line-height: 0;
  }

  .frame-preview-image {
    max-width: 280px;
    max-height: 200px;
    display: block;
    object-fit: contain;
  }

  .frame-preview-label {
    margin-top: 16px;
    font-size: 11px;
    color: #888;
    text-align: center;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  @media (max-width: 600px) {
    .product-selector-content {
      width: 95%;
    }

    .material-grid,
    .license-tier-grid {
      grid-template-columns: 1fr;
    }

    .size-grid {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    }

    .sub-option-grid {
      grid-template-columns: 1fr;
    }

    .selector-tab {
      padding: 8px 14px;
      font-size: 11px;
    }

    .frame-preview-image {
      max-width: 200px;
      max-height: 150px;
    }
  }
`;

// ============================================================================
// LIGHTBOX INTEGRATION
// ============================================================================

/**
 * Hook into the lightbox "Buy Print" button to open the product selector.
 * Compatible with the existing gallery lightbox in js/main.js.
 */
function replaceLightboxBuyButton() {
  const buyBtn = document.querySelector('.lightbox-buy');
  if (buyBtn && !buyBtn.dataset.selectorAttached) {
    buyBtn.removeAttribute('href');
    buyBtn.removeAttribute('target');
    buyBtn.textContent = 'Buy Print / License';
    buyBtn.dataset.selectorAttached = 'true';

    buyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const photo = window.filteredPhotos?.[window.currentPhotoIndex];
      if (photo) {
        // Open product selector directly — it's position:fixed and overlays everything.
        // Close lightbox AFTER selector is created to avoid DOM mutation interference.
        openProductSelector(photo);
        try {
          if (typeof window.closeLightbox === 'function') window.closeLightbox();
        } catch(err) { /* lightbox already gone */ }
      }
    });
  }
}

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Watch for lightbox creation and attach the buy button handler
  const observer = new MutationObserver(() => {
    replaceLightboxBuyButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately and after delays for reliability
  setTimeout(replaceLightboxBuyButton, 100);
  setTimeout(replaceLightboxBuyButton, 500);
});

// ============================================================================
// EXPORT FOR USE
// ============================================================================

// If using modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openProductSelector,
    ASPECT_RATIO_CATEGORIES,
    MATERIALS,
    calculatePrice,
    calculateDPI,
    getQualityBadge
  };
}

// Global scope
window.openProductSelector = openProductSelector;
window.ProductSelector = { open: openProductSelector, close: () => {
  const modal = document.getElementById('product-selector-modal');
  if (modal) modal.remove();
}};
window.PRODUCT_SELECTOR = {
  openProductSelector,
  ASPECT_RATIO_CATEGORIES,
  MATERIALS,
  calculatePrice,
  calculateDPI,
  getQualityBadge
};
