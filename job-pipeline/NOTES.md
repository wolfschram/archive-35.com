# Job Pipeline — Implementation Notes

## Current Status
- **Phase 1.4/1.5:** Dashboard + Server — COMPLETE
- **Phase 2:** Job Scorer Agent — COMPLETE
- **Phase 3:** Copy Prompt for Cowork — COMPLETE
- **Phase 5:** MCP Server (Claude Desktop integration) — COMPLETE
- **Phase 6:** Feedback Analyzer — COMPLETE (schema + CLI + MCP tool)

---

## Quick Start
```bash
cd Job-Pipeline
npm install
npm run init-db    # Creates pipeline.db with schema + seed data
npm start          # http://localhost:3000
```

---

## Phase 6: Feedback Analyzer — Design Notes

### Purpose
Track which Problem→Product→Result opening hook yields the highest interview conversion rate.

### How It Works
- Every job in the pipeline has a `template_version` column (default: `v1`)
- When Wolf iterates on his P→P→R opening hook, he creates a new version (e.g., `v2`)
- New applications use the new template version
- The `template_metrics` SQL view automatically aggregates:
  - Total applied per template version
  - Interview invitations received
  - Offers received
  - Rejections
  - Conversion rate (interviews / applied * 100)

### Template Version Workflow
1. Wolf writes a new P→P→R opening hook
2. Update the template in `prompts/cover-letter-template.md`
3. Set `template_version` to `v2` (or whatever) on new job applications
4. Over time, compare conversion rates between versions
5. Run `npm run analyze` to see which version performs best

### Schema Details
```sql
-- In jobs table:
template_version TEXT DEFAULT 'v1'

-- In qa_bank table:
template_version TEXT DEFAULT 'v1'

-- Automatic aggregation view:
CREATE VIEW template_metrics AS
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
```

### MCP Integration — COMPLETE
The `log_outcome` MCP tool handles this:
1. When Wolf gets a rejection or interview request, tell Claude Desktop: "Log a rejection for job 4"
2. The tool updates the job status in the database
3. Automatically queries `template_metrics` and returns current conversion rates by template version
4. Real-time feedback on which cover letter approach works best

### MCP Server Setup
```bash
claude mcp add job-pipeline -- node ~/Archive-35/Job-Pipeline/mcp-server.js
```

**9 tools available in Claude Desktop:**
- `pipeline_stats` — Get pipeline overview
- `list_jobs` — List/filter jobs
- `get_job` — Full job detail
- `add_job` — Add new job
- `update_job` — Update status/score/notes
- `log_outcome` — Log rejection or interview (triggers Feedback Analyzer)
- `template_metrics` — Conversion rates by template version
- `generate_cover_letter_prompt` — Generate P→P→R prompt for a job
- `search_qa_bank` — Search interview Q&A bank

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Pipeline statistics (totals, by status, conversion rate) |
| GET | `/api/jobs` | All jobs (supports `?status=` and `?sort=` params) |
| GET | `/api/jobs/:id` | Single job detail |
| POST | `/api/jobs` | Add new job |
| PUT | `/api/jobs/:id` | Update job (status, notes, etc.) |
| GET | `/api/agents` | Agent statuses |
| GET | `/api/errors` | Recent errors (last 50) |
| GET | `/api/template-metrics` | Phase 6: Success rates by template version |
| GET | `/api/prompt/:id` | Generate cover letter prompt for a specific job |

---

## File Structure
```
Job-Pipeline/
├── package.json              # Dependencies: express, better-sqlite3, cors
├── server.js                 # Express server with REST API
├── init-db.js                # Database initialization + seed data
├── job-scorer.js             # Job scoring agent (keyword + weighted analysis)
├── mcp-server.js             # MCP server for Claude Desktop
├── feedback-analyzer.js      # Phase 6: Template version analysis CLI
├── test-all.js               # Integration test suite
├── PIPELINE_DASHBOARD.html   # Single-file dashboard UI
├── NOTES.md                  # This file
├── README.md                 # Project documentation
├── LESSONS_LEARNED.md        # What's working playbook
├── pipeline.db               # SQLite database (created by init-db.js)
└── prompts/
    └── cover-letter-template.md  # P→P→R cover letter master prompt
```

---

## Salary Range
Updated to: **$230K–$350K** base (LA market, VP Engineering)
