# Archive-35 — AI Agent System

> The Restless Eye | Fine Art Photography Automation

AI-powered system that automates content generation, social media posting, and marketplace listing management for a fine art photography print business.

## Quick Start

```bash
# Install dependencies
uv sync

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# Initialize database
uv run python scripts/init_db.py

# Run daily pipeline
uv run python -m src.pipeline.daily

# Start Telegram bot
uv run python -m src.telegram.bot

# Run tests
uv run pytest tests/ -v
```

## Architecture

See `docs/ARCHITECTURE.md` for full system design.
See `docs/DEPENDENCIES.md` for component dependency map.
See `docs/BUILD_TRACKER.md` for build progress.

## For Claude Coworker

1. Grant Coworker access to this folder
2. Read `docs/COWORKER_OVERNIGHT_PROMPT.md`
3. Paste the prompt into Coworker
4. Let it run through the build tracker

## License

Proprietary — The Restless Eye / Archive-35
