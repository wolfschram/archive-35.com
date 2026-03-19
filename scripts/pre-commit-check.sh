#!/bin/bash
# Pre-commit safety check for archive-35
# Prevents common mistakes that break the live site

ERRORS=0

# Check 1: No secrets in staged files
if git diff --cached | grep -qi 'sk_live_\|ICLOUD_APP_PASSWORD\|GMAIL_APP_PASSWORD\|ARCHIVE35_APP_PASSWORD'; then
  echo 'ERROR: Possible credentials in staged files!'
  ERRORS=$((ERRORS+1))
fi

# Check 2: licensing-catalog.json has valid structure
if git diff --cached --name-only | grep -q 'licensing-catalog.json'; then
  python3 -c "
import json
data = json.load(open('data/licensing-catalog.json'))
imgs = data.get('images', data) if isinstance(data, dict) else data
missing = [i.get('id','?') for i in imgs if not i.get('starting_price') or not i.get('thumbnail')]
if missing:
    print(f'ERROR: {len(missing)} images missing price/thumbnail in licensing-catalog.json')
    exit(1)
print(f'OK: {len(imgs)} images, all have price and thumbnail')
" || ERRORS=$((ERRORS+1))
fi

# Check 3: micro-licensing-catalog.json has valid structure
if git diff --cached --name-only | grep -q 'micro-licensing-catalog.json'; then
  python3 -c "
import json
data = json.load(open('data/micro-licensing-catalog.json'))
imgs = data.get('images', data) if isinstance(data, dict) else data
missing = [i.get('id','?') for i in imgs if not i.get('thumbnail')]
if missing:
    print(f'ERROR: {len(missing)} images missing thumbnail in micro-licensing-catalog.json')
    exit(1)
print(f'OK: {len(imgs)} images, all have thumbnails')
" || ERRORS=$((ERRORS+1))
fi

# Check 4: sync_gallery_data.py was run (if HTML changed)
if git diff --cached --name-only | grep -qE '\.(html|json)$'; then
  echo 'NOTE: HTML/JSON changed — ensure sync_gallery_data.py was run'
fi

if [ $ERRORS -gt 0 ]; then
  echo "$ERRORS pre-commit errors found. Fix them before committing."
  exit 1
fi

echo 'Pre-commit checks passed.'
exit 0
