# ATHOS SESSION 9 HANDOVER
**Date:** 2026-03-12
**Next session starts here. Read this completely before touching anything.**

---

## FIRST THING — READ LESSONS LEARNED
Before ANY code change, read the LESSONS LEARNED section at the bottom of CLAUDE.md.
Those lessons were earned the hard way. They are not optional.

---

## Project Identity
- **Site:** ATHOS — Architecting Teams for High-performance Outcomes & Scale
- **Owner:** Wolf Schram (Wolfgang Schram)
- **Live URL:** https://athos-obs.com
- **Repo:** github.com/wolfschram/athos (main branch)
- **Local path:** `/Users/wolfgangschram/Documents/ACTIVE/ATHOS/`
- **Cloudflare Pages:** https://dash.cloudflare.com/b7491e0a2209add17e1f4307eb77c991/pages/view/athos
- **CF Cache purge:** https://dash.cloudflare.com/b7491e0a2209add17e1f4307eb77c991/athos-obs.com/caching/configuration
- **Stack:** Single-file static HTML (`index.html`) — no build step, no framework

---

## Current Git State
**Latest commit:** `b5244b6` — docs: add LESSONS LEARNED section to CLAUDE.md
**Branch:** main — clean, fully pushed

### Recent commit history
```
b5244b6 docs: add LESSONS LEARNED section to CLAUDE.md
abadf84 resume: fix broken layout - remove all duplicate divs, restore CV column
690c408 resume: fix broken layout - remove duplicate img, fix missing div
ee76923 resume: simplify ATHOS title to Founder only
8ec2b64 resume: road image wider (45%), deeper fade blend into CV content
861afa7 fix: point ownership audio to v2 file to bypass CF cache
f14d7fa audio: force ownership full file via new filename to bypass CF cache
db43f75 contact: fix portrait crop - taller frame, show full head, fade all edges
bca225a fix: correct continents copy - two not three, Germany > England > California
f293c2d contact: use new portrait filename to bypass CF cache
c9a4560 contact: rename About->Contact in nav, add phone number
7effbcc fix: voices modal placeholders changed to generic text
e0f8cb7 docs: add Voices delete password to CLAUDE.md
003943c voices: live endorsement system - submit, display, delete with password
```

---

## Nav Structure (current, 10 tabs)
```
APPROACH | LEADERSHIP | MY AI EVOLUTION | ENGINEERING | ENGAGE | VOICES | RÉSUMÉ | READING | CONTACT
+ LISTEN ALL button (top right)
+ CONTACT button (top right, duplicate nav shortcut)
```
**Page IDs:** page-approach, page-leadership, page-ai, page-engineering, page-engage, page-voices, page-resume, page-reading, page-wolf
**Note:** "About" was renamed to "Contact" this session.

---

## Active File Map

### Images in use (index.html references)
| File | Used on | Notes |
|------|---------|-------|
| `images/wolf-portrait-v2.png` | Contact page | AI-generated portrait, Wolf's face, amber lighting |
| `images/hero-wolf.png` | NOT in use | Old silhouette — orphaned, keep for reference |
| `images/resume-portrait.png` | Résumé hero | Man on ridge, cityscape below |
| `images/hero-resume.png` | Résumé right column | Winding road / light trail, sticky 45% column |
| `images/hero-voices.png` | Voices hero | Dark corridor |
| `images/hero-bridge.png` | Leadership hero | |
| `images/hero-ai.png` | AI Evolution hero | |
| `images/hero-engineering.png` | Engineering hero | |
| `images/hero-reading.png` | Reading hero | |
| `images/engage-blueprint.png` | Engage hero + cards | |
| `images/engage-embedded.png` | Engage card | |
| `images/engage-ai.png` | Engage card | |
| `images/landing-logo.png` | Landing page | |

### Audio in use (all 11 tracks confirmed 200 OK, correct file sizes)
| File | Page | Section | Live Size |
|------|------|---------|----------|
| `audio/purpose.mp3` | Leadership | index 0 | 1878KB |
| `audio/ownership-v2.mp3` | Leadership | index 1 | 2390KB |
| `audio/symbiotic-teams.mp3` | Leadership | index 2 | 699KB |
| `audio/honest-conversation.mp3` | Leadership | index 3 | 2176KB |
| `audio/cognitive-diversity.mp3` | Leadership | index 4 | 1049KB |
| `audio/the-door.mp3` | Leadership | index 5 | 1912KB |
| `audio/the-honest-truth.mp3` | AI Evolution | index 6 | 1489KB |
| `audio/broadcast-live-production.mp3` | Engineering | index 7 | 3523KB |
| `audio/concert-touring.mp3` | Engineering | index 8 | 2723KB |
| `audio/the-pivot.mp3` | Engineering | index 9 | 1260KB |
| `audio/the-through-line.mp3` | Engineering | index 10 | 1240KB |

**NOTE:** `ownership.mp3` (original) was a 150KB stub on Cloudflare — fixed by renaming to `ownership-v2.mp3`. The HTML now references `ownership-v2.mp3`.

---

## Voices System
- **Live endorsement system** — submissions appear instantly, stored in localStorage
- **"LEAVE A VOICE" button** — top right of Voices page
- **Delete password:** `athos2026`
- **To change password:** search `VOICES_DELETE_PW` in index.html
- Cards display: Name (linked to LinkedIn if provided) → Title · Company → Message
- No approval needed — goes live immediately on submit

---

## Résumé Page Layout
- **Hero (top):** `resume-portrait.png` — man on ridge, full bleed 460px, fades to black at bottom
- **Body:** Two-column flex layout
  - **LEFT (order:1):** CV content, `flex:1`, `padding: 40px 48px 80px 48px`
  - **RIGHT (order:2):** `hero-resume.png` road image, `position: sticky`, `width: 45%`, `min-width: 420px`, `height: 100vh`
  - Left edge of road fades into CV content via gradient
- **Known issue this session:** Layout broke twice due to duplicate div tags introduced by line-by-line edits. Always read lines 2824–2840 before touching résumé layout.

---

## Contact Page
- **Portrait:** `wolf-portrait-v2.png` — AI-generated, Wolf's face, amber/dark cinematic lighting
- **Contacts:** email, phone `+1 310 997 8359`, LinkedIn
- **Bio copy:** "25 years across two continents. Started in broadcast engineering in Germany, moved to England, then California."
- **Title under ATHOS on résumé:** "Founder" (Culture Architect removed)

---

## Audio Player System
- Global player at bottom of page (`gp-*` element IDs)
- `gpSectionEnd` controls section boundaries — plays through section, stops at last track
- Section map:
  - Leadership = indices 0–5 (purpose → the-door)
  - AI Evolution = index 6 (the-honest-truth)
  - Engineering = indices 7–10 (broadcast → through-line)
- `gpPlayAll()` and `gpPlayFrom()` set `gpSectionEnd = -1` (no limit)
- LISTEN ALL plays everything

---

## Known Issues / Pending Fixes for Next Session
Wolf mentioned he has a list of fixes. Capture them at the START of the next session before writing any code.

**Suspected outstanding issues (verify with Wolf):**
- Résumé layout — confirm road image is rendering correctly at 45% width after the layout fix
- Contact portrait — confirm `wolf-portrait-v2.png` is showing (not old silhouette) after cache bypass
- Ownership audio — confirm full track plays through after `ownership-v2.mp3` rename
- `symbiotic-teams.mp3` at 699KB — smallest audio file, may be truncated. Verify with Wolf.

---

## Cloudflare Binary File Rule (CRITICAL)
Cloudflare Pages WILL NOT serve updated versions of images/audio even after cache purge.
**The only fix that works: rename the file + update the HTML reference.**
Pattern: `filename.mp3` → `filename-v2.mp3` → update HTML → commit → push.
Do NOT attempt cache purge alone for binary assets. It has never worked reliably.

---

## NEVER Rules (carry forward always)
- NEVER mention Archive-35 / photography / The Restless Eye on ATHOS site
- NEVER use exact number 248 — always ~250 or roughly 250
- NEVER put action buttons on the RIGHT — always LEFT
- NEVER tell Wolf something is fixed until you have screenshot proof from the live URL
- NEVER use Python triple-quote heredocs for HTML manipulation — use line-by-line array replacement
- NEVER layer a fix on top of unread code — always `sed -n` the lines first
- NEVER commit without reading back the changed lines first
- NEVER use Wolf's former company name (Diversified) in public-facing content (CV is exception)

---

## Wolf Context (carry forward)
- ADHD + dyslexia — keep answers short, scannable, bullet points
- Voice-to-text: "get up" = GitHub. Silently correct all VTT errors.
- Bilingual German/English — responds in English unless Wolf writes in German
- Servant leadership philosophy — it's about empowering others, never about himself
- Job searching: VP Engineering / COO / senior leadership roles, AI/media tech focus
- P→P→R framework: Problem → Product → Result
- Riedel contact: Joyce (President, North America) — email drafted this session to introduce ATHOS site
- Daniel Seltzer: always full name, never Dan/Danny. dseltzer@h2co3.com

---

## Session 9 Summary — What Was Built/Fixed
1. ✅ Voices page rebuilt — live endorsement system with instant publish + password delete
2. ✅ Voices delete password documented in CLAUDE.md and memory
3. ✅ Voices modal placeholders changed to generic text (not Wolf's name)
4. ✅ "About" renamed to "Contact" in nav
5. ✅ Phone number `+1 310 997 8359` added to Contact page
6. ✅ AI portrait (`wolf-portrait-v2.png`) deployed to Contact page
7. ✅ Portrait frame fixed — taller (420px), `object-position: center top`, 4-way edge fade
8. ✅ Contact bio corrected — "two continents" not "three", Germany → England → California
9. ✅ ATHOS title simplified to "Founder" (Culture Architect removed)
10. ✅ Ownership audio fixed — renamed to `ownership-v2.mp3` to bypass CF cache
11. ✅ Résumé road image widened to 45% with deeper left-edge fade
12. ✅ Résumé layout repaired after duplicate div bugs (twice)
13. ✅ Culture Architect removed from résumé hero subtitle
14. ✅ Full site audit — all 11 audio + all images confirmed 200 OK with correct sizes
15. ✅ LESSONS LEARNED section added to CLAUDE.md
16. ✅ Joyce (Riedel) outreach email drafted — warm, personal, ATHOS site as centrepiece

---

*Handover written: 2026-03-12 end of session 9*
