#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Archive-35 Social Media — Migration Script
# Moves from iCloud to ~/Documents/archive-35-social/
# Run on the i7 machine
# ═══════════════════════════════════════════════════════════════

set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Archive-35 Social Media — Migration to Documents ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── PATHS ────────────────────────────────────────────────────
ICLOUD_APP="$HOME/Library/Mobile Documents/com~apple~CloudDocs/social_media_app"
NEW_HOME="$HOME/Documents/archive-35-social"
ICLOUD_SHARED="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35"

# ─── STEP 1: Create new home ─────────────────────────────────
echo "▸ Step 1: Creating new home at $NEW_HOME"
mkdir -p "$NEW_HOME"

# ─── STEP 2: Copy app files (not node_modules) ──────────────
echo "▸ Step 2: Copying app files from iCloud..."
if [ -d "$ICLOUD_APP" ]; then
    rsync -av --exclude='node_modules' --exclude='output' --exclude='.git' \
        "$ICLOUD_APP/" "$NEW_HOME/"
    echo "  ✓ App files copied"
else
    echo "  ⚠ iCloud app folder not found at: $ICLOUD_APP"
    echo "  → Extracting from latest zip instead..."
    # If they have a downloaded zip, extract it
    LATEST_ZIP=$(ls -t ~/Downloads/social_media_app_v*.zip 2>/dev/null | head -1)
    if [ -n "$LATEST_ZIP" ]; then
        unzip -o "$LATEST_ZIP" -d "$NEW_HOME/"
        echo "  ✓ Extracted from $LATEST_ZIP"
    else
        echo "  ✗ No source found. Place the latest zip in ~/Downloads/ and re-run."
        exit 1
    fi
fi

# ─── STEP 3: Create folder structure ─────────────────────────
echo "▸ Step 3: Creating folder structure..."

# Local folders (on this machine only)
mkdir -p "$NEW_HOME/output"          # Rendered videos go here
mkdir -p "$NEW_HOME/logs"            # App logs
mkdir -p "$NEW_HOME/temp"            # Temp render files
mkdir -p "$NEW_HOME/config"          # Local config overrides

# iCloud shared folders (synced from M3)
mkdir -p "$ICLOUD_SHARED/Photography"   # Photo galleries (already exists)
mkdir -p "$ICLOUD_SHARED/Templates"     # Video templates from Compositor Editor
mkdir -p "$ICLOUD_SHARED/Templates/assets"  # Logos, brand elements
mkdir -p "$ICLOUD_SHARED/Templates/audio"   # Audio files for videos

echo "  ✓ Folder structure created"

# ─── STEP 4: Create/update config pointing to iCloud ─────────
echo "▸ Step 4: Writing config..."
cat > "$NEW_HOME/config/paths.json" << 'PATHEOF'
{
  "photographyPath": "~/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35/Photography",
  "templatesPath": "~/Library/Mobile Documents/com~apple~CloudDocs/Shared for Archive 35/Templates",
  "outputPath": "~/Documents/archive-35-social/output",
  "tempPath": "~/Documents/archive-35-social/temp",
  "logsPath": "~/Documents/archive-35-social/logs"
}
PATHEOF
echo "  ✓ Config written"

# ─── STEP 5: Install dependencies ────────────────────────────
echo "▸ Step 5: Installing npm dependencies..."
cd "$NEW_HOME"
npm install 2>&1 | tail -5
echo "  ✓ Dependencies installed"

# ─── STEP 6: Create launch script ────────────────────────────
echo "▸ Step 6: Creating launch script..."
cat > "$NEW_HOME/start.sh" << 'STARTEOF'
#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Archive-35 Social Media..."
npm run dev
STARTEOF
chmod +x "$NEW_HOME/start.sh"
echo "  ✓ Launch script created: $NEW_HOME/start.sh"

# ─── STEP 7: Clean up old iCloud app files ───────────────────
echo ""
echo "▸ Step 7: Cleanup"
echo ""
echo "  The following can be safely deleted from iCloud:"
echo "  → $ICLOUD_APP"
echo ""
read -p "  Delete old iCloud app folder? (y/N): " confirm
if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    rm -rf "$ICLOUD_APP"
    echo "  ✓ Old iCloud app folder deleted"
else
    echo "  → Skipped. You can delete it manually later."
fi

# Also clean downloaded zips
echo ""
echo "  Old version zips in ~/Downloads/:"
ls -la ~/Downloads/social_media_app_v*.zip 2>/dev/null || echo "  (none found)"
echo ""
read -p "  Delete old version zips? (y/N): " confirm2
if [ "$confirm2" = "y" ] || [ "$confirm2" = "Y" ]; then
    rm -f ~/Downloads/social_media_app_v*.zip
    echo "  ✓ Old zips deleted"
else
    echo "  → Skipped."
fi

# ─── DONE ─────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✓ Migration complete!                           ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  App location:                                   ║"
echo "║    ~/Documents/archive-35-social/                ║"
echo "║                                                  ║"
echo "║  To start:                                       ║"
echo "║    cd ~/Documents/archive-35-social && npm run dev║"
echo "║    — or —                                        ║"
echo "║    ~/Documents/archive-35-social/start.sh        ║"
echo "║                                                  ║"
echo "║  iCloud shared folders (synced from M3):         ║"
echo "║    .../Shared for Archive 35/Photography/        ║"
echo "║    .../Shared for Archive 35/Templates/          ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
