# Archive-35 System Architecture

## Data Flow

```
[Camera/Lightroom]
        ↓
[Export JPG/TIFF to 00_Inbox/]
        ↓
[Archive-35 Studio: Ingest]
  • Extract EXIF
  • AI descriptions (Claude API)
  • Assign to gallery
  • Resize for web
        ↓
[01_Portfolio/gallery-name/]
  • originals/ (full res, never modified)
  • web/ (resized for website)
  • _photos.json (metadata)
        ↓
[Archive-35 Studio: Deploy]
  • Generate website pages
  • Push to GitHub
  • Run tests
        ↓
[GitHub Pages]
  • https://archive-35.com
        ↓
[Pictorem Sync]
  • Upload originals via API
  • Get pricing and product URLs
  • Submit orders via artflow API
        ↓
[Social Media Automation]
  • Generate posts from templates
  • Schedule 2x daily
  • Post to: Instagram, Facebook, TikTok, LinkedIn, X, Bluesky
        ↓
[Analytics Collection]
  • Pull metrics from all platforms
  • Generate daily report
  • Email summary to wolfbroadcast@gmail.com
```

## Component Details

### 00_Inbox/
Drop zone for new photos. Studio app monitors this folder.

### 01_Portfolio/
```
01_Portfolio/
├── _master.json          # Index of all galleries
└── Gallery_Name/
    ├── _gallery.json     # Gallery metadata
    ├── _photos.json      # Photo metadata array
    ├── originals/        # Full resolution (never modified)
    └── web/              # Optimized for website
        ├── *-thumb.jpg   # 400px thumbnails
        └── *-full.jpg    # 1600px display size
```

### 04_Website/
```
04_Website/
├── src/                  # Source files (development)
└── dist/                 # Production build (deployed)
    ├── index.html
    ├── gallery.html
    ├── css/styles.css
    ├── js/main.js
    ├── data/photos.json
    ├── images/
    ├── CNAME
    └── .nojekyll
```

### 05_Studio/
Archive-35 Studio desktop app (Electron + React)

### 06_Automation/
```
06_Automation/
├── mcp-servers/
│   ├── social-poster/       # Post to social platforms
│   ├── analytics-collector/ # Gather metrics
│   ├── pictorem-sync/       # Sync with Pictorem (POD)
│   └── content-processor/   # AI content generation
└── scripts/                 # Utility scripts
```

## External Services

| Service | Purpose | Auth |
|---------|---------|------|
| GitHub Pages | Website hosting | GitHub token |
| Pictorem | Print fulfillment (POD) | API key (artFlowKey) |
| Claude API | AI descriptions | API key |
| Instagram | Social posting | Graph API |
| Meta (FB) | Social posting | Graph API |
| TikTok | Social posting | API key |
| LinkedIn | Social posting | OAuth |
| X (Twitter) | Social posting | OAuth |
| Bluesky | Social posting | App password |

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop App | Electron + React |
| Backend Scripts | Python 3.x |
| Image Processing | Pillow, sips, exiftool |
| AI | Claude API (Anthropic) |
| Website | Static HTML/CSS/JS |
| Hosting | GitHub Pages |
| Domain | Squarespace (DNS only) |
| Print Fulfillment | Pictorem (REST API) |
| Social APIs | Meta, TikTok, LinkedIn, X, Bluesky |
| Analytics | Google Analytics |
| Server | MacBook Pro 2016 (local automation) |

## Server Machine Specs

- Model: MacBook Pro 15" 2016
- CPU: 2.9GHz Intel Core i7
- RAM: 16GB
- Storage: 2TB SSD
- Role: Run automation scripts, MCP servers, cron jobs
- Location: Wolf's desk, always on

## Sync Architecture

All files live in Google Drive (15TB cloud storage).
Both machines sync via Google Drive.

```
[Main Mac] ←→ [Google Drive] ←→ [Server MacBook Pro]
     ↓                                    ↓
  Editing                            Automation
  Exporting                          Posting
  Studio App                         Analytics
```

## Deployment Pipeline

1. **Local changes** → Edit in 04_Website/src/
2. **Build** → Copy to 04_Website/dist/
3. **Commit** → `git add . && git commit`
4. **Push** → `git push origin main`
5. **Live** → GitHub Pages auto-deploys

---
Last updated: 2026-02-04
