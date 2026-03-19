# MICRO-DELIVERY — Generate and deploy down-converted images for micro-licensing
## Claude Code: This is a focused task. Build it, test it, verify it. Use /verify-pages and the verifier agent when done.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK
## After completing, run /verify-pages and the verifier agent.

---

## THE PROBLEM

When someone buys a $2.50 micro-license, the download endpoint (functions/api/micro-license/download.js) looks up the image in the R2 originals bucket and serves the FULL RESOLUTION file. That means a $2.50 buyer gets the same 20,000px image that a $280 buyer gets. That's broken.

## THE FIX

### Step 1: Generate down-converted versions

Create a script: `06_Automation/scripts/generate_micro_versions.py`

For every image referenced in `data/micro-licensing-catalog.json` (1,109 images):

1. Find the source image:
   - Check `images/{collection}/{filename}` (gallery thumbnails — already exist)
   - Check `01_Portfolio/{Collection}/web/{filename}` (web exports)
   - Check `09_Licensing/watermarked/{id}.jpg` (watermarked versions)

2. Generate two versions:
   - **web**: Max 2400px on longest side, JPEG quality 90, strip EXIF GPS data, keep copyright IPTC
   - **commercial**: Max 4000px on longest side, JPEG quality 92, strip EXIF GPS data, keep copyright IPTC

3. Save to: `09_Licensing/micro_delivery/web/{image_id}.jpg` and `09_Licensing/micro_delivery/commercial/{image_id}.jpg`

4. Apply watermark to web versions (light, bottom-right corner: "archive-35.com")

Use Pillow for resizing. Use the existing IPTC embedding approach for metadata.

### Step 2: Upload to R2

Upload the micro_delivery folder to a new R2 prefix (or the existing `archive-35-social` bucket):

```python
import boto3

r2 = boto3.client('s3',
    endpoint_url='https://b7491e0a2209add17e1f4307eb77c991.r2.cloudflarestorage.com',
    aws_access_key_id='688524487b5a7a205127263e5747df1b',
    aws_secret_access_key='625c41540237360445d3114637dfeab17e2d4f3ce5b34eee2f6d671cc46a0d4c',
    region_name='auto'
)

# Upload web versions
for f in glob.glob('09_Licensing/micro_delivery/web/*.jpg'):
    key = f'micro/web/{Path(f).name}'
    r2.upload_file(f, 'archive-35-originals', key, ExtraArgs={'ContentType': 'image/jpeg'})

# Upload commercial versions
for f in glob.glob('09_Licensing/micro_delivery/commercial/*.jpg'):
    key = f'micro/commercial/{Path(f).name}'
    r2.upload_file(f, 'archive-35-originals', key, ExtraArgs={'ContentType': 'image/jpeg'})
```

### Step 3: Update download.js to serve micro versions

In `functions/api/micro-license/download.js`:

When generating the signed download URL, use the micro prefix instead of the originals:

```javascript
// Current (WRONG — serves full resolution):
const key = `originals/${filename}`;

// Fixed (serves down-converted version):
const tier = session.metadata?.licenseTier || 'web';
const key = `micro/${tier}/${imageId}.jpg`;
```

This way:
- Web tier ($2.50) → downloads from `micro/web/{id}.jpg` (max 2400px)
- Commercial tier ($5.00) → downloads from `micro/commercial/{id}.jpg` (max 4000px)
- Full license ($280+) → still downloads from `originals/{filename}` (full resolution)

### Step 4: Update [image_id].js x402 delivery

The x402 endpoint (`functions/api/license/[image_id].js`) also needs to serve micro versions when payment is verified:

```javascript
// After payment verification:
const tier = requestedTier; // 'web' or 'commercial'
const downloadKey = `micro/${tier}/${imageId}.jpg`;
// Generate signed URL for this key, not the original
```

### Step 5: Verify the gallery license button

The gallery's "License" button on individual photos should:
- Link to licensing.html (full license at $280+) for Large Scale Photography
- Link to micro-licensing.html for standard gallery photos

Check what `data/photos.json` uses for the `buyUrl` or license link. Make sure it points to the right page.

### Step 6: Test the full purchase flow

1. Go to micro-licensing.html
2. Click "WEB $2.50" on any image
3. Verify it creates a Stripe checkout session
4. After payment (use test mode), verify the download URL serves a 2400px image, NOT the full resolution

```bash
# Check download endpoint
curl -s 'https://archive-35.com/api/micro-license/download?session_id=test' | python3 -m json.tool
```

---

## IMPORTANT RULES

1. DO NOT modify `data/licensing-catalog.json` — that's for full licensing only (160 Large Scale images)
2. DO NOT modify `data/micro-licensing-catalog.json` — it's correctly set up
3. DO NOT upload full-resolution originals to the micro delivery prefix
4. The micro delivery images must be SMALLER than the originals — that's the whole point
5. Run /verify-pages after deployment to confirm nothing broke

---

## DONE CRITERIA

- [ ] 2,218 micro delivery images generated (1,109 × 2 tiers)
- [ ] Uploaded to R2 under micro/web/ and micro/commercial/ prefixes
- [ ] download.js serves micro versions for $2.50/$5.00 purchases
- [ ] [image_id].js serves micro versions after x402 payment
- [ ] Full license checkout still serves originals
- [ ] Gallery license buttons point to correct pages
