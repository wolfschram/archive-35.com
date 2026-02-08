import React from 'react';
import '../styles/Pages.css';

function SalesOverview() {
  return (
    <div className="page">
      <header className="page-header">
        <h2>Sales / Channels</h2>
        <p className="page-subtitle">Manage sales channels and fulfillment partners</p>
      </header>

      <div className="card-grid">
        <div className="glass-card">
          <h3>Stripe Checkout</h3>
          <div className="status-row">
            <span>Status</span>
            <span className="status-badge online">Live</span>
          </div>
          <div className="status-row">
            <span>Mode</span>
            <span className="status-badge online">Production</span>
          </div>
          <p className="card-note">
            Direct checkout via archive-35.com.
            Orders processed through Stripe.
          </p>
        </div>

        <div className="glass-card">
          <h3>Pictorem Fulfillment</h3>
          <div className="status-row">
            <span>API Status</span>
            <span className="status-badge online">Connected</span>
          </div>
          <div className="status-row">
            <span>R2 Originals</span>
            <span className="status-badge online">Synced</span>
          </div>
          <p className="card-note">
            Print fulfillment partner. High-res originals
            stored in R2 for on-demand printing.
          </p>
        </div>

        <div className="glass-card">
          <h3>ChatGPT Shopping</h3>
          <div className="status-row">
            <span>ACP Feed</span>
            <span className="status-badge online">Live</span>
          </div>
          <div className="status-row">
            <span>Merchant Status</span>
            <span className="status-badge pending">Pending Approval</span>
          </div>
          <p className="card-note">
            OpenAI Agentic Commerce Protocol. Product feed
            at /api/commerce/feed.json. Apply at chatgpt.com/merchants/
          </p>
        </div>

        <div className="glass-card">
          <h3>AI Agent Access</h3>
          <div className="status-row">
            <span>MCP Server</span>
            <span className="status-badge online">Live</span>
          </div>
          <div className="status-row">
            <span>Tools</span>
            <span className="status-badge online">4 Active</span>
          </div>
          <p className="card-note">
            MCP endpoint at /mcp enables Claude, ChatGPT,
            and other AI agents to browse the catalog.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SalesOverview;
