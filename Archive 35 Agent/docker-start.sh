#!/bin/bash
#
# Archive-35 Agent System — Docker Startup Script
#
# Simple, safe startup script for 24/7 operation
# Checks prerequisites, initializes database, starts all services, verifies health
#
# Usage:
#   chmod +x docker-start.sh
#   ./docker-start.sh
#
# To start in background:
#   ./docker-start.sh &
#
# To view logs after startup:
#   docker-compose logs -f

set -e  # Exit on any error

# ──────────────────────────────────────────────────────────────────────
# Colors for terminal output (helps with readability)
# ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No color

# ──────────────────────────────────────────────────────────────────────
# Helper Functions
# ──────────────────────────────────────────────────────────────────────

print_status() {
    echo -e "${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# ──────────────────────────────────────────────────────────────────────
# Main Script
# ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         Archive-35 Agent System — Docker Startup               ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ──────────────────────────────────────────────────────────────────────
# 1. Check Prerequisites
# ──────────────────────────────────────────────────────────────────────

print_status "Checking prerequisites..."

# Check Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker not found. Please install Docker Desktop:"
    echo "   https://www.docker.com/products/docker-desktop"
    exit 1
fi
print_success "Docker installed"

# Check Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose not found. Please install Docker Desktop (includes Compose)"
    exit 1
fi
print_success "Docker Compose installed"

# Check Docker daemon is running
if ! docker ps &> /dev/null; then
    print_error "Docker daemon not running. Start Docker Desktop and try again."
    exit 1
fi
print_success "Docker daemon running"

# ──────────────────────────────────────────────────────────────────────
# 2. Check Environment Configuration
# ──────────────────────────────────────────────────────────────────────

print_status "Checking environment configuration..."

if [ ! -f ".env" ]; then
    print_warning ".env file not found"
    echo ""
    echo "   Creating .env from template. Please fill in your API keys:"
    echo ""

    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_success "Copied .env.example → .env"
        echo ""
        echo "   ${YELLOW}⚠ Edit .env now and fill in:${NC}"
        echo "     • ANTHROPIC_API_KEY (required for content generation)"
        echo "     • TELEGRAM_BOT_TOKEN (optional, for Telegram notifications)"
        echo "     • TELEGRAM_CHAT_ID (optional)"
        echo "     • DAILY_BUDGET_USD (spending limit)"
        echo "     • LOG_LEVEL (DEBUG, INFO, WARNING)"
        echo ""
        echo "   Then run this script again."
        exit 1
    else
        print_error ".env.example not found"
        exit 1
    fi
else
    print_success ".env file exists"

    # Warn if critical variables are missing
    if ! grep -q "ANTHROPIC_API_KEY" .env || grep -q "ANTHROPIC_API_KEY=$" .env; then
        print_warning "ANTHROPIC_API_KEY not set in .env — Claude features will fail"
    fi
fi

# ──────────────────────────────────────────────────────────────────────
# 3. Create Data Directories
# ──────────────────────────────────────────────────────────────────────

print_status "Setting up data directories..."

mkdir -p data/photos
mkdir -p data/content/etsy_listings
mkdir -p data/content/instagram
mkdir -p data/content/telegram
mkdir -p data/approved
mkdir -p logs

print_success "Data directories ready"

# ──────────────────────────────────────────────────────────────────────
# 4. Build Docker Images
# ──────────────────────────────────────────────────────────────────────

print_status "Building Docker images (first run may take 1-2 minutes)..."
echo ""

# Check if images already exist and are recent
# If yes, skip rebuild; if no, rebuild
if docker compose config &> /dev/null; then
    REBUILD=false
    for service in agent-api agent-scheduler agent-telegram; do
        IMAGE_NAME=$(docker compose config --format json | grep -o "archive35-${service}:\w*" | head -1 || true)
        if [ -z "$IMAGE_NAME" ]; then
            REBUILD=true
        fi
    done
else
    REBUILD=true
fi

if [ "$REBUILD" = true ]; then
    docker compose build --no-cache || {
        print_error "Docker build failed"
        exit 1
    }
else
    print_warning "Using existing images (run 'docker-compose build --no-cache' to rebuild)"
fi

print_success "Docker images ready"

# ──────────────────────────────────────────────────────────────────────
# 5. Start Services
# ──────────────────────────────────────────────────────────────────────

print_status "Starting services..."
echo ""

docker compose up -d

print_success "Services started (running in background)"

# ──────────────────────────────────────────────────────────────────────
# 6. Wait for Health Checks
# ──────────────────────────────────────────────────────────────────────

print_status "Waiting for services to be ready (up to 30 seconds)..."
echo ""

MAX_RETRIES=30
RETRY=0

while [ $RETRY -lt $MAX_RETRIES ]; do
    # Check if API is ready
    if curl -sf http://localhost:8035/health &> /dev/null; then
        print_success "API service is healthy"
        break
    fi

    RETRY=$((RETRY + 1))
    if [ $((RETRY % 5)) -eq 0 ]; then
        echo "  Waiting... ($RETRY/$MAX_RETRIES)"
    fi
    sleep 1
done

if [ $RETRY -eq $MAX_RETRIES ]; then
    print_warning "API health check timed out. Services may still be starting."
    echo ""
    echo "  Check status: ${BLUE}docker-compose ps${NC}"
    echo "  View logs:    ${BLUE}docker-compose logs -f agent-api${NC}"
else
    echo ""
fi

# ──────────────────────────────────────────────────────────────────────
# 7. Display System Status
# ──────────────────────────────────────────────────────────────────────

echo ""
print_status "System Status:"
echo ""

docker compose ps

# ──────────────────────────────────────────────────────────────────────
# 8. Show Access Information
# ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                        NEXT STEPS                              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
print_success "Archive-35 Agent System is running!"
echo ""
echo "  ${GREEN}API Server:${NC}         http://localhost:8035"
echo "  ${GREEN}API Docs:${NC}           http://localhost:8035/docs"
echo "  ${GREEN}Health Check:${NC}       http://localhost:8035/health"
echo ""
echo "  ${BLUE}View all logs:${NC}       docker-compose logs -f"
echo "  ${BLUE}View API logs:${NC}       docker-compose logs -f agent-api"
echo "  ${BLUE}View scheduler logs:${NC} docker-compose logs -f agent-scheduler"
echo "  ${BLUE}View Telegram logs:${NC}  docker-compose logs -f agent-telegram"
echo ""
echo "  ${BLUE}Stop all services:${NC}   docker-compose down"
echo "  ${BLUE}Restart a service:${NC}   docker-compose restart agent-api"
echo ""
echo "  ${BLUE}Execute API call:${NC}    curl -s http://localhost:8035/stats | jq"
echo "  ${BLUE}Manual pipeline run:${NC} curl -X POST http://localhost:8035/pipeline/run?dry_run=false"
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo ""

print_success "Startup complete!"
