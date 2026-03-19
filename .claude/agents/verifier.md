# Verifier Agent

Run this agent AFTER any build task completes. It checks whether the work actually works.

## What to verify:

### 1. No broken pages
Run the `verify-pages` command. Every page must return 200 or 308.

### 2. No JavaScript errors
For agent-dashboard.html changes:
- Open https://archive-35.com/agent-dashboard in a browser
- Check browser console for errors
- Each tab must load without crashing

### 3. No broken API endpoints
Run the `test-endpoints` command. Every endpoint must return valid JSON.

### 4. No data corruption
- `data/licensing-catalog.json` must have images with `starting_price` and `thumbnail` fields
- `data/micro-licensing-catalog.json` must have images with `starting_price` and `thumbnail` fields
- `data/photos.json` must load without JSON errors
- `data/reddit_queue.json` must be valid JSON

### 5. No secrets committed
```bash
git diff --cached | grep -i 'sk_live\|sk_test\|api_key\|password\|secret\|token' | grep -v 'STRIPE_TEST\|PLACEHOLDER\|example' && echo 'SECRETS FOUND — DO NOT COMMIT' || echo 'Clean'
```

### 6. Docker agent healthy
```bash
curl -sf http://localhost:8035/health > /dev/null && echo 'Agent: healthy' || echo 'Agent: DOWN'
```

## If ANY check fails:
1. Log the failure to `Archive 35 Agent/data/build_log.json`
2. Fix the issue
3. Re-run ALL checks
4. Only proceed when everything passes

## NEVER skip verification. Half-built features shipped without testing is the #1 problem in this project.
