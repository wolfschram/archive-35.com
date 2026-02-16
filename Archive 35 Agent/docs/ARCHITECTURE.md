# Archive-35 System Architecture v3.1

> Simplified from v3 based on ChatGPT + Gemini adversarial review.
> Changes: Removed LangGraph, Saga Engine, Mem0, Firecrawl from Phase 1.
> Added: Greatest Hits mode, Brand Proof Layer, COGS truth table, queue expiry.

---

## 1. System Overview

Archive-35 automates a fine art photography print business:
- **Import** → Photos ingested, hashed, resized
- **Analyze** → Claude Vision tags mood, composition, marketability
- **Generate** → Content Agent creates captions, descriptions, tags per platform
- **Approve** → Wolf reviews via Telegram (approve/reject/edit/defer)
- **Post** → Late API publishes to Pinterest, Instagram
- **List** → Listing packages generated for manual Etsy paste
- **Monitor** → Daily Telegram summary of actions, costs, errors

---

## 2. Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                    OPERATOR (Wolf)                    │
│              Telegram + Streamlit (backup)            │
└────────────────────────┬────────────────────────────┘
                         │ approve / reject / defer
┌────────────────────────▼────────────────────────────┐
│                  PIPELINE LAYER                       │
│     daily.py → import → vision → content → queue     │
│              scheduler.py (Huey + cron)               │
└────────────┬──────────────┬──────────────┬──────────┘
             │              │              │
┌────────────▼──┐ ┌────────▼────┐ ┌───────▼─────────┐
│  INTELLIGENCE │ │   ACTION    │ │     BRAND       │
│  vision.py    │ │  social.py  │ │  provenance.py  │
│  content.py   │ │  etsy.py    │ │  sku.py         │
│               │ │             │ │  greatest_hits  │
└──────┬────────┘ └──────┬──────┘ └────────┬────────┘
       │                 │                  │
┌──────▼─────────────────▼──────────────────▼────────┐
│                   SAFETY LAYER                      │
│  ledger.py │ rate_limiter.py │ audit.py │ kill.py  │
└────────────────────────┬───────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                 INFRASTRUCTURE                       │
│      SQLite (WAL) │ Docker │ Huey │ .env config     │
└─────────────────────────────────────────────────────┘
```

---

## 3. Design Principles

1. **Human-in-the-Loop Always** — Every external action needs Telegram approval
2. **Idempotency Everywhere** — Side-effect ledger with unique hashes prevents duplicates
3. **Fail Closed** — If safety layer unreachable, agents STOP
4. **Observable** — Every action logged with timestamp, cost, input/output
5. **Cost-Aware** — Daily budget cap, per-API rate limits, Haiku where possible
6. **Progressive Complexity** — Phase 1 is deliberately simple. Add complexity after revenue.

---

## 4. Daily Pipeline Flow

```
06:00  Huey cron triggers daily.py
  │
  ├─► Check kill switch → if active, STOP + alert Telegram
  │
  ├─► Import new photos (if any in PHOTO_IMPORT_DIR)
  │     └─► Hash, resize to 1024px, store metadata in SQLite
  │
  ├─► Vision Agent: batch unanalyzed photos to Claude Haiku
  │     └─► Tags, mood, composition, marketability score → SQLite
  │
  ├─► Content Agent: generate content for top-scored photos
  │     └─► Pinterest caption, Instagram caption, Etsy listing package
  │     └─► Brand proof (provenance story) auto-attached
  │     └─► 2-3 variants per platform
  │     └─► Set expires_at = now + 48h
  │
  ├─► Bundle content → Telegram approval queue
  │     └─► Photo preview + caption + approve/reject/edit/defer buttons
  │
  ├─► (Async) Wolf reviews and approves via Telegram
  │
10:00  Posting window opens
  │
  ├─► Post approved content via Late API (randomized timing)
  │     └─► Idempotency check → Rate limit check → Post → Audit log
  │
  ├─► Expire stale content (>48h unapproved → status='expired')
  │
20:00  Daily summary
  │
  └─► Telegram: posted count, rejected count, expired count, daily cost
```

---

## 5. Component Specifications

### 5.1 Safety Layer

| Component | Purpose | Failure behavior |
|-----------|---------|-----------------|
| `ledger.py` | Idempotency — dedup all external actions by hash | Unreachable → block action |
| `rate_limiter.py` | Per-API daily call + cost limits | Limit hit → queue for tomorrow |
| `audit.py` | Log every action with cost tracking | Write fail → buffer in memory |
| `kill_switch.py` | Global + per-platform emergency stop | Always checked first |

### 5.2 Intelligence Layer

| Component | Model | Purpose |
|-----------|-------|---------|
| `vision.py` | Claude Haiku (Batch API) | Analyze photos: tags, mood, composition, score |
| `content.py` | Haiku (social) / Sonnet (Etsy) | Generate captions, descriptions, tags, SEO |

### 5.3 Action Layer

| Component | API | Purpose |
|-----------|-----|---------|
| `social.py` | Late API | Post to Pinterest, Instagram after approval |
| `etsy.py` | None (Phase 1) | Generate paste-ready listing packages |

### 5.4 Brand Layer

| Component | Purpose |
|-----------|---------|
| `provenance.py` | Auto-generate story from EXIF + collection + tour history |
| `sku.py` | Generate SKUs, lookup COGS, enforce price floors |
| `greatest_hits.py` | Auto-rotation of approved high-performing content |

---

## 6. Telegram Approval Interface

### Message format:
```
📸 [Collection] Photo #0042
🏷️ Tags: iceland, glacier, blue ice, winter, landscape
⭐ Marketability: 8/10

📌 Pinterest caption:
"Glacial blue light cuts through ancient ice..."

📝 Etsy listing ready (copy-paste)

[✅ Approve] [✏️ Edit] [❌ Reject] [⏳ Defer]
```

### Button behaviors:
- **Approve** → Content moves to posting queue, posted at next window
- **Edit** → Wolf types corrections, Content Agent regenerates
- **Reject** → Logged with reason, used for future prompt tuning
- **Defer** → Re-queued for next day
- **No action (48h)** → Auto-expired, NOT auto-approved

### Greatest Hits trigger:
- If approval queue is empty for 48h (operator downtime)
- System enters Greatest Hits mode
- Reposts previously approved + high-performing content
- No new content without fresh approval

---

## 7. SKU System

Format: `A35-{COLLECTION}-{PHOTO_ID}-{SIZE}-{PAPER}-{EDITION}`

| Code | Meaning |
|------|---------|
| A35 | Brand prefix |
| COLLECTION | 3-letter: ICE, TOK, LON, PAR, NYC, etc. |
| PHOTO_ID | 4-digit unique per photo |
| SIZE | 8R, 11R, 16R, 20R, 24R, 30R (inches) |
| PAPER | HAH (Hahnemühle), LUS (Lustre), MET (Metallic) |
| EDITION | OE (open) or LE025/001 (limited, total/number) |

Example: `A35-ICE-0042-16R-HAH-OE`

---

## 8. Phase Roadmap

### Phase 1: Foundation + First Revenue (Weeks 1-3)
- Simple pipeline: cron → vision → content → Telegram → post
- Manual Etsy listings with AI-generated copy
- Safety layer (idempotency, rate limits, audit, kill switch)
- Brand proof layer + Greatest Hits mode
- Target: 10-20 Etsy listings, 3-5 social posts/day

### Phase 2: Scale + Second Channel (Months 2-4)
- Shopify store for limited editions
- Etsy API integration (if approved)
- Outreach Agent for licensing leads
- Streamlit dashboard with approval buttons
- Research Agent (Firecrawl)

### Phase 3: Automation + Reliability (Months 4-8)
- VPS deployment (Hetzner CAX21)
- Adaptive memory (Mem0)
- Cold email outreach (Smartlead)
- Consider LangGraph if agent coordination needs it

### Phase 4: B2B + Premium (Months 9-12+)
- B2B project quoting
- Lookbook generator
- CRM integration
- Contract templates

---

## 9. External APIs

| API | Used by | Rate limit | Monthly cost |
|-----|---------|-----------|-------------|
| Claude (Anthropic) | Vision, Content | Tier-dependent | $15-$30 |
| Late API | Social Agent | 60 req/min | $19 |
| Telegram | Approval UI | 30 msg/sec | Free |
| Printful/Prodigi | Order fulfillment | Varies | Per-order |
| Etsy | Manual (Phase 1) | N/A | $0.20/listing |
