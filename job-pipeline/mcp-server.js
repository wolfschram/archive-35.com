#!/usr/bin/env node
/**
 * Job Pipeline MCP Server
 *
 * Model Context Protocol server that gives Claude Desktop direct access
 * to the job pipeline database. Supports querying jobs, adding jobs,
 * updating statuses, running the scorer, and analyzing template metrics.
 *
 * Install:
 *   claude mcp add job-pipeline -- node ~/Archive-35/Job-Pipeline/mcp-server.js
 *
 * This implements the MCP stdio transport protocol.
 * Claude Desktop communicates via JSON-RPC over stdin/stdout.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const DB_PATH = path.join(__dirname, 'pipeline.db');

let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (err) {
  // DB will be created when init-db runs — tools will return helpful errors
  db = null;
}

// ─── MCP Protocol Implementation ────────────────────────────────────

const SERVER_INFO = {
  name: 'job-pipeline',
  version: '1.0.0'
};

const TOOLS = [
  {
    name: 'pipeline_stats',
    description: "Get Wolf's job pipeline statistics — total jobs, counts by status (NEW, SCRAPED, SCORED, APPLIED, INTERVIEW, REJECTED, OFFER), and interview conversion rate.",
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'list_jobs',
    description: "List all jobs in Wolf's pipeline. Filter by status (NEW, SCRAPED, SCORED, APPLIED, INTERVIEW, REJECTED, OFFER) and sort by score, date_added, date_updated, or company.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: NEW, SCRAPED, SCORED, APPLIED, INTERVIEW, REJECTED, OFFER', enum: ['NEW', 'SCRAPED', 'SCORED', 'APPLIED', 'INTERVIEW', 'REJECTED', 'OFFER'] },
        sort: { type: 'string', description: 'Sort by field', enum: ['score', 'date_added', 'date_updated', 'company'], default: 'date_updated' },
        limit: { type: 'number', description: 'Max results to return', default: 20 }
      },
      required: []
    }
  },
  {
    name: 'get_job',
    description: "Get full details for a specific job in Wolf's pipeline by ID.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Job ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'add_job',
    description: "Add a new job to Wolf's pipeline. Provide company name, job title, and optionally a description, source, URL, and notes.",
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company name' },
        title: { type: 'string', description: 'Job title' },
        description: { type: 'string', description: 'Full job description' },
        source: { type: 'string', description: 'Where the job was found (LinkedIn, Recruiter, Network, Direct)' },
        url: { type: 'string', description: 'Job posting URL' },
        notes: { type: 'string', description: 'Notes about this opportunity' }
      },
      required: ['company', 'title']
    }
  },
  {
    name: 'update_job',
    description: "Update a job in Wolf's pipeline. Can change status, score, notes, cover_letter, template_version, or any other field.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Job ID to update' },
        status: { type: 'string', description: 'New status', enum: ['NEW', 'SCRAPED', 'SCORED', 'APPLIED', 'INTERVIEW', 'REJECTED', 'OFFER'] },
        score: { type: 'number', description: 'Job fit score (0-100)' },
        notes: { type: 'string', description: 'Updated notes' },
        cover_letter: { type: 'string', description: 'Generated cover letter text' },
        template_version: { type: 'string', description: 'Template version used (e.g., v1, v2)' }
      },
      required: ['id']
    }
  },
  {
    name: 'log_outcome',
    description: "Log a rejection or interview request for a job. Updates the job status and tracks the outcome for the Feedback Analyzer. Use this when Wolf gets a response (positive or negative) from a company.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Job ID' },
        outcome: { type: 'string', description: 'What happened', enum: ['INTERVIEW', 'REJECTED'] },
        notes: { type: 'string', description: 'Additional context about the outcome' }
      },
      required: ['id', 'outcome']
    }
  },
  {
    name: 'template_metrics',
    description: "Get the Feedback Analyzer report — shows conversion rates (applied → interview) grouped by cover letter template_version. Use this to determine which Problem→Product→Result opening hook yields the highest interview rate.",
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'generate_cover_letter_prompt',
    description: "Generate a complete Problem→Product→Result cover letter prompt for a specific job. Returns a formatted prompt ready to use for cover letter generation. The prompt includes Wolf's 30-second story, leadership stories, differentiators, and the specific job details.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Job ID to generate prompt for' }
      },
      required: ['id']
    }
  },
  {
    name: 'search_qa_bank',
    description: "Search Wolf's interview Q&A bank. Find prepared answers for behavioral, leadership, technical, cultural, and situational interview questions.",
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category', enum: ['behavioral', 'technical', 'cultural', 'leadership', 'situational'] },
        search: { type: 'string', description: 'Search term to find in questions or answers' }
      },
      required: []
    }
  }
];

// ─── Tool Handlers ──────────────────────────────────────────────────

function ensureDb() {
  if (!db) throw new Error('pipeline.db not found. Run: cd ~/Archive-35/Job-Pipeline && npm run init-db');
}

function handleTool(name, args) {
  ensureDb();

  switch (name) {
    case 'pipeline_stats': {
      const total = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
      const byStatus = db.prepare(`
        SELECT status, COUNT(*) as count FROM jobs GROUP BY status
        ORDER BY CASE status
          WHEN 'NEW' THEN 1 WHEN 'SCRAPED' THEN 2 WHEN 'SCORED' THEN 3
          WHEN 'APPLIED' THEN 4 WHEN 'INTERVIEW' THEN 5
          WHEN 'OFFER' THEN 6 WHEN 'REJECTED' THEN 7
        END
      `).all();

      const applied = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status IN ('APPLIED','INTERVIEW','OFFER','REJECTED')").get();
      const interviews = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status IN ('INTERVIEW','OFFER')").get();

      const rate = applied.count > 0 ? Math.round((interviews.count / applied.count) * 100) : 0;

      let text = `Pipeline Stats:\n`;
      text += `Total jobs: ${total.count}\n\n`;
      text += `By Status:\n`;
      byStatus.forEach(s => { text += `  ${s.status}: ${s.count}\n`; });
      text += `\nConversion Rate (Applied → Interview): ${rate}%`;
      text += `\n(${interviews.count} interviews from ${applied.count} applications)`;
      return text;
    }

    case 'list_jobs': {
      let query = 'SELECT id, company, title, status, score, source, date_updated, notes FROM jobs';
      const params = [];
      if (args.status) {
        query += ' WHERE status = ?';
        params.push(args.status);
      }
      const validSorts = ['score', 'date_added', 'date_updated', 'company'];
      const sort = validSorts.includes(args.sort) ? args.sort : 'date_updated';
      query += ` ORDER BY ${sort} DESC LIMIT ?`;
      params.push(args.limit || 20);

      const jobs = db.prepare(query).all(...params);

      if (jobs.length === 0) return 'No jobs found matching that filter.';

      let text = `${jobs.length} jobs:\n\n`;
      jobs.forEach(j => {
        text += `[${j.id}] ${j.company} — ${j.title}\n`;
        text += `    Status: ${j.status}${j.score ? ` | Score: ${j.score}` : ''} | Source: ${j.source || '—'}\n`;
        if (j.notes) text += `    Notes: ${j.notes}\n`;
        text += '\n';
      });
      return text;
    }

    case 'get_job': {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(args.id);
      if (!job) return `Job ID ${args.id} not found.`;

      let text = `${job.company} — ${job.title}\n`;
      text += `${'─'.repeat(50)}\n`;
      text += `Status: ${job.status}\n`;
      text += `Score: ${job.score || '—'}\n`;
      text += `Source: ${job.source || '—'}\n`;
      text += `URL: ${job.url || '—'}\n`;
      text += `Template: ${job.template_version || 'v1'}\n`;
      text += `Added: ${job.date_added}\n`;
      text += `Updated: ${job.date_updated}\n\n`;
      text += `Description:\n${job.description || 'No description'}\n\n`;
      text += `Notes:\n${job.notes || 'No notes'}\n`;
      if (job.cover_letter) text += `\nCover Letter:\n${job.cover_letter}\n`;
      return text;
    }

    case 'add_job': {
      const result = db.prepare(`
        INSERT INTO jobs (company, title, description, source, url, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(args.company, args.title, args.description || null, args.source || null, args.url || null, args.notes || null);

      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
      return `Added job [${job.id}]: ${job.company} — ${job.title} (status: NEW)\n\nNext: Run the scorer or manually set a score and status.`;
    }

    case 'update_job': {
      const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(args.id);
      if (!existing) return `Job ID ${args.id} not found.`;

      const fields = ['status', 'score', 'notes', 'cover_letter', 'template_version'];
      const updates = [];
      const values = [];

      for (const field of fields) {
        if (args[field] !== undefined) {
          updates.push(`${field} = ?`);
          values.push(args[field]);
        }
      }

      if (updates.length === 0) return 'No fields to update. Provide status, score, notes, cover_letter, or template_version.';

      updates.push("date_updated = datetime('now')");
      values.push(args.id);

      db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(args.id);

      let text = `Updated job [${updated.id}]: ${updated.company} — ${updated.title}\n`;
      if (args.status) text += `  Status: ${existing.status} → ${updated.status}\n`;
      if (args.score !== undefined) text += `  Score: ${updated.score}\n`;
      if (args.notes) text += `  Notes updated\n`;
      if (args.cover_letter) text += `  Cover letter saved\n`;
      if (args.template_version) text += `  Template: ${updated.template_version}\n`;
      return text;
    }

    case 'log_outcome': {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(args.id);
      if (!job) return `Job ID ${args.id} not found.`;

      const prevStatus = job.status;
      db.prepare(`
        UPDATE jobs SET status = ?, notes = COALESCE(notes, '') || ?, date_updated = datetime('now')
        WHERE id = ?
      `).run(args.outcome, args.notes ? `\n[${new Date().toISOString().split('T')[0]}] ${args.outcome}: ${args.notes}` : '', args.id);

      // Get updated template metrics
      const metrics = db.prepare(`
        SELECT template_version,
          COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')) as applied,
          COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) as interviews,
          ROUND(
            CAST(COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) AS REAL) /
            NULLIF(COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')), 0) * 100, 1
          ) as rate
        FROM jobs
        WHERE template_version = ?
        GROUP BY template_version
      `).get(job.template_version || 'v1');

      let text = `Logged: ${job.company} — ${prevStatus} → ${args.outcome}\n`;
      if (args.notes) text += `Notes: ${args.notes}\n`;
      text += `\nTemplate "${job.template_version || 'v1'}" metrics:\n`;
      if (metrics) {
        text += `  Applied: ${metrics.applied} | Interviews: ${metrics.interviews} | Rate: ${metrics.rate || 0}%\n`;
      }
      return text;
    }

    case 'template_metrics': {
      const metrics = db.prepare(`
        SELECT
          template_version,
          COUNT(*) as total_jobs,
          COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')) as total_applied,
          COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) as interviews,
          COUNT(*) FILTER (WHERE status = 'OFFER') as offers,
          COUNT(*) FILTER (WHERE status = 'REJECTED') as rejections,
          ROUND(
            CAST(COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) AS REAL) /
            NULLIF(COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')), 0) * 100, 1
          ) as conversion_rate
        FROM jobs
        GROUP BY template_version
        ORDER BY conversion_rate DESC
      `).all();

      if (metrics.length === 0) return 'No job data yet. Add jobs and track outcomes to see template metrics.';

      let text = 'Feedback Analyzer — Template Version Metrics\n';
      text += '═'.repeat(50) + '\n\n';
      metrics.forEach(m => {
        text += `Template: ${m.template_version}\n`;
        text += `  Total jobs: ${m.total_jobs}\n`;
        text += `  Applied: ${m.total_applied} | Interviews: ${m.interviews} | Offers: ${m.offers} | Rejected: ${m.rejections}\n`;
        text += `  Conversion rate: ${m.conversion_rate || 0}%\n\n`;
      });

      const best = metrics.find(m => m.conversion_rate > 0);
      if (best) {
        text += `★ Best performing: ${best.template_version} (${best.conversion_rate}% interview conversion)\n`;
      } else {
        text += '★ No conversions tracked yet. Keep applying and logging outcomes!\n';
      }
      return text;
    }

    case 'generate_cover_letter_prompt': {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(args.id);
      if (!job) return `Job ID ${args.id} not found.`;

      const templatePath = path.join(__dirname, 'prompts', 'cover-letter-template.md');
      let template;
      try {
        template = fs.readFileSync(templatePath, 'utf8');
      } catch (err) {
        return 'Cover letter template not found at prompts/cover-letter-template.md';
      }

      template = template.replace('{{COMPANY}}', job.company);
      template = template.replace('{{TITLE}}', job.title);
      template = template.replace('{{DESCRIPTION}}', job.description || 'No description available');

      return template;
    }

    case 'search_qa_bank': {
      let query = 'SELECT * FROM qa_bank';
      const params = [];
      const conditions = [];

      if (args.category) {
        conditions.push('category = ?');
        params.push(args.category);
      }
      if (args.search) {
        conditions.push('(question LIKE ? OR answer LIKE ?)');
        params.push(`%${args.search}%`, `%${args.search}%`);
      }

      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

      const results = db.prepare(query).all(...params);

      if (results.length === 0) return 'No Q&A entries found matching that criteria.';

      let text = `${results.length} Q&A entries:\n\n`;
      results.forEach(qa => {
        text += `[${qa.category}] Q: ${qa.question}\n`;
        text += `A: ${qa.answer}\n\n`;
      });
      return text;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC over stdio ────────────────────────────────────────────

function sendResponse(id, result) {
  const response = { jsonrpc: '2.0', id, result };
  const msg = JSON.stringify(response);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function sendError(id, code, message) {
  const response = { jsonrpc: '2.0', id, error: { code, message } };
  const msg = JSON.stringify(response);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function handleMessage(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
      break;

    case 'notifications/initialized':
      // Client acknowledged initialization — no response needed
      break;

    case 'tools/list':
      sendResponse(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const toolName = params.name;
      const toolArgs = params.arguments || {};
      try {
        const result = handleTool(toolName, toolArgs);
        sendResponse(id, {
          content: [{ type: 'text', text: result }]
        });
      } catch (err) {
        sendResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true
        });
      }
      break;
    }

    case 'ping':
      sendResponse(id, {});
      break;

    default:
      if (id) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
  }
}

// ─── Message Parser (Content-Length framing) ────────────────────────

let buffer = '';
let contentLength = -1;

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  while (true) {
    if (contentLength === -1) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.substring(headerEnd + 4);
        continue;
      }

      contentLength = parseInt(match[1]);
      buffer = buffer.substring(headerEnd + 4);
    }

    if (buffer.length < contentLength) break;

    const body = buffer.substring(0, contentLength);
    buffer = buffer.substring(contentLength);
    contentLength = -1;

    try {
      const message = JSON.parse(body);
      handleMessage(message);
    } catch (err) {
      // Silently skip malformed messages
    }
  }
});

process.stdin.on('end', () => {
  if (db) db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  if (db) db.close();
  process.exit(0);
});
