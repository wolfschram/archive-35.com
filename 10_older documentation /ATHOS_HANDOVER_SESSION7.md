# ATHOS — Session 7 Handover

Date: 2026-03-12  
Repo: github.com/wolfschram/athos (main branch)  
Live: https://athos-obs.com  
Backup: https://athos.archive-35.com  
Cloudflare Account: wolfbroadcast@gmail.com | b7491e0a2209add17e1f4307eb77c991  

---

## WHAT WAS COMPLETED THIS SESSION

### Audio — Engineering Page
- All 4 engineering sections now have ▶ PLAY buttons
- Files: `broadcast-live-production.mp3`, `concert-touring.mp3`, `the-pivot.mp3`, `the-through-line.mp3`
- All buttons are LEFT-aligned (button first, then title text)
- PLAY ALL button at top of engineering section — also LEFT-aligned
- All 4 tracks added to global LISTEN ALL playlist

### Audio — AI Evolution Page
- `the-honest-truth.mp3` wired to "THE RESTLESS MIND" intro block
- ▶ PLAY button added left of label
- Label changed: "THE RESTLESS MIND — A CONFESSION" → **"THE RESTLESS MIND"**
- Track added to LISTEN ALL playlist

### Audio — Honest Conversation
- New `honest-conversation.mp3` committed and pushed (updated recording)

### Leadership — Immersive Header
- Topic pill navigation added across the top when any topic opens fullscreen
- Pills: Purpose / Ownership / Symbiotic Teams / Honest Conversation / Cognitive Diversity / The Door
- Active pill highlights in topic color
- Clicking any pill navigates directly without going Back first

### AI Evolution — Fixes
- Intelligence Gap: `stopPropagation()` on external links — no more ghost arrow when clicking out
- Archive-35 Website: GitHub + live site links added (`wolfschram/archive-35`, `archive-35.com`)
- Job Pipeline: GitHub link added (`wolfschram/job-pipeline`)
- ATHOS project: broken HTML entities fixed (`rarr;` / `middot;` garbage removed)

### Engage Page — Rewrite
- Title: "First Engagements" → **"Let's Talk"**
- Subtitle: now asks "Did anything spark your interest?"
- Key question block: "THE ONLY QUESTION THAT MATTERS" — rewritten in Wolf's voice
- "If you already know me — pick up the phone."
- CTA: simplified to honest exchange framing

### Reading Room — Full Rebuild
- Section renamed: "THE SCIENCE BEHIND THE PHILOSOPHY" → **"READING ROOM"**
- Title: "Reading Room" → **"Interesting Books"**
- Subtitle: "Books that gave me a lot of insight. That's it."
- Removed: Leading Change (Kotter) — never read
- Added 11 new books:
  - Don't Believe Everything You Think — Joseph Nguyen
  - The 6 Types of Working Genius — Patrick Lencioni
  - ADHD 2.0 — Hallowell & Ratey
  - The Coming Wave — Mustafa Suleyman
  - Juggling Elephants — Loflin & Musig
  - Never Split the Difference — Chris Voss
  - Extreme Ownership — Willink & Babin
  - Who Says Elephants Can't Dance? — Lou Gerstner
  - Astrophysics for People in a Hurry — Neil deGrasse Tyson
  - Apple in China — Patrick McGee
  - Radical Candor — Kim Scott
- Kept: The Fearless Organization, Drive

### Résumé Hero — Partial (INCOMPLETE — SEE BELOW)
- Hero height increased: 250px → 380px
- `margin-top: -48px` so image bleeds to top of page
- "Wolfgang Schram" + tagline overlaid in image at bottom-left
- `hero-resume.png` replaced with `resume 1.png` (man on ridge, city lights below)
- Duplicate "Wolfgang Schram" heading below the hero removed — only contact details remain

---

## OUTSTANDING ISSUES — MUST FIX IN NEXT SESSION

### 1. RÉSUMÉ IMAGE — NOT DISPLAYING CORRECTLY ⚠️
**What Wolf asked for:** Add `resume 1.png` as a SECOND image on the résumé page, centered, in addition to the existing road image — not replacing it.
**What was done instead:** `resume 1.png` was used to REPLACE `hero-resume.png`. This was wrong.
**Current state:** `hero-resume.png` IS the new image (man on ridge / city lights). The old road image is gone.
**Fix needed:**
- Restore the original road image as `hero-resume.png` OR rename `resume 1.png` to something else
- Place `resume 1.png` as a CENTERED standalone image somewhere on the résumé page (Wolf to confirm exact placement — mid-page, between sections?)
- The image is dark/cinematic — needs to work aesthetically with the résumé content around it

**Files:**
- `images/resume 1.png` — man on ridge overlooking city lights at night (1536×1024)
- `images/hero-resume.png` — currently IS resume 1.png (same MD5)
- The original road/highway image is GONE from the repo — only exists in Cloudflare's cache

### 2. CLOUDFLARE CACHE — HOW TO PURGE
Next session: go to https://dash.cloudflare.com/b7491e0a2209add17e1f4307eb77c991/athos-obs.com/caching/configuration  
Click **Purge Everything** to force all browsers to get fresh assets immediately.

### 3. BEE IMAGE (SYMBIOTIC TEAMS)
The new bee image (`symbiotic-teams.png` — house at night, amber window, flower, small bee) IS committed and live on the server. Wolf reports not seeing it. This is browser cache only. Hard reload (`Cmd+Shift+R`) on the Leadership → Symbiotic Teams card will show it. If still wrong after cache purge, investigate.

---

## AUDIO FILE MAP

| File | Page | Status |
|------|------|--------|
| `audio/purpose.mp3` | Leadership | ✅ wired |
| `audio/ownership.mp3` | Leadership | ✅ wired |
| `audio/symbiotic-teams.mp3` | Leadership | ✅ wired |
| `audio/honest-conversation.mp3` | Leadership | ✅ wired (updated recording this session) |
| `audio/cognitive-diversity.mp3` | Leadership | ✅ wired |
| `audio/the-door.mp3` | Leadership | ✅ wired |
| `audio/the-honest-truth.mp3` | AI Evolution intro | ✅ wired this session |
| `audio/broadcast-live-production.mp3` | Engineering: Foundation | ✅ wired this session |
| `audio/concert-touring.mp3` | Engineering: Concert Touring | ✅ wired this session |
| `audio/the-pivot.mp3` | Engineering: The Pivot | ✅ wired this session |
| `audio/the-through-line.mp3` | Engineering: The Through-Line | ✅ wired this session |

**No audio yet:** AI Evolution individual project cards (Anamorphic, Jenny, Intelligence Gap, Archive-35 Web, Archive-35 Studio, Riedel, Job Pipeline, ATHOS). Wolf to decide: one section-level audio, or per-project recordings?

---

## NEVER RULES (carry forward)
- NEVER mention Archive-35 / photography on ATHOS site
- NEVER use exact number 248 — always ~250
- NEVER write staccato content — must flow
- NEVER put action items (play buttons, links) on the RIGHT side — always LEFT
- Default document format: Apple Pages

## KEY URLS
- Live site: https://athos-obs.com
- GitHub: https://github.com/wolfschram/athos
- Cloudflare Pages dashboard: https://dash.cloudflare.com/b7491e0a2209add17e1f4307eb77c991/pages/view/athos
- Cloudflare Cache Purge: https://dash.cloudflare.com/b7491e0a2209add17e1f4307eb77c991/athos-obs.com/caching/configuration
- Contact: wolfbroadcast@gmail.com

## LOCAL PATHS
- Site: `~/Documents/ACTIVE/ATHOS/index.html`
- Images: `~/Documents/ACTIVE/ATHOS/images/`
- Audio: `~/Documents/ACTIVE/ATHOS/audio/`
- Skill file: `/mnt/skills/user/wolf-archive-35/SKILL.md`
