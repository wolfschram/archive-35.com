# Archive-35: Photo-to-Order Workflow

**Complete workflow from photo ingestion to customer delivery**

---

## Overview

```
[Photo] → [Studio App] → [Website + Stripe] → [Customer Purchase] → [Pictorem] → [Delivery]
```

---

## 1. Photo Ingestion (Studio App)

### Location
- App: `05_Studio/app/`
- Entry point: `src/pages/ContentIngest.js`

### Process
1. **Select Source**: File or folder of photos
2. **Select Portfolio**: New or existing collection
3. **Processing Steps**:
   - EXIF extraction (date, camera, GPS)
   - AI description generation
   - Web resize (optimized versions)
   - Gallery file generation

### Output Files
| Type | Location | Purpose |
|------|----------|---------|
| Originals | `01_Portfolio/{Gallery}/originals/` | High-res masters (3-6MB) |
| Web | `01_Portfolio/{Gallery}/web/` | Optimized for website (~500KB) |
| photos.json | `04_Website/dist/data/photos.json` | Website catalog |

### Current Data
- 28 photos in `Grand_Teton` collection
- photos.json fields: `id`, `filename`, `title`, `collection`, `tags`, `location`, `buyUrl`, `thumbnail`, `full`

---

## 2. Image Storage Strategy

### Problem
High-res originals (3-6MB each) needed for Pictorem orders but:
- Can't store in GitHub (file size limits)
- Local storage = dependency on your computer
- Need accessible URLs for Pictorem API

### Recommended Solution: GitHub + Cloud Hybrid

| Image Type | Storage | Access |
|------------|---------|--------|
| Web versions | GitHub Pages | `https://archive-35.com/photos/...` |
| Originals | Cloud (Cloudflare R2 or Backblaze B2) | Private URL with signed access |

### Option A: Cloudflare R2 (Recommended)
- **Free tier**: 10GB storage, 10M requests/month
- **Cost**: $0.015/GB/month beyond free tier
- **Setup**: Create bucket, upload originals, generate presigned URLs
- **Benefits**: Fast CDN, S3-compatible API

### Option B: Backblaze B2
- **Free tier**: 10GB storage
- **Cost**: $0.005/GB/month
- **Setup**: Similar to S3

### Option C: Keep Local (Current)
- Store originals on your Mac
- Manual lookup when orders come in
- **Risk**: Dependent on local machine

### Implementation Plan
1. Create cloud bucket for originals
2. Add `original_url` field to photos.json
3. Update Studio app to upload originals on import
4. Pictorem orders use cloud URLs

---

## 3. Stripe Product Setup

### Current Status
- ✅ Account created (acct_1SxIaWIyLqYsy9lv)
- ✅ API keys in .env
- ✅ ~140 products created (28 photos × 5 materials)
- ⏳ Payment links not created
- ⏳ stripe-links.js not exported

### Script Location
`06_Automation/scripts/stripe_setup.py`

### Commands
```bash
# Test connection
python stripe_setup.py --test

# Create products (already done)
python stripe_setup.py --create-products

# Fetch existing products from Stripe
python stripe_setup.py --fetch

# Create payment links
python stripe_setup.py --create-links

# Export for website
python stripe_setup.py --export
```

### Data Flow
```
photos.json → stripe_setup.py → Stripe API
                    ↓
           stripe_products.json (product IDs)
                    ↓
           stripe_payment_links.json (URLs)
                    ↓
           js/stripe-links.js (website export)
```

---

## 4. Website Purchase Flow

### Customer Journey
1. Browse gallery → Click photo
2. Product selector opens → Choose material + size
3. See price (2.5× wholesale) → Check terms box
4. Click "Complete Purchase" → Redirect to Stripe
5. Stripe Checkout → Enter shipping + payment
6. Success → Redirect to thank-you.html

### Files
| File | Purpose |
|------|---------|
| `js/product-selector.js` | UI logic, pricing, Stripe links |
| `css/product-selector.css` | Modal styling |
| `js/stripe-links.js` | Payment link lookup (auto-generated) |
| `thank-you.html` | Post-purchase confirmation |

### Integration Points
- Product selector needs `STRIPE_LINKS` object from stripe-links.js
- Each photo ID maps to: `STRIPE_LINKS[photoId][material][size]` → URL

---

## 5. Order Notification

### When Customer Pays
1. Stripe sends email notification to wolfbroadcast@gmail.com
2. Email contains: Customer name, shipping address, product details
3. View in Stripe Dashboard: https://dashboard.stripe.com/payments

### Future Enhancement: Webhook
Set up Stripe webhook to:
- Receive payment notifications
- Auto-generate Pictorem order
- Send confirmation email

---

## 6. Pictorem Order Fulfillment

### Manual Process (Current)
1. Receive Stripe payment notification
2. Note: Photo ID, material, size, customer shipping address
3. Get high-res image URL (from cloud or local)
4. Run Pictorem order script
5. Receive Pictorem confirmation
6. Track shipping

### Script Location
`06_Automation/scripts/pictorem_api.py`

### Order Submission
```python
from pictorem_api import PictoremAPI

api = PictoremAPI()

# Build product code
code = api.build_from_preset(
    preset='canvas_rolled',  # or 'metal_single', 'acrylic', etc.
    size='24x16',
    orientation='horizontal'
)

# Submit order
result = api.send_order(
    image_url='https://storage.archive-35.com/originals/GT001.jpg',
    code=code,
    recipient={
        'name': 'Customer Name',
        'address': '123 Main St',
        'city': 'Denver',
        'state': 'CO',
        'zip': '80202',
        'country': 'US'
    }
)
```

### Product Code Reference
| Material | Preset | Pictorem Code Pattern |
|----------|--------|----------------------|
| Canvas Gallery Wrap | `canvas_wrap` | CW-{size}-M-HQ-10-CO-0-0-NO |
| Canvas Rolled | `canvas_rolled` | CR-{size}-M-HQ-0-0-0-0-NO |
| Metal | `metal_single` | AP-{size}-ME1P-SEMI-FM-0-0-0-NO |
| Acrylic | `acrylic` | AP-{size}-ACR-GLOSS-FM-0-0-0-NO |
| Paper | `paper` | PP-{size}-HRAP-NA-0-0-0-NO |
| Wood | `wood` | AP-{size}-WP-SEMI-SM-0-0-0-NO |

---

## 7. Adding New Photos Checklist

### Required Steps
- [ ] Run photo through Studio app (or manual process)
- [ ] Verify files created:
  - [ ] `01_Portfolio/{Gallery}/originals/{filename}.jpg`
  - [ ] `01_Portfolio/{Gallery}/web/{filename}.jpg`
  - [ ] Entry in `04_Website/dist/data/photos.json`
- [ ] Upload original to cloud storage (if using)
- [ ] Run `stripe_setup.py --create-products` (for new photos only)
- [ ] Run `stripe_setup.py --create-links`
- [ ] Run `stripe_setup.py --export`
- [ ] Commit and push to GitHub
- [ ] Verify live at archive-35.com

### photos.json Entry Format
```json
{
  "id": "GT029",
  "filename": "new_photo.jpg",
  "title": "Photo Title",
  "collection": "Grand_Teton",
  "category": "Landscapes",
  "tags": ["mountains", "sunrise"],
  "location": "Grand Teton National Park, Wyoming",
  "date": "2024-07-15",
  "buyUrl": "",
  "thumbnail": "photos/grand_teton/new_photo_thumb.jpg",
  "full": "photos/grand_teton/new_photo.jpg"
}
```

---

## 8. Profit Calculation

### Pricing Formula
```
Retail = Wholesale × 2.5
```

### Example: 24x16 Canvas
| Item | Amount |
|------|--------|
| Retail Price | $190.00 |
| Stripe Fee (2.9% + $0.30) | -$5.81 |
| Net from Stripe | $184.19 |
| Pictorem Wholesale | -$76.00 |
| **Your Profit** | **$108.19** |
| Margin | 57% |

---

## 9. Immediate Action Items

### From Your Mac Terminal:
```bash
cd ~/Downloads/Archive-35.com

# 1. Fetch existing Stripe products
python 06_Automation/scripts/stripe_setup.py --fetch

# 2. Create payment links
python 06_Automation/scripts/stripe_setup.py --create-links

# 3. Export for website
python 06_Automation/scripts/stripe_setup.py --export

# 4. Push to GitHub
git add -A
git commit -m "Add Pictorem + Stripe integration, product selector, legal pages"
git push origin main
```

### In Stripe Dashboard:
1. Go to Settings > Public details
2. Add Terms URL: `https://archive-35.com/terms.html`
3. Add Privacy URL: `https://archive-35.com/privacy.html`

---

## 10. File Locations Summary

| Purpose | Path |
|---------|------|
| Environment variables | `.env` |
| Pictorem API | `06_Automation/scripts/pictorem_api.py` |
| Stripe setup | `06_Automation/scripts/stripe_setup.py` |
| Product selector JS | `04_Website/dist/js/product-selector.js` |
| Product selector CSS | `04_Website/dist/css/product-selector.css` |
| Stripe links export | `04_Website/dist/js/stripe-links.js` |
| Photo catalog | `04_Website/dist/data/photos.json` |
| Thank you page | `04_Website/dist/thank-you.html` |
| Terms of Sale | `04_Website/dist/terms.html` |
| Privacy Policy | `04_Website/dist/privacy.html` |
| Credential docs | `08_Docs/credentials/` |

---

*Last updated: February 5, 2026*
