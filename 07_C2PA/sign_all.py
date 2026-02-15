#!/usr/bin/env python3
"""
Archive-35 C2PA Content Credentials Batch Signer
Signs all full-size photographs with C2PA provenance metadata.
After signing, updates each portfolio's _photos.json with c2pa: true.

Uses EC P-256 (ES256) certificate chain for signing.
"""

import c2pa
import ctypes
import json
import os
import shutil

# --- Configuration ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_BASE = os.path.dirname(SCRIPT_DIR)
IMAGES_DIR = os.path.join(ARCHIVE_BASE, 'images')
CERT_CHAIN = os.path.join(SCRIPT_DIR, 'chain.pem')
KEY_FILE = os.path.join(SCRIPT_DIR, 'signer_pkcs8.key')
PHOTOS_JSON = os.path.join(ARCHIVE_BASE, 'data', 'photos.json')
TEMP_DIR = os.path.join(SCRIPT_DIR, 'tmp')

os.makedirs(TEMP_DIR, exist_ok=True)

# Load photo metadata
with open(PHOTOS_JSON, 'r') as f:
    photos_raw = json.load(f)
    photos_data = photos_raw.get('photos', photos_raw) if isinstance(photos_raw, dict) else photos_raw

# Build lookup by filename
photo_lookup = {}
for photo in photos_data:
    full_path = photo.get('full', '')
    full_name = full_path.split('/')[-1] if full_path else ''
    if not full_name:
        full_name = photo.get('filename', '') + '-full.jpg'
    if full_name:
        photo_lookup[full_name] = photo

# Load certificate and key as bytes
with open(CERT_CHAIN, 'rb') as f:
    cert_chain = f.read()
with open(KEY_FILE, 'rb') as f:
    key_pem = f.read()

# Create signer info with NULL ta_url (no timestamp authority)
signer_info = c2pa.C2paSignerInfo.__new__(c2pa.C2paSignerInfo)
ctypes.Structure.__init__(signer_info, b'es256', cert_chain, key_pem, None)

# Find all full-size images
collections = ['grand-teton', 'iceland-ring-road', 'new-zealand', 'south-africa']
full_images = []
for collection in collections:
    collection_dir = os.path.join(IMAGES_DIR, collection)
    if os.path.isdir(collection_dir):
        for f in sorted(os.listdir(collection_dir)):
            if f.endswith('-full.jpg'):
                full_images.append(os.path.join(collection_dir, f))

print(f"Found {len(full_images)} full-size images to sign")
print(f"Certificate chain: {CERT_CHAIN}")
print(f"Algorithm: ES256 (ECDSA P-256)")
print()

signed = 0
errors = 0

for img_path in full_images:
    filename = os.path.basename(img_path)
    photo = photo_lookup.get(filename, {})

    title = photo.get('title', filename.replace('-full.jpg', ''))
    description = photo.get('description', 'Fine art photograph by Wolf')
    collection_title = photo.get('collectionTitle', 'Archive-35')
    location = photo.get('location', '')
    year = photo.get('year', '2024')
    copyright_year = int(year) if str(year).isdigit() else 2024

    # Build manifest
    creative_work = {
        "@context": "https://schema.org",
        "@type": "Photograph",
        "author": [
            {
                "@type": "Person",
                "name": "Wolf",
                "url": "https://archive-35.com"
            }
        ],
        "copyrightYear": copyright_year,
        "copyrightHolder": {
            "@type": "Person",
            "name": "Wolf"
        },
        "name": title,
        "description": description
    }

    if location:
        creative_work["locationCreated"] = {
            "@type": "Place",
            "name": location
        }

    manifest = {
        "claim_generator": "Archive-35/1.0",
        "title": title,
        "assertions": [
            {
                "label": "stds.schema-org.CreativeWork",
                "data": creative_work
            },
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.created",
                            "softwareAgent": {
                                "name": "Canon EOS",
                                "version": "1.0"
                            }
                        }
                    ]
                }
            }
        ]
    }

    try:
        builder = c2pa.Builder(manifest)
        signer = c2pa.Signer.from_info(signer_info)

        # Write to temp dir first (avoids permission issues)
        tmp_path = os.path.join(TEMP_DIR, filename)

        with open(img_path, 'rb') as source:
            with open(tmp_path, 'w+b') as dest:
                builder.sign(signer, 'image/jpeg', source, dest)

        # Copy signed file back over original
        shutil.copy2(tmp_path, img_path)
        os.remove(tmp_path)

        signed += 1
        if signed % 10 == 0 or signed == len(full_images):
            print(f"  Progress: {signed}/{len(full_images)} signed")
        else:
            print(f"  ✓ {filename}")

    except Exception as e:
        errors += 1
        print(f"  ✗ {filename} — ERROR: {e}")
        tmp_path = os.path.join(TEMP_DIR, filename)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

print()
print(f"Done! Signed: {signed}, Errors: {errors}, Total: {len(full_images)}")

if errors == 0:
    print("All images successfully signed with C2PA Content Credentials!")

# --- Update _photos.json in each portfolio folder ---
PORTFOLIO_DIR = os.path.join(ARCHIVE_BASE, '01_Portfolio')
updated_portfolios = 0

if os.path.isdir(PORTFOLIO_DIR):
    for folder in sorted(os.listdir(PORTFOLIO_DIR)):
        folder_path = os.path.join(PORTFOLIO_DIR, folder)
        photos_json_path = os.path.join(folder_path, '_photos.json')
        if not os.path.isfile(photos_json_path):
            continue
        try:
            with open(photos_json_path, 'r') as f:
                portfolio_photos = json.load(f)
            changed = False
            for p in portfolio_photos:
                if not p.get('c2pa'):
                    p['c2pa'] = True
                    changed = True
            if changed:
                with open(photos_json_path, 'w') as f:
                    json.dump(portfolio_photos, f, indent=2)
                updated_portfolios += 1
                print(f"  Updated {folder}/_photos.json — {len(portfolio_photos)} photos marked c2pa: true")
        except Exception as e:
            print(f"  ✗ Failed to update {folder}/_photos.json: {e}")

    print(f"\nUpdated {updated_portfolios} portfolio _photos.json files with c2pa flags.")
else:
    print(f"\nWarning: Portfolio directory not found at {PORTFOLIO_DIR}")
