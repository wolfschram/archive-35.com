/**
 * Application Bot — Playwright CDP-based ATS Form Filler
 *
 * Connects to a running Chrome/Brave via CDP (port 9222).
 * Pull-based: Wolf clicks "Start ATS Submissions" on dashboard.
 * Checkpoints after each page for crash recovery.
 *
 * Requires: Playwright installed (`npm i playwright` or system Playwright)
 */

const path = require('path');
const fs = require('fs');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';

// ─── CDP Connection ──────────────────────────────────────────────────

let browser = null;
let connectionStatus = 'disconnected';

async function connect() {
  try {
    // Try to load playwright dynamically
    let playwright;
    try {
      playwright = require('playwright');
    } catch {
      try {
        playwright = require('playwright-core');
      } catch {
        connectionStatus = 'not_installed';
        return { success: false, error: 'Playwright not installed. Run: npm install playwright-core' };
      }
    }

    browser = await playwright.chromium.connectOverCDP(CDP_ENDPOINT);
    connectionStatus = 'connected';

    const contexts = browser.contexts();
    const pages = contexts.length > 0 ? contexts[0].pages() : [];

    return {
      success: true,
      contexts: contexts.length,
      pages: pages.length,
      browserName: 'Chromium (CDP)',
    };
  } catch (err) {
    connectionStatus = 'error';
    return {
      success: false,
      error: err.message,
      hint: 'Start Chrome with: chrome --remote-debugging-port=9222',
    };
  }
}

async function disconnect() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }
  connectionStatus = 'disconnected';
}

function getStatus() {
  return {
    connected: connectionStatus === 'connected',
    status: connectionStatus,
    cdp_endpoint: CDP_ENDPOINT,
  };
}

// ─── Platform Detection ──────────────────────────────────────────────

const adapters = {};

function registerAdapter(name, adapter) {
  adapters[name] = adapter;
}

async function detectPlatform(page) {
  const url = page.url();

  for (const [name, adapter] of Object.entries(adapters)) {
    if (adapter.detectPlatform && await adapter.detectPlatform(page, url)) {
      return { platform: name, adapter };
    }
  }

  return { platform: 'generic', adapter: adapters.generic };
}

// ─── Form Filling Engine ─────────────────────────────────────────────

async function fillForm(page, job, personalInfo, coverLetter, adapter) {
  const checkpoint = { pages_completed: 0, fields_filled: [], platform: adapter?.name || 'unknown' };

  try {
    // Step 1: Fill standard fields
    const standardFields = {
      name: personalInfo.full_name || 'Wolfgang Schram',
      first_name: (personalInfo.full_name || 'Wolfgang Schram').split(' ')[0],
      last_name: (personalInfo.full_name || 'Wolfgang Schram').split(' ').slice(1).join(' '),
      email: personalInfo.email || 'wolf@archive-35.com',
      phone: personalInfo.phone || '',
      linkedin: personalInfo.linkedin_url || '',
      location: personalInfo.location || 'Los Angeles, CA',
    };

    if (adapter && adapter.fillForm) {
      await adapter.fillForm(page, standardFields, job);
      checkpoint.fields_filled.push('standard_fields');
    } else {
      // Generic form filling
      await genericFillFields(page, standardFields);
      checkpoint.fields_filled.push('standard_fields_generic');
    }

    // Step 2: Upload resume if field exists
    if (adapter && adapter.uploadResume) {
      const resumePath = path.join(__dirname, '..', 'templates', 'resume.pdf');
      if (fs.existsSync(resumePath)) {
        await adapter.uploadResume(page, resumePath);
        checkpoint.fields_filled.push('resume');
      }
    }

    // Step 3: Paste cover letter
    if (coverLetter) {
      if (adapter && adapter.pasteCoverLetter) {
        await adapter.pasteCoverLetter(page, coverLetter);
      } else {
        await genericPasteCoverLetter(page, coverLetter);
      }
      checkpoint.fields_filled.push('cover_letter');
    }

    checkpoint.pages_completed++;
    return { success: true, checkpoint };

  } catch (err) {
    return { success: false, error: err.message, checkpoint };
  }
}

// ─── Generic Fill Helpers ────────────────────────────────────────────

async function genericFillFields(page, fields) {
  const fieldMap = [
    { selectors: ['input[name*="name" i]', 'input[id*="name" i]', 'input[placeholder*="name" i]'], value: fields.name },
    { selectors: ['input[name*="first" i]', 'input[id*="first" i]'], value: fields.first_name },
    { selectors: ['input[name*="last" i]', 'input[id*="last" i]'], value: fields.last_name },
    { selectors: ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]'], value: fields.email },
    { selectors: ['input[type="tel"]', 'input[name*="phone" i]', 'input[id*="phone" i]'], value: fields.phone },
    { selectors: ['input[name*="linkedin" i]', 'input[id*="linkedin" i]', 'input[placeholder*="linkedin" i]'], value: fields.linkedin },
    { selectors: ['input[name*="location" i]', 'input[id*="location" i]', 'input[name*="city" i]'], value: fields.location },
  ];

  for (const field of fieldMap) {
    if (!field.value) continue;
    for (const sel of field.selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.fill(field.value);
          break;
        }
      } catch {}
    }
  }
}

async function genericPasteCoverLetter(page, text) {
  const selectors = [
    'textarea[name*="cover" i]', 'textarea[id*="cover" i]',
    'textarea[name*="letter" i]', 'textarea[placeholder*="cover" i]',
    'div[contenteditable="true"]',
    'textarea:not([name*="note"])',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.fill(text);
        return true;
      }
    } catch {}
  }
  return false;
}

// ─── CAPTCHA Detection ───────────────────────────────────────────────

async function detectCaptcha(page) {
  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="turnstile"]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    'iframe[src*="challenge"]',
  ];

  for (const sel of captchaSelectors) {
    try {
      const el = await page.$(sel);
      if (el) return { detected: true, type: sel.includes('recaptcha') ? 'reCAPTCHA' : sel.includes('hcaptcha') ? 'hCaptcha' : sel.includes('turnstile') ? 'Turnstile' : 'Unknown' };
    } catch {}
  }
  return { detected: false };
}

// ─── Submit Detection ────────────────────────────────────────────────

async function findSubmitButton(page) {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'a:has-text("Submit")',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return el;
    } catch {}
  }
  return null;
}

// ─── Main Submission Flow ────────────────────────────────────────────

/**
 * Process a single job submission.
 * Returns { success, checkpoint, paused_for_review, captcha_detected }
 */
async function submitJob(db, jobId, options = {}) {
  const { dryRun = false, autoSubmit = false } = options;

  if (!browser || connectionStatus !== 'connected') {
    const conn = await connect();
    if (!conn.success) return { success: false, error: conn.error, hint: conn.hint };
  }

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, error: `Job ${jobId} not found` };
  if (!job.url) return { success: false, error: 'Job has no URL' };

  // Dedup check: already submitted to this company+role within 90 days?
  const existing = db.prepare(
    "SELECT id FROM application_submissions WHERE job_id = ? AND julianday('now') - julianday(submitted_at) < 90"
  ).get(jobId);
  if (existing) {
    return { success: false, error: 'Already submitted within 90 days', existing_id: existing.id };
  }

  // Load personal info
  const personalInfo = {};
  try {
    const rows = db.prepare('SELECT key, value FROM personal_info').all();
    for (const r of rows) personalInfo[r.key] = r.value;
  } catch {}

  // Load cover letter
  const letterRow = db.prepare(
    'SELECT content FROM cover_letter_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1'
  ).get(jobId);
  const coverLetter = letterRow?.content || job.cover_letter || '';

  // Check for saved checkpoint (resume from crash)
  const queueItem = db.prepare(
    "SELECT checkpoint FROM conductor_queue WHERE job_id = ? AND task_type IN ('submit_ats', 'submit_email') AND checkpoint IS NOT NULL ORDER BY created_at DESC LIMIT 1"
  ).get(jobId);
  const savedCheckpoint = queueItem?.checkpoint ? JSON.parse(queueItem.checkpoint) : null;

  if (dryRun) {
    return {
      success: true, dryRun: true,
      job: { id: job.id, company: job.company, title: job.title, url: job.url },
      personalInfo: Object.keys(personalInfo),
      hasCoverLetter: !!coverLetter,
      savedCheckpoint,
    };
  }

  // Navigate to job URL
  const context = browser.contexts()[0];
  if (!context) return { success: false, error: 'No browser context available' };

  const page = await context.newPage();
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // Let JS render

    // Detect platform
    const { platform, adapter } = await detectPlatform(page);

    // Check for CAPTCHA
    const captcha = await detectCaptcha(page);
    if (captcha.detected) {
      return {
        success: false,
        paused: true,
        captcha_detected: captcha.type,
        error: `CAPTCHA detected (${captcha.type}). Please solve manually, then retry.`,
        job_id: jobId,
      };
    }

    // Fill form
    const fillResult = await fillForm(page, job, personalInfo, coverLetter, adapter);

    // Save checkpoint
    const checkpointJson = JSON.stringify(fillResult.checkpoint);
    db.prepare(
      "UPDATE conductor_queue SET checkpoint = ? WHERE job_id = ? AND task_type IN ('submit_ats', 'submit_email') AND status = 'processing'"
    ).run(checkpointJson, jobId);

    if (!fillResult.success) {
      return { success: false, error: fillResult.error, checkpoint: fillResult.checkpoint };
    }

    // Find submit button
    const submitBtn = await findSubmitButton(page);
    if (!submitBtn) {
      return {
        success: false,
        paused: true,
        error: 'Submit button not found. Please submit manually.',
        checkpoint: fillResult.checkpoint,
      };
    }

    // Pause before submit (unless autoSubmit is true — which it never should be in v1)
    if (!autoSubmit) {
      return {
        success: true,
        paused_for_review: true,
        message: `Form filled for ${job.company}. Review in browser and click Submit manually.`,
        platform,
        checkpoint: fillResult.checkpoint,
        job_id: jobId,
      };
    }

    // Auto-submit (disabled in v1)
    await submitBtn.click();
    await page.waitForTimeout(3000);

    // Record submission
    db.prepare(
      "INSERT INTO application_submissions (job_id, method, platform, response_type) VALUES (?, 'ats_portal', ?, 'none')"
    ).run(jobId, platform);
    db.prepare("UPDATE jobs SET status = 'SUBMITTED', date_updated = datetime('now') WHERE id = ?").run(jobId);

    return { success: true, submitted: true, platform, job_id: jobId };

  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Don't close page — Wolf may need to review/submit manually
  }
}

/**
 * Process the approved submission queue.
 * Returns array of results.
 */
async function processQueue(db, options = {}) {
  const approved = db.prepare(
    "SELECT id FROM jobs WHERE status = 'APPROVED' AND url IS NOT NULL ORDER BY score DESC"
  ).all();

  if (!approved.length) {
    return { processed: 0, message: 'No approved jobs with URLs in queue' };
  }

  const results = [];
  for (const job of approved) {
    // Transition to SUBMITTING
    db.prepare("UPDATE jobs SET status = 'SUBMITTING', date_updated = datetime('now') WHERE id = ?").run(job.id);

    const result = await submitJob(db, job.id, options);
    results.push({ job_id: job.id, ...result });

    // If paused or errored, stop processing queue (Wolf needs to intervene)
    if (result.paused || result.paused_for_review || !result.success) break;
  }

  return { processed: results.length, results };
}

module.exports = {
  connect, disconnect, getStatus,
  detectPlatform, detectCaptcha, findSubmitButton,
  fillForm, submitJob, processQueue,
  registerAdapter, adapters,
};
