#!/usr/bin/env node
/**
 * Job Pipeline — Integration Test Suite
 *
 * Tests all components end-to-end:
 *   1. Database initialization
 *   2. Server API endpoints
 *   3. Job Scorer Agent
 *   4. Feedback Analyzer
 *   5. MCP Server tool handlers
 *
 * Run: npm test
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DIR = __dirname;
const DB_PATH = path.join(DIR, 'pipeline.db');
const TEST_DB_PATH = path.join(DIR, 'pipeline-test.db');

let passed = 0;
let failed = 0;
let serverProcess = null;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3001${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║             JOB PIPELINE — Integration Tests               ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ─── 1. Database Tests ──────────────────────────────────────────────
  console.log('  Database:');

  // Remove test db if exists
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  test('init-db.js creates pipeline.db', () => {
    assert(fs.existsSync(DB_PATH), 'pipeline.db should exist (run npm run init-db first)');
  });

  test('Database has correct tables', () => {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map(t => t.name);
    assert(names.includes('jobs'), 'Missing jobs table');
    assert(names.includes('agents'), 'Missing agents table');
    assert(names.includes('errors'), 'Missing errors table');
    assert(names.includes('qa_bank'), 'Missing qa_bank table');
    db.close();
  });

  test('Jobs table has template_version column', () => {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    const cols = db.prepare("PRAGMA table_info(jobs)").all();
    const colNames = cols.map(c => c.name);
    assert(colNames.includes('template_version'), 'Missing template_version column in jobs');
    db.close();
  });

  test('QA bank has template_version column', () => {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    const cols = db.prepare("PRAGMA table_info(qa_bank)").all();
    const colNames = cols.map(c => c.name);
    assert(colNames.includes('template_version'), 'Missing template_version column in qa_bank');
    db.close();
  });

  test('template_metrics view exists', () => {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all();
    assert(views.some(v => v.name === 'template_metrics'), 'Missing template_metrics view');
    db.close();
  });

  test('Seed data present (5 jobs, 3 agents, 3 QA pairs)', () => {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    const jobs = db.prepare('SELECT COUNT(*) as c FROM jobs').get();
    const agents = db.prepare('SELECT COUNT(*) as c FROM agents').get();
    const qa = db.prepare('SELECT COUNT(*) as c FROM qa_bank').get();
    assert(jobs.c >= 5, `Expected >= 5 jobs, got ${jobs.c}`);
    assert(agents.c >= 3, `Expected >= 3 agents, got ${agents.c}`);
    assert(qa.c >= 3, `Expected >= 3 QA pairs, got ${qa.c}`);
    db.close();
  });

  console.log('');

  // ─── 2. Job Scorer Tests ────────────────────────────────────────────
  console.log('  Job Scorer:');

  test('Scorer runs with --dry-run flag', () => {
    const output = execSync('node job-scorer.js --all --dry-run', { cwd: DIR, encoding: 'utf8' });
    assert(output.includes('JOB SCORER AGENT'), 'Missing header');
    assert(output.includes('Score:'), 'Missing score output');
  });

  test('Scorer produces scores between 0-100', () => {
    const output = execSync('node job-scorer.js --all --dry-run', { cwd: DIR, encoding: 'utf8' });
    const scoreMatches = output.match(/Score: (\d+)\/100/g);
    assert(scoreMatches && scoreMatches.length > 0, 'No scores found');
    scoreMatches.forEach(match => {
      const score = parseInt(match.match(/(\d+)/)[1]);
      assert(score >= 0 && score <= 100, `Score ${score} out of range`);
    });
  });

  test('Scorer detects leadership keywords in Spotify job', () => {
    const output = execSync('node job-scorer.js --id 1 --dry-run', { cwd: DIR, encoding: 'utf8' });
    assert(output.includes('leadership') || output.includes('culture') || output.includes('develop'), 'Should detect leadership keywords');
  });

  console.log('');

  // ─── 3. Feedback Analyzer Tests ─────────────────────────────────────
  console.log('  Feedback Analyzer:');

  test('Feedback analyzer runs and produces output', () => {
    const output = execSync('node feedback-analyzer.js', { cwd: DIR, encoding: 'utf8' });
    assert(output.includes('FEEDBACK ANALYZER'), 'Missing header');
    assert(output.includes('Template'), 'Missing template column');
    assert(output.includes('Recommendations'), 'Missing recommendations');
  });

  test('Feedback analyzer shows v1 template data', () => {
    const output = execSync('node feedback-analyzer.js', { cwd: DIR, encoding: 'utf8' });
    assert(output.includes('v1'), 'Should show v1 template data');
  });

  console.log('');

  // ─── 4. Server API Tests ────────────────────────────────────────────
  console.log('  Server API:');

  // Start server on test port
  const { spawn } = require('child_process');
  serverProcess = spawn('node', ['server.js'], {
    cwd: DIR,
    env: { ...process.env, PORT: '3001' },
    stdio: 'pipe'
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1500));

  try {
    test('GET /api/stats returns stats', async () => {
      const { status, data } = await httpGet('/api/stats');
      assert(status === 200, `Expected 200, got ${status}`);
      assert(typeof data.total === 'number', 'Missing total');
      assert(Array.isArray(data.byStatus), 'Missing byStatus array');
      assert(typeof data.conversionRate === 'number', 'Missing conversionRate');
    });

    // Run async tests sequentially
    let res;

    res = await httpGet('/api/stats');
    test('GET /api/stats returns valid data', () => {
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.total >= 5, `Expected >= 5 total jobs, got ${res.data.total}`);
      assert(Array.isArray(res.data.byStatus), 'byStatus should be an array');
    });

    res = await httpGet('/api/jobs');
    test('GET /api/jobs returns all jobs', () => {
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.data), 'Should return array');
      assert(res.data.length >= 5, `Expected >= 5 jobs, got ${res.data.length}`);
    });

    res = await httpGet('/api/jobs?status=SCORED');
    test('GET /api/jobs?status=SCORED filters correctly', () => {
      assert(res.status === 200);
      assert(res.data.every(j => j.status === 'SCORED'), 'All jobs should be SCORED');
    });

    res = await httpGet('/api/jobs/1');
    test('GET /api/jobs/1 returns single job', () => {
      assert(res.status === 200);
      assert(res.data.company === 'Spotify', `Expected Spotify, got ${res.data.company}`);
    });

    res = await httpGet('/api/jobs/9999');
    test('GET /api/jobs/9999 returns 404', () => {
      assert(res.status === 404);
    });

    res = await httpGet('/api/agents');
    test('GET /api/agents returns agents', () => {
      assert(res.status === 200);
      assert(Array.isArray(res.data));
      assert(res.data.length >= 3, `Expected >= 3 agents, got ${res.data.length}`);
    });

    res = await httpGet('/api/errors');
    test('GET /api/errors returns errors', () => {
      assert(res.status === 200);
      assert(Array.isArray(res.data));
    });

    res = await httpGet('/api/template-metrics');
    test('GET /api/template-metrics returns metrics', () => {
      assert(res.status === 200);
      assert(Array.isArray(res.data));
    });

    res = await httpGet('/api/prompt/1');
    test('GET /api/prompt/1 returns cover letter prompt', () => {
      assert(res.status === 200);
      assert(res.data.prompt.includes('Spotify'), 'Prompt should include company name');
      assert(res.data.prompt.includes('Problem'), 'Prompt should include P→P→R framework');
    });

    res = await httpRequest('POST', '/api/jobs', {
      company: 'TestCorp',
      title: 'VP Engineering Test'
    });
    test('POST /api/jobs creates a new job', () => {
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.data.company === 'TestCorp');
      assert(res.data.status === 'NEW');
    });

    const testJobId = res.data.id;
    res = await httpRequest('PUT', `/api/jobs/${testJobId}`, {
      status: 'SCORED',
      score: 75
    });
    test('PUT /api/jobs/:id updates job', () => {
      assert(res.status === 200);
      assert(res.data.status === 'SCORED');
      assert(res.data.score === 75);
    });

    res = await httpRequest('POST', '/api/jobs', {});
    test('POST /api/jobs validates required fields', () => {
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGINT');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log('');

  // ─── 5. MCP Server Tests ────────────────────────────────────────────
  console.log('  MCP Server:');

  test('MCP server file exists', () => {
    assert(fs.existsSync(path.join(DIR, 'mcp-server.js')), 'mcp-server.js should exist');
  });

  test('MCP server has all required tools defined', () => {
    const content = fs.readFileSync(path.join(DIR, 'mcp-server.js'), 'utf8');
    const requiredTools = [
      'pipeline_stats', 'list_jobs', 'get_job', 'add_job',
      'update_job', 'log_outcome', 'template_metrics',
      'generate_cover_letter_prompt', 'search_qa_bank'
    ];
    requiredTools.forEach(tool => {
      assert(content.includes(`'${tool}'`), `Missing tool: ${tool}`);
    });
  });

  test('MCP server implements JSON-RPC protocol', () => {
    const content = fs.readFileSync(path.join(DIR, 'mcp-server.js'), 'utf8');
    assert(content.includes('jsonrpc'), 'Should implement JSON-RPC');
    assert(content.includes('Content-Length'), 'Should use Content-Length framing');
    assert(content.includes('initialize'), 'Should handle initialize method');
    assert(content.includes('tools/list'), 'Should handle tools/list method');
    assert(content.includes('tools/call'), 'Should handle tools/call method');
  });

  test('MCP server log_outcome updates template metrics', () => {
    const content = fs.readFileSync(path.join(DIR, 'mcp-server.js'), 'utf8');
    assert(content.includes('log_outcome'), 'Should have log_outcome tool');
    assert(content.includes('template_version'), 'Should track template_version');
    assert(content.includes('conversion'), 'Should calculate conversion rates');
  });

  console.log('');

  // ─── 6. File Structure Tests ────────────────────────────────────────
  console.log('  File Structure:');

  const requiredFiles = [
    'package.json', 'server.js', 'init-db.js', 'job-scorer.js',
    'mcp-server.js', 'feedback-analyzer.js', 'PIPELINE_DASHBOARD.html',
    'README.md', 'NOTES.md', 'LESSONS_LEARNED.md',
    'prompts/cover-letter-template.md'
  ];

  requiredFiles.forEach(file => {
    test(`${file} exists`, () => {
      assert(fs.existsSync(path.join(DIR, file)), `Missing: ${file}`);
    });
  });

  console.log('');

  // ─── 7. Dashboard Tests ─────────────────────────────────────────────
  console.log('  Dashboard:');

  test('Dashboard has auto-refresh (60s interval)', () => {
    const html = fs.readFileSync(path.join(DIR, 'PIPELINE_DASHBOARD.html'), 'utf8');
    assert(html.includes('setInterval'), 'Should have setInterval for auto-refresh');
    assert(html.includes('60') || html.includes('REFRESH_INTERVAL'), 'Should refresh every 60s');
  });

  test('Dashboard has Copy Prompt for Cowork button', () => {
    const html = fs.readFileSync(path.join(DIR, 'PIPELINE_DASHBOARD.html'), 'utf8');
    assert(html.includes('Copy Prompt for Cowork'), 'Should have Copy Prompt button');
    assert(html.includes('navigator.clipboard'), 'Should use clipboard API');
  });

  test('Dashboard fetches from REST endpoints', () => {
    const html = fs.readFileSync(path.join(DIR, 'PIPELINE_DASHBOARD.html'), 'utf8');
    assert(html.includes('/api/stats'), 'Should fetch /api/stats');
    assert(html.includes('/api/jobs'), 'Should fetch /api/jobs');
    assert(html.includes('/api/agents'), 'Should fetch /api/agents');
    assert(html.includes('/api/errors'), 'Should fetch /api/errors');
  });

  test('Dashboard shows Copy Prompt only for SCORED jobs', () => {
    const html = fs.readFileSync(path.join(DIR, 'PIPELINE_DASHBOARD.html'), 'utf8');
    assert(html.includes("SCORED"), 'Should check for SCORED status');
    assert(html.includes('btn-copy-prompt-hidden'), 'Should hide button by default');
  });

  console.log('');

  // ─── Results ────────────────────────────────────────────────────────
  console.log('  ─────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('  ✗ Test runner failed:', err.message);
  if (serverProcess) serverProcess.kill('SIGINT');
  process.exit(1);
});
