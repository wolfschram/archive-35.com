# Archive-35 Social Media — Installation Guide

> **Target machine:** i7 Intel MacBook Pro (2016), 16GB RAM, macOS
> **Stack:** Electron + React (matching Studio app architecture)
> **Version:** 0.2.0

## Prerequisites

### 1. Install Homebrew (if not already)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Node.js and FFmpeg
```bash
brew install node ffmpeg
```

### 3. Verify installations
```bash
node --version    # Should be v18+ 
npm --version     # Should be v9+
ffmpeg -version   # Should show version info
```

## Installation

### 1. Navigate to the app folder
```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/Shared\ for\ Archive\ 35/Archive35-Social/social_media_app
```

### 2. Install dependencies
```bash
npm install
```

**Note:** `sharp` may take a minute to compile native bindings on Intel. This is normal.

### 3. Run in development mode
```bash
npm run dev
```

This starts both the React dev server (port 3001) and the Electron window.

## Configuration (First Run)

1. Open the app and go to **Settings**
2. Set these folder paths:
   - **Photography:** `~/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35/Photography/`
   - **PNG Sequences:** `~/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35/A35_PNG Seqs/`
   - **Audio:** (leave empty until you add an audio track)
   - **Handshake:** `~/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35/handshake/`
3. Enable/disable platforms as needed (all 8 are available)
4. Configure schedule times (default: 9:00 AM & 6:00 PM PST)
5. Click **Save Settings**

## 8 Platform Formats

| Platform | Dimensions | Duration | Template |
|----------|-----------|----------|----------|
| Instagram Reels | 1080×1920 | 15s | Portrait 9:16 |
| TikTok | 1080×1920 | 15s | Portrait 9:16 |
| YouTube | 1920×1080 | 30s | Widescreen 16:9 |
| YouTube Shorts | 1080×1920 | 15s | Portrait 9:16 |
| Facebook | 1920×1080 | 30s | Widescreen 16:9 |
| Instagram Feed | 1080×1080 | 15s | Square 1:1 |
| LinkedIn | 1920×1080 | 30s | Widescreen 16:9 |
| X / Twitter | 1920×1080 | 30s | Widescreen 16:9 |

## Auto-Start on Boot (optional)

To have the app start automatically when the i7 MacBook boots:

```bash
# Copy the launchd plist
cp com.archive35.social.plist ~/Library/LaunchAgents/

# Load it
launchctl load ~/Library/LaunchAgents/com.archive35.social.plist

# Check status
launchctl list | grep archive35
```

To stop:
```bash
launchctl unload ~/Library/LaunchAgents/com.archive35.social.plist
```

## i7 Optimization Notes

- FFmpeg preset defaults to `medium` (not slow/slower)
- Max 4 compositing workers (matching i7's 4-core + HT)
- 8GB working set limit (leaves 8GB for macOS + iCloud sync)
- Temp files go to `/tmp/archive35/` (local SSD, not iCloud)
- CRF 18 for quality (lower = better, range 0-51)

## Handshake (Studio Communication)

The app communicates with Archive-35 Studio on the M3 Max via JSON files in `handshake/`:

- `social_status.json` — Written every 60s by this app
- `studio_status.json` — Written by Studio
- `gallery_queue.json` — Studio can queue galleries for priority rendering

iCloud Drive syncs these files between both machines automatically.

## Troubleshooting

**App won't start:** Check `logs/launchd_stderr.log` for errors.

**FFmpeg not found:** Run `brew install ffmpeg` and restart the app.

**iCloud files not syncing:** Open Finder, navigate to iCloud Drive, and ensure files download (click cloud icon).

**Sharp build fails:** Try `npm rebuild sharp` or delete `node_modules` and run `npm install` again.
