# Archive-35 Agent — Docker Deployment Guide

**For 24/7 autonomous operation without Electron Studio**

This guide explains how to run the Archive-35 Agent System as Docker containers. Once running, the system:

- Analyzes photos with Claude vision AI 24/7
- Generates social media content automatically
- Posts to Instagram, Etsy, and other platforms
- Sends real-time updates via Telegram
- Maintains cost limits and rate constraints
- Persists all data to SQLite database

---

## Quick Start (3 steps)

### 1. Check Prerequisites

You need **Docker Desktop** installed:
- **macOS**: https://www.docker.com/products/docker-desktop
- **Windows**: https://www.docker.com/products/docker-desktop
- **Linux**: `sudo apt install docker.io docker-compose`

Verify installation:
```bash
docker --version
docker-compose --version
```

### 2. Configure Environment

Copy the template and fill in your API keys:

```bash
cp .env.example .env
```

Edit `.env` and add:
- `ANTHROPIC_API_KEY` (required — get from https://console.anthropic.com)
- `TELEGRAM_BOT_TOKEN` (optional — for notifications)
- `TELEGRAM_CHAT_ID` (optional — your Telegram user ID)
- `DAILY_BUDGET_USD` (e.g., 5.00 for $5/day limit)

### 3. Start Everything

```bash
chmod +x docker-start.sh
./docker-start.sh
```

The startup script will:
1. Verify Docker is installed and running
2. Build Docker images
3. Create data directories
4. Start all services (API, scheduler, Telegram bot)
5. Wait for health checks (30 seconds)
6. Show you the status and access URLs

---

## What Runs Where

### Services Overview

| Service | Purpose | Port | Notes |
|---------|---------|------|-------|
| **agent-api** | FastAPI REST server | 8035 | Responds to Electron Studio UI, provides health checks |
| **agent-scheduler** | Huey background task queue | (internal) | Runs daily pipeline, generates content, posts to platforms |
| **agent-telegram** | Telegram bot | (external) | Sends notifications, accepts manual approvals via Telegram |

All three services:
- Share the same SQLite database (persisted in `./data/`)
- Read environment variables from `.env`
- Auto-restart if they crash (`restart: unless-stopped`)
- Run on internal network (`agent-network`)

---

## Daily Usage

### Start Services

```bash
docker-compose up -d
```

### Check Status

```bash
# See which services are running
docker-compose ps

# Show recent logs
docker-compose logs -f

# Show logs for one service
docker-compose logs -f agent-api
docker-compose logs -f agent-scheduler
docker-compose logs -f agent-telegram
```

### Stop Services

```bash
# Stop all services (data persists)
docker-compose down

# Stop all services AND delete data (careful!)
docker-compose down -v
```

### Restart a Service

If one service crashes or becomes unresponsive:

```bash
docker-compose restart agent-api          # Restart API only
docker-compose restart agent-scheduler    # Restart scheduler only
```

---

## Accessing the System

### API Endpoints (via curl or browser)

Once running, the API is available at `http://localhost:8035`

#### Health Check
```bash
curl http://localhost:8035/health
```

#### Dashboard Stats
```bash
curl http://localhost:8035/stats | jq
```

Returns:
- Photo counts and analysis status
- Content items (pending, approved, posted)
- Daily/total costs
- Kill switch status
- Telegram queue stats

#### List Photos
```bash
curl "http://localhost:8035/photos?limit=10" | jq
```

#### List Content
```bash
curl "http://localhost:8035/content?status=pending&limit=5" | jq
```

#### Approve Content Item
```bash
curl -X POST http://localhost:8035/content/{content_id}/approve | jq
```

#### Manual Pipeline Run
```bash
# Dry run (shows what would happen, no actual posting)
curl -X POST "http://localhost:8035/pipeline/run?dry_run=true" | jq

# Real run (actually generates content and posts)
curl -X POST "http://localhost:8035/pipeline/run?dry_run=false" | jq
```

#### View Audit Logs
```bash
curl "http://localhost:8035/pipeline/logs?limit=50" | jq
```

### Swagger API Docs

Open http://localhost:8035/docs in your browser to see interactive API documentation.

---

## Database Access

The SQLite database is stored in `./data/archive35.db`

### View Database Tables

```bash
docker-compose exec agent-api sqlite3 data/archive35.db ".tables"
```

### Query Data

```bash
docker-compose exec agent-api sqlite3 data/archive35.db ".mode column" "SELECT COUNT(*) as total_photos FROM photos;"
```

### Backup Database

```bash
cp data/archive35.db data/archive35.db.backup
```

---

## Troubleshooting

### "Port 8035 already in use"

If port 8035 is already taken on your machine, change it in `docker-compose.yml`:

```yaml
agent-api:
  ports:
    - "9000:8035"  # Use port 9000 instead
```

Then access API at `http://localhost:9000`

### "Health check failing"

Check if containers are running:
```bash
docker-compose ps
```

If containers exited, check logs:
```bash
docker-compose logs agent-api
docker-compose logs agent-scheduler
```

Common issues:
- Missing `.env` file or invalid API keys
- Database locked (another process using it)
- Insufficient system resources

### API not responding

Verify the service is healthy:
```bash
curl -v http://localhost:8035/health
```

If it times out, the container might be still starting. Wait 30 seconds and try again.

### Telegram bot not sending messages

1. Check if `TELEGRAM_BOT_TOKEN` is set in `.env`
2. Verify token is valid (get from @BotFather on Telegram)
3. Check `TELEGRAM_CHAT_ID` is your actual user ID
4. View logs: `docker-compose logs agent-telegram`

To find your Telegram chat ID:
1. Send any message to your bot
2. Visit `https://api.telegram.org/bot{YOUR_TOKEN}/getUpdates`
3. Find your message in the JSON response; look for `chat.id`

### Running Out of Disk Space

Imported photos and generated content are stored in `./data/`

```bash
# See how much space is used
du -sh data/

# Clear old content (keep database)
rm -rf data/photos/*
rm -rf data/content/*

# Keep the database:
# data/archive35.db will remain
```

---

## Advanced Configuration

### Resource Limits (Optional)

By default, containers use as much CPU/memory as needed. To limit resources, edit `docker-compose.yml`:

```yaml
agent-api:
  deploy:
    resources:
      limits:
        cpus: "1.0"        # Max 1 CPU core
        memory: 512M       # Max 512 MB RAM
      reservations:
        cpus: "0.5"        # Request 0.5 CPU
        memory: 256M       # Request 256 MB
```

### Custom Photo Directory

By default, photos are imported from `./data/photos/`

To import from another location:
1. Edit `docker-compose.yml`
2. Add a new volume to `agent-api`:
   ```yaml
   volumes:
     - /path/to/your/photos:/app/import_photos:ro
   ```
3. Set `PHOTO_IMPORT_DIR=/app/import_photos` in `.env`

### Log Level

In `.env`, set `LOG_LEVEL`:
- `DEBUG` — Very verbose, shows all function calls
- `INFO` — Normal, shows major operations
- `WARNING` — Only warnings and errors
- `ERROR` — Only errors

### Disable Telegram Bot (Optional)

If you don't want Telegram notifications, comment out the `agent-telegram` service in `docker-compose.yml`:

```yaml
# agent-telegram:
#   build: .
#   ...
```

Then restart:
```bash
docker-compose up -d
```

---

## Production Deployment

For running on a server (Linux VPS, Raspberry Pi, NAS):

### 1. Install Docker

**Ubuntu/Debian:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**Raspberry Pi (ARM):**
Docker Desktop works, or use the lightweight Docker for ARM

### 2. Clone Repository & Setup

```bash
git clone https://github.com/wolfschram/archive-35.com.git
cd "archive-35.com/Archive 35 Agent"
cp .env.example .env
# Edit .env with your API keys
```

### 3. Start Services

```bash
chmod +x docker-start.sh
./docker-start.sh
```

### 4. Keep Running on Reboot

Use systemd service file:

**Create `/etc/systemd/system/archive35.service`:**
```ini
[Unit]
Description=Archive-35 Agent System
After=docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/path/to/archive-35.com/Archive 35 Agent
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
Restart=unless-stopped
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable archive35.service
sudo systemctl start archive35.service
sudo systemctl status archive35.service
```

---

## Monitoring & Alerts

### Watch System in Real Time

```bash
# Follow all logs
docker-compose logs -f --tail 50

# Follow one service
docker-compose logs -f agent-scheduler
```

### Set Up Telegram Alerts

The system already sends Telegram messages. To add custom alerts:

```bash
# Send a test message via Telegram bot (if configured)
docker-compose exec agent-api \
  python -c "from src.telegram.bot import send_message; send_message('Test alert')"
```

### Monitor API Health

```bash
# Simple heartbeat check (useful in cron)
curl -sf http://localhost:8035/health > /dev/null && echo "API OK" || echo "API DOWN"
```

Add to crontab to check every 5 minutes:
```bash
*/5 * * * * curl -sf http://localhost:8035/health > /dev/null || echo "Archive-35 API is down" | mail -s "Alert" wolf@archive-35.com
```

---

## File Structure

```
Archive 35 Agent/
├── Dockerfile              # Image definition (base Python + dependencies)
├── docker-compose.yml      # Service orchestration (API, scheduler, Telegram)
├── .dockerignore          # Files to exclude from Docker build
├── docker-start.sh        # Startup script (checks prereqs, builds, starts)
├── .env.example           # Template (copy to .env and fill in keys)
├── pyproject.toml         # Python dependencies
├── uv.lock                # Locked dependency versions (reproducible builds)
├── src/
│   ├── api.py             # FastAPI server
│   ├── pipeline/          # Daily pipeline tasks
│   ├── telegram/          # Telegram bot
│   ├── agents/            # Claude AI agents
│   ├── db.py              # SQLite database setup
│   └── config.py          # Settings from .env
├── scripts/
│   └── init_db.py         # Initialize database schema
├── data/                  # Persistent storage (created by Docker)
│   ├── archive35.db       # SQLite database
│   ├── photos/            # Imported photos
│   ├── content/           # Generated content
│   └── approved/          # Approved items
└── logs/                  # Log files
```

---

## Getting Help

Check these files for more info:

- **[CLAUDE.md](./CLAUDE.md)** — Project architecture and critical files
- **[README.md](./README.md)** — General project overview
- **[docs/](./docs/)** — Detailed documentation by feature

**API Issues?**
```bash
docker-compose logs -f agent-api
```

**Pipeline failing?**
```bash
docker-compose logs -f agent-scheduler
```

**Database locked?**
```bash
docker-compose restart agent-api
docker-compose restart agent-scheduler
```

---

## Summary

| Task | Command |
|------|---------|
| Start for first time | `./docker-start.sh` |
| Start again | `docker-compose up -d` |
| Check status | `docker-compose ps` |
| View logs | `docker-compose logs -f` |
| Stop | `docker-compose down` |
| Restart one service | `docker-compose restart {service}` |
| View database | `docker-compose exec agent-api sqlite3 data/archive35.db ".tables"` |
| Test API | `curl http://localhost:8035/health` |
| Manual pipeline | `curl -X POST http://localhost:8035/pipeline/run?dry_run=false` |

---

**Questions?** Email wolf@archive-35.com

**System Status**: http://localhost:8035/docs (once running)
