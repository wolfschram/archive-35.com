#!/usr/bin/env node
/**
 * Feedback Analyzer — Phase 6 Future-Proofing
 *
 * Aggregates success rates grouped by template_version.
 * Shows which Problem→Product→Result opening hook yields
 * the highest interview conversion rate.
 *
 * Run: npm run analyze
 *      node feedback-analyzer.js
 *
 * Future: This will be called by the Feedback Analyzer MCP tool
 * when it logs a rejection or interview request.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'pipeline.db');

try {
  var db = new Database(DB_PATH, { readonly: true });
} catch (err) {
  console.error('\n  ✗ pipeline.db not found. Run: npm run init-db\n');
  process.exit(1);
}

// ─── Template Version Metrics ────────────────────────────────────────

console.log('');
console.log('  ╔══════════════════════════════════════════════════════════════╗');
console.log('  ║          FEEDBACK ANALYZER — Template Version Metrics       ║');
console.log('  ╚══════════════════════════════════════════════════════════════╝');
console.log('');

const metrics = db.prepare(`
  SELECT
    template_version,
    COUNT(*) as total_jobs,
    COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')) as total_applied,
    COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) as interviews,
    COUNT(*) FILTER (WHERE status = 'OFFER') as offers,
    COUNT(*) FILTER (WHERE status = 'REJECTED') as rejections,
    ROUND(
      CAST(COUNT(*) FILTER (WHERE status IN ('INTERVIEW','OFFER')) AS REAL) /
      NULLIF(COUNT(*) FILTER (WHERE status IN ('APPLIED','INTERVIEW','REJECTED','OFFER')), 0) * 100,
      1
    ) as conversion_rate
  FROM jobs
  GROUP BY template_version
  ORDER BY conversion_rate DESC
`).all();

if (metrics.length === 0) {
  console.log('  No job data found. Add jobs to the pipeline first.\n');
  process.exit(0);
}

// Table header
const header = '  Template    | Jobs | Applied | Interviews | Offers | Rejected | Conv. Rate';
const divider = '  ' + '─'.repeat(header.length - 2);
console.log(header);
console.log(divider);

metrics.forEach(m => {
  const ver = (m.template_version || 'unknown').padEnd(11);
  const total = String(m.total_jobs).padStart(4);
  const applied = String(m.total_applied).padStart(7);
  const interviews = String(m.interviews).padStart(10);
  const offers = String(m.offers).padStart(6);
  const rejections = String(m.rejections).padStart(8);
  const rate = m.conversion_rate !== null ? `${m.conversion_rate}%`.padStart(10) : '       N/A';
  console.log(`  ${ver} |${total} |${applied} |${interviews} |${offers} |${rejections} |${rate}`);
});

console.log(divider);
console.log('');

// ─── Best Performing Template ────────────────────────────────────────
const best = metrics.find(m => m.conversion_rate !== null);
if (best && best.conversion_rate > 0) {
  console.log(`  ★ Best performing template: ${best.template_version} (${best.conversion_rate}% interview conversion)`);
} else {
  console.log('  ★ No conversions tracked yet. Keep applying!');
}

// ─── Status Distribution ────────────────────────────────────────────
console.log('');
console.log('  Status Distribution:');

const statusCounts = db.prepare(`
  SELECT status, COUNT(*) as count FROM jobs GROUP BY status
  ORDER BY CASE status
    WHEN 'NEW' THEN 1 WHEN 'SCRAPED' THEN 2 WHEN 'SCORED' THEN 3
    WHEN 'APPLIED' THEN 4 WHEN 'INTERVIEW' THEN 5 WHEN 'OFFER' THEN 6
    WHEN 'REJECTED' THEN 7
  END
`).all();

const maxCount = Math.max(...statusCounts.map(s => s.count));
statusCounts.forEach(s => {
  const bar = '█'.repeat(Math.round((s.count / maxCount) * 20));
  const padding = ' '.repeat(20 - bar.length);
  console.log(`  ${s.status.padEnd(10)} ${bar}${padding} ${s.count}`);
});

console.log('');

// ─── Recommendations ────────────────────────────────────────────────
const totalApplied = metrics.reduce((sum, m) => sum + m.total_applied, 0);
const totalInterviews = metrics.reduce((sum, m) => sum + m.interviews, 0);
const overallRate = totalApplied > 0 ? Math.round((totalInterviews / totalApplied) * 100) : 0;

console.log('  Recommendations:');
if (overallRate >= 30) {
  console.log('  → Excellent conversion rate! Current P→P→R hooks are working well.');
} else if (overallRate >= 15) {
  console.log('  → Good conversion rate. Consider A/B testing a new opening hook.');
} else if (totalApplied > 5) {
  console.log('  → Low conversion rate. Time to iterate on the P→P→R opening hook.');
  console.log('  → Try creating a v2 template with a different lead story.');
} else {
  console.log('  → Not enough data yet. Keep applying and tracking results.');
}

console.log('');

db.close();
