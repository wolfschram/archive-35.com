#!/usr/bin/env node
/**
 * Job Scorer Agent
 *
 * Scores job descriptions against Wolf's profile using keyword matching
 * and weighted criteria. No external AI API needed — runs locally.
 *
 * Scoring dimensions:
 *   - Leadership fit (servant leadership, people development, empowerment)
 *   - Seniority match (VP, SVP, Director, C-level)
 *   - Industry relevance (broadcast, media, streaming, technology)
 *   - Culture signals (ownership, autonomy, growth, development)
 *   - Red flags (micromanagement, "hold accountable", "move fast break things")
 *   - Compensation alignment (salary range indicators)
 *   - Location match (LA, remote, hybrid)
 *
 * Usage:
 *   node job-scorer.js              # Score all NEW jobs
 *   node job-scorer.js --all        # Re-score all jobs
 *   node job-scorer.js --id 3       # Score a specific job
 *   node job-scorer.js --dry-run    # Show scores without saving
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'pipeline.db');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SCORE_ALL = args.includes('--all');
const SPECIFIC_ID = args.includes('--id') ? parseInt(args[args.indexOf('--id') + 1]) : null;

let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (err) {
  console.error('\n  ✗ pipeline.db not found. Run: npm run init-db\n');
  process.exit(1);
}

// ─── Scoring Configuration ──────────────────────────────────────────

const SCORING = {
  // Positive signals — each match adds points
  leadership: {
    weight: 25,
    keywords: [
      'servant leadership', 'people development', 'develop leaders',
      'engineering culture', 'coaching', 'mentoring', 'empowerment',
      'team development', 'leadership development', 'people-first',
      'build culture', 'grow leaders', 'develop people', 'talent development',
      'organizational development', 'leadership pipeline', 'engineering excellence',
      'people management', 'develop engineering managers', 'build teams'
    ]
  },

  seniority: {
    weight: 20,
    keywords: [
      'vp of engineering', 'vp engineering', 'vice president',
      'svp', 'senior vice president', 'director of engineering',
      'head of engineering', 'chief technology', 'cto', 'coo',
      'engineering leadership', 'senior leadership', 'executive',
      'c-suite', 'c-level', 'senior director'
    ]
  },

  industry: {
    weight: 15,
    keywords: [
      'broadcast', 'media', 'streaming', 'content', 'entertainment',
      'studio', 'production', 'video', 'audio', 'live',
      'smpte', '2110', 'ip video', 'media technology',
      'post-production', 'content delivery', 'ott', 'platform'
    ]
  },

  culture: {
    weight: 15,
    keywords: [
      'ownership', 'autonomy', 'trust', 'transparency',
      'growth mindset', 'psychological safety', 'inclusion',
      'diverse', 'collaborative', 'innovation', 'transformation',
      'scale', 'global', 'international', 'cross-functional',
      'remote', 'flexible', 'work-life'
    ]
  },

  transformation: {
    weight: 10,
    keywords: [
      'transformation', 'post-merger', 'integration', 'scale',
      'hypergrowth', 'build from scratch', 'greenfield',
      'modernize', 'restructure', 'turnaround', 'change management',
      'digital transformation', 'cloud migration', 'legacy'
    ]
  },

  scope: {
    weight: 10,
    keywords: [
      '100+', '150+', '200+', '250+', '300+', 'engineers',
      'global', 'multiple teams', 'org-wide', 'cross-geo',
      'north america', 'international', 'multi-site'
    ]
  },

  location: {
    weight: 5,
    keywords: [
      'los angeles', 'la', 'california', 'remote',
      'hybrid', 'flexible location', 'west coast',
      'anywhere', 'distributed'
    ]
  }
};

// Red flags — each match subtracts points
const RED_FLAGS = {
  weight: -15,
  keywords: [
    'hold engineers accountable', 'hold accountable',
    'move fast and break things', 'fast-paced chaos',
    'hands-on coding required', 'individual contributor',
    'must code daily', '10x engineer', 'rockstar',
    'ninja', 'guru', 'no work-life balance',
    'startup grind', '80 hour', 'always on',
    'micromanage', 'command and control'
  ]
};

// ─── Scoring Logic ──────────────────────────────────────────────────

function scoreJob(job) {
  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  const breakdown = {};
  let totalScore = 0;
  let maxPossible = 0;

  // Score each positive dimension
  for (const [dimension, config] of Object.entries(SCORING)) {
    const matches = config.keywords.filter(kw => text.includes(kw.toLowerCase()));
    const matchRatio = Math.min(matches.length / 3, 1); // Cap at 3 matches per dimension
    const dimensionScore = Math.round(config.weight * matchRatio);
    breakdown[dimension] = {
      score: dimensionScore,
      max: config.weight,
      matches: matches.slice(0, 5) // Show top 5 matches
    };
    totalScore += dimensionScore;
    maxPossible += config.weight;
  }

  // Check red flags
  const redFlagMatches = RED_FLAGS.keywords.filter(kw => text.includes(kw.toLowerCase()));
  if (redFlagMatches.length > 0) {
    const penalty = Math.min(redFlagMatches.length * 5, Math.abs(RED_FLAGS.weight));
    breakdown.red_flags = {
      score: -penalty,
      matches: redFlagMatches
    };
    totalScore -= penalty;
  }

  // Normalize to 0-100
  const normalizedScore = Math.max(0, Math.min(100, Math.round((totalScore / maxPossible) * 100)));

  return {
    score: normalizedScore,
    breakdown,
    recommendation: getRecommendation(normalizedScore, redFlagMatches)
  };
}

function getRecommendation(score, redFlags) {
  if (redFlags.length >= 2) return 'SKIP — Multiple red flags detected';
  if (score >= 85) return 'STRONG FIT — Apply with tailored P→P→R cover letter';
  if (score >= 70) return 'GOOD FIT — Worth applying, customize the opening hook';
  if (score >= 50) return 'MODERATE — Apply if the company/role excites you';
  if (score >= 30) return 'WEAK FIT — Consider only if strong network connection';
  return 'POOR FIT — Not aligned with your product';
}

// ─── Main Execution ─────────────────────────────────────────────────

console.log('');
console.log('  ╔══════════════════════════════════════════════════════════════╗');
console.log('  ║              JOB SCORER AGENT — Wolf\'s Pipeline            ║');
console.log('  ╚══════════════════════════════════════════════════════════════╝');
console.log('');

// Get jobs to score
let jobs;
if (SPECIFIC_ID) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(SPECIFIC_ID);
  if (!job) {
    console.error(`  ✗ Job ID ${SPECIFIC_ID} not found.\n`);
    process.exit(1);
  }
  jobs = [job];
} else if (SCORE_ALL) {
  jobs = db.prepare('SELECT * FROM jobs').all();
} else {
  jobs = db.prepare("SELECT * FROM jobs WHERE status = 'NEW' OR (status = 'SCRAPED' AND score IS NULL)").all();
}

if (jobs.length === 0) {
  console.log('  No jobs to score. Add NEW jobs to the pipeline first.\n');
  process.exit(0);
}

console.log(`  Scoring ${jobs.length} job${jobs.length !== 1 ? 's' : ''}${DRY_RUN ? ' (dry run)' : ''}...\n`);

// Update agent status
const scorerAgent = db.prepare("SELECT id FROM agents WHERE type = 'scorer'").get();
if (scorerAgent && !DRY_RUN) {
  db.prepare("UPDATE agents SET status = 'running', last_run = datetime('now') WHERE id = ?").run(scorerAgent.id);
}

let scored = 0;
let errors = 0;

const updateJob = db.prepare(`
  UPDATE jobs SET score = ?, status = 'SCORED', date_updated = datetime('now')
  WHERE id = ?
`);

for (const job of jobs) {
  try {
    const result = scoreJob(job);

    console.log(`  ┌─ ${job.company} — ${job.title}`);
    console.log(`  │  Score: ${result.score}/100`);
    console.log(`  │  ${result.recommendation}`);

    // Show breakdown
    for (const [dim, data] of Object.entries(result.breakdown)) {
      if (dim === 'red_flags') {
        if (data.matches.length > 0) {
          console.log(`  │  ⚠ Red flags: ${data.matches.join(', ')}`);
        }
      } else if (data.matches.length > 0) {
        console.log(`  │  ${dim}: ${data.score}/${data.max} — ${data.matches.join(', ')}`);
      }
    }

    if (!DRY_RUN) {
      updateJob.run(result.score, job.id);
      console.log(`  │  ✓ Saved to database`);
    }

    console.log('  └─');
    console.log('');
    scored++;
  } catch (err) {
    console.error(`  ✗ Error scoring ${job.company}: ${err.message}`);
    errors++;
    if (scorerAgent && !DRY_RUN) {
      db.prepare(`
        INSERT INTO errors (job_id, agent_id, error_message)
        VALUES (?, ?, ?)
      `).run(job.id, scorerAgent.id, err.message);
    }
  }
}

// Update agent status
if (scorerAgent && !DRY_RUN) {
  db.prepare(`
    UPDATE agents SET
      status = 'idle',
      jobs_processed = jobs_processed + ?,
      errors = errors + ?
    WHERE id = ?
  `).run(scored, errors, scorerAgent.id);
}

console.log(`  ─────────────────────────────────`);
console.log(`  Scored: ${scored} | Errors: ${errors}${DRY_RUN ? ' | DRY RUN (not saved)' : ''}`);
console.log('');

db.close();
