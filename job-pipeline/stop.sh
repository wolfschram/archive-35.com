#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Job Pipeline — Stop Server
# Kills the Node server and watchdog. Does NOT kill Chrome.
# (Chrome uses your normal profile — you probably want it open)
# Usage: bash stop.sh
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.pipeline.pids"

echo "═══ Stopping Job Pipeline ═══"

# Read saved PIDs
if [ -f "$PID_FILE" ]; then
  source "$PID_FILE"

  if [ -n "$watchdog" ]; then
    kill $watchdog 2>/dev/null && echo "✓ Watchdog stopped"
  fi
  if [ -n "$server" ]; then
    kill $server 2>/dev/null && echo "✓ Server stopped (PID: $server)"
  fi
  # NOTE: We do NOT kill the browser — it uses the normal profile

  rm -f "$PID_FILE"
fi

# Belt and suspenders — also kill by process name
pkill -f "node server.js" 2>/dev/null

echo "✓ Server stopped (Chrome left running)"
echo ""
