#!/usr/bin/env node
/**
 * Job Pipeline Server
 * Express + better-sqlite3 backend for the Job Pipeline Dashboard.
 * Run: npm start → http://localhost:3000
 */

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'pipeline.db');

// Check database exists
if (!fs.existsSync(DB_PATH)) {
  console.error('\n  ✗ pipeline.db not found. Run: npm run init-db\n');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Middleware
app.use(cors());
app.use(express.json());

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'PIPELINE_DASHBOARD.html'));
});

// Serve cover letter template
app.get('/api/cover-letter-template', (req, res) => {
  const templatePath = path.join(__dirname, 'prompts', 'cover-letter-template.md');
  const template = fs.readFileSync(templatePath, 'utf8');
  res.json({ template });
});

// ─── GET /api/stats ──────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs GROUP BY status ORDER BY
    CASE status
      WHEN 'NEW' THEN 1
      WHEN 'SCRAPED' THEN 2
      WHEN 'SCORED' THEN 3
      WHEN 'APPLIED' THEN 4
      WHEN 'INTERVIEW' THEN 5
      WHEN 'OFFER' THEN 6
      WHEN 'REJECTED' THEN 7
    END
  `).all();

  const applied = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status IN ('APPLIED','INTERVIEW','OFFER','REJECTED')`).get();
  const interviews = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status IN ('INTERVIEW','OFFER')`).get();
  const offers = db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status = 'OFFER'`).get();

  const conversionRate = applied.count > 0
    ? Math.round((interviews.count / applied.count) * 100)
    : 0;

  res.json({
    total: total.count,
    byStatus,
    applied: applied.count,
    interviews: interviews.count,
    offers: offers.count,
    conversionRate
  });
});

// ─── GET /api/jobs ───────────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
  const { status, sort } = req.query;
  let query = 'SELECT * FROM jobs';
  const params = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status.toUpperCase());
  }

  const sortCol = sort || 'date_updated';
  const validSorts = ['date_added', 'date_updated', 'score', 'company', 'status'];
  const safeSort = validSorts.includes(sortCol) ? sortCol : 'date_updated';
  query += ` ORDER BY ${safeSort} DESC`;

  const jobs = db.prepare(query).all(...params);
  res.json(jobs);
});

// ─── GET /api/jobs/:id ───────────────────────────────────────────────
app.get('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ─── POST /api/jobs ──────────────────────────────────────────────────
app.post('/api/jobs', (req, res) => {
  const { company, title, description, status, score, source, url, notes, template_version } = req.body;
  if (!company || !title) {
    return res.status(400).json({ error: 'company and title are required' });
  }
  const result = db.prepare(`
    INSERT INTO jobs (company, title, description, status, score, source, url, notes, template_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(company, title, description || null, status || 'NEW', score || null, source || null, url || null, notes || null, template_version || 'v1');

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(job);
});

// ─── PUT /api/jobs/:id ───────────────────────────────────────────────
app.put('/api/jobs/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Job not found' });

  const fields = ['company', 'title', 'description', 'status', 'score', 'source', 'url', 'cover_letter', 'notes', 'template_version'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push("date_updated = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  res.json(job);
});

// ─── GET /api/agents ─────────────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  const agents = db.prepare('SELECT * FROM agents ORDER BY name').all();
  res.json(agents);
});

// ─── GET /api/errors ─────────────────────────────────────────────────
app.get('/api/errors', (req, res) => {
  const errors = db.prepare(`
    SELECT e.*, j.company, j.title, a.name as agent_name
    FROM errors e
    LEFT JOIN jobs j ON e.job_id = j.id
    LEFT JOIN agents a ON e.agent_id = a.id
    ORDER BY e.timestamp DESC
    LIMIT 50
  `).all();
  res.json(errors);
});

// ─── GET /api/template-metrics ───────────────────────────────────────
// Phase 6: Feedback Analyzer — success rates by template_version
app.get('/api/template-metrics', (req, res) => {
  const metrics = db.prepare('SELECT * FROM template_metrics').all();
  res.json(metrics);
});

// ─── GET /api/prompt/:id ─────────────────────────────────────────────
// Generates the full cover letter prompt for a SCORED job
app.get('/api/prompt/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const templatePath = path.join(__dirname, 'prompts', 'cover-letter-template.md');
  let template = fs.readFileSync(templatePath, 'utf8');

  template = template.replace('{{COMPANY}}', job.company);
  template = template.replace('{{TITLE}}', job.title);
  template = template.replace('{{DESCRIPTION}}', job.description || 'No description available');

  res.json({ prompt: template, job });
});

// ─── Start Server ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log(`  ✓ Job Pipeline Server running`);
  console.log(`  ✓ Dashboard: http://localhost:${PORT}`);
  console.log(`  ✓ API: http://localhost:${PORT}/api/stats`);
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
