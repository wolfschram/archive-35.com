# PHASE 2 BUILD — Reddit Browser Automation + Fixes
## Claude Code: Read this top to bottom. Build everything. Test everything. Do not stop until done.
## Owner: Wolf Schram | Date: March 18, 2026
## Context: OVERNIGHT-BUILD.md (Phase 1) is COMPLETE. All 15 tasks built successfully.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK

**You have ALL permissions. Do not stop to ask for permission at any point.**

- Do NOT stop to ask for permission
- Do NOT pause for human confirmation
- Do NOT skip a task because you're "unsure" — figure it out and build it
- If a dependency is missing, install it (`pip install --break-system-packages` or `npm install`)
- If a test fails, fix it and re-run
- Log every decision to `Archive 35 Agent/data/build_log.json` (append, same format as Phase 1)
- The ONLY things you must NOT do are in CLAUDE.md's NEVER list

---

## WHY THIS BUILD EXISTS

Reddit killed self-service API key creation in November 2025 (Responsible Builder Policy).
Wolf tried to create a new Reddit app at reddit.com/prefs/apps — the form exists but
clicking "create app" just redirects to a policy page. New OAuth credentials are blocked.

**PRAW is dead for new users.** The overnight build (Tasks 4, 11, 12) correctly built:
- ✅ Reddit content generator (30 posts in queue)
- ✅ Reddit queue dashboard section
- ✅ Reddit comment monitor framework
- ❌ Reddit posting via PRAW (lines 162-210 of reddit_routes.py) — WILL NOT WORK

**The fix:** Replace PRAW posting with Playwright browser automation.
Wolf is already logged into Reddit in his browser. We use Playwright to:
1. Open old.reddit.com (simpler DOM, easier to automate)
2. Navigate to the submit page for the target subreddit
3. Fill in title, body, upload image
4. Submit
5. Capture the resulting URL
6. Log everything

This is Wolf's browser, Wolf's account, Wolf's session. No API keys needed.

---

## RULES BEFORE YOU TOUCH ANYTHING

1. Read CLAUDE.md first
2. NEVER change Stripe keys or webhook endpoints
3. NEVER deploy without running `python3 sync_gallery_data.py` first
4. NEVER use port 3000 (job-pipeline owns it)
5. Agent API = port 8035, Mockup = port 8036, Studio = port 3001
6. DO NOT break the live Etsy store, the live website, or the live Stripe checkout
7. DO NOT modify any working overnight build files EXCEPT reddit_routes.py

---

## EXISTING FILES YOU WILL MODIFY

- `Archive 35 Agent/src/routes/reddit_routes.py` — Replace PRAW posting with Playwright
- `Archive 35 Agent/data/agent_state/reddit.json` — Update state schema

## NEW FILES YOU WILL CREATE

- `Archive 35 Agent/src/agents/reddit_poster.py` — Playwright browser automation script
- `Archive 35 Agent/src/agents/reddit_browser_config.py` — Browser config and session management

---

# TASK 1: INSTALL PLAYWRIGHT
**Estimated time:** 5 minutes

```bash
cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent
pip install playwright --break-system-packages
playwright install chromium
```

If running in Docker, add to requirements.txt and Dockerfile.
Check if requirements.txt exists — if so, add `playwright` to it.

## Done Criteria
- [ ] `python3 -c "from playwright.sync_api import sync_playwright; print('OK')"` succeeds
- [ ] Chromium browser is installed for Playwright

---

# TASK 2: CREATE REDDIT BROWSER POSTER
**Estimated time:** 2-3 hours

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/agents/reddit_poster.py`

This is the core automation script. It uses Playwright to post to Reddit via the browser.

## Key Design Decisions

1. **Use old.reddit.com** — Simpler DOM, fewer JavaScript complications, stable HTML structure
2. **Use persistent browser context** — Saves cookies/session between runs so Wolf only logs in once
3. **Rate limiting built in** — Minimum 10 minutes between posts, max 5 posts per day
4. **Screenshot on every action** — For audit trail and debugging
5. **Graceful failure** — If anything goes wrong, mark post as "failed" with error, don't crash

## Implementation

```python
#!/usr/bin/env python3
"""
Reddit Browser Poster for Archive-35
Posts to Reddit using Playwright browser automation.
No API keys needed — uses Wolf's logged-in browser session.

Usage:
    # Post a specific queued item
    python reddit_poster.py --post-id "reddit_img001_r_EarthPorn"

    # Post the next queued item
    python reddit_poster.py --next

    # Check if session is valid
    python reddit_poster.py --check-session
"""
import argparse
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

AGENT_BASE = Path(__file__).resolve().parents[2]
QUEUE_FILE = AGENT_BASE / "data" / "reddit_queue.json"
STATE_FILE = AGENT_BASE / "data" / "agent_state" / "reddit.json"
SCREENSHOTS_DIR = AGENT_BASE / "data" / "reddit_screenshots"
BROWSER_DATA_DIR = AGENT_BASE / "data" / "reddit_browser"

# Rate limits
MIN_POST_INTERVAL_SECONDS = 600  # 10 minutes between posts
MAX_POSTS_PER_DAY = 5
POST_TIMEOUT_SECONDS = 60

# old.reddit.com selectors (stable, simple HTML)
SELECTORS = {
    "logged_in_user": "span.user a",  # Shows username if logged in
    "submit_url": "https://old.reddit.com/r/{subreddit}/submit",
    "title_input": 'textarea[name="title"]',
    "text_tab": "#text-field",  # The "text" tab for self posts
    "link_tab": "#url-field",   # The "link" tab for link/image posts
    "selftext_input": 'textarea[name="text"]',
    "url_input": 'input[name="url"]',  # For link posts
    "submit_button": 'button[name="submit"]',
    "captcha": ".c-form-group .captcha",  # CAPTCHA detection
    "post_error": ".error",
    "success_url_pattern": r"reddit\.com/r/.+/comments/",
}


def load_queue():
    if not QUEUE_FILE.exists():
        return {"generated_at": None, "posts": []}
    with open(QUEUE_FILE) as f:
        return json.load(f)


def save_queue(data):
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        "last_post_time": None,
        "posts_today": 0,
        "posts_today_date": None,
        "posted_ids": [],
        "session_valid": False,
    }


def save_state(state):
    state["_updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def can_post(state):
    """Check rate limits."""
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    # Reset daily counter
    if state.get("posts_today_date") != today:
        state["posts_today"] = 0
        state["posts_today_date"] = today

    # Check daily limit
    if state["posts_today"] >= MAX_POSTS_PER_DAY:
        return False, f"Daily limit reached ({MAX_POSTS_PER_DAY} posts today)"

    # Check interval
    last = state.get("last_post_time")
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            elapsed = (now - last_dt).total_seconds()
            if elapsed < MIN_POST_INTERVAL_SECONDS:
                wait = int(MIN_POST_INTERVAL_SECONDS - elapsed)
                return False, f"Rate limit: wait {wait}s (min {MIN_POST_INTERVAL_SECONDS}s between posts)"
        except (ValueError, TypeError):
            pass

    return True, "OK"


def check_session(page):
    """Check if Reddit session is valid (user is logged in)."""
    try:
        page.goto("https://old.reddit.com", timeout=15000)
        page.wait_for_load_state("domcontentloaded", timeout=10000)

        # Check for logged-in user element
        user_el = page.query_selector("span.user a")
        if user_el:
            username = user_el.inner_text().strip()
            if username and username != "login or register":
                logger.info(f"Session valid — logged in as: {username}")
                return True, username

        logger.warning("Session invalid — not logged in")
        return False, None

    except Exception as e:
        logger.error(f"Session check failed: {e}")
        return False, None


def post_to_reddit(page, post_data, screenshots=True):
    """
    Post a single item to Reddit via browser automation.

    Returns: (success: bool, result: dict)
    """
    subreddit = post_data.get("subreddit", "").replace("r/", "")
    title = post_data.get("title", "Untitled")
    body = post_data.get("body", "")
    post_id = post_data.get("id", "unknown")

    logger.info(f"Posting to r/{subreddit}: {title[:60]}...")

    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    try:
        # Navigate to submit page
        submit_url = f"https://old.reddit.com/r/{subreddit}/submit"
        page.goto(submit_url, timeout=20000)
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        time.sleep(2)  # Let page settle

        if screenshots:
            page.screenshot(path=str(SCREENSHOTS_DIR / f"{ts}_{post_id}_01_submit_page.png"))

        # Check if we landed on the submit page
        if "/submit" not in page.url:
            return False, {"error": f"Failed to reach submit page. URL: {page.url}"}

        # Check for restrictions (some subreddits require karma, account age, etc.)
        error_el = page.query_selector(".content .error, .infobar")
        if error_el:
            error_text = error_el.inner_text().strip()
            if "restricted" in error_text.lower() or "not allowed" in error_text.lower():
                return False, {"error": f"Subreddit restriction: {error_text[:200]}"}

        # Click the "text" tab for self posts (default may be link)
        text_tab = page.query_selector('.tabmenu li a[href*="submit?type=self"], #text-field')
        if text_tab:
            text_tab.click()
            time.sleep(1)

        # Fill in title
        title_input = page.query_selector('textarea[name="title"], input[name="title"]')
        if not title_input:
            return False, {"error": "Could not find title input field"}
        title_input.fill(title)
        time.sleep(0.5)

        # Fill in body text
        body_input = page.query_selector('textarea[name="text"]')
        if body_input and body:
            body_input.fill(body)
            time.sleep(0.5)

        if screenshots:
            page.screenshot(path=str(SCREENSHOTS_DIR / f"{ts}_{post_id}_02_filled.png"))

        # Check for CAPTCHA
        captcha = page.query_selector(".c-form-group .captcha, .g-recaptcha, #recaptcha")
        if captcha:
            logger.warning("CAPTCHA detected — cannot auto-post")
            if screenshots:
                page.screenshot(path=str(SCREENSHOTS_DIR / f"{ts}_{post_id}_03_captcha.png"))
            return False, {"error": "CAPTCHA required — post manually from dashboard"}

        # Submit
        submit_btn = page.query_selector('button[name="submit"], button[type="submit"].submit')
        if not submit_btn:
            return False, {"error": "Could not find submit button"}

        submit_btn.click()
        logger.info("Submit clicked, waiting for redirect...")

        # Wait for navigation (success = redirect to the new post)
        try:
            page.wait_for_url("**/comments/**", timeout=POST_TIMEOUT_SECONDS * 1000)
        except Exception:
            # Check if we're still on submit page with an error
            time.sleep(3)
            error_el = page.query_selector(".error.SUBMIT_VALIDATION_TITLE, .error")
            if error_el:
                error_text = error_el.inner_text().strip()
                if screenshots:
                    page.screenshot(path=str(SCREENSHOTS_DIR / f"{ts}_{post_id}_04_error.png"))
                return False, {"error": f"Submit error: {error_text[:300]}"}

        # Check if we landed on the post page
        final_url = page.url
        if "/comments/" in final_url:
            logger.info(f"Posted successfully: {final_url}")
            if screenshots:
                page.screenshot(path=str(SCREENSHOTS_DIR / f"{ts}_{post_id}_05_success.png"))
            return True, {"reddit_url": final_url}

        if screenshots:
            page.screenshot(path=str(SCREENSHOTS_DIR / f"{ts}_{post_id}_04_unknown.png"))
        return False, {"error": f"Unknown result. Final URL: {final_url}"}

    except Exception as e:
        logger.error(f"Post failed with exception: {e}")
        try:
            if screenshots:
                page.screenshot(path=str(SCREENSHOTS_DIR / f"{ts}_{post_id}_99_exception.png"))
        except:
            pass
        return False, {"error": str(e)}


def run_post(post_id=None, next_queued=False, check_only=False):
    """Main entry point for posting."""
    from playwright.sync_api import sync_playwright

    state = load_state()
    BROWSER_DATA_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        # Use persistent context to maintain login session
        browser = p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_DATA_DIR),
            headless=True,  # Run headless (no GUI needed)
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        page = browser.new_page()

        try:
            # Check session
            valid, username = check_session(page)
            state["session_valid"] = valid
            state["session_username"] = username
            save_state(state)

            if check_only:
                browser.close()
                return {"session_valid": valid, "username": username}

            if not valid:
                browser.close()
                return {
                    "status": "error",
                    "message": "Not logged in to Reddit. Open the browser data directory "
                    f"({BROWSER_DATA_DIR}) or run with --login to authenticate manually.",
                }

            # Check rate limits
            ok, reason = can_post(state)
            if not ok:
                browser.close()
                return {"status": "rate_limited", "message": reason}

            # Find the post to submit
            queue = load_queue()
            posts = queue.get("posts", [])
            target = None
            target_idx = None

            if post_id:
                for i, p_item in enumerate(posts):
                    if p_item.get("id") == post_id:
                        target = p_item
                        target_idx = i
                        break
            elif next_queued:
                for i, p_item in enumerate(posts):
                    if p_item.get("status") == "queued":
                        target = p_item
                        target_idx = i
                        break

            if not target:
                browser.close()
                return {"status": "error", "message": "No matching post found in queue"}

            if target.get("status") != "queued":
                browser.close()
                return {"status": "skipped", "message": f"Post already has status '{target['status']}'"}

            # Post it
            success, result = post_to_reddit(page, target)

            # Update queue
            now = datetime.now(timezone.utc).isoformat()
            if success:
                posts[target_idx]["status"] = "posted"
                posts[target_idx]["posted_at"] = now
                posts[target_idx]["reddit_url"] = result.get("reddit_url", "")
                posts[target_idx]["posted_via"] = "playwright"

                state["last_post_time"] = now
                state["posts_today"] = state.get("posts_today", 0) + 1
                state["posted_ids"] = state.get("posted_ids", []) + [target["id"]]
            else:
                posts[target_idx]["status"] = "failed"
                posts[target_idx]["failed_at"] = now
                posts[target_idx]["error"] = result.get("error", "Unknown error")

            save_queue(queue)
            save_state(state)
            browser.close()

            return {
                "status": "posted" if success else "failed",
                "post_id": target["id"],
                **result,
            }

        except Exception as e:
            browser.close()
            return {"status": "error", "message": str(e)}


def login_interactive():
    """Open a visible browser window for Wolf to log into Reddit manually.
    After login, the session cookies are saved to BROWSER_DATA_DIR and
    all future headless runs will be authenticated.
    """
    from playwright.sync_api import sync_playwright

    BROWSER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"\n{'='*60}")
    print("REDDIT LOGIN — Archive-35 Browser Automation")
    print(f"{'='*60}")
    print(f"\nOpening Reddit login page...")
    print(f"Log in with your Reddit account.")
    print(f"After login, close the browser window.")
    print(f"Session will be saved for future automated posts.\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_DATA_DIR),
            headless=False,  # VISIBLE — Wolf needs to see this
            args=["--no-sandbox"],
        )
        page = browser.new_page()
        page.goto("https://old.reddit.com/login")

        # Wait for user to close the browser
        print("Waiting for you to log in and close the browser...")
        try:
            page.wait_for_event("close", timeout=300000)  # 5 min timeout
        except:
            pass

        # Check if login was successful
        try:
            page2 = browser.new_page()
            valid, username = check_session(page2)
            if valid:
                print(f"\n✓ Login successful! Logged in as: {username}")
                print(f"  Session saved to: {BROWSER_DATA_DIR}")
                print(f"  All future automated posts will use this session.\n")
                state = load_state()
                state["session_valid"] = True
                state["session_username"] = username
                save_state(state)
            else:
                print(f"\n✗ Login not detected. Try again.\n")
        except:
            pass

        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reddit Browser Poster for Archive-35")
    parser.add_argument("--post-id", help="Post a specific queued item by ID")
    parser.add_argument("--next", action="store_true", help="Post the next queued item")
    parser.add_argument("--check-session", action="store_true", help="Check if Reddit session is valid")
    parser.add_argument("--login", action="store_true", help="Open browser for manual Reddit login")
    args = parser.parse_args()

    if args.login:
        login_interactive()
    elif args.check_session:
        result = run_post(check_only=True)
        print(json.dumps(result, indent=2))
    elif args.post_id:
        result = run_post(post_id=args.post_id)
        print(json.dumps(result, indent=2))
    elif args.next:
        result = run_post(next_queued=True)
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()
```

## IMPORTANT NOTES FOR IMPLEMENTATION

1. The code above is a TEMPLATE. Read it, understand the logic, then build it properly.
2. Test with `--check-session` first before trying to post.
3. The `--login` flag opens a VISIBLE browser window — Wolf logs in once, then all future runs are headless.
4. Screenshots are saved for every post attempt — essential for debugging.
5. old.reddit.com selectors may need adjustment. Inspect the actual page to verify.

## Done Criteria
- [ ] reddit_poster.py exists and imports cleanly
- [ ] `python3 reddit_poster.py --check-session` runs (even if not logged in)
- [ ] `python3 reddit_poster.py --login` opens visible browser to Reddit login
- [ ] After login, `--check-session` reports True with username
- [ ] `python3 reddit_poster.py --next` attempts to post the first queued item
- [ ] Screenshots saved to `data/reddit_screenshots/` for every attempt
- [ ] Rate limiting works (10 min between posts, 5/day max)
- [ ] Queue file updated with status after post attempt

---

# TASK 3: UPDATE REDDIT ROUTES TO USE PLAYWRIGHT INSTEAD OF PRAW
**Estimated time:** 30 minutes
**Dependencies:** Task 2

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/routes/reddit_routes.py`

## What to Change

Replace the PRAW-based posting logic (lines 121-210) with a call to reddit_poster.py.
Keep everything else (status, queue, skip, generate) exactly as-is.

### Replace the `post_to_reddit` endpoint:

The new `/reddit/post` endpoint should:
1. Check if Playwright browser session is valid (call reddit_poster.check_session or read state file)
2. If no session: return `{"status": "error", "message": "Reddit session not active. Run: python3 src/agents/reddit_poster.py --login"}`
3. If session valid: call `reddit_poster.run_post(post_id=req.post_id)`
4. Return the result

### Update the `/reddit/status` endpoint:

Replace `_check_reddit_creds()` with a check of `data/agent_state/reddit.json`:
- `session_valid`: true/false
- `session_username`: the logged-in username
- `last_post_time`: when the last post was made
- `posts_today`: count for rate limiting

### Add new endpoint:

```python
@router.post("/login")
def reddit_login():
    """Start interactive Reddit login.
    Opens a visible browser window for Wolf to log in.
    Returns immediately — Wolf completes login in the browser.
    """
    import subprocess
    poster_script = AGENT_BASE / "src" / "agents" / "reddit_poster.py"
    subprocess.Popen(
        ["python3", str(poster_script), "--login"],
        cwd=str(AGENT_BASE),
    )
    return {
        "status": "started",
        "message": "Browser window opened. Log into Reddit and close the browser when done.",
    }
```

### Remove all PRAW references

Delete:
- `import praw`
- `praw.Reddit(...)` initialization
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_PASSWORD` checks
- The entire try/except ImportError block for PRAW

### Update credential check

Replace `_check_reddit_creds()` with:

```python
def _check_reddit_session() -> dict:
    """Check if Reddit browser session is active."""
    state_file = AGENT_BASE / "data" / "agent_state" / "reddit.json"
    if state_file.exists():
        with open(state_file) as f:
            state = json.load(f)
        return {
            "configured": state.get("session_valid", False),
            "method": "playwright_browser",
            "username": state.get("session_username"),
            "last_post": state.get("last_post_time"),
            "posts_today": state.get("posts_today", 0),
        }
    return {
        "configured": False,
        "method": "playwright_browser",
        "username": None,
        "message": "No Reddit session. Run reddit_poster.py --login first.",
    }
```

## Done Criteria
- [ ] All PRAW references removed from reddit_routes.py
- [ ] `/reddit/post` uses Playwright via reddit_poster.py
- [ ] `/reddit/status` reads from agent_state/reddit.json
- [ ] `/reddit/login` endpoint opens browser for manual login
- [ ] API still starts cleanly (`python3 -m src.api`)

---

# TASK 4: UPDATE DASHBOARD REDDIT SECTION
**Estimated time:** 30 minutes
**Dependencies:** Task 3

File: `~/Documents/ACTIVE/archive-35/agent-dashboard.html`

## What to Change

In the Reddit Agent card and Reddit Queue section:

1. **Replace "Reddit not configured — add credentials to .env"** with:
   - If session_valid=false: Show **"Reddit not connected — [Login to Reddit]"** button
   - If session_valid=true: Show **"Connected as u/{username}"** in green

2. **Add "Login to Reddit" button** that calls `POST /reddit/login`
   - After clicking, show message: "Browser window opened. Log in and close when done."
   - After 30 seconds, re-check `/reddit/status` to see if session became valid

3. **Update the Post button** — it now calls the same `/reddit/post` endpoint
   but the backend uses Playwright instead of PRAW. No frontend change needed
   for the actual post action.

4. **Show session info:**
   - Username (from state)
   - Last post time
   - Posts today / max (e.g., "2/5 posts today")
   - Rate limit countdown if applicable

## Done Criteria
- [ ] Dashboard shows "Login to Reddit" when session is not active
- [ ] Dashboard shows "Connected as u/username" when session is active
- [ ] Login button triggers `/reddit/login` endpoint
- [ ] Post/Skip buttons still work via Playwright backend
- [ ] Session status refreshes automatically

---

# TASK 5: ADD REDDIT MONITORING VIA PUBLIC JSON (NO API NEEDED)
**Estimated time:** 1 hour
**Dependencies:** Task 2

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/agents/reddit_monitor.py`

## What to Change

The existing reddit_monitor.py uses PRAW for comment monitoring. Replace with
Reddit's public JSON endpoints (no auth needed, ~10 requests/minute):

- `https://old.reddit.com/user/{username}/submitted.json` — Wolf's posts
- `https://old.reddit.com/r/{subreddit}/comments/{post_id}.json` — Comments on a post

### Update the monitor to:

1. Read posted items from `reddit_queue.json` (status: "posted", has reddit_url)
2. For each posted item, fetch the public JSON to get:
   - Score (upvotes)
   - Number of comments
   - Comment content (check for purchase-intent keywords)
3. Use `requests.get()` with proper User-Agent header
4. Rate limit: max 10 requests per minute, sleep between calls
5. Save results to `data/reddit_alerts.json` (same format as existing)

### Public JSON format:
```
GET https://old.reddit.com/r/EarthPorn/comments/{reddit_id}.json
Headers: User-Agent: Archive35Monitor/1.0

Returns: JSON array with [post_data, comments_data]
```

### Keep existing keyword detection and reply draft generation — just change the data source.

## Done Criteria
- [ ] Monitor uses public JSON instead of PRAW
- [ ] Fetches post score and comments for all posted items
- [ ] Keyword detection still works (print, buy, purchase, sell, etc.)
- [ ] Rate limited to 10 requests/minute
- [ ] Results saved to reddit_alerts.json

---

# ORDER OF OPERATIONS

```
Task 1: Install Playwright (5 min)
    ↓
Task 2: Create reddit_poster.py (2-3 hours)
    ↓
Task 3: Update reddit_routes.py — swap PRAW for Playwright (30 min)
    ↓
Task 4: Update dashboard Reddit section (30 min)
    ↓
Task 5: Update reddit_monitor.py — use public JSON (1 hour)
```

All sequential — each task depends on the previous.

---

# AFTER ALL TASKS

1. Test the full flow:
   - `python3 src/agents/reddit_poster.py --check-session`
   - If not logged in: `python3 src/agents/reddit_poster.py --login`
   - After login: `python3 src/agents/reddit_poster.py --next`
   - Check `data/reddit_queue.json` for updated status
   - Check `data/reddit_screenshots/` for evidence
2. Verify API:
   - `curl http://localhost:8035/reddit/status`
   - `curl http://localhost:8035/reddit/queue`
3. Verify dashboard shows Reddit section correctly
4. Run `python3 sync_gallery_data.py` if any website files changed
5. Commit: `git add . && git commit -m "[automation] Replace PRAW with Playwright browser automation for Reddit posting"`
6. Log to build_log.json

---

# ESTIMATED TOTAL TIME: 4-5 hours
# BUILD ALL OF IT. DO NOT STOP. DO NOT ASK FOR PERMISSION.
# LOG EVERY DECISION TO build_log.json.

---

*Phase 2 specification created March 18, 2026. Fixes Reddit posting after Reddit's November 2025 API lockdown.*
