# Google Analytics 4 Setup Guide for Archive-35

This guide walks you through setting up Google Analytics 4 (GA4) on archive-35.com with AI agent traffic detection.

## Overview

The website is now configured with:
- **GA4 Tracking**: Comprehensive event tracking for user interactions
- **AI Agent Detection**: Automatic identification of AI crawlers vs. human visitors
- **Cloudflare Web Analytics**: Backup analytics (doesn't require JavaScript)
- **E-commerce Tracking**: Custom events for print purchases and browsing

## Step 1: Create GA4 Property

1. Go to [Google Analytics Admin](https://analytics.google.com/analytics/web/)
2. Sign in with **wolf@archive-35.com**
3. Click **Admin** (left sidebar, bottom)
4. In the **Account** column, click **Create Account**
5. Fill in:
   - Account name: `Archive-35`
   - Website URL: `https://archive-35.com`
   - Industry category: `Arts & Entertainment`
   - Business size: `Small`
6. Click **Create**
7. Accept the Google Analytics terms

## Step 2: Create GA4 Property

1. In the **Property** column, click **Create Property**
2. Fill in:
   - Property name: `Archive-35 Website`
   - Reporting time zone: `United States (Eastern)` or your timezone
   - Currency: `USD`
3. Click **Create property**
4. Choose **Web** as your platform

## Step 3: Get Your Measurement ID

1. You'll see the "Web Stream Details" page
2. Look for **Measurement ID** (format: `G-XXXXXXXXXX`)
3. Copy this ID - you'll need it in the next step

## Step 4: Update Your Website Code

The website code already has placeholder GA4 tracking code. Now you need to replace the placeholder:

1. In the root directory `/sessions/adoring-blissful-fermi/mnt/Archive-35.com/`, find all `.html` files
2. Search for `G-XXXXXXXXXX` in each file
3. Replace `G-XXXXXXXXXX` with your actual Measurement ID (the one from Step 3)

**Files to update:**
- `index.html`
- `gallery.html`
- `collection.html`
- `about.html`
- `contact.html`
- `search.html`
- `thank-you.html`
- `privacy.html`
- `terms.html`

**Quick replacement command** (from terminal in the root directory):
```bash
sed -i 's/G-XXXXXXXXXX/G-YOUR_ID_HERE/g' *.html
```

Replace `G-YOUR_ID_HERE` with your actual Measurement ID.

## Step 5: Set Up Cloudflare Web Analytics (Optional but Recommended)

Cloudflare Web Analytics provides backup traffic data without JavaScript tracking.

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your domain (archive-35.com)
3. Go to **Analytics** > **Web Analytics**
4. Click **Set up Web Analytics**
5. You'll see a **Beacon Token** (format: looks like a UUID)
6. Copy the beacon token

Then update all `.html` files:

1. Search for `CLOUDFLARE_BEACON_TOKEN` in each HTML file
2. Replace with your actual beacon token from Cloudflare

**Files to update:** (same list as above)

**Quick replacement command:**
```bash
sed -i 's/CLOUDFLARE_BEACON_TOKEN/YOUR_BEACON_TOKEN_HERE/g' *.html
```

## Step 6: Verify GA4 Installation

1. Deploy your website (push changes to production)
2. Open your website in a browser
3. Open **Chrome DevTools** (F12)
4. Go to **Console** tab
5. You should see no errors related to GA4
6. In Google Analytics, go to **Home** > **Real-time** (left sidebar)
7. Visit your website - you should see real-time traffic appear within 30 seconds

## Understanding the Analytics Data

### Visitor Type Dimension

All events are tagged with **visitor_type** and **user_agent_category**:

- **ai_agent**: AI crawlers (GPTBot, ClaudeBot, Perplexity, Cohere, etc.)
- **search_bot**: Search engine bots (Googlebot, Bingbot, Yandex, DuckDuckBot, etc.)
- **human**: Real human visitors

### Custom Events Tracked

**Gallery & Photo Interactions:**
- `view_item`: When a photo is opened in lightbox
  - Includes: photo title, view type (lightbox)

**Product & Print Interactions:**
- `select_item`: When product selector opens
- `add_to_cart`: When someone adds a print to cart
  - Includes: material type, size, frame option, price
- `begin_checkout`: When checkout is initiated
- `purchase`: When a print purchase completes
  - Includes: transaction ID, total value, items

**Collection Browsing:**
- `view_item_list`: When viewing a specific collection
  - Includes: collection name

**Custom Function:**
You can manually track events using:
```javascript
trackEvent('event_name', {
  parameter1: 'value1',
  parameter2: 'value2'
});
```

Example:
```javascript
trackEvent('contact_form_submitted', {
  form_type: 'inquiry',
  subject: 'licensing'
});
```

## Creating Custom Reports

To analyze AI vs. human traffic:

1. In Google Analytics, go to **Explore** (left sidebar)
2. Click **+ Create new exploration**
3. Choose **Free form exploration**
4. Set up:
   - **Rows**: Page location, Page title
   - **Values**: Users, Events
   - **Filters**: Add filter for `visitor_type` = `human` or `ai_agent`

This lets you compare human and AI traffic separately.

## Troubleshooting

**GA4 not showing events:**
- Wait 24-48 hours for GA4 to process initial data
- Check that your Measurement ID is correct (starts with `G-`)
- Open website in Incognito/Private mode to ensure it's a new session
- Check browser console for JavaScript errors

**Real-time data not appearing:**
- Real-time data updates every 30-60 seconds
- Make sure you're using the latest version of the deployed site
- Try visiting a different page after the initial page load

**No search bot traffic showing:**
- This is normal - search bots may be configured in robots.txt
- Check `robots.txt` to ensure bots are allowed

## Privacy & Compliance

This setup includes privacy-friendly configurations:
- `anonymize_ip`: True (removes last octet of IP address)
- `allow_google_signals`: False (no personalized ads)
- `allow_ad_personalization_signals`: False (no ad tracking)

## Files Modified

- Created: `/js/analytics.js` - Analytics configuration and custom event tracking
- Updated: All `.html` files in root directory with GA4 and Cloudflare scripts
- Updated: `build.sh` - Ensures analytics.js is included in builds

## Support

For help with:
- **GA4 Setup**: [Google Analytics Help](https://support.google.com/analytics/)
- **Cloudflare Web Analytics**: [Cloudflare Docs](https://developers.cloudflare.com/web-analytics/)
- **Custom Events**: See comments in `/js/analytics.js` for implementation details

---

**Last Updated**: 2026-02-09
