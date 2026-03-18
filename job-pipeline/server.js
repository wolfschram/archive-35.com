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
const https = require('https');
const { scrapeJobs, setLoggerLevel } = require('ts-jobspy');
setLoggerLevel('fatal'); // suppress 403 noise from ZipRecruiter/Glassdoor/Bayt/Naukri/BDJobs

// LinkedIn MCP client — provides full job descriptions from LinkedIn
let linkedinMCP = null;
let linkedinAvailable = false;
try {
  linkedinMCP = require('./linkedin-mcp-client');
  // Check availability in background (don't block server start)
  linkedinMCP.checkAvailability().then(ok => {
    linkedinAvailable = ok;
    console.log(ok ? '  ✓ LinkedIn MCP connected — full descriptions available' : '  ⚠ LinkedIn MCP not available — run setup-linkedin-mcp.sh');
  }).catch(() => {
    console.log('  ⚠ LinkedIn MCP not available — run setup-linkedin-mcp.sh');
  });
} catch (e) {
  console.log('  ⚠ LinkedIn MCP client not loaded:', e.message);
}

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'pipeline.db');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// ─── Load Profile Data for Dynamic Scoring ───────────────────────────
// Reads resume.md + capability_profile.md + search_profile.md at startup
let PROFILE_SCORER = null;
let COMPANY_SKIP_LIST = [];

function loadProfileScorer() {
  try {
    const resumePath = path.join(TEMPLATES_DIR, 'resume.md');
    const capPath = path.join(TEMPLATES_DIR, 'capability_profile.md');
    const searchPath = path.join(TEMPLATES_DIR, 'search_profile.md');
    const resumeText = fs.existsSync(resumePath) ? fs.readFileSync(resumePath, 'utf8').toLowerCase() : '';
    const capText = fs.existsSync(capPath) ? fs.readFileSync(capPath, 'utf8').toLowerCase() : '';
    const searchText = fs.existsSync(searchPath) ? fs.readFileSync(searchPath, 'utf8').toLowerCase() : '';

    // Extract target roles from capability profile
    const targetRoles = [];
    const roleSection = capText.match(/## target roles\n([\s\S]*?)(?=\n##|\n$)/);
    if (roleSection) {
      roleSection[1].split('\n').forEach(line => {
        const m = line.match(/^-\s*(.+)/);
        if (m) targetRoles.push(m[1].trim().toLowerCase());
      });
    }

    // Extract target titles from search profile
    const targetTitles = [];
    const titleSection = searchText.match(/## target titles\n([\s\S]*?)(?=\n##)/);
    if (titleSection) {
      titleSection[1].split('\n').forEach(line => {
        const m = line.match(/^-\s*(.+)/);
        if (m) targetTitles.push(m[1].trim().toLowerCase().replace(/\(.*?\)/g, '').trim());
      });
    }

    // Extract company skip list from search profile
    COMPANY_SKIP_LIST = [];
    const skipSection = searchText.match(/## companies to skip\n([\s\S]*?)(?=\n##)/);
    if (skipSection) {
      skipSection[1].split('\n').forEach(line => {
        const m = line.match(/^-\s*(\w[\w\s]*?)(?:\s*\(|$)/);
        if (m) COMPANY_SKIP_LIST.push(m[1].trim().toLowerCase());
      });
    }

    // Build dynamic scoring dimensions — informed by search profile
    PROFILE_SCORER = {
      leadership: {
        weight: 25,
        terms: [
          'servant leader', 'people development', 'coaching', 'mentoring', 'empowerment',
          'build culture', 'team builder', 'org design', 'organizational', 'develop leaders',
          'growth mindset', 'psychological safety', 'inclusive', 'ownership culture',
          'ownership', 'people-first', 'leadership for leaders', 'develop others',
          'self-organizing', 'team development', 'leadership development',
          'people leader', 'engineering leader', 'cross-functional', 'org transformation',
          'culture building', 'ai adoption', 'leading teams',
        ],
      },
      seniority: {
        weight: 25, // increased from 20 — seniority match is critical
        terms: [
          'vp', 'vice president', 'svp', 'senior vice', 'senior director',
          'head of', 'cto', 'coo', 'c-suite', 'chief', 'executive',
          'vp of engineering', 'vp of technology', 'vp of operations',
          'head of engineering', 'vp business transformation',
          ...targetTitles.filter(r => r.length > 3),
          ...targetRoles.filter(r => r.length > 3),
        ],
      },
      industry: {
        weight: 15,
        terms: [
          // Media/entertainment (still relevant but not exclusive)
          'broadcast', 'media', 'streaming', 'entertainment', 'live production',
          // Broader industries from search profile
          'saas', 'platform', 'healthcare', 'health tech', 'fintech',
          'financial services', 'financial technology', 'aerospace', 'defense',
          'logistics', 'supply chain', 'government', 'public sector',
          'retail', 'e-commerce', 'ecommerce', 'manufacturing', 'industry 4.0',
          'edtech', 'education', 'energy', 'cleantech', 'clean energy',
          'enterprise', 'technology', 'infrastructure',
        ],
      },
      culture: {
        weight: 15,
        terms: [
          'ownership', 'autonomy', 'trust', 'transparency', 'psychological safety',
          'innovation', 'remote', 'flexible', 'distributed', 'empowerment',
          'diverse', 'inclusive', 'neurodivergent', 'authentic', 'no ego',
          'remote-first', 'hybrid', 'people-first', 'progressive',
        ],
      },
      transformation: {
        weight: 10,
        terms: [
          'post-merger', 'scale', 'hypergrowth', 'modernize', 'turnaround',
          'digital transformation', 'restructure', 'integration', 'change management',
          'transformation', 'merger', 'acquisition', 'consolidation',
          'rapid growth', 'technology transition', 'ai transformation',
          'ai adoption', 'organizational change',
        ],
      },
      scope: {
        weight: 5, // reduced — most VP roles have adequate scope
        terms: [
          '50+', '100+', '150+', '200+', '250+', '500+', 'engineers', 'global',
          'multi-site', 'cross-functional', 'large team', 'enterprise',
          'multi-geography', 'international',
        ],
      },
      location: {
        weight: 5,
        terms: [
          'los angeles', 'la', 'california', 'remote', 'hybrid', 'west coast',
          'pacific', 'santa clarita', 'burbank', 'hollywood', 'culver city',
        ],
      },
    };

    // Red flags — harder penalties for things that are clearly not a fit
    PROFILE_SCORER.redFlags = [
      // Wrong level
      'junior', 'entry level', 'intern', 'associate', '0-2 years', '1-3 years',
      '2-4 years', '3-5 years',
      // Wrong type — IC/hands-on coding roles
      'must code daily', 'hands-on coding required', 'individual contributor',
      'software engineer', 'senior engineer', 'staff engineer',
      // Wrong culture
      'rockstar', 'ninja', '10x engineer', 'move fast break things',
      'micromanage', 'hold accountable',
      // Relocation required
      'relocation required', 'must relocate', 'on-site only',
    ];

    // Title-based instant disqualifiers (if title contains these, score = 0)
    PROFILE_SCORER.titleDisqualifiers = [
      'intern', 'coordinator', 'associate', 'specialist', 'analyst',
      'junior', 'entry', 'technician', 'assistant', 'clerk',
      'recruiter', 'sales rep', 'account executive', 'customer service',
    ];

    console.log(`  ✓ Profile scorer loaded (${targetTitles.length} target titles, ${COMPANY_SKIP_LIST.length} skip companies, 7 dimensions)`);
    return PROFILE_SCORER;
  } catch (e) {
    console.error('  ⚠ Could not load profile scorer:', e.message);
    return null;
  }
}
loadProfileScorer();

// ─── Real Job Search Scrapers ────────────────────────────────────────

/** Fetch HTML from a URL, returns string */
function fetchHTML(url, userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36') {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': userAgent } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHTML(res.headers.location, userAgent).then(resolve, reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/** Search jobs via ts-jobspy (LinkedIn + Indeed + more, maintained npm package) */
async function searchJobsSpy(query, location, sources = ['indeed', 'linkedin'], count = 15) {
  // Split comma-separated queries for better results (LinkedIn handles commas poorly)
  const queries = query.includes(',')
    ? query.split(',').map(q => q.trim()).filter(q => q.length > 2)
    : [query];

  const allJobs = [];
  // Request at least 10 results per query — don't starve individual titles
  const perQuery = Math.max(10, Math.ceil(count / Math.min(queries.length, 4)));

  for (const q of queries) {
    try {
      console.log(`[ts-jobspy] Searching "${q}" (${perQuery} wanted from ${sources.join(',')})`);
      const jobs = await scrapeJobs({
        siteType: sources.filter(s => ['indeed', 'linkedin'].includes(s)),
        searchTerm: q,
        location: location || 'United States',
        resultsWanted: perQuery,
        countryIndeed: 'USA',
      });
      console.log(`[ts-jobspy] "${q}": ${jobs.length} results`);
      allJobs.push(...jobs);
    } catch (e) {
      console.error(`[ts-jobspy] "${q}" FAILED:`, e.message);
    }
  }

  // Normalize to our schema
  return allJobs.map(j => ({
    title: j.title || 'Unknown',
    company: j.company || 'Unknown',
    description: (j.description || '').substring(0, 5000),
    url: j.jobUrl || '',
    url_direct: j.jobUrlDirect || '',    // actual company ATS application URL
    company_url: j.companyUrl || '',      // company website
    location: j.location || '',
    source: j.site || 'unknown',
    posted: j.datePosted || '',
    salary_min: j.minAmount || null,
    salary_max: j.maxAmount || null,
    is_remote: j.isRemote || false,
    company_industry: j.companyIndustry || '',
    company_description: (j.companyDescription || '').substring(0, 1000),
  }));
}

// ─── Helpers ────────────────────────────────────────────────────────
/** Escape special SQL LIKE characters (%, _) in user input */
function escapeLike(str) {
  return str.replace(/[%_]/g, ch => '\\' + ch);
}

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

// Add transaction helper if not present (node:sqlite compat)
if (!db.transaction) {
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

// ─── Initialize Deleted Fingerprints Table ─────────────────────────
// Create table if it doesn't exist (idempotent)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_fingerprints (
      fingerprint TEXT PRIMARY KEY,
      company TEXT,
      title TEXT,
      deleted_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deleted_fingerprints_deleted_at ON deleted_fingerprints(deleted_at);
  `);
} catch (err) {
  console.warn('⚠ Could not create deleted_fingerprints table:', err.message);
}

// ─── Migrate: Add company_url, url_direct, careers_url to jobs ──────
try { db.exec("ALTER TABLE jobs ADD COLUMN company_url TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN url_direct TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE jobs ADD COLUMN careers_url TEXT"); } catch(e) {}

// ─── Migrate: conductor_queue CHECK constraint to include research_company ──
try {
  // Test if research_company is allowed
  const testId = 'migration_test_' + Date.now();
  db.prepare("INSERT INTO conductor_queue (id, job_id, task_type, status) VALUES (?, 1, 'research_company', 'completed')").run(testId);
  db.prepare("DELETE FROM conductor_queue WHERE id = ?").run(testId);
} catch (e) {
  if (e.message && e.message.includes('CHECK')) {
    console.log('  ⟳ Migrating conductor_queue CHECK constraint...');
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`CREATE TABLE conductor_queue_new (
        id TEXT PRIMARY KEY, job_id INTEGER REFERENCES jobs(id),
        task_type TEXT NOT NULL CHECK(task_type IN ('score','generate_letter','submit_email','submit_ats','check_response','scrape','research_company')),
        priority INTEGER DEFAULT 0,
        status TEXT DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed','blocked')),
        payload TEXT, idempotent INTEGER DEFAULT 1, idempotency_key TEXT, checkpoint TEXT,
        retry_count INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 3,
        created_at TEXT DEFAULT (datetime('now')), started_at TEXT, completed_at TEXT, error TEXT,
        UNIQUE(idempotency_key)
      )`);
      db.exec('INSERT INTO conductor_queue_new SELECT * FROM conductor_queue');
      db.exec('DROP TABLE conductor_queue');
      db.exec('ALTER TABLE conductor_queue_new RENAME TO conductor_queue');
      db.exec('PRAGMA foreign_keys = ON');
      console.log('  ✓ conductor_queue migrated');
    } catch (me) { console.warn('⚠ conductor_queue migration failed:', me.message); }
  }
}

// ─── Migrate: AI search tasks table ─────────────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_search_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      location TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed')),
      results_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      error TEXT
    )
  `);
} catch(e) { console.warn('⚠ ai_search_tasks:', e.message); }

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
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { if (!res.writableEnded) res.end(); });
  stream.pipe(res);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 102400) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)); }
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

  if (query.limit) {
    const limit = parseInt(query.limit, 10);
    if (limit > 0) { sql += ' LIMIT ?'; params.push(limit); }
  }

  json(res, db.prepare(sql).all(...params));
});

// ─── GET /api/jobs/:id ──────────────────────────────────────────────
addRoute('GET', '/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM job_current_state WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!job) return json(res, { error: 'Job not found' }, 404);
  json(res, job);
});

// ─── POST /api/jobs ─────────────────────────────────────────────────
addRoute('POST', '/api/jobs', async (req, res) => {
  const { company, title, description, status, score, source, url, notes, template_version, location } = req.body;
  if (!company || !title) return json(res, { error: 'company and title are required' }, 400);

  const validStatuses = ['NEW','SCRAPED','SCORED','COVER_LETTER_QUEUED','COVER_LETTER_READY',
    'PENDING_APPROVAL','APPROVED','SUBMITTING','SUBMITTED','CLOSED',
    'SCORING_FAILED','GENERATION_FAILED','SUBMISSION_FAILED','ERROR_BLOCKED','ARCHIVED','SKIPPED'];
  if (status && !validStatuses.includes(status)) return json(res, { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400);
  if (score !== undefined && score !== null && (typeof score !== 'number' || score < 0 || score > 100)) return json(res, { error: 'score must be a number between 0 and 100' }, 400);

  const fingerprint = [company, title, location || '']
    .map(s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ')).join('|');

  // Check if this job was previously deleted
  const deleted = db.prepare('SELECT deleted_at FROM deleted_fingerprints WHERE fingerprint = ?').get(fingerprint);
  if (deleted) return json(res, { error: 'This job was previously deleted and cannot be re-added (dedup protection)', deleted_at: deleted.deleted_at }, 409);

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
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!existing) return json(res, { error: 'Job not found' }, 404);

  const fields = ['company', 'title', 'description', 'status', 'score', 'score_reasoning',
                   'source', 'url', 'cover_letter', 'notes', 'template_version', 'approved_at'];
  const updates = [], values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return json(res, { error: 'No fields to update' }, 400);

  updates.push("date_updated = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Auto-build application package when status changes to APPROVED
  if (req.body.status === 'APPROVED') {
    try {
      const pkgResult = await packageBuilder.buildPackage(db, id);
      if (pkgResult.success) {
        console.log(`  [package] Auto-built for job #${id}: ${pkgResult.packagePath}`);
      }
    } catch (e) {
      console.log(`  [package] Failed to build for job #${id}: ${e.message}`);
    }
  }

  json(res, db.prepare('SELECT * FROM job_current_state WHERE id = ?').get(id));
});

// ─── DELETE /api/jobs/:id ───────────────────────────────────────────
addRoute('DELETE', '/api/jobs/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const job = db.prepare('SELECT company, title, job_fingerprint FROM jobs WHERE id = ?').get(id);
  if (!job) return json(res, { error: 'Job not found' }, 404);

  // Use existing fingerprint if available, otherwise compute it from company+title (no location)
  const fingerprint = job.job_fingerprint || [job.company, job.title, '']
    .map(s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ')).join('|');

  try {
    // Use transaction for atomicity
    const deleteJob = db.transaction(() => {
      // Store fingerprint in deleted_fingerprints table
      db.prepare(`
        INSERT INTO deleted_fingerprints (fingerprint, company, title, deleted_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(fingerprint, job.company, job.title);

      // Delete ALL related records first (FK constraints may not have CASCADE)
      const relatedTables = [
        { table: 'cover_letter_versions', col: 'job_id' },
        { table: 'company_research', col: 'job_id' },
        { table: 'application_submissions', col: 'job_id' },
        { table: 'conductor_queue', col: 'job_id' },
        { table: 'email_messages', col: 'matched_job_id' },
        { table: 'errors', col: 'job_id' },
        { table: 'bridge_events', col: 'job_id' },
      ];
      for (const { table, col } of relatedTables) {
        try { db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(id); } catch {}
      }
      // Now delete the job itself
      db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    });

    deleteJob();
    json(res, { success: true, fingerprint, deleted_at: new Date().toISOString() }, 200);
  } catch (err) {
    json(res, { error: `Deletion failed: ${err.message}` }, 500);
  }
});

// ─── GET /api/agents ────────────────────────────────────────────────
addRoute('GET', '/api/agents', (req, res) => {
  json(res, db.prepare('SELECT * FROM agents ORDER BY name').all());
});

// ─── GET /api/errors ────────────────────────────────────────────────
addRoute('GET', '/api/errors', (req, res, query) => {
  const limit = Math.min(parseInt(query.limit, 10) || 50, 200);
  const offset = parseInt(query.offset, 10) || 0;
  json(res, db.prepare(`
    SELECT e.*, j.company, j.title, a.name as agent_name
    FROM errors e LEFT JOIN jobs j ON e.job_id = j.id
    LEFT JOIN agents a ON e.agent_id = a.id
    ORDER BY e.timestamp DESC LIMIT ? OFFSET ?
  `).all(limit, offset));
});

// ─── GET /api/template-metrics ──────────────────────────────────────
addRoute('GET', '/api/template-metrics', (req, res) => {
  json(res, db.prepare('SELECT * FROM template_metrics').all());
});

// ─── GET /api/prompt/:id ────────────────────────────────────────────
addRoute('GET', '/api/prompt/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!job) return json(res, { error: 'Job not found' }, 404);
  const tpl = path.join(__dirname, 'prompts', 'cover-letter-template.md');
  let template;
  try { template = fs.readFileSync(tpl, 'utf8'); }
  catch { return json(res, { error: 'Template not found' }, 404); }
  template = template.replaceAll('{{COMPANY}}', job.company).replaceAll('{{TITLE}}', job.title)
    .replaceAll('{{DESCRIPTION}}', job.description || 'No description available');
  json(res, { prompt: template, job });
});

addRoute('GET', '/api/cover-letter-template', (req, res) => {
  const tpl = path.join(__dirname, 'prompts', 'cover-letter-template.md');
  let template;
  try { template = fs.readFileSync(tpl, 'utf8'); }
  catch { return json(res, { error: 'Template not found' }, 404); }
  json(res, { template });
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
  const r = db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(parseInt(req.params.jobId, 10));
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
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parseInt(req.params.jobId, 10));
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
  if (query.job_id) { sql += ' AND c.job_id = ?'; params.push(parseInt(query.job_id, 10)); }
  if (query.category) { sql += ' AND c.category = ?'; params.push(query.category); }
  if (query.search) { sql += " AND (c.question LIKE ? ESCAPE '\\' OR c.answer LIKE ? ESCAPE '\\')"; const s = `%${escapeLike(query.search)}%`; params.push(s, s); }
  sql += ' ORDER BY c.date_updated DESC';
  json(res, db.prepare(sql).all(...params));
});

addRoute('GET', '/api/challenges/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(parseInt(req.params.id, 10));
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
  const id = parseInt(req.params.id, 10);
  if (!db.prepare('SELECT id FROM challenges WHERE id = ?').get(id)) return json(res, { error: 'Not found' }, 404);
  const fields = ['job_id', 'question', 'answer', 'category', 'reusable', 'source_company'];
  const updates = [], values = [];
  for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } }
  if (!updates.length) return json(res, { error: 'No fields to update' }, 400);
  updates.push("date_updated = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE challenges SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  json(res, db.prepare('SELECT * FROM challenges WHERE id = ?').get(id));
});

addRoute('DELETE', '/api/challenges/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.prepare('SELECT id FROM challenges WHERE id = ?').get(id)) return json(res, { error: 'Not found' }, 404);
  db.prepare('DELETE FROM challenges WHERE id = ?').run(id);
  json(res, { deleted: true, id });
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
  const validMethods = ['email', 'ats_portal', 'referral', 'recruiter', 'direct'];
  if (!validMethods.includes(method)) return json(res, { error: 'Invalid method' }, 400);

  const jobId = parseInt(job_id, 10);
  if (!db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId)) return json(res, { error: 'Job not found' }, 404);

  const submitAtomic = db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO application_submissions (job_id, method, platform, cover_letter_id, response_type, contact_name, contact_email) VALUES (?, ?, ?, ?, 'none', ?, ?)"
    ).run(jobId, method, platform || null, cover_letter_id || null, contact_name || null, contact_email || null);
    db.prepare("UPDATE jobs SET status = 'SUBMITTED', date_updated = datetime('now') WHERE id = ?").run(jobId);
    return result;
  });
  const result = submitAtomic();
  json(res, db.prepare('SELECT * FROM application_submissions WHERE id = ?').get(result.lastInsertRowid), 201);
});

addRoute('PUT', '/api/submissions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.prepare('SELECT id FROM application_submissions WHERE id = ?').get(id)) return json(res, { error: 'Not found' }, 404);
  const fields = ['response_type', 'response_date', 'response_notes', 'follow_up_date', 'contact_name', 'contact_email'];
  const updates = [], values = [];
  for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } }
  if (!updates.length) return json(res, { error: 'No fields to update' }, 400);
  values.push(id);
  db.prepare(`UPDATE application_submissions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  json(res, db.prepare('SELECT * FROM application_submissions WHERE id = ?').get(id));
});

// ─── Cover Letter Versions ──────────────────────────────────────────
addRoute('GET', '/api/letters/:jobId', (req, res) => {
  json(res, db.prepare('SELECT * FROM cover_letter_versions WHERE job_id = ? ORDER BY version').all(parseInt(req.params.jobId, 10)));
});

addRoute('GET', '/api/letters/:jobId/:version', (req, res) => {
  const l = db.prepare('SELECT * FROM cover_letter_versions WHERE job_id = ? AND version = ?').get(parseInt(req.params.jobId, 10), parseInt(req.params.version, 10));
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
    status: p.c > 0 ? 'running' : q.c > 0 ? 'pending' : 'idle'
  });
});

addRoute('GET', '/api/conductor/queue', (req, res) => {
  json(res, db.prepare("SELECT * FROM conductor_queue WHERE status IN ('queued','processing','failed') ORDER BY priority DESC, created_at").all());
});

addRoute('POST', '/api/conductor/trigger/:taskType', async (req, res) => {
  const validTaskTypes = ['score', 'generate_letter', 'submit_email', 'submit_ats', 'check_response', 'scrape'];
  if (!validTaskTypes.includes(req.params.taskType)) return json(res, { error: 'Invalid task type' }, 400);
  const id = crypto.randomUUID();
  const jobId = req.body.job_id ? parseInt(req.body.job_id, 10) : null;
  if (jobId && !db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId)) return json(res, { error: 'Job not found' }, 404);
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
  const jobId = parseInt(req.params.jobId, 10);
  const result = conductor.transitionJob(jobId, status);
  if (!result.success) return json(res, { error: result.error }, 400);
  json(res, db.prepare('SELECT * FROM job_current_state WHERE id = ?').get(jobId));
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
    json(res, result, result.success ? (result.dryRun ? 200 : 201) : 500);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// Override for hallucination claims (Wolf approves flagged content)
addRoute('PUT', '/api/letters/:jobId/:version/override', async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const version = parseInt(req.params.version, 10);
  const letter = db.prepare('SELECT * FROM cover_letter_versions WHERE job_id = ? AND version = ?')
    .get(jobId, version);
  if (!letter) return json(res, { error: 'Letter version not found' }, 404);

  const overrideAtomic = db.transaction(() => {
    db.prepare(`UPDATE cover_letter_versions SET hallucination_check = 'pass', needs_review = 0 WHERE job_id = ? AND version = ?`)
      .run(jobId, version);
    db.prepare("UPDATE jobs SET status = 'COVER_LETTER_READY', date_updated = datetime('now') WHERE id = ?")
      .run(jobId);
  });
  overrideAtomic();

  json(res, { success: true, message: 'Override applied — letter approved' });
});

// Generation status (circuit breaker info)
addRoute('GET', '/api/generation-status', (req, res) => {
  const dailyCount = db.prepare("SELECT COUNT(*) as c FROM cover_letter_versions WHERE date(created_at) = date('now')").get();
  const dailyCost = db.prepare("SELECT COALESCE(SUM(cost_estimate), 0) as total FROM cover_letter_versions WHERE date(created_at) = date('now')").get();
  const monthlyCost = db.prepare("SELECT COALESCE(SUM(cost_estimate), 0) as total FROM cover_letter_versions WHERE created_at >= date('now', 'start of month')").get();
  json(res, {
    daily_generations: dailyCount.c,
    daily_limit: 'unlimited',
    daily_cost: Math.round(dailyCost.total * 100) / 100,
    daily_budget: 'unlimited',
    monthly_cost: Math.round(monthlyCost.total * 100) / 100,
    monthly_budget: 55.00,
    can_generate: true,
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
  if (typeof content !== 'string') return json(res, { error: 'content must be a string' }, 400);
  if (content.length > 100000) return json(res, { error: 'Content too large. Max 50KB.' }, 413);
  const validContentTypes = ['cover_letter', 'research', 'qa_answers', 'resume_notes', 'other'];
  if (!validContentTypes.includes(content_type)) return json(res, { error: 'Invalid content_type' }, 400);
  const parsedJobId = job_id ? parseInt(job_id, 10) : null;
  if (parsedJobId && !db.prepare('SELECT id FROM jobs WHERE id = ?').get(parsedJobId)) return json(res, { error: 'Job not found' }, 404);
  const size = Buffer.byteLength(content, 'utf8');
  if (size > 51200) return json(res, { error: 'Content too large. Max 50KB.' }, 413);

  const hash = crypto.createHash('sha256').update(content).digest('hex');
  db.prepare('INSERT INTO bridge_events (content_type, job_id, payload_hash, payload_size) VALUES (?, ?, ?, ?)')
    .run(content_type, parsedJobId, hash, size);

  // Phase 12E: Route content to correct table based on content_type
  if (content_type === 'research' && parsedJobId) {
    db.prepare(`INSERT INTO company_research (job_id, research_notes) VALUES (?, ?)
      ON CONFLICT(job_id) DO UPDATE SET research_notes = excluded.research_notes, research_date = datetime('now')`)
      .run(parsedJobId, content);
  } else if (content_type === 'cover_letter' && parsedJobId) {
    const lastVer = db.prepare('SELECT MAX(version) as v FROM cover_letter_versions WHERE job_id = ?').get(parsedJobId);
    const ver = (lastVer?.v || 0) + 1;
    db.prepare("INSERT INTO cover_letter_versions (job_id, version, content, model_used) VALUES (?, ?, ?, 'manual_paste')")
      .run(parsedJobId, ver, content);
    db.prepare("UPDATE jobs SET status = 'COVER_LETTER_READY', date_updated = datetime('now') WHERE id = ? AND status IN ('SCORED','COVER_LETTER_QUEUED')").run(parsedJobId);
  } else if (content_type === 'qa_answers' && parsedJobId) {
    // Store in challenges table as interview prep
    db.prepare("INSERT INTO challenges (job_id, question, answer, category) VALUES (?, 'Imported Q&A', ?, 'imported')")
      .run(parsedJobId, content);
  } else if (content_type === 'resume_notes') {
    // Append to personal_info resume_summary
    const existing = db.prepare("SELECT value FROM personal_info WHERE key = 'resume_summary'").get();
    const updated = (existing?.value ? existing.value + '\n\n---\n\n' : '') + content;
    db.prepare("INSERT INTO personal_info (key, value, updated_at) VALUES ('resume_summary', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
      .run(updated);
  }

  // Auto-trigger conductor scoring if new research was added to an unscored job
  if (parsedJobId && content_type === 'research') {
    const job = db.prepare("SELECT status, score FROM jobs WHERE id = ?").get(parsedJobId);
    if (job && job.score === null) {
      try { conductor.enqueueTask('score', parsedJobId, { source: 'bridge_ingest' }, 5); } catch {}
    }
  }

  json(res, { success: true, content_type, job_id: parsedJobId, size, hash }, 201);
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
  const gmailEnv = loadEnv();
  if (gmailEnv.GOOGLE_REFRESH_TOKEN) {
    const tokenExpiry = parseInt(gmailEnv.GOOGLE_TOKEN_EXPIRY || '0', 10);
    components.gmail = { status: 'ok', token_expires: new Date(tokenExpiry).toISOString(), days_remaining: Math.max(0, Math.floor((tokenExpiry - Date.now()) / 86400000)) };
  } else if (gmailEnv.GOOGLE_CLIENT_ID) {
    components.gmail = { status: 'warning', token_expires: null, days_remaining: null, hint: 'Credentials saved but not authorized' };
  } else {
    components.gmail = { status: 'not_configured', token_expires: null, days_remaining: null };
  }
  components.playwright = { status: 'not_configured', cdp_connected: false, last_action: null };
  components.linkedin_mcp = { status: linkedinAvailable ? 'ok' : 'not_configured', available: linkedinAvailable, hint: linkedinAvailable ? 'Full LinkedIn descriptions enabled' : 'Run setup-linkedin-mcp.sh for full LinkedIn descriptions' };
  components.profile_scorer = { status: PROFILE_SCORER ? 'ok' : 'not_loaded', dimensions: PROFILE_SCORER ? Object.keys(PROFILE_SCORER).filter(k => k !== 'redFlags').length : 0, source: 'templates/resume.md + capability_profile.md' };
  // Conductor runs inline (started with server), check queue health
  try {
    const qh = conductor.getQueueHealth();
    components.pm2 = { status: 'ok', conductor_pid: process.pid, restarts: 0, mode: 'inline',
      queued: qh.queued, processing: qh.processing, daily_generations: qh.dailyGenerations };
  } catch {
    components.pm2 = { status: 'not_configured', conductor_pid: null, restarts: null };
  }

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
    budget: { daily_spent: 0, daily_limit: 'unlimited', monthly_spent: 0, monthly_limit: 'unlimited', cover_letters_today: dg.c, cover_letters_limit: 'unlimited' }
  });
});

// POST /api/server/restart — Restart the server from the Command Center
addRoute('POST', '/api/server/restart', (req, res) => {
  json(res, { success: true, message: 'Server restarting...' });

  setTimeout(() => {
    const { spawn } = require('child_process');
    // Spawn a new server process directly (detached so it survives us dying)
    const logFile = require('fs').openSync(path.join(__dirname, 'server.log'), 'w');
    const child = spawn('node', ['server.js'], {
      detached: true,
      stdio: ['ignore', logFile, logFile],
      cwd: __dirname,
      env: { ...process.env }
    });
    child.unref();
    // Now exit this process — the new one will take over the port
    process.exit(0);
  }, 1000);
});

// POST /api/server/launch-cdp — Check CDP status or launch Chrome when none is running
addRoute('POST', '/api/server/launch-cdp', (req, res) => {
  const { execSync, spawn } = require('child_process');

  // Check if CDP is already running
  try {
    execSync('curl -s http://localhost:9222/json/version', { timeout: 3000 });
    return json(res, { success: true, already_running: true, message: 'Chrome CDP already running on port 9222' });
  } catch {}

  // Detect browser
  let browserPath = null;
  let browserName = '';
  let processName = '';
  const candidates = [
    { path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', name: 'Brave', proc: 'Brave Browser' },
    { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Chrome', proc: 'Google Chrome' },
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c.path)) { browserPath = c.path; browserName = c.name; processName = c.proc; break; } } catch {}
  }

  if (!browserPath) {
    return json(res, { success: false, error: 'No Chrome or Brave browser found' });
  }

  // Check if browser is running WITHOUT CDP
  let browserIsRunning = false;
  try {
    const pgrep = execSync(`pgrep -f "${processName}"`, { timeout: 3000 }).toString().trim();
    browserIsRunning = pgrep.length > 0;
  } catch {}

  if (browserIsRunning) {
    // Chrome is running but without CDP — can't fix from here
    return json(res, {
      success: false,
      needs_restart: true,
      error: `${browserName} is running but without CDP. Run "bash start.sh" in terminal to restart everything with CDP enabled.`
    });
  }

  // No browser running at all — launch fresh with CDP
  try {
    const child = spawn(browserPath, [
      '--remote-debugging-port=9222',
      '--no-first-run',
      '--no-default-browser-check'
    ], { detached: true, stdio: 'ignore' });
    child.unref();

    // Wait for CDP to become available
    let cdpReady = false;
    for (let i = 0; i < 16; i++) {
      try {
        execSync('curl -s http://localhost:9222/json/version', { timeout: 2000 });
        cdpReady = true;
        break;
      } catch {}
      execSync('sleep 0.5');
    }

    if (cdpReady) {
      console.log(`[CDP] ${browserName} launched with CDP on port 9222`);
      json(res, { success: true, browser: browserName, message: `${browserName} launched with CDP on port 9222` });
    } else {
      json(res, { success: false, error: `${browserName} launched but CDP not responding. Try again in a few seconds.` });
    }
  } catch (e) {
    json(res, { success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// APPLICATION PACKAGES (/ready/[company]/ folder builder)
// ═══════════════════════════════════════════════════════════════════════

const packageBuilder = require('./lib/package-builder');

// POST /api/packages/build/:id — Build application package for a job
addRoute('POST', '/api/packages/build/:id', async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const result = await packageBuilder.buildPackage(db, jobId);
  json(res, result, result.success ? 201 : 400);
});

// GET /api/packages — List all ready packages
addRoute('GET', '/api/packages', (req, res) => {
  const packages = packageBuilder.listReadyPackages();
  json(res, { packages });
});

// GET /api/packages/:id — Get package for a specific job
addRoute('GET', '/api/packages/:id', (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const pkg = packageBuilder.getPackagePath(db, jobId);
  if (pkg) {
    json(res, pkg);
  } else {
    json(res, { error: 'No package found' }, 404);
  }
});

// POST /api/packages/archive/:id — Move package to /applied/ after submission
addRoute('POST', '/api/packages/archive/:id', (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const result = packageBuilder.archivePackage(db, jobId);
  json(res, result, result.success ? 200 : 400);
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

// POST /api/ats/mark-submitted/:id — Mark a job as submitted (after manual review)
addRoute('POST', '/api/ats/mark-submitted/:id', (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const { method, platform } = req.body || {};
  try {
    const result = applicationBot.markSubmitted(db, jobId, method || 'ats_portal', platform || 'unknown');
    json(res, result);
  } catch (e) {
    json(res, { success: false, error: e.message }, 500);
  }
});

// GET /api/ats/submissions — List past submissions
addRoute('GET', '/api/ats/submissions', (req, res, query) => {
  const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 200);
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

// POST /api/search/run — Run multi-platform job search via ts-jobspy + LinkedIn MCP
addRoute('POST', '/api/search/run', async (req, res) => {
  try {
    const { query, location, sources = ['indeed'], min_score = 0 } = req.body;
    if (!query) return json(res, { error: 'query required' }, 400);

    let duplicatesFiltered = 0;
    const sourceErrors = [];

    // Split comma-separated queries for multi-title search
    const queries = query.includes(',')
      ? query.split(',').map(q => q.trim()).filter(q => q.length > 2)
      : [query];

    let rawResults = [];

    // Source 1: ts-jobspy (Indeed, and LinkedIn if MCP not available)
    const tsjSources = sources.includes('linkedin') && linkedinAvailable
      ? sources.filter(s => s !== 'linkedin') // Let MCP handle LinkedIn
      : sources.filter(s => ['indeed', 'linkedin'].includes(s));
    if (tsjSources.length > 0) {
      try {
        rawResults = await searchJobsSpy(queries.join(', '), location, tsjSources, Math.max(50, queries.length * 10));
      } catch (e) {
        console.error('ts-jobspy search error:', e.message);
        sourceErrors.push({ source: 'ts-jobspy', error: e.message });
      }
    }

    // Source 2: LinkedIn MCP (full descriptions!) — if available and LinkedIn is selected
    if (sources.includes('linkedin') && linkedinAvailable && linkedinMCP) {
      console.log(`[LinkedIn MCP] Starting search for ${queries.length} queries (max 4)...`);
      for (const q of queries.slice(0, 4)) { // Limit to 4 queries to avoid rate limits
        try {
          const t0 = Date.now();
          const mcpJobs = await linkedinMCP.searchJobsWithDetails(q, location, 5);
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          if (Array.isArray(mcpJobs) && mcpJobs.length > 0) {
            for (const j of mcpJobs) {
              rawResults.push({
                title: j.title || j.job_title || 'Unknown',
                company: j.company || j.company_name || 'Unknown',
                description: (j.description || j.job_description || '').substring(0, 8000),
                url: j.url || j.job_url || j.link || '',
                url_direct: j.apply_url || j.url_direct || '',
                location: j.location || '',
                source: 'linkedin_mcp',
                posted: j.posted || j.date_posted || '',
                salary_min: j.salary_min || null,
                salary_max: j.salary_max || null,
                is_remote: j.is_remote || false,
              });
            }
            console.log(`[LinkedIn MCP] "${q}": ${mcpJobs.length} jobs in ${elapsed}s (${mcpJobs.filter(j => j.description).length} with descriptions)`);
          } else {
            console.log(`[LinkedIn MCP] "${q}": 0 results in ${elapsed}s (response type: ${typeof mcpJobs}, isArray: ${Array.isArray(mcpJobs)})`);
          }
        } catch (e) {
          console.error(`[LinkedIn MCP] "${q}" FAILED: ${e.message}`);
          sourceErrors.push({ source: 'linkedin_mcp', error: e.message, query: q });
        }
      }
    } else if (sources.includes('linkedin') && !linkedinAvailable) {
      console.log('[LinkedIn MCP] Not available — LinkedIn results will be title-only from ts-jobspy');
    }

    // Score each result — 7-dimension profile match loaded from resume.md + capability_profile.md
    // Leadership 25% | Seniority 20% | Industry 15% | Culture 15% | Transformation 10% | Scope 10% | Location 5%
    function scoreResult(r) {
      const scorer = PROFILE_SCORER || loadProfileScorer();
      if (!scorer) { r.score = 50; return; } // fallback if no profile loaded

      const title = (r.title || '').toLowerCase();
      const company = (r.company || '').toLowerCase();
      const text = `${title} ${r.description || ''} ${company}`;

      // Company skip list — instant 0
      if (COMPANY_SKIP_LIST.some(skip => company.includes(skip))) {
        r.score = 0;
        r.skip_reason = 'company_skipped';
        return;
      }

      // Title disqualifiers — instant 0 for clearly wrong-level roles
      if (scorer.titleDisqualifiers && scorer.titleDisqualifiers.some(d => title.includes(d))) {
        r.score = 0;
        r.skip_reason = 'title_disqualified';
        return;
      }

      let totalScore = 0;
      for (const [dimName, dim] of Object.entries(scorer)) {
        if (dimName === 'redFlags' || dimName === 'titleDisqualifiers') continue;
        if (!dim.terms || !dim.weight) continue;
        const matches = dim.terms.filter(t => text.includes(t));
        totalScore += Math.min(matches.length / 3, 1.0) * dim.weight;
      }

      // Red flags subtract points
      const redFlags = (scorer.redFlags || []).filter(f => text.includes(f));
      totalScore -= redFlags.length * 8;

      // Bonus: title contains a target title keyword (+15 points)
      const titleKeywords = ['vp', 'vice president', 'svp', 'cto', 'coo', 'head of engineering', 'senior director', 'director of engineering'];
      if (titleKeywords.some(k => title.includes(k))) totalScore += 15;

      r.score = Math.max(0, Math.min(Math.round((totalScore / 100) * 100), 100));
    }

    // Dedup against existing pipeline + across results
    const seen = new Map();
    const results = [];

    for (const r of rawResults) {
      scoreResult(r);

      // Cross-result dedup
      const key = `${(r.company||'').toLowerCase()}|${(r.title||'').toLowerCase()}`;
      if (seen.has(key)) { duplicatesFiltered++; continue; }
      seen.set(key, true);

      // Pipeline dedup — check current jobs AND deleted jobs (permanent exclusion)
      try {
        const companyLower = (r.company || '').toLowerCase();
        const titleLower = (r.title || '').toLowerCase();
        const fingerprint = [companyLower, titleLower, ''].join('|').replace(/\s+/g, ' ');

        // Check 1: Already in pipeline (any time, not just 90 days)
        const existing = db.prepare(
          "SELECT id FROM jobs WHERE LOWER(company) = LOWER(?) AND LOWER(title) = LOWER(?)"
        ).get(r.company, r.title);

        // Check 2: Previously deleted (blacklisted)
        const deleted = db.prepare(
          "SELECT deleted_at FROM deleted_fingerprints WHERE LOWER(company) = LOWER(?) AND LOWER(title) = LOWER(?)"
        ).get(r.company, r.title);

        if (existing || deleted) {
          r.is_duplicate = true;
          duplicatesFiltered++;
          continue; // Skip — don't show in results at all
        }
        r.is_duplicate = false;
      } catch { r.is_duplicate = false; }

      if (r.score >= min_score) results.push(r);
    }

    results.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Source breakdown for UI status
    const sourceCounts = {};
    for (const r of results) { sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1; }
    const belowThreshold = rawResults.length - results.length - duplicatesFiltered;
    console.log(`[Search] ${rawResults.length} raw → ${results.length} results (${duplicatesFiltered} dupes, ${belowThreshold} below score ${min_score}). Sources: ${JSON.stringify(sourceCounts)}`);

    json(res, { results, count: results.length, duplicates_filtered: duplicatesFiltered, below_threshold: belowThreshold, raw_count: rawResults.length, sources_queried: sources.length, source_errors: sourceErrors, source_counts: sourceCounts });
  } catch (e) {
    console.error('Search handler error:', e);
    json(res, { error: 'Search failed: ' + e.message, results: [], source_errors: [{ source: 'system', error: e.message }] }, 500);
  }
});

// POST /api/search/add-to-pipeline — Add selected search results to pipeline
addRoute('POST', '/api/search/add-to-pipeline', async (req, res) => {
  const { jobs = [] } = req.body;
  if (!jobs.length) return json(res, { error: 'No jobs provided' }, 400);

  let added = 0;
  const insert = db.prepare(
    "INSERT INTO jobs (company, title, description, status, source, url, url_direct, company_url, date_added) VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, datetime('now'))"
  );

  for (const job of jobs) {
    if (job.is_duplicate) continue;
    try {
      insert.run(job.company, job.title, job.description || '', job.source || 'search', job.url || null, job.url_direct || null, job.company_url || null);
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
  const id = parseInt(req.params.id, 10);
  if (!db.prepare('SELECT id FROM monitored_companies WHERE id = ?').get(id)) return json(res, { error: 'Not found' }, 404);
  db.prepare('DELETE FROM monitored_companies WHERE id = ?').run(id);
  json(res, { success: true });
});

// ─── Company Direct Search ──────────────────────────────────────────
// Search a specific company for jobs matching Wolf's profile
// Priority: 1) Company's own careers API  2) ts-jobspy (Indeed/LinkedIn) as supplement
addRoute('POST', '/api/search/company', async (req, res) => {
  try {
    const { company, location, count = 50 } = req.body;
    if (!company) return json(res, { error: 'company required' }, 400);

    const companyKey = company.toLowerCase().trim();
    const loc = location || 'Los Angeles';
    const allJobs = [];  // normalized format: { title, company, description, url, url_direct, company_url, location, source, posted, ... }
    const errors = [];
    let careersApiUsed = false;

    // ── PRIMARY: Hit the company's own careers API if available ──
    const apiConfig = COMPANY_APIS[companyKey];
    if (apiConfig) {
      const queries = [
        'VP Engineering', 'Director Engineering', 'SVP Engineering',
        'CTO', 'VP Technology', 'Head of Engineering',
        'engineering', 'technology leader',
      ];
      try {
        const result = await searchCompanyCareersAPI(companyKey, queries, loc, count);
        careersApiUsed = true;
        for (const job of result.jobs) {
          allJobs.push({
            title: job.title,
            company: job.company || company,
            description: (job.description || '').substring(0, 5000),
            url: job.url || '',
            url_direct: job.url_direct || '',
            company_url: job.company_url || result.careers_url || '',
            location: job.location || '',
            source: companyKey, // "netflix", "amazon" — NOT "indeed"
            posted: job.posted || '',
            department: job.department || '',
            is_remote: job.remote || false,
            salary_min: job.salary_min || null,
            salary_max: job.salary_max || null,
          });
        }
        console.log(`[Company Search] ${company}: ${allJobs.length} jobs from careers API`);
      } catch (e) {
        errors.push({ query: 'careers_api', error: e.message });
        console.error(`[Company Search] ${company} careers API failed: ${e.message}`);
      }
    }

    // ── FALLBACK: Try HTML careers page scraper if no API ──
    if (!careersApiUsed) {
      const careersUrl = KNOWN_CAREERS[companyKey];
      if (careersUrl) {
        try {
          const careerJobs = await scrapeCareerPage(careersUrl, company);
          for (const cj of careerJobs) {
            allJobs.push({
              title: cj.title,
              company: cj.company || company,
              description: cj.description || '',
              url: cj.url || '',
              url_direct: cj.url_direct || '',
              company_url: careersUrl,
              location: cj.location || '',
              source: `${companyKey}_careers`,
              posted: cj.posted || '',
              salary_min: cj.salary_min,
              salary_max: cj.salary_max,
            });
          }
          if (careerJobs.length > 0) careersApiUsed = true;
        } catch (e) {
          errors.push({ query: 'careers_page', error: e.message });
        }
      }
    }

    // ── SUPPLEMENT: Search Indeed for this company (only if careers API gave < 20 results) ──
    const supplementQueries = careersApiUsed && allJobs.length >= 20
      ? [] // Enough results from careers API, skip Indeed noise
      : [
          `${company} VP Engineering`,
          `${company} Director Engineering`,
          `${company} SVP Technology`,
        ];
    for (const searchTerm of supplementQueries) {
      try {
        const jobs = await scrapeJobs({
          siteType: ['indeed'],
          searchTerm,
          location: loc,
          resultsWanted: 5,
          countryIndeed: 'USA',
        });
        for (const j of jobs) {
          allJobs.push({
            title: j.title || 'Unknown',
            company: j.company || company,
            description: (j.description || '').substring(0, 5000),
            url: j.jobUrl || '',
            url_direct: j.jobUrlDirect || '',
            company_url: j.companyUrl || '',
            location: j.location || '',
            source: j.site || 'indeed',
            posted: j.datePosted || '',
            salary_min: j.minAmount || null,
            salary_max: j.maxAmount || null,
            is_remote: j.isRemote || false,
          });
        }
      } catch (e) {
        if (!e.message.includes('403') && !e.message.includes('429')) {
          errors.push({ query: searchTerm, error: e.message });
        }
      }
    }

    // ── Dedup by title ──
    const seen = new Set();
    const unique = [];
    for (const j of allJobs) {
      const key = `${(j.company || '').toLowerCase()}|${(j.title || '').toLowerCase().replace(/\s+/g, ' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(j);
    }

    // ── Score each job (uses same logic as search scorer) ──
    const scoreJob = (job) => {
      const scorer = PROFILE_SCORER || loadProfileScorer();
      if (!scorer) return 50;
      const title = (job.title || '').toLowerCase();
      const company = (job.company || '').toLowerCase();
      const text = `${title} ${job.description || ''} ${job.department || ''} ${company}`;

      // Company skip list
      if (COMPANY_SKIP_LIST.some(skip => company.includes(skip))) return 0;
      // Title disqualifiers
      if (scorer.titleDisqualifiers && scorer.titleDisqualifiers.some(d => title.includes(d))) return 0;

      let totalScore = 0;
      for (const [dimName, dim] of Object.entries(scorer)) {
        if (dimName === 'redFlags' || dimName === 'titleDisqualifiers') continue;
        if (!dim.terms || !dim.weight) continue;
        const matches = dim.terms.filter(t => text.includes(t));
        totalScore += Math.min(matches.length / 3, 1.0) * dim.weight;
      }
      const redFlags = (scorer.redFlags || []).filter(f => text.includes(f));
      totalScore -= redFlags.length * 8;
      // Title bonus
      const titleKeywords = ['vp', 'vice president', 'svp', 'cto', 'coo', 'head of engineering', 'senior director', 'director of engineering'];
      if (titleKeywords.some(k => title.includes(k))) totalScore += 15;
      return Math.max(0, Math.min(Math.round((totalScore / 100) * 100), 100));
    };

    // ── Check pipeline for duplicates ──
    const existingJobs = db.prepare("SELECT company, title FROM jobs").all();
    const existingSet = new Set(existingJobs.map(j => `${j.company.toLowerCase()}|${j.title.toLowerCase()}`));

    const results = unique.map(job => ({
      ...job,
      score: scoreJob(job),
      is_duplicate: existingSet.has(`${job.company.toLowerCase()}|${job.title.toLowerCase()}`),
    })).sort((a, b) => b.score - a.score);

    // Count by source
    const sourceCounts = {};
    for (const r of results) { sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1; }

    json(res, {
      company,
      results,
      count: results.length,
      sources: sourceCounts,
      careers_api_used: careersApiUsed,
      duplicates_in_pipeline: results.filter(r => r.is_duplicate).length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    json(res, { error: 'Company search failed: ' + e.message, results: [] }, 500);
  }
});

// ─── Careers Page Scraper ────────────────────────────────────────────
// Scrape a company's careers page for job listings
async function scrapeCareerPage(url, company) {
  const jobs = [];
  try {
    const html = await fetchHTML(url);

    // Common patterns for job listings on careers pages:
    // 1. Links with job-related paths: /jobs/, /careers/, /positions/, /openings/
    // 2. Structured data (JSON-LD)
    // 3. Job title patterns in links

    // Try JSON-LD first (best structured data)
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of jsonLdMatches) {
      try {
        const content = block.replace(/<\/?script[^>]*>/gi, '');
        const data = JSON.parse(content);
        const postings = Array.isArray(data) ? data : data['@graph'] || [data];
        for (const item of postings) {
          if (item['@type'] === 'JobPosting' || item.title) {
            jobs.push({
              title: item.title || item.name || '',
              company: item.hiringOrganization?.name || company,
              description: (item.description || '').replace(/<[^>]+>/g, '').substring(0, 5000),
              url: item.url || url,
              url_direct: item.url || '',
              location: typeof item.jobLocation === 'string' ? item.jobLocation :
                item.jobLocation?.address?.addressLocality || '',
              source: 'careers_page',
              posted: item.datePosted || '',
              salary_min: item.baseSalary?.value?.minValue || null,
              salary_max: item.baseSalary?.value?.maxValue || null,
            });
          }
        }
      } catch { /* invalid JSON-LD, skip */ }
    }

    // If JSON-LD didn't give us much, try link extraction
    if (jobs.length < 3) {
      const linkPattern = /href=["']([^"']*(?:\/jobs?\/|\/careers?\/|\/positions?\/|\/openings?\/|\/apply\/)[^"']*?)["'][^>]*>([^<]*)/gi;
      const links = [...html.matchAll(linkPattern)];
      const seenTitles = new Set(jobs.map(j => j.title.toLowerCase()));

      for (const [, href, text] of links) {
        const title = text.trim().replace(/\s+/g, ' ');
        if (!title || title.length < 5 || title.length > 200) continue;
        if (seenTitles.has(title.toLowerCase())) continue;
        // Skip nav/footer links
        if (/^(home|about|contact|blog|login|sign|faq|all jobs|view all|back|next|prev)/i.test(title)) continue;

        seenTitles.add(title.toLowerCase());
        let fullUrl = href;
        if (href.startsWith('/')) {
          const base = new URL(url);
          fullUrl = `${base.protocol}//${base.host}${href}`;
        } else if (!href.startsWith('http')) {
          fullUrl = url.replace(/\/$/, '') + '/' + href;
        }

        jobs.push({
          title,
          company,
          description: '', // Would need a second fetch to get description
          url: fullUrl,
          url_direct: fullUrl,
          location: '',
          source: 'careers_page',
          posted: '',
          salary_min: null,
          salary_max: null,
        });
      }
    }
  } catch (e) {
    console.error(`Careers scrape failed for ${url}: ${e.message}`);
  }
  return jobs;
}

// POST /api/search/careers — Scrape a company's careers page
addRoute('POST', '/api/search/careers', async (req, res) => {
  try {
    const { url, company } = req.body;
    if (!url) return json(res, { error: 'url required' }, 400);
    const jobs = await scrapeCareerPage(url, company || 'Unknown');
    json(res, { jobs, count: jobs.length, source_url: url });
  } catch (e) {
    json(res, { error: 'Careers scrape failed: ' + e.message, jobs: [] }, 500);
  }
});

// ─── Company Careers APIs ───────────────────────────────────────────
// Direct JSON API endpoints for major companies (returns real job data without scraping)
const COMPANY_APIS = {
  'netflix': {
    api: (query, location, offset = 0, limit = 25) =>
      `https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&query=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&start=${offset}&num=${limit}`,
    parse: (data) => ({
      jobs: (data.positions || []).map(p => ({
        title: p.name || p.posting_name || '',
        company: 'Netflix',
        description: p.job_description || '',
        url: p.canonicalPositionUrl || `https://explore.jobs.netflix.net/careers/job/${p.id}`,
        url_direct: `https://explore.jobs.netflix.net/careers/job/${p.id}`,
        location: p.location || '',
        department: p.department || '',
        posted: p.t_create ? new Date(Number(p.t_create) * 1000).toISOString().split('T')[0] : '',
        remote: p.work_location_option === 'remote',
        job_id: p.ats_job_id || p.id,
      })),
      total: data.count || 0,
    }),
    careers_url: 'https://jobs.netflix.com/search',
  },
  'amazon': {
    api: (query, location, offset = 0, limit = 25) =>
      `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(query)}&loc_query=${encodeURIComponent(location)}&offset=${offset}&result_limit=${limit}`,
    parse: (data) => ({
      jobs: (data.jobs || []).map(j => ({
        title: j.title || '',
        company: j.company_name || 'Amazon',
        description: (j.description || j.description_short || '').substring(0, 5000),
        url: j.job_path ? `https://www.amazon.jobs${j.job_path}` : '',
        url_direct: j.url_next_step || '',
        location: j.location || `${j.city || ''}, ${j.state || ''}`.replace(/, $/, ''),
        department: j.job_category || '',
        posted: j.posted_date || '',
        remote: false,
        job_id: j.id_icims || j.id,
      })),
      total: data.hits || 0,
    }),
    careers_url: 'https://www.amazon.jobs/en/search',
  },
  'disney': {
    // Disney uses a bespoke AJAX endpoint
    api: (query, location, offset = 0, limit = 25) =>
      `https://jobs.disneycareers.com/search-jobs/results?ActiveFacetID=0&CurrentPage=${Math.floor(offset / limit) + 1}&RecordsPerPage=${limit}&Distance=50&RadiusUnitType=0&Keywords=${encodeURIComponent(query)}&Location=${encodeURIComponent(location)}`,
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    parse: (data) => {
      // Disney returns HTML snippets inside JSON — extract job data from HTML
      const jobs = [];
      const html = (data.results || '').toString();
      const jobPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<span[^>]*class=["'][^"']*job-location["'][^>]*>([\s\S]*?)<\/span>/gi;
      let match;
      while ((match = jobPattern.exec(html)) !== null) {
        jobs.push({
          title: match[2].replace(/<[^>]+>/g, '').trim(),
          company: 'Disney',
          description: '',
          url: match[1].startsWith('http') ? match[1] : `https://jobs.disneycareers.com${match[1]}`,
          url_direct: '',
          location: match[3].replace(/<[^>]+>/g, '').trim(),
          department: '',
          posted: '',
          remote: false,
          job_id: '',
        });
      }
      return { jobs, total: data.hasJobs ? jobs.length : 0 };
    },
    careers_url: 'https://jobs.disneycareers.com/search-jobs',
  },
};

// Fallback careers page URLs for companies without JSON APIs
const KNOWN_CAREERS = {
  'apple': 'https://jobs.apple.com/en-us/search?search=engineering+management&location=los-angeles',
  'google': 'https://www.google.com/about/careers/applications/jobs/results/',
  'microsoft': 'https://careers.microsoft.com/v2/global/en/search?q=engineering+leader&l=en_us',
  'warner bros discovery': 'https://careers.wbd.com/global/en/search-results',
  'paramount': 'https://careers.paramount.com/search-jobs',
  'sony': 'https://www.sonyjobs.com/find-a-job',
  'nbcuniversal': 'https://www.nbcunicareers.com/search-results',
  'diversified': 'https://onediversified.com/careers/',
  'meta': 'https://www.metacareers.com/jobs',
  'salesforce': 'https://careers.salesforce.com/en/jobs/',
};

/** Search a company's direct careers API — returns normalized job array */
async function searchCompanyCareersAPI(companyKey, queries, location, maxResults = 50) {
  const config = COMPANY_APIS[companyKey];
  if (!config) return { jobs: [], source: null, careers_url: null };

  const allJobs = [];
  const seen = new Set();

  for (const query of queries) {
    try {
      const url = config.api(query, location, 0, Math.min(25, maxResults));
      const raw = await fetchJSON(url, config.headers);
      const parsed = config.parse(raw);

      for (const job of parsed.jobs) {
        const key = `${job.title.toLowerCase()}|${job.location.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allJobs.push({
          ...job,
          source: companyKey,
          company_url: config.careers_url,
        });
      }

      if (allJobs.length >= maxResults) break;
    } catch (e) {
      console.error(`Careers API error for ${companyKey} query "${query}": ${e.message}`);
    }
  }

  return {
    jobs: allJobs.slice(0, maxResults),
    source: companyKey,
    careers_url: config.careers_url,
    total_api: allJobs.length,
  };
}

/** Fetch JSON from a URL (follows redirects, returns parsed object) */
function fetchJSON(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        ...extraHeaders,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location, extraHeaders).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`)));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── Universal Search Ingest (Step 4) ────────────────────────────────
// Accepts job data from ANY source: Claude in Chrome, manual paste, webhook, etc.
addRoute('POST', '/api/search/ingest', async (req, res) => {
  try {
    const jobs = Array.isArray(req.body) ? req.body : (req.body.jobs || [req.body]);
    if (!jobs.length || !jobs[0].title) return json(res, { error: 'Provide job(s) with at least title and company' }, 400);

    let added = 0, skipped = 0;
    const insert = db.prepare(
      "INSERT INTO jobs (company, title, description, status, source, url, url_direct, company_url, careers_url, date_added) VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, ?, datetime('now'))"
    );

    for (const job of jobs) {
      // Dedup check
      const exists = db.prepare(
        "SELECT id FROM jobs WHERE company = ? AND title = ? LIMIT 1"
      ).get(job.company || 'Unknown', job.title);
      if (exists) { skipped++; continue; }

      try {
        insert.run(
          job.company || 'Unknown', job.title, (job.description || '').substring(0, 5000),
          job.source || 'ingested', job.url || null, job.url_direct || null,
          job.company_url || null, job.careers_url || null
        );
        added++;
      } catch (e) {
        console.error('Ingest insert error:', e.message);
      }
    }

    json(res, { added, skipped, total: jobs.length });
  } catch (e) {
    json(res, { error: 'Ingest failed: ' + e.message }, 500);
  }
});

// ─── AI Search Tasks (Step 3) ────────────────────────────────────────
// Create a deep search task for Claude in Chrome to pick up
addRoute('POST', '/api/search/ai-task', (req, res) => {
  const { query, location } = req.body;
  if (!query) return json(res, { error: 'query required' }, 400);
  try {
    const result = db.prepare(
      "INSERT INTO ai_search_tasks (query, location) VALUES (?, ?)"
    ).run(query, location || 'United States');
    json(res, { id: Number(result.lastInsertRowid), status: 'pending' }, 201);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// Get pending AI search tasks (for Claude in Chrome to poll)
addRoute('GET', '/api/search/ai-tasks', (req, res) => {
  const tasks = db.prepare(
    "SELECT * FROM ai_search_tasks WHERE status = 'pending' ORDER BY created_at"
  ).all();
  json(res, tasks);
});

// Update AI search task status
addRoute('PUT', '/api/search/ai-task/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, results_count, error } = req.body;
  db.prepare(
    "UPDATE ai_search_tasks SET status = ?, results_count = COALESCE(?, results_count), error = ?, completed_at = CASE WHEN ? IN ('completed','failed') THEN datetime('now') ELSE completed_at END WHERE id = ?"
  ).run(status, results_count || null, error || null, status, id);
  json(res, { success: true });
});

// ─── Company Research Auto-Enrichment (Step 2) ──────────────────────
// Auto-fetch company website and find careers page URL
addRoute('POST', '/api/research/auto/:jobId', async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return json(res, { error: 'Job not found' }, 404);

  const company = job.company;
  const companyUrl = job.company_url || '';
  let careersUrl = job.careers_url || '';
  let companyDescription = '';
  let researchNotes = [];

  try {
    // Step 1: If we have a company URL, fetch it and look for careers page
    let baseUrl = companyUrl;
    if (!baseUrl && company && company !== 'Unknown') {
      // Try to guess company website
      const cleaned = company.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/inc$|llc$|corp$|ltd$/, '');
      baseUrl = `https://www.${cleaned}.com`;
      researchNotes.push(`Guessed company URL: ${baseUrl}`);
    }

    if (baseUrl) {
      try {
        const html = await fetchHTML(baseUrl);
        // Extract description from meta tags
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);
        if (descMatch) companyDescription = descMatch[1].substring(0, 500);

        // Look for careers/jobs links
        const careersPatterns = [
          /href=["']([^"']*(?:careers|jobs|join-us|work-with-us|openings|hiring)[^"']*)/gi,
        ];
        for (const pattern of careersPatterns) {
          const matches = [...html.matchAll(pattern)];
          for (const m of matches) {
            let url = m[1];
            if (url.startsWith('/')) url = baseUrl.replace(/\/$/, '') + url;
            if (url.includes('career') || url.includes('jobs') || url.includes('join')) {
              careersUrl = url;
              break;
            }
          }
          if (careersUrl) break;
        }
        researchNotes.push(careersUrl ? `Found careers page: ${careersUrl}` : 'No careers page link found on homepage');
      } catch (e) {
        researchNotes.push(`Failed to fetch ${baseUrl}: ${e.message}`);
      }
    }

    // Step 2: If we have url_direct (from ts-jobspy), that's the actual ATS application URL
    if (job.url_direct) {
      researchNotes.push(`Direct application URL: ${job.url_direct}`);
      // Extract ATS platform from url_direct
      if (job.url_direct.includes('greenhouse.io')) researchNotes.push('ATS: Greenhouse');
      else if (job.url_direct.includes('lever.co')) researchNotes.push('ATS: Lever');
      else if (job.url_direct.includes('myworkdayjobs.com')) researchNotes.push('ATS: Workday');
      else if (job.url_direct.includes('icims.com')) researchNotes.push('ATS: iCIMS');
      else if (job.url_direct.includes('taleo')) researchNotes.push('ATS: Taleo');
    }

    // Store careers_url on the job
    if (careersUrl) {
      db.prepare('UPDATE jobs SET careers_url = ? WHERE id = ?').run(careersUrl, jobId);
    }

    // Upsert company research
    db.prepare(`
      INSERT INTO company_research (job_id, research_notes, company_summary)
      VALUES (?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        research_notes = excluded.research_notes,
        company_summary = COALESCE(excluded.company_summary, company_summary),
        research_date = datetime('now')
    `).run(jobId, researchNotes.join('\n'), companyDescription || null);

    json(res, {
      job_id: jobId,
      company,
      careers_url: careersUrl || null,
      company_description: companyDescription || null,
      notes: researchNotes,
    });
  } catch (e) {
    json(res, { error: 'Research failed: ' + e.message }, 500);
  }
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

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parseInt(req.params.jobId, 10));
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

  // Budget check removed — no daily limit

  // Load personal info
  const piRows = db.prepare('SELECT key, value FROM personal_info').all();
  const pi = {};
  for (const r of piRows) pi[r.key] = r.value;

  // Load company research
  let research = db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(jobId);

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
    // ─── Step 0: Auto-research if no company research exists ───────────
    if (!research || !research.company_summary) {
      try {
        const researchSystem = `You are an executive job search research assistant. Research this company to help a VP of Engineering write a compelling, specific cover letter. Return ONLY valid JSON with these fields:
- company_summary: 2-3 sentences about what the company does, their market position, and scale
- current_challenges: What transformation, growth, or technical challenges the company is likely facing RIGHT NOW (be specific — AI adoption, scaling engineering, platform migration, etc.)
- why_wolf_fits: One sentence on why a people-first engineering leader (not a domain specialist) would be valuable here
- culture_notes: Work culture signals (from job description, Glassdoor reputation, or company messaging)
- key_people: Key engineering/tech leadership names if findable
- recent_news: Any recent funding, acquisitions, layoffs, product launches, or strategic shifts

Return ONLY valid JSON, no markdown fencing.`;

        const researchMsg = `Company: ${job.company}\nRole: ${job.title}\nDescription: ${(job.description || '').slice(0, 1500)}\nURL: ${job.url || 'unknown'}`;
        const researchRaw = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', researchSystem, researchMsg, 1500);
        let researchParsed;
        try {
          const cleaned = researchRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
          researchParsed = JSON.parse(cleaned);
        } catch {
          researchParsed = { research_notes: researchRaw };
        }
        // Save to DB
        db.prepare(`
          INSERT INTO company_research (job_id, research_notes, company_summary, culture_notes, key_people, recent_news)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(job_id) DO UPDATE SET
            research_notes = COALESCE(excluded.research_notes, research_notes),
            company_summary = COALESCE(excluded.company_summary, company_summary),
            culture_notes = COALESCE(excluded.culture_notes, culture_notes),
            key_people = COALESCE(excluded.key_people, key_people),
            recent_news = COALESCE(excluded.recent_news, recent_news)
        `).run(
          jobId,
          [researchParsed.current_challenges, researchParsed.why_wolf_fits, researchParsed.research_notes].filter(Boolean).join('\n'),
          researchParsed.company_summary || null,
          researchParsed.culture_notes || null,
          researchParsed.key_people || null,
          researchParsed.recent_news || null
        );
        // Reload research from DB
        research = db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(jobId);
        if (!research) research = researchParsed; // fallback to parsed if DB insert failed
      } catch (e) {
        console.log(`[cover-letter] Auto-research failed for job ${jobId}: ${e.message} — continuing without research`);
      }
    }

    // ─── Three-Call Pattern: Extract → Research Context → Assemble ─────

    // Call 1: Extraction — pull relevant proof points from profile
    const extractSystem = `You are a cover letter research assistant for Wolf Schram, a VP of Engineering making a career transition.

CRITICAL CONTEXT: Wolf's subject matter IS leadership — technology is the context, not the product. He may not be a domain expert in the company's specific technology, and that's the point. His value is leading people, building ownership cultures, and driving transformation in ANY technology environment.

Your job: Extract the BEST proof points from his profile that would be most compelling for THIS specific role. Prioritize:
1. Concrete results with numbers (team size, scale, outcomes)
2. Stories that demonstrate leadership transferability across industries
3. Transformation examples (culture change, org mergers, scaling teams)
4. Any direct or adjacent technical relevance

Output ONLY a JSON array of objects with: fact, source, relevance_to_job, strength (1-10). Return valid JSON only, no markdown.`;

    const extractMsg = `JOB: ${job.company} — ${job.title}
DESCRIPTION: ${(job.description || '').slice(0, 2000)}

CANDIDATE PROFILE:
Name: ${pi.full_name || 'Wolfgang Schram'}
Positioning: ${pi.positioning_statement || ''}
Resume Summary: ${pi.resume_summary || ''}
${capabilityProfile ? `\nCAPABILITY PROFILE:\n${capabilityProfile.slice(0, 4000)}` : ''}
${coverLetterExamples ? `\nCOVER LETTER EXAMPLES (for tone reference only):\n${coverLetterExamples.slice(0, 2000)}` : ''}`;

    const extractedRaw = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', extractSystem, extractMsg, 1500);
    let extracted;
    try {
      const cleaned = extractedRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      extracted = JSON.parse(cleaned);
    } catch {
      extracted = [{ fact: extractedRaw, source: 'raw', relevance_to_job: 'general', strength: 5 }];
    }

    // Call 2: Strategic Assembly with the 4-part frame
    const assembleSystem = `You are writing a cover letter for Wolf Schram — a senior engineering leader applying for roles outside his original broadcast/media domain.

═══ THE STRATEGIC FRAME ═══

Wolf's subject matter IS leadership. The technology is the context.

This is NOT a candidate randomly applying and hoping it works. This is a deliberate, strategic application from someone whose entire career has been about building engineering cultures that deliver — regardless of the technology stack or industry.

═══ LETTERHEAD FORMAT (REQUIRED — EXACTLY AS SHOWN) ═══

${pi.full_name || 'Wolfgang Schram'}
${pi.city || 'Los Angeles'}, ${pi.state || 'California'} | ${pi.phone || '310-997-8359'} | ${pi.email || 'wolfbroadcast@gmail.com'} | ${pi.linkedin_url || 'https://www.linkedin.com/in/wolfgang-schram-a4837420/'}

${job.company}
[TODAY'S DATE]

Dear [Hiring Manager/Contact],

═══ LETTER STRUCTURE (4 PARTS — THIS ORDER) ═══

PART 1 — WHY THIS COMPANY (1-2 sentences)
Name something SPECIFIC about the company — a transformation they're going through, a growth moment, a strategic challenge. NOT generic praise. Show you read the room. Use the company research provided.

PART 2 — THE PROBLEM THEY HAVE (2-3 sentences)
Name the actual challenge this role exists to solve. Is it scaling engineering? Building culture after hyper-growth? Driving AI adoption? Merging teams post-acquisition? Be specific. This is where you show you understand what they need.

PART 3 — YOUR PROOF (1-2 paragraphs, this is the meat)
Connect Wolf's experience to their problem with CONCRETE examples:
- Numbers: 250 engineers, 55+ countries, $multi-million programs
- Specific stories: org mergers, GCC launches, ownership culture transformation
- The critical reframe: "I'm not a [their industry] specialist — I'm a leadership specialist who has delivered outcomes in environments far more complex and unforgiving than most."
- Pick the 2-3 most relevant proof points from the extracted evidence

PART 4 — THE OFFER (2-3 sentences)
What specifically you bring to their table. Not generic "leadership" — name it: ownership culture, developing engineering leaders, driving transformation without disruption, building self-organizing teams. End forward-looking.

═══ SIGN-OFF ═══

Best regards,
Wolf Schram

═══ CRITICAL RULES ═══
- Use ONLY facts from the provided extracted evidence — NEVER fabricate
- Professional but warm and direct tone — Wolf has ADHD and hates corporate fluff
- Letter body: 350-450 words (enough depth to be credible, short enough to be read)
- FORBIDDEN phrases: "I am excited to apply", "I believe I would be a great fit", "I am confident that", "unique opportunity", "passion for"
- The letter must PRE-EMPT the objection "he doesn't know our industry" — address it head-on, don't dodge it
- One sentence must explicitly state that leadership IS the subject matter expertise — say it directly, don't just imply it
- If the role is in an industry Wolf hasn't worked in, acknowledge it as a STRENGTH not a gap
- NEVER hedge with "Not software, but..." or "just in a different context" — OWN the transfer confidently
- Address to "Hiring Manager" unless a specific name is provided

═══ ANTI-DUPLICATION (variety across multiple letters) ═══
- When describing the Diversified experience, lead with the ASPECT most relevant to THIS role — don't always start with "250 engineers globally and merged two disciplines"
- Vary which proof stories you lead with: org merger, GCC India launch, Accountability Clarity Threshold, touring engineering, Senate systems — pick what fits THIS company best
- The Accountability Clarity Threshold framework is a signature tool — include it, but vary HOW you introduce it (sometimes as the problem it solves, sometimes as the result it delivered)
- Each letter should feel individually crafted, not templated
${research?.key_people ? `\nKey contacts at company: ${research.key_people}` : ''}`;

    const assembleMsg = `COMPANY: ${job.company}
ROLE: ${job.title}
DESCRIPTION: ${(job.description || '').slice(0, 1500)}
${research?.company_summary ? `\nCOMPANY RESEARCH:\n${research.company_summary}` : ''}
${research?.culture_notes ? `\nCULTURE: ${research.culture_notes}` : ''}
${research?.recent_news ? `\nRECENT NEWS: ${research.recent_news}` : ''}
${research?.research_notes ? `\nADDITIONAL CONTEXT: ${research.research_notes}` : ''}

EXTRACTED EVIDENCE (use the strongest proof points):
${JSON.stringify(extracted, null, 2)}

INSTRUCTION: Replace [TODAY'S DATE] with today's date formatted as "March 6, 2026". Use "Hiring Manager" unless you know a specific name from the research.

Write the cover letter now.`;

    const letter = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', assembleSystem, assembleMsg, 2500);

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
    db.prepare("UPDATE jobs SET status = 'COVER_LETTER_READY', date_updated = datetime('now') WHERE id = ? AND status IN ('SCORED', 'COVER_LETTER_QUEUED', 'GENERATION_FAILED', 'NEW')").run(jobId);

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
  ).all(parseInt(req.params.jobId, 10));
  json(res, { versions });
});

// POST /api/cover-letter/edit/:jobId — Edit existing cover letter version
addRoute('POST', '/api/cover-letter/edit/:jobId', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return json(res, { error: 'Anthropic API key not configured. Go to Settings tab.' }, 400);

  const jobId = parseInt(req.params.jobId, 10);
  const { version, instructions } = req.body;

  if (!version || !instructions) {
    return json(res, { error: 'Missing version or instructions' }, 400);
  }

  // Load the job
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return json(res, { error: 'Job not found' }, 404);

  // Load the existing cover letter version
  const existingLetter = db.prepare(
    'SELECT * FROM cover_letter_versions WHERE job_id = ? AND version = ?'
  ).get(jobId, version);
  if (!existingLetter) return json(res, { error: 'Cover letter version not found' }, 404);

  // Load personal info
  const piRows = db.prepare('SELECT key, value FROM personal_info').all();
  const pi = {};
  for (const r of piRows) pi[r.key] = r.value;

  // Load company research
  const research = db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(jobId);

  try {
    // Call Claude with edit instructions
    const editSystem = `You are a cover letter editor for Wolf Schram, a senior engineering leader whose subject matter IS leadership — technology is the context.

STRATEGIC FRAME (maintain throughout edits):
- The letter follows a 4-part structure: WHY THIS COMPANY → THE PROBLEM THEY HAVE → YOUR PROOF → THE OFFER
- The letter must pre-empt "he doesn't know our industry" — address it as a strength
- Concrete results and numbers matter more than adjectives
- Wolf hates corporate fluff — keep it direct, warm, authentic

Rules:
- Keep the letterhead EXACTLY as-is (name, location, phone, email, full LinkedIn URL, company, date, greeting)
- Keep the sign-off EXACTLY as-is (Best regards, Wolf Schram)
- Never shorten the LinkedIn URL or replace it with just "LinkedIn"
- Stay within 350-450 words for the body
- Apply the user's requested changes while maintaining the strategic frame
- If the user asks to strengthen something, use concrete proof from the context provided
- FORBIDDEN phrases: "I am excited to apply", "I believe I would be a great fit", "I am confident that", "unique opportunity", "passion for"
- If the user's edit would weaken the strategic positioning, apply the spirit of their request but keep the frame strong`;

    const editMsg = `EXISTING COVER LETTER:
${existingLetter.content}

COMPANY: ${job.company}
ROLE: ${job.title}

EDIT INSTRUCTIONS:
${instructions}

Apply the instructions above and provide the revised cover letter with the same letterhead and sign-off.`;

    const editedLetter = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', editSystem, editMsg, 2000);

    // Get next version number
    const lastVersion = db.prepare(
      'SELECT MAX(version) as v FROM cover_letter_versions WHERE job_id = ?'
    ).get(jobId);
    const newVersion = (lastVersion?.v || 0) + 1;

    // Save as new version
    const result = db.prepare(
      "INSERT INTO cover_letter_versions (job_id, version, content, model_used) VALUES (?, ?, ?, 'claude-sonnet-4-5-20250929')"
    ).run(jobId, newVersion, editedLetter);

    json(res, {
      success: true,
      version: newVersion,
      letter_id: result.lastInsertRowid,
      content: editedLetter,
      previous_version: version,
    });

  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// GET /api/cover-letter/export-docx/:jobId/:version — Export cover letter as formatted .docx
addRoute('GET', '/api/cover-letter/export-docx/:jobId/:version', async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const version = parseInt(req.params.version, 10);

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return json(res, { error: 'Job not found' }, 404);

  const letterRow = db.prepare('SELECT * FROM cover_letter_versions WHERE job_id = ? AND version = ?').get(jobId, version);
  if (!letterRow) return json(res, { error: 'Cover letter version not found' }, 404);

  try {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, ExternalHyperlink } = require('docx');

    // Parse letterhead from content (if present) or use personal info
    const piRows = db.prepare('SELECT key, value FROM personal_info').all();
    const pi = {};
    for (const r of piRows) pi[r.key] = r.value;

    const content = letterRow.content;

    // Build the docx with the letter content as-is (it already has letterhead from generation)
    const paragraphs = content.split('\n').map(line => {
      const trimmed = line.trim();
      // Detect letterhead lines (bold name, contact line)
      if (trimmed === (pi.full_name || 'Wolfgang Schram')) {
        return new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: trimmed, bold: true, size: 24, font: 'Arial' })]
        });
      }
      // Contact info line (contains | separators) — make email & LinkedIn clickable
      if (trimmed.includes('|') && (trimmed.includes('@') || trimmed.includes('linkedin'))) {
        const parts = trimmed.split('|').map(s => s.trim());
        const children = [];
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) children.push(new TextRun({ text: ' | ', size: 19, font: 'Arial', color: '555555' }));
          const part = parts[i];
          // Email — make clickable
          const emailMatch = part.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (emailMatch) {
            children.push(new ExternalHyperlink({
              children: [new TextRun({ text: emailMatch[1], style: 'Hyperlink', size: 19, font: 'Arial' })],
              link: 'mailto:' + emailMatch[1],
            }));
          // LinkedIn URL — make clickable
          } else if (part.match(/linkedin\.com/i)) {
            const url = part.startsWith('http') ? part : 'https://' + part;
            children.push(new ExternalHyperlink({
              children: [new TextRun({ text: part, style: 'Hyperlink', size: 19, font: 'Arial' })],
              link: url,
            }));
          } else {
            children.push(new TextRun({ text: part, size: 19, font: 'Arial', color: '555555' }));
          }
        }
        return new Paragraph({ spacing: { after: 200 }, children });
      }
      // Sign-off line
      if (trimmed === 'Best regards,' || trimmed === 'Sincerely,') {
        return new Paragraph({
          spacing: { before: 200, after: 40 },
          children: [new TextRun({ text: trimmed, size: 22, font: 'Arial' })]
        });
      }
      if (trimmed === 'Wolf Schram' || trimmed === 'Wolfgang Schram') {
        return new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: trimmed, bold: true, size: 22, font: 'Arial' })]
        });
      }
      // Empty line
      if (!trimmed) {
        return new Paragraph({ spacing: { after: 80 }, children: [] });
      }
      // Regular paragraph
      return new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: trimmed, size: 22, font: 'Arial' })]
      });
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children: paragraphs
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `Cover_Letter_${job.company.replace(/[^a-zA-Z0-9]/g, '_')}_v${version}.docx`;
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length
    });
    res.end(buffer);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// EXTERNAL JOB IMPORT (AI-parsed)
// ═══════════════════════════════════════════════════════════════════════

// POST /api/import/parse-jobs — Parse freeform text into structured job listings using AI
addRoute('POST', '/api/import/parse-jobs', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return json(res, { error: 'Anthropic API key not configured. Go to Settings tab.' }, 400);

  const { text } = req.body;
  if (!text || text.length < 30) return json(res, { error: 'Text too short — paste more content' }, 400);

  try {
    const systemPrompt = `You are a job listing parser. Extract structured job listings from unstructured text. The text may come from Claude, ChatGPT, LinkedIn, recruiter emails, job boards, or any other source.

For EACH job found, extract:
- company: Company name (required)
- title: Job title (required)
- location: City/state or "Remote" if mentioned
- url: Application URL or job posting URL if present
- description: Brief description of the role (2-3 sentences max, from whatever context is available)
- why_fit: Why this role might fit (if mentioned in the source text)
- salary: Salary range if mentioned
- source: Where this came from (e.g. "Claude search", "LinkedIn", "recruiter", "manual")

Output ONLY a valid JSON array. No markdown, no explanation. If no jobs are found, return [].

Example output:
[{"company":"Rivian","title":"VP of Engineering","location":"Irvine, CA (hybrid)","url":"","description":"Leading software platform engineering org of 200+ engineers through EV technology transformation.","why_fit":"Large team leadership, transformation focus","salary":"","source":"external_import"}]`;

    const rawResponse = await callClaude(apiKey, 'claude-sonnet-4-5-20250929', systemPrompt, text.slice(0, 15000), 4000);

    // Parse the JSON
    let jobs;
    try {
      const cleaned = rawResponse.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      jobs = JSON.parse(cleaned);
    } catch (parseErr) {
      return json(res, { error: 'AI returned invalid JSON. Try pasting cleaner text.', raw_preview: rawResponse.substring(0, 200) }, 400);
    }

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return json(res, { error: 'No jobs found in the text. Try a different format.' }, 400);
    }

    // Score each job using the profile scorer
    const scorer = PROFILE_SCORER || loadProfileScorer();
    for (const job of jobs) {
      job.source = job.source || 'external_import';
      if (scorer) {
        const title = (job.title || '').toLowerCase();
        const company = (job.company || '').toLowerCase();
        const jobText = `${title} ${job.description || ''} ${company}`;

        // Company skip list
        if (COMPANY_SKIP_LIST.some(skip => company.includes(skip))) {
          job.score = 0;
          job.skip_reason = 'company_skipped';
          continue;
        }
        // Title disqualifiers
        if (scorer.titleDisqualifiers && scorer.titleDisqualifiers.some(d => title.includes(d))) {
          job.score = 0;
          job.skip_reason = 'title_disqualified';
          continue;
        }

        let totalScore = 0;
        for (const [dimName, dim] of Object.entries(scorer)) {
          if (dimName === 'redFlags' || dimName === 'titleDisqualifiers') continue;
          if (!dim.terms || !dim.weight) continue;
          const matches = dim.terms.filter(t => jobText.includes(t));
          totalScore += Math.min(matches.length / 3, 1.0) * dim.weight;
        }
        const redFlags = (scorer.redFlags || []).filter(f => jobText.includes(f));
        totalScore -= redFlags.length * 8;
        const titleKeywords = ['vp', 'vice president', 'svp', 'cto', 'coo', 'head of engineering', 'senior director', 'director of engineering'];
        if (titleKeywords.some(k => title.includes(k))) totalScore += 15;
        job.score = Math.max(0, Math.min(Math.round((totalScore / 100) * 100), 100));
      } else {
        job.score = 50;
      }
    }

    // Check for duplicates against existing pipeline AND deleted/blacklisted jobs
    const existingJobs = db.prepare("SELECT company, title FROM jobs").all();
    const existingSet = new Set(existingJobs.map(j => `${j.company.toLowerCase()}|${j.title.toLowerCase()}`));
    let deletedSet = new Set();
    try {
      const deletedJobs = db.prepare("SELECT company, title FROM deleted_fingerprints").all();
      deletedSet = new Set(deletedJobs.map(j => `${j.company.toLowerCase()}|${j.title.toLowerCase()}`));
    } catch {}
    for (const job of jobs) {
      const key = `${(job.company || '').toLowerCase()}|${(job.title || '').toLowerCase()}`;
      job.is_duplicate = existingSet.has(key) || deletedSet.has(key);
    }

    json(res, { jobs, count: jobs.length });

  } catch (e) {
    console.error('[Import Parse] Error:', e.message);
    json(res, { error: e.message }, 500);
  }
});

// POST /api/import/add-jobs — Add parsed jobs to the pipeline
addRoute('POST', '/api/import/add-jobs', async (req, res) => {
  const { jobs } = req.body;
  if (!Array.isArray(jobs) || jobs.length === 0) return json(res, { error: 'No jobs provided' }, 400);

  let added = 0;
  let skipped = 0;
  const errors = [];

  for (const job of jobs) {
    if (!job.company || !job.title) { skipped++; continue; }

    // Dedup check
    const existing = db.prepare(
      "SELECT id FROM jobs WHERE LOWER(company) = LOWER(?) AND LOWER(title) = LOWER(?)"
    ).get(job.company, job.title);
    if (existing) { skipped++; continue; }

    try {
      const fingerprint = `${job.company}|${job.title}`.toLowerCase().replace(/[^a-z0-9|]/g, '');
      const noteParts = [];
      if (job.location) noteParts.push(`Location: ${job.location}`);
      if (job.why_fit) noteParts.push(job.why_fit);
      if (job.salary) noteParts.push(`Salary: ${job.salary}`);
      db.prepare(`
        INSERT INTO jobs (company, title, description, status, score, score_reasoning, source, url, notes, job_fingerprint)
        VALUES (?, ?, ?, 'SCORED', ?, ?, ?, ?, ?, ?)
      `).run(
        job.company,
        job.title,
        job.description || null,
        job.score || null,
        job.why_fit || null,
        job.source || 'external_import',
        job.url || null,
        noteParts.length ? noteParts.join('\n') : null,
        fingerprint
      );
      added++;
    } catch (e) {
      errors.push(`${job.company} — ${job.title}: ${e.message}`);
    }
  }

  json(res, { added, skipped, errors: errors.length ? errors : undefined, message: `Added ${added}, skipped ${skipped} duplicates` });
});

// ═══════════════════════════════════════════════════════════════════════
// GMAIL EMAIL INTEGRATION
// ═══════════════════════════════════════════════════════════════════════

// Ensure email_messages table exists (additive migration)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gmail_id TEXT UNIQUE,
      thread_id TEXT,
      subject TEXT,
      sender TEXT,
      sender_email TEXT,
      snippet TEXT,
      body_preview TEXT,
      received_at TEXT,
      matched_job_id INTEGER REFERENCES jobs(id),
      match_confidence TEXT CHECK(match_confidence IN ('high','medium','low','none')),
      response_type TEXT CHECK(response_type IN ('application_received','interview','rejection','offer','follow_up','unknown')),
      verification_code TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_messages_gmail_id ON email_messages(gmail_id);
    CREATE INDEX IF NOT EXISTS idx_email_messages_matched_job ON email_messages(matched_job_id);
    CREATE INDEX IF NOT EXISTS idx_email_messages_received ON email_messages(received_at);
  `);
} catch (e) { console.warn('  ⚠ email_messages table:', e.message); }

// Migration: add dismissed + important columns
try { db.exec("ALTER TABLE email_messages ADD COLUMN dismissed INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
try { db.exec("ALTER TABLE email_messages ADD COLUMN important INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }

// Ensure application_questions table exists
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      category TEXT DEFAULT 'general',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
} catch (e) { console.warn('  ⚠ application_questions table:', e.message); }

// Helper: get a fresh Gmail access token using the refresh token
async function getGmailAccessToken() {
  const env = loadEnv();
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  const clientId = env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;

  // Check if existing access token is still valid (simple time check)
  if (env.GOOGLE_ACCESS_TOKEN && env.GOOGLE_TOKEN_EXPIRY) {
    const expiry = parseInt(env.GOOGLE_TOKEN_EXPIRY, 10);
    if (Date.now() < expiry - 60000) return env.GOOGLE_ACCESS_TOKEN;
  }

  const https = require('https');
  const postData = `refresh_token=${encodeURIComponent(refreshToken)}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token`;
  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(postData) },
    }, resp => {
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid token response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Token refresh timeout')); });
    req.write(postData);
    req.end();
  });

  if (result.access_token) {
    env.GOOGLE_ACCESS_TOKEN = result.access_token;
    env.GOOGLE_TOKEN_EXPIRY = String(Date.now() + (result.expires_in || 3600) * 1000);
    saveEnv(env);
    return result.access_token;
  }
  throw new Error(result.error_description || result.error || 'Token refresh failed');
}

// Helper: call Gmail API
async function gmailApi(accessToken, endpoint, method = 'GET') {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'gmail.googleapis.com', path: `/gmail/v1/users/me/${endpoint}`, method,
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
    }, resp => {
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => {
        if (resp.statusCode === 200) {
          try { resolve(JSON.parse(body)); } catch { resolve(body); }
        } else {
          reject(new Error(`Gmail API ${resp.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Gmail API timeout')); });
    req.end();
  });
}

// Helper: classify email response type based on subject/snippet
function classifyEmail(subject, snippet, body) {
  const text = `${subject} ${snippet} ${body}`.toLowerCase();
  if (/interview|schedule.*call|meet.*team|phone.*screen|video.*call|zoom.*link|calendar.*invite/i.test(text)) return 'interview';
  if (/unfortunately|regret|not.*moving forward|decided.*not|other candidates|not.*selected|position.*filled/i.test(text)) return 'rejection';
  if (/offer|compensation|salary|start date|congratulations.*position|pleased.*offer/i.test(text)) return 'offer';
  if (/thank.*appl|received.*application|application.*received|confirm.*receipt|successfully.*submitted/i.test(text)) return 'application_received';
  if (/follow.?up|checking in|status.*update|additional.*information|next.*steps/i.test(text)) return 'follow_up';
  return 'unknown';
}

// Helper: extract verification codes from email text
function extractVerificationCode(subject, snippet, body) {
  const text = `${subject} ${snippet} ${body || ''}`;
  // Common patterns: 6-digit codes, 4-digit codes, hyphenated codes
  const patterns = [
    /(?:verification|confirm|code|pin|otp)[:\s]*(\d{4,8})/i,
    /(\d{6})(?:\s|$|\.)/,
    /(\d{4}[-]\d{4})/,
    /(?:code|pin).*?(\d{4,6})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  // Check for confirmation links
  const linkMatch = text.match(/(https?:\/\/[^\s]+(?:confirm|verify|activate)[^\s]*)/i);
  if (linkMatch) return `LINK:${linkMatch[1]}`;
  return null;
}

// Helper: match email to a job application
function matchEmailToJob(senderEmail, subject, snippet) {
  const text = `${subject} ${snippet}`.toLowerCase();
  // Get all submitted/applied jobs
  const jobs = db.prepare(
    "SELECT j.id, j.company, j.title FROM jobs j WHERE j.status IN ('SUBMITTED','CLOSED','SUBMITTING','APPROVED','PENDING_APPROVAL') ORDER BY j.date_updated DESC"
  ).all();

  for (const job of jobs) {
    const company = (job.company || '').toLowerCase();
    const companyWords = company.split(/\s+/).filter(w => w.length > 2);
    // Check if company name appears in sender email domain or subject/snippet
    const senderDomain = (senderEmail || '').toLowerCase();
    const companySlug = company.replace(/[^a-z0-9]/g, '');
    if (senderDomain.includes(companySlug) || companyWords.some(w => text.includes(w) || senderDomain.includes(w))) {
      return { job_id: job.id, confidence: senderDomain.includes(companySlug) ? 'high' : 'medium' };
    }
  }
  return { job_id: null, confidence: 'none' };
}

// GET /api/email/status — Check Gmail integration status
addRoute('GET', '/api/email/status', async (req, res) => {
  const env = loadEnv();
  const hasCredentials = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const hasRefreshToken = !!env.GOOGLE_REFRESH_TOKEN;
  let connected = false;
  let email = null;

  if (hasRefreshToken) {
    try {
      const token = await getGmailAccessToken();
      if (token) {
        const profile = await gmailApi(token, 'profile');
        connected = true;
        email = profile.emailAddress;
      }
    } catch {}
  }

  const totalEmails = db.prepare('SELECT COUNT(*) as c FROM email_messages').get();
  const matchedEmails = db.prepare('SELECT COUNT(*) as c FROM email_messages WHERE matched_job_id IS NOT NULL').get();
  const lastScan = db.prepare('SELECT MAX(created_at) as last FROM email_messages').get();

  json(res, {
    has_credentials: hasCredentials,
    has_refresh_token: hasRefreshToken,
    connected,
    email,
    total_emails: totalEmails.c,
    matched_emails: matchedEmails.c,
    last_scan: lastScan.last,
  });
});

// POST /api/email/scan — Scan Gmail for job-related emails (last 30 days)
addRoute('POST', '/api/email/scan', async (req, res) => {
  let accessToken;
  try {
    accessToken = await getGmailAccessToken();
  } catch (e) {
    return json(res, { error: 'Gmail not authorized. Go to Settings → Authorize Gmail Access.', details: e.message }, 401);
  }
  if (!accessToken) return json(res, { error: 'Gmail not configured. Add Google OAuth credentials in Settings.' }, 400);

  const daysBack = parseInt(req.body.days_back || '30', 10);
  const afterDate = new Date(Date.now() - daysBack * 86400000);
  const afterEpoch = Math.floor(afterDate.getTime() / 1000);

  // Search for job-related emails
  const queries = [
    'subject:(application OR applied OR interview OR position OR opportunity OR candidate)',
    'from:(careers OR recruiting OR talent OR hiring OR jobs OR noreply OR no-reply)',
  ];

  try {
    let allMessageIds = [];
    for (const q of queries) {
      const searchQuery = encodeURIComponent(`${q} after:${afterEpoch}`);
      const result = await gmailApi(accessToken, `messages?q=${searchQuery}&maxResults=100`);
      if (result.messages) {
        allMessageIds.push(...result.messages.map(m => m.id));
      }
    }
    // Deduplicate
    allMessageIds = [...new Set(allMessageIds)];

    let newCount = 0, matchedCount = 0, skippedCount = 0;

    for (const msgId of allMessageIds) {
      // Skip if already scanned
      const existing = db.prepare('SELECT id FROM email_messages WHERE gmail_id = ?').get(msgId);
      if (existing) { skippedCount++; continue; }

      // Fetch message details
      const msg = await gmailApi(accessToken, `messages/${msgId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
      const headers = msg.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const fromHeader = headers.find(h => h.name === 'From')?.value || '';
      const dateHeader = headers.find(h => h.name === 'Date')?.value || '';

      // Parse sender
      const emailMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s<]+@[^\s>]+)/);
      const senderEmail = emailMatch ? emailMatch[1] : fromHeader;
      const senderName = fromHeader.replace(/<[^>]+>/, '').trim().replace(/"/g, '');

      const snippet = msg.snippet || '';

      // Classify and match
      const responseType = classifyEmail(subject, snippet, '');
      const match = matchEmailToJob(senderEmail, subject, snippet);

      // Parse date
      let receivedAt;
      try {
        receivedAt = new Date(dateHeader).toISOString().replace('T', ' ').split('.')[0];
      } catch {
        receivedAt = new Date(parseInt(msg.internalDate, 10)).toISOString().replace('T', ' ').split('.')[0];
      }

      const verificationCode = extractVerificationCode(subject, snippet, '');
      db.prepare(`
        INSERT INTO email_messages (gmail_id, thread_id, subject, sender, sender_email, snippet, received_at, matched_job_id, match_confidence, response_type, verification_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(msgId, msg.threadId, subject, senderName, senderEmail, snippet, receivedAt, match.job_id, match.confidence, responseType, verificationCode);

      newCount++;
      if (match.job_id) {
        matchedCount++;
        // Auto-update submission response_type if we have a high-confidence match
        if (match.confidence === 'high' && responseType !== 'unknown' && responseType !== 'application_received') {
          const sub = db.prepare(
            'SELECT id, response_type FROM application_submissions WHERE job_id = ? ORDER BY submitted_at DESC LIMIT 1'
          ).get(match.job_id);
          if (sub && sub.response_type === 'none') {
            db.prepare("UPDATE application_submissions SET response_type = ?, response_date = datetime('now') WHERE id = ?")
              .run(responseType, sub.id);
          }
        }
      }
    }

    json(res, {
      success: true,
      total_found: allMessageIds.length,
      new_emails: newCount,
      matched: matchedCount,
      skipped: skippedCount,
    });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

// GET /api/email/messages — List scanned emails
addRoute('GET', '/api/email/messages', (req, res, query) => {
  let sql = `SELECT e.*, j.company, j.title FROM email_messages e LEFT JOIN jobs j ON e.matched_job_id = j.id WHERE 1=1`;
  const params = [];
  // By default hide dismissed; show_dismissed=true to see them
  if (query.show_dismissed === 'true') { /* show all */ }
  else if (query.dismissed_only === 'true') { sql += ' AND e.dismissed = 1'; }
  else { sql += ' AND (e.dismissed = 0 OR e.dismissed IS NULL)'; }
  if (query.important === 'true') { sql += ' AND e.important = 1'; }
  if (query.matched === 'true') { sql += ' AND e.matched_job_id IS NOT NULL'; }
  if (query.matched === 'false') { sql += ' AND e.matched_job_id IS NULL'; }
  if (query.response_type) { sql += ' AND e.response_type = ?'; params.push(query.response_type); }
  sql += ' ORDER BY e.received_at DESC';
  const limit = Math.min(parseInt(query.limit || '200', 10), 500);
  sql += ' LIMIT ?'; params.push(limit);
  json(res, db.prepare(sql).all(...params));
});

// PUT /api/email/messages/:id — Update email match/classification
addRoute('PUT', '/api/email/messages/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const email = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id);
  if (!email) return json(res, { error: 'Email not found' }, 404);
  const fields = ['matched_job_id', 'match_confidence', 'response_type', 'is_read', 'dismissed', 'important'];
  const updates = [], values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return json(res, { error: 'No fields to update' }, 400);
  values.push(id);
  db.prepare(`UPDATE email_messages SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  json(res, db.prepare('SELECT e.*, j.company, j.title FROM email_messages e LEFT JOIN jobs j ON e.matched_job_id = j.id WHERE e.id = ?').get(id));
});

// GET /api/email/summary — Summary stats for email tab
addRoute('GET', '/api/email/summary', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM email_messages').get();
  const visible = db.prepare('SELECT COUNT(*) as c FROM email_messages WHERE dismissed = 0 OR dismissed IS NULL').get();
  const dismissed = db.prepare('SELECT COUNT(*) as c FROM email_messages WHERE dismissed = 1').get();
  const important = db.prepare('SELECT COUNT(*) as c FROM email_messages WHERE important = 1').get();
  const matched = db.prepare('SELECT COUNT(*) as c FROM email_messages WHERE matched_job_id IS NOT NULL').get();
  const byType = db.prepare('SELECT response_type, COUNT(*) as count FROM email_messages GROUP BY response_type ORDER BY count DESC').all();
  const recent = db.prepare(`
    SELECT e.*, j.company, j.title FROM email_messages e
    LEFT JOIN jobs j ON e.matched_job_id = j.id
    WHERE (e.dismissed = 0 OR e.dismissed IS NULL)
    ORDER BY e.received_at DESC LIMIT 200
  `).all();
  json(res, { total: total.c, visible: visible.c, dismissed: dismissed.c, important: important.c, matched: matched.c, by_type: byType, recent });
});

// ─── Application Questions ──────────────────────────────────────────
addRoute('GET', '/api/application-questions', (req, res) => {
  const rows = db.prepare('SELECT key, value, category FROM application_questions ORDER BY category, key').all();
  const obj = {};
  for (const r of rows) obj[r.key] = { value: r.value, category: r.category };
  json(res, obj);
});

addRoute('PUT', '/api/application-questions', async (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO application_questions (key, value, category, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category, updated_at = datetime('now')
  `);
  const entries = Object.entries(req.body);
  if (!entries.length) return json(res, { error: 'No fields provided' }, 400);
  for (const [k, v] of entries) {
    if (typeof v === 'object' && v !== null) {
      upsert.run(k, v.value || '', v.category || 'general');
    } else {
      upsert.run(k, String(v), 'general');
    }
  }
  const rows = db.prepare('SELECT key, value, category FROM application_questions ORDER BY category, key').all();
  const obj = {};
  for (const r of rows) obj[r.key] = { value: r.value, category: r.category };
  json(res, obj);
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
        try {
          req.body = await parseBody(req);
        } catch (parseErr) {
          return json(res, { error: parseErr.message }, 400);
        }
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

  // Serve static files from public/ (prevent path traversal)
  const staticPath = path.resolve(publicDir, pathname.slice(1));
  if (staticPath.startsWith(publicDir) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    return serveFile(res, staticPath);
  }

  json(res, { error: 'Not found' }, 404);
});

server.on('error', (err) => {
  console.error('⚠ Server error:', err.message);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✓ Job Pipeline Server v2 running');
  console.log(`  ✓ Command Center: http://localhost:${PORT}`);
  console.log(`  ✓ Old Dashboard:  http://localhost:${PORT}/v1`);
  console.log(`  ✓ API:            http://localhost:${PORT}/api/stats`);
  console.log(`  ✓ Health:         http://localhost:${PORT}/api/health`);

  // Start conductor inline (polling loop + auto-queue + stall detection)
  try {
    conductor.start();
    console.log('  ✓ Conductor started (5s polling, auto-queue, circuit breaker)');
  } catch (e) {
    console.error('  ⚠ Conductor failed to start:', e.message);
  }
  console.log('');
});

// ─── Crash Protection ────────────────────────────────────────────────
process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

process.on('uncaughtException', (err) => {
  console.error('⚠ Uncaught exception (server kept alive):', err.message);
  console.error(err.stack);
  // Don't crash — log and continue
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠ Unhandled promise rejection (server kept alive):', reason);
  // Don't crash — log and continue
});
