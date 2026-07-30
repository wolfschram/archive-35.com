# Archive 35 Revenue Reset

Date: July 29, 2026  
Decision horizon: 30-day proof-of-demand experiment  
Primary constraint: less than 15 minutes of Wolf's attention per week

## Executive decision

Do not rebuild Archive 35 and do not add another general-purpose marketing agent.

The photography is not the immediate problem. The Etsy offer is.

Archive35Photo currently asks a buyer with no prior relationship, no reviews, and no
purchase history to start with a roughly $500-$762 large metal print. The store has
no low-risk first purchase. Automation has made it efficient to publish expensive
products, but it has not created a feedback loop that discovers what people will buy.

The smallest credible test is:

1. Keep the premium metal work as the brand anchor.
2. Add 20 instant-download printable photographs at $12.
3. Add 5 coordinated three-image sets at $18.
4. Add unframed 12x8 fine-art paper prints at $39 only for products that show demand.
5. Spend no more than $50 total on a measured 21-day Etsy Ads test.
6. Let agents prepare, measure, and recommend. External publishing and ad changes
   remain approval-gated until the experiment produces sales.

Success is not "more listings." Success is either:

- 3 paid orders from unrelated customers in 30 days; or
- at least 2% favorites per visit plus one order, indicating an offer worth improving.

If neither happens, stop Etsy Ads and do not build more Etsy automation.

## Implementation status — July 30

- Etsy OAuth is renewed. A read-only baseline found 28 existing listings and zero
  paid orders in the last 30 days.
- Ten $12 instant downloads are live. The original five cover Antelope Canyon,
  Iceland, Tanzania wildlife, Grand Teton, and desert dunes. Five organic-discovery
  additions cover Brooklyn Bridge, a Canadian waterfall, aerial dunes, Monument
  Valley, and a Canadian glacier. Etsy confirmed each as `download` type with five
  listing images, five delivery JPGs, 13 tags, and its Archive-35 SKU.
- Its primary image states “DIGITAL DOWNLOAD” and “NO PHYSICAL ITEM”; the public
  buyer page also shows “Digital download,” “5 JPG,” and the same warning.
- Delivery files preserve the sRGB profile and embed creator, copyright,
  personal-use terms, the Archive-35 terms URL, and a C2PA provenance notice.
- Cloud Gate was removed from the MVP because the sculpture created avoidable
  commercial-use rights risk. A desert-dunes photograph replaces it.
- Actual Etsy payment gross/fee/net facts are now collected when orders exist.
  Profit remains explicitly unverified until payment-account, refund, COGS, and ad
  spend reconciliation are complete.
- Publication is a separate command: it verifies each remote draft, reserves the
  $0.20 listing fee against the $50 authorization, publishes, and reads back the
  active state. Actual experiment spend is $2.40 in listing-fee reserves.
- Etsy Ads are active at $1/day. Etsy automatically included both bundles
  alongside the original five digital products; the five additional singles remain
  organic-only controls. A $21 campaign reservation leaves total authorized
  exposure at $23.40 and $26.60 uncommitted.
  The safety stop pauses ads at $21 actual ad spend or on August 19, whichever
  occurs first.
- A narrow daily Revenue Operator automation captures orders, actual payment facts,
  demand deltas, ad configuration, and budget status without waking unrelated
  social-posting jobs.
- The first post-launch readback shows one Etsy Ads impression, zero clicks, zero
  ad spend, and zero orders. Offsite Ads are already active with no upfront cost,
  and Etsy's existing 25% abandoned-cart and favorited-item offers remain active.
- Etsy Search Visibility identified 27 repetitive physical-listing titles. Every
  recommendation was reviewed; the flawed duplicated Venice wording was corrected,
  and all 27 clearer titles were published. An API readback confirmed the changes.
- The public Etsy shop now leads with the search-facing title “Original Photography
  Printables & Fine Art Metal Prints.” Its expired March launch-sale announcement
  was replaced with current $12 printable and premium-metal guidance.
- A `Printable Downloads` shop section (ID `59608958`) was created and all ten
  controlled digital listings were assigned to it. Etsy API readback confirmed the
  same section ID on every listing.
- The first coordinated offer, `Desert Geometry`, is live at $18 as Etsy listing
  `4546681551`. It contains three original photographs, 15 high-resolution JPEGs
  delivered in five verified ZIP files, five preview images, 13 tags, the expected
  Archive-35 SKU, and the `Printable Downloads` section assignment.
- The second coordinated offer, `Quiet Iceland`, is live at $18 as Etsy listing
  `4546706397`. It presents three complementary Vestrahorn photographs, 15
  rights-metadata-bearing JPEGs in five verified ZIP files, five approved previews,
  13 Iceland-focused tags, SKU `A35-DIG-SET-ICE-0001`, and the same shop section.
  Etsy API readback confirmed the listing and video `835502176` are active.
- Etsy Ads automatically included both bundles inside the existing $1/day campaign.
  The July 30 signed-in readback confirms seven approved advertised listings,
  three views, zero clicks, zero actual spend, and zero orders.
- A 14.4-second silent 1080×1080 H.264 listing video now presents the five approved
  bundle cards. Etsy API readback confirmed video `835525705` is active, with no
  additional listing or advertising fee.
- All ten $12 singles now have one active 14.4-second silent 1080×1080 H.264
  listing video. Every video was built from hash-approved cards, visually reviewed,
  uploaded idempotently, and read back as active through Etsy. The batch workflow
  binds the rendered MP4 to the exact approved preview hashes and refuses stale
  assets; the five older packages were explicitly re-reviewed before approval was
  renewed. This added no listing fee or advertising spend.
- A shop FAQ now explains the five delivered ratios, download timing, and that no
  physical print or frame is shipped.
- Current discovery baseline before the second batch: 33 active listings, 54
  lifetime views, zero favorites, 13 listings with zero views, zero orders, and no
  first-party website-to-Etsy click events. This is insufficient exposure to draw a
  pricing conclusion.
- A dedicated `/printables.html` acquisition page now shows all ten offers before
  the Etsy handoff. Each product links directly to its matching listing with an
  `archive35photo.etsy.com` Share & Save-formatted URL, preserves the $12 disclosure,
  and records the controlled product SKU on outbound clicks. The homepage, sitemap,
  structured data, and `llms.txt` now route discovery through this page.
- Ten build-generated product landing pages now give each printable a distinct
  search URL, factual Product structured data, an internal link from the printable
  hub, a dedicated sitemap entry, and an IndexNow submission URL.
- A dedicated Desert Geometry bundle page is live and placed first on the printable
  hub. Production verification confirmed the $18 Product schema, direct Etsy URL,
  bundle image, sitemap entry, and successful IndexNow submission.
- The focused revenue workflow passes 46 tests. The historical full suite still stops at a
  pre-existing physical-pricing import mismatch unrelated to this digital product.
- Revenue snapshots now return demand rows for every listing instead of exposing
  only the first ten ranked rows. The daily operator maps all ten controlled Etsy
  listing IDs explicitly, so an early view or favorite cannot disappear behind the
  shop's older physical inventory.
- Port 8035 now has one authoritative Docker Agent. A duplicate native Python
  process that served stale monitoring code was stopped.
- The latest revenue snapshot found 40 active/draft shop listings, zero orders,
  $0 ad spend, one ad view, no `/printables` pageviews, and no website-to-Etsy
  clicks. Actual experiment contribution is -$2.40 from listing fees. Total
  authorized exposure is $23.40, leaving $26.60 uncommitted.

Etsy currently estimates $10.41 earnings on the $12 listing before advertising and
income tax. Reaching $500 monthly contribution at this mix requires approximately
49 orders, so one product is a checkout/demand proof—not the complete assortment.

## What the audit found

### The live offer is too large for a first transaction

- A live Iceland listing is a single 48x32-inch ChromaLuxe metal print at about $762.
- Etsy places competing Iceland prints around $25-$112 on the same page.
- The Archive35Photo shop still shows zero sales and zero reviews after four months.
- The listing is well-produced, but it asks the buyer to understand ChromaLuxe,
  C2PA, print resolution, archival life, standoffs, and the artist story before
  making a high-risk purchase.

Conclusion: this is a strong high-end product presented as the only product, not a
working Etsy offer ladder.

### The existing agents publish but do not learn

- `etsy_stats_agent.py` counts local export folders, database actions, catalog size,
  and an old SEO report. It does not collect visits, favorites over time, conversion,
  orders, ad spend, revenue, contribution margin, or search terms.
- `/etsy/shop-stats` reads current aggregate views and favorites, but stores no daily
  snapshots. It cannot calculate trends or attribute a change to an outcome.
- The stored SEO report was generated March 18 and covers 31 local exports.
- The Pinterest state says zero pins created, and the referenced
  `src/integrations/pinterest.py` and Pinterest agent/output files do not exist.
- The local Agent API was offline during this audit.

Conclusion: Archive 35 has action automation, not revenue automation.

### The current Etsy SEO scoring is outdated

The local SEO report rewards filling nearly all 140 title characters. Etsy's April
2026 guidance says search now considers the complete listing and recommends clear,
easy-to-scan titles rather than keyword stuffing.

The next Etsy agent must optimize for:

- a clear product and subject in the first phrase;
- accurate attributes and category;
- 13 varied, relevant tags;
- a strong first image;
- readable descriptions that make the delivery format unmistakable;
- observed conversion, not a synthetic SEO score.

### The product economics support an entry ladder

Current verified local Pictorem cost data:

| Offer | Customer price | Approximate cost before Etsy fees | Purpose |
|---|---:|---:|---|
| Single printable download | $12 | $0 fulfillment | First purchase and review |
| Three-print digital set | $18 | $0 fulfillment | Higher-value digital offer |
| 12x8 fine-art paper | $39 | $16.52 Pictorem | Affordable physical proof |
| 12x8 ChromaLuxe metal | $100+ | $45.16 Pictorem | Premium step-up |
| Current 48x32 metal | $762 | $344.36 Pictorem | Brand/collector anchor |

At $12, standard Etsy transaction and US payment fees leave roughly $10.41 before
income tax and ads. Even a 15% Offsite Ads fee leaves positive contribution. Digital
products are therefore the safest way to buy real market evidence.

## The offer ladder

### Tier 1: Printable photograph — $12

Each listing delivers five JPG files or ZIP packages, staying within Etsy's limit of
five files and 20 MB per file:

- 2:3 ratio
- 3:4 ratio
- 4:5 ratio
- 11x14
- ISO A-series

Terms: personal-use wall display only. No resale, commercial use, or redistribution.
This must be separate from the existing $2.50/$5 commercial micro-license catalog.

The cover image must say "DIGITAL DOWNLOAD — NO PHYSICAL ITEM" without obscuring the
photograph. Subsequent images show framed room mockups, included ratios, printable
sizes, authenticity, and simple printing instructions.

### Tier 2: Curated set of three — $18

Sets should solve a decorating problem rather than merely bundle locations:

- Quiet Iceland: three pale/minimal landscapes
- Desert Geometry: three sand/rock abstracts
- Wild Tanzania: three monochrome wildlife photographs
- Pacific Weather: three ocean/storm photographs
- Modern Structure: three architecture studies

### Tier 3: Unframed fine-art paper — $39

Do not create paper listings for all 1,174 images. Promote only digital products that
earn at least one of:

- 2 sales;
- 5 favorites;
- 50 qualified visits with above-average engagement.

The buyer provides the frame. Archive 35 fulfills through Pictorem. Confirm that the
stored $16.52 cost includes every required fulfillment and shipping charge before
publishing the first physical listing.

### Tier 4: Premium metal — existing prices

Keep 10-20 of the strongest metal listings as anchors. Deactivate or allow manual
expiry for redundant expensive listings that receive no engagement. Do not delete
them in bulk.

## The four-agent revenue loop

This should be plain Python, SQLite, Huey, and the existing Etsy integration. No
LangGraph, autonomous browser farm, or new agent platform is required.

### 1. Demand Scout

Runs daily, read-only.

Inputs:

- Etsy listing views and favorites;
- receipts/orders;
- listing price, type, collection, and publish date;
- Etsy Ads CSV or manually exported report when available;
- website page views for matching images.

Output: one immutable daily snapshot per listing and a seven-day delta report.

It answers:

- Which subjects earn clicks?
- Which listings earn favorites but no purchases?
- Which offers sell?
- What did each sale cost?

### 2. Product Builder

Runs weekly and creates local draft packages only.

It:

- selects candidates from the existing catalog;
- generates the five printable aspect-ratio files;
- validates dimensions, color profile, file size, filenames, and embedded copyright;
- creates Etsy-ready mockups and a digital-download instruction sheet;
- rejects images that cannot support the promised print sizes.

It never changes `licensing-catalog.json`, `micro-licensing-catalog.json`, or
`photos.json`.

### 3. Listing Experiment Agent

Creates Etsy drafts in controlled batches of five.

For each listing it records:

- offer hypothesis;
- title/tags/first-image version;
- target buyer/search intent;
- price;
- publish timestamp;
- baseline metrics.

Only one major variable changes per experiment. No weekly rewrite of every listing.

### 4. Revenue Operator

Runs weekly and sends a three-line recommendation:

- keep: products with sales or strong favorite rate;
- change: products with visits but weak conversion;
- stop: products with no signal after sufficient exposure.

It may create drafts and pause internal work. It may not:

- publish Etsy listings without approval during the first 30 days;
- change prices or ads without approval;
- contact customers or post in communities automatically;
- spend beyond the experiment budget;
- alter Stripe, fulfillment, or production-partner settings.

## 30-day experiment

### Week 1: Prepare and launch

- Select 20 strongest images, biased toward Iceland, deserts, Tanzania, Grand Teton,
  Antelope Canyon, and strong architecture.
- Generate 20 single-image digital packages and 5 coordinated sets.
- Publish the first 10 single images and 2 sets after visual and file QA.
- Keep current premium anchors live.
- Turn on Offsite Ads if currently opted out; there is no upfront charge and digital
  margins can absorb an attributed sale fee.

### Week 2: Complete assortment and start measured ads

- Publish remaining approved digital listings.
- Run Etsy Ads only on five distinct subjects, not the entire store.
- Budget: $2/day for 21 days, hard cap $42.
- Do not judge listings by impressions alone. Track visits, favorites, orders, and
  contribution after ad cost.

### Weeks 3-4: Learn, do not flood

- Replace only listings with clear evidence of a bad first image or mismatch.
- Create paper versions only for winners.
- Generate ten Pinterest pins for the winning Etsy URLs and schedule through Buffer's
  free tier or Pinterest's native scheduler.
- Do not spend engineering time on Pinterest Standard API access during this test.

### Day 30 decision

Continue if:

- at least 3 unrelated paid orders; or
- one sale plus a repeatable high-intent engagement pattern.

Change the offer if:

- listings get visits/favorites but no orders.

Stop paid acquisition if:

- there are no sales and weak engagement after the full $42 test.

## Pinterest decision

The previous assumption that Trial API access can publish public pins was wrong.
Pinterest says Trial-created pins are sandbox entities visible only to the creator.
Standard access requires a review and an OAuth demonstration video even for a
single-user app.

For the 30-day test:

- use Buffer free (up to 10 queued posts for the Pinterest channel) or Pinterest's
  native scheduler (up to 10 future pins, 30 days ahead);
- have Archive 35 generate the images, titles, descriptions, links, and schedule;
- spend zero time rebuilding a Pinterest API client until Etsy proves an offer.

If the experiment works, apply for Standard access with a small, real integration
and the required screen recording.

## GitHub/open-source assessment

No Etsy-specific autonomous sales agent found is mature enough to trust with this
live shop.

Useful references:

- Etsy's own `etsy/open-api` and Open API documentation are the correct basis for
  listings, orders, payments, reviews, and shop data.
- Pinterest's `pinterest/api-quickstart` is useful only after Standard access.
- `langchain-ai/social-media-agent` is a human-in-the-loop Twitter/LinkedIn content
  system with substantial external dependencies; it does not solve Etsy demand.
- General social schedulers such as OpenSMM or BrightBean duplicate scheduling
  infrastructure and add operational/security surface.

Decision: reuse patterns, not platforms. The current Archive 35 stack already has
the correct safety primitives, Etsy OAuth, listing creation, SQLite, scheduling,
mockups, and approval UI. The missing code is a small measurement and experiment
layer.

## Build order if approved

1. Repair Etsy authentication and bring Agent API health back.
2. Replace the fake weekly stats report with persistent daily Etsy snapshots.
3. Add revenue, fee, ad-spend, and contribution-margin tables.
4. Build one digital package generator for one image and verify every delivered file.
5. Add digital-draft creation to the existing Etsy integration.
6. Test one private/draft listing end to end.
7. Produce the first five-product review batch.
8. Only after approval, publish and start the capped experiment.

No website deployment or catalog rewrite is required for steps 1-7.

## Sources checked

- Live Archive35Photo Etsy listings and live archive-35.com pages, July 29, 2026
- Etsy Fees & Payments Policy
- Etsy: How to Create a Listing
- Etsy: How to Manage Your Digital Listings
- Etsy Seller Handbook: New Guidance for Listing Titles, April 27, 2026
- Etsy Seller Handbook: How Etsy Search Works
- Etsy Open API v3 documentation and reference
- Pinterest API access tiers and API quickstart
- Pinterest Business scheduling documentation
- Buffer plan documentation
- GitHub repositories noted above
