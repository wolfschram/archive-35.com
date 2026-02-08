const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, PageOrientation, LevelFormat,
        HeadingLevel, BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak } = require('docx');
const fs = require('fs');
const path = require('path');

// Define border style for tables
const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Arial", size: 22 }, // 11pt
      }
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1a1a1a" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2d5aa8" },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 }
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "404040" },
        paragraph: { spacing: { before: 120, after: 60 }, outlineLevel: 2 }
      }
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: "◦",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } }
          }
        ]
      },
      {
        reference: "numbers",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          }
        ]
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: {
          width: 12240,   // 8.5 inches (US Letter)
          height: 15840   // 11 inches
        },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } // 1 inch margins
      }
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "ARCHIVE-35 | CONFIDENTIAL",
                size: 20,
                bold: true,
                color: "666666"
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            border: { bottom: { color: "CCCCCC", space: 1, style: BorderStyle.SINGLE, size: 6 } }
          })
        ]
      })
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            children: [
              new TextRun("Page "),
              new TextRun({ children: [PageNumber.CURRENT] })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 240 },
            border: { top: { color: "CCCCCC", space: 1, style: BorderStyle.SINGLE, size: 6 } }
          })
        ]
      })
    },
    children: [
      // TITLE
      new Paragraph({
        children: [
          new TextRun({
            text: "Archive-35 Implementation Plan",
            bold: true,
            size: 40,
            color: "1a1a1a"
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "Phases 4, 5 & 6",
            bold: true,
            size: 28,
            color: "2d5aa8"
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "February 8, 2026",
            size: 22,
            italic: true,
            color: "666666"
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 }
      }),

      // ============ PHASE 4 ============
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("PHASE 4: MCP Server (Model Context Protocol)")]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Priority: ", bold: true }),
          new TextRun("HIGH — 1-2 days implementation")
        ],
        spacing: { after: 60 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Why First: ", bold: true }),
          new TextRun("Easiest win. Builds on existing /api/products.json endpoint. MCP is the de facto protocol for AI agent integration (adopted by OpenAI, Google, Anthropic).")
        ],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("What It Does")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Exposes Archive-35's product catalog directly to AI agents (Claude, ChatGPT, Gemini)")],
        spacing: { after: 60 }
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("When a user asks an AI \"find me fine art landscape photography,\" your catalog is searchable")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Technical Approach")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Build a Cloudflare Worker that implements the MCP Streamable HTTP transport")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Uses @modelcontextprotocol/sdk (TypeScript)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Deploys as a separate Worker: mcp.archive-35.com (or archive-35-com-mcp.workers.dev)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Reads from existing /data/photos.json")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Tools to Expose")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "search_products(query, limit) ", bold: true }), new TextRun("— Full-text search across titles, descriptions, collections")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "get_product(id) ", bold: true }), new TextRun("— Detailed product info with pricing, materials, sizes")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "get_collection(collection_id) ", bold: true }), new TextRun("— All photos in a collection")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "get_catalog_summary() ", bold: true }), new TextRun("— Overview: 108 products, 3 collections, 5 materials, price range")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Resources to Expose")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "catalog://products ", bold: true }), new TextRun("— Full JSON catalog")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "catalog://policies ", bold: true }), new TextRun("— Return policy, shipping info")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "catalog://artist ", bold: true }), new TextRun("— About Wolf / Archive-35 bio")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Implementation Steps")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Create new Worker project: "), new TextRun({ text: "npm create cloudflare@latest archive-35-mcp", italic: true })]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Install MCP SDK: "), new TextRun({ text: "npm install @modelcontextprotocol/sdk", italic: true })]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Implement server with tools and resources above")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Test locally with MCP Inspector")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Deploy to Cloudflare Workers")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Add DNS record: mcp.archive-35.com → Worker")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Register with Claude Desktop / Claude Code for testing")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Files to Create")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "workers/mcp-server/src/index.ts ", bold: true }), new TextRun("— Main MCP server")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "workers/mcp-server/wrangler.toml ", bold: true }), new TextRun("— Cloudflare config")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "workers/mcp-server/package.json ", bold: true }), new TextRun("— Dependencies")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Relationship to Existing Work")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Complements llms.txt (static description) with dynamic tools")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Complements /api/products.json (HTTP endpoint) with MCP protocol")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Uses same data source (photos.json)")]
      }),

      // Page break before Phase 5
      new Paragraph({ children: [new PageBreak()] }),

      // ============ PHASE 5 ============
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("PHASE 5: C2PA Content Credentials")]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Priority: ", bold: true }),
          new TextRun("MEDIUM — 3-5 days implementation")
        ],
        spacing: { after: 60 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Why: ", bold: true }),
          new TextRun("Proves authenticity of Wolf's photography. Differentiator vs AI-generated art. Growing adoption (Google Pixel, Adobe, Nikon, Leica all support it).")
        ],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("What It Does")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Embeds cryptographically signed provenance metadata into every photo")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Visitors can verify: \"This was taken by Wolf with a real camera, not AI-generated.\"")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Viewable at contentcredentials.org/verify")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Technical Approach")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Use c2patool CLI (Rust binary) or c2pa-node library")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Build a signing script that embeds manifests at build time")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Need: X.509 code-signing certificate + private key")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Certificate stored in Cloudflare environment variable or Workers KV")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Manifest Content per Image")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Author: ", bold: true }), new TextRun("Wolf / Archive-35")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Action: ", bold: true }), new TextRun("c2pa.created (original photograph)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Copyright: ", bold: true }), new TextRun("\"© 2026 Wolf / Archive-35. All rights reserved.\"")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "License: ", bold: true }), new TextRun("\"Personal display only. Not licensed for reproduction, AI training, or commercial use.\"")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Camera info ", bold: true }), new TextRun("(from EXIF where available)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Timestamp", bold: true })],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Implementation Steps")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Obtain code-signing certificate (options: DigiCert, GlobalSign, or self-signed for initial testing)")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Install c2patool: "), new TextRun({ text: "cargo install c2patool", italic: true }), new TextRun(" (or use prebuilt binary)")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Create manifest template JSON with Archive-35 branding")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Write build script to sign all 216 images in images/ directory")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Add \"Content Credentials\" verification badge/link to product pages")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Update lightbox UI to show verification icon")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Test verification at contentcredentials.org/verify")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Files to Create/Modify")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "scripts/sign-images.sh ", bold: true }), new TextRun("— Batch signing script")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "scripts/c2pa-manifest.json ", bold: true }), new TextRun("— Manifest template")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "js/product-selector.js ", bold: true }), new TextRun("— Add verification badge to lightbox")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "index.html / gallery.html ", bold: true }), new TextRun("— Add Content Credentials explainer")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Key Decision: Certificate")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Self-signed: ", bold: true }), new TextRun("Free, works for verification, but shows \"Unknown signer\" warning")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Commercial cert (DigiCert ~$200/yr): ", bold: true }), new TextRun("Shows verified organization name")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Recommendation: ", bold: true }), new TextRun("Start with self-signed to validate workflow, upgrade to commercial cert later")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Cloudflare Integration")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Cloudflare Images CDN preserves C2PA manifests (no stripping)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Signed images can be served directly from current /images/ directory")],
        spacing: { after: 480 }
      }),

      // Page break before Phase 6
      new Paragraph({ children: [new PageBreak()] }),

      // ============ PHASE 6 ============
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("PHASE 6: OpenAI Agentic Commerce Protocol (ACP)")]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Priority: ", bold: true }),
          new TextRun("MEDIUM-HIGH — 2-4 weeks implementation")
        ],
        spacing: { after: 60 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Why: ", bold: true }),
          new TextRun("700M+ weekly ChatGPT users can discover and BUY your prints directly in chat. Free for merchants to be discovered. Small fee per completed purchase.")
        ],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("What It Does")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Makes Archive-35 products discoverable and purchasable directly inside ChatGPT")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Users searching \"fine art landscape photography prints\" could see your work and buy it without leaving the conversation")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Prerequisites")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Active Stripe account (already have: Archive-35 on Stripe)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Enable \"Agentic Checkout\" in Stripe dashboard")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Published privacy policy (already have: privacy.html)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("US-based merchant (assuming yes)")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Integration Component A: Product Feed")]
      }),

      new Paragraph({
        children: [
          new TextRun("Format: JSON feed (we already have /api/products.json — needs reformatting)")
        ],
        spacing: { after: 120 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Required fields per product:", bold: true })
        ],
        spacing: { after: 60 }
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("id, title, description, link, image_link, price, availability")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("enable_search: true, enable_checkout: true")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("shipping_weight, delivery_time, delivery_regions")],
        spacing: { after: 120 }
      }),

      new Paragraph({
        children: [
          new TextRun("Implementation: Create new endpoint /api/acp-feed.json that transforms existing catalog into ACP format.")
        ],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Integration Component B: Agentic Checkout API")]
      }),

      new Paragraph({
        children: [
          new TextRun("Four REST endpoints:")
        ],
        spacing: { after: 120 }
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "POST /api/acp/checkout_sessions ", bold: true }), new TextRun("— Create checkout session (reuse existing Stripe logic)")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "POST /api/acp/checkout_sessions/{id} ", bold: true }), new TextRun("— Update session (quantities, shipping)")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "POST /api/acp/checkout_sessions/{id}/complete ", bold: true }), new TextRun("— Process SharedPaymentToken from ChatGPT")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun({ text: "POST /api/acp/checkout_sessions/{id}/cancel ", bold: true }), new TextRun("— Cancel and release inventory")],
        spacing: { after: 120 }
      }),

      new Paragraph({
        children: [
          new TextRun("These build on existing create-checkout-session.js and stripe-webhook.js.")
        ],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Integration Component C: Payment Integration")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Already using Stripe — enable Agentic Checkout in Stripe dashboard")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Stripe handles SharedPaymentToken (SPT) processing")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("\"As little as one line of code\" for existing Stripe customers")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Implementation Steps")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Enable Agentic Checkout in Stripe dashboard")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Create /api/acp-feed.json endpoint (transform existing products.json)")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Create /.well-known/acp manifest file")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Build 4 checkout API endpoints in functions/api/acp/")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Implement webhook event publishing for order lifecycle")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Test end-to-end in sandbox environment")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Submit merchant application at chatgpt.com/merchants/")]
      }),

      new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: [new TextRun("Document all endpoints with request/response examples")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Files to Create")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "functions/api/acp-feed.json.js ", bold: true }), new TextRun("— Product feed endpoint")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "functions/api/acp/checkout_sessions.js ", bold: true }), new TextRun("— Create/update sessions")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "functions/api/acp/complete.js ", bold: true }), new TextRun("— Complete checkout with SPT")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "functions/api/acp/cancel.js ", bold: true }), new TextRun("— Cancel session")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "functions/api/acp/webhooks.js ", bold: true }), new TextRun("— Order lifecycle events")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: ".well-known/acp ", bold: true }), new TextRun("— ACP manifest file")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Timeline & Dependencies")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Week 1: ", bold: true }), new TextRun("Product feed + Stripe Agentic Checkout setup")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Week 2: ", bold: true }), new TextRun("Build checkout API endpoints")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Week 3: ", bold: true }), new TextRun("Testing in sandbox + webhook implementation")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Week 4: ", bold: true }), new TextRun("Submit merchant application + go live")],
        spacing: { after: 240 }
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Current Status (Feb 2026)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Live with Etsy merchants")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Shopify merchants rolling out")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("PayPal integration coming 2026")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Custom integrations (like ours) accepted via application")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Single-item purchases supported; multi-item carts coming 2026")],
        spacing: { after: 480 }
      }),

      // Page break before Priority table
      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Priority Sequence")]
      }),

      // Priority Table
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [1400, 2400, 1600, 1600, 2360],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 1400, type: WidthType.DXA },
                shading: { fill: "2d5aa8", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Phase", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 2400, type: WidthType.DXA },
                shading: { fill: "2d5aa8", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Name", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "2d5aa8", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Effort", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "2d5aa8", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Impact", bold: true, color: "FFFFFF" })] })]
              }),
              new TableCell({
                borders,
                width: { size: 2360, type: WidthType.DXA },
                shading: { fill: "2d5aa8", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Do First?", bold: true, color: "FFFFFF" })] })]
              })
            ]
          }),
          // Row 1
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 1400, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("4")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2400, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("MCP Server")] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("1-2 days")] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("AI catalog")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2360, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("YES — quick win")] })]
              })
            ]
          }),
          // Row 2
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 1400, type: WidthType.DXA },
                shading: { fill: "FFFFFF", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("5")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2400, type: WidthType.DXA },
                shading: { fill: "FFFFFF", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("C2PA Content")] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "FFFFFF", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("3-5 days")] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "FFFFFF", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Authenticity")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2360, type: WidthType.DXA },
                shading: { fill: "FFFFFF", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Second")] })]
              })
            ]
          }),
          // Row 3
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 1400, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("6")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2400, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("OpenAI ACP")] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("2-4 weeks")] })]
              }),
              new TableCell({
                borders,
                width: { size: 1600, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("ChatGPT sales")] })]
              }),
              new TableCell({
                borders,
                width: { size: 2360, type: WidthType.DXA },
                shading: { fill: "E8F4FA", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Third (biggest)")] })]
              })
            ]
          })
        ]
      }),

      new Paragraph({ spacing: { after: 480 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Dependencies on Existing Work")]
      }),

      new Paragraph({
        children: [
          new TextRun("The three phases build on infrastructure already completed:")
        ],
        spacing: { after: 120 }
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "/api/products.json endpoint (Phase 2) ", bold: true }), new TextRun("→ feeds MCP + ACP")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "llms.txt (Phase 2) ", bold: true }), new TextRun("→ complements MCP")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "robots.txt with AI crawler blocks (Phase 2) ", bold: true }), new TextRun("→ protects while MCP exposes catalog intentionally")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "XMP copyright metadata in all 216 images (Phase 3) ", bold: true }), new TextRun("→ foundation for C2PA signing")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Stripe integration (existing) ", bold: true }), new TextRun("→ enables ACP checkout")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: "Terms of Sale with \"all sales final\" (Phase 1) ", bold: true }), new TextRun("→ required for commerce")],
        spacing: { after: 480 }
      })
    ]
  }]
});

// Pack and write the document
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/sessions/hopeful-busy-mccarthy/mnt/Archive-35.com/08_Docs/IMPLEMENTATION_PLAN_Phase4-5-6.docx", buffer);
  console.log("Document created successfully!");
});
