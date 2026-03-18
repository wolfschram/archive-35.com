#!/usr/bin/env node
/**
 * Job Pipeline — v2 Database Migration
 * Additive migration: adds new tables, columns, indexes, and views.
 * Migrates existing data from v1 status values to v2 lifecycle statuses.
 * Safe to run multiple times (idempotent).
 *
 * Run: npm run migrate
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'pipeline.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('\n  ✗ pipeline.db not found. Run: npm run init-db first\n');
  process.exit(1);
}

// Open database — try better-sqlite3 first, fall back to node:sqlite
let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');
} catch {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = OFF');
  // Polyfill .transaction()
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

// Helper: check if a column exists on a table
function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

// Helper: check if a table exists
function hasTable(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!row;
}

// Helper: check if a view exists
function hasView(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name=?").get(name);
  return !!row;
}

// Helper: check if an index exists
function hasIndex(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
  return !!row;
}

console.log('\n  Job Pipeline — v2 Migration');
console.log('  ─────────────────────────────');

const migrate = db.transaction(() => {
  // ─── Step 1: Rebuild jobs table with new status CHECK + new columns ──
  const needsRebuild = !hasColumn('jobs', 'score_reasoning');

  if (needsRebuild) {
    console.log('  → Rebuilding jobs table (new status enum + columns)...');

    // Drop views that reference jobs table BEFORE rebuild
    if (hasView('template_metrics')) db.exec('DROP VIEW template_metrics;');
    if (hasView('job_current_state')) db.exec('DROP VIEW job_current_state;');

    db.exec(`
      CREATE TABLE jobs_v2 (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        company          TEXT NOT NULL,
        title            TEXT NOT NULL,
        description      TEXT,
        status           TEXT NOT NULL DEFAULT 'NEW'
                         CHECK(status IN (
                           'NEW','SCRAPED','SCORED',
                           'COVER_LETTER_QUEUED','COVER_LETTER_READY',
                           'PENDING_APPROVAL','APPROVED','SUBMITTING','SUBMITTED','CLOSED',
                           'SCORING_FAILED','GENERATION_FAILED','SUBMISSION_FAILED','ERROR_BLOCKED',
                           'ARCHIVED','SKIPPED'
                         )),
        score            INTEGER,
        score_reasoning  TEXT,
        source           TEXT,
        url              TEXT,
        cover_letter     TEXT,
        job_fingerprint  TEXT,
        approved_at      TEXT,
        date_added       TEXT NOT NULL DEFAULT (datetime('now')),
        date_updated     TEXT NOT NULL DEFAULT (datetime('now')),
        notes            TEXT,
        template_version TEXT DEFAULT 'v1'
      );
    `);

    db.exec(`
      INSERT INTO jobs_v2 (id, company, title, description, status, score, source, url,
        cover_letter, date_added, date_updated, notes, template_version)
      SELECT id, company, title, description,
        CASE status
          WHEN 'APPLIED' THEN 'SUBMITTED'
          WHEN 'INTERVIEW' THEN 'SUBMITTED'
          WHEN 'REJECTED' THEN 'SUBMITTED'
          WHEN 'OFFER' THEN 'SUBMITTED'
          ELSE status
        END,
        score, source, url, cover_letter, date_added, date_updated, notes, template_version
      FROM jobs;
    `);

    db.exec('DROP TABLE jobs;');
    db.exec('ALTER TABLE jobs_v2 RENAME TO jobs;');
    console.log('  ✓ jobs table rebuilt with v2 status enum + new columns');
  } else {
    console.log('  · jobs table already at v2 (skipping)');
  }

  // ─── Step 2: Create new tables ──────────────────────────────────────

  if (!hasTable('personal_info')) {
    db.exec(`
      CREATE TABLE personal_info (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const insert = db.prepare('INSERT INTO personal_info (key, value) VALUES (?, ?)');
    insert.run('full_name', 'Wolfgang Schram');
    insert.run('email', 'wolf@archive-35.com');
    insert.run('phone', '');
    insert.run('linkedin_url', '');
    insert.run('location', 'Los Angeles, CA');
    insert.run('positioning_statement', "I've spent 25 years building leadership capabilities — from hands-on broadcast engineering in Germany, to designing touring systems for U2 and the Rolling Stones, to leading 250 engineers globally. My product is leadership for leaders.");
    insert.run('resume_summary', '');
    insert.run('target_titles', 'VP Engineering, SVP Engineering, Director of Engineering');
    insert.run('salary_range', '$230K-$350K');
    console.log('  ✓ personal_info table created + seeded');
  } else {
    console.log('  · personal_info table exists (skipping)');
  }

  if (!hasTable('company_research')) {
    db.exec(`
      CREATE TABLE company_research (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        research_notes  TEXT,
        company_summary TEXT,
        culture_notes   TEXT,
        key_people      TEXT,
        recent_news     TEXT,
        research_date   TEXT DEFAULT (datetime('now')),
        UNIQUE(job_id)
      );
    `);
    console.log('  ✓ company_research table created');
  } else {
    console.log('  · company_research table exists (skipping)');
  }

  if (!hasTable('challenges')) {
    db.exec(`
      CREATE TABLE challenges (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id         INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        question       TEXT NOT NULL,
        answer         TEXT,
        category       TEXT CHECK(category IN ('scenario','case_study','technical',
                       'behavioral','portfolio','essay','other')),
        reusable       INTEGER DEFAULT 1,
        source_company TEXT,
        date_added     TEXT DEFAULT (datetime('now')),
        date_updated   TEXT DEFAULT (datetime('now'))
      );
    `);
    console.log('  ✓ challenges table created');
  } else {
    console.log('  · challenges table exists (skipping)');
  }

  if (!hasTable('conductor_queue')) {
    db.exec(`
      CREATE TABLE conductor_queue (
        id              TEXT PRIMARY KEY,
        job_id          INTEGER REFERENCES jobs(id),
        task_type       TEXT NOT NULL CHECK(task_type IN ('score','generate_letter',
                        'submit_email','submit_ats','check_response','scrape')),
        priority        INTEGER DEFAULT 0,
        status          TEXT DEFAULT 'queued' CHECK(status IN ('queued','processing',
                        'completed','failed','blocked')),
        payload         TEXT,
        idempotent      INTEGER DEFAULT 1,
        idempotency_key TEXT,
        checkpoint      TEXT,
        retry_count     INTEGER DEFAULT 0,
        max_retries     INTEGER DEFAULT 3,
        created_at      TEXT DEFAULT (datetime('now')),
        started_at      TEXT,
        completed_at    TEXT,
        error           TEXT,
        UNIQUE(idempotency_key)
      );
    `);
    console.log('  ✓ conductor_queue table created');
  } else {
    console.log('  · conductor_queue table exists (skipping)');
  }

  if (!hasTable('cover_letter_versions')) {
    db.exec(`
      CREATE TABLE cover_letter_versions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        version           INTEGER NOT NULL DEFAULT 1,
        content           TEXT NOT NULL,
        self_score        INTEGER,
        hallucination_check TEXT CHECK(hallucination_check IN ('pass','fail','pending')),
        flagged_claims    TEXT,
        model_used        TEXT,
        prompt_tokens     INTEGER,
        completion_tokens INTEGER,
        cost_estimate     REAL,
        needs_review      INTEGER DEFAULT 0,
        created_at        TEXT DEFAULT (datetime('now')),
        UNIQUE(job_id, version)
      );
    `);
    console.log('  ✓ cover_letter_versions table created');
  } else {
    console.log('  · cover_letter_versions table exists (skipping)');
  }

  if (!hasTable('application_submissions')) {
    db.exec(`
      CREATE TABLE application_submissions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id          INTEGER NOT NULL REFERENCES jobs(id),
        method          TEXT NOT NULL CHECK(method IN ('email','ats_portal',
                        'referral','recruiter','direct')),
        platform        TEXT,
        submitted_at    TEXT DEFAULT (datetime('now')),
        cover_letter_id INTEGER REFERENCES cover_letter_versions(id),
        response_type   TEXT CHECK(response_type IN ('none','rejection','interview',
                        'request_info','offer','ghosted','unknown')),
        response_date   TEXT,
        response_notes  TEXT,
        follow_up_date  TEXT,
        contact_name    TEXT,
        contact_email   TEXT
      );
    `);

    // Migrate v1 outcomes from seed data — use job's date_added as submitted_at
    const oldJobs = db.prepare("SELECT id, notes, date_added FROM jobs WHERE status = 'SUBMITTED'").all();
    if (oldJobs.length > 0) {
      const insertSub = db.prepare(
        "INSERT INTO application_submissions (job_id, method, response_type, response_notes, submitted_at) VALUES (?, 'direct', ?, ?, ?)"
      );
      for (const job of oldJobs) {
        const notes = (job.notes || '').toLowerCase();
        let responseType = 'none';
        if (notes.includes('interview') || notes.includes('second round')) responseType = 'interview';
        else if (notes.includes('rejected')) responseType = 'rejection';
        else if (notes.includes('offer')) responseType = 'offer';

        insertSub.run(job.id, responseType, responseType !== 'none' ? `Migrated from v1` : null, job.date_added || new Date().toISOString());
      }
      console.log(`  ✓ application_submissions table created + ${oldJobs.length} records migrated`);
    } else {
      console.log('  ✓ application_submissions table created');
    }
  } else {
    console.log('  · application_submissions table exists (skipping)');
  }

  if (!hasTable('bridge_events')) {
    db.exec(`
      CREATE TABLE bridge_events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        content_type  TEXT NOT NULL CHECK(content_type IN ('cover_letter','research',
                      'qa_answers','resume_notes','other')),
        job_id        INTEGER REFERENCES jobs(id),
        payload_hash  TEXT NOT NULL,
        payload_size  INTEGER NOT NULL,
        source        TEXT DEFAULT 'dashboard_paste',
        created_at    TEXT DEFAULT (datetime('now'))
      );
    `);
    console.log('  ✓ bridge_events table created');
  } else {
    console.log('  · bridge_events table exists (skipping)');
  }

  if (!hasTable('prompt_registry')) {
    db.exec(`
      CREATE TABLE prompt_registry (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        template      TEXT NOT NULL,
        variables     TEXT,
        version       INTEGER NOT NULL DEFAULT 1,
        model_version TEXT,
        created_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(name, version)
      );
    `);
    console.log('  ✓ prompt_registry table created');
  } else {
    console.log('  · prompt_registry table exists (skipping)');
  }

  // ─── Step 3: Update views ────────────────────────────────────────────

  if (hasView('template_metrics')) db.exec('DROP VIEW template_metrics;');
  db.exec(`
    CREATE VIEW template_metrics AS
    SELECT j.template_version,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status IN ('SUBMITTED','CLOSED')) AS total_submitted,
      COUNT(DISTINCT j.id) FILTER (WHERE s.response_type = 'interview') AS interviews,
      COUNT(DISTINCT j.id) FILTER (WHERE s.response_type = 'offer') AS offers,
      COUNT(DISTINCT j.id) FILTER (WHERE s.response_type = 'rejection') AS rejections,
      ROUND(
        CAST(COUNT(DISTINCT j.id) FILTER (WHERE s.response_type IN ('interview','offer')) AS REAL) /
        NULLIF(COUNT(DISTINCT j.id) FILTER (WHERE j.status IN ('SUBMITTED','CLOSED')), 0) * 100, 1
      ) AS conversion_rate
    FROM jobs j
    LEFT JOIN application_submissions s ON s.job_id = j.id
    GROUP BY j.template_version;
  `);
  console.log('  ✓ template_metrics view updated (v2)');

  if (hasView('job_current_state')) db.exec('DROP VIEW job_current_state;');
  db.exec(`
    CREATE VIEW job_current_state AS
    SELECT
      j.*,
      s.response_type AS current_outcome,
      s.response_date AS outcome_date,
      s.method AS submission_method,
      s.platform AS submission_platform,
      s.submitted_at,
      CASE
        WHEN s.response_type IS NOT NULL AND s.response_type != 'none' THEN s.response_type
        WHEN j.status = 'SUBMITTED' AND s.submitted_at IS NOT NULL
             AND julianday('now') - julianday(s.submitted_at) > 30 THEN 'likely_ghosted'
        ELSE j.status
      END AS effective_status
    FROM jobs j
    LEFT JOIN application_submissions s ON s.job_id = j.id
      AND s.id = (SELECT MAX(id) FROM application_submissions WHERE job_id = j.id);
  `);
  console.log('  ✓ job_current_state view created');

  // ─── Monitored Companies (Phase 13D) ──────────────────────────────────
  if (!hasTable('monitored_companies')) {
    db.exec(`
      CREATE TABLE monitored_companies (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        company      TEXT NOT NULL,
        careers_url  TEXT NOT NULL,
        status       TEXT DEFAULT 'active' CHECK(status IN ('active','paused','error')),
        last_checked TEXT,
        created_at   TEXT DEFAULT (datetime('now'))
      );
    `);
    console.log('  ✓ monitored_companies table created');
  } else {
    console.log('  · monitored_companies table exists (skipping)');
  }

  // ─── Step 4: Create indexes ──────────────────────────────────────────

  const indexes = [
    ['idx_jobs_status', 'jobs(status)'],
    ['idx_jobs_template_version', 'jobs(template_version)'],
    ['idx_jobs_fingerprint', 'jobs(job_fingerprint)'],
    ['idx_errors_timestamp', 'errors(timestamp)'],
    ['idx_qa_bank_category', 'qa_bank(category)'],
    ['idx_challenges_job_id', 'challenges(job_id)'],
    ['idx_challenges_category', 'challenges(category)'],
    ['idx_conductor_queue_status', 'conductor_queue(status)'],
    ['idx_conductor_queue_idempotency', 'conductor_queue(idempotency_key)'],
    ['idx_cover_letter_versions_job_id', 'cover_letter_versions(job_id)'],
    ['idx_submissions_job_id', 'application_submissions(job_id)'],
    ['idx_submissions_cover_letter_id', 'application_submissions(cover_letter_id)'],
    ['idx_bridge_events_job_id', 'bridge_events(job_id)'],
    ['idx_prompt_registry_name', 'prompt_registry(name, version)'],
  ];

  let indexCount = 0;
  for (const [name, target] of indexes) {
    if (!hasIndex(name)) {
      db.exec(`CREATE INDEX ${name} ON ${target};`);
      indexCount++;
    }
  }
  console.log(`  ✓ ${indexCount} new indexes created (${indexes.length - indexCount} already existed)`);
});

// Run migration
try {
  migrate();
  db.exec('PRAGMA foreign_keys = ON');
  console.log('\n  ✓ Migration complete!');

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all();
  console.log(`  ✓ Tables: ${tables.map(t => t.name).join(', ')}`);
  console.log(`  ✓ Views: ${views.map(v => v.name).join(', ')}`);

  const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs').get();
  console.log(`  ✓ Jobs: ${jobCount.c}`);
  console.log('');
} catch (err) {
  console.error('\n  ✗ Migration failed:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  db.close();
}
