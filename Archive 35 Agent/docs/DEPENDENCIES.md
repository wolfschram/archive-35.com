# Archive-35 Dependency Map

> Every component, what it depends on, what depends on it, and what happens when it breaks.

---

## Dependency Graph (Read left to right)

```
.env config ──────┐
                   ▼
              ┌─────────┐
              │ config.py│ ◄── All components depend on this
              └────┬─────┘
                   │
              ┌────▼─────┐
              │   db.py   │ ◄── SQLite + WAL initialization
              └────┬─────┘
                   │
         ┌─────────┼──────────┐
         ▼         ▼          ▼
    ┌─────────┐ ┌──────┐ ┌────────┐
    │ ledger  │ │ rate │ │ audit  │     SAFETY LAYER
    │  .py    │ │ limit│ │  .py   │     (must init first)
    └────┬────┘ └──┬───┘ └───┬────┘
         │         │         │
         └─────────┼─────────┘
                   ▼
         ┌─────────────────┐
         │   kill_switch    │ ◄── Checked before every action
         └────────┬────────┘
                  │
    ┌─────────────┼──────────────┐
    ▼             ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│ vision │  │ content  │  │ social   │   AGENTS
│  .py   │──│   .py    │──│   .py    │   (linear pipeline)
└────────┘  └─────┬────┘  └──────────┘
                  │
            ┌─────▼──────┐
            │ provenance │               BRAND
            │   sku.py   │
            │ greatest   │
            └────────────┘
```

---

## Component Dependency Table

### Infrastructure Layer

| Component | Depends on | Depended by | If it fails | Blast | Mitigation |
|-----------|-----------|-------------|-------------|-------|-----------|
| SQLite DB | Filesystem | Everything | System dead | CRIT | Hourly backups, WAL mode |
| Docker | Host OS | All services | System dead | CRIT | Restart policy: always |
| Huey | SQLite, cron | Daily pipeline | Missed schedule | HIGH | Manual CLI trigger |
| .env / config.py | Filesystem | All at startup | Won't start | CRIT | Validated at boot, fail fast |
| Network | ISP | All API calls | Posts queue | HIGH | Retry + backoff |

### Safety Layer

| Component | Depends on | Depended by | If it fails | Blast | Mitigation |
|-----------|-----------|-------------|-------------|-------|-----------|
| ledger.py | SQLite | All action agents | Actions blocked | HIGH | Fail closed by design |
| rate_limiter.py | SQLite, config | All API agents | Budget exceeded | MED | 50% headroom in limits |
| audit.py | SQLite | Debugging only | Blind spots | LOW | Buffer in memory |
| kill_switch.py | SQLite, Telegram | All agents | Can't emergency stop | MED | CLI file-based fallback |

### Agent Layer

| Component | Depends on | Depended by | If it fails | Blast | Mitigation |
|-----------|-----------|-------------|-------------|-------|-----------|
| vision.py | Claude API, photos | content.py | No new content | MED | Use cached tags, skip new |
| content.py | Claude API, vision tags | social.py, etsy.py | No posts today | HIGH | Greatest Hits mode |
| social.py | Late API, approved content | None (terminal) | Posts delayed | MED | Retry queue, per-platform kill |
| etsy.py | content.py output | None (terminal) | No new listings | LOW | Manual listing still works |

### Brand Layer

| Component | Depends on | Depended by | If it fails | Blast | Mitigation |
|-----------|-----------|-------------|-------------|-------|-----------|
| provenance.py | EXIF data, collection config | content.py | No story attached | LOW | Generic fallback story |
| sku.py | COGS table, photo metadata | etsy.py, shopify.py | Can't price | MED | Manual price override |
| greatest_hits.py | approved content history | daily pipeline | No auto-rotation | LOW | System just waits |

### External APIs

| API | Used by | If it's down | Blast | Fallback |
|-----|---------|-------------|-------|---------|
| Claude (Anthropic) | vision, content | No new content | HIGH | Greatest Hits mode, cached content |
| Late API | social.py | Posts delayed | MED | Queue approved content, manual post |
| Telegram | Approval UI | Headless | MED | Streamlit backup (P1), CLI fallback |
| Printful/Prodigi | Fulfillment | Orders delayed | LOW | Manual order placement |

---

## Initialization Order

When the system starts, components must initialize in this order:

```
1. config.py      → Load and validate .env
2. db.py          → Connect SQLite, enable WAL, run migrations
3. kill_switch.py → Check if system is halted
4. ledger.py      → Initialize idempotency ledger
5. rate_limiter.py→ Load/reset daily counters
6. audit.py       → Initialize audit logger
7. scheduler.py   → Register Huey tasks
8. bot.py         → Start Telegram bot (webhook or polling)
9. daily.py       → Ready for first pipeline run
```

If any step 1-6 fails → system does NOT start (fail fast).
Steps 7-9 can fail independently with alerts.

---

## Data Flow: One Photo's Journey

```
1. Photo file dropped in PHOTO_IMPORT_DIR
   │
2. import_photos.py:
   ├─ SHA256 hash (dedup check via ledger)
   ├─ Resize to 1024px longest edge
   ├─ Extract EXIF (GPS, date, camera, lens)
   ├─ Store metadata in photos table
   │
3. vision.py:
   ├─ Rate limit check (Claude API)
   ├─ Send to Claude Haiku Batch API
   ├─ Receive: tags, mood, composition, score
   ├─ Store in photos table
   ├─ Audit log: vision analysis cost
   │
4. content.py:
   ├─ Pull photo metadata + vision tags
   ├─ Pull brand provenance (provenance.py)
   ├─ Generate 2-3 variants per platform
   ├─ Store in content table (status=pending, expires_at=+48h)
   ├─ Audit log: content generation cost
   │
5. telegram/queue.py:
   ├─ Bundle pending content
   ├─ Send to Wolf via Telegram with buttons
   │
6. Wolf approves → content.status = 'approved'
   │
7. social.py:
   ├─ Idempotency check (ledger)
   ├─ Rate limit check (Late API)
   ├─ Post via Late API
   ├─ Record in actions_ledger
   ├─ Audit log: post action + cost
   │
8. etsy.py:
   ├─ Format listing package (title, 13 tags, description, price)
   ├─ Save as formatted text for Wolf to copy-paste
   │
9. Daily summary → Telegram
```
