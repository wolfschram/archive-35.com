#!/usr/bin/env python3
"""
sync_gallery_data.py — Regenerate gallery.html inline photo data from photos.json

This script is called by build.sh before copying files to _site/.
It ensures gallery.html's hardcoded const G=[] array always matches
the current photos.json data.

WHY THIS EXISTS (Lesson Learned 2026-02-11):
  gallery.html uses inline JavaScript data for performance (no fetch delay).
  But when photos are ingested through Studio, only photos.json gets updated.
  gallery.html's inline data was never regenerated, causing entire collections
  to show stale/missing photos (e.g., Argentina showed 3 instead of 35).
  This script prevents that from ever happening again.
"""

import json
import re
import sys
import os


def main():
    # Paths relative to script location (repo root)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    photos_path = os.path.join(script_dir, 'data', 'photos.json')
    gallery_path = os.path.join(script_dir, 'gallery.html')

    # Load photos.json
    if not os.path.exists(photos_path):
        print(f"ERROR: {photos_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(photos_path) as f:
        data = json.load(f)
    photos = data.get('photos', data) if isinstance(data, dict) else data

    # Group by collection (preserve insertion order from photos.json)
    from collections import OrderedDict
    collections = OrderedDict()
    for p in photos:
        coll = p.get('collection')
        if coll not in collections:
            collections[coll] = {
                'name': p.get('collectionTitle', coll),
                'slug': coll,
                'photos': []
            }

        dims = p.get('dimensions', {})
        w = dims.get('width', 0)
        h = dims.get('height', 0)
        ar = round(w / h, 3) if h > 0 else 1.5  # default 3:2 if unknown

        collections[coll]['photos'].append({
            't': p.get('thumbnail', ''),
            'f': p.get('full', ''),
            'n': p.get('title', 'Untitled'),
            'ar': ar
        })

    # Build JS array string
    lines = []
    for slug, coll in collections.items():
        photo_count = len(coll['photos'])
        cover_img = coll['photos'][0]['f'] if coll['photos'] else ''

        photo_entries = []
        for ph in coll['photos']:
            title = ph['n'].replace('"', '\\"')
            photo_entries.append(
                f'    {{t:"{ph["t"]}",f:"{ph["f"]}",n:"{title}",ar:{ph["ar"]}}}'
            )

        photos_str = ',\n'.join(photo_entries)
        name = coll['name'].replace('"', '\\"')

        lines.append(
            f'  {{name:"{name}",slug:"{slug}",n:{photo_count},img:"{cover_img}",p:[\n'
            f'{photos_str}\n'
            f'  ]}}'
        )

    js_array = 'const G=[\n' + ',\n'.join(lines) + '\n];'

    # Read gallery.html
    if not os.path.exists(gallery_path):
        print(f"ERROR: {gallery_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(gallery_path, 'r') as f:
        content = f.read()

    # Find and replace const G=[...];
    pattern = r'const G=\[.*?\];'
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        print("ERROR: Could not find 'const G=[...];' in gallery.html", file=sys.stderr)
        sys.exit(1)

    new_content = content[:match.start()] + js_array + content[match.end():]

    with open(gallery_path, 'w') as f:
        f.write(new_content)

    total_photos = sum(len(c['photos']) for c in collections.values())
    print(f"[GALLERY SYNC] Regenerated: {total_photos} photos across {len(collections)} collections")


if __name__ == '__main__':
    main()
