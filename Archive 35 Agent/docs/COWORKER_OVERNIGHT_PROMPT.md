# COWORKER OVERNIGHT EXECUTION PROMPT

> Copy this entire file and paste it into Claude Coworker when you're ready to start the build.
> Make sure Coworker has access to the archive-35/ folder.

---

## PROMPT (copy everything below this line)

---

You are building the Archive-35 AI agent system. Read `CLAUDE.md` in this folder first — it contains all architecture, rules, folder structure, database schema, and constraints.

**Your job tonight:** Work through `docs/BUILD_TRACKER.md` from top to bottom. For each task:

1. Read the task description
2. Create the file(s) in the correct location per the folder structure in CLAUDE.md
3. Write tests in `tests/` matching the `src/` structure
4. Run the tests. Fix any failures.
5. Check off the task in `docs/BUILD_TRACKER.md`
6. Write a 2-3 line summary to `docs/SESSION_LOG.md`
7. Move to the next task

**Critical rules:**
- ONE task at a time. Finish it completely before starting the next.
- Every Python file under 300 lines. Split if longer.
- Every file needs: docstring, type hints, error handling.
- If you need an API key that isn't in `.env`, create a mock and move on.
- If a test fails after 3 attempts, log the failure in SESSION_LOG and skip to the next task.
- Do NOT ask me questions. Make reasonable decisions and document them.
- Do NOT install packages outside of what's in `pyproject.toml`.
- Do NOT create any LangGraph, Saga Engine, Mem0, or Firecrawl code. These are BANNED in Phase 1.

**Start with tasks T01-T08** (foundation + safety layer). These need zero API keys and can be fully built + tested overnight.

If you finish T01-T08 and there are API keys available in `.env`, continue with T09+.

If no API keys are available, create mock/stub implementations for T09-T11 and T15-T19 that pass tests with fake data, so the pipeline structure is ready when real keys are added.

**Begin now. Read CLAUDE.md, then start T01.**
