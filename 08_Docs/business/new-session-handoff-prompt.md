## Context: Archive-35.com — Fine Art Photography Business

I'm Wolf Schram, VP of Engineering (25+ years broadcast/AV/enterprise tech), building Archive-35.com as a fine art photography e-commerce business. I have ADHD/dyslexia — keep things scannable with bullet points and clear hierarchy. Default to .docx for documents. I'm bilingual German/English but prefer English responses. Frame leadership topics through my servant leadership philosophy.

---

### CRITICAL: Read These Files First
Before doing ANYTHING, read these files to understand the full project context:
- `08_Docs/ARCHITECTURE.md` — Complete system architecture (63KB)
- `08_Docs/business/archive35-edd-execution-guide.docx` — EDD guide (already filed, DONE)
- `08_Docs/business/archive35-addendum-tax-selfemployment.docx` — Tax obligations reference
- `05_Business/pricing.md` — Pricing strategy (DRAFT)
- `05_Business/legal_notes.md` — Legal checklist
- `.env` — Check what API keys are configured vs empty

---

### What's Already Built (Sessions 1-7):

**Website (archive-35.com)**
- Cloudflare Pages, auto-deploys on git push to main
- 3 collections live: Grand Teton (48 photos), Africa (44), New Zealand (16) + South Africa (6)
- 9 HTML pages with GA4 tracking (G-SE2WETEK5D) + Cloudflare Web Analytics beacon
- SEO: Schema.org JSON-LD, sitemap.xml, Open Graph tags, robots.txt
- Legal: Privacy policy, Terms of service pages

**Studio Desktop App (05_Studio/app/)**
- Electron + React (CRA), runs with `cd 05_Studio/app && npm run dev`
- Pages: Ingest, Manage, Website (service health matrix), Sales, Social, Analytics, Settings
- Photo ingest pipeline: EXIF extraction → Claude AI metadata → review → web resize → C2PA signing → R2 upload → deploy
- Analytics dashboard: Real Stripe revenue + Cloudflare Web Analytics + GA4 config status
- Service health matrix: GitHub, Cloudflare, Stripe, R2, C2PA, Anthropic status checks
- Deploy button: Compiles photos.json, copies images, git commit + push
- API key management UI in Settings
- Test/Live mode toggle

**E-commerce Pipeline**
- Stripe checkout sessions → Cloudflare Functions → Pictorem print fulfillment
- Products: Canvas, metal, acrylic, paper, wood prints
- Stripe keys: LIVE mode configured (sk_live_..., pk_live_...)
- Stripe TEST mode also configured for development
- Pictorem API integrated for order fulfillment

**AI & Automation**
- MCP server (cloud) for AI agent catalog access
- OpenAI Agentic Commerce Protocol endpoints
- Claude API (Anthropic) for AI photo metadata generation during ingest
- Photo Quality MCP Server: FastMCP with 4 tools (sharpness, noise, dynamic range, print readiness)

**Content Protection**
- C2PA Content Credentials embedded in all 108+ full-size photographs
- c2patool integrated into ingest pipeline (auto-signs web-optimized images)

**Storage**
- Cloudflare R2 bucket (archive-35-originals): High-res originals for Pictorem fulfillment
- GitHub repo: Source code + deployed web images + data/photos.json
- Local: 01_Portfolio/ organized by collection with originals/, web/, _gallery.json, _photos.json

**Analytics (configured this session)**
- GA4 Property: Archive-35 (Property ID: 523662516, Measurement ID: G-SE2WETEK5D, Stream ID: 13580866536)
- GA4 tracking code deployed to all 9 HTML pages
- Cloudflare Web Analytics: Auto-injected beacon (site tag: 951402c170604a77bedfd24b90e2ec0d)
- Cloudflare Analytics API token created (Read analytics & logs scope)
- Studio Analytics page: Fetches real data from Stripe API + Cloudflare GraphQL API
- Studio Analytics page: GA4 config display (Data API needs Google Cloud service account — deferred)

---

### Environment Configuration (.env — what's set up):

**CONFIGURED:**
- Pictorem (print fulfillment) — API key, username, URL
- Stripe LIVE — secret + publishable keys
- Stripe TEST — secret + publishable keys
- Anthropic — API key (Claude)
- Cloudflare R2 — account ID, access key, secret key, endpoint, bucket name
- Google Analytics — measurement ID (G-SE2WETEK5D) + property ID (523662516)
- Cloudflare Analytics — API token + zone tag
- Resend — email API key
- SMTP — host/port/user configured (password empty)
- R2 signing secret for serve-original URLs

**NOT YET CONFIGURED (empty in .env):**
- GitHub Token
- Meta (Instagram/Facebook) — App ID, secret, access token
- TikTok — client key, secret, access token
- LinkedIn — client ID, secret, access token
- X/Twitter — API keys and tokens
- Bluesky — handle and app password
- SMTP Password

---

### Google Workspace Status:
- Account: wolf@archive-35.com (Google Workspace Business Plus, 5 TB storage)
- schramfamily.com is primary domain (can't change — purchased during signup)
- archive-35.com is secondary domain but used for everything
- Google Drive switched to Stream mode (cloud-only)
- wolfbroadcast@gmail.com is separate personal Gmail

---

### Git Commits (most recent first):
```
8de5784 feat: wire real Stripe + Cloudflare analytics into Studio dashboard
fe74531 chore: clean up GA4 HTML comments
c2cd381 feat: activate GA4 tracking — Measurement ID G-SE2WETEK5D
d4c5434 feat: Studio deploy dashboard, analytics, ingest workflow fixes, South Africa SEO
c2c3047 Deploy: add South Africa collection — 6 photos
84e607b Deploy: add South Africa collection — 6 photos
44d3a7c feat: complete Photo Quality MCP server
e098375 feat: add C2PA auto-signing to ingest, fix Artelo refs, R2 delete
41eb921 feat: add OpenAI Agentic Commerce Protocol endpoints
1a5a52b feat: embed C2PA Content Credentials in all 108 full-size photographs
10dd4f2 feat: add MCP server for AI agent catalog access
```

---

### Personal / Employment Situation:

- **Former Employer:** One Diversified, LLC (VP Engineering)
- **Last Day Worked:** January 30, 2026
- **Severance:** $60,144 lump sum (12 weeks base salary), tied to Release of Claims
- **Company will NOT contest unemployment claim** (per agreement)
- **Spouse:** Lucy (physician at Kaiser — health insurance covered)
- **Location:** Santa Clarita, CA (Los Angeles County)
- **Outplacement:** Right Management Consultants (90 days, deadline May 1, 2026)

---

### COMPLETED TASKS (Don't redo these):

- ✅ **EIN (Federal)** — ISSUED Feb 9, 2026, EIN: 41-4155701, Sole Proprietor, Trade Name: Archive-35
- ✅ **EDD Unemployment Claim** — FILED AND SUBMITTED, done
- ✅ **GA4 Property Created** — Archive-35, property 523662516
- ✅ **GA4 Tracking Deployed** — All 9 HTML pages, measurement ID G-SE2WETEK5D
- ✅ **Cloudflare Web Analytics** — Enabled, auto-beacon for Pages site
- ✅ **Cloudflare Analytics API Token** — Created with read analytics & logs scope
- ✅ **Studio Analytics Dashboard** — Real Stripe + Cloudflare data, committed
- ✅ **South Africa Collection** — 6 photos deployed to website
- ✅ **C2PA Content Credentials** — All 108 images signed
- ✅ **Photo Quality MCP Server** — Complete with 4 analysis tools
- ✅ **EDD Execution Guide** — Written (08_Docs/business/archive35-edd-execution-guide.docx)
- ✅ **Tax/Self-Employment Addendum** — Written (08_Docs/business/archive35-addendum-tax-selfemployment.docx)
- ✅ **Tax Tracker Spreadsheet** — Created (08_Docs/business/archive35-tax-tracker.xlsx)
- ✅ **Stripe Integration** — Live mode keys configured, checkout working
- ✅ **R2 Storage** — Bucket configured, upload pipeline working
- ✅ **Studio App** — All core features working (ingest, manage, deploy, settings, analytics)
- ✅ **CA Seller's Permit** — APPROVED Feb 9, 2026, Account 108-510160, Tax ID 226-961760, Annual filer

---

### NEXT TASKS (Priority Order — Dependencies Matter):

**1. Apply for EIN (Federal) — DONE Feb 9, 2026**
- EIN: 41-4155701
- Sole Proprietor, Trade Name: Archive-35
- CP 575 confirmation letter downloaded (PDF)
- Note: IRS record shows name as "WOLFGANG SCHRAM GUSTAVO SCHRAM" — correct name is Wolfgang Gustavo Schram

**2. CA Seller's Permit (CDTFA) — DONE Feb 9, 2026**
- Account ID: 108-510160, Sales & Use Tax ID: 226-961760
- Confirmation #: 0-055-210-747
- NAICS: 541921 (Photography Studios, Portrait)
- Annual filer, period ending Dec 31, 2026
- Portal login: wolf@archive-35.com
- Full report: `05_Business/Tax_Paperwork/CA_Sellers_Permit_Report.md`

**3. File DBA (Fictitious Business Name) — "Archive-35"**
- URL: https://www.lavote.gov/home/county-clerk/fictitious-business-names
- Cost: ~$26 filing + ~$40-80 newspaper publication
- Must publish in local newspaper within 30 days (4 consecutive weeks)
- Then file Proof of Publication with County Clerk

**4. Santa Clarita Home Occupation Permit**
- Contact: (661) 255-4330 or visit 23920 Valencia Blvd, Suite 140
- URL: https://santaclarita.gov/planning/
- Describe: online fine art print sales from home, no foot traffic, no signage

**5. Open Business Bank Account**
- Need: EIN confirmation (CP 575) + DBA receipt + photo ID + proof of address
- Separate from personal banking
- Chase, BofA, or credit union

**6. Complete Stripe Activation**
- Connect business bank account for payouts
- Enable Stripe Tax: Settings → Tax → add CA registration (CDTFA permit number)
- Set product tax code: Artwork / Photography prints
- Verify all business details

**7. Quarterly Tax Setup**
- Set up quarterly estimated tax payments (federal + CA)
- IRS Direct Pay: https://www.irs.gov/payments
- CA FTB Web Pay: https://www.ftb.ca.gov/
- Due dates: Apr 15, Jun 15, Sep 15, Jan 15
- Rule of thumb: Set aside 40% of Stripe payouts for taxes

**8. GA4 Data API Setup (deferred)**
- Needs Google Cloud service account with JSON key
- Would enable real GA4 metrics in Studio Analytics dashboard
- Currently showing config info only — Cloudflare covers traffic metrics for now

---

### ALSO ON THE RADAR (Not Urgent):

- **Social Media Accounts**: Instagram, TikTok, X, LinkedIn, Bluesky — all empty in .env
- **South Africa C2PA**: Photos need re-processing through Studio for C2PA content credentials
- **South Africa R2**: Originals need upload to R2 for Pictorem fulfillment
- **Email Automation**: SMTP password needed for daily reports; Resend configured for order confirmations
- **Pricing Strategy**: Draft in 05_Business/pricing.md — needs finalization
- **Copyright Registration**: TBD per 05_Business/legal_notes.md
- **Newsletter/Email Marketing**: Not yet set up

---

### KEY FINANCIAL REFERENCES:

**EDD Benefits While Self-Employed:**
- CA allows running a business while collecting unemployment
- Weekly benefit max: ~$450/week
- 25% earnings disregard ($112.50)
- Report GROSS revenue (not net profit) during bi-weekly certification
- Even if you earn too much for benefits, keep certifying to maintain active claim

**Tax Obligations:**
- Self-employment tax: 15.3% of net profit
- Federal income tax: ~24% marginal (joint with Lucy)
- CA state income tax: ~9.3% marginal (joint with Lucy)
- Sales tax: ~9.5% in Santa Clarita (collect from CA buyers, remit to CDTFA quarterly)
- Net loss in year 1 offsets household income on joint return

**Important Dates:**
- May 1, 2026 — Outplacement services deadline (Right Management)
- Apr 15, 2026 — Q1 estimated tax payment due
- Apr 30, 2026 — Q1 CDTFA sales tax return due

---

### HOW TO START THE NEXT SESSION:

Please start by reading the architecture doc and .env file, then help me with the NEXT TASKS list above, starting with the EIN application. Each task depends on the previous one (EIN → Seller's Permit → DBA → Bank Account → Stripe Activation → Tax Setup).

I'll tell you which tasks I've completed between sessions. Pick up from wherever we left off.
