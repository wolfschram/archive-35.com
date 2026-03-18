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
                except Exception:
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
