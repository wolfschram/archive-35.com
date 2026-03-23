# ARCHIVE-35 SOCIAL MEDIA — Complete Build Instructions

> **What this file is**: The single source of truth for building the Archive-35 Social Media application.  
> **Who reads this**: Claude Desktop on the M3 Max, building the app that will run on the i7 MacBook Pro.  
> **Location**: `iCloud Drive/Shared for Archive 35/BUILD_INSTRUCTIONS.md`  
> **Author**: Generated Feb 2026 from architecture sessions with Wolf Schram.

---

## TABLE OF CONTENTS

1. [What We're Building](#1-what-were-building)
2. [Two-Machine Architecture](#2-two-machine-architecture)
3. [Folder Structure — Real Paths](#3-folder-structure--real-paths)
4. [The Application — Archive-35 Social Media](#4-the-application--archive-35-social-media)
5. [Core Pipeline — How Videos Get Made](#5-core-pipeline--how-videos-get-made)
6. [Gallery Data Format](#6-gallery-data-format)
7. [Handshake Protocol — Studio ↔ Social Media](#7-handshake-protocol--studio--social-media)
8. [Scheduling & Calendar System](#8-scheduling--calendar-system)
9. [Social Media Platform Integration](#9-social-media-platform-integration)
10. [i7 Intel Mac Optimization](#10-i7-intel-mac-optimization)
11. [Technology Stack](#11-technology-stack)
12. [Build Order — Step by Step](#12-build-order--step-by-step)
13. [Claude Desktop Prompt](#13-claude-desktop-prompt)

---

## 1. WHAT WE'RE BUILDING

**Archive-35 Social Media** is a standalone Python application (with a web dashboard) that:

- Generates gallery flythrough videos from photography automatically
- Composites real photos into pre-rendered AE template frames
- Adds an ambient audio track
- Camera flies through a dark gallery and lands on a final hero photo for 2 seconds
- Renders H.264 MP4 videos for 8 social media platforms
- Schedules and posts content on a calendar (twice daily)
- Runs 24/7 unattended on the i7 Intel MacBook Pro
- Communicates with Archive-35 Studio via a shared iCloud Drive folder

**After Effects is NEVER used at runtime.** AE was used once to create PNG template sequences. Everything else is Python + FFmpeg + Pillow.

---

## 2. TWO-MACHINE ARCHITECTURE

| | M3 Max MacBook Pro | i7 Intel MacBook Pro (2016) |
|---|---|---|
| **CPU** | Apple M3 Max | 2.9GHz Intel Core i7 |
| **RAM** | (primary workstation) | 16GB |
| **Storage** | 15TB photo collection | 2TB SSD |
| **Role** | Creative hub | Automation server |
| **Software** | Archive-35 Studio (Electron + React) | Archive-35 Social Media (Python + Flask) |
| **Runs** | When Wolf is working | 24/7 unattended |
| **Photo access** | Direct (local drive) | Via iCloud Drive sync |

**Shared folder (iCloud Drive)** syncs between both machines automatically. This is the communication channel. No network mounts, no SMB — iCloud handles it.

---

## 3. FOLDER STRUCTURE — REAL PATHS

The iCloud Drive path on macOS is:
```
~/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35/
```

For readability, we'll call this `$SHARED/` in this document.

### Current structure (from Wolf's screenshot, Feb 11 2026):

```
$SHARED/
├── A35_PNG Seqs/                    ← AE template PNG sequences go here
│   ├── portrait/                    ← 1080x1920 frames + positions.json
│   ├── widescreen/                  ← 1920x1080 frames + positions.json
│   └── square/                      ← 1080x1080 frames + positions.json
│
├── Photography/                     ← 26 gallery folders (THE photo library)
│   ├── Antilope Canyon/
│   ├── Argentina/
│   ├── Australia/
│   ├── Black and White/
│   ├── Brazil/
│   ├── Chicago/
│   ├── Colorado/
│   ├── Concerts/
│   ├── Death Valley/
│   ├── Desert Dunes/
│   ├── Flowers and Leaves/
│   ├── Grand Teton/
│   ├── Iceland/
│   ├── Lake Powell/
│   ├── Large Scale...aphy Stitch/
│   ├── London/
│   ├── Los Angeles/
│   ├── Monument Valley/
│   ├── New Zealand/
│   ├── Paris/
│   ├── Planes/
│   ├── Random stuff/
│   ├── South Africa/
│   ├── Tanzania/
│   ├── Utha National Parks/
│   └── Valley of Fire/
│
├── BUILD_INSTRUCTIONS.md            ← THIS FILE
├── Archive35-F...y-Spec.docx        ← Existing specs
├── 75D4C2C...DATES.xlsx             ← Existing reference
└── cloud prod...OC needs             ← Existing reference
```

### Folders the Social Media app will CREATE inside $SHARED/:

```
$SHARED/
├── social_media_app/                ← THE APPLICATION (Python source code)
│   ├── app.py                       ← Main Flask app + web dashboard
│   ├── compositor.py                ← Frame compositing engine (Pillow)
│   ├── renderer.py                  ← FFmpeg video rendering
│   ├── scheduler.py                 ← Calendar + scheduling engine
│   ├── gallery_scanner.py           ← Reads Photography/ folder
│   ├── post_generator.py            ← Captions, hashtags, links
│   ├── platform_poster.py           ← Social media API integration
│   ├── handshake.py                 ← Studio ↔ Social Media communication
│   ├── config.py                    ← All configuration
│   ├── requirements.txt             ← Python dependencies
│   ├── static/                      ← Web dashboard CSS/JS
│   ├── templates/                   ← Flask HTML templates (Jinja2)
│   └── README.md                    ← How to install and run
│
├── audio/                           ← Ambient audio track(s)
│   └── (empty — Wolf adds this later)
│
├── output/                          ← Rendered videos ready to post
│   ├── 2026-02-11/                  ← Organized by date
│   │   ├── instagram_reels_tokyo_streets.mp4
│   │   ├── youtube_tokyo_streets.mp4
│   │   └── ...
│   └── ...
│
├── logs/                            ← Posting history, errors, schedule log
│   ├── posting_history.json
│   ├── schedule.json
│   └── error.log
│
├── config/                          ← API keys, platform credentials
│   ├── platforms.json               ← Social media API keys (added later)
│   └── settings.json                ← App settings
│
└── handshake/                       ← Studio ↔ Social Media sync
    ├── studio_status.json           ← Written by Studio app
    ├── social_status.json           ← Written by Social Media app
    └── gallery_queue.json           ← Galleries queued by Studio for posting
```

---

## 4. THE APPLICATION — ARCHIVE-35 SOCIAL MEDIA

### Architecture: Python + Flask + Web Dashboard

**Why this stack** (not Electron):
- Runs headless on the i7 — no GUI needed most of the time
- Web dashboard accessible from ANY device (phone, M3 Max, iPad)
- Python is native on macOS, no Node/npm drama
- Flask is lightweight, perfect for a local dashboard
- FFmpeg and Pillow are the industry standard for this work
- Optimized for Intel i7 (no M-series specific code)

### Web Dashboard Features

The dashboard runs at `http://[i7-ip]:8035` and provides:

1. **Status Panel** — Is the service running? Last video rendered? Next scheduled post?
2. **Calendar View** — Full posting calendar. Shows what's scheduled, what's posted, what failed.
3. **Gallery Browser** — See all 26 galleries, preview photos, manually trigger a video for any gallery.
4. **Render Queue** — What's being rendered right now, estimated time, progress bar.
5. **Post History** — Timeline of all posts across all platforms with links.
6. **Settings** — Configure schedule times, platform credentials, audio track, template selection.
7. **Handshake Status** — Green/red indicators showing Studio ↔ Social Media connectivity.

### Dashboard Design

Match the Archive-35 Studio aesthetic:
- Dark background (#0a0a0a)
- White/light gray text
- Minimal, gallery-like design
- No clutter — Wolf has ADHD, keep it scannable
- Large status indicators (green = good, red = needs attention)
- Cards-based layout, not dense tables

---

## 5. CORE PIPELINE — HOW VIDEOS GET MADE

### Step 1: Gallery Selection
```python
# Scan $SHARED/Photography/ for gallery folders
# Each subfolder = one gallery
# Selection: round-robin rotation, or manual override via dashboard
# Skip galleries with fewer than 8 photos (minimum for portrait template)
```

### Step 2: Photo Selection
```python
# From chosen gallery, pick N random photos:
#   Portrait template:   8 photos
#   Square template:    10 photos
#   Widescreen template: 14 photos
# Last photo = hero (highest resolution or marked in gallery.json)
# Read dimensions with Pillow to ensure valid images
# Supported formats: .jpg, .jpeg, .png, .tiff, .tif
```

### Step 3: Frame Compositing (THE CORE ENGINE)
```python
# For each frame in the PNG template sequence:
#
# 1. Load template frame (PNG with alpha) from A35_PNG Seqs/
# 2. Load position map (positions.json) — knows where green placeholders are
# 3. Create a background canvas (black, same size as template)
# 4. For each photo position on this frame:
#    a. Scale the selected photo to fit the position dimensions
#    b. Apply rotation if specified
#    c. Paste onto the background canvas at the correct coordinates
# 5. Composite template frame ON TOP of the photo canvas
#    (template alpha lets photos show through green placeholder areas)
# 6. Save composited frame as PNG
#
# This uses Pillow (PIL) — no video software needed
# On the i7: ~450 frames takes 2-4 minutes
```

### Step 4: Video Rendering
```python
# FFmpeg stitches composited frames into H.264 MP4:
#
# ffmpeg -framerate 30 \
#   -i composited_frames/frame_%04d.png \
#   -i $SHARED/audio/archive35_ambient.wav \
#   -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
#   -c:a aac -b:a 192k \
#   -af "afade=t=in:d=1,afade=t=out:st={duration-2}:d=2" \
#   -shortest \
#   $SHARED/output/{date}/{platform}_{gallery_slug}.mp4
#
# NOTE: -preset medium (not slow/slower) for i7 performance
# Audio: 1s fade-in, 2s fade-out, trimmed to video length
# If no audio file exists yet, render video without audio (silent)
```

### Step 5: Post Generation
```python
# Per platform, generate:
#   - Caption: gallery name + location + artistic description
#   - Hashtags: gallery-specific + #archive35 #therestlesseye #photography
#   - Link: archive-35.com/galleries/{slug} (for platforms that allow links)
#   - Output as JSON sidecar: {video_filename}.json
```

### Step 6: Social Media Posting (PHASE 2 — not built initially)
```python
# Manual first: render video, user downloads from dashboard and posts manually
# Automated later: Meta Graph API, YouTube Data API, Twitter/X API, LinkedIn API
# Platform credentials stored in $SHARED/config/platforms.json
```

---

## 6. GALLERY DATA FORMAT

Each gallery folder in `$SHARED/Photography/` contains image files. The Social Media app scans these directly — **no manifest file required** to start.

### Basic Mode (works now):
```
Photography/Tokyo Streets/
├── IMG_0001.jpg
├── IMG_0002.jpg
├── IMG_0003.jpg
└── ... (any .jpg, .jpeg, .png, .tiff files)
```
The app scans, finds images, picks randomly, generates captions from folder name.

### Enhanced Mode (when Studio writes gallery.json):
```
Photography/Tokyo Streets/
├── gallery.json          ← Optional, written by Studio
├── IMG_0001.jpg
├── IMG_0002.jpg
└── ...
```

**gallery.json format:**
```json
{
  "name": "Tokyo Streets",
  "location": "Tokyo, Japan",
  "description": "Neon-lit crosswalks and quiet alleyways in the world's largest city",
  "hashtags": ["#tokyo", "#streetphotography", "#japan", "#nightphotography"],
  "hero_image": "IMG_0042.jpg",
  "website_url": "https://archive-35.com/galleries/tokyo-streets",
  "date_shot": "2019-03",
  "mood": "urban, nocturnal, electric"
}
```

If `gallery.json` exists, the app uses it for richer captions and metadata. If not, it falls back to folder name only. **Both modes must work.**

---

## 7. HANDSHAKE PROTOCOL — STUDIO ↔ SOCIAL MEDIA

The two apps communicate through files in `$SHARED/handshake/`:

### social_status.json (written by Social Media app every 60 seconds):
```json
{
  "app": "archive35-social-media",
  "version": "1.0.0",
  "status": "running",
  "last_heartbeat": "2026-02-11T13:30:00Z",
  "machine": "i7-macbook-pro",
  "current_task": "idle",
  "last_render": {
    "gallery": "Tokyo Streets",
    "platform": "instagram_reels",
    "timestamp": "2026-02-11T09:00:00Z",
    "success": true
  },
  "next_scheduled": {
    "time": "2026-02-11T18:00:00Z",
    "gallery": "Grand Teton",
    "platforms": ["instagram_reels", "youtube"]
  },
  "stats": {
    "videos_rendered_today": 4,
    "posts_made_today": 2,
    "galleries_available": 26,
    "errors_today": 0
  }
}
```

### studio_status.json (written by Studio app):
```json
{
  "app": "archive35-studio",
  "version": "0.1.0",
  "status": "running",
  "last_heartbeat": "2026-02-11T13:25:00Z",
  "machine": "m3-max",
  "galleries_updated": ["Tokyo Streets"],
  "last_gallery_sync": "2026-02-11T12:00:00Z"
}
```

### gallery_queue.json (Studio queues galleries for posting):
```json
{
  "queue": [
    {
      "gallery": "Iceland",
      "priority": "high",
      "platforms": ["all"],
      "queued_at": "2026-02-11T10:00:00Z",
      "queued_by": "studio"
    }
  ]
}
```

The Social Media app checks `studio_status.json` to know Studio is alive. Studio checks `social_status.json` to confirm the automation server is running. Simple, file-based, no networking required — iCloud syncs it.

---

## 8. SCHEDULING & CALENDAR SYSTEM

### Default Schedule
- **Morning post**: 9:00 AM PST
- **Evening post**: 6:00 PM PST
- Each post generates videos for all configured platforms

### Calendar Data (stored in $SHARED/logs/schedule.json):
```json
{
  "schedule": {
    "timezone": "America/Los_Angeles",
    "daily_posts": [
      { "time": "09:00", "label": "Morning" },
      { "time": "18:00", "label": "Evening" }
    ]
  },
  "calendar": [
    {
      "date": "2026-02-11",
      "posts": [
        {
          "time": "09:00",
          "gallery": "Tokyo Streets",
          "platforms": ["instagram_reels", "youtube", "facebook"],
          "status": "posted",
          "videos": [
            "output/2026-02-11/instagram_reels_tokyo_streets.mp4",
            "output/2026-02-11/youtube_tokyo_streets.mp4",
            "output/2026-02-11/facebook_tokyo_streets.mp4"
          ]
        },
        {
          "time": "18:00",
          "gallery": "Grand Teton",
          "platforms": ["instagram_reels", "youtube", "facebook"],
          "status": "scheduled"
        }
      ]
    }
  ]
}
```

### Calendar in Web Dashboard
- Month view showing all scheduled/completed posts
- Color coding: green = posted, yellow = scheduled, red = failed
- Click any day to see details, override gallery, add/remove platforms
- Gallery rotation is automatic but can be manually overridden

---

## 9. SOCIAL MEDIA PLATFORM INTEGRATION

### Platform Specs

| Platform | Format | Dimensions | Duration | Links? |
|----------|--------|-----------|----------|--------|
| Instagram Reels | Portrait 9:16 | 1080×1920 | 15s | No (watermark) |
| TikTok | Portrait 9:16 | 1080×1920 | 15s | No (bio link) |
| YouTube | Widescreen 16:9 | 1920×1080 | 30s | Yes (description) |
| YouTube Shorts | Portrait 9:16 | 1080×1920 | 15s | Yes (description) |
| Facebook | Widescreen 16:9 | 1920×1080 | 30s | Yes (post text) |
| Instagram Feed | Square 1:1 | 1080×1080 | 15s | No (watermark) |
| LinkedIn | Widescreen 16:9 | 1920×1080 | 30s | Yes (post text) |
| X/Twitter | Widescreen 16:9 | 1920×1080 | 30s | Yes (tweet) |

### API Integration (Phase 2 — build the structure now, fill in later)
```python
# Platform poster is a plugin system:
# platform_poster.py has a base class and per-platform subclasses
# Each platform reads credentials from $SHARED/config/platforms.json
# If no credentials exist for a platform, skip it silently
# Manual mode: just render the video, user downloads and posts
```

---

## 10. i7 INTEL MAC OPTIMIZATION

The app MUST be optimized for the Intel i7 (not M-series):

- **FFmpeg preset**: Use `-preset medium` (not `slow` or `slower`)
- **Pillow**: Use standard Pillow, not pillow-simd (doesn't support Intel well)
- **NumPy**: Use standard numpy (not Apple Accelerate builds)
- **Parallel processing**: Use `multiprocessing` for frame compositing, but limit to 4 workers (i7 has 4 cores + HT)
- **Memory**: Limit to 8GB working set (leave 8GB for macOS + iCloud sync)
- **Disk I/O**: Temp files go to `/tmp/archive35/` (local SSD), not iCloud folder
- **Python version**: 3.10+ (whatever `brew install python` gives)
- **Launch at boot**: Use `launchd` plist for auto-start on login
- **Dashboard port**: 8035 (http://localhost:8035 or http://[i7-ip]:8035)

---

## 11. TECHNOLOGY STACK

| Layer | Technology | Why |
|-------|-----------|-----|
| Application | Python 3.10+ | Universal, no compilation needed |
| Web Dashboard | Flask + Jinja2 + vanilla JS | Lightweight, no build step |
| Frame Compositing | Pillow (PIL) + NumPy | Fast, reliable, Intel compatible |
| Video Rendering | FFmpeg (CLI via subprocess) | Industry standard, free |
| Scheduling | APScheduler | Python-native cron-like scheduler |
| Data Storage | JSON files in iCloud folder | No database needed, syncs automatically |
| Auto-start | launchd plist | macOS native, reliable |
| Social APIs | Requests + per-platform modules | Simple HTTP, no heavy SDKs |

### Python Dependencies (requirements.txt):
```
flask>=3.0
pillow>=10.0
numpy>=1.24
apscheduler>=3.10
requests>=2.31
python-dateutil>=2.8
```

### System Dependencies (brew):
```
brew install python ffmpeg
```

---

## 12. BUILD ORDER — STEP BY STEP

Build in this exact order. Each step should be testable before moving to the next.

### Phase 1: Foundation
1. **Create folder structure** inside `$SHARED/`
2. **gallery_scanner.py** — Scan `Photography/` folder, list galleries, count images per gallery
3. **config.py** — All paths, settings, defaults
4. **Test**: Run scanner, confirm it sees all 26 galleries

### Phase 2: Compositing Engine
5. **compositor.py** — Load PNG template frames, load position map, composite photos into frames
6. **Test**: Composite ONE frame with ONE photo, save result, visually verify

### Phase 3: Video Rendering
7. **renderer.py** — FFmpeg wrapper: frames → MP4, with/without audio
8. **Test**: Render a 5-second test video from composited frames

### Phase 4: Web Dashboard
9. **app.py** — Flask app with status, gallery browser, manual trigger
10. **templates/** — HTML templates for dashboard
11. **static/** — CSS/JS for dark theme
12. **Test**: Open dashboard in browser, browse galleries, trigger a render

### Phase 5: Scheduling
13. **scheduler.py** — APScheduler with configurable posting times
14. **Calendar view** in dashboard
15. **Test**: Schedule a post 2 minutes from now, confirm it triggers

### Phase 6: Post Generation
16. **post_generator.py** — Captions, hashtags, links per platform
17. **Test**: Generate post content for one gallery, verify output

### Phase 7: Handshake
18. **handshake.py** — Write social_status.json, read studio_status.json
19. **Handshake panel** in dashboard
20. **Test**: Confirm status files update, Studio can read them

### Phase 8: Auto-start
21. **launchd plist** — Auto-start on boot
22. **Test**: Reboot i7, confirm app starts and dashboard is accessible

### Phase 9: Social Media APIs (LATER)
23. **platform_poster.py** — Plugin system, manual mode first
24. **Per-platform modules** — Added as Wolf signs up for each platform

---

## 13. CLAUDE DESKTOP PROMPT

Copy everything below this line and paste it into Claude Desktop on the M3 Max. Give Claude Desktop access to the `Shared for Archive 35` folder in iCloud Drive.

---

```
You are building Archive-35 Social Media — a standalone Python application that automatically generates gallery flythrough videos from photography and manages social media posting.

## CRITICAL CONTEXT

Read the file BUILD_INSTRUCTIONS.md in this folder FIRST. It contains the complete architecture, folder structure, data formats, and build order. Follow it exactly.

## YOUR WORKING DIRECTORY

Everything you build goes inside:
~/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35/

This is an iCloud Drive folder that syncs between two Macs:
- M3 Max (where you're running now) — creative workstation
- i7 Intel MacBook Pro — automation server where this app will run

## WHAT TO BUILD

A Python + Flask application called "Archive-35 Social Media" that:

1. Scans the Photography/ subfolder for gallery directories (26 galleries, each full of photos)
2. Composites those photos into pre-rendered gallery flythrough template frames (PNG sequences with alpha, stored in A35_PNG Seqs/)
3. Renders H.264 MP4 videos using FFmpeg with an ambient audio track
4. Provides a web dashboard at port 8035 for monitoring, scheduling, and manual control
5. Runs a scheduling engine for twice-daily automated posting
6. Communicates with Archive-35 Studio via JSON files in a handshake/ subfolder

## TARGET MACHINE

This app runs on an Intel i7 MacBook Pro (2016), NOT on the M3 Max. Optimize for:
- 4-core Intel i7 (limit multiprocessing workers to 4)
- 16GB RAM (limit working set to 8GB)
- FFmpeg preset: medium (not slow)
- Python 3.10+ via Homebrew
- No M-series specific code

## WHAT ALREADY EXISTS

- Photography/ — 26 gallery folders full of photos (Antilope Canyon, Argentina, Australia, Black and White, Brazil, Chicago, Colorado, Concerts, Death Valley, Desert Dunes, Flowers and Leaves, Grand Teton, Iceland, Lake Powell, Large Scale Stitch, London, Los Angeles, Monument Valley, New Zealand, Paris, Planes, Random stuff, South Africa, Tanzania, Utha National Parks, Valley of Fire)
- A35_PNG Seqs/ — Will contain AE template PNG sequences (not yet exported)
- BUILD_INSTRUCTIONS.md — Full architecture document (READ THIS)

## WHAT DOES NOT EXIST YET

- Audio track — Wolf will add later. If no audio file exists, render video without audio.
- Social media API keys — Wolf hasn't signed up yet. Build the plugin structure but don't require credentials.
- AE PNG sequences — Coming soon. Build the compositor so it works once the frames are there, but make the app usable even without them (gallery browser, scheduler, handshake still work).

## DESIGN PRINCIPLES

- Dark theme (#0a0a0a background) matching Archive-35 Studio aesthetic
- ADHD-friendly: scannable, no dense text, large status indicators, cards-based layout
- Graceful degradation: every feature works independently. No audio? Render silent. No templates? Show galleries. No API keys? Render only, manual posting.
- All data in JSON files (no database)
- All paths relative to the shared iCloud folder
- Comprehensive error handling — this runs unattended 24/7

## BUILD ORDER

Follow the build order in BUILD_INSTRUCTIONS.md exactly:
Phase 1 (Foundation) → Phase 2 (Compositor) → Phase 3 (Renderer) → Phase 4 (Dashboard) → Phase 5 (Scheduling) → Phase 6 (Post Generator) → Phase 7 (Handshake) → Phase 8 (Auto-start)

Start with Phase 1. Create the folder structure and gallery scanner first. Test it works. Then move to Phase 2.

## COMPANION SOFTWARE

Archive-35 Studio is a separate Electron + React app on the M3 Max. You are NOT building Studio. You are building its companion: Social Media. They communicate via the handshake/ folder. Studio writes studio_status.json and gallery_queue.json. Social Media writes social_status.json. Both read each other's status files. See BUILD_INSTRUCTIONS.md Section 7 for the exact JSON formats.

## IMPORTANT RULES

1. NEVER delete or modify anything in the Photography/ folder — read-only access
2. NEVER delete or modify anything in A35_PNG Seqs/ — read-only access
3. ALL generated files go in social_media_app/, output/, logs/, config/, or handshake/
4. Use try/except everywhere — this app must never crash
5. Log everything to $SHARED/logs/
6. The web dashboard must be responsive (works on phone)
7. Include a README.md with install instructions for the i7 MacBook
```

---

## END OF BUILD INSTRUCTIONS

When Wolf pastes the Claude Desktop prompt (Section 13) and gives Claude access to the `Shared for Archive 35` folder, Claude Desktop will have everything it needs to build the complete application.
