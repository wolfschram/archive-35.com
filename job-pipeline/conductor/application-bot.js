/**
 * Application Bot v2 — Playwright CDP-based ATS Automation
 *
 * Real flow:
 *   1. Connect to Wolf's Chrome via CDP (port 9222)
 *   2. Navigate to job listing (BuiltIn, Indeed, LinkedIn, or direct)
 *   3. Find and click the "Apply" button on the listing page
 *   4. Follow redirects to the actual ATS (Greenhouse, Lever, Workday, etc.)
 *   5. Detect which ATS platform loaded
 *   6. Fill form fields (name, email, phone, LinkedIn, location)
 *   7. Upload resume PDF
 *   8. Upload/paste cover letter
 *   9. Pause before submit — Wolf reviews and clicks Submit
 *
 * Requires: playwright-core (`npm i playwright-core`)
 */

const path = require('path');
const fs = require('fs');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';
const packageBuilder = require('../lib/package-builder');

// ─── CDP Connection ──────────────────────────────────────────────────

let browser = null;
let connectionStatus = 'disconnected';

async function getPlaywright() {
  try { return require('playwright'); } catch {}
  try { return require('playwright-core'); } catch {}
  return null;
}

async function connect() {
  try {
    const playwright = await getPlaywright();
    if (!playwright) {
      connectionStatus = 'not_installed';
      return { success: false, error: 'Playwright not installed. Run: npm install playwright-core' };
    }

    browser = await playwright.chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 5000 });
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
      hint: 'Start Chrome/Brave with: --remote-debugging-port=9222',
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
    adapters: Object.keys(adapters),
  };
}

// ─── Adapters (registered by platform_adapters/index.js via server.js) ──

const adapters = {};

function registerAdapter(name, adapter) {
  adapters[name] = adapter;
}

// ─── Platform Detection ──────────────────────────────────────────────

async function detectPlatform(page) {
  const url = page.url();

  // Check specific adapters first (not generic)
  for (const [name, adapter] of Object.entries(adapters)) {
    if (name === 'generic') continue;
    if (adapter.detectPlatform && await adapter.detectPlatform(page, url)) {
      return { platform: name, adapter };
    }
  }

  return { platform: 'generic', adapter: adapters.generic || null };
}

// ─── Listing Page Navigation ─────────────────────────────────────────
// These handle the aggregator sites (BuiltIn, Indeed, LinkedIn)
// that link to the actual company ATS page

async function navigateToApplyPage(page, url) {
  const log = (msg) => console.log(`  [bot] ${msg}`);

  log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000); // Let JS render

  const currentUrl = page.url();

  // ── BuiltIn.com ──
  if (currentUrl.includes('builtin.com')) {
    log('Detected BuiltIn.com listing — looking for Apply button');
    return await handleBuiltIn(page, log);
  }

  // ── Indeed ──
  if (currentUrl.includes('indeed.com')) {
    log('Detected Indeed listing — looking for Apply button');
    return await handleIndeed(page, log);
  }

  // ── LinkedIn ──
  if (currentUrl.includes('linkedin.com')) {
    log('Detected LinkedIn — looking for Apply button');
    return await handleLinkedIn(page, log);
  }

  // ── Direct ATS link — already on the apply page ──
  log('Direct link — checking if already on apply page');
  return { success: true, finalUrl: currentUrl, method: 'direct' };
}

async function handleBuiltIn(page, log) {
  // BuiltIn has an "Apply" button that either:
  // a) Opens an external link to the company's ATS
  // b) Shows an inline apply form
  const applySelectors = [
    'a[data-testid="apply-button"]',
    'a[href*="apply"]',
    'button:has-text("Apply")',
    'a:has-text("Apply Now")',
    'a:has-text("Apply")',
    '[class*="apply"] a',
    '[class*="Apply"] a',
  ];

  for (const sel of applySelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        // Check if it's an external link
        const href = await btn.getAttribute('href').catch(() => null);
        if (href && (href.startsWith('http') && !href.includes('builtin.com'))) {
          log(`Found external apply link: ${href.substring(0, 80)}...`);
          // Navigate to the actual ATS page
          const [newPage] = await Promise.all([
            page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
            btn.click(),
          ]);

          if (newPage) {
            await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            await newPage.waitForTimeout(2000);
            log(`Redirected to: ${newPage.url()}`);
            return { success: true, finalUrl: newPage.url(), page: newPage, method: 'builtin_external' };
          }

          // Might have navigated in same tab
          await page.waitForTimeout(3000);
          if (!page.url().includes('builtin.com')) {
            log(`Navigated to: ${page.url()}`);
            return { success: true, finalUrl: page.url(), method: 'builtin_redirect' };
          }
        }

        // Click and see what happens
        log(`Clicking apply button: ${sel}`);
        await btn.click();
        await page.waitForTimeout(3000);

        // Check if URL changed (redirect to ATS)
        const newUrl = page.url();
        if (!newUrl.includes('builtin.com')) {
          log(`Redirected to: ${newUrl}`);
          return { success: true, finalUrl: newUrl, method: 'builtin_click_redirect' };
        }

        // Check if a new tab opened
        const pages = page.context().pages();
        const newest = pages[pages.length - 1];
        if (newest !== page) {
          await newest.waitForLoadState('domcontentloaded').catch(() => {});
          log(`New tab opened: ${newest.url()}`);
          return { success: true, finalUrl: newest.url(), page: newest, method: 'builtin_new_tab' };
        }

        // Might have opened an inline apply form
        log('Apply button clicked — checking for inline form');
        return { success: true, finalUrl: page.url(), method: 'builtin_inline' };
      }
    } catch (e) {
      log(`  Selector ${sel} failed: ${e.message}`);
    }
  }

  return { success: false, error: 'Could not find Apply button on BuiltIn page', finalUrl: page.url() };
}

async function handleIndeed(page, log) {
  // Indeed "Apply Now" button — either Easy Apply or redirect
  const applySelectors = [
    '#indeedApplyButton',
    'button[id*="apply"]',
    'a[href*="apply"]',
    'button:has-text("Apply now")',
    'button:has-text("Apply on company site")',
    'a:has-text("Apply on company site")',
    '.jobsearch-IndeedApplyButton',
  ];

  for (const sel of applySelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        const text = await btn.textContent().catch(() => '');
        log(`Found Indeed apply button: "${text.trim()}"`);

        // "Apply on company site" = external redirect
        if (text.toLowerCase().includes('company site')) {
          const [newPage] = await Promise.all([
            page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
            btn.click(),
          ]);

          if (newPage) {
            await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            await newPage.waitForTimeout(2000);
            log(`Redirected to company ATS: ${newPage.url()}`);
            return { success: true, finalUrl: newPage.url(), page: newPage, method: 'indeed_external' };
          }

          await page.waitForTimeout(3000);
          if (!page.url().includes('indeed.com')) {
            return { success: true, finalUrl: page.url(), method: 'indeed_redirect' };
          }
        }

        // Click and follow
        await btn.click();
        await page.waitForTimeout(3000);

        const pages = page.context().pages();
        const newest = pages[pages.length - 1];
        if (newest !== page) {
          await newest.waitForLoadState('domcontentloaded').catch(() => {});
          return { success: true, finalUrl: newest.url(), page: newest, method: 'indeed_new_tab' };
        }

        if (!page.url().includes('indeed.com')) {
          return { success: true, finalUrl: page.url(), method: 'indeed_same_tab' };
        }

        // Indeed Easy Apply opens a modal
        log('Checking for Indeed Easy Apply modal');
        const modal = await page.$('#indeed-apply-widget, [class*="ia-"]').catch(() => null);
        if (modal) {
          return { success: true, finalUrl: page.url(), method: 'indeed_easy_apply' };
        }

        return { success: true, finalUrl: page.url(), method: 'indeed_inline' };
      }
    } catch (e) {
      log(`  Selector ${sel} failed: ${e.message}`);
    }
  }

  return { success: false, error: 'Could not find Apply button on Indeed page', finalUrl: page.url() };
}

async function handleLinkedIn(page, log) {
  // LinkedIn Easy Apply or external apply
  const applySelectors = [
    '.jobs-apply-button',
    'button[data-control-name="jobdetails_topcard_inapply"]',
    'button:has-text("Easy Apply")',
    'button:has-text("Apply")',
    'a:has-text("Apply")',
  ];

  // Check if user is logged in
  const loggedIn = await page.$('.global-nav__me').catch(() => null);
  if (!loggedIn) {
    log('WARNING: Not logged into LinkedIn — may not see Apply button');
  }

  for (const sel of applySelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        const text = await btn.textContent().catch(() => '');
        log(`Found LinkedIn apply button: "${text.trim()}"`);

        // Check if it's Easy Apply or external
        if (text.toLowerCase().includes('easy apply')) {
          await btn.click();
          await page.waitForTimeout(2000);
          log('LinkedIn Easy Apply modal opened');
          return { success: true, finalUrl: page.url(), method: 'linkedin_easy_apply' };
        }

        // External apply — opens company site
        const [newPage] = await Promise.all([
          page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
          btn.click(),
        ]);

        if (newPage) {
          await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          await newPage.waitForTimeout(2000);
          log(`Redirected to: ${newPage.url()}`);
          return { success: true, finalUrl: newPage.url(), page: newPage, method: 'linkedin_external' };
        }

        await page.waitForTimeout(3000);
        return { success: true, finalUrl: page.url(), method: 'linkedin_click' };
      }
    } catch (e) {
      log(`  Selector ${sel} failed: ${e.message}`);
    }
  }

  return { success: false, error: 'Could not find Apply button on LinkedIn', finalUrl: page.url() };
}

// ─── Package Helper ─────────────────────────────────────────────────

/**
 * Ensure the application package exists in /ready/[company]/.
 * If not, build it. Returns paths to resume and cover letter files.
 */
async function ensurePackage(db, jobId) {
  let pkg = packageBuilder.getPackagePath(db, jobId);
  if (!pkg) {
    // Build it now
    const result = await packageBuilder.buildPackage(db, jobId);
    if (!result.success) return { resumePath: null, coverLetterPath: null, packagePath: null };
    pkg = { path: result.packagePath, location: 'ready' };
  }

  // Find resume and cover letter in the package
  const files = fs.readdirSync(pkg.path);
  const resumeFile = files.find(f => f.endsWith('.pdf'));
  const clDocx = files.find(f => f === 'cover_letter.docx');
  const clTxt = files.find(f => f === 'cover_letter.txt');
  const clMd = files.find(f => f === 'cover_letter.md');

  return {
    packagePath: pkg.path,
    resumePath: resumeFile ? path.join(pkg.path, resumeFile) : null,
    coverLetterPath: clDocx ? path.join(pkg.path, clDocx) : (clTxt ? path.join(pkg.path, clTxt) : null),
    coverLetterMd: clMd ? path.join(pkg.path, clMd) : null,
  };
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
      if (el) return {
        detected: true,
        type: sel.includes('recaptcha') ? 'reCAPTCHA' :
              sel.includes('hcaptcha') ? 'hCaptcha' :
              sel.includes('turnstile') ? 'Turnstile' : 'Unknown'
      };
    } catch {}
  }
  return { detected: false };
}

// ─── Submit Button Detection ────────────────────────────────────────

async function findSubmitButton(page) {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'button:has-text("Send Application")',
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
 * Submit a single job application.
 *
 * Flow:
 *   1. Navigate to listing page
 *   2. Click Apply → follow to ATS
 *   3. Detect platform (Greenhouse, Lever, Workday, generic)
 *   4. Fill form, upload resume, upload/paste cover letter
 *   5. Pause before submit (Wolf reviews)
 *
 * Returns detailed status at each step.
 */
async function submitJob(db, jobId, options = {}) {
  const { dryRun = false, autoSubmit = false } = options;
  const log = (msg) => console.log(`  [bot:${jobId}] ${msg}`);

  // ── Step 1: Load job data (before CDP — dry run doesn't need Chrome) ──
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, step: 'load', error: `Job ${jobId} not found` };
  if (!job.url) return { success: false, step: 'load', error: 'Job has no URL' };

  log(`Starting: ${job.company} — ${job.title}`);

  // Dedup check
  const existing = db.prepare(
    "SELECT id FROM application_submissions WHERE job_id = ? AND julianday('now') - julianday(submitted_at) < 90"
  ).get(jobId);
  if (existing) {
    return { success: false, step: 'dedup', error: 'Already submitted within 90 days', existing_id: existing.id };
  }

  // Load personal info
  const personalInfo = {};
  try {
    const rows = db.prepare('SELECT key, value FROM personal_info').all();
    for (const r of rows) personalInfo[r.key] = r.value;
  } catch {}

  // Load cover letter text (for pasting into forms)
  const letterRow = db.prepare(
    'SELECT content FROM cover_letter_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1'
  ).get(jobId);
  const coverLetter = letterRow?.content || job.cover_letter || '';

  // Ensure application package exists in /ready/[company]/
  const pkg = await ensurePackage(db, jobId);
  log(`Package: ${pkg.packagePath || 'NONE'}`);
  log(`  Resume: ${pkg.resumePath ? 'found' : 'MISSING'}`);
  log(`  Cover letter file: ${pkg.coverLetterPath ? 'found' : 'MISSING'}`);

  if (dryRun) {
    return {
      success: true, dryRun: true,
      job: { id: job.id, company: job.company, title: job.title, url: job.url },
      personalInfo: Object.keys(personalInfo),
      hasCoverLetter: !!coverLetter,
      hasResume: !!pkg.resumePath,
      packagePath: pkg.packagePath,
      coverLetterFile: pkg.coverLetterPath,
    };
  }

  // ── Step 2: Connect to Chrome via CDP ──
  if (!browser || connectionStatus !== 'connected') {
    const conn = await connect();
    if (!conn.success) return { success: false, step: 'connect', error: conn.error, hint: conn.hint };
  }

  // ── Step 3: Navigate to listing and find Apply ──
  const context = browser.contexts()[0];
  if (!context) return { success: false, step: 'context', error: 'No browser context available' };

  let page = await context.newPage();

  // Update job status to SUBMITTING
  db.prepare("UPDATE jobs SET status = 'SUBMITTING', date_updated = datetime('now') WHERE id = ?").run(jobId);

  try {
    const navResult = await navigateToApplyPage(page, job.url);
    log(`Navigation result: ${JSON.stringify({ success: navResult.success, method: navResult.method, finalUrl: navResult.finalUrl?.substring(0, 80) })}`);

    if (!navResult.success) {
      // Reset status
      db.prepare("UPDATE jobs SET status = 'APPROVED', date_updated = datetime('now') WHERE id = ?").run(jobId);
      return {
        success: false,
        step: 'navigate',
        error: navResult.error,
        url: job.url,
        hint: 'Could not find Apply button on listing page. You may need to apply manually.',
      };
    }

    // Use the page that ended up on the ATS (might be a new tab)
    if (navResult.page) {
      page = navResult.page;
    }

    const finalUrl = page.url();
    log(`On ATS page: ${finalUrl}`);

    // ── Step 3: Detect platform ──
    const { platform, adapter } = await detectPlatform(page);
    log(`Detected platform: ${platform}`);

    // ── Step 4: Check for CAPTCHA ──
    const captcha = await detectCaptcha(page);
    if (captcha.detected) {
      log(`CAPTCHA detected: ${captcha.type}`);
      return {
        success: false,
        step: 'captcha',
        paused: true,
        captcha_detected: captcha.type,
        platform,
        error: `CAPTCHA detected (${captcha.type}). Solve it in the browser, then retry.`,
        job_id: jobId,
      };
    }

    // ── Step 5: Fill form ──
    const fields = {
      name: personalInfo.full_name || 'Wolfgang Schram',
      first_name: (personalInfo.full_name || 'Wolfgang Schram').split(' ')[0],
      last_name: (personalInfo.full_name || 'Wolfgang Schram').split(' ').slice(1).join(' '),
      email: personalInfo.email || 'wolfbroadcast@gmail.com',
      phone: personalInfo.phone || '',
      linkedin: personalInfo.linkedin_url || '',
      location: personalInfo.location || 'Los Angeles, CA',
    };

    const checkpoint = { fields_filled: [], platform, method: navResult.method };

    if (adapter && adapter.fillForm) {
      log('Filling form fields...');
      await adapter.fillForm(page, fields, job);
      checkpoint.fields_filled.push('form_fields');
    }

    // ── Step 6: Upload resume from /ready/[company]/ package ──
    if (pkg.resumePath && adapter && adapter.uploadResume) {
      log(`Uploading resume from: ${pkg.resumePath}`);
      const uploaded = await adapter.uploadResume(page, pkg.resumePath);
      if (uploaded) checkpoint.fields_filled.push('resume');
      else log('Resume upload field not found on page');
    }

    // ── Step 7: Upload/paste cover letter from package ──
    if (pkg.coverLetterPath && adapter && adapter.uploadCoverLetter) {
      log(`Uploading cover letter from: ${pkg.coverLetterPath}`);
      const uploaded = await adapter.uploadCoverLetter(page, pkg.coverLetterPath);
      if (uploaded) checkpoint.fields_filled.push('cover_letter_file');
    }

    if (coverLetter && adapter && adapter.pasteCoverLetter) {
      log('Pasting cover letter text...');
      const pasted = await adapter.pasteCoverLetter(page, coverLetter);
      if (pasted) checkpoint.fields_filled.push('cover_letter_text');
    }

    // ── Step 8: Find submit button ──
    const submitBtn = await findSubmitButton(page);
    log(`Submit button: ${submitBtn ? 'found' : 'not found'}`);

    // ── Step 9: Pause for review ──
    // NEVER auto-submit. Wolf reviews the form and clicks Submit himself.
    log(`✓ Form filled for ${job.company}. Waiting for manual review.`);

    return {
      success: true,
      step: 'ready_for_review',
      paused_for_review: true,
      platform,
      method: navResult.method,
      finalUrl: page.url(),
      checkpoint,
      hasSubmitButton: !!submitBtn,
      message: `Form filled for ${job.company} (${platform}). Review in browser and submit manually.`,
      job_id: jobId,
      company: job.company,
    };

  } catch (err) {
    log(`ERROR: ${err.message}`);
    // Reset to APPROVED so it can be retried
    db.prepare("UPDATE jobs SET status = 'APPROVED', date_updated = datetime('now') WHERE id = ?").run(jobId);
    return { success: false, step: 'error', error: err.message, job_id: jobId };
  }
  // NOTE: Don't close the page — Wolf needs it open to review and submit
}

/**
 * Process all approved jobs in queue.
 * Does them one at a time — pauses after each for Wolf to review.
 */
async function processQueue(db, options = {}) {
  const approved = db.prepare(
    "SELECT id, company, title FROM jobs WHERE status = 'APPROVED' AND url IS NOT NULL ORDER BY score DESC"
  ).all();

  if (!approved.length) {
    return { processed: 0, message: 'No approved jobs with URLs in queue' };
  }

  const results = [];
  for (const job of approved) {
    console.log(`\n[bot] Processing: ${job.company} — ${job.title}`);
    const result = await submitJob(db, job.id, options);
    results.push({ job_id: job.id, company: job.company, ...result });

    // Stop after first one — Wolf needs to review before we continue
    if (result.paused_for_review || result.paused || !result.success) break;
  }

  return { processed: results.length, results };
}

/**
 * Mark a job as submitted (called after Wolf manually submits).
 * Archives the package from /ready/ to /applied/.
 */
function markSubmitted(db, jobId, method = 'ats_portal', platform = 'unknown') {
  db.prepare(
    "INSERT INTO application_submissions (job_id, method, platform, response_type) VALUES (?, ?, ?, 'none')"
  ).run(jobId, method, platform);
  db.prepare("UPDATE jobs SET status = 'SUBMITTED', date_updated = datetime('now') WHERE id = ?").run(jobId);

  // Move package from /ready/ to /applied/
  try {
    packageBuilder.archivePackage(db, jobId);
  } catch (e) {
    console.log(`  [bot] Could not archive package: ${e.message}`);
  }

  return { success: true, job_id: jobId };
}

module.exports = {
  connect, disconnect, getStatus,
  detectPlatform, detectCaptcha, findSubmitButton,
  submitJob, processQueue, markSubmitted,
  navigateToApplyPage,
  registerAdapter, adapters,
};
