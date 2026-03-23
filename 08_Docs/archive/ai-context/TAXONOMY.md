# Archive-35 Taxonomy System

## Overview
Every photo and gallery is tagged across multiple dimensions for browsing and search.

---

## Dimension 1: Location (Required)
Hierarchical structure:
```
Country
└── Region (state/province)
    └── Place (city/park/landmark)
        └── Specific (exact spot, optional)
```

Examples:
- USA → Wyoming → Grand Teton National Park → Schwabacher Landing
- Iceland → Westfjords → Látrabjarg
- Japan → Tokyo → Shibuya → Shibuya Crossing

---

## Dimension 2: Category (Required, 1-3)
Primary content type. Pick from:
- `landscape` — Natural scenery, wide views
- `nature` — Wildlife, plants, natural details
- `urban` — Cities, architecture, street scenes
- `travel` — Culture, people, places
- `night` — Astrophotography, cityscapes after dark
- `aerial` — Drone, elevated perspectives
- `national-parks` — Protected lands, wilderness areas

---

## Dimension 3: Theme (Required, 2-5)
Artistic/visual grouping. Pick from:
- `mountain-light` — Alpine glow, peak illumination
- `moody` — Atmospheric, dramatic, stormy
- `golden-hour` — Sunrise/sunset warm light
- `blue-hour` — Pre-dawn/post-sunset cool tones
- `storm-light` — Weather drama, breaking clouds
- `reflections` — Water mirrors, symmetry
- `minimalist` — Simple compositions, negative space
- `winter` — Snow, ice, cold conditions
- `autumn` — Fall colors, harvest season
- `coastal` — Ocean, beaches, cliffs
- `forest` — Woods, trees, green
- `desert` — Arid landscapes, sand, rock

---

## Dimension 4: Mood (Required, 1-3)
Emotional quality. Pick from:
- `serene` — Peaceful, calm, quiet
- `dramatic` — Intense, powerful, striking
- `majestic` — Grand, awe-inspiring
- `contemplative` — Thoughtful, introspective
- `mysterious` — Enigmatic, foggy, hidden
- `intimate` — Close, personal, detailed
- `vast` — Expansive, endless, scale
- `energetic` — Dynamic, motion, alive

---

## Dimension 5: Technical (Auto-extracted)
From EXIF and AI:
- `type`: single, panorama, long-exposure, hdr
- `time_of_day`: sunrise, morning, midday, afternoon, golden-hour, blue-hour, night
- `season`: spring, summer, autumn, winter
- `weather`: clear, cloudy, stormy, foggy, snowy, rainy

---

## Dimension 6: Colors (AI-detected)
3-5 dominant colors per image.

---

## Hashtag Generation
Automatically generated from taxonomy:

**Always:**
#archive35 #fineartphotography

**From Location:**
#[country] #[place] — e.g., #usa #grandteton

**From Category:**
#[category]photography — e.g., #landscapephotography

**From Theme:**
#[theme] — e.g., #mountainlight #winterphotography

**From Mood:**
#[mood]vibes or #[mood]mood — e.g., #serenemoments
