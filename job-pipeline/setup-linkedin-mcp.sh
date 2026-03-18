#!/bin/bash
# ============================================================
# LinkedIn MCP Server Setup
# Run this on your Mac (not in the VM)
# ============================================================

set -e

echo "=== LinkedIn MCP Server Setup ==="
echo ""

# Step 1: Check for uv
if ! command -v uv &> /dev/null; then
    echo "Installing uv (Python package manager)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
echo "✓ uv $(uv --version)"

# Step 2: Install Patchright browser
echo ""
echo "Installing Patchright Chromium browser..."
uvx patchright install chromium
echo "✓ Patchright Chromium installed"

# Step 3: Log into LinkedIn (interactive - opens browser)
echo ""
echo "=== IMPORTANT ==="
echo "A browser window will open. Log into LinkedIn."
echo "You have 5 minutes to complete login + any 2FA/CAPTCHA."
echo "After login, the browser will close automatically."
echo ""
read -p "Press Enter to open LinkedIn login..."

uvx linkedin-scraper-mcp --login

echo ""
echo "✓ LinkedIn session saved to ~/.linkedin-mcp/profile/"

# Step 4: Quick test
echo ""
echo "Testing MCP server..."
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 10 uvx linkedin-scraper-mcp 2>/dev/null | head -1 && echo "✓ MCP server responds" || echo "⚠ Test failed - but may still work"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The job pipeline server will now use LinkedIn MCP for:"
echo "  • Full job descriptions from LinkedIn"
echo "  • LinkedIn job search with keywords + location"
echo "  • Company job listings"
echo ""
echo "Restart your server: cd ~/job-pipeline && node server.js"
echo ""
echo "If LinkedIn asks to re-authenticate later, run:"
echo "  uvx linkedin-scraper-mcp --login"
