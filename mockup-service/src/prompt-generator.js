/**
 * prompt-generator.js — ChatGPT Room Image Prompt Generator
 *
 * When a photo has no compatible room template, generates a ready-to-paste
 * ChatGPT prompt that Wolf can use to create a new room with a green-screen
 * placement zone matching the photo's aspect ratio.
 */

'use strict';

const { classifyAspect } = require('./matcher');

// Room categories with style presets
const ROOM_PRESETS = {
  'living-room-modern': {
    name: 'Modern Living Room',
    description: 'Contemporary living room with clean lines, neutral furniture, large windows',
    lighting: 'warm ambient with natural daylight from floor-to-ceiling windows',
    furniture: 'L-shaped sectional sofa, marble coffee table, modern floor lamp',
    wall: 'textured light gray or warm white accent wall',
  },
  'living-room-luxury': {
    name: 'Luxury Penthouse Living Room',
    description: 'High-end penthouse with city skyline views, statement furniture',
    lighting: 'warm recessed downlights and accent lighting, evening city glow through windows',
    furniture: 'dark sectional, designer coffee table, brass accents',
    wall: 'warm taupe or dark accent wall with subtle texture',
  },
  'bedroom': {
    name: 'Minimalist Bedroom',
    description: 'Calm, light-filled bedroom with natural materials',
    lighting: 'soft natural daylight from sheer curtains, bedside lamps',
    furniture: 'wooden bed frame, white bedding, matching nightstands with ceramic lamps',
    wall: 'warm white or light beige wall above headboard',
  },
  'office': {
    name: 'Executive Office',
    description: 'Professional office with sophisticated design',
    lighting: 'overhead panel lighting with desk task light',
    furniture: 'large desk, leather chair, bookshelf, plants',
    wall: 'light gray or navy accent wall behind desk',
  },
  'gallery': {
    name: 'Art Gallery',
    description: 'Clean white-walled gallery space with track lighting',
    lighting: 'directional track lights from ceiling aimed at wall',
    furniture: 'single leather bench centered below artwork, polished concrete floor',
    wall: 'pure white gallery wall',
  },
  'gallery-dark': {
    name: 'Dark Gallery',
    description: 'Dark-walled gallery for dramatic presentation',
    lighting: 'focused track lights creating pool of light on artwork',
    furniture: 'leather bench, dark concrete floor',
    wall: 'charcoal or matte black wall',
  },
  'hotel-lobby': {
    name: 'Grand Hotel Lobby',
    description: 'Elegant hotel lobby with crystal chandeliers and marble',
    lighting: 'warm chandeliers, accent wall washers, ambient glow',
    furniture: 'seating clusters, reception desk, side tables with flowers',
    wall: 'dark wood or textured stone feature wall behind reception',
  },
  'conference-room': {
    name: 'Modern Conference Room',
    description: 'Tech-forward meeting space with clean design',
    lighting: 'linear LED pendants, natural light from glass walls',
    furniture: 'long table with high chairs, large display screen nearby',
    wall: 'clean white wall with industrial ceiling elements',
  },
  'restaurant': {
    name: 'Fine Dining Restaurant',
    description: 'Upscale restaurant with warm, intimate atmosphere',
    lighting: 'pendant copper lights, warm indirect lighting, candles',
    furniture: 'round table with white linens, banquette seating',
    wall: 'exposed brick or warm wood paneling',
  },
  'spa': {
    name: 'Spa & Wellness Lobby',
    description: 'Zen-inspired spa reception with natural materials',
    lighting: 'warm ambient with concealed cove lighting',
    furniture: 'wooden reception counter, bamboo plants, stone features, candles',
    wall: 'natural stone or warm wood wall',
  },
  'outdoor': {
    name: 'Covered Outdoor Patio',
    description: 'Mediterranean-style outdoor seating with ocean view',
    lighting: 'natural sunlight, golden hour glow',
    furniture: 'wicker seating with cushions, low table, bougainvillea',
    wall: 'stucco or plastered wall beneath a wooden pergola',
  },
  'hallway': {
    name: 'Hotel Corridor',
    description: 'Elegant hotel hallway with dramatic lighting',
    lighting: 'wall sconces and recessed ceiling lights',
    furniture: 'console table, decorative vase, carpet runner',
    wall: 'textured wallpaper or wood paneling',
  },
};

/**
 * Generate a ChatGPT prompt for creating a room with a green-screen zone.
 *
 * @param {object} options
 * @param {number} options.aspectRatio - Photo aspect ratio (width/height)
 * @param {string} [options.roomType='living-room-modern'] - Key from ROOM_PRESETS
 * @param {number} [options.imageWidth=1536] - Output image width (ChatGPT default)
 * @param {number} [options.zonePercent=65] - Zone width as % of image width
 * @returns {string} Ready-to-paste ChatGPT prompt
 */
function generateRoomPrompt(options) {
  const {
    aspectRatio,
    roomType = 'living-room-modern',
    imageWidth = 1536,
    zonePercent = 65
  } = options;

  const preset = ROOM_PRESETS[roomType];
  if (!preset) {
    throw new Error(`Unknown room type: "${roomType}". Valid: ${Object.keys(ROOM_PRESETS).join(', ')}`);
  }

  const category = classifyAspect(aspectRatio);

  // Compute image dimensions (ChatGPT generates ~1536px wide by default)
  // For panoramic photos, make the image wider to accommodate the zone
  let imgW = imageWidth;
  let imgH;
  if (aspectRatio >= 2.5) {
    // Ultra-wide: use wider canvas
    imgW = 2048;
    imgH = Math.round(imgW / (aspectRatio * 0.75)); // Room wider than zone
  } else if (aspectRatio >= 1.8) {
    imgH = Math.round(imgW / (aspectRatio * 0.7));
  } else if (aspectRatio <= 0.95) {
    // Portrait: tall canvas
    imgH = Math.round(imgW * 1.5);
  } else {
    imgH = Math.round(imgW / 1.5); // Standard 3:2 canvas
  }

  // Green zone dimensions
  const zoneW = Math.round(imgW * zonePercent / 100);
  const zoneH = Math.round(zoneW / aspectRatio);

  // Ensure zone fits in image
  const maxZoneH = Math.round(imgH * 0.7);
  const finalZoneH = Math.min(zoneH, maxZoneH);
  const finalZoneW = Math.round(finalZoneH * aspectRatio);

  const prompt = `Create a photorealistic interior photograph of a ${preset.name.toLowerCase()}.

ROOM DESCRIPTION:
${preset.description}. Shot with a Canon EOS R5, 24mm lens, f/8, from eye level. The room should look lived-in but styled, as if from an Architectural Digest photoshoot.

LIGHTING:
${preset.lighting}. No harsh shadows on the main wall.

FURNITURE & DETAILS:
${preset.furniture}. All elements should feel natural and high-end.

WALL TREATMENT:
${preset.wall}. The wall must have a prominent blank area for artwork placement.

CRITICAL — GREEN PLACEMENT ZONE:
On the main wall, place a single solid rectangle filled with EXACTLY this color: #00FF00 (pure bright green, RGB 0/255/0).

Green rectangle specifications:
- Width: approximately ${finalZoneW} pixels
- Height: approximately ${finalZoneH} pixels
- Aspect ratio: ${aspectRatio.toFixed(2)}:1 (${category} format)
- The rectangle must be PERFECTLY rectangular with sharp, crisp edges
- NO rounded corners
- NO green glow, reflection, or color spill on any surrounding surface
- NO green tint on the floor, furniture, ceiling, or any other object
- The green rectangle should look like a flat matte panel mounted on the wall
- It should be centered on the main wall, positioned at eye level

The green zone represents where fine art photography will be composited in post-production. It MUST be a clean, uniform #00FF00 with zero color bleeding.

IMAGE QUALITY:
- Photorealistic, 8K quality
- Professional interior architecture photography style
- Rich detail in textures (fabric, wood, stone, metal)
- Natural color grading (not oversaturated)
- No text, watermarks, logos, or human faces`;

  return prompt;
}

/**
 * Generate prompts for all unmatched photos (batch).
 *
 * @param {object[]} unmatchedPhotos - From getCompatibilityStats().unmatchedPhotos
 * @param {string} [defaultRoom='living-room-modern']
 * @returns {object[]} Array of { photo, prompt, suggestedRoomType }
 */
function generatePromptsForUnmatched(unmatchedPhotos, defaultRoom = 'living-room-modern') {
  // Group by aspect ratio category to avoid duplicate prompts
  const byCategory = {};

  for (const photo of unmatchedPhotos) {
    const cat = classifyAspect(photo.aspectRatio);
    if (!byCategory[cat]) {
      byCategory[cat] = {
        category: cat,
        avgAspect: 0,
        count: 0,
        photos: []
      };
    }
    byCategory[cat].count++;
    byCategory[cat].avgAspect += photo.aspectRatio;
    byCategory[cat].photos.push(photo);
  }

  const results = [];

  for (const group of Object.values(byCategory)) {
    const avgAspect = group.avgAspect / group.count;

    // Suggest room types based on aspect ratio
    let suggestedRooms;
    if (avgAspect >= 2.5) {
      suggestedRooms = ['hotel-lobby', 'gallery', 'conference-room'];
    } else if (avgAspect >= 1.8) {
      suggestedRooms = ['living-room-modern', 'living-room-luxury', 'office'];
    } else if (avgAspect <= 0.95) {
      suggestedRooms = ['hallway', 'gallery'];
    } else {
      suggestedRooms = ['bedroom', 'gallery', 'living-room-modern'];
    }

    for (const roomType of suggestedRooms) {
      results.push({
        category: group.category,
        aspectRatio: Math.round(avgAspect * 100) / 100,
        photoCount: group.count,
        samplePhotos: group.photos.slice(0, 3).map(p => p.id),
        roomType,
        roomName: ROOM_PRESETS[roomType].name,
        prompt: generateRoomPrompt({
          aspectRatio: avgAspect,
          roomType
        })
      });
    }
  }

  return results;
}

module.exports = {
  generateRoomPrompt,
  generatePromptsForUnmatched,
  ROOM_PRESETS
};
