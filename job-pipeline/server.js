#!/usr/bin/env node
/**
 * Job Pipeline Server v2
 * Pure Node.js HTTP server + SQLite backend for the Job Pipeline Command Center.
 * Zero external dependencies — uses only Node.js built-in modules.
 * Run: npm start → http://localhost:3000
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'pipeline.db');

// ─── Database Setup ──────────────────────────────────────────────────
if (!fs.existsSync(DB_PATH)) {
  console.error('\n  ✗ pipeline.db not found. Run: npm run init-db && npm run migrate\n');
  process.exit(1);
}

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
}

// ─── Routing ─────────────────────────────────────────────────────────
const routes = [];

function addRoute(method, pattern, handler) {
  // Convert /api/jobs/:id to regex
  const paramNames = [];
  const regexStr = pattern.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({ method, regex: new RegExp(`^${regexStr}$`), paramNames, handler });
}

function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method && route.method !== 'ALL') continue;
    const match = pathname.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
      return { handler: route.handler, params };
    }
  }
  return null;
}

// ─── Response Helpers ────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    json(res, { error: 'Not found' }, 404);
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  };
  res.writeHead(200, {
    'Content-Type': types[ext] || 'text/plain',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 102400) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ─── GET /api/stats ─────────────────────────────────────────────────
addRoute('GET', '/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs GROUP BY status ORDER BY
    CASE status
      WHEN 'NEW' THEN 1 WHEN 'SCRAPED' THEN 2 WHEN 'SCORED' THEN 3
      WHEN 'COVER_LETTER_QUEUED' THEN 4 WHEN 'COVER_LETTER_READY' THEN 5
      WHEN 'PENDING_APPROVAL' THEN 6 WHEN 'APPROVED' THEN 7
      WHEN 'SUBMITTING' THEN 8 WHEN 'SUBMITTED' THEN 9 WHEN 'CLOSED' THEN 10
      ELSE 99
    END
  `).all();

  const submitted = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status IN ('SUBMITTED','CLOSED')").get();
  const interviews = db.prepare("SELECT COUNT(*) as count FROM application_submissions WHERE response_type = 'interview'").get();
  const offers = db.prepare("SELECT COUNT(*) as count FROM application_submissions WHERE response_type = 'offer'").get();
  const pending = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'PENDING_APPROVAL'").get();

  json(res, {
    total: total.count, byStatus,
    submitted: submitted.count, interviews: interviews.count,
    offers: offers.count, pending: pending.count,
    conversionRate: submitted.count > 0 ? Math.round((interviews.count / submitted.count) * 100) : 0
  });
});

// ─── GET /api/jobs ──────────────────────────────────────────────────
addRoute('GET', '/api/jobs', (req, res, query) => {
  let sql = 'SELECT * FROM job_current_state';
  const params = [];

  if (query.status) { sql += ' WHERE status = ?'; params.push(query.status.toUpperCase()); }

  const validSorts = ['date_added', 'date_updated', 'score', 'company', 'status'];
  const safeSort = validSorts.includes(query.sort) ? query.sort : 'date_updated';
  sql += ` ORDER BY ${safeSort} DESC`;

  if (query.limit) sql += ` LIMIT ${parseInt(query.limit, 10) || 50}`;

  json(res, db.prepare(sql).all(...params));
});

// ─── GET /api/jobs/:id ──────────────────────────────────────────────
addRoute('GET', '/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM job_current_state WHERE id = ?').get(req.params.id);
  if (!job) return json(res, { error: 'Job not found' }, 404);
  json(res, job);
});

// ─── POST /api/jobs ─────────────────────────────────────────────────
addRoute('POST', '/api/jobs', async (req, res) => {
  const { company, title, description, status, score, source, url, notes, template_version, location } = req.body;
  if (!company || !title) return json(res, { error: 'company and title are required' }, 400);

  const fingerprint = [company, title, location || '']
    .map(s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ')).join('|');

  const dupe = db.prepare(
    "SELECT id FROM jobs WHERE job_fingerprint = ? AND julianday('now') - julianday(date_added) < 90"
  ).get(fingerprint);
  if (dupe) return json(res, { error: 'Duplicate job within 90 days', existing_id: dupe.id }, 409);

  const result = db.prepare(`
    INSERT INTO jobs (company, title, description, status, score, source, url, notes, template_version, job_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(company, title, description || null, status || 'NEW', score || null,
         source || null, url || null, notes || null, template_version || 'v1', fingerprint);

  json(res, db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid), 201);
});

// ─── PUT /api/jobs/:id ──────────────────────────────────────────────
addRoute('PUT', '/api/jobs/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!existing) return json(res, { error: 'Job not found' }, 404);

  const fields = ['company', 'title', 'description', 'status', 'score', 'score_reasoning',
                   'source', 'url', 'cover_letter', 'notes', 'template_version', 'approved_at'];
  const updates = [], values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return json(res, { error: 'No fields to update' }, 400);

  updates.push("date_updated = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  json(res, db.prepare('SELECT * FROM job_current_state WHERE id = ?').get(req.params.id));
});

// ─── GET /api/agents ────────────────────────────────────────────────
addRoute('GET', '/api/agents', (req, res) => {
  json(res, db.prepare('SELECT * FROM agents ORDER BY name').all());
});

// ─── GET /api/errors ────────────────────────────────────────────────
addRoute('GET', '/api/errors', (req, res) => {
  json(res, db.prepare(`
    SELECT e.*, j.company, j.title, a.name as agent_name
    FROM errors e LEFT JOIN jobs j ON e.job_id = j.id
    LEFT JOIN agents a ON e.agent_id = a.id
    ORDER BY e.timestamp DESC LIMIT 50
  `).all());
});

// ─── GET /api/template-metrics ──────────────────────────────────────
addRoute('GET', '/api/template-metrics', (req, res) => {
  json(res, db.prepare('SELECT * FROM template_metrics').all());
});

// ─── GET /api/prompt/:id ────────────────────────────────────────────
addRoute('GET', '/api/prompt/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return json(res, { error: 'Job not found' }, 404);
  const tpl = path.join(__dirname, 'prompts', 'cover-letter-template.md');
  if (!fs.existsSync(tpl)) return json(res, { error: 'Template not found' }, 404);
  let template = fs.readFileSync(tpl, 'utf8');
  template = template.replace('{{COMPANY}}', job.company).replace('{{TITLE}}', job.title)
    .replace('{{DESCRIPTION}}', job.description || 'No description available');
  json(res, { prompt: template, job });
});

addRoute('GET', '/api/cover-letter-template', (req, res) => {
  const tpl = path.join(__dirname, 'prompts', 'cover-letter-template.md');
  if (!fs.existsSync(tpl)) return json(res, { error: 'Template not found' }, 404);
  json(res, { template: fs.readFileSync(tpl, 'utf8') });
});

// ═══════════════════════════════════════════════════════════════════════
// V2 ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// ─── Personal Info ──────────────────────────────────────────────────
addRoute('GET', '/api/personal-info', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM personal_info').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  json(res, obj);
});

addRoute('GET', '/api/personal-info/:key', (req, res) => {
  const row = db.prepare('SELECT value FROM personal_info WHERE key = ?').get(req.params.key);
  if (!row) return json(res, { error: `Key '${req.params.key}' not found` }, 404);
  json(res, { key: req.params.key, value: row.value });
});

addRoute('PUT', '/api/personal-info', async (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO personal_info (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  const entries = Object.entries(req.body);
  if (!entries.length) return json(res, { error: 'No fields provided' }, 400);
  for (const [k, v] of entries) upsert.run(k, String(v));

  const rows = db.prepare('SELECT key, value FROM personal_info').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  json(res, obj);
});

// ─── Company Research ───────────────────────────────────────────────
addRoute('GET', '/api/research/:jobId', (req, res) => {
  const r = db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(req.params.jobId);
  if (!r) return json(res, { error: 'No research found' }, 404);
  json(res, r);
});

addRoute('PUT', '/api/research/:jobId', async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  if (!db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId)) return json(res, { error: 'Job not found' }, 404);
  const { research_notes, company_summary, culture_notes, key_people, recent_news } = req.body;
  db.prepare(`
    INSERT INTO company_research (job_id, research_notes, company_summary, culture_notes, key_people, recent_news)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      research_notes = COALESCE(excluded.research_notes, research_notes),
      company_summary = COALESCE(excluded.company_summary, company_summary),
      culture_notes = COALESCE(excluded.culture_notes, culture_notes),
      key_people = COALESCE(excluded.key_people, key_people),
      recent_news = COALESCE(excluded.recent_news, recent_news),
      research_date = datetime('now')
  `).run(jobId, research_notes || null, company_summary || null, culture_notes || null, key_people || null, recent_news || null);
  json(res, db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(jobId));
});

addRoute('GET', '/api/research-prompt', (req, res) => {
  const tpl = path.join(__dirname, 'prompts', 'research-template.md');
  const defaultTpl = 'Research {{COMPANY}} for the {{TITLE}} role. Look into:\n- Company culture and values\n- Key leadership team members\n- Recent news and developments\n- Technical stack and engineering culture\n- Glassdoor reviews and employee sentiment';
  json(res, { template: fs.existsSync(tpl) ? fs.readFileSync(tpl, 'utf8') : defaultTpl });
});

addRoute('POST', '/api/research/:jobId/copy-prompt', async (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
  if (!job) return json(res, { error: 'Job not found' }, 404);
  const tpl = path.join(__dirname, 'prompts', 'research-template.md');
  let template = fs.existsSync(tpl) ? fs.readFileSync(tpl, 'utf8') :
    'Research {{COMPANY}} for the {{TITLE}} role. Look into:\n- Company culture and values\n- Key leadership\n- Recent news\n- Tech stack\n- Employee sentiment';
  template = template.replace(/\{\{COMPANY\}\}/g, job.company).replace(/\{\{TITLE\}\}/g, job.title)
    .replace(/\{\{DESCRIPTION\}\}/g, job.description || 'No description available');
  json(res, { prompt: template, job: { id: job.id, company: job.company, title: job.title } });
});

// ─── Challenges ─────────────────────────────────────────────────────
addRoute('GET', '/api/challenges/reusable', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, j.company as source_job_company FROM challenges c
    LEFT JOIN jobs j ON c.job_id = j.id WHERE c.reusable = 1
    ORDER BY c.category, c.date_updated DESC
  `).all();
  const grouped = {};
  for (const r of rows) { const cat = r.category || 'other'; (grouped[cat] = grouped[cat] || []).push(r); }
  json(res, grouped);
});

addRoute('GET', '/api/challenges', (req, res, query) => {
  let sql = 'SELECT c.*, j.company FROM challenges c LEFT JOIN jobs j ON c.job_id = j.id WHERE 1=1';
  const params = [];
  if (query.job_id) { sql += ' AND c.job_id = ?'; params.push(query.job_id); }
  if (query.category) { sql += ' AND c.category = ?'; params.push(query.category); }
  if (query.search) { sql += ' AND (c.question LIKE ? OR c.answer LIKE ?)'; params.push(`%${query.search}%`, `%${query.search}%`); }
  sql += ' ORDER BY c.date_updated DESC';
  json(res, db.prepare(sql).all(...params));
});

addRoute('GET', '/api/challenges/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!c) return json(res, { error: 'Challenge not found' }, 404);
  json(res, c);
});

addRoute('POST', '/api/challenges', async (req, res) => {
  const { job_id, question, answer, category, reusable, source_company } = req.body;
  if (!question) return json(res, { error: 'question is required' }, 400);
  const valid = ['scenario', 'case_study', 'technical', 'behavioral', 'portfolio', 'essay', 'other'];
  if (category && !valid.includes(category)) return json(res, { error: `Invalid category` }, 400);
  const result = db.prepare(
    'INSERT INTO challenges (job_id, question, answer, category, reusable, source_company) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(job_id || null, question, answer || null, category || 'other', reusable !== undefined ? reusable : 1, source_company || null);
  json(res, db.prepare('SELECT * FROM challenges WHERE id = ?').get(result.lastInsertRowid), 201);
});

addRoute('PUT', '/api/challenges/:id', async (req, res) => {
  if (!db.prepare('SELECT id FROM challenges WHERE id = ?').get(req.params.id)) return json(res, { error: 'Not found' }, 404);
  const fields = ['job_id', 'question', 'answer', 'category', 'reusable', 'source_company'];
  const updates = [], values = [];
  for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } }
  if (!updates.length) return json(res, { error: 'No fields to update' }, 400);
  updates.push("date_updated = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE challenges SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  json(res, db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id));
});

addRoute('DELETE', '/api/challenges/:id', (req, res) => {
  if (!db.prepare('SELECT id FROM challenges WHERE id = ?').get(req.params.id)) return json(res, { error: 'Not found' }, 404);
  db.prepare('DELETE FROM challenges WHERE id = ?').run(req.params.id);
  json(res, { deleted: true, id: parseInt(req.params.id, 10) });
});

// ─── Application Submissions ────────────────────────────────────────
addRoute('GET', '/api/submissions', (req, res, query) => {
  let sql = 'SELECT s.*, j.company, j.title, j.score FROM application_submissions s JOIN jobs j ON s.job_id = j.id WHERE 1=1';
  const params = [];
  if (query.response_type) { sql += ' AND s.response_type = ?'; params.push(query.response_type); }
  if (query.method) { sql += ' AND s.method = ?'; params.push(query.method); }
  sql += ' ORDER BY s.submitted_at DESC';
  json(res, db.prepare(sql).all(...params));
});

addRoute('POST', '/api/submissions', async (req, res) => {
  const { job_id, method, platform, cover_letter_id, contact_name, contact_email } = req.body;
  if (!job_id || !method) return json(res, { error: 'job_id and method required' }, 400);
  const valid = ['email', 'ats_portal', 'referral', 'recruiter', 'direct'];
  if (!valid.includes(method)) return json(res, { error: 'Invalid method' }, 400);

  const result = db.prepare(
    "INSERT INTO application_submissions (job_id, method, platform, cover_letter_id, response_type, contact_name, contact_email) VALUES (?, ?, ?, ?, 'none', ?, ?)"
  ).run(job_id, method, platform || null, cover_letter_id || null, contact_name || null, contact_email || null);
  db.prepare("UPDATE jobs SET status = 'SUBMITTED', date_updated = datetime('now') WHERE id = ?").run(job_id);
  json(res, db.prepare('SELECT * FROM application_submissions WHERE id = ?').get(result.lastInsertRowid), 201);
});

addRoute('PUT', '/api/submissions/:id', async (req, res) => {
  if (!db.prepare('SELECT id FROM application_submissions WHERE id = ?').get(req.params.id)) return json(res, { error: 'Not found' }, 404);
  const fields = ['response_type', 'response_date', 'response_notes', 'follow_up_date', 'contact_name', 'contact_email'];
  const updates = [], values = [];
  for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } }
  if (!updates.length) return json(res, { error: 'No fields to update' }, 400);
  values.push(req.params.id);
  db.prepare(`UPDATE application_submissions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  json(res, db.prepare('SELECT * FROM application_submissions WHERE id = ?').get(req.params.id));
});

// ─── Cover Letter Versions ──────────────────────────────────────────
addRoute('GET', '/api/letters/:jobId', (req, res) => {
  json(res, db.prepare('SELECT * FROM cover_letter_versions WHERE job_id = ? ORDER BY version').all(req.params.jobId));
});

addRoute('GET', '/api/letters/:jobId/:version', (req, res) => {
  const l = db.prepare('SELECT * FROM cover_letter_versions WHERE job_id = ? AND version = ?').get(req.params.jobId, req.params.version);
  if (!l) return json(res, { error: 'Not found' }, 404);
  json(res, l);
});

// ─── Conductor ──────────────────────────────────────────────────────
addRoute('GET', '/api/conductor/status', (req, res) => {
  const q = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE status = 'queued'").get();
  const p = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE status = 'processing'").get();
  const f = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE status = 'failed'").get();
  const dg = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE task_type = 'generate_letter' AND status = 'completed' AND date(completed_at) = date('now')").get();
  json(res, {
    queued: q.c, processing: p.c, failed: f.c, daily_generations: dg.c,
    daily_generation_limit: 5,
    status: p.c > 0 ? 'running' : q.c > 0 ? 'pending' : 'idle'
  });
});

addRoute('GET', '/api/conductor/queue', (req, res) => {
  json(res, db.prepare("SELECT * FROM conductor_queue WHERE status IN ('queued','processing','failed') ORDER BY priority DESC, created_at").all());
});

addRoute('POST', '/api/conductor/trigger/:taskType', async (req, res) => {
  const valid = ['score', 'generate_letter', 'submit_email', 'submit_ats', 'check_response', 'scrape'];
  if (!valid.includes(req.params.taskType)) return json(res, { error: 'Invalid task type' }, 400);
  const id = crypto.randomUUID();
  const jobId = req.body.job_id || null;
  const ikey = jobId ? `${jobId}_${req.params.taskType}` : null;
  if (ikey) {
    const ex = db.prepare("SELECT id FROM conductor_queue WHERE idempotency_key = ? AND status IN ('queued','processing')").get(ikey);
    if (ex) return json(res, { error: 'Task already queued', existing_id: ex.id }, 409);
  }
  db.prepare('INSERT INTO conductor_queue (id, job_id, task_type, payload, idempotency_key) VALUES (?, ?, ?, ?, ?)')
    .run(id, jobId, req.params.taskType, JSON.stringify(req.body.payload || {}), ikey);
  json(res, db.prepare('SELECT * FROM conductor_queue WHERE id = ?').get(id), 201);
});

addRoute('POST', '/api/conductor/retry/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM conductor_queue WHERE id = ?').get(req.params.id);
  if (!item) return json(res, { error: 'Not found' }, 404);
  if (item.status !== 'failed') return json(res, { error: 'Can only retry failed items' }, 400);
  db.prepare("UPDATE conductor_queue SET status = 'queued', error = NULL, retry_count = retry_count + 1, started_at = NULL, completed_at = NULL WHERE id = ?").run(req.params.id);
  json(res, db.prepare('SELECT * FROM conductor_queue WHERE id = ?').get(req.params.id));
});

// ─── Conductor State Machine ────────────────────────────────────────
const conductor = require('./conductor/scheduler');

addRoute('POST', '/api/conductor/transition/:jobId', async (req, res) => {
  const { status } = req.body;
  if (!status) return json(res, { error: 'status is required' }, 400);
  const result = conductor.transitionJob(parseInt(req.params.jobId, 10), status);
  if (!result.success) return json(res, { error: result.error }, 400);
  json(res, db.prepare('SELECT * FROM job_current_state WHERE id = ?').get(req.params.jobId));
});

addRoute('GET', '/api/conductor/health', (req, res) => {
  const health = conductor.getQueueHealth();
  const stalls = conductor.detectStalls();
  const recentErrors = db.prepare(
    "SELECT COUNT(*) as c FROM errors WHERE julianday('now') - julianday(timestamp) < 1"
  ).get();
  json(res, { ...health, stalls_detected: stalls, recent_errors: recentErrors.c });
});

addRoute('GET', '/api/conductor/transitions', (req, res) => {
  json(res, conductor.VALID_TRANSITIONS);
});

// ─── Cover Letter Generation ───────────────────────────────────────
const { generateCoverLetter, registerPrompts } = require('./lib/cover-letter-generator');

// Register prompt versions on startup
try { registerPrompts(db); } catch (e) { console.warn('  ⚠ Could not register prompts:', e.message); }

addRoute('POST', '/api/generate-letter/:jobId', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(res, { error: 'ANTHROPIC_API_KEY not configured. Set it in environment.' }, 503);

  const jobId = parseInt(req.params.jobId, 10);
  const dryRun = req.body.dry_run === true;

  try {
    const result = await generateCoverLetter(db, apiKey, jobId, { dryRun });
    json(res, result, result.success ? (result.dryRun ? 200 : 201) : 429);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// Override for hallucination claims (Wolf approves flagged content)
addRoute('PUT', '/api/letters/:jobId/:version/override', async (req, res) => {
  const letter = db.prepare('SELECT * FROM cover_letter_versions WHERE job_id = ? AND version = ?')
    .get(req.params.jobId, req.params.version);
  if (!letter) return json(res, { error: 'Letter version not found' }, 404);

  db.prepare(`UPDATE cover_letter_versions SET hallucination_check = 'pass', needs_review = 0 WHERE job_id = ? AND version = ?`)
    .run(req.params.jobId, req.params.version);
  db.prepare("UPDATE jobs SET status = 'COVER_LETTER_READY', date_updated = datetime('now') WHERE id = ?")
    .run(req.params.jobId);

  json(res, { success: true, message: 'Override applied — letter approved' });
});

// Generation status (circuit breaker info)
addRoute('GET', '/api/generation-status', (req, res) => {
  const dailyCount = db.prepare("SELECT COUNT(*) as c FROM cover_letter_versions WHERE date(created_at) = date('now')").get();
  const dailyCost = db.prepare("SELECT COALESCE(SUM(cost_estimate), 0) as total FROM cover_letter_versions WHERE date(created_at) = date('now')").get();
  const monthlyCost = db.prepare("SELECT COALESCE(SUM(cost_estimate), 0) as total FROM cover_letter_versions WHERE created_at >= date('now', 'start of month')").get();
  json(res, {
    daily_generations: dailyCount.c,
    daily_limit: 5,
    daily_cost: Math.round(dailyCost.total * 100) / 100,
    daily_budget: 2.00,
    monthly_cost: Math.round(monthlyCost.total * 100) / 100,
    monthly_budget: 55.00,
    can_generate: dailyCount.c < 5 && dailyCost.total < 2.0,
  });
});

// Prompt registry
addRoute('GET', '/api/prompts', (req, res) => {
  json(res, db.prepare('SELECT id, name, version, model_version, created_at FROM prompt_registry ORDER BY name, version DESC').all());
});

addRoute('GET', '/api/prompts/:name', (req, res) => {
  const latest = db.prepare('SELECT * FROM prompt_registry WHERE name = ? ORDER BY version DESC LIMIT 1').get(req.params.name);
  if (!latest) return json(res, { error: 'Prompt not found' }, 404);
  json(res, latest);
});

// ─── Content Ingestion ──────────────────────────────────────────────
addRoute('POST', '/api/bridge/ingest', async (req, res) => {
  const authToken = process.env.BRIDGE_AUTH_TOKEN;
  if (authToken) {
    const provided = (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== authToken) return json(res, { error: 'Invalid auth token' }, 401);
  }
  const { content_type, job_id, content } = req.body;
  if (!content_type || !content) return json(res, { error: 'content_type and content required' }, 400);
  const valid = ['cover_letter', 'research', 'qa_answers', 'resume_notes', 'other'];
  if (!valid.includes(content_type)) return json(res, { error: 'Invalid content_type' }, 400);
  const size = Buffer.byteLength(content, 'utf8');
  if (size > 51200) return json(res, { error: 'Content too large. Max 50KB.' }, 413);

  const hash = crypto.createHash('sha256').update(content).digest('hex');
  db.prepare('INSERT INTO bridge_events (content_type, job_id, payload_hash, payload_size) VALUES (?, ?, ?, ?)')
    .run(content_type, job_id || null, hash, size);

  if (content_type === 'research' && job_id) {
    db.prepare(`INSERT INTO company_research (job_id, research_notes) VALUES (?, ?)
      ON CONFLICT(job_id) DO UPDATE SET research_notes = excluded.research_notes, research_date = datetime('now')`)
      .run(job_id, content);
  }

  json(res, { success: true, content_type, job_id, size, hash }, 201);
});

// ─── System Health ──────────────────────────────────────────────────
addRoute('GET', '/api/health', (req, res) => {
  const components = {};

  try {
    const t0 = Date.now();
    db.prepare('SELECT 1').get();
    const ms = Date.now() - t0;
    const stat = fs.statSync(DB_PATH);
    const walPath = DB_PATH + '-wal';
    const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    components.sqlite = { status: ms < 100 ? 'ok' : ms < 500 ? 'warning' : 'error', size_mb: Math.round(stat.size / 1024 / 1024 * 10) / 10, wal_size_mb: Math.round(walSize / 1024 / 1024 * 10) / 10, response_ms: ms };
  } catch (e) { components.sqlite = { status: 'error', error: e.message }; }

  components.express = { status: 'ok', uptime_seconds: Math.round(process.uptime()), response_ms: 0 };
  components.gmail = { status: 'not_configured', token_expires: null, days_remaining: null };
  components.playwright = { status: 'not_configured', cdp_connected: false, last_action: null };
  components.pm2 = { status: 'not_configured', conductor_pid: null, restarts: null };

  try {
    const { execSync } = require('child_process');
    const df = execSync('df -k . 2>/dev/null', { encoding: 'utf8' });
    const parts = df.trim().split('\n')[1]?.split(/\s+/) || [];
    const total = parseInt(parts[1], 10) || 1, used = parseInt(parts[2], 10) || 0;
    const pct = Math.round((used / total) * 100);
    components.disk = { status: pct < 80 ? 'ok' : pct < 90 ? 'warning' : 'error', free_gb: Math.round((total - used) / 1024 / 1024 * 10) / 10, percent_used: pct };
  } catch { components.disk = { status: 'ok', free_gb: 0, percent_used: 0 }; }

  const dg = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE task_type = 'generate_letter' AND status = 'completed' AND date(completed_at) = date('now')").get();

  const overall = Object.values(components).some(c => c.status === 'error') ? 'error'
    : Object.values(components).some(c => c.status === 'warning') ? 'warning' : 'ok';

  json(res, {
    timestamp: new Date().toISOString(), overall, components,
    budget: { daily_spent: 0, daily_limit: 2.00, monthly_spent: 0, monthly_limit: 55.00, cover_letters_today: dg.c, cover_letters_limit: 5 }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// APPLICATION BOT (ATS Submission)
// ═══════════════════════════════════════════════════════════════════════

const applicationBot = require('./conductor/application-bot');
const platformAdapters = require('./conductor/platform_adapters');
platformAdapters.registerAll(applicationBot);

// GET /api/ats/status — CDP connection status + adapter info
addRoute('GET', '/api/ats/status', (req, res) => {
  const botStatus = applicationBot.getStatus();
  const adapters = platformAdapters.list();
  const approved = db.prepare(
    "SELECT COUNT(*) as c FROM jobs WHERE status = 'APPROVED' AND url IS NOT NULL"
  ).get();
  json(res, { ...botStatus, adapters, approved_count: approved.c });
});

// POST /api/ats/connect — Connect to Chrome via CDP
addRoute('POST', '/api/ats/connect', async (req, res) => {
  const result = await applicationBot.connect();
  json(res, result, result.success ? 200 : 503);
});

// POST /api/ats/disconnect — Disconnect from Chrome
addRoute('POST', '/api/ats/disconnect', async (req, res) => {
  await applicationBot.disconnect();
  json(res, { success: true });
});

// GET /api/ats/queue — List jobs approved for ATS submission
addRoute('GET', '/api/ats/queue', (req, res) => {
  const jobs = db.prepare(`
    SELECT j.id, j.company, j.title, j.url, j.score, j.status, j.date_updated,
      (SELECT COUNT(*) FROM application_submissions s
       WHERE s.job_id = j.id AND julianday('now') - julianday(s.submitted_at) < 90
      ) as recent_submissions,
      (SELECT cl.id FROM cover_letter_versions cl
       WHERE cl.job_id = j.id ORDER BY cl.version DESC LIMIT 1
      ) as has_cover_letter
    FROM jobs j
    WHERE j.status = 'APPROVED' AND j.url IS NOT NULL
    ORDER BY j.score DESC
  `).all();
  json(res, { jobs });
});

// POST /api/ats/submit/:id — Submit a single job (pull-based, Wolf-triggered)
addRoute('POST', '/api/ats/submit/:id', async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const dryRun = req.body?.dry_run === true;
  const result = await applicationBot.submitJob(db, jobId, { dryRun });
  json(res, result, result.success ? 200 : 400);
});

// POST /api/ats/process-queue — Process all approved jobs (pull-based)
addRoute('POST', '/api/ats/process-queue', async (req, res) => {
  const dryRun = req.body?.dry_run === true;
  const result = await applicationBot.processQueue(db, { dryRun });
  json(res, result);
});

// GET /api/ats/submissions — List past submissions
addRoute('GET', '/api/ats/submissions', (req, res) => {
  const limit = parseInt(req.query?.limit || '50', 10);
  const submissions = db.prepare(`
    SELECT s.*, j.company, j.title
    FROM application_submissions s
    JOIN jobs j ON j.id = s.job_id
    ORDER BY s.submitted_at DESC
    LIMIT ?
  `).all(limit);
  json(res, { submissions });
});

// ═══════════════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  // Try API routes first
  const match = matchRoute(req.method, pathname);
  if (match) {
    try {
      req.params = match.params;
      // Parse body for POST/PUT
      if (req.method === 'POST' || req.method === 'PUT') {
        req.body = await parseBody(req);
      }
      await match.handler(req, res, query);
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return;
  }

  // Static files from public/
  const publicDir = path.join(__dirname, 'public');
  if (pathname === '/' || pathname === '/v2') {
    return serveFile(res, path.join(publicDir, 'command-center.html'));
  }
  if (pathname === '/v1') {
    return serveFile(res, path.join(__dirname, 'PIPELINE_DASHBOARD.html'));
  }

  // Serve static files from public/
  const staticPath = path.join(publicDir, pathname);
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    return serveFile(res, staticPath);
  }

  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✓ Job Pipeline Server v2 running');
  console.log(`  ✓ Command Center: http://localhost:${PORT}`);
  console.log(`  ✓ Old Dashboard:  http://localhost:${PORT}/v1`);
  console.log(`  ✓ API:            http://localhost:${PORT}/api/stats`);
  console.log(`  ✓ Health:         http://localhost:${PORT}/api/health`);
  console.log('');
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
