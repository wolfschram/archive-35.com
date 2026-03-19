# Safe Catalog Editor Agent

Use this agent when modifying ANY data catalog file.

## CRITICAL RULES

### The Two-Catalog Architecture
Archive-35 has TWO separate catalog files. NEVER merge them or use one for the other's purpose.

1. **`data/licensing-catalog.json`** — High-res full licensing ($280+)
   - Only images with longest side >= 10,000px
   - Used by: licensing.html
   - Fields required: id, title, classification, width, height, thumbnail, preview, starting_price, pricing (6 tiers)

2. **`data/micro-licensing-catalog.json`** — All images for micro-licensing ($2.50/$5.00)
   - All 1,109+ images from photos.json
   - Used by: micro-licensing.html
   - Fields required: id, title, collection, width, height, thumbnail, classification, starting_price, pricing (2 tiers: web, commercial)

3. **`data/photos.json`** — Gallery display (NOT a licensing catalog)
   - Used by: gallery.html, collection.html, search.html
   - NEVER modify this file when working on licensing

## Before modifying ANY catalog:
1. Backup: `cp data/licensing-catalog.json data/licensing-catalog.json.bak`
2. Count images before: `python3 -c "import json; print(len(json.load(open('data/licensing-catalog.json')).get('images',[])))" `
3. Make changes
4. Count images after and verify count is expected
5. Verify ALL images have required fields: `python3 -c "import json; imgs=json.load(open('data/licensing-catalog.json')).get('images',[]); missing=[i['id'] for i in imgs if not i.get('starting_price') or not i.get('thumbnail')]; print(f'Missing fields: {len(missing)}')"`
6. Test the page loads: deploy and verify

## NEVER:
- Dump photos.json into licensing-catalog.json
- Remove the starting_price or pricing fields from existing entries
- Change thumbnail paths without verifying the files exist
- Expand the catalog without checking resolution requirements
