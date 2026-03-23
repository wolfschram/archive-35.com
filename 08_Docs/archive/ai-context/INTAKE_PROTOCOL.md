# Archive-35 Photo Intake Protocol

## Overview
This document defines how new photography is processed and added to the Archive-35 website.

## Quick Commands
- "Process inbox" — Start full intake workflow
- "Show inbox" — List photos waiting in 00_Inbox/
- "Analyze [gallery]" — Run AI analysis on existing gallery
- "Rebuild site" — Regenerate website from JSON data
- "Generate hashtags for [gallery]" — Create social media hashtags

---

## Full Intake Workflow

### Step 1: Drop Zone
Place new photos in: `00_Inbox/`
- Formats: JPG, JPEG (full resolution OK)
- Any quantity
- Can be from one trip or multiple

### Step 2: Trigger Processing
Tell Claude: "Process inbox"

### Step 3: AI Analysis (Per Photo)
For each photo, extract and analyze:

**From EXIF:**
- Camera, lens, focal length
- Aperture, shutter speed, ISO
- GPS coordinates
- Date/time captured

**From AI Vision (GPT-4o):**
- Scene description (what's in the image)
- Detected objects/elements
- Mood/atmosphere
- Dominant colors
- Time of day assessment
- Weather conditions
- Suggested tags

### Step 4: Gallery Assignment
Claude asks:
- "These [N] photos appear to be from [location] taken [date range]."
- "Create new gallery or add to existing?"
- If new: "What should this gallery be called?"

### Step 5: Gallery Story Interview
For new galleries, Claude asks:
1. "One-sentence summary of this trip?"
2. "Tell me the longer story (2-3 paragraphs):"
3. "What do you want viewers to feel?"
4. "Which photo should be the cover?"

### Step 6: Photo Highlights (Optional)
Claude shows standout images and asks:
- "Any special story behind this one?"
- "Should this be featured?"

### Step 7: Processing
Claude executes:
1. Create gallery folder: `01_Portfolio/[gallery-slug]/`
2. Create subfolders: `originals/`, `web/`
3. Move originals, generate web sizes (400px thumb, 1600px full)
4. Create `_gallery.json` with metadata + story
5. Create/update `_photos.json` with all photo data
6. Update `01_Portfolio/_master.json`
7. Clear inbox

### Step 8: Website Update
Claude executes:
1. Update `04_Website/src/data/photos.json`
2. Generate/update gallery page
3. Update gallery index
4. Report: "Ready to preview and deploy"

---

## Step 9: Artelo Sync

After photos are processed and website is updated:

1. Run: `python 06_Automation/artelo_sync.py [gallery_name]`
2. Script uploads originals to Artelo
3. Creates product listings with titles, descriptions, tags
4. Updates _photos.json with artelo_url for each photo
5. Rebuild website to activate "Buy Print" buttons

### Commands
- "Sync [gallery] to Artelo" — Upload and create listings
- "Show Artelo status for [gallery]" — Check what's synced
- "Resync [photo] to Artelo" — Re-upload single photo

---

## Gallery Naming Convention
Format: `[place]-[month]-[year]`

Examples:
- `grand-teton-jan-2026`
- `iceland-westfjords-jun-2019`
- `tokyo-street-nov-2018`

## Taxonomy Assignment
Every gallery gets tagged:
- **Location:** Country → Region → Place
- **Categories:** landscape, urban, nature, travel, etc.
- **Themes:** mountain-light, moody, golden-hour, etc.
- **Moods:** serene, dramatic, majestic, etc.

## File Outputs

### _gallery.json (per gallery)
```json
{
  "id": "gallery-slug",
  "title": "Display Title",
  "story": { "short": "...", "long": "..." },
  "location": { "country": "", "region": "", "place": "" },
  "taxonomy": { "categories": [], "themes": [], "moods": [] },
  "cover_image": "filename.jpg",
  "photo_count": 0
}
```

### _photos.json (per gallery)
```json
{
  "photos": [
    {
      "id": "unique-id",
      "filename": "original.jpg",
      "title": "Display Title",
      "exif": { "camera": "", "lens": "", "settings": "" },
      "ai_analysis": { "description": "", "mood": "", "colors": [] },
      "taxonomy": { "tags": [] },
      "story": "Optional personal story",
      "buyUrl": "https://fineartamerica.com/..."
    }
  ]
}
```

---

## Manual Overrides
- Edit any JSON file directly to correct AI analysis
- Re-run "Rebuild site" after manual edits
- Use "Generate hashtags for [gallery]" anytime
