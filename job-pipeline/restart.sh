#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Job Pipeline — Restart Everything
# Stops all processes, then starts fresh
# Usage: bash restart.sh
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "═══ Restarting Job Pipeline ═══"
echo ""

bash "$SCRIPT_DIR/stop.sh"
echo ""
bash "$SCRIPT_DIR/start.sh"
