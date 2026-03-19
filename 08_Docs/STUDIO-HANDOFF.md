# Studio Software Handoff — Image Upload Workflow Requirements
Last updated: March 19, 2026

---

## The Problem

The Studio software currently uploads images to R2 as full-resolution originals. But now we need MULTIPLE versions of each image at different resolutions, stored in different R2 prefixes, each with embedded IPTC metadata. The Studio workflow needs to generate all versions during the upload process.

---

## R2 Storage Architecture

### Bucket: `archive-35-originals`

Everything lives in ONE R2 bucket with different prefixes:

| Prefix | Purpose | Resolution | Count | Example Size |
|--------|---------|-----------|-------|--------------|
| `{collection}/` | Full originals per collection | Original (10K-30K px) | ~1,100 | 5-75 MB |
| `originals/` | Large Scale Photography originals | 20K-30K px | 165 | 18-75 MB |
| `thumbnails/` | Small previews for catalog | 800px max | 199 | 65 KB |
| `previews/` | Watermarked previews | ~1600px | 199 | 179 KB |
| `micro/web/` | Micro-license web tier delivery | 2400px max | 1,001 | 370-400 KB |
| `micro/commercial/` | Micro-license commercial delivery | 4000px max | 1,001 | 420-450 KB |

### Bucket: `archive-35-social`

| Prefix | Purpose | Resolution | Count |
|--------|---------|-----------|-------|
| `pinterest/` | Pinterest pin images | 1000x1500 | 5 |

---

## What Studio Must Generate Per Image Upload

When a photographer uploads a new image through the Studio software, the following versions must be created:

### 1. Original (existing behavior)
- Store at: `{collection}/{filename}` in R2
- Full resolution, no modifications
- This is the asset that $280+ full-license buyers receive

### 2. Thumbnail
- Store at: `thumbnails/{image_id}.jpg` in R2
- Max 800px on longest side
- JPEG quality 85
- Used by: licensing-catalog.json, dashboard, previews

### 3. Watermarked Preview
- Store at: `previews/{image_id}.jpg` in R2
- Max 1600px on longest side
- JPEG quality 85
- Light watermark: "ARCHIVE-35" bottom-right corner
- Used by: licensing page grid, micro-licensing page grid

### 4. Micro Web Version
- Store at: `micro/web/{image_id}.jpg` in R2
- Max 2400px on longest side
- JPEG quality 90
- NO watermark (this is the delivered product for $2.50 web license)
- MUST have IPTC metadata embedded (see below)

### 5. Micro Commercial Version
- Store at: `micro/commercial/{image_id}.jpg` in R2
- Max 4000px on longest side
- JPEG quality 92
- NO watermark (this is the delivered product for $5.00 commercial license)
- MUST have IPTC metadata embedded (see below)

---

## IPTC Metadata Requirements

Every micro-license version (web + commercial) MUST have these fields embedded in the JPEG:

```
IPTC:CopyrightNotice = © 2026 Wolf Schram / Archive-35. All rights reserved.
IPTC:Credit = Archive-35 / The Restless Eye
IPTC:Source = archive-35.com
IPTC:Contact = wolf@archive-35.com
IPTC:SpecialInstructions = C2PA verified authentic photography. NOT AI generated. License at archive-35.com/micro-licensing.html
XMP:Creator = Wolf Schram
XMP:Rights = © 2026 Wolf Schram / Archive-35. All rights reserved.
XMP:WebStatement = https://archive-35.com/terms.html
XMP:UsageTerms = Licensed image. Purchase at https://archive-35.com/micro-licensing.html
XMP:Marked = True
```

Thumbnails and watermarked previews should also have basic copyright embedded but don't need the full licensing metadata.

---

## Catalog Updates After Upload

After uploading all versions, Studio must update:

### 1. `data/photos.json` (gallery display)
- Add the image with: id, title, collection, filename, thumbnail path, full path, width, height, location, tags

### 2. `data/micro-licensing-catalog.json` (micro-licensing)
- Add the image with: id, title, collection, width, height, thumbnail, starting_price ($2.50), pricing (web: $2.50, commercial: $5.00), c2pa_verified: true

### 3. `data/licensing-catalog.json` (ONLY if Large Scale Photography)
- Only add if the image is from the `large-scale-photography-stitch` collection
- Include full pricing tiers ($280-$10,500)
- Classification: ULTRA if longest side >= 15,000px, PREMIUM if >= 10,000px

---

## Two-Catalog Architecture (CRITICAL)

| Catalog | File | Purpose | Images | Buyers Get |
|---------|------|---------|--------|------------|
| Full Licensing | `data/licensing-catalog.json` | Large Scale panoramas only | 160 | Original resolution |
| Micro Licensing | `data/micro-licensing-catalog.json` | ALL photos | 1,109 | Down-converted (2400px/4000px) |
| Gallery | `data/photos.json` | Website display | 1,109 | N/A (display only) |

**NEVER merge these catalogs. NEVER put standard photos in licensing-catalog.json.**

---

## Payment Flows

| Price | Payment Method | What Buyer Gets | R2 Source |
|-------|---------------|----------------|----------|
| $2.50 | Stripe or USDC (x402) | 2400px web version | `micro/web/{id}.jpg` |
| $5.00 | Stripe or USDC (x402) | 4000px commercial version | `micro/commercial/{id}.jpg` |
| $25.00 | Stripe (prepaid credits) | 10 web licenses | `micro/web/` |
| $280+ | Stripe | Full original resolution | `originals/{id}.jpg` or `{collection}/{filename}` |

---

## Known Issues / Duplicate Prefixes in R2

R2 has duplicate prefixes from early uploads (typos):
- `antilope-canyon/` (should be `antelope-canyon/`)
- `argentinna/` (should be `argentina/`)
- `death-vally/` (should be `death-valley/`)
- `iceland-ring-road/` (duplicate of `iceland/`)
- `lake-powel/` (should be `lake-powell/`)
- `monument-vally/` (should be `monument-valley/`)
- `seqoia-national-park/` (should be `sequoia-national-park/`)
- `utha-national-parks/` (should be `utah-national-parks/`)
- `flowers-and-leavs/` (should be `flowers-and-leaves/`)
- `south-america/` (possible duplicate of specific countries)
- `the-valley-of-fire/` (should be `valley-of-fire/`)
- `test/` (test uploads, can be cleaned up)

Studio should normalize collection names before uploading to prevent new duplicates.

---

## Studio Upload Workflow (Target State)

```
1. User selects image(s) in Studio
2. Studio reads EXIF for dimensions, GPS, camera info
3. Studio prompts for: title, collection, location, tags
4. Studio generates 5 versions:
   a. Original → R2 {collection}/{filename}
   b. Thumbnail (800px) → R2 thumbnails/{id}.jpg
   c. Watermarked preview (1600px) → R2 previews/{id}.jpg
   d. Micro web (2400px + IPTC) → R2 micro/web/{id}.jpg
   e. Micro commercial (4000px + IPTC) → R2 micro/commercial/{id}.jpg
5. Studio updates all 3 catalog JSON files
6. Studio triggers: sync_gallery_data.py + git push (deploys to Cloudflare)
7. Studio triggers: IndexNow ping (notifies search engines)
8. Dashboard shows new image in all sections
```

---

## Environment Variables Needed by Studio

```
R2_ACCOUNT_ID=b7491e0a2209add17e1f4307eb77c991
R2_ACCESS_KEY_ID=688524487b5a7a205127263e5747df1b
R2_SECRET_ACCESS_KEY=625c41540237360445d3114637dfeab17e2d4f3ce5b34eee2f6d671cc46a0d4c
R2_BUCKET_NAME=archive-35-originals
R2_ENDPOINT=https://b7491e0a2209add17e1f4307eb77c991.r2.cloudflarestorage.com
```
