#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Job Pipeline — Start Everything
# Launches Chrome/Brave with CDP + Node server as a linked pair
# Closing Chrome will auto-stop the server.
# Usage: bash start.sh
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CDP_PORT=9222
SERVER_PORT=3000
PID_FILE="$SCRIPT_DIR/.pipeline.pids"

echo "═══ Job Pipeline Startup ═══"
echo ""

# ─── Clean up any previous run ───────────────────────────────
bash "$SCRIPT_DIR/stop.sh" 2>/dev/null

# ─── Step 1: Detect browser ──────────────────────────────────

BROWSER=""
BROWSER_NAME=""
if [ -d "/Applications/Brave Browser.app" ]; then
  BROWSER="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  BROWSER_NAME="Brave"
elif [ -d "/Applications/Google Chrome.app" ]; then
  BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  BROWSER_NAME="Chrome"
elif command -v google-chrome &> /dev/null; then
  BROWSER="google-chrome"
  BROWSER_NAME="Chrome (Linux)"
elif command -v chromium-browser &> /dev/null; then
  BROWSER="chromium-browser"
  BROWSER_NAME="Chromium"
fi

if [ -z "$BROWSER" ]; then
  echo "⚠ No Chrome/Brave found. ATS bot will use manual mode."
  echo "  Install Chrome or Brave for automated form filling."
  echo ""
  echo "Starting server only..."
  nohup node server.js > server.log 2>&1 &
  SERVER_PID=$!
  echo "server=$SERVER_PID" > "$PID_FILE"
  echo "browser=" >> "$PID_FILE"

  for i in 1 2 3 4 5 6; do
    if curl -s "http://localhost:$SERVER_PORT/api/health" > /dev/null 2>&1; then
      echo "✓ Server running (PID: $SERVER_PID)"
      break
    fi
    sleep 1
  done
  echo ""
  echo "═══ Server Only Mode ═══"
  echo "  Command Center: http://localhost:$SERVER_PORT"
  echo "  To stop: bash stop.sh"
  exit 0
fi

# ─── Step 2: Launch browser with CDP ─────────────────────────

echo "Launching $BROWSER_NAME with CDP on port $CDP_PORT..."
# Uses your normal browser profile — all your logins and bookmarks are available
"$BROWSER" \
  --remote-debugging-port=$CDP_PORT \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &

BROWSER_PID=$!
echo "✓ $BROWSER_NAME launched (PID: $BROWSER_PID)"

# Wait for CDP to be ready
for i in 1 2 3 4 5; do
  if curl -s "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
    echo "✓ CDP endpoint ready"
    break
  fi
  sleep 1
done

# ─── Step 3: Start the Node server ───────────────────────────

echo ""
echo "Starting server..."
nohup node server.js > server.log 2>&1 &
SERVER_PID=$!

for i in 1 2 3 4 5 6; do
  if curl -s "http://localhost:$SERVER_PORT/api/health" > /dev/null 2>&1; then
    echo "✓ Server running (PID: $SERVER_PID)"
    break
  fi
  sleep 1
done

# ─── Step 4: Save PIDs ───────────────────────────────────────

echo "server=$SERVER_PID" > "$PID_FILE"
echo "browser=$BROWSER_PID" >> "$PID_FILE"

# ─── Step 5: Open Command Center ─────────────────────────────

echo ""
if command -v open &> /dev/null; then
  open "http://localhost:$SERVER_PORT"
  echo "✓ Command Center opened in $BROWSER_NAME"
fi

# ─── Step 6: Background watchdog ─────────────────────────────
# Monitors the browser — when Chrome closes, auto-kills the server

(
  while kill -0 $BROWSER_PID 2>/dev/null; do
    sleep 5
  done
  # Browser died — stop the server too
  echo "[watchdog] $BROWSER_NAME closed. Shutting down server..."
  kill $SERVER_PID 2>/dev/null
  rm -f "$PID_FILE"
) &
WATCHDOG_PID=$!
echo "watchdog=$WATCHDOG_PID" >> "$PID_FILE"

echo ""
echo "═══ All Systems Go ═══"
echo "  Command Center: http://localhost:$SERVER_PORT"
echo "  CDP Endpoint:   http://localhost:$CDP_PORT"
echo "  Browser:        $BROWSER_NAME (PID: $BROWSER_PID)"
echo ""
echo "  Close $BROWSER_NAME → server auto-stops"
echo "  Or run: bash stop.sh"
echo "  Or use the ⟲ Restart button in the Command Center"
echo ""
