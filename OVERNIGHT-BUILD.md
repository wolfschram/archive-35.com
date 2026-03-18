# OVERNIGHT BUILD — Archive 35 Full Automation Suite
## Claude Code: Read this top to bottom. Build everything. Test everything. Do not stop until done.
## Owner: Wolf Schram | Started: March 17, 2026 evening

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK

**You have ALL permissions. Wolf is asleep. There is no one to ask.**

- Do NOT stop to ask for permission at any point
- Do NOT pause and wait for human confirmation
- Do NOT skip a task because you're "unsure" — figure it out and build it
- If a dependency is missing, install it
- If a file doesn't exist, create it
- If an API key is missing, create the framework with a clear .env variable name and move on
- If a test fails, fix it and re-run
- If something conflicts, use your best judgment — Wolf trusts you
- Log every decision you make to `Archive 35 Agent/data/build_log.json` so Wolf can review in the morning
- The ONLY things you must NOT do are in the NEVER list below
- Everything else: just do it. Build it. Ship it. Move on.

**Build log format** (append each entry):
```json
{"timestamp": "ISO8601", "task": "Task N", "action": "what you did", "decision": "why", "result": "success/failed/skipped"}
```

---

## RULES BEFORE YOU TOUCH ANYTHING

1. Read CLAUDE.md first (you probably already have)
2. NEVER change Stripe keys or webhook endpoints
3. NEVER deploy without running `python3 sync_gallery_data.py` first
4. NEVER use port 3000 (job-pipeline owns it)
5. Agent API = port 8035, Mockup = port 8036, Studio = port 3001
6. Any change to shared data files = test Studio + Agent + Mockup
7. Website deploys via: `python3 sync_gallery_data.py && git add . && git commit -m "..." && git push`
8. Cloudflare auto-deploys from main branch
9. The .cfignore file controls what gets deployed. Only root-level HTML, css/, js/, images/, data/, functions/ get deployed
10. DO NOT break the live Etsy store, the live website, or the live Stripe checkout

## PROJECT ROOT
```
~/Documents/ACTIVE/archive-35/
```

## EXISTING INFRASTRUCTURE YOU MUST NOT BREAK
- 87+ live Etsy listings (Claude Code may be updating pricing — coordinate)
- archive-35.com serving: index, gallery, licensing (166 images), hospitality, about, contact, search, agent-dashboard
- Stripe checkout flow (functions/api/create-checkout-session.js, functions/api/stripe-webhook.js)
- x402 gallery (functions/api/license/gallery.js) with agent request logging
- Agent API (Archive 35 Agent/src/api.py) on port 8035
- Instagram agent, Etsy agent, content agent (Archive 35 Agent/src/agents/)

---

# TASK 1: INDEXNOW INTEGRATION + GITHUB ACTION
**Priority:** CRITICAL — Gets archive-35.com discovered by ChatGPT/Bing/Perplexity
**Estimated time:** 1-2 hours
**Dependencies:** None

## What IndexNow Does
IndexNow is a protocol that lets you PUSH URLs to Bing (which powers ChatGPT search, Copilot, DuckDuckGo, Ecosia) instead of waiting to be crawled. When you ping IndexNow, Bing crawls your pages within minutes.

## Step 1: Generate an IndexNow API Key
Create a random 32-character hex string as the key.

## Step 2: Create the Key File
Create a file at the repo root named `{key}.txt` containing just the key itself. This file gets deployed to archive-35.com/{key}.txt for verification.

File: `~/Documents/ACTIVE/archive-35/{generated-key}.txt`
Content: just the key string

## Step 3: Create the IndexNow Ping Script

File: `~/Documents/ACTIVE/archive-35/06_Automation/scripts/indexnow_ping.py`

```python
#!/usr/bin/env python3
"""
IndexNow URL Submission for archive-35.com
Pings Bing/Yandex/IndexNow API to request immediate crawling.
Run after every deploy or content update.
"""
import requests
import json
import sys

INDEXNOW_KEY = "YOUR_GENERATED_KEY_HERE"  # Replace with actual key
HOST = "archive-35.com"
KEY_LOCATION = f"https://{HOST}/{INDEXNOW_KEY}.txt"

# All pages that should be indexed
URLS = [
    f"https://{HOST}/",
    f"https://{HOST}/gallery.html",
    f"https://{HOST}/licensing.html",
    f"https://{HOST}/hospitality.html",
    f"https://{HOST}/about.html",
    f"https://{HOST}/contact.html",
    f"https://{HOST}/search.html",
    f"https://{HOST}/collection.html",
    f"https://{HOST}/llms.txt",
    f"https://{HOST}/llms-full.txt",
    f"https://{HOST}/data/photos.json",
    f"https://{HOST}/data/licensing-catalog.json",
    f"https://{HOST}/data/product-catalog.json",
    f"https://{HOST}/sitemap.xml",
    f"https://{HOST}/terms.html",
    f"https://{HOST}/privacy.html",
]

def submit_urls():
    payload = {
        "host": HOST,
        "key": INDEXNOW_KEY,
        "keyLocation": KEY_LOCATION,
        "urlList": URLS
    }

    endpoints = [
        "https://api.indexnow.org/indexnow",
        "https://www.bing.com/indexnow",
        "https://yandex.com/indexnow",
    ]

    for endpoint in endpoints:
        try:
            r = requests.post(endpoint, json=payload, headers={"Content-Type": "application/json"})
            print(f"[IndexNow] {endpoint}: {r.status_code}")
            if r.status_code in (200, 202):
                print(f"  ✓ Submitted {len(URLS)} URLs successfully")
            else:
                print(f"  ✗ Response: {r.text[:200]}")
        except Exception as e:
            print(f"  ✗ Error: {e}")

if __name__ == "__main__":
    submit_urls()
```

## Step 4: Create GitHub Action for Auto-Ping on Deploy

File: `~/Documents/ACTIVE/archive-35/.github/workflows/indexnow.yml`

```yaml
name: IndexNow Ping
on:
  push:
    branches: [main]
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install requests
      - run: python 06_Automation/scripts/indexnow_ping.py
```

## Step 5: Test
- Run `python3 06_Automation/scripts/indexnow_ping.py` locally
- Verify it returns 200 or 202 from at least one endpoint
- The key file must be accessible at `https://archive-35.com/{key}.txt` after deploy

## Done Criteria
- [ ] Key file exists at repo root
- [ ] indexnow_ping.py runs without errors
- [ ] GitHub Action workflow file exists
- [ ] Script submitted to at least one IndexNow endpoint successfully
- [ ] Run sync_gallery_data.py, commit, and push to deploy

---

# TASK 2: SCHEMA.ORG STRUCTURED DATA ON ALL HTML PAGES
**Priority:** CRITICAL — Makes every page machine-readable for AI agents
**Estimated time:** 2-3 hours
**Dependencies:** None

## What This Does
Adds JSON-LD structured data to every HTML page so Google, Bing, and AI crawlers understand the content semantically. This directly improves visibility in AI search results.

## Step 1: Create a Schema Template Generator

File: `~/Documents/ACTIVE/archive-35/06_Automation/scripts/inject_schema.py`

This script reads each HTML file and injects the appropriate JSON-LD schema in the `<head>` section. DO NOT modify pages that already have JSON-LD (check first).

### Schema Types by Page

**index.html** — Organization + WebSite + ImageGallery
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Archive-35",
  "alternateName": "The Restless Eye",
  "url": "https://archive-35.com",
  "logo": "https://archive-35.com/images/logo.png",
  "description": "Fine art landscape and wildlife photography by Wolf Schram. Museum-quality prints and commercial licensing. 25 years, 55+ countries. C2PA verified authentic photography.",
  "founder": {
    "@type": "Person",
    "name": "Wolf Schram",
    "jobTitle": "Photographer",
    "url": "https://archive-35.com/about.html"
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "email": "wolf@archive-35.com",
    "contactType": "sales"
  },
  "sameAs": [
    "https://www.etsy.com/shop/Archive35Photo"
  ]
}
```

**licensing.html** — CollectionPage + individual ImageObject entries
```json
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "License Photography | Archive-35",
  "description": "License ultra-high-resolution fine art photography. 166 images, up to 40,000px originals. C2PA verified. Commercial, editorial, and hospitality licensing.",
  "url": "https://archive-35.com/licensing.html",
  "numberOfItems": 166,
  "offers": {
    "@type": "AggregateOffer",
    "lowPrice": "280",
    "highPrice": "10500",
    "priceCurrency": "USD",
    "offerCount": 166
  }
}
```

**hospitality.html** — Service schema
```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "Archive-35 Hospitality Art Programs",
  "description": "Art programs for hotels, resorts, restaurants, and commercial interiors. Statement pieces, guest room programs, and custom commissions. Source files up to 40,000 pixels wide.",
  "provider": {
    "@type": "Organization",
    "name": "Archive-35"
  },
  "url": "https://archive-35.com/hospitality.html",
  "areaServed": "Worldwide"
}
```

**gallery.html** — ImageGallery schema
```json
{
  "@context": "https://schema.org",
  "@type": "ImageGallery",
  "name": "Archive-35 Gallery",
  "description": "Fine art photography collection. Landscape, wildlife, and nature photography from 55+ countries.",
  "url": "https://archive-35.com/gallery.html",
  "creator": {
    "@type": "Person",
    "name": "Wolf Schram"
  }
}
```

**about.html** — Person schema for Wolf
```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Wolf Schram",
  "jobTitle": "Fine Art Photographer",
  "description": "Fine art landscape and wildlife photographer with 25 years of experience across 55+ countries. C2PA verified authentic photography.",
  "url": "https://archive-35.com/about.html",
  "worksFor": {
    "@type": "Organization",
    "name": "Archive-35"
  }
}
```

## Step 2: Implementation

The script should:
1. Read each HTML file
2. Check if JSON-LD already exists (search for `application/ld+json`)
3. If not present, inject the appropriate schema `<script type="application/ld+json">` before `</head>`
4. Write the modified file back
5. Do NOT change any other part of the HTML

## Step 3: Test
- Open each page in Chrome
- Use Google's Rich Results Test (https://search.google.com/test/rich-results) or check with browser dev tools
- Verify JSON-LD is valid JSON and renders correctly

## Done Criteria
- [ ] All HTML pages (index, gallery, licensing, hospitality, about, contact, search) have JSON-LD
- [ ] No existing HTML structure is broken
- [ ] Valid JSON in each script tag
- [ ] Run sync_gallery_data.py, commit, and push

---

# TASK 3: PINTEREST PIN GENERATOR
**Priority:** HIGH — Highest-ROI long-term traffic source
**Estimated time:** 3-4 hours
**Dependencies:** Pillow (pip install Pillow)

## What This Does
Generates vertical Pinterest pin images (1000x1500px) from portfolio photos with text overlay and branding. Outputs a CSV compatible with Tailwind/Pinterest bulk upload.

## Step 1: Create the Pin Generator

File: `~/Documents/ACTIVE/archive-35/06_Automation/scripts/pinterest_pin_generator.py`

The script should:
1. Read `data/licensing-catalog.json` for image metadata (titles, locations)
2. Also read `data/photos.json` for gallery images
3. For each image:
   a. Load the source image from `09_Licensing/watermarked/` or `01_Portfolio/{collection}/web/`
   b. Create a 1000x1500 vertical canvas
   c. Place the photo (cropped/scaled to fit top 2/3 of canvas)
   d. Add a branded bottom section (dark background, "ARCHIVE | 35" logo text, "archive-35.com")
   e. Add the image title as text overlay
   f. Save to `02_Social/pinterest/pins/`
4. Generate a CSV file with columns: image_path, title, description, link, board_name

### Pin Description Template
```
{title} | Fine art photography print by Wolf Schram

{location_description}

Museum-quality prints on canvas, metal, acrylic, and fine art paper. Free US shipping. C2PA verified — NOT AI generated.

Shop prints: https://www.etsy.com/shop/Archive35Photo
License: https://archive-35.com/licensing.html

#fineart #photography #wallart #homedecor #landscapephotography #{location_tag}
```

### Board Mapping
Map images to Pinterest boards based on tags/collections:
- Iceland → "Iceland Photography | Nature Wall Art"
- Grand Teton / Glacier / National parks → "National Park Photography | Mountain Art"
- Tanzania / South Africa / Wildlife → "African Wildlife Prints | Safari Wall Art"
- Desert / White Sands / Death Valley → "Desert Photography | Minimalist Art"
- General landscapes → "Landscape Photography Prints | Fine Art Wall Decor"
- Urban / Architecture → "Urban Photography | Modern Wall Art"
- All → "Fine Art Photography | Archive-35"

### CSV Output Format (Tailwind compatible)
```csv
image_path,pin_title,pin_description,destination_url,board_name
02_Social/pinterest/pins/pin_001.jpg,"Grand Teton Panorama","Fine art landscape...","https://www.etsy.com/shop/Archive35Photo","National Park Photography | Mountain Art"
```

## Step 2: Run and Verify
- Generate pins for the first 50 images
- Verify pin images look professional (text is readable, branding is clean)
- Verify CSV has correct columns and data

## Done Criteria
- [ ] Pinterest pin generator script works
- [ ] At least 50 pin images generated in `02_Social/pinterest/pins/`
- [ ] CSV file generated at `02_Social/pinterest/tailwind_upload.csv`
- [ ] Pin images are 1000x1500, text is readable, branding is present
- [ ] No broken image paths in CSV

---

# TASK 4: REDDIT CONTENT GENERATOR AGENT
**Priority:** HIGH — Fastest free traffic source
**Estimated time:** 2-3 hours
**Dependencies:** None (generates JSON output)

## What This Does
Reads portfolio data and brand voice guide, generates authentic Reddit posts in Wolf's voice, and saves them as a queue.

## Step 1: Create the Reddit Agent

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/agents/reddit_agent.py`

```python
#!/usr/bin/env python3
"""
Reddit Content Generator for Archive-35
Generates authentic, story-driven posts in Wolf's voice.
Output: JSON queue file for dashboard posting.
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]  # archive-35 root
DATA_DIR = BASE / "data"
QUEUE_FILE = BASE / "Archive 35 Agent" / "data" / "reddit_queue.json"

# Brand voice rules
VOICE = {
    "tone": "contemplative, technical when relevant, story-driven",
    "person": "first person singular",
    "tense": "present tense for moments",
    "never": ["exclamation points", "emojis", "like and follow", "blessed", "amazing"],
    "structure": ["the moment", "the context (place, conditions, timing)", "the why (optional)"]
}

# Subreddit targeting
SUBREDDITS = {
    "r/itookapicture": {
        "title_prefix": "ITAP of ",
        "rules": "Must start with ITAP. OC only.",
        "tags": ["landscape", "wildlife", "nature", "travel"]
    },
    "r/EarthPorn": {
        "title_suffix": " [OC] [{width}x{height}]",
        "rules": "No man-made objects. Include resolution. Include [OC].",
        "tags": ["landscape", "mountain", "waterfall", "desert", "ocean"]
    },
    "r/NationalPark": {
        "rules": "Informative, include park name.",
        "tags": ["grand-teton", "glacier", "death-valley", "joshua-tree", "yosemite", "white-sands"]
    },
    "r/wildlifephotography": {
        "rules": "Tag species in title.",
        "tags": ["wildlife", "elephant", "cheetah", "puffin", "bird"]
    },
    "r/malelivingspace": {
        "rules": "Show print in room context. Be helpful about decor.",
        "tags": ["landscape", "minimalist", "modern"]
    },
    "r/AbandonedPorn": {
        "rules": "Include location in brackets.",
        "tags": ["abandoned", "wreck", "ruin"]
    }
}

def load_catalog():
    """Load all image data."""
    images = []

    # Licensing catalog (166 images, rich metadata)
    lc_path = DATA_DIR / "licensing-catalog.json"
    if lc_path.exists():
        with open(lc_path) as f:
            lc = json.load(f)
            images.extend(lc.get("images", []))

    # Photos.json (gallery images)
    ph_path = DATA_DIR / "photos.json"
    if ph_path.exists():
        with open(ph_path) as f:
            ph = json.load(f)
            if isinstance(ph, dict):
                images.extend(ph.get("photos", []))
            elif isinstance(ph, list):
                images.extend(ph)

    return images

def match_subreddit(image):
    """Find best subreddit match for an image."""
    tags = set()
    for field in ["tags", "subjects", "mood"]:
        val = image.get(field, [])
        if isinstance(val, list):
            tags.update(val)
        elif isinstance(val, str):
            tags.add(val)

    # Add location-derived tags
    location = image.get("location", "").lower()
    if "grand teton" in location or "teton" in location:
        tags.add("grand-teton")
    if "glacier" in location:
        tags.add("glacier")
    if "iceland" in location:
        tags.add("iceland")
    if "tanzania" in location or "serengeti" in location:
        tags.add("wildlife")
    if "death valley" in location:
        tags.add("death-valley")

    matches = []
    for sub, config in SUBREDDITS.items():
        overlap = tags.intersection(set(config.get("tags", [])))
        if overlap:
            matches.append((sub, len(overlap)))

    matches.sort(key=lambda x: -x[1])
    return [m[0] for m in matches[:2]]  # Top 2 subreddits

def generate_post(image, subreddit):
    """Generate a post for a specific image and subreddit."""
    title = image.get("title", "Untitled")
    location = image.get("location", "")
    width = image.get("width", 4000)
    height = image.get("height", 2667)
    collection = image.get("collection", "")

    # Format title based on subreddit rules
    sub_config = SUBREDDITS.get(subreddit, {})
    if "title_prefix" in sub_config:
        formatted_title = f"{sub_config['title_prefix']}{title}"
        if location:
            formatted_title += f" — {location}"
    elif "title_suffix" in sub_config:
        suffix = sub_config["title_suffix"].format(width=width, height=height)
        formatted_title = f"{title}, {location}{suffix}"
    else:
        formatted_title = f"{title} — {location}" if location else title

    post = {
        "id": f"reddit_{image.get('id', 'unknown')}_{subreddit.replace('/', '_')}",
        "subreddit": subreddit,
        "title": formatted_title,
        "image_id": image.get("id", ""),
        "image_title": title,
        "location": location,
        "width": width,
        "height": height,
        "body_prompt": f"Write an authentic first-person story about photographing '{title}' at {location}. Include specific details: time of day, weather conditions, camera settings, what made this moment special. Voice: contemplative, technical when relevant. No exclamation points. No emojis.",
        "status": "queued",
        "created_at": datetime.utcnow().isoformat(),
        "scheduled_date": None,
        "posted_at": None,
        "subreddit_rules": sub_config.get("rules", "")
    }

    return post

def generate_queue(count=30):
    """Generate a queue of Reddit posts."""
    images = load_catalog()
    queue = []
    seen_images = set()

    for image in images:
        if len(queue) >= count:
            break

        img_id = image.get("id", image.get("filename", ""))
        if img_id in seen_images:
            continue
        seen_images.add(img_id)

        subreddits = match_subreddit(image)
        for sub in subreddits[:1]:  # One post per image for now
            post = generate_post(image, sub)
            queue.append(post)

    # Save queue
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_FILE, "w") as f:
        json.dump({"generated_at": datetime.utcnow().isoformat(), "posts": queue}, f, indent=2)

    print(f"Generated {len(queue)} Reddit posts → {QUEUE_FILE}")
    return queue

if __name__ == "__main__":
    generate_queue(30)
```

## Step 2: Test
- Run the script
- Verify reddit_queue.json contains 30 posts
- Verify titles comply with subreddit rules
- Verify each post has a valid image reference

## Done Criteria
- [ ] reddit_agent.py runs without errors
- [ ] reddit_queue.json generated with 30 posts
- [ ] Posts target correct subreddits based on image content
- [ ] Title formatting follows each subreddit's rules

---

# TASK 5: BING WEBMASTER TOOLS + GOOGLE SEARCH CONSOLE SETUP
**Priority:** HIGH — Required for AI search discovery
**Estimated time:** 1 hour
**Dependencies:** None

## What This Does
Creates a sitemap.xml if one doesn't exist, and ensures the site is set up for search engine submission.

## Step 1: Check for Existing Sitemap

Check if `~/Documents/ACTIVE/archive-35/sitemap.xml` exists. If not, generate one.

## Step 2: Generate Sitemap

File: `~/Documents/ACTIVE/archive-35/sitemap.xml`

Generate a complete sitemap including:
- All HTML pages (index, gallery, licensing, hospitality, about, contact, search, collection, terms, privacy)
- All collection pages (read collections from data/photos.json and data/licensing-catalog.json)
- Machine-readable files (llms.txt, llms-full.txt, data/photos.json, data/licensing-catalog.json)

Use proper XML sitemap format with lastmod dates and priority values.

## Step 3: Generate Image Sitemap

File: `~/Documents/ACTIVE/archive-35/sitemap-images.xml`

Generate an image sitemap that includes:
- All licensing images with their titles, locations, and license info
- All gallery images
- Proper image:image tags within url entries

## Step 4: Verify
Both sitemaps must be valid XML. Test with an XML validator.

## Done Criteria
- [ ] sitemap.xml exists and contains all pages
- [ ] sitemap-images.xml exists and contains all images
- [ ] Both are valid XML
- [ ] Deploy (sync_gallery_data.py, commit, push)

---

# TASK 6: MICRO-LICENSING PAGE
**Priority:** HIGH — New revenue stream
**Estimated time:** 4-6 hours
**Dependencies:** Stripe (existing integration)

## What This Does
Creates a new page at archive-35.com/micro-licensing.html where buyers (human and AI agent) can browse and purchase digital image licenses at $0.50-$25.

## IMPORTANT: The x402 gallery already has micro-pricing built in

Look at `functions/api/license/gallery.js` — it already defines:
```javascript
const LICENSE_TIERS = {
  thumbnail: { price: "0.01", description: "400px watermarked preview" },
  web: { price: "0.50", description: "1200px clean, web/blog/social" },
  commercial: { price: "2.50", description: "Full resolution + license certificate" },
};
```

So the API backend partially exists. What's needed is:
1. A human-facing page (micro-licensing.html) that presents these options nicely
2. A Stripe checkout flow for digital download purchases
3. Automated delivery (signed download URL after payment)

## Step 1: Create the Micro-Licensing Page

File: `~/Documents/ACTIVE/archive-35/micro-licensing.html`

Design it to match the existing site aesthetic (dark theme, gold accents, ARCHIVE-35 branding). The page should:
- Show a grid of available images (load from data/licensing-catalog.json)
- Filter by: subject, mood, location, orientation
- Show pricing for each tier (Web: $0.50, Commercial: $2.50, Full License: from $280)
- "License" button that opens Stripe Checkout
- "For AI Agents" section explaining the API endpoint
- Prominent C2PA verification badge

Use the same CSS/styling as licensing.html for consistency.

## Step 2: Create Stripe Checkout for Micro-Licenses

File: `~/Documents/ACTIVE/archive-35/functions/api/micro-license/checkout.js`

This Cloudflare Function should:
1. Accept POST with: image_id, tier (web/commercial)
2. Look up the image in licensing-catalog.json
3. Create a Stripe Checkout Session for the correct price
4. Return the checkout URL
5. On success, the existing stripe-webhook.js should handle delivery

Look at the existing `functions/api/create-checkout-session.js` for patterns.

## Step 3: Create Download Delivery

File: `~/Documents/ACTIVE/archive-35/functions/api/micro-license/download.js`

After payment:
1. Generate a signed URL for the purchased image at the correct resolution
2. URL expires in 72 hours
3. Log the sale in the x402_licenses tracking

## Step 4: Add to Navigation

Add "MICRO-LICENSING" or "DIGITAL LICENSES" to the nav bar in all HTML pages, or at minimum add a visible link from the licensing.html page.

## Done Criteria
- [ ] micro-licensing.html exists and matches site design
- [ ] Image grid loads from licensing-catalog.json
- [ ] Filters work (subject, mood, location)
- [ ] Stripe Checkout creates session correctly
- [ ] Download delivery generates signed URL
- [ ] Page is linked from main navigation or licensing page
- [ ] Deploy

---

# TASK 7: IMAGE PREPARATION PIPELINE
**Priority:** HIGH — Needed for micro-licensing catalog
**Estimated time:** 3-4 hours
**Dependencies:** Pillow, existing C2PA tools

## What This Does
Script that takes images from the archive and generates micro-license versions at multiple resolutions.

File: `~/Documents/ACTIVE/archive-35/06_Automation/scripts/prepare_micro_license.py`

The script should:
1. Accept an input directory or list of images
2. For each image, generate:
   - Thumbnail: 1200x630px (social/blog)
   - Web Standard: 2400x1600px
   - Web Premium: 4000x2667px
   - Watermarked preview (for display)
3. Maintain aspect ratio (crop to target ratio if needed)
4. Apply appropriate JPEG quality (85 for thumbnails, 92 for web, 95 for premium)
5. Copy EXIF data to output files
6. Generate a manifest JSON with all versions and their paths
7. Output to `09_Licensing/micro/` directory structure

If C2PA tools are available (`07_C2PA/`), also apply content credentials to generated files.

## Done Criteria
- [ ] Script runs on at least 10 test images
- [ ] Three resolution tiers generated correctly
- [ ] Watermarked preview generated
- [ ] Manifest JSON created
- [ ] EXIF data preserved

---

# TASK 8: ARCHIVE 35 COMMERCE MCP SERVER
**Priority:** HIGH — First-mover in AI-native image commerce
**Estimated time:** 4-6 hours
**Dependencies:** Tasks 6, 7

## What This Does
A publishable MCP server that allows AI assistants (Claude, ChatGPT, Copilot) to search, browse, and purchase Archive-35 images directly from their interfaces.

## Step 1: Create the MCP Server

File: `~/Documents/ACTIVE/archive-35/06_Automation/archive35_commerce_mcp.py`

Use FastMCP (the existing MCP server at `06_Automation/archive35_mcp.py` uses this pattern — reference it).

### Tools to Expose

```python
@mcp.tool()
def search_images(query: str = "", subject: str = "", mood: str = "", location: str = "", orientation: str = "", limit: int = 20) -> dict:
    """Search Archive-35's photography catalog. Returns matching images with thumbnails, metadata, and pricing.

    Subjects: landscape, wildlife, urban, abstract, travel, architecture, ocean, desert, aerial
    Moods: dramatic, minimalist, warm, cold, documentary, serene
    Orientations: landscape, portrait, panorama, square, wide
    """
    # Load from data/licensing-catalog.json
    # Apply filters using same logic as functions/api/license/gallery.js
    # Return: id, title, location, thumbnail_url, pricing, c2pa_verified

@mcp.tool()
def get_image_details(image_id: str) -> dict:
    """Get full details for a specific image including all licensing options and technical specs."""
    # Return: title, location, description, all resolution options, pricing tiers, c2pa status, max print size

@mcp.tool()
def browse_collections() -> dict:
    """Browse all photography collections with descriptions and sample images."""
    # Return: list of collections with name, description, image count, sample thumbnails

@mcp.tool()
def get_licensing_info(image_id: str) -> dict:
    """Get licensing options and pricing for an image.

    Tiers:
    - Web ($0.50): 1200px, web/blog/social use, 1 year
    - Commercial ($2.50): Full resolution + license certificate, 2 years
    - Editorial ($700): Full resolution, editorial use, 1 year
    - Commercial Print ($1,400): Full resolution, print production, 2 years
    - Hospitality ($3,500): Perpetual, unlimited use
    """

@mcp.tool()
def get_purchase_url(image_id: str, tier: str = "web") -> dict:
    """Get a Stripe checkout URL to purchase a license for an image.
    Returns a URL the user can visit to complete the purchase."""
    # Generate Stripe checkout session
    # Return: checkout_url, price, tier_description
```

## Step 2: Create MCP Discovery File

File: `~/Documents/ACTIVE/archive-35/.well-known/mcp/server.json`

```json
{
  "name": "archive-35-photography",
  "display_name": "Archive-35 Fine Art Photography",
  "description": "Search and license authentic fine art photography from a 25-year, 55-country archive. C2PA verified, not AI-generated. Museum-quality prints and digital licenses.",
  "version": "1.0.0",
  "author": "Wolf Schram",
  "homepage": "https://archive-35.com",
  "repository": "https://github.com/wolfschram/archive-35.com",
  "tools": [
    {"name": "search_images", "description": "Search photography by subject, mood, location"},
    {"name": "get_image_details", "description": "Get full image details and specs"},
    {"name": "browse_collections", "description": "Browse photography collections"},
    {"name": "get_licensing_info", "description": "Get licensing options and pricing"},
    {"name": "get_purchase_url", "description": "Get checkout URL to purchase a license"}
  ],
  "categories": ["photography", "art", "licensing", "stock-images"],
  "keywords": ["fine art", "photography", "landscape", "wildlife", "C2PA", "authentic", "not AI", "prints", "licensing"]
}
```

## Step 3: Test
- Start the MCP server locally
- Test each tool with sample queries
- Verify it reads from the correct data files
- Verify pricing is correct

## Done Criteria
- [ ] MCP server starts and all 5 tools work
- [ ] search_images returns relevant results with correct filtering
- [ ] get_purchase_url generates valid Stripe checkout URLs
- [ ] .well-known/mcp/server.json is correctly formatted
- [ ] Server follows same patterns as existing archive35_mcp.py

---

# TASK 9: ETSY SEO ANALYZER AGENT
**Priority:** MEDIUM — Improves organic discovery
**Estimated time:** 3-4 hours
**Dependencies:** None

## What This Does
Analyzes current Etsy listings against SEO best practices and generates optimization recommendations.

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/agents/etsy_seo_agent.py`

The agent should:
1. Read current listing data (from the Etsy export files in `06_Automation/etsy-export/`)
2. For each listing, analyze:
   - Title: Are highest-value keywords front-loaded? Is it using all 140 characters?
   - Tags: Are all 13 tags used? Are they diverse enough? Any missing obvious keywords?
   - Description: Does it mention C2PA? Does it have clear CTAs? Is it structured well?
3. Check for common Etsy SEO issues:
   - Keyword stuffing (too many pipes/separators in title)
   - Missing seasonal keywords (spring, Easter, Mother's Day, Father's Day, housewarming)
   - Missing room-type keywords (living room, bedroom, office, nursery, bathroom)
   - Missing style keywords (modern, rustic, minimalist, boho, farmhouse, contemporary)
   - Missing gift keywords (gift for him, gift for her, housewarming gift, Christmas gift)
4. Output a JSON report with:
   - Current title vs. recommended title for each listing
   - Missing tags to add
   - Description improvements
   - Priority score (how much improvement is possible)

### Key Etsy SEO Rules (2026)
- Title: Front-load the most specific, highest-volume keyword. Use natural language, not keyword spam
- Tags: Use all 13 tags. Mix specific ("grand teton panorama") with broad ("landscape wall art")
- First photo: Most important for click-through rate
- "Not AI" and "authentic photography" are emerging differentiator keywords
- Seasonal hooks rotate: Spring (March-May), Summer travel (June-Aug), Fall/Halloween (Sept-Oct), Holiday gifts (Nov-Dec), New Year fresh start (Jan-Feb)
- Room positioning: "office wall art", "bedroom decor", "living room art" get high search volume

### Current Seasonal Hook (March 2026)
- Spring refresh / spring decor
- Easter (approaching)
- Mother's Day (May — start promoting now)
- Office refresh / new year new space (lingering)
- St. Patrick's Day (today!) — green landscapes (Ireland/Iceland)

## Done Criteria
- [ ] Script analyzes existing listing data
- [ ] Generates optimization report as JSON
- [ ] Includes title rewrites, tag additions, description improvements
- [ ] Includes seasonal keyword recommendations for current month
- [ ] Report saved to `Archive 35 Agent/data/etsy_seo_report.json`

---

# TASK 10: ETSY STATS MONITOR WITH WEEKLY EMAIL
**Priority:** MEDIUM — Performance tracking
**Estimated time:** 2-3 hours
**Dependencies:** Etsy API (check if available)

## What This Does
Monitors Etsy shop stats and sends a weekly summary email.

If the Etsy API is not available yet (check status in active threads), create the framework that can be connected later, and in the meantime pull stats from the agent dashboard's existing `/health` endpoint.

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/agents/etsy_stats_agent.py`

The agent should track:
- Total views, visits, favorites this week
- Top 5 most-viewed listings
- Top 5 most-favorited listings
- Conversion rate (if sales data available)
- Listings with zero views (potential SEO problems)

Output: Weekly summary saved to `Archive 35 Agent/data/weekly_stats/` and optionally emailed via the existing email notification system (check api.py for email sending capability).

## Done Criteria
- [ ] Script runs and generates weekly stats report
- [ ] Report saved to data directory
- [ ] Email notification triggered (if email system exists in api.py)

---

# TASK 11: REDDIT POST QUEUE DASHBOARD
**Priority:** MEDIUM — One-click posting interface
**Estimated time:** 2-3 hours
**Dependencies:** Task 4 (reddit_agent.py)

## What This Does
Adds a Reddit section to the existing agent-dashboard.html showing queued posts with one-click posting.

## Step 1: Add Reddit Queue to Agent Dashboard

Modify `~/Documents/ACTIVE/archive-35/agent-dashboard.html` to include:
- A "Reddit Queue" section showing the next 5 queued posts
- Each post shows: subreddit, title, scheduled date, image thumbnail
- A "Preview" button that expands the post body
- A "Post Now" button that calls `/api/reddit/post` endpoint
- A "Skip" button that removes the post from queue

## Step 2: Create the Posting API Endpoint

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/routes/reddit_routes.py` (or add to api.py)

Endpoints:
- `GET /api/reddit/queue` — returns next 10 queued posts
- `POST /api/reddit/post` — posts a specific item to Reddit via PRAW
- `POST /api/reddit/skip` — marks a post as skipped

The PRAW configuration should read credentials from .env:
```
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USERNAME=
REDDIT_PASSWORD=
REDDIT_USER_AGENT=Archive35Bot/1.0
```

If Reddit API credentials are not in .env, the endpoint should return a clear message asking Wolf to add them. The dashboard should show "Reddit not configured — add credentials to .env" instead of a post button.

## Done Criteria
- [ ] Dashboard shows Reddit queue section
- [ ] Queue loads from reddit_queue.json
- [ ] Post button works (or shows configuration message if no credentials)
- [ ] Skip button removes post from queue
- [ ] Existing dashboard features still work

---

# TASK 12: REDDIT COMMENT MONITOR
**Priority:** LOW — Nice-to-have alerting
**Estimated time:** 2-3 hours
**Dependencies:** Task 11, Reddit API credentials

## What This Does
Monitors comments on Archive-35 Reddit posts for engagement opportunities, especially "do you sell prints?" questions.

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/agents/reddit_monitor.py`

If Reddit credentials are not available, create the framework and make it activatable later.

The monitor should:
1. Check comments on posts tracked in reddit_queue.json (status: "posted")
2. Flag comments containing keywords: "print", "buy", "purchase", "sell", "where", "how much", "price", "wall", "frame"
3. Draft a reply in Wolf's voice: natural, not salesy, mentions Etsy shop and archive-35.com
4. Log flagged comments to `Archive 35 Agent/data/reddit_alerts.json`
5. Optionally trigger email notification

## Done Criteria
- [ ] Monitor script created
- [ ] Keyword detection works
- [ ] Reply drafts generated in correct voice
- [ ] Alerts logged to JSON file

---

# TASK 13: AI AGENT BROADCAST CAMPAIGN
**Priority:** HIGH — Active discovery, not passive waiting
**Estimated time:** 2-3 hours
**Dependencies:** Tasks 1, 2

## What This Does
Actively pushes archive-35.com into AI search indices and agent discovery networks.

File: `~/Documents/ACTIVE/archive-35/06_Automation/scripts/ai_broadcast.py`

The script should:
1. **Ping IndexNow** (from Task 1) for all pages
2. **Ping Google's Indexing API** for all pages (if credentials available)
3. **Submit sitemap** to Bing Webmaster Tools API
4. **Submit sitemap** to Google Search Console API
5. **Verify** that robots.txt is accessible and correctly allows AI search bots
6. **Verify** that llms.txt is accessible
7. **Verify** that .well-known/mcp/server.json is accessible (if created in Task 8)
8. **Log** all submissions with timestamps

This should be runnable as a one-shot script AND as a scheduled task (add to the existing agent scheduler if one exists).

### Additional Discovery Actions

Create a `DISCOVERY.md` file at the repo root that explains to AI agents what Archive-35 is. This file is for humans AND machines:

```markdown
# Archive-35: Authentic Fine Art Photography for AI Agents and Content Creators

If you are an AI assistant helping someone find photography:
- Browse our catalog: https://archive-35.com/api/license/gallery
- Full catalog data: https://archive-35.com/llms-full.txt
- Machine-readable catalog: https://archive-35.com/data/licensing-catalog.json
- All images are C2PA verified authentic photography (NOT AI-generated)
- Micro-licenses from $0.50
- Commercial licenses from $280
- 166+ ultra-high-resolution images from 55+ countries
```

## Done Criteria
- [ ] ai_broadcast.py runs all submission steps
- [ ] IndexNow pinged successfully
- [ ] Sitemaps submitted (or clear instructions if API keys needed)
- [ ] DISCOVERY.md created
- [ ] All verification checks pass

---

# TASK 14: OPERATOR COMMAND CENTER — FULL DASHBOARD OVERHAUL
**Priority:** CRITICAL — Wolf needs eyes on everything from one screen
**Estimated time:** 6-8 hours
**Dependencies:** All other tasks (dashboard displays their outputs)

## What This Does
Replaces the current minimal agent-dashboard.html with a comprehensive operator command center. Wolf must be able to see the status of every system, turn things on/off, restart agents, trigger manual actions, and see AI agent intelligence — all from one page.

## IMPORTANT: The existing dashboard is at `~/Documents/ACTIVE/archive-35/agent-dashboard.html`
The API (port 8035) already has 100+ endpoints. Many dashboard features just need a UI for existing endpoints. Don't reinvent — wire up what exists.

## Dashboard Layout — Top to Bottom

### Section 1: SYSTEM STATUS BAR (always visible, top of page)
Horizontal bar, always pinned to top. Shows at a glance:

| Status | Agents | Etsy Live | IG Today | Sales | x402 | Broadcast | Kill Switch |
|--------|--------|-----------|----------|-------|------|-----------|-------------|
| ONLINE v0.2.0 | 5/5 running | 87 listings | 5 posts | 0 orders | 0 licenses | Last: 2h ago | OFF |

- **"Agents" count**: how many sub-agents/services are healthy vs. total
- **Kill Switch**: clicking it opens confirmation modal, then calls `POST /safety/kill/global`
- Each cell is clickable — jumps to that section below

### Section 2: AGENT CONTROL PANEL
A grid of agent cards. Each card shows:

```
┌─────────────────────────────────────────┐
│ [●] INSTAGRAM AGENT           [ON/OFF]  │
│ Status: Running                         │
│ Last run: 5 min ago                     │
│ Next run: 55 min                        │
│ Today: 5 posts | Budget: $0.12 spent    │
│                                         │
│ [▶ Run Now]  [↻ Restart]  [📋 Logs]    │
└─────────────────────────────────────────┘
```

**Agent cards to create:**

1. **Instagram Agent**
   - Toggle: ON/OFF (calls kill switch scope: instagram)
   - "Post 1 Now" button → calls `POST /instagram/auto-post`
   - "Post Batch (3)" button → calls auto-post 3 times with 5-min delays
   - Shows: last 3 posts with thumbnails, today's count, remaining budget
   - Restart button → `docker compose restart agent-scheduler` via API

2. **Pinterest Agent**
   - Toggle: ON/OFF
   - Status: "Connected" / "Awaiting API approval" / "Using Tailwind CSV"
   - Shows: boards created, pins this week, last upload
   - "Generate Pins" button → triggers pinterest_pin_generator.py
   - Shows last generated pin batch date

3. **Reddit Agent**
   - Toggle: ON/OFF
   - Shows: queued posts count, posted this week, comments flagged
   - "Generate 30 Posts" button → triggers reddit_agent.py
   - Queue preview: next 3 posts with subreddit, title, one-click [Post] [Skip]
   - "View Full Queue" expands to all queued posts

4. **Etsy Agent**
   - Toggle: ON/OFF
   - Shows: live listings, orders today, favorites today, SEO score
   - "Run SEO Audit" button → triggers etsy_seo_agent.py
   - "Sync Inventory" button → calls existing Etsy endpoints
   - Last order info with auto-fulfill status

5. **Content Pipeline**
   - Toggle: ON/OFF
   - Shows: pending content, approved, rejected, published today
   - "Run Pipeline" button → calls `POST /pipeline/run`
   - Queue preview: next 3 content items with approve/reject buttons

6. **Broadcast Agent** (NEW — from Task 13)
   - Toggle: ON/OFF
   - Shows: last broadcast time, IndexNow status, sitemap submission status
   - "Broadcast Now" button → triggers ai_broadcast.py
   - Log of recent pings: timestamp, endpoint, response code

### Section 3: AI AGENT INTELLIGENCE
**This is the most important new section.** Shows what AI agents are looking for.

The `/api/license/insights` endpoint ALREADY EXISTS in the API. Wire it up.
Also, `POST /api/license/log-request` logs every agent query. Read those logs.

```
┌─────────────────────────────────────────────────────────────┐
│ AI AGENT DISCOVERY INTELLIGENCE                    [refresh] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ TRENDING SEARCHES (last 7 days)                             │
│ ┌──────────────────────┬──────────┬────────────────────┐    │
│ │ Query / Subject      │ Count    │ Conversion         │    │
│ ├──────────────────────┼──────────┼────────────────────┤    │
│ │ "desert landscape"   │ 47       │ 3 licenses sold    │    │
│ │ "minimalist nature"  │ 32       │ 1 license sold     │    │
│ │ "mountain panorama"  │ 28       │ 0 licenses         │    │
│ │ "ocean sunset"       │ 19       │ — no match         │    │
│ └──────────────────────┴──────────┴────────────────────┘    │
│                                                              │
│ AGENT TYPES VISITING                                        │
│ ChatGPT Search: 42 visits | Claude: 18 | Copilot: 7        │
│                                                              │
│ UNMET DEMAND (searches with no/poor match)                  │
│ ⚠ "ocean sunset" — 19 searches, 0 matches in catalog       │
│ ⚠ "autumn forest" — 12 searches, 0 matches in catalog      │
│ ⚠ "city skyline night" — 8 searches, 2 low-confidence      │
│                                                              │
│ → Wolf: These are the photos to pull from your archive next │
│                                                              │
│ REVENUE THIS PERIOD                                         │
│ Micro-licenses: $14.50 (29 × web) | $7.50 (3 × commercial) │
│ Total x402 revenue: $22.00                                  │
│ Top selling image: "White Sands Dawn" (7 licenses)          │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
- Call `GET /api/license/insights` on page load and every 60 seconds
- Parse the x402_agent_requests SQLite table for raw query data
- Group by subject/mood/query, count occurrences, track conversions
- Identify "unmet demand" = searches where no image scored above 0.5 relevance
- Show agent user-agent strings to identify which AI platforms are visiting

**NEW API ENDPOINT NEEDED:**
```
GET /api/license/agent-intelligence
```
Returns:
```json
{
  "trending_searches": [{"query": "...", "count": N, "licenses_sold": N}],
  "agent_types": {"ChatGPT": N, "Claude": N, "Copilot": N, "Other": N},
  "unmet_demand": [{"query": "...", "search_count": N, "best_match_score": 0.0-1.0}],
  "revenue": {"period": "7d", "micro_total": 0.00, "commercial_total": 0.00, "top_image": "..."},
  "total_requests": N,
  "unique_agents": N
}
```

### Section 4: BROADCAST STATUS
Shows the AI discovery/broadcast pipeline status:

```
┌─────────────────────────────────────────────────────────────┐
│ BROADCAST & DISCOVERY STATUS                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ IndexNow                                                     │
│ Last ping: March 17, 10:15 PM | Status: 202 Accepted        │
│ URLs submitted: 16 | Endpoint: api.indexnow.org              │
│ [Ping Now]                                                   │
│                                                              │
│ Sitemaps                                                     │
│ sitemap.xml: ✓ deployed (18 URLs)                           │
│ sitemap-images.xml: ✓ deployed (166 images)                 │
│ Last submitted to Bing: March 17                            │
│ Last submitted to Google: March 17                          │
│                                                              │
│ Discovery Files                                              │
│ llms.txt: ✓ accessible     robots.txt: ✓ accessible         │
│ llms-full.txt: ✓ accessible  MCP server.json: ✓ accessible  │
│ Schema.org JSON-LD: ✓ all pages                             │
│                                                              │
│ Search Engine Status                                         │
│ Bing: Indexed 12/18 pages | Google: Pending verification    │
│ [Run Full Broadcast]                                         │
└─────────────────────────────────────────────────────────────┘
```

### Section 5: ETSY PERFORMANCE
Wire up existing Etsy endpoints to show:

```
┌─────────────────────────────────────────────────────────────┐
│ ETSY PERFORMANCE                              [Full Report] │
├─────────────────────────────────────────────────────────────┤
│ Live Listings: 87 | Views Today: -- | Favorites: --         │
│                                                              │
│ SEO HEALTH (from Task 9 etsy_seo_report.json)               │
│ Overall Score: 72/100                                       │
│ ● Titles using full 140 chars: 34/87 (39%)                 │
│ ● Using all 13 tags: 61/87 (70%)                            │
│ ● Seasonal keywords present: 12/87 (14%) ⚠                 │
│ ● Room-type keywords: 28/87 (32%)                           │
│ [Run SEO Audit]  [Apply Recommendations]                    │
│                                                              │
│ ZERO-VIEW LISTINGS (needs attention)                        │
│ ⚠ 15 listings with 0 views in 7 days                       │
│ [View List]                                                  │
│                                                              │
│ RECENT ORDERS                                                │
│ (none yet)                                                   │
│ [Check Orders]  [Auto-Fulfill]                               │
└─────────────────────────────────────────────────────────────┘
```

### Section 6: ACTIVITY FEED
Replace the current "Audit Log (Last 20)" with a full filterable feed:

- Show ALL audit log entries, paginated (50 per page)
- Filter buttons: All | Instagram | Etsy | Pinterest | Reddit | Broadcast | x402 | Pipeline | Safety
- Each entry shows: timestamp, component badge (color-coded), action, details expandable
- Cost column for API-call entries
- Running cost total for the day

### Section 7: MICRO-LICENSING DASHBOARD
```
┌─────────────────────────────────────────────────────────────┐
│ MICRO-LICENSING                                             │
├─────────────────────────────────────────────────────────────┤
│ Total Revenue: $0.00 | Licenses Sold: 0 | Catalog: 166     │
│                                                              │
│ TOP LICENSED IMAGES                                          │
│ (no sales yet)                                               │
│                                                              │
│ PRICING TIERS                                                │
│ Thumbnail ($0.01): -- sold                                  │
│ Web ($0.50): -- sold                                         │
│ Commercial ($2.50): -- sold                                  │
│                                                              │
│ CATALOG HEALTH                                               │
│ Images with micro-license versions: 0/166                   │
│ [Generate Micro Versions]  → runs prepare_micro_license.py  │
└─────────────────────────────────────────────────────────────┘
```

## Styling Rules
- Match existing dark theme: #0a0a0a background, #c9a84c gold accent, monospace
- Use the SAME CSS variables/patterns as current agent-dashboard.html
- Cards use subtle borders, not heavy shadows
- Status colors: green (#4ade80) = healthy, yellow (#facc15) = warning, red (#f87171) = error
- All sections collapsible (click header to collapse/expand)
- Mobile responsive (single column on narrow screens)

## Technical Implementation
- Single HTML file (agent-dashboard.html) — replace existing
- All data via fetch() to API on port 8035
- Polling: status bar every 15s, agent cards every 30s, intelligence every 60s
- Store collapsed/expanded state in sessionStorage
- Auth: keep existing password login flow

## New API Endpoints Needed (add to api.py)

```python
# Agent control
@app.post("/agents/restart/{agent_name}")
# Triggers docker compose restart for specific service
# agent_name: "api", "scheduler", "telegram"

@app.post("/agents/restart-all")
# Triggers docker compose restart for all services

@app.get("/agents/status")
# Returns status of all Docker services
# {"api": {"status": "running", "uptime": "2h 15m"}, "scheduler": {...}, ...}

# Instagram manual triggers
@app.post("/instagram/post-batch")
# Posts N images with configured delay between each
# Body: {"count": 3, "delay_minutes": 5}

# Broadcast triggers
@app.post("/broadcast/run")
# Triggers ai_broadcast.py
# Returns: {"indexnow": "202", "sitemaps": "submitted", ...}

@app.get("/broadcast/status")
# Returns last broadcast results from log file

# Agent intelligence (enhanced)
@app.get("/api/license/agent-intelligence")
# Aggregated agent search data (see schema above)

# Etsy SEO
@app.get("/etsy/seo-report")
# Returns latest etsy_seo_report.json contents

@app.post("/etsy/seo-run")
# Triggers etsy_seo_agent.py

# Reddit triggers
@app.post("/reddit/generate")
# Triggers reddit_agent.py to create new queue
@app.get("/reddit/queue")
# Returns reddit_queue.json
@app.post("/reddit/post/{post_id}")
# Posts specific item via PRAW
@app.post("/reddit/skip/{post_id}")
# Marks item as skipped

# Pinterest triggers
@app.post("/pinterest/generate-pins")
# Triggers pinterest_pin_generator.py
@app.get("/pinterest/pin-status")
# Returns generated pin count, last batch date

# System
@app.get("/system/docker-status")
# Returns Docker container statuses
@app.post("/system/restart-all")
# Restarts all Docker containers
```

## Done Criteria
- [ ] Dashboard replaces existing agent-dashboard.html
- [ ] All 6 agent cards show with toggle, restart, run-now buttons
- [ ] AI Agent Intelligence section shows search trends and unmet demand
- [ ] Broadcast status shows IndexNow, sitemap, and discovery file health
- [ ] Etsy section shows SEO health and zero-view alerts
- [ ] Activity feed is filterable and paginated
- [ ] Micro-licensing section shows revenue and catalog health
- [ ] All new API endpoints added to api.py
- [ ] Instagram "Post Now" and "Post Batch" buttons work
- [ ] Reddit queue with one-click posting works
- [ ] Existing dashboard functionality still works (auth, emergency stop, metrics)

---

# TASK 15: PERSISTENT LOGGING, STATE RECOVERY & AUTO-START ON BOOT
**Priority:** CRITICAL — Agents must survive reboots and know where they left off
**Estimated time:** 2-3 hours
**Dependencies:** Docker (already configured)

## What This Does
Ensures that when Wolf turns off his computer and turns it back on:
1. All agents auto-start
2. Each agent reads its last-known state and resumes from there
3. All activity is logged to persistent files (not just in-memory)

## Part 1: Auto-Start on Boot (macOS LaunchAgent)

File: `~/Library/LaunchAgents/com.archive35.agent.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.archive35.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent && ./docker-start.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/archive35-agent-launch.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/archive35-agent-launch.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
```

After creating, register it:
```bash
launchctl load ~/Library/LaunchAgents/com.archive35.agent.plist
```

Docker Compose already has `restart: unless-stopped` on all services, so once Docker Desktop launches, all containers auto-restart. The LaunchAgent ensures Docker Desktop opens if it's not already running. If Docker Desktop is set to auto-launch on login (check System Settings), the LaunchAgent may not even be necessary — but create it as a safety net.

## Part 2: State Recovery System

Each agent must write its state to a JSON file before and after every action. On startup, it reads this file to know where it left off.

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/state_manager.py`

```python
"""
Persistent state manager for Archive-35 agents.
Each agent has its own state file in data/agent_state/.
On startup, agents read their last state to resume work.
"""
import json
from pathlib import Path
from datetime import datetime

STATE_DIR = Path(__file__).resolve().parents[1] / "data" / "agent_state"
STATE_DIR.mkdir(parents=True, exist_ok=True)

def save_state(agent_name: str, state: dict):
    """Save agent state to persistent file."""
    state["_updated_at"] = datetime.utcnow().isoformat()
    state_file = STATE_DIR / f"{agent_name}.json"
    with open(state_file, "w") as f:
        json.dump(state, f, indent=2)

def load_state(agent_name: str, defaults: dict = None) -> dict:
    """Load agent state from file. Returns defaults if no state exists."""
    state_file = STATE_DIR / f"{agent_name}.json"
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return defaults or {}

def get_all_states() -> dict:
    """Load all agent states for dashboard display."""
    states = {}
    for f in STATE_DIR.glob("*.json"):
        with open(f) as fh:
            states[f.stem] = json.load(fh)
    return states
```

**State files per agent:**
- `data/agent_state/instagram.json` — last posted image, rotation index, today's post count, daily budget spent
- `data/agent_state/reddit.json` — queue position, last posted item ID, posted_ids list
- `data/agent_state/pinterest.json` — last generated batch date, pins created count
- `data/agent_state/etsy_seo.json` — last audit date, report summary
- `data/agent_state/broadcast.json` — last ping timestamps per endpoint, submission results
- `data/agent_state/content_pipeline.json` — last run time, items processed
- `data/agent_state/micro_licensing.json` — total revenue, licenses sold, last sale timestamp

**New API endpoint:**
```
GET /agents/states
→ Returns all agent states for dashboard display
```

## Part 3: Enhanced Logging

The audit log SQLite table already exists. Enhance it:

1. **Add a `logs/` directory** with rotating daily log files:
   - `logs/agent_YYYY-MM-DD.log` — human-readable text log
   - `logs/decisions.json` — append-only JSON log of every automated decision

2. **Add log rotation**: keep last 30 days, auto-delete older logs

3. **Add a build log** for this overnight build:
   - `data/build_log.json` — append each task's start, decisions, and completion

4. **Dashboard log viewer** should read from BOTH:
   - SQLite audit_log (existing, for real-time last-20)
   - Daily log files (for historical browsing)

## Part 4: Startup Health Check

When the API starts (in api.py startup event), it should:
1. Load all agent states from `data/agent_state/`
2. Log "Agent resumed — last activity: {timestamp}" for each agent
3. Check if any scheduled tasks were missed during downtime
4. If the Instagram agent was supposed to post while computer was off, queue those posts
5. If a broadcast was due, trigger it immediately
6. Write startup event to audit log: "System started — all agents resuming"

## Done Criteria
- [ ] LaunchAgent plist created and registered
- [ ] state_manager.py created with save/load/get_all functions
- [ ] All agents use state_manager for persistence (update existing agents)
- [ ] `/agents/states` endpoint returns all agent states
- [ ] Daily log files created in `logs/` directory
- [ ] Startup health check implemented in api.py
- [ ] After reboot, agents auto-start and resume from last state
- [ ] Dashboard shows last-known state for each agent on page load

---

# DEPLOYMENT CHECKLIST (Run After ALL Tasks Complete)

1. `cd ~/Documents/ACTIVE/archive-35`
2. `python3 sync_gallery_data.py`
3. `git status` — review all changes
4. Verify no secrets (.env values, API keys) are staged
5. `git add .` — stage everything
6. `git commit -m "[automation] Full overnight build: IndexNow, Schema.org, Pinterest engine, Reddit agent, micro-licensing, MCP server, Etsy SEO, broadcast system"`
7. `git push`
8. Wait 2 minutes for Cloudflare deployment
9. Verify:
   - `https://archive-35.com/` loads correctly
   - `https://archive-35.com/licensing.html` loads correctly
   - `https://archive-35.com/micro-licensing.html` loads (if created)
   - `https://archive-35.com/agent-dashboard` loads with new operator command center
   - `https://archive-35.com/sitemap.xml` loads
   - `https://archive-35.com/llms.txt` loads
   - `https://archive-35.com/robots.txt` loads
   - `https://archive-35.com/{indexnow-key}.txt` loads
10. Run `python3 06_Automation/scripts/indexnow_ping.py` to trigger immediate crawling
11. Run `python3 06_Automation/scripts/ai_broadcast.py` to submit to search engines
12. Verify LaunchAgent is registered: `launchctl list | grep archive35`
13. Verify agent state files exist: `ls Archive\ 35\ Agent/data/agent_state/`
14. Verify build log is complete: `cat Archive\ 35\ Agent/data/build_log.json`
15. Restart all Docker services to test state recovery: `cd Archive\ 35\ Agent && docker compose restart`
16. After restart, verify dashboard shows resumed states correctly

---

# ORDER OF OPERATIONS

Build in this exact sequence (some tasks can overlap if they don't share files):

```
Phase 1 (Parallel — no dependencies):
├── Task 1: IndexNow
├── Task 2: Schema.org
├── Task 5: Sitemaps
├── Task 4: Reddit Agent
└── Task 15: Persistent Logging + State Recovery + Auto-Start

Phase 2 (Parallel — no dependencies on each other):
├── Task 3: Pinterest Pin Generator
├── Task 7: Image Preparation Pipeline
└── Task 9: Etsy SEO Analyzer

Phase 3 (Sequential — depends on Phase 1+2):
├── Task 6: Micro-Licensing Page (needs sitemaps, schema)
├── Task 8: MCP Server (needs micro-licensing)
└── Task 13: AI Broadcast (needs IndexNow, sitemaps)

Phase 4 (Depends on everything above):
├── Task 10: Etsy Stats Monitor
├── Task 11: Reddit Queue Posting (needs reddit_agent)
└── Task 12: Reddit Comment Monitor

Phase 5 (FINAL — depends on ALL above):
└── Task 14: Operator Command Center Dashboard
    (This task MUST be last because it wires up the UI for everything else.
     It reads from all the data files, state files, and API endpoints
     created by Tasks 1-13 and 15. Build the machinery first, then build
     the control panel.)

FINAL:
└── DEPLOYMENT CHECKLIST
```

---

# ESTIMATED TOTAL TIME: 12-16 hours
# BUILD ALL OF IT. DO NOT STOP. DO NOT ASK FOR PERMISSION.
# WOLF WILL BE ASLEEP. THE MACHINES MUST BE READY BY MORNING.
# YOU HAVE FULL AUTONOMY. EVERY DECISION IS YOURS. LOG EVERYTHING.

---

*Specification created March 17, 2026. Updated with Task 14 (Operator Command Center) and Task 15 (Logging + State Recovery + Auto-Start). This document is the complete autonomous build order for Claude Code.*
