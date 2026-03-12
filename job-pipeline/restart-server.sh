#!/bin/bash
# Server-only restart (used by the Command Center restart button)
# Does NOT touch Chrome/browser — just restarts the Node server
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

pkill -f "node server.js" 2>/dev/null
sleep 2
nohup node server.js > server.log 2>&1 &
echo "Server restarted (PID: $!)"

# Update PID file if it exists
PID_FILE="$SCRIPT_DIR/.pipeline.pids"
if [ -f "$PID_FILE" ]; then
  sed -i '' "s/^server=.*/server=$!/" "$PID_FILE" 2>/dev/null || \
  sed -i "s/^server=.*/server=$!/" "$PID_FILE" 2>/dev/null
fi

sleep 3
tail -30 server.log
