# Archive-35 Commerce MCP Server

Search and license authentic fine art photography via the Model Context Protocol.

## What This Is

An MCP server that gives AI agents access to a curated catalog of 1,274 C2PA-verified fine art photographs from 55+ countries. All images are authentic photography (NOT AI generated) by Wolf Schram / The Restless Eye.

## Tools Available

- **search_images** — Search by subject, mood, location, orientation
- **get_image_details** — Full specs, pricing, and licensing info
- **browse_collections** — 48 collections from Argentina to Valley of Fire
- **get_licensing_info** — Pricing tiers and payment options
- **get_purchase_url** — Checkout URL for Stripe or x402 USDC payment

## Pricing

- Web/Social: $2.50 per image (2400px, 1-year license)
- Commercial: $5.00 per image (full resolution, 2-year license)
- Prepaid credits: $25 for 10 web licenses

## Payment Methods

- **Stripe** (USD) — standard checkout
- **USDC on Base** (x402 protocol) — automated agent payment

## Installation

```bash
pip install archive35-commerce-mcp
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "archive35": {
      "command": "archive35-mcp"
    }
  }
}
```

## Links

- Website: https://archive-35.com
- Catalog: https://archive-35.com/api/license/gallery
- MCP Spec: https://archive-35.com/.well-known/mcp/server.json
- OpenAPI: https://archive-35.com/.well-known/openapi.json
