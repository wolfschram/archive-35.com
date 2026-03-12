/**
 * LinkedIn MCP Client
 * Wraps the linkedin-scraper-mcp server to provide job search + full descriptions.
 * Communicates via stdio JSON-RPC (MCP protocol).
 *
 * Prerequisites (run on host machine, not VM):
 *   1. pip install uv  (or brew install uv)
 *   2. uvx patchright install chromium
 *   3. uvx linkedin-scraper-mcp --login  (one-time LinkedIn login)
 *
 * Usage:
 *   const linkedin = require('./linkedin-mcp-client');
 *   const jobs = await linkedin.searchJobs('VP Engineering', 'Los Angeles');
 *   const details = await linkedin.getJobDetails(jobUrl);
 */

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class LinkedInMCPClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.process = null;
    this.requestId = 0;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.buffer = '';
    this.timeout = options.timeout || 60000;
    this.command = options.command || 'uvx';
    this.args = options.args || ['linkedin-scraper-mcp'];
    this.ready = false;
    this.startPromise = null;
  }

  /** Start the MCP server process */
  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._doStart();
    return this.startPromise;
  }

  async _doStart() {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin' },
        });

        this.process.stdout.on('data', (data) => this._onData(data));
        this.process.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.log(`[LinkedIn MCP] ${msg}`);
        });

        this.process.on('error', (err) => {
          console.error('[LinkedIn MCP] Process error:', err.message);
          this.ready = false;
          reject(err);
        });

        this.process.on('close', (code) => {
          console.log(`[LinkedIn MCP] Process exited with code ${code}`);
          this.ready = false;
          this.startPromise = null;
          // Reject all pending requests
          for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error('MCP process exited'));
          }
          this.pending.clear();
        });

        // Initialize MCP connection
        this._send({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'job-pipeline', version: '2.0.0' },
          },
        });

        // Wait for initialize response
        const initId = this.requestId;
        const timer = setTimeout(() => reject(new Error('MCP init timeout')), 15000);
        this.pending.set(initId, {
          resolve: (result) => {
            clearTimeout(timer);
            // Send initialized notification
            this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            this.ready = true;
            console.log('[LinkedIn MCP] Connected and ready');
            resolve(result);
          },
          reject: (err) => { clearTimeout(timer); reject(err); },
          timer,
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /** Send JSON-RPC message to the MCP server */
  _send(msg) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error('MCP process not running');
    }
    const json = JSON.stringify(msg);
    this.process.stdin.write(json + '\n');
  }

  /** Handle incoming data from stdout */
  _onData(data) {
    this.buffer += data.toString();
    // Process complete JSON messages (newline-delimited)
    let newlineIdx;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIdx).trim();
      this.buffer = this.buffer.substring(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        // Not valid JSON, might be partial — try to parse as JSON-RPC content-length framed
        // Some MCP servers use HTTP-like framing
      }
    }
  }

  /** Call an MCP tool */
  async callTool(toolName, args = {}) {
    if (!this.ready) await this.start();

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tool ${toolName} timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });

      this._send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      });
    });
  }

  /** Search LinkedIn jobs */
  async searchJobs(keywords, location = '', limit = 25) {
    try {
      // Use discovered schema to pass correct parameter names
      const args = {};
      const schema = this.toolSchemas?.search_jobs?.properties || {};
      // Map our params to whatever the tool expects
      if (schema.keywords) args.keywords = keywords;
      else if (schema.search_term) args.search_term = keywords;
      else if (schema.query) args.query = keywords;
      else args.keywords = keywords; // fallback

      if (schema.location) args.location = location;
      else if (schema.geo_id) args.geo_id = location;

      if (schema.limit) args.limit = limit;
      else if (schema.count) args.count = limit;

      console.log(`[LinkedIn MCP] Calling search_jobs with args: ${JSON.stringify(args)}`);
      const result = await this.callTool('search_jobs', args);

      // Log raw result for debugging
      if (result?.content) {
        for (const block of result.content) {
          if (block.type === 'text') {
            console.log(`[LinkedIn MCP] Raw search_jobs response (${block.text.length} chars): ${block.text.substring(0, 500)}`);
          }
        }
      } else {
        console.log(`[LinkedIn MCP] Raw result: ${JSON.stringify(result).substring(0, 500)}`);
      }

      return this._parseToolResult(result);
    } catch (e) {
      console.error(`[LinkedIn MCP] searchJobs error: ${e.message}`);
      return [];
    }
  }

  /** Get full job details (description, requirements, etc.) */
  async getJobDetails(jobUrl) {
    try {
      const result = await this.callTool('get_job_details', {
        job_url: jobUrl,
      });
      return this._parseToolResult(result);
    } catch (e) {
      console.error(`[LinkedIn MCP] getJobDetails error: ${e.message}`);
      return null;
    }
  }

  /** Get company profile with open jobs */
  async getCompanyProfile(companyUrl, sections = ['jobs']) {
    try {
      const result = await this.callTool('get_company_profile', {
        url: companyUrl,
        sections,
      });
      return this._parseToolResult(result);
    } catch (e) {
      console.error(`[LinkedIn MCP] getCompanyProfile error: ${e.message}`);
      return null;
    }
  }

  /** Parse MCP tool result (content array → parsed data) */
  _parseToolResult(result) {
    if (!result || !result.content) return null;
    for (const block of result.content) {
      if (block.type === 'text' && block.text) {
        try {
          return JSON.parse(block.text);
        } catch {
          return block.text; // Return as string if not JSON
        }
      }
    }
    return null;
  }

  /** List all available tools (for debugging parameter names) */
  async listTools() {
    if (!this.ready) await this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('tools/list timed out'));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
    });
  }

  /** Check if MCP server is available */
  async isAvailable() {
    try {
      if (!this.ready) await this.start();
      // List tools to discover actual parameter names
      try {
        const toolsResult = await this.listTools();
        const tools = toolsResult?.tools || [];
        console.log(`[LinkedIn MCP] Available tools (${tools.length}):`);
        for (const t of tools) {
          const params = t.inputSchema?.properties ? Object.keys(t.inputSchema.properties).join(', ') : 'none';
          const required = t.inputSchema?.required ? t.inputSchema.required.join(', ') : 'none';
          console.log(`  - ${t.name}: params=[${params}] required=[${required}]`);
          if (t.inputSchema?.properties) {
            for (const [pName, pSchema] of Object.entries(t.inputSchema.properties)) {
              console.log(`      ${pName}: ${pSchema.type || '?'} — ${pSchema.description || ''}`);
            }
          }
        }
        // Store tool schemas for later reference
        this.toolSchemas = {};
        for (const t of tools) this.toolSchemas[t.name] = t.inputSchema || {};
      } catch (e) {
        console.log(`[LinkedIn MCP] Could not list tools: ${e.message}`);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Gracefully close */
  async close() {
    if (this.process) {
      try {
        await this.callTool('close_session', {});
      } catch { /* ok */ }
      this.process.kill();
      this.process = null;
      this.ready = false;
      this.startPromise = null;
    }
  }
}

// Singleton instance
let instance = null;

module.exports = {
  /** Get or create the LinkedIn MCP client singleton */
  getClient(options) {
    if (!instance) {
      instance = new LinkedInMCPClient(options);
    }
    return instance;
  },

  /** Search LinkedIn jobs with full descriptions */
  async searchJobsWithDetails(keywords, location = '', limit = 10) {
    const client = module.exports.getClient();

    // Step 1: Search for jobs
    console.log(`[LinkedIn MCP] Searching: "${keywords}" in "${location}"...`);
    const searchResult = await client.searchJobs(keywords, location, limit);
    if (!searchResult) {
      console.log(`[LinkedIn MCP] Search returned null/empty for "${keywords}"`);
      return [];
    }

    // Step 2: Extract jobs — handle various response formats
    let jobs = [];
    if (Array.isArray(searchResult)) {
      jobs = searchResult;
    } else if (typeof searchResult === 'object') {
      jobs = searchResult.jobs || searchResult.results || searchResult.data || [];
      if (!Array.isArray(jobs)) jobs = [];
    } else if (typeof searchResult === 'string') {
      // MCP might return plain text — try parsing
      console.log(`[LinkedIn MCP] Got string response (${searchResult.length} chars), first 200: ${searchResult.substring(0, 200)}`);
      try { jobs = JSON.parse(searchResult); if (!Array.isArray(jobs)) jobs = []; } catch { jobs = []; }
    }
    console.log(`[LinkedIn MCP] Found ${jobs.length} search results for "${keywords}"`);
    if (jobs.length === 0) return [];

    // Step 3: Fetch details in parallel batches of 3 (limit to 5 jobs to avoid rate limits)
    const toFetch = jobs.slice(0, Math.min(5, limit));
    const detailedJobs = [];
    const batchSize = 3;

    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (job) => {
          const jobUrl = job.url || job.job_url || job.link;
          if (!jobUrl) return { ...job, source: 'linkedin_mcp' };
          try {
            const details = await client.getJobDetails(jobUrl);
            return {
              ...job,
              ...(typeof details === 'object' ? details : {}),
              description: details?.description || details?.job_description || job.description || '',
              url: jobUrl,
              source: 'linkedin_mcp',
            };
          } catch (e) {
            console.log(`[LinkedIn MCP] Detail fetch failed for ${jobUrl}: ${e.message}`);
            return { ...job, url: jobUrl, source: 'linkedin_mcp' };
          }
        })
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') detailedJobs.push(r.value);
      }
    }

    // Also include remaining jobs (without details) up to limit
    for (const job of jobs.slice(5, limit)) {
      detailedJobs.push({
        ...job,
        url: job.url || job.job_url || job.link || '',
        source: 'linkedin_mcp',
      });
    }

    console.log(`[LinkedIn MCP] Returning ${detailedJobs.length} jobs (${detailedJobs.filter(j => j.description).length} with descriptions)`);
    return detailedJobs;
  },

  /** Check if the LinkedIn MCP server is set up and running */
  async checkAvailability() {
    try {
      const client = module.exports.getClient();
      return await client.isAvailable();
    } catch {
      return false;
    }
  },
};
