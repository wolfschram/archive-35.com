# Archive-35: Complete Workflow Checklist

**Pre-launch verification for the full photo-to-purchase pipeline**

---

## A. ONE-TIME SETUP (Do Once)

### GitHub Pages
- [ ] Go to https://github.com/wolfschram/Archive-35/settings/pages
- [ ] Source: Select **"GitHub Actions"**
- [ ] Custom domain: `archive-35.com` (if using)
- [ ] Enforce HTTPS: ✓

### Stripe Dashboard
- [ ] Business details complete
- [ ] Bank account connected
- [ ] Terms URL: `https://archive-35.com/terms.html`
- [ ] Privacy URL: `https://archive-35.com/privacy.html`
- [ ] Email receipts enabled: Settings → Customer emails
- [ ] Shipping address collection: Enabled in Payment Links

### Domain (if using custom)
- [ ] DNS pointing to GitHub Pages
- [ ] SSL certificate active

---

## B. ADDING NEW PHOTOS WORKFLOW

### Step 1: Export from Lightroom/Editor
- [ ] Export to `Photography/{Collection Name}/` folder
- [ ] High-res JPG (3000-6000px long edge)
- [ ] Quality 85-95%

### Step 2: Import via Studio App
- [ ] Open Studio → Content Ingestion
- [ ] Select folder from Photography/
- [ ] Create new portfolio or add to existing
- [ ] Click "Analyze Photos"

### Step 3: REVIEW METADATA (CRITICAL!)
- [ ] ⚠️ **Verify Time of Day** (AI gets sunrise/sunset wrong!)
- [ ] Check/edit titles
- [ ] Check/edit locations
- [ ] Add relevant tags
- [ ] Approve each photo

### Step 4: Finalize Import
- [ ] Studio creates:
  - `/01_Portfolio/{Gallery}/originals/` (full res)
  - `/01_Portfolio/{Gallery}/web/` (optimized)
  - Updates `photos.json`
  - Updates `_gallery.json`

### Step 5: Create Stripe Products
```bash
cd ~/Downloads/Archive-35.com/06_Automation/scripts
python3 stripe_setup.py --create-products   # Only for NEW photos
python3 stripe_setup.py --create-links
python3 stripe_setup.py --export
```

### Step 6: Push to GitHub
```bash
cd ~/Downloads/Archive-35.com
git add -A
git commit -m "Add {Collection} photos"
git push origin main
```

### Step 7: Verify
- [ ] Visit archive-35.com
- [ ] Check new photos appear
- [ ] Click "Buy Print" → Opens product selector
- [ ] Select material/size → Stripe checkout opens
- [ ] (Optional) Do a test purchase

---

## C. CUSTOMER PURCHASE FLOW

### What Customer Sees:
1. **Browse** → gallery.html
2. **Click photo** → Lightbox opens
3. **Click "Order Print"** → Product selector modal
4. **Select material + size** → See price (2.5× wholesale)
5. **Check terms box** → Required
6. **Click "Complete Purchase"** → Redirect to Stripe
7. **Stripe Checkout** → Enter shipping + payment
8. **Payment success** → Redirect to thank-you.html
9. **Receive email** → Stripe sends receipt

### What You Do:
1. **Receive notification** → Stripe email + dashboard
2. **Note order details** → Photo, material, size, shipping address
3. **Submit to Pictorem** → Run submit_order.py or manually
4. **Pictorem ships** → Direct to customer (white-label)
5. **Customer gets tracking** → From Pictorem

---

## D. PICTOREM PROCESS (Print Fulfillment)

### How It Works:
- You have a **wholesale account** with Pictorem
- Customer pays YOU (via Stripe)
- You order from Pictorem at wholesale price
- Pictorem ships directly to customer
- **Customer never creates a Pictorem account**
- Pictorem sends tracking info to the shipping email

### Your Profit:
```
Customer pays: $190 (2.5× markup)
Stripe fee:    -$5.81 (2.9% + $0.30)
Pictorem cost: -$76 (wholesale)
Your profit:   $108.19 (~57% margin)
```

### Lead Times:
- Canvas: 5-7 business days
- Metal/Acrylic/Wood: 10-14 business days
- Paper: 5-7 business days
- Shipping: +3-7 days (US/Canada)

---

## E. REFUNDS & CANCELLATIONS

### Policy (in terms.html):
- **All sales final** - custom/made-to-order products
- **No cancellations** once order submitted to printer
- **Damaged in shipping** → Replacement at no cost (must report within 48 hours with photos)
- **Color variance** → Not grounds for return (stated in terms)

### If Customer Wants Refund:
1. Check if order already submitted to Pictorem
2. **Before production**: Can cancel, issue full Stripe refund
3. **After production**: Explain policy, no refund possible
4. **Damage claim**: Get photos, contact Pictorem, arrange replacement

### Stripe Refund Process:
1. Dashboard → Payments → Find transaction
2. Click "Refund" → Full or partial
3. Customer receives refund in 5-10 business days

---

## F. EMAIL COLLECTION & NEWSLETTER

### Stripe Collects:
- ✅ Email (required for checkout)
- ✅ Name
- ✅ Shipping address
- ✅ Phone (if enabled)

### To Export Customer Data:
1. Stripe Dashboard → Customers
2. Export to CSV
3. Or use Stripe API

### Newsletter Setup (Future):
- Options: Mailchimp, ConvertKit, Buttondown
- Import Stripe customer emails
- Comply with CAN-SPAM (unsubscribe link required)

---

## G. STRIPE SETTINGS TO VERIFY

Go to: https://dashboard.stripe.com/settings

### Business Settings:
- [ ] Legal business name correct
- [ ] Support email set
- [ ] Statement descriptor: "ARCHIVE-35" (what shows on bank statement)

### Customer Emails:
- [ ] Successful payments: ON
- [ ] Refunds: ON

### Branding:
- [ ] Logo uploaded
- [ ] Brand color set
- [ ] Checkout matches site

### Payment Links:
- [ ] Shipping address: Required
- [ ] Billing address: Required
- [ ] Phone: Optional but recommended

---

## H. DEPENDENCIES & CONNECTIONS

```
Photography/           → Export destination
    ↓
Studio App (Import)    → Analyze + Review
    ↓
01_Portfolio/         → Originals + Web versions
    ↓
04_Website/dist/      → photos.json, images
    ↓
stripe_setup.py       → Products + Payment Links
    ↓
GitHub                → Host website
    ↓
archive-35.com        → Live site
    ↓
Customer clicks Buy   → Stripe checkout
    ↓
Payment succeeds      → Email notification
    ↓
submit_order.py       → Pictorem order
    ↓
Pictorem ships        → Customer receives print
```

---

## I. QUICK COMMANDS REFERENCE

```bash
# Stripe: Create products for new photos
python3 06_Automation/scripts/stripe_setup.py --create-products

# Stripe: Create payment links
python3 06_Automation/scripts/stripe_setup.py --create-links

# Stripe: Export for website
python3 06_Automation/scripts/stripe_setup.py --export

# Submit order to Pictorem
python3 06_Automation/scripts/submit_order.py

# Push to GitHub
git add -A && git commit -m "Update" && git push origin main
```

---

*Last updated: February 5, 2026*
