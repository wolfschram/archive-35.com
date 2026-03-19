# FIX-ALL-METADATA — Embed IPTC rights in ALL gallery images
## Claude Code: Run this now. Every image that appears in micro-licensing must have embedded rights.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK
## After completing, run `/verify-pages` and the `verifier` agent.

---

## THE PROBLEM

Only 166 images in `09_Licensing/watermarked/` have IPTC metadata.
The micro-licensing catalog has 1,109 images that reference files in `images/` (the gallery).
Those 1,109 files have NO rights metadata. An agent downloading them gets no copyright info.

## WHAT TO DO

### Step 1: Install exiftool if not present
```bash
which exiftool || brew install exiftool
```

### Step 2: Embed IPTC/XMP in ALL gallery images

Run on every JPEG in the `images/` directory tree:

```bash
find images/ -name '*.jpg' -o -name '*.jpeg' | while read f; do
  exiftool -overwrite_original \
    -IPTC:CopyrightNotice='© 2026 Wolf Schram / Archive-35. All rights reserved.' \
    -IPTC:Credit='Archive-35 / The Restless Eye' \
    -IPTC:Source='archive-35.com' \
    -IPTC:Contact='wolf@archive-35.com' \
    -IPTC:SpecialInstructions='C2PA verified authentic photography. NOT AI generated. License at archive-35.com/micro-licensing.html' \
    -XMP:Creator='Wolf Schram' \
    -XMP:Rights='© 2026 Wolf Schram / Archive-35. All rights reserved.' \
    -XMP:WebStatement='https://archive-35.com/terms.html' \
    -XMP:UsageTerms='Licensed image. Purchase at https://archive-35.com/micro-licensing.html' \
    -XMP:Marked=True \
    "$f"
done
```

This will take a few minutes for 1,109 images.

### Step 3: Count and verify
```bash
echo 'Total JPEGs processed:'
find images/ -name '*.jpg' -o -name '*.jpeg' | wc -l

echo 'Sample verification:'
exiftool -Copyright -Credit -WebStatement images/alps/_MG_1871-thumb.jpg
```

### Step 4: Commit and deploy
```bash
python3 sync_gallery_data.py
git add images/
git commit -m '[metadata] IPTC/XMP rights embedded in all 1,109 gallery images for micro-licensing'
git push
```

### Step 5: Verify with verifier agent
Run `/verify-pages` to confirm nothing broke.
Run the `verifier` agent for full quality check.

---

# IMPORTANT: DO NOT modify data/licensing-catalog.json or data/micro-licensing-catalog.json
# This task ONLY touches image files in the images/ directory.
# The catalog files are fine — they reference these images.
