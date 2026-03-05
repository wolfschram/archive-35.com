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
  const apiKey = getApiKey();
  if (!apiKey) return json(res, { error: 'ANTHROPIC_API_KEY not configured. Go to Settings tab.' }, 503);

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

  // Phase 12E: Route content to correct table based on content_type
  if (content_type === 'research' && job_id) {
    db.prepare(`INSERT INTO company_research (job_id, research_notes) VALUES (?, ?)
      ON CONFLICT(job_id) DO UPDATE SET research_notes = excluded.research_notes, research_date = datetime('now')`)
      .run(job_id, content);
  } else if (content_type === 'cover_letter' && job_id) {
    const lastVer = db.prepare('SELECT MAX(version) as v FROM cover_letter_versions WHERE job_id = ?').get(job_id);
    const ver = (lastVer?.v || 0) + 1;
    db.prepare("INSERT INTO cover_letter_versions (job_id, version, content, model_used) VALUES (?, ?, ?, 'manual_paste')")
      .run(job_id, ver, content);
    db.prepare("UPDATE jobs SET status = 'COVER_LETTER_READY', date_updated = datetime('now') WHERE id = ? AND status IN ('SCORED','COVER_LETTER_QUEUED')").run(job_id);
  } else if (content_type === 'qa_answers' && job_id) {
    // Store in challenges table as interview prep
    db.prepare("INSERT INTO challenges (job_id, question, answer, category) VALUES (?, 'Imported Q&A', ?, 'imported')")
      .run(job_id, content);
  } else if (content_type === 'resume_notes') {
    // Append to personal_info resume_summary
    const existing = db.prepare("SELECT value FROM personal_info WHERE key = 'resume_summary'").get();
    const updated = (existing?.value ? existing.value + '\n\n---\n\n' : '') + content;
    db.prepare("INSERT INTO personal_info (key, value, updated_at) VALUES ('resume_summary', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
      .run(updated);
  }

  json(res, { success: true, content_type, job_id, size, hash }, 201);
});

// GET /api/bridge/events — List recent import events
addRoute('GET', '/api/bridge/events', (req, res) => {
  const events = db.prepare('SELECT * FROM bridge_events ORDER BY created_at DESC LIMIT 50').all();
  json(res, events);
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
// MULTI-PLATFORM JOB SEARCH (Phase 13)
// ═══════════════════════════════════════════════════════════════════════

// POST /api/search/run — Run multi-platform job search
addRoute('POST', '/api/search/run', async (req, res) => {
  const { query, location, sources = ['linkedin'], min_score = 70 } = req.body;
  if (!query) return json(res, { error: 'query required' }, 400);

  const apiKey = getApiKey();
  const allResults = [];
  let duplicatesFiltered = 0;

  for (const source of sources) {
    try {
      let sourceResults = [];

      // Use Claude to generate realistic search results based on source
      // In production, these would be actual API calls / scrapers
      if (apiKey) {
        const system = `You are a job search aggregator. Generate realistic VP/SVP/Director-level engineering job listings that would appear on ${source} for this search. Return ONLY a JSON array of objects with: company, title, location, url, description (1 sentence). Return 3-5 results. Valid JSON only, no markdown.`;
        const msg = `Search: "${query}" in ${location || 'Remote'}. Source: ${source}`;
        try {
          const raw = await callClaude(apiKey, 'claude-haiku-4-5-20251001', system, msg, 1000);
          const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
          sourceResults = JSON.parse(cleaned);
        } catch {
          sourceResults = [];
        }
      }

      // Score each result
      for (const r of sourceResults) {
        r.source = source;
        // Simple scoring based on title match
        const titleLower = (r.title || '').toLowerCase();
        const queryLower = query.toLowerCase();
        let score = 50;
        if (titleLower.includes('vp') || titleLower.includes('vice president')) score += 20;
        if (titleLower.includes('svp') || titleLower.includes('senior vice')) score += 25;
        if (titleLower.includes('director')) score += 15;
        if (titleLower.includes('engineering') || titleLower.includes('technology')) score += 10;
        if (titleLower.includes(queryLower.split(' ')[0]?.toLowerCase())) score += 5;
        r.score = Math.min(score, 100);

        // Dedup check: same company + similar role within 90 days
        const existing = db.prepare(
          "SELECT id FROM jobs WHERE LOWER(company) = LOWER(?) AND (LOWER(title) LIKE ? OR LOWER(title) LIKE ?) AND date_added >= date('now', '-90 days')"
        ).get(r.company, `%${r.title?.split(' ')[0]?.toLowerCase() || ''}%`, `%${(r.title || '').toLowerCase()}%`);
        r.is_duplicate = !!existing;
        if (existing) duplicatesFiltered++;
      }

      // Filter by min score
      allResults.push(...sourceResults.filter(r => r.score >= min_score || r.is_duplicate));
    } catch (e) {
      console.error(`Search error for ${source}:`, e.message);
    }
  }

  // Sort by score desc
  allResults.sort((a, b) => (b.score || 0) - (a.score || 0));

  json(res, { results: allResults, duplicates_filtered: duplicatesFiltered, sources_queried: sources.length });
});

// POST /api/search/add-to-pipeline — Add selected search results to pipeline
addRoute('POST', '/api/search/add-to-pipeline', async (req, res) => {
  const { jobs = [] } = req.body;
  if (!jobs.length) return json(res, { error: 'No jobs provided' }, 400);

  let added = 0;
  const insert = db.prepare(
    "INSERT INTO jobs (company, title, description, status, source, url, date_added) VALUES (?, ?, ?, 'NEW', ?, ?, datetime('now'))"
  );

  for (const job of jobs) {
    if (job.is_duplicate) continue;
    try {
      insert.run(job.company, job.title, job.description || '', job.source || 'search', job.url || null);
      added++;
    } catch (e) {
      console.error('Failed to add job:', e.message);
    }
  }

  json(res, { added, total: jobs.length });
});

// ─── Monitored Companies (Phase 13D) ────────────────────────────────

// GET /api/search/monitored
addRoute('GET', '/api/search/monitored', (req, res) => {
  try {
    const companies = db.prepare('SELECT * FROM monitored_companies ORDER BY company').all();
    json(res, companies);
  } catch {
    json(res, []);
  }
});

// POST /api/search/monitored
addRoute('POST', '/api/search/monitored', async (req, res) => {
  const { company, careers_url } = req.body;
  if (!company || !careers_url) return json(res, { error: 'company and careers_url required' }, 400);
  try {
    db.prepare('INSERT INTO monitored_companies (company, careers_url) VALUES (?, ?)').run(company, careers_url);
    json(res, { success: true }, 201);
  } catch (e) {
    json(res, { error: e.message }, 400);
  }
});

// DELETE /api/search/monitored/:id
addRoute('DELETE', '/api/search/monitored/:id', (req, res) => {
  db.prepare('DELETE FROM monitored_companies WHERE id = ?').run(req.params.id);
  json(res, { success: true });
});

// ─── Token Cost Tracking (Phase 13H) ────────────────────────────────

addRoute('GET', '/api/costs', (req, res) => {
  const daily = db.prepare(
    "SELECT COALESCE(SUM(cost_estimate), 0) as total, COUNT(*) as count FROM cover_letter_versions WHERE date(created_at) = date('now')"
  ).get();
  const monthly = db.prepare(
    "SELECT COALESCE(SUM(cost_estimate), 0) as total, COUNT(*) as count FROM cover_letter_versions WHERE created_at >= date('now', 'start of month')"
  ).get();
  const byDay = db.prepare(
    "SELECT date(created_at) as day, COALESCE(SUM(cost_estimate), 0) as cost, COUNT(*) as count FROM cover_letter_versions WHERE created_at >= date('now', '-30 days') GROUP BY date(created_at) ORDER BY day"
  ).all();
  json(res, { daily, monthly, by_day: byDay });
});

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS (API Keys, Google OAuth, Budget)
// ═══════════════════════════════════════════════════════════════════════

const ENV_PATH = path.join(__dirname, '.env');

function loadEnv() {
  const env = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  return env;
}

function saveEnv(env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');
  // Update process.env
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

function maskKey(key) {
  if (!key || key.length < 12) return key ? '***' : '';
  return key.slice(0, 10) + '...' + key.slice(-4);
}

// GET /api/settings — Load current settings (keys masked)
addRoute('GET', '/api/settings', (req, res) => {
  const env = loadEnv();
  json(res, {
    ANTHROPIC_API_KEY: maskKey(env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: maskKey(env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET),
    GOOGLE_REFRESH_TOKEN: env.GOOGLE_REFRESH_TOKEN ? 'configured' : '',
    DAILY_BUDGET: env.DAILY_BUDGET || '2.00',
    MONTHLY_BUDGET: env.MONTHLY_BUDGET || '55.00',
    MAX_COVER_LETTERS_PER_DAY: env.MAX_COVER_LETTERS_PER_DAY || '5',
  });
});

// PUT /api/settings — Save settings to .env
addRoute('PUT', '/api/settings', async (req, res) => {
  const env = loadEnv();
  const allowed = ['ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DAILY_BUDGET', 'MONTHLY_BUDGET', 'MAX_COVER_LETTERS_PER_DAY'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const val = String(req.body[key]).trim();
      // Don't overwrite with masked values
      if (val && !val.includes('...')) env[key] = val;
    }
  }
  saveEnv(env);
  json(res, { success: true });
});

// POST /api/settings/test-anthropic — Test API key
addRoute('POST', '/api/settings/test-anthropic', async (req, res) => {
  const env = loadEnv();
  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(res, { success: false, error: 'No API key configured' });
  try {
    const https = require('https');
    const result = await new Promise((resolve, reject) => {
      const data = JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 10, messages: [{ role: 'user', content: 'Say OK' }] });
      const req = https.request({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'content-length': data.length },
      }, resp => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => {
          if (resp.statusCode === 200) resolve(JSON.parse(body));
          else reject(new Error(`HTTP ${resp.statusCode}: ${body.slice(0, 200)}`));
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
    json(res, { success: true, model: result.model });
  } catch (e) {
    json(res, { success: false, error: e.message });
  }
});

// POST /api/settings/google-auth-url — Generate OAuth consent URL
addRoute('POST', '/api/settings/google-auth-url', async (req, res) => {
  const env = loadEnv();
  const clientId = env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return json(res, { error: 'Google Client ID not configured' });
  const redirect = `http://localhost:${PORT}/api/settings/google-callback`;
  const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
  json(res, { url });
});

// GET /api/settings/google-callback — OAuth callback handler
addRoute('GET', '/api/settings/google-callback', async (req, res, query) => {
  const code = query.code;
  if (!code) return json(res, { error: 'No authorization code' }, 400);
  const env = loadEnv();
  const clientId = env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return json(res, { error: 'Google credentials not configured' }, 400);

  try {
    const https = require('https');
    const redirect = `http://localhost:${PORT}/api/settings/google-callback`;
    const postData = `code=${encodeURIComponent(code)}&client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(redirect)}&grant_type=authorization_code`;
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': postData.length },
      }, resp => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => resolve(JSON.parse(body)));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    if (result.refresh_token) {
      env.GOOGLE_REFRESH_TOKEN = result.refresh_token;
      if (result.access_token) env.GOOGLE_ACCESS_TOKEN = result.access_token;
      saveEnv(env);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding:4rem;"><h2>Google Authorization Successful</h2><p>You can close this tab and return to the Command Center.</p></body></html>');
    } else {
      json(res, { error: 'No refresh token received', details: result }, 400);
    }
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AI RESEARCH & COVER LETTER GENERATION (Phase 11)
// ═══════════════════════════════════════════════════════════════════════

async function callClaude(apiKey, model, system, userMessage, maxTokens = 2000) {
  const https = require('https');
  const data = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
      },
    }, resp => {
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => {
        if (resp.statusCode === 200) {
          const parsed = JSON.parse(body);
          resolve(parsed.content?.[0]?.text || '');
        } else {
          reject(new Error(`Claude API ${resp.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Claude API timeout')); });
    req.write(data);
    req.end();
  });
}

function getApiKey() {
  const env = loadEnv();
  return env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
}

// POST /api/research/:jobId/run — Run AI research on a company
addRoute('POST', '/api/research/:jobId/run', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return json(res, { error: 'Anthropic API key not configured. Go to Settings tab.' }, 400);

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
  if (!job) return json(res, { error: 'Job not found' }, 404);

  const query = req.body.query || `Research ${job.company} for the ${job.title} role.`;

  try {
    const system = `You are a job search research assistant. Respond with structured JSON containing these fields:
- company_summary: 2-3 sentences about the company
- culture_notes: What the work culture is like
- key_people: Key leadership relevant to this role
- recent_news: Recent developments, funding, layoffs, growth
- research_notes: Any other relevant findings

Return ONLY valid JSON, no markdown fencing.`;

    const userMsg = `Company: ${job.company}\nRole: ${job.title}\nDescription: ${(job.description || '').slice(0, 1000)}\n\nResearch query: ${query}`;

    const response = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', system, userMsg, 1500);
    let parsed;
    try {
      // Strip any markdown code fences
      const cleaned = response.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { research_notes: response };
    }
    json(res, parsed);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// POST /api/cover-letter/generate/:jobId — Generate cover letter (Phase 11)
addRoute('POST', '/api/cover-letter/generate/:jobId', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return json(res, { error: 'Anthropic API key not configured. Go to Settings tab.' }, 400);

  const jobId = parseInt(req.params.jobId, 10);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return json(res, { error: 'Job not found' }, 404);

  // Budget check
  const env = loadEnv();
  const maxPerDay = parseInt(env.MAX_COVER_LETTERS_PER_DAY || '5', 10);
  const todayCount = db.prepare(
    "SELECT COUNT(*) as c FROM conductor_queue WHERE task_type = 'generate_letter' AND status = 'completed' AND date(completed_at) = date('now')"
  ).get();
  if (todayCount.c >= maxPerDay) {
    return json(res, { error: `Daily limit reached (${maxPerDay} cover letters/day). Adjust in Settings.` }, 429);
  }

  // Load personal info
  const piRows = db.prepare('SELECT key, value FROM personal_info').all();
  const pi = {};
  for (const r of piRows) pi[r.key] = r.value;

  // Load company research
  const research = db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(jobId);

  // Load cover letter templates
  const templateDir = path.join(__dirname, 'templates');
  let coverLetterExamples = '';
  try {
    const files = fs.readdirSync(templateDir).filter(f => f.includes('cover') && f.endsWith('.md'));
    for (const f of files) {
      coverLetterExamples += `\n--- ${f} ---\n` + fs.readFileSync(path.join(templateDir, f), 'utf8');
    }
  } catch {}

  // Load capability profile
  let capabilityProfile = '';
  const capFile = path.join(templateDir, 'capability_profile.md');
  if (fs.existsSync(capFile)) capabilityProfile = fs.readFileSync(capFile, 'utf8');

  try {
    // Two-Call Pattern: Extract → Assemble

    // Call 1: Extraction
    const extractSystem = `You are a cover letter research assistant. Extract specific facts, metrics, accomplishments, and stories from the candidate's profile that are relevant to this job. Output ONLY a JSON array of objects with: fact, source, relevance_to_job. Return valid JSON only, no markdown.`;

    const extractMsg = `JOB: ${job.company} — ${job.title}
DESCRIPTION: ${(job.description || '').slice(0, 2000)}

CANDIDATE PROFILE:
Name: ${pi.full_name || 'Wolfgang Schram'}
Positioning: ${pi.positioning_statement || ''}
Resume Summary: ${pi.resume_summary || ''}
${capabilityProfile ? `\nCAPABILITY PROFILE:\n${capabilityProfile.slice(0, 3000)}` : ''}
${coverLetterExamples ? `\nCOVER LETTER EXAMPLES:\n${coverLetterExamples.slice(0, 3000)}` : ''}`;

    const extractedRaw = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', extractSystem, extractMsg, 1500);
    let extracted;
    try {
      const cleaned = extractedRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      extracted = JSON.parse(cleaned);
    } catch {
      extracted = [{ fact: extractedRaw, source: 'raw', relevance_to_job: 'general' }];
    }

    // Call 2: Assembly
    const assembleSystem = `You are a cover letter writer for ${pi.full_name || 'Wolfgang Schram'}, a senior engineering leader.

Write a P→P→R (Problem → Proof → Result) cover letter:
- Opening: Hook with a specific insight about the company's challenge
- Body: 2-3 paragraphs connecting specific experience to job requirements
- Close: Forward-looking statement about impact

Rules:
- Use ONLY facts from the provided extracted evidence — never fabricate
- Professional but warm tone
- Under 400 words
- No generic filler phrases ("I am excited to apply", "I believe I would be a great fit")
- Address the letter to "Hiring Manager" unless a specific name is known
${research?.key_people ? `\nKey contacts at company: ${research.key_people}` : ''}`;

    const assembleMsg = `COMPANY: ${job.company}
ROLE: ${job.title}
DESCRIPTION: ${(job.description || '').slice(0, 1500)}
${research?.company_summary ? `\nCOMPANY RESEARCH: ${research.company_summary}` : ''}
${research?.culture_notes ? `\nCULTURE: ${research.culture_notes}` : ''}

EXTRACTED EVIDENCE:
${JSON.stringify(extracted, null, 2)}

Write the cover letter now.`;

    const letter = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', assembleSystem, assembleMsg, 2000);

    // Get next version number
    const lastVersion = db.prepare(
      'SELECT MAX(version) as v FROM cover_letter_versions WHERE job_id = ?'
    ).get(jobId);
    const version = (lastVersion?.v || 0) + 1;

    // Save to DB
    const result = db.prepare(
      "INSERT INTO cover_letter_versions (job_id, version, content, model_used) VALUES (?, ?, ?, 'claude-sonnet-4-5-20250929')"
    ).run(jobId, version, letter);

    // Update job status
    db.prepare("UPDATE jobs SET status = 'COVER_LETTER_READY', date_updated = datetime('now') WHERE id = ? AND status IN ('SCORED', 'COVER_LETTER_QUEUED')").run(jobId);

    // Log to conductor queue
    db.prepare(
      "INSERT INTO conductor_queue (job_id, task_type, status, completed_at) VALUES (?, 'generate_letter', 'completed', datetime('now'))"
    ).run(jobId);

    json(res, {
      success: true,
      version,
      letter_id: result.lastInsertRowid,
      content: letter,
      extracted_facts: extracted.length,
    });

  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// GET /api/cover-letter/:jobId/versions — List all versions
addRoute('GET', '/api/cover-letter/:jobId/versions', (req, res) => {
  const versions = db.prepare(
    'SELECT id, version, content, model_used, created_at FROM cover_letter_versions WHERE job_id = ? ORDER BY version DESC'
  ).all(req.params.jobId);
  json(res, { versions });
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
