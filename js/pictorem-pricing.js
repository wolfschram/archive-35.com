/**
 * ARCHIVE-35 Real-Time Pictorem Pricing
 *
 * Calls /api/pictorem-products with getprice action to get wholesale costs,
 * applies 2x markup for retail. Caches results. Falls back to static table.
 *
 * Usage:
 *   PictoremPricing.getRetailPrice('metal', 24, 16, { subType: 'hd', mounting: 'standoff', frame: '303-19' })
 *     .then(function(result) { console.log(result.retail, result.wholesale); });
 */
(function() {
  'use strict';

  // Per-material markup on the ART (print itself)
  // Canvas: 1.75× (75% markup). All others: 2.0× (100% markup).
  var ART_MARKUP = {
    canvas: 1.75,
    paper:  2,
    metal:  2,
    acrylic: 2,
    wood:   2
  };
  var DEFAULT_ART_MARKUP = 2;

  // Markup on add-ons (frames, mounting, borders) — just 15% to cover handling
  var ADDON_MARKUP = 1.15;

  // Keys that are part of the art print (get full markup)
  // Everything else (frames, mounting, borders) gets ADDON_MARKUP
  var ART_KEYS = {
    'main': true,
    'semigloss': true, 'matte': true, 'knife': true, 'silver': true,  // canvas finishes
    'mirrorimage': true, 'gallerywrap': true, 'solidcolor': true,       // canvas edges
    'none': true, 'c15': true, 'c075': true, 'stretched': true, 'canvas': true  // canvas types
  };
  var API_URL = 'https://archive-35-com.pages.dev/api/pictorem-products';
  var cache = {};

  // Material defaults (mirrors MATERIAL_MAP in stripe-webhook.js)
  var MATERIAL_DEFAULTS = {
    canvas:  { material: 'canvas',  type: 'stretched', additionals: ['semigloss', 'mirrorimage', 'c15', 'none', 'none'] },
    metal:   { material: 'metal',   type: 'hd',        additionals: ['standoff'] },
    acrylic: { material: 'acrylic', type: 'ac220',     additionals: ['standoff'] },
    paper:   { material: 'paper',   type: 'art',       additionals: ['none', 'none'] },
    wood:    { material: 'wood',    type: 'ru14',       additionals: ['none', 'none'] }
  };

  // Static fallback table (PRICE_TABLE from product-selector.js)
  var FALLBACK_PRICES = {
    canvas: { '12x8': 101, '16x9': 109, '12x12': 90, '16x12': 98, '18x12': 120, '24x10': 124, '24x12': 113, '20x16': 137, '24x14': 140, '24x16': 129, '20x20': 151, '24x18': 156, '36x12': 137, '42x12': 168, '36x15': 174, '32x18': 179, '36x18': 191, '48x16': 192, '36x24': 208, '56x16': 232, '30x30': 214, '60x15': 233, '48x20': 242, '48x24': 255, '40x30': 282, '60x20': 282, '48x27': 298, '72x18': 459, '60x25': 331, '48x32': 337, '60x40': 640 },
    metal: { '12x8': 90, '16x9': 110, '12x12': 110, '16x12': 130, '18x12': 140, '24x10': 150, '24x12': 170, '20x16': 183, '24x14': 190, '24x16': 210, '20x20': 217, '24x18': 230, '36x12': 230, '42x12': 260, '36x15': 275, '32x18': 290, '36x18': 320, '48x16': 370, '36x24': 409, '56x16': 423, '30x30': 424, '60x15': 424, '48x20': 449, '48x24': 529, '40x30': 549, '60x20': 549, '48x27': 589, '72x18': 750, '60x25': 674, '48x32': 689, '60x40': 1209 },
    acrylic: { '12x8': 123, '16x9': 142, '12x12': 142, '16x12': 160, '18x12': 170, '24x10': 179, '24x12': 197, '20x16': 210, '24x14': 216, '24x16': 234, '20x20': 240, '24x18': 253, '36x12': 253, '42x12': 281, '36x15': 294, '32x18': 308, '36x18': 336, '48x16': 382, '36x24': 419, '56x16': 432, '30x30': 433, '60x15': 433, '48x20': 456, '48x24': 530, '40x30': 549, '60x20': 549, '48x27': 586, '72x18': 747, '60x25': 664, '48x32': 678, '60x40': 1173 },
    paper: { '12x8': 33, '16x9': 37, '12x12': 37, '16x12': 42, '18x12': 44, '24x10': 46, '24x12': 50, '20x16': 53, '24x14': 54, '24x16': 59, '20x20': 60, '24x18': 63, '36x12': 63, '42x12': 69, '36x15': 72, '32x18': 75, '36x18': 82, '48x16': 92, '36x24': 101, '56x16': 104, '30x30': 104, '60x15': 104, '48x20': 109, '48x24': 126, '40x30': 131, '60x20': 131, '48x27': 139, '72x18': 139, '60x25': 157, '48x32': 160, '60x40': 237 },
    wood: { '12x8': 54, '16x9': 66, '12x12': 66, '16x12': 79, '18x12': 85, '24x10': 92, '24x12': 104, '20x16': 113, '24x14': 117, '24x16': 130, '20x20': 134, '24x18': 143, '36x12': 143, '42x12': 162, '36x15': 171, '32x18': 181, '36x18': 200, '48x16': 231, '36x24': 257, '56x16': 265, '30x30': 266, '60x15': 266, '48x20': 282, '48x24': 333, '40x30': 346, '60x20': 346, '48x27': 371, '72x18': 533, '60x25': 425, '48x32': 435, '60x40': 825 }
  };

  /**
   * Build Pictorem preorder code (client-side mirror of stripe-webhook.js buildPreorderCode)
   * @param {string} materialKey - canvas, metal, acrylic, paper, wood
   * @param {number} w - print width inches
   * @param {number} h - print height inches
   * @param {object} opts - { subType, mounting, finish, edge, frame, mat, matWidth }
   * @returns {string} preorder code like "1|metal|hd|horizontal|24|16|standoff|moulding|303-19"
   */
  function buildPreorderCode(materialKey, w, h, opts) {
    opts = opts || {};
    var defaults = MATERIAL_DEFAULTS[materialKey];
    if (!defaults) return '';

    var orientation = w >= h ? 'horizontal' : 'vertical';
    var hasSubOpts = opts.subType || opts.mounting || opts.finish || opts.edge;
    var frameCode = opts.frame || '';

    // No sub-options and no frame → use defaults
    if (!hasSubOpts && !frameCode) {
      var parts = ['1', defaults.material, defaults.type, orientation, String(w), String(h)];
      if (defaults.additionals) {
        var nonNone = false;
        for (var i = 0; i < defaults.additionals.length; i++) {
          if (defaults.additionals[i] !== 'none') nonNone = true;
        }
        if (nonNone) {
          for (var j = 0; j < defaults.additionals.length; j++) {
            parts.push(defaults.additionals[j]);
          }
        }
      }
      return parts.join('|');
    }

    // Dynamic code with sub-options
    var type = opts.subType || defaults.type;
    var additionals = [];

    if (materialKey === 'canvas') {
      if (type === 'rolled') {
        type = 'canvas';
      } else {
        type = 'stretched';
      }
      var finish = opts.finish || 'semigloss';
      var edge = opts.edge || 'mirrorimage';
      additionals = [finish, edge];
      if (opts.subType === 'c15' || opts.subType === 'c075') {
        additionals.push(opts.subType);
      }
      additionals.push('none', 'none');
    } else if (materialKey === 'metal' || materialKey === 'acrylic') {
      var mounting = opts.mounting || 'standoff';
      if (mounting && mounting !== 'none') {
        additionals = [mounting];
      }
    } else if (materialKey === 'wood') {
      var mounting = opts.mounting || '';
      if (mounting === 'frenchcleat') {
        additionals = ['frenchcleat'];
      }
    }
    // paper: no additionals

    var parts = ['1', defaults.material, type, orientation, String(w), String(h)];
    var hasReal = false;
    for (var k = 0; k < additionals.length; k++) {
      if (additionals[k] !== 'none') hasReal = true;
    }
    if (hasReal) {
      for (var l = 0; l < additionals.length; l++) {
        parts.push(additionals[l]);
      }
    }

    // Mat/border (before frame)
    var matType = opts.mat || '';
    var matWidth = opts.matWidth || '';
    if (matType && matType !== 'none' && matWidth) {
      parts.push(matType, String(matWidth));
    }

    // Frame (last)
    if (frameCode && frameCode !== 'none') {
      var frameMountingType = materialKey === 'paper' ? 'frame' : 'moulding';
      parts.push(frameMountingType, frameCode);
    }

    return parts.join('|');
  }

  /**
   * Look up fallback price from static table
   */
  function fallbackPrice(materialKey, w, h) {
    var tbl = FALLBACK_PRICES[materialKey];
    if (!tbl) return 0;
    var k1 = w + 'x' + h;
    var k2 = h + 'x' + w;
    return tbl[k1] || tbl[k2] || 0;
  }

  /**
   * Get real-time retail price from Pictorem API
   * @param {string} materialKey - canvas, metal, acrylic, paper, wood
   * @param {number} w - print width inches
   * @param {number} h - print height inches
   * @param {object} opts - { subType, mounting, finish, edge, frame, mat, matWidth }
   * @returns {Promise<{retail: number, wholesale: number, preorderCode: string, fallback: boolean}>}
   */
  function getRetailPrice(materialKey, w, h, opts) {
    var code = buildPreorderCode(materialKey, w, h, opts);
    if (!code) {
      return Promise.resolve({ retail: 0, wholesale: 0, preorderCode: '', fallback: true });
    }

    // Check cache
    if (cache[code]) {
      return Promise.resolve(cache[code]);
    }

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getprice', preordercode: code })
    })
    .then(function(res) { return res.json(); })
    .then(function(json) {
      if (json.data && json.data.status === true && json.data.worksheet && json.data.worksheet.price) {
        var priceData = json.data.worksheet.price;
        var listItems = priceData.list || {};
        var discItems = priceData.discount || {};
        var wholesale = priceData.subTotal;

        // Split cost: art (full markup) vs add-ons (15% markup)
        var artCost = 0;
        var addonCost = 0;
        for (var key in listItems) {
          if (listItems.hasOwnProperty(key)) {
            var net = (listItems[key] || 0) - (discItems[key] || 0);
            if (ART_KEYS[key]) {
              artCost += net;
            } else {
              addonCost += net;
            }
          }
        }

        var artMultiplier = ART_MARKUP[materialKey] || DEFAULT_ART_MARKUP;
        var retail = Math.ceil(artCost * artMultiplier + addonCost * ADDON_MARKUP);
        var result = {
          retail: retail,
          wholesale: Math.round(wholesale * 100) / 100,
          artCost: Math.round(artCost * 100) / 100,
          addonCost: Math.round(addonCost * 100) / 100,
          preorderCode: code,
          fallback: false
        };
        cache[code] = result;
        return result;
      }
      // API returned but no valid price — fallback
      console.warn('[ARCHIVE-35] Pictorem getprice returned unexpected data for:', code, json);
      var fb = fallbackPrice(materialKey, w, h);
      return { retail: fb, wholesale: 0, preorderCode: code, fallback: true };
    })
    .catch(function(err) {
      console.warn('[ARCHIVE-35] Pictorem API error, using fallback price:', err.message);
      var fb = fallbackPrice(materialKey, w, h);
      return { retail: fb, wholesale: 0, preorderCode: code, fallback: true };
    });
  }

  /**
   * Clear price cache (useful when debugging)
   */
  function clearCache() {
    cache = {};
  }

  // Expose on window
  window.PictoremPricing = {
    getRetailPrice: getRetailPrice,
    buildPreorderCode: buildPreorderCode,
    fallbackPrice: fallbackPrice,
    clearCache: clearCache,
    FALLBACK_PRICES: FALLBACK_PRICES
  };

})();
