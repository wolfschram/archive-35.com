# FIX-METADATA — Embed IPTC/XMP Rights in ALL Image Files
## Claude Code: Run this. Every image file that can be licensed must have rights metadata embedded.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK

---

## THE PROBLEM

Only 10 out of 1,109+ licensable images have XMP metadata, and it's in SIDECAR files (.xmp) — not embedded IN the JPEG. When an AI agent downloads a JPEG, it doesn't see the rights info. Google Images can't read sidecar files either. The metadata must be IN the image.

## WHAT NEEDS TO HAPPEN

### Step 1: Install piexif or use Pillow's EXIF capabilities

```bash
pip install piexif Pillow --break-system-packages
```

If piexif doesn't support IPTC/XMP, use exiftool (brew install exiftool) or the python-xmp-toolkit.

### Step 2: Create/update the embed script

File: `06_Automation/scripts/embed_iptc_metadata.py`

For EVERY JPEG in these directories:
- `09_Licensing/watermarked/` (166 files)
- `09_Licensing/micro/` (40 files currently, will grow)
- `09_Licensing/thumbnails/` (if exists)

Embed these fields INTO the JPEG:

**IPTC/XMP fields to embed:**
- **dc:creator**: Wolf Schram
- **dc:rights**: © 2026 Wolf Schram / Archive-35. All rights reserved.
- **photoshop:Credit**: Archive-35 / The Restless Eye
- **photoshop:Source**: archive-35.com
- **xmpRights:UsageTerms**: Licensed image. Purchase license at https://archive-35.com/micro-licensing.html
- **xmpRights:WebStatement**: https://archive-35.com/terms.html
- **Iptc4xmpCore:LicensorURL**: https://archive-35.com/licensing.html
- **xmpRights:Marked**: True (rights-managed)
- **photoshop:Instructions**: C2PA verified authentic photography. NOT AI generated. License required for any use beyond preview.

**The simplest approach** if piexif/Pillow can't handle IPTC:
Use `exiftool` via subprocess:

```python
import subprocess
import glob

fields = [
    '-IPTC:CopyrightNotice=© 2026 Wolf Schram / Archive-35',
    '-IPTC:Credit=Archive-35 / The Restless Eye',
    '-IPTC:Source=archive-35.com',
    '-IPTC:Contact=wolf@archive-35.com',
    '-IPTC:SpecialInstructions=C2PA verified. NOT AI generated. License required.',
    '-XMP:Creator=Wolf Schram',
    '-XMP:Rights=© 2026 Wolf Schram / Archive-35. All rights reserved.',
    '-XMP:WebStatement=https://archive-35.com/terms.html',
    '-XMP:UsageTerms=Licensed image. Terms at https://archive-35.com/terms.html',
    '-XMP:Marked=True',
]

for directory in ['09_Licensing/watermarked', '09_Licensing/micro', '09_Licensing/thumbnails']:
    for jpg in glob.glob(f'{directory}/*.jpg'):
        cmd = ['exiftool', '-overwrite_original'] + fields + [jpg]
        subprocess.run(cmd, capture_output=True)
        print(f'Embedded: {jpg}')
```

If exiftool is not installed: `brew install exiftool`

### Step 3: Verify

```bash
exiftool -IPTC:all -XMP:all 09_Licensing/watermarked/A35-20260210-0001.jpg | head -20
```

Should show: Copyright, Credit, Source, Contact, WebStatement, UsageTerms, Marked, SpecialInstructions.

### Step 4: Also run on gallery images

The gallery photos in `images/` that are served on the website should also have basic copyright metadata. At minimum:
- Copyright notice
- Creator name
- Web statement URL

### Step 5: Commit

```bash
git add 09_Licensing/
git commit -m "[metadata] IPTC/XMP rights embedded in all licensing images"
git push
```

---

## IMPORTANT: Do NOT create sidecar .xmp files

The previous approach created separate .xmp files. These are useless for agents and Google Images — the metadata must be IN the JPEG file itself.

Delete any orphan .xmp sidecar files after embedding metadata into the JPEGs.

---

# TEST: Every JPEG in 09_Licensing/ must pass this check:
```bash
exiftool -Copyright -Credit -WebStatement 09_Licensing/watermarked/A35-20260210-0001.jpg
# Must show all three fields
```
