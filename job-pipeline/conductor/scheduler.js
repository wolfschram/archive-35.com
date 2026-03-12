#!/usr/bin/env node
/**
 * Conductor — Pipeline Orchestrator
 *
 * Central brain: polling loop + cron scheduler + state machine.
 * Single DB writer — all other components POST to the API.
 *
 * Run standalone:  node conductor/scheduler.js
 * Run via pm2:     pm2 start ecosystem.config.js
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const DB_PATH = path.join(__dirname, '..', 'pipeline.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('  ✗ pipeline.db not found. Run: npm run init-db && npm run migrate');
  process.exit(1);
}

// ─── Database Setup ──────────────────────────────────────────────────
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

// ─── Configuration ───────────────────────────────────────────────────
const CONFIG = {
  pollInterval: 5000,           // 5 seconds
  maxDailyGenerations: 999,    // No practical limit
  maxDailyBudget: 999.00,      // No practical limit
  maxMonthlyBudget: 55.00,     // $55/month
  stallThresholdMinutes: 15,
  maxRetries: 3,
  letterRetries: 2,
};

// ─── State Machine ───────────────────────────────────────────────────
// Valid lifecycle transitions for jobs.status
const VALID_TRANSITIONS = {
  'NEW':                  ['SCRAPED', 'SCORED', 'SKIPPED', 'ARCHIVED'],
  'SCRAPED':              ['SCORED', 'SCORING_FAILED', 'SKIPPED', 'ARCHIVED'],
  'SCORED':               ['COVER_LETTER_QUEUED', 'SKIPPED', 'ARCHIVED'],
  'COVER_LETTER_QUEUED':  ['COVER_LETTER_READY', 'GENERATION_FAILED', 'PENDING_APPROVAL'],
  'COVER_LETTER_READY':   ['PENDING_APPROVAL', 'APPROVED'],
  'PENDING_APPROVAL':     ['APPROVED', 'COVER_LETTER_QUEUED', 'SKIPPED'],
  'APPROVED':             ['SUBMITTING', 'SUBMITTED'],
  'SUBMITTING':           ['SUBMITTED', 'SUBMISSION_FAILED'],
  'SUBMITTED':            ['CLOSED'],
  'CLOSED':               ['ARCHIVED'],
  // Error states can retry or be blocked
  'SCORING_FAILED':       ['SCORED', 'SCRAPED', 'ERROR_BLOCKED'],
  'GENERATION_FAILED':    ['COVER_LETTER_QUEUED', 'ERROR_BLOCKED'],
  'SUBMISSION_FAILED':    ['SUBMITTING', 'APPROVED', 'ERROR_BLOCKED'],
  'ERROR_BLOCKED':        ['NEW'],  // Manual reset only
  'ARCHIVED':             [],
  'SKIPPED':              ['NEW'],  // Manual un-skip
};

function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

function transitionJob(jobId, newStatus) {
  const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, error: `Job ${jobId} not found` };
  if (!canTransition(job.status, newStatus)) {
    return { success: false, error: `Invalid transition: ${job.status} → ${newStatus}` };
  }
  db.prepare("UPDATE jobs SET status = ?, date_updated = datetime('now') WHERE id = ?").run(newStatus, jobId);
  log('transition', `Job ${jobId}: ${job.status} → ${newStatus}`);
  return { success: true, from: job.status, to: newStatus };
}

// ─── Logging ─────────────────────────────────────────────────────────
function log(type, msg) {
  const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
  console.log(`  [${ts}] [${type}] ${msg}`);
}

// ─── Circuit Breaker ─────────────────────────────────────────────────
function checkCircuitBreaker() {
  const dailyCount = db.prepare(
    "SELECT COUNT(*) as c FROM cover_letter_versions WHERE date(created_at) = date('now')"
  ).get();
  const dailyCost = db.prepare(
    "SELECT COALESCE(SUM(cost_estimate), 0) as total FROM cover_letter_versions WHERE date(created_at) = date('now')"
  ).get();
  const monthlyCost = db.prepare(
    "SELECT COALESCE(SUM(cost_estimate), 0) as total FROM cover_letter_versions WHERE created_at >= date('now', 'start of month')"
  ).get();

  return {
    dailyGenerations: dailyCount.c,
    dailyCost: dailyCost.total,
    monthlyCost: monthlyCost.total,
    canGenerate: dailyCount.c < CONFIG.maxDailyGenerations && dailyCost.total < CONFIG.maxDailyBudget,
    canSpend: monthlyCost.total < CONFIG.maxMonthlyBudget,
  };
}

// ─── Idempotency ─────────────────────────────────────────────────────
function enqueueTask(taskType, jobId, payload = {}, priority = 0) {
  const idempotencyKey = jobId ? `${jobId}_${taskType}` : null;

  // Check for existing task with same key (any status except completed)
  if (idempotencyKey) {
    const existing = db.prepare(
      "SELECT id, status FROM conductor_queue WHERE idempotency_key = ? AND status IN ('queued', 'processing', 'failed')"
    ).get(idempotencyKey);
    if (existing) {
      // If failed, reset it to queued for retry
      if (existing.status === 'failed') {
        db.prepare("UPDATE conductor_queue SET status = 'queued', error = NULL, retry_count = 0, started_at = NULL WHERE id = ?").run(existing.id);
        log('retry-reset', `Reset failed ${taskType} for job ${jobId} → queued (id: ${existing.id.slice(0, 8)})`);
        return { id: existing.id, reset: true };
      }
      log('idempotent', `Skipped duplicate: ${taskType} for job ${jobId} (existing: ${existing.id})`);
      return { skipped: true, existing_id: existing.id };
    }
  }

  const crypto = require('crypto');
  const id = crypto.randomUUID();
  const isIdempotent = !['submit_email', 'submit_ats'].includes(taskType);

  db.prepare(`
    INSERT INTO conductor_queue (id, job_id, task_type, priority, payload, idempotent, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, jobId, taskType, priority, JSON.stringify(payload), isIdempotent ? 1 : 0, idempotencyKey);

  log('enqueue', `${taskType} for job ${jobId || 'N/A'} (id: ${id.slice(0, 8)})`);
  return { id, enqueued: true };
}

// ─── Task Processor ──────────────────────────────────────────────────
async function processTask(task) {
  log('process', `Starting ${task.task_type} (id: ${task.id.slice(0, 8)}, job: ${task.job_id || 'N/A'})`);

  try {
    switch (task.task_type) {
      case 'score':
        await processScore(task);
        break;
      case 'generate_letter':
        await processGenerateLetter(task);
        break;
      case 'scrape':
        await processScrape(task);
        break;
      case 'check_response':
        await processCheckResponse(task);
        break;
      case 'research_company':
        await processResearchCompany(task);
        break;
      case 'submit_email':
      case 'submit_ats':
        await processSubmit(task);
        break;
      default:
        throw new Error(`Unknown task type: ${task.task_type}`);
    }

    db.prepare(
      "UPDATE conductor_queue SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
    ).run(task.id);
    log('complete', `${task.task_type} (id: ${task.id.slice(0, 8)}) completed`);

  } catch (err) {
    const maxRetries = task.task_type === 'generate_letter' ? CONFIG.letterRetries : CONFIG.maxRetries;

    if (task.retry_count < maxRetries && task.idempotent) {
      // Retry with exponential backoff tracking
      db.prepare(
        "UPDATE conductor_queue SET status = 'queued', retry_count = retry_count + 1, error = ?, started_at = NULL WHERE id = ?"
      ).run(err.message, task.id);
      log('retry', `${task.task_type} (id: ${task.id.slice(0, 8)}) retry ${task.retry_count + 1}/${maxRetries}: ${err.message}`);
    } else {
      // Mark failed
      db.prepare(
        "UPDATE conductor_queue SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?"
      ).run(err.message, task.id);
      log('failed', `${task.task_type} (id: ${task.id.slice(0, 8)}) FAILED: ${err.message}`);

      // Update job to error state
      if (task.job_id) {
        const errorStatus = {
          'score': 'SCORING_FAILED',
          'generate_letter': 'GENERATION_FAILED',
          'submit_email': 'SUBMISSION_FAILED',
          'submit_ats': 'SUBMISSION_FAILED',
        }[task.task_type];
        if (errorStatus) {
          try { transitionJob(task.job_id, errorStatus); } catch {}
        }
      }

      // Log to errors table
      db.prepare(
        "INSERT INTO errors (job_id, error_message) VALUES (?, ?)"
      ).run(task.job_id, `[conductor:${task.task_type}] ${err.message}`);
    }
  }
}

// ─── Task Handlers ───────────────────────────────────────────────────

async function processScore(task) {
  // Score task: Use inline keyword scoring (no external API needed)
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(task.job_id);
  if (!job) throw new Error(`Job ${task.job_id} not found`);

  // Inline keyword scoring (same logic as job-scorer.js but doesn't require better-sqlite3)
  const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const keywords = {
    leadership: { weight: 25, terms: ['servant leader','people development','coaching','mentoring','empowerment','build culture','team builder','org design','organizational','develop leaders','growth mindset','psychological safety','inclusive','ownership culture'] },
    seniority: { weight: 20, terms: ['vp','vice president','svp','senior vice','director','head of','cto','coo','c-suite','chief','executive'] },
    industry: { weight: 15, terms: ['broadcast','media','streaming','video','audio','smpte','2110','content','entertainment','ott','live production','post-production'] },
    culture: { weight: 15, terms: ['ownership','autonomy','trust','transparency','psychological safety','innovation','remote','flexible','distributed','empowerment'] },
    transformation: { weight: 10, terms: ['post-merger','scale','hypergrowth','modernize','turnaround','digital transformation','restructure','integration','change management'] },
    scope: { weight: 10, terms: ['100+','150+','200+','engineers','global','multi-site','cross-functional','large team','enterprise'] },
    location: { weight: 5, terms: ['los angeles','la','california','remote','hybrid','west coast','pacific'] },
  };

  let totalScore = 0;
  const breakdown = {};
  for (const [dim, { weight, terms }] of Object.entries(keywords)) {
    const matches = terms.filter(t => text.includes(t));
    const dimScore = Math.min(matches.length / 3, 1.0) * weight;
    totalScore += dimScore;
    breakdown[dim] = { score: Math.round(dimScore), max: weight, matches: matches.length };
  }

  // Red flags
  const redFlags = ['hold accountable','move fast break things','must code daily','10x engineer','rockstar','ninja','micromanage'].filter(f => text.includes(f));
  totalScore -= redFlags.length * 5;

  const score = Math.max(0, Math.min(Math.round((totalScore / 100) * 100), 100));
  const label = score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'SKIP';

  db.prepare('UPDATE jobs SET score = ?, score_reasoning = ?, status = ? WHERE id = ?').run(
    score, JSON.stringify({ breakdown, red_flags: redFlags, label }), 'SCORED', task.job_id
  );
  log('score', `Job ${task.job_id} (${job.company}): score=${score} [${label}] — ${redFlags.length} red flags`);
}

async function processGenerateLetter(task) {
  // Check circuit breaker first
  const breaker = checkCircuitBreaker();
  if (!breaker.canGenerate) {
    // Don't fail — re-queue for tomorrow
    db.prepare(
      "UPDATE conductor_queue SET status = 'queued', error = 'Circuit breaker: daily limit reached', started_at = NULL WHERE id = ?"
    ).run(task.id);
    log('breaker', `Letter generation paused: ${breaker.dailyGenerations}/${CONFIG.maxDailyGenerations} today, $${breaker.dailyCost.toFixed(2)}/$${CONFIG.maxDailyBudget}`);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const { generateCoverLetter } = require('../lib/cover-letter-generator');
  const result = await generateCoverLetter(db, apiKey, task.job_id);

  if (!result.success) {
    throw new Error(result.error || 'Generation failed');
  }

  log('letter', `Job ${task.job_id}: score=${result.score}/10, hallucination=${result.hallucination}, cost=$${result.costs.total_cost.toFixed(4)}`);
}

async function processScrape(task) {
  // Phase 13: Real job search via LinkedIn public API
  const payload = JSON.parse(task.payload || '{}');
  const query = payload.query || 'VP Engineering';
  const location = payload.location || 'Los Angeles, CA';
  log('scrape', `Searching: "${query}" in "${location}"`);

  // Call the server's search endpoint internally
  const http = require('http');
  const postData = JSON.stringify({ query, location, sources: ['linkedin'] });
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/search/run', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid response')); } });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });

  log('scrape', `Found ${result.results?.length || 0} jobs, ${result.duplicates_filtered || 0} dupes filtered`);
}

async function processCheckResponse(task) {
  // Phase 11: Check Gmail for job responses via server's email scan endpoint
  const http = require('http');
  const postData = JSON.stringify({ days_back: 1 }); // check last 24 hours
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/email/scan', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: 'parse_failed' }); } });
    });
    req.on('error', (err) => {
      log('gmail', `Gmail check failed: ${err.message} (Gmail may not be configured)`);
      resolve({ error: err.message }); // Don't throw — Gmail being unconfigured shouldn't crash conductor
    });
    req.setTimeout(30000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(postData);
    req.end();
  });

  if (result.error) {
    log('gmail', `Gmail check skipped: ${result.error}`);
  } else {
    log('gmail', `Gmail scan: ${result.total_found || 0} found, ${result.new_emails || 0} new, ${result.matched || 0} matched`);
  }
}

async function processSubmit(task) {
  // Phase 10: Submit via Application Bot (Playwright CDP)
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(task.job_id);
  if (!job) throw new Error(`Job ${task.job_id} not found`);

  // Prefer direct application URL > careers page > listing URL
  const submitUrl = job.url_direct || job.careers_url || job.url;
  if (!submitUrl) throw new Error(`Job ${task.job_id} has no URL for ATS submission`);
  // Override job.url with best URL for the bot
  job.url = submitUrl;
  log('submit', `Using URL: ${submitUrl} (source: ${job.url_direct ? 'direct_ats' : job.careers_url ? 'careers_page' : 'listing'})`);

  // Check if Playwright is available
  let bot;
  try {
    bot = require('./application-bot');
  } catch (e) {
    throw new Error(`Application Bot not available: ${e.message}. Install playwright-core: npm install playwright-core`);
  }

  // Check CDP connection
  const status = bot.getStatus ? bot.getStatus() : { connected: false };
  if (!status.connected) {
    log('submit', `ATS Bot not connected to Chrome CDP. Start Chrome with --remote-debugging-port=9222`);
    throw new Error('Chrome CDP not connected. Start Chrome with --remote-debugging-port=9222 and connect via dashboard ATS tab.');
  }

  // Get cover letter
  const letter = db.prepare(
    'SELECT content FROM cover_letter_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1'
  ).get(task.job_id);

  // Get personal info
  const personalRows = db.prepare('SELECT key, value FROM personal_info').all();
  const personalInfo = {};
  personalRows.forEach(r => { personalInfo[r.key] = r.value; });

  log('submit', `Submitting job ${task.job_id}: ${job.company} — ${job.title}`);

  // Non-idempotent: save checkpoint for resume
  const checkpoint = task.checkpoint ? JSON.parse(task.checkpoint) : null;

  const result = await bot.submitJob({
    job,
    personalInfo,
    coverLetter: letter?.content || '',
    checkpoint,
  });

  if (result.paused_for_review) {
    log('submit', `Job ${task.job_id}: Paused for Wolf's review (form filled, not submitted)`);
    return; // Don't mark as completed — Wolf needs to confirm
  }

  if (result.success) {
    // Record submission
    db.prepare(
      "INSERT INTO application_submissions (job_id, method, platform, submitted_at) VALUES (?, 'ats_portal', ?, datetime('now'))"
    ).run(task.job_id, result.platform || 'generic');
    transitionJob(task.job_id, 'SUBMITTED');
    log('submit', `Job ${task.job_id}: Submitted via ${result.platform || 'generic'}`);
  }
}

async function processResearchCompany(task) {
  // Auto-enrich: fetch company website, find careers page URL
  const http = require('http');
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3000, path: `/api/research/auto/${task.job_id}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 2 }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid response')); } });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write('{}');
    req.end();
  });

  if (result.error) throw new Error(result.error);
  log('research', `Job ${task.job_id} (${result.company}): careers=${result.careers_url || 'not found'}`);
}

// ─── Auto-Queue Logic ────────────────────────────────────────────────
// Runs on each poll cycle to check for jobs that need actions

function autoQueueJobs() {
  // Queue scoring for NEW/SCRAPED jobs without scores
  const unscored = db.prepare(
    "SELECT id FROM jobs WHERE status IN ('NEW', 'SCRAPED') AND score IS NULL"
  ).all();
  for (const job of unscored) {
    enqueueTask('score', job.id, {}, 5);
  }

  // Queue company research for SCORED jobs that don't have research yet
  const unresearched = db.prepare(`
    SELECT j.id FROM jobs j
    LEFT JOIN company_research cr ON cr.job_id = j.id
    WHERE j.status = 'SCORED' AND j.score >= 50 AND cr.job_id IS NULL
  `).all();
  for (const job of unresearched) {
    enqueueTask('research_company', job.id, {}, 3);
  }

  // Queue letter generation for SCORED jobs with high scores
  const breaker = checkCircuitBreaker();
  if (breaker.canGenerate) {
    const scored = db.prepare(
      "SELECT id, score FROM jobs WHERE status = 'SCORED' AND score >= 70"
    ).all();
    for (const job of scored) {
      const hasLetter = db.prepare(
        "SELECT 1 FROM cover_letter_versions WHERE job_id = ?"
      ).get(job.id);
      if (!hasLetter) {
        transitionJob(job.id, 'COVER_LETTER_QUEUED');
        enqueueTask('generate_letter', job.id, {}, job.score >= 85 ? 10 : 5);
      }
    }
  }
}

// ─── Stall Detection ─────────────────────────────────────────────────

function detectStalls() {
  const stalled = db.prepare(`
    SELECT id, job_id, task_type, started_at
    FROM conductor_queue
    WHERE status = 'processing'
      AND julianday('now') - julianday(started_at) > ?
  `).all(CONFIG.stallThresholdMinutes / 1440.0);

  for (const task of stalled) {
    log('stall', `STALLED: ${task.task_type} (id: ${task.id.slice(0, 8)}) started ${task.started_at}`);
    // Reset to queued for retry
    db.prepare(
      "UPDATE conductor_queue SET status = 'queued', error = 'Stall detected — auto-reset', retry_count = retry_count + 1, started_at = NULL WHERE id = ?"
    ).run(task.id);
    db.prepare(
      "INSERT INTO errors (job_id, error_message) VALUES (?, ?)"
    ).run(task.job_id, `[conductor:stall] Task ${task.task_type} stalled after ${CONFIG.stallThresholdMinutes}min`);
  }

  return stalled.length;
}

// ─── Queue Health ────────────────────────────────────────────────────

function getQueueHealth() {
  const queued = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE status = 'queued'").get().c;
  const processing = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE status = 'processing'").get().c;
  const failed = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE status = 'failed'").get().c;
  const completed = db.prepare("SELECT COUNT(*) as c FROM conductor_queue WHERE status = 'completed' AND date(completed_at) = date('now')").get().c;
  const breaker = checkCircuitBreaker();

  return {
    queued, processing, failed, completedToday: completed,
    ...breaker,
    status: processing > 0 ? 'running' : queued > 0 ? 'pending' : 'idle',
  };
}

// ─── Polling Loop ────────────────────────────────────────────────────

let isProcessing = false;

async function pollOnce() {
  if (isProcessing) return; // Prevent concurrent processing

  try {
    // Stall detection
    detectStalls();

    // Pick next task (BEGIN EXCLUSIVE for single-writer safety)
    db.exec('BEGIN EXCLUSIVE');
    const task = db.prepare(`
      SELECT * FROM conductor_queue
      WHERE status = 'queued'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get();

    if (task) {
      db.prepare(
        "UPDATE conductor_queue SET status = 'processing', started_at = datetime('now') WHERE id = ?"
      ).run(task.id);
      db.exec('COMMIT');

      isProcessing = true;
      await processTask(task);
      isProcessing = false;
    } else {
      db.exec('COMMIT');
    }
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    isProcessing = false;
    log('error', `Poll error: ${err.message}`);
  }
}

// ─── Cron Scheduler (simplified — no node-cron dependency) ───────────

function setupScheduler() {
  const now = new Date();
  const minuteMs = 60000;

  // Every 5 seconds: poll for tasks
  setInterval(pollOnce, CONFIG.pollInterval);

  // Every 60 seconds: auto-queue jobs + health check
  setInterval(() => {
    autoQueueJobs();
    const health = getQueueHealth();
    if (health.failed > 0) {
      log('health', `Queue: ${health.queued} queued, ${health.processing} processing, ${health.failed} failed, ${health.completedToday} done today`);
    }
  }, 60000);

  // Every 15 minutes: check for Gmail responses
  setInterval(() => {
    enqueueTask('check_response', null, {}, 1);
  }, 15 * minuteMs);

  // Schedule daily tasks based on time
  scheduleDailyTask(7, 0, () => {
    log('cron', 'Daily digest trigger (7:00 AM)');
    // Will trigger digest email in Phase 11
  });

  scheduleDailyTask(0, 0, () => {
    log('cron', 'Daily reset (midnight) — circuit breaker resets');
    // Circuit breaker auto-resets via date-based queries
  });

  // Weekly: Sunday 8am feedback report
  scheduleWeeklyTask(0, 8, 0, () => {
    log('cron', 'Weekly feedback report trigger (Sunday 8:00 AM)');
    // Will trigger in Phase 11
  });
}

function scheduleDailyTask(hour, minute, fn) {
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    setTimeout(() => { fn(); scheduleNext(); }, delay);
  }
  scheduleNext();
}

function scheduleWeeklyTask(dayOfWeek, hour, minute, fn) {
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    const daysUntil = (dayOfWeek - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + daysUntil);
    if (next <= now) next.setDate(next.getDate() + 7);
    const delay = next - now;
    setTimeout(() => { fn(); scheduleNext(); }, delay);
  }
  scheduleNext();
}

// ─── Fingerprint Dedup ───────────────────────────────────────────────

function checkDuplicate(company, title, location) {
  const fingerprint = [company, title, location || '']
    .map(s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ')).join('|');

  const dupe = db.prepare(
    "SELECT id, company, title FROM jobs WHERE job_fingerprint = ? AND julianday('now') - julianday(date_added) < 90"
  ).get(fingerprint);

  return dupe ? { isDuplicate: true, existing: dupe, fingerprint } : { isDuplicate: false, fingerprint };
}

// ─── Start ───────────────────────────────────────────────────────────

function start() {
  console.log('');
  console.log('  ✓ Conductor starting...');

  const health = getQueueHealth();
  console.log(`  ✓ Queue: ${health.queued} queued, ${health.processing} processing, ${health.failed} failed`);
  console.log(`  ✓ Circuit breaker: ${health.dailyGenerations}/${CONFIG.maxDailyGenerations} letters today, $${health.dailyCost.toFixed(2)}/$${CONFIG.maxDailyBudget}`);
  console.log(`  ✓ Polling every ${CONFIG.pollInterval / 1000}s`);
  console.log('');

  setupScheduler();
  // Run first poll immediately
  pollOnce();
}

// Export for testing and integration
module.exports = {
  start, pollOnce, enqueueTask, transitionJob, canTransition,
  checkCircuitBreaker, getQueueHealth, detectStalls, checkDuplicate, autoQueueJobs,
  CONFIG, VALID_TRANSITIONS,
};

// If run directly, start the conductor
if (require.main === module) {
  start();
}
