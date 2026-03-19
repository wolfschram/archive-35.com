# PHASE 3 BUILD — Wolf's Unified Email MCP Server
## Claude Code: Read this top to bottom. Build everything. Test everything. Do not stop until done.
## Owner: Wolf Schram | Date: March 18, 2026
## Context: Overnight build COMPLETE. Phase 2 (Playwright Reddit) COMPLETE. This adds unified email access.

---

## FULL AUTONOMY — DO NOT STOP, DO NOT ASK

**You have ALL permissions. Do not stop to ask for permission at any point.**

- Do NOT stop to ask for permission
- Do NOT pause for human confirmation
- Install any dependencies needed
- If a test fails, fix it and re-run
- Log every decision to `Archive 35 Agent/data/build_log.json`

---

## WHAT THIS IS

A FastMCP server that connects to Wolf's 3 email accounts via IMAP:
- wolf@archive-35.com (Google Workspace)
- wolfbroadcast@gmail.com (Gmail)
- wolfbroadcast@icloud.com (iCloud)

Gives Claude unified search, read, and daily briefing across all inboxes.
Built-in phishing detection (we already caught fake Etsy order scams from Webflow forms).

---

## RULES

1. Read CLAUDE.md first
2. This MCP server lives at `~/Documents/ACTIVE/archive-35/06_Automation/email_mcp/`
3. Do NOT put credentials in any file that gets committed to git
4. The .env file with passwords already exists — COPY it from the location below, do NOT recreate
5. Test ALL 3 account connections before marking done

---

# TASK 1: SET UP THE EMAIL MCP DIRECTORY
**Estimated time:** 10 minutes

## Steps

```bash
mkdir -p ~/Documents/ACTIVE/archive-35/06_Automation/email_mcp
```

## Copy the MCP server file

The complete MCP server has already been written. Copy it from:
`~/Documents/wolf-email-mcp/email_mcp.py`

To:
`~/Documents/ACTIVE/archive-35/06_Automation/email_mcp/email_mcp.py`

Also copy the .env file (contains live credentials — DO NOT commit to git):
`~/Documents/wolf-email-mcp/.env` → `~/Documents/ACTIVE/archive-35/06_Automation/email_mcp/.env`

## Add to .gitignore

Add this line to `~/Documents/ACTIVE/archive-35/.gitignore`:
```
06_Automation/email_mcp/.env
```

## Install dependencies

```bash
pip3 install "mcp[cli]" --break-system-packages
```

## Test all 3 connections

```python
import imaplib, os
from pathlib import Path

# Load .env
env_path = Path("~/Documents/ACTIVE/archive-35/06_Automation/email_mcp/.env").expanduser()
for line in env_path.read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ[k.strip()] = v.strip()

accounts = [
    ("wolf@archive-35.com", "imap.gmail.com", os.environ["ARCHIVE35_EMAIL"], os.environ["ARCHIVE35_APP_PASSWORD"]),
    ("wolfbroadcast@gmail.com", "imap.gmail.com", os.environ["GMAIL_EMAIL"], os.environ["GMAIL_APP_PASSWORD"]),
    ("wolfbroadcast@icloud.com", "imap.mail.me.com", os.environ["ICLOUD_EMAIL"], os.environ["ICLOUD_APP_PASSWORD"]),
]

for label, host, email, pw in accounts:
    try:
        conn = imaplib.IMAP4_SSL(host, 993)
        conn.login(email, pw)
        status, counts = conn.select("INBOX", readonly=True)
        print(f"OK: {label} — {counts[0].decode()} messages")
        conn.logout()
    except Exception as e:
        print(f"FAIL: {label} — {e}")
```

All 3 must show "OK". If any fail, check the .env passwords.

## Done Criteria
- [ ] Directory exists at `06_Automation/email_mcp/`
- [ ] email_mcp.py copied
- [ ] .env copied with live credentials
- [ ] .gitignore updated
- [ ] All 3 IMAP connections test OK

---

# TASK 2: REGISTER MCP IN CLAUDE DESKTOP CONFIG
**Estimated time:** 5 minutes

## Add to Claude Desktop MCP config

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

If the file exists, add `wolf-email` to the existing `mcpServers` object.
If the file doesn't exist, create it.

```json
{
  "mcpServers": {
    "wolf-email": {
      "command": "python3",
      "args": ["/Users/wolfgangschram/Documents/ACTIVE/archive-35/06_Automation/email_mcp/email_mcp.py"]
    }
  }
}
```

**IMPORTANT**: If there are EXISTING entries in mcpServers, DO NOT remove them. Only ADD the wolf-email entry.

## Done Criteria
- [ ] claude_desktop_config.json has wolf-email entry
- [ ] No existing MCP entries were removed

---

# TASK 3: ADD DAILY EMAIL BRIEFING TO AGENT SCHEDULER
**Estimated time:** 30 minutes

## What This Does

Adds an automated daily email scan that:
1. Runs every morning at 7:00 AM
2. Scans all 3 inboxes for new mail from last 24 hours
3. Categorizes into: Action Required, Business, Security Alerts, FYI
4. Saves briefing to `Archive 35 Agent/data/email_briefings/`
5. Shows on the operator dashboard

## Create the email briefing agent

File: `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/agents/email_briefing_agent.py`

```python
#!/usr/bin/env python3
"""
Daily Email Briefing Agent for Wolf
Scans all 3 email accounts and generates an ADHD-friendly prioritized summary.
"""
import json
import imaplib
import email
import os
import sys
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path

AGENT_BASE = Path(__file__).resolve().parents[2]
MCP_ENV = AGENT_BASE.parent / "06_Automation" / "email_mcp" / ".env"
BRIEFINGS_DIR = AGENT_BASE / "data" / "email_briefings"
BRIEFINGS_DIR.mkdir(parents=True, exist_ok=True)

# Load email credentials
def load_env():
    env = {}
    if MCP_ENV.exists():
        for line in MCP_ENV.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    return env

def decode_header_value(raw):
    if not raw:
        return ""
    parts = decode_header(raw)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(str(part))
    return " ".join(decoded)

def get_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            return payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
    return ""

def detect_phishing(from_addr, subject, body):
    flags = []
    from_lower = from_addr.lower()
    subj_lower = subject.lower()
    body_lower = body.lower()[:3000]

    if "webflow.com" in from_lower and ("etsy" in subj_lower or "order" in subj_lower):
        flags.append("PHISHING: Webflow impersonating Etsy")
    if any(d in body_lower for d in ["orweuiorwe.vu", ".vu/", ".tk/", ".ml/", "mjt.lu"]):
        flags.append("PHISHING: Suspicious URLs")
    if "sale confirmed" in subj_lower and "webflow" in from_lower:
        flags.append("PHISHING: Fake sale notification")

    return flags

def scan_account(label, host, email_addr, password, since_date):
    results = []
    try:
        conn = imaplib.IMAP4_SSL(host, 993)
        conn.login(email_addr, password)
        conn.select("INBOX", readonly=True)
        _, data = conn.search(None, f"(SINCE {since_date})")
        uids = data[0].split()

        for uid in reversed(uids[-50:]):  # Last 50 max
            _, msg_data = conn.fetch(uid, "(RFC822)")
            if msg_data and msg_data[0]:
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)
                _, from_addr = parseaddr(msg.get("From", ""))
                subject = decode_header_value(msg.get("Subject", ""))
                body = get_body(msg)

                try:
                    date = parsedate_to_datetime(msg.get("Date", "")).isoformat()
                except:
                    date = msg.get("Date", "unknown")

                phishing_flags = detect_phishing(from_addr, subject, body)

                results.append({
                    "account": label,
                    "from": decode_header_value(msg.get("From", "")),
                    "from_address": from_addr,
                    "subject": subject,
                    "date": date,
                    "body_preview": body[:300],
                    "phishing_flags": phishing_flags,
                })

        conn.close()
        conn.logout()
    except Exception as e:
        results.append({"account": label, "error": str(e)})

    return results

def categorize(messages):
    action_required = []
    business = []
    security = []
    fyi = []

    biz_domains = [
        "etsy.com", "stripe.com", "pictorem.com", "callforentry.org",
        "indiewalls.com", "pinterest.com", "instagram.com", "archive-35.com",
        "etsy.zendesk.com",
    ]
    action_keywords = [
        "order", "sale", "payment", "receipt", "shipped", "deadline",
        "approved", "accepted", "action required", "overdue", "expiring",
        "verification", "activate",
    ]

    for msg in messages:
        if "error" in msg:
            continue

        from_addr = msg.get("from_address", "").lower()
        subject = msg.get("subject", "").lower()
        flags = msg.get("phishing_flags", [])

        if flags:
            security.append(msg)
        elif any(kw in subject for kw in action_keywords):
            action_required.append(msg)
        elif any(d in from_addr for d in biz_domains):
            business.append(msg)
        else:
            fyi.append(msg)

    return {
        "action_required": action_required,
        "business": business,
        "security": security,
        "fyi": fyi[:15],  # Cap noise
    }

def run_briefing(days_back=1):
    env = load_env()
    since_date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")

    accounts = []
    if env.get("ARCHIVE35_EMAIL") and env.get("ARCHIVE35_APP_PASSWORD"):
        accounts.append(("Archive-35", "imap.gmail.com", env["ARCHIVE35_EMAIL"], env["ARCHIVE35_APP_PASSWORD"]))
    if env.get("GMAIL_EMAIL") and env.get("GMAIL_APP_PASSWORD"):
        accounts.append(("Gmail", "imap.gmail.com", env["GMAIL_EMAIL"], env["GMAIL_APP_PASSWORD"]))
    if env.get("ICLOUD_EMAIL") and env.get("ICLOUD_APP_PASSWORD"):
        accounts.append(("iCloud", "imap.mail.me.com", env["ICLOUD_EMAIL"], env["ICLOUD_APP_PASSWORD"]))

    all_messages = []
    for label, host, addr, pw in accounts:
        msgs = scan_account(label, host, addr, pw, since_date)
        all_messages.extend(msgs)

    all_messages.sort(key=lambda x: x.get("date", ""), reverse=True)
    categories = categorize(all_messages)

    briefing = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "days_covered": days_back,
        "accounts_scanned": [a[0] for a in accounts],
        "total_emails": len(all_messages),
        "summary": {
            "action_required": len(categories["action_required"]),
            "business": len(categories["business"]),
            "security_alerts": len(categories["security"]),
            "fyi": len(categories["fyi"]),
        },
        **categories,
    }

    # Save
    filename = f"briefing_{datetime.now().strftime('%Y-%m-%d_%H%M')}.json"
    filepath = BRIEFINGS_DIR / filename
    with open(filepath, "w") as f:
        json.dump(briefing, f, indent=2)

    # Also save as "latest"
    with open(BRIEFINGS_DIR / "latest.json", "w") as f:
        json.dump(briefing, f, indent=2)

    print(f"Briefing generated: {filepath}")
    print(f"  Accounts: {len(accounts)}")
    print(f"  Total emails: {len(all_messages)}")
    print(f"  Action required: {len(categories['action_required'])}")
    print(f"  Business: {len(categories['business'])}")
    print(f"  Security alerts: {len(categories['security'])}")
    print(f"  FYI: {len(categories['fyi'])}")

    return briefing

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=1, help="Days to look back")
    args = parser.parse_args()
    run_briefing(args.days)
```

## Add API endpoint

Add to `~/Documents/ACTIVE/archive-35/Archive 35 Agent/src/api.py`:

```python
@app.get("/email/briefing")
def email_briefing():
    """Get the latest email briefing."""
    briefing_file = Path(__file__).resolve().parents[1] / "data" / "email_briefings" / "latest.json"
    if briefing_file.exists():
        with open(briefing_file) as f:
            return json.load(f)
    return {"error": "No briefing generated yet. Run email_briefing_agent.py first."}

@app.post("/email/briefing/run")
def run_email_briefing():
    """Trigger a new email briefing."""
    import subprocess
    script = Path(__file__).resolve().parents[1] / "src" / "agents" / "email_briefing_agent.py"
    result = subprocess.run(
        ["python3", str(script), "--days", "1"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode == 0:
        return {"status": "success", "output": result.stdout.strip()}
    return {"status": "error", "message": result.stderr[:500]}
```

## Add to Huey scheduler (if available)

Check if `src/pipeline/scheduler.py` exists. If so, add a daily task:

```python
@huey.periodic_task(crontab(hour=7, minute=0))
def daily_email_briefing():
    """Run email briefing every morning at 7 AM."""
    from src.agents.email_briefing_agent import run_briefing
    run_briefing(days_back=1)
```

If Huey isn't available, create a standalone cron-compatible script.

## Add Email section to dashboard

Add an "EMAIL BRIEFING" section to `agent-dashboard.html` (after the existing sections):

```
┌─────────────────────────────────────────────────────────────┐
│ EMAIL BRIEFING                        [Run Now] [Refresh]   │
├─────────────────────────────────────────────────────────────┤
│ Last scan: March 18, 7:00 AM | 3 accounts | 12 new emails  │
│                                                              │
│ ACTION REQUIRED (2)                                          │
│ ● [Archive-35] CaFE deadline March 19 — Tampa Airport       │
│ ● [Archive-35] Indiewalls — Activate your profile           │
│                                                              │
│ SECURITY ALERTS (1)                                          │
│ ⚠ [Archive-35] PHISHING: Fake Etsy order from Webflow      │
│                                                              │
│ BUSINESS (4)                                                 │
│ ● [Archive-35] Etsy billing: $12.80 fees                    │
│ ● [Archive-35] Pinterest: Developer platform updates        │
│ ● [Gmail] Stripe: Sessions 2026 event                       │
│ ● [Archive-35] Etsy Sellers: What shoppers want now         │
│                                                              │
│ FYI (5) — newsletters, promos                                │
└─────────────────────────────────────────────────────────────┘
```

Wire it up:
- `GET /email/briefing` on page load
- "Run Now" button calls `POST /email/briefing/run`
- Color code: red for security, orange for action required, normal for business/fyi
- Show body preview on hover/click

## Done Criteria
- [ ] email_briefing_agent.py exists and runs
- [ ] Generates briefing JSON in data/email_briefings/
- [ ] /email/briefing and /email/briefing/run endpoints work
- [ ] Dashboard has email briefing section
- [ ] Scheduler triggers daily at 7 AM (if Huey available)

---

# TASK 4: ADD EMAIL AGENT CARD TO DASHBOARD
**Estimated time:** 15 minutes

Add an "Email Monitor" agent card to the operator command center's agent control panel:

```
┌─────────────────────────────────────────┐
│ [●] EMAIL MONITOR              [ON/OFF] │
│ Status: Running                         │
│ Accounts: 3 connected                   │
│ Last scan: 7:00 AM today                │
│ New since last scan: 4                   │
│ Security alerts: 1 phishing detected    │
│                                         │
│ [▶ Scan Now]  [📋 View Briefing]       │
└─────────────────────────────────────────┘
```

## Done Criteria
- [ ] Email agent card appears in dashboard
- [ ] Shows account count, last scan time, alert count
- [ ] "Scan Now" triggers /email/briefing/run
- [ ] "View Briefing" scrolls to/expands the email briefing section

---

# TASK 5: WIRE ETSY ORDER NOTIFICATIONS INTO EMAIL BRIEFING
**Estimated time:** 15 minutes

## The Problem

`notify_etsy_sale()` exists in `Archive 35 Agent/src/notifications/email.py` but is NEVER CALLED.
Etsy orders come in silently. Wolf had no idea orders existed (and it turns out there were zero real ones — the emails were phishing).

## The Fix

In `Archive 35 Agent/src/api.py`, find the `auto_fulfill_etsy_orders()` function.
After it processes each receipt, add a call to `notify_etsy_sale()`.

If SMTP is not configured (which it currently isn't), the notification should:
1. Still log to audit_log as "etsy_order_received"
2. Save order details to `data/etsy_orders/order_{id}.json`
3. The email briefing agent will pick these up in its next scan

Also: add Etsy order checking to the email briefing agent — it should check both email AND the Etsy API (via the existing `/etsy/receipts` endpoint) for new orders.

## Done Criteria
- [ ] Etsy orders get logged to audit_log
- [ ] Order details saved to data/etsy_orders/
- [ ] Email briefing includes Etsy order status
- [ ] SMTP failure doesn't crash anything

---

# ORDER OF OPERATIONS

```
Task 1: Set up directory, copy files, test connections (10 min)
    ↓
Task 2: Register in Claude Desktop config (5 min)
    ↓
Task 3: Email briefing agent + API + dashboard + scheduler (30 min)
    ↓
Task 4: Email agent card on dashboard (15 min)
    ↓
Task 5: Wire Etsy order notifications (15 min)
```

---

# AFTER ALL TASKS

1. Run the email briefing: `python3 Archive\ 35\ Agent/src/agents/email_briefing_agent.py --days 7`
2. Verify briefing JSON saved to `data/email_briefings/latest.json`
3. Verify dashboard shows email section
4. Verify `/email/briefing` returns data
5. Do NOT deploy website files for this — it's all backend/agent changes
6. Log completion to build_log.json

---

# ESTIMATED TOTAL TIME: 1.5-2 hours
# BUILD ALL OF IT. DO NOT STOP. DO NOT ASK FOR PERMISSION.
# LOG EVERY DECISION TO build_log.json.

---

*Phase 3 specification created March 18, 2026. Adds unified email monitoring across wolf@archive-35.com, wolfbroadcast@gmail.com, and wolfbroadcast@icloud.com.*
