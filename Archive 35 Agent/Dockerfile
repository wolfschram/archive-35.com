# Archive-35 AI Agent System — Docker Image
# Enables 24/7 independent operation without Electron Studio dependency
#
# Build:  docker build -t archive35-agent .
# Run:    docker run -it -v ./data:/app/data --env-file .env archive35-agent

FROM python:3.12-slim

# ──────────────────────────────────────────────────────────────────────
# Metadata
# ──────────────────────────────────────────────────────────────────────
LABEL maintainer="wolf@archive-35.com"
LABEL description="Archive-35 AI Agent System — 24/7 Autonomous Photo Content Pipeline"
LABEL version="0.1.0"

# ──────────────────────────────────────────────────────────────────────
# System Dependencies
# ──────────────────────────────────────────────────────────────────────
# Install curl for health checks and other utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ──────────────────────────────────────────────────────────────────────
# Python & uv Setup
# ──────────────────────────────────────────────────────────────────────
# Install uv package manager for fast, reliable dependency installation
# uv is significantly faster than pip and ensures reproducible builds
RUN pip install --no-cache-dir uv

# Set working directory
WORKDIR /app

# ──────────────────────────────────────────────────────────────────────
# Dependency Installation (Cached Layer)
# ──────────────────────────────────────────────────────────────────────
# Copy only dependency files first so Docker caches this layer
# If you change code but not dependencies, Docker reuses this cached layer
COPY pyproject.toml uv.lock* ./

# Install production dependencies (--no-dev excludes test dependencies)
# --no-editable: install as regular packages, not editable symlinks
RUN uv sync --no-dev --no-editable

# ──────────────────────────────────────────────────────────────────────
# Application Code
# ──────────────────────────────────────────────────────────────────────
# Copy application code after dependencies (changes here won't invalidate dependency cache)
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY docs/ ./docs/

# ──────────────────────────────────────────────────────────────────────
# Data Directories
# ──────────────────────────────────────────────────────────────────────
# Create directories for persistent data that will be mounted as volumes
# These hold photos, generated content, and SQLite database
RUN mkdir -p \
    data/photos \
    data/content/etsy_listings \
    data/content/instagram \
    data/content/telegram \
    data/approved \
    logs

# ──────────────────────────────────────────────────────────────────────
# Health Check
# ──────────────────────────────────────────────────────────────────────
# Docker uses this to verify the container is healthy and ready
# Runs every 30 seconds; if 3 consecutive checks fail, container is marked unhealthy
# Timeout of 10 seconds per check; start period allows 15 seconds for startup
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
    CMD curl -sf http://localhost:8035/health > /dev/null || exit 1

# ──────────────────────────────────────────────────────────────────────
# Container Startup
# ──────────────────────────────────────────────────────────────────────
# ENTRYPOINT: Base command that always runs (uv + Python)
# CMD: Default arguments (can be overridden by docker run or docker-compose)
#
# Override examples:
#   docker run archive35-agent python -m src.api        # Run API only
#   docker run archive35-agent python -m src.pipeline    # Run daily pipeline
#   docker run archive35-agent python -m src.telegram    # Run Telegram bot
ENTRYPOINT ["uv", "run"]
CMD ["python", "-m", "src.api"]
