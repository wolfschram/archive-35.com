#!/usr/bin/env node
/**
 * Job Pipeline — Database Initialization
 * Creates pipeline.db with schema and seed data.
 * Run: npm run init-db
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'pipeline.db');

// Remove existing DB for fresh init
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.transaction = db.transaction; // already exists
} catch {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.transaction = function(fn) {
    return function(...args) {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    };
  };
}

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  -- Jobs table: core pipeline tracking
  CREATE TABLE IF NOT EXISTS jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company         TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'NEW'
                    CHECK(status IN ('NEW','SCRAPED','SCORED','APPLIED','INTERVIEW','REJECTED','OFFER')),
    score           INTEGER,
    source          TEXT,
    url             TEXT,
    cover_letter    TEXT,
    date_added      TEXT NOT NULL DEFAULT (datetime('now')),
    date_updated    TEXT NOT NULL DEFAULT (datetime('now')),
    notes           TEXT,
    template_version TEXT DEFAULT 'v1'
  );

  -- Agents table: automation agent tracking
  CREATE TABLE IF NOT EXISTS agents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    type            TEXT,
    status          TEXT NOT NULL DEFAULT 'idle'
                    CHECK(status IN ('idle','running','error')),
    last_run        TEXT,
    jobs_processed  INTEGER DEFAULT 0,
    errors          INTEGER DEFAULT 0
  );

  -- Errors table: error log with FK relationships
  CREATE TABLE IF NOT EXISTS errors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          INTEGER REFERENCES jobs(id),
    agent_id        INTEGER REFERENCES agents(id),
    error_message   TEXT NOT NULL,
    timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
    resolved        INTEGER DEFAULT 0
  );

  -- QA Bank: interview question/answer pairs
  CREATE TABLE IF NOT EXISTS qa_bank (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    question        TEXT NOT NULL,
    answer          TEXT,
    category        TEXT CHECK(category IN ('behavioral','technical','cultural','leadership','situational')),
    template_version TEXT DEFAULT 'v1'
  );

  -- Template Metrics view: Phase 6 future-proofing
  -- Aggregates success rates by template_version for Feedback Analyzer
  CREATE VIEW IF NOT EXISTS template_metrics AS
  SELECT
    template_version,
    COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')) AS total_applied,
    COUNT(*) FILTER (WHERE status = 'INTERVIEW') AS interviews,
    COUNT(*) FILTER (WHERE status = 'OFFER') AS offers,
    COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejections,
    ROUND(
      CAST(COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) AS REAL) /
      NULLIF(COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')), 0) * 100,
      1
    ) AS conversion_rate
  FROM jobs
  GROUP BY template_version;

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_template_version ON jobs(template_version);
  CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp);
  CREATE INDEX IF NOT EXISTS idx_qa_bank_category ON qa_bank(category);
`);

// ─── Seed Data ───────────────────────────────────────────────────────

const insertJob = db.prepare(`
  INSERT INTO jobs (company, title, description, status, score, source, url, notes, template_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAgent = db.prepare(`
  INSERT INTO agents (name, type, status, last_run, jobs_processed, errors)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertQA = db.prepare(`
  INSERT INTO qa_bank (question, answer, category, template_version)
  VALUES (?, ?, ?, ?)
`);

const insertError = db.prepare(`
  INSERT INTO errors (job_id, agent_id, error_message, resolved)
  VALUES (?, ?, ?, ?)
`);

const seedAll = db.transaction(() => {
  // Seed jobs
  insertJob.run(
    'Spotify', 'VP of Engineering, Platform',
    'Lead 200+ engineers across platform infrastructure. Drive technical strategy, build engineering culture, and develop senior leaders. Remote-first, LA office available.',
    'SCORED', 92, 'LinkedIn', 'https://spotify.com/careers/vp-eng',
    'Strong culture fit — people-first engineering org', 'v1'
  );
  insertJob.run(
    'Datadog', 'VP Engineering, Observability',
    'Own the observability product line engineering org. Scale from 80 to 150 engineers. Define technical roadmap and develop engineering managers.',
    'NEW', null, 'Recruiter', 'https://datadog.com/careers/vp-eng',
    'Inbound from recruiter — first call scheduled', 'v1'
  );
  insertJob.run(
    'Netflix', 'Director of Engineering, Studio Tech',
    'Lead studio technology engineering. Bridge content production and software engineering. Build tools for global content creation pipeline.',
    'SCORED', 88, 'LinkedIn', 'https://netflix.com/jobs/director-eng',
    'Broadcast background is a differentiator here', 'v1'
  );
  insertJob.run(
    'Stripe', 'VP Engineering, Developer Platform',
    'Lead developer experience and platform engineering. Scale engineering org through hypergrowth. Establish engineering excellence practices.',
    'APPLIED', 85, 'Direct', 'https://stripe.com/jobs/vp-eng',
    'Applied with v1 cover letter — strong P→P→R opening', 'v1'
  );
  insertJob.run(
    'Warner Bros Discovery', 'SVP Engineering, Streaming',
    'Lead Max streaming platform engineering. Transform legacy systems to modern cloud infrastructure. Manage 300+ engineers globally.',
    'INTERVIEW', 90, 'Network', 'https://wbd.com/careers/svp-eng',
    'Second round scheduled — they love the broadcast-to-tech narrative', 'v1'
  );

  // Seed agents
  insertAgent.run('LinkedIn Scraper', 'scraper', 'idle', datetime(), 47, 2);
  insertAgent.run('Job Scorer', 'scorer', 'idle', datetime(), 35, 0);
  insertAgent.run('Cover Letter Generator', 'generator', 'idle', datetime(), 12, 1);

  // Seed QA bank
  insertQA.run(
    'Tell me about a time you built a high-performing engineering culture.',
    'The Ownership Culture story: Post-merger, unified 250 engineers under servant leadership. Introduced 6-point accountability clarity framework, trained leaders to lead with questions. Result: self-organizing teams that deliver without constant oversight.',
    'behavioral', 'v1'
  );
  insertQA.run(
    'How do you develop engineering leaders?',
    'Developing the Developer story: Weekly coaching (not status updates), asked questions instead of giving answers, let them fail safely then reflected together. Result: they now lead their own team and develop others the same way.',
    'leadership', 'v1'
  );
  insertQA.run(
    'How do you handle difficult engineers?',
    'The Complex Mind story: Recognized the behavior came from not feeling heard. Created space for their ideas, gave ownership of a challenging problem, protected from politics. Result: became highest performer, now mentors others.',
    'behavioral', 'v1'
  );

  // Seed an error
  insertError.run(4, 1, 'Rate limited by LinkedIn API — retrying in 60s', 1);
});

function datetime() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

seedAll();

console.log('');
console.log('  ✓ pipeline.db created at:', DB_PATH);
console.log('  ✓ Schema: jobs, agents, errors, qa_bank tables');
console.log('  ✓ View: template_metrics (Phase 6 ready)');
console.log('  ✓ Seed data: 5 jobs, 3 agents, 3 QA pairs, 1 error');
console.log('');
console.log('  Next: npm start → http://localhost:3000');
console.log('');

db.close();
