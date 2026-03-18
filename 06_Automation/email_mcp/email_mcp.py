#!/usr/bin/env python3
"""
Wolf's Unified Email MCP Server
Connects to all email accounts via IMAP for unified search, read, and organize.

Accounts:
  - wolf@archive-35.com (Google Workspace)
  - wolfbroadcast@gmail.com (Gmail)
  - iCloud email (iCloud IMAP)

Setup:
  1. pip install "mcp[cli]" --break-system-packages
  2. Copy .env.example to .env and fill in app-specific passwords
  3. Run: python3 email_mcp.py

App-specific passwords:
  - Gmail/Workspace: https://myaccount.google.com/apppasswords
  - iCloud: https://appleid.apple.com → Sign-In and Security → App-Specific Passwords
"""
import os
import sys
import json
import email
import imaplib
import logging
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Optional

try:
    from mcp.server.fastmcp import FastMCP
    from pydantic import BaseModel, Field
except ImportError:
    print('pip3 install "mcp[cli]" --break-system-packages', file=sys.stderr)
    sys.exit(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("email_mcp")

# Load .env
ENV_FILE = Path(__file__).parent / ".env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

mcp = FastMCP("wolf_email")

# ─── Account Configuration ───────────────────────────────────────────

ACCOUNTS = {}

# Account 1: wolf@archive-35.com (Google Workspace)
if os.environ.get("ARCHIVE35_EMAIL") and os.environ.get("ARCHIVE35_APP_PASSWORD"):
    ACCOUNTS["archive35"] = {
        "label": "Archive-35",
        "email": os.environ["ARCHIVE35_EMAIL"],
        "password": os.environ["ARCHIVE35_APP_PASSWORD"],
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
    }

# Account 2: wolfbroadcast@gmail.com
if os.environ.get("GMAIL_EMAIL") and os.environ.get("GMAIL_APP_PASSWORD"):
    ACCOUNTS["gmail"] = {
        "label": "Gmail",
        "email": os.environ["GMAIL_EMAIL"],
        "password": os.environ["GMAIL_APP_PASSWORD"],
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
    }

# Account 3: iCloud
if os.environ.get("ICLOUD_EMAIL") and os.environ.get("ICLOUD_APP_PASSWORD"):
    ACCOUNTS["icloud"] = {
        "label": "iCloud",
        "email": os.environ["ICLOUD_EMAIL"],
        "password": os.environ["ICLOUD_APP_PASSWORD"],
        "imap_host": "imap.mail.me.com",
        "imap_port": 993,
    }


# ─── IMAP Helpers ────────────────────────────────────────────────────

def _connect(account_key: str) -> imaplib.IMAP4_SSL:
    """Connect and login to an IMAP account."""
    acct = ACCOUNTS[account_key]
    conn = imaplib.IMAP4_SSL(acct["imap_host"], acct["imap_port"])
    conn.login(acct["email"], acct["password"])
    return conn


def _decode_header_value(raw: str) -> str:
    """Decode RFC 2047 encoded email headers."""
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


def _get_body(msg: email.message.Message) -> str:
    """Extract plain text body from an email message."""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
        # Fallback: try HTML
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return f"[HTML content]\n{payload.decode(charset, errors='replace')[:2000]}"
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")
    return "(no readable body)"


def _parse_message(raw_bytes: bytes, uid: str, account_key: str) -> dict:
    """Parse a raw email into a structured dict."""
    msg = email.message_from_bytes(raw_bytes)
    from_name, from_addr = parseaddr(msg.get("From", ""))
    to_name, to_addr = parseaddr(msg.get("To", ""))

    try:
        date = parsedate_to_datetime(msg.get("Date", ""))
        date_str = date.isoformat()
    except Exception:
        date_str = msg.get("Date", "unknown")

    return {
        "uid": uid,
        "account": account_key,
        "account_label": ACCOUNTS[account_key]["label"],
        "from": _decode_header_value(msg.get("From", "")),
        "from_address": from_addr,
        "to": _decode_header_value(msg.get("To", "")),
        "subject": _decode_header_value(msg.get("Subject", "")),
        "date": date_str,
        "body": _get_body(msg),
        "has_attachments": any(
            part.get_content_disposition() == "attachment"
            for part in msg.walk()
            if msg.is_multipart()
        ),
    }


def _search_account(account_key: str, criteria: str, limit: int = 20) -> list[dict]:
    """Search an account with IMAP criteria and return parsed messages."""
    try:
        conn = _connect(account_key)
        conn.select("INBOX", readonly=True)
        _, data = conn.search(None, criteria)
        uids = data[0].split()

        # Most recent first
        uids = list(reversed(uids[-limit:]))
        messages = []

        for uid in uids:
            _, msg_data = conn.fetch(uid, "(RFC822)")
            if msg_data and msg_data[0]:
                raw = msg_data[0][1]
                parsed = _parse_message(raw, uid.decode(), account_key)
                messages.append(parsed)

        conn.close()
        conn.logout()
        return messages

    except Exception as e:
        logger.error(f"Error searching {account_key}: {e}")
        return [{"error": str(e), "account": account_key}]


def _detect_phishing(msg: dict) -> dict:
    """Check for phishing indicators in an email."""
    flags = []
    from_addr = msg.get("from_address", "").lower()
    subject = msg.get("subject", "").lower()
    body = msg.get("body", "").lower()

    # Known phishing patterns from the Webflow/Etsy scam
    if "webflow.com" in from_addr and ("etsy" in subject or "order" in subject):
        flags.append("PHISHING: Webflow form impersonating Etsy")
    if "orweuiorwe.vu" in body or "mjt.lu" in body:
        flags.append("PHISHING: Suspicious tracking/redirect URLs")
    if "sale confirmed" in subject and "webflow" in from_addr:
        flags.append("PHISHING: Fake sale notification")

    # General phishing patterns
    if any(domain in body for domain in [".vu/", ".tk/", ".ml/", "bit.ly/"]):
        flags.append("SUSPICIOUS: Short/unusual URL domains in body")
    if "verify your account" in body and from_addr not in [
        msg.get("to", "").lower()
    ]:
        flags.append("SUSPICIOUS: Account verification from unknown sender")

    return {
        "is_suspicious": len(flags) > 0,
        "flags": flags,
        "risk_level": "HIGH" if any("PHISHING" in f for f in flags) else "MEDIUM" if flags else "CLEAN",
    }


# ─── MCP Tools ───────────────────────────────────────────────────────


@mcp.tool()
def list_accounts() -> dict:
    """List all configured email accounts and their connection status."""
    result = {}
    for key, acct in ACCOUNTS.items():
        try:
            conn = _connect(key)
            status = "connected"
            conn.logout()
        except Exception as e:
            status = f"error: {e}"
        result[key] = {
            "label": acct["label"],
            "email": acct["email"],
            "status": status,
        }
    if not ACCOUNTS:
        result["_warning"] = "No accounts configured. Copy .env.example to .env and add credentials."
    return result


@mcp.tool()
def search_all(
    query: str,
    days_back: int = 30,
    limit: int = 20,
) -> dict:
    """Search ALL email accounts for messages matching a query.

    Searches subject and from fields across all configured accounts.
    Returns results sorted by date, most recent first.

    Args:
        query: Search text (matched against subject and from)
        days_back: How many days back to search (default 30)
        limit: Max results per account (default 20)
    """
    since_date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")
    all_results = []

    for key in ACCOUNTS:
        # IMAP search: subject OR from contains query
        # Note: IMAP search is limited — we search subject and do client-side filtering
        criteria = f'(SINCE {since_date} SUBJECT "{query}")'
        results = _search_account(key, criteria, limit)
        all_results.extend([r for r in results if "error" not in r])

        # Also search by FROM
        criteria_from = f'(SINCE {since_date} FROM "{query}")'
        results_from = _search_account(key, criteria_from, limit)
        seen_uids = {r["uid"] for r in all_results}
        all_results.extend([r for r in results_from if "error" not in r and r["uid"] not in seen_uids])

    # Sort by date descending
    all_results.sort(key=lambda x: x.get("date", ""), reverse=True)

    # Truncate bodies for overview
    for r in all_results:
        if "body" in r:
            r["body_preview"] = r["body"][:200] + "..." if len(r.get("body", "")) > 200 else r["body"]
            del r["body"]

    return {
        "query": query,
        "accounts_searched": list(ACCOUNTS.keys()),
        "total_results": len(all_results),
        "messages": all_results[:limit],
    }


@mcp.tool()
def get_recent(
    account: str = "all",
    limit: int = 15,
    days_back: int = 7,
) -> dict:
    """Get recent emails from one or all accounts.

    Args:
        account: Account key (archive35, gmail, icloud) or 'all'
        limit: Max messages to return (default 15)
        days_back: How many days back (default 7)
    """
    since_date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")
    criteria = f"(SINCE {since_date})"

    accounts_to_check = ACCOUNTS.keys() if account == "all" else [account]
    all_results = []

    for key in accounts_to_check:
        if key not in ACCOUNTS:
            continue
        results = _search_account(key, criteria, limit)
        all_results.extend([r for r in results if "error" not in r])

    all_results.sort(key=lambda x: x.get("date", ""), reverse=True)

    for r in all_results:
        if "body" in r:
            r["body_preview"] = r["body"][:200] + "..."
            del r["body"]
        # Add phishing check
        r["security"] = _detect_phishing(r)

    return {
        "accounts": list(accounts_to_check),
        "total": len(all_results),
        "messages": all_results[:limit],
    }


@mcp.tool()
def read_email(
    account: str,
    uid: str,
) -> dict:
    """Read the full content of a specific email.

    Args:
        account: Account key (archive35, gmail, icloud)
        uid: Email UID from search results
    """
    if account not in ACCOUNTS:
        return {"error": f"Unknown account '{account}'. Available: {list(ACCOUNTS.keys())}"}

    try:
        conn = _connect(account)
        conn.select("INBOX", readonly=True)
        _, msg_data = conn.fetch(uid.encode(), "(RFC822)")

        if not msg_data or not msg_data[0]:
            conn.close()
            conn.logout()
            return {"error": f"Message UID {uid} not found"}

        raw = msg_data[0][1]
        parsed = _parse_message(raw, uid, account)
        parsed["security"] = _detect_phishing(parsed)

        conn.close()
        conn.logout()
        return parsed

    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def list_folders(
    account: str,
) -> dict:
    """List all folders/labels in an email account.

    Args:
        account: Account key (archive35, gmail, icloud)
    """
    if account not in ACCOUNTS:
        return {"error": f"Unknown account '{account}'. Available: {list(ACCOUNTS.keys())}"}

    try:
        conn = _connect(account)
        _, folders = conn.list()
        conn.logout()

        folder_list = []
        for f in folders:
            decoded = f.decode()
            # Parse IMAP folder response
            parts = decoded.split(' "/" ')
            if len(parts) == 2:
                folder_list.append(parts[1].strip('"'))
            else:
                folder_list.append(decoded)

        return {"account": account, "folders": folder_list}

    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def search_folder(
    account: str,
    folder: str = "INBOX",
    query: str = "",
    days_back: int = 30,
    limit: int = 20,
    unread_only: bool = False,
) -> dict:
    """Search a specific folder in an email account.

    Args:
        account: Account key (archive35, gmail, icloud)
        folder: Folder name (INBOX, [Gmail]/Spam, [Gmail]/Trash, etc.)
        query: Search text for subject
        days_back: How many days back
        limit: Max results
        unread_only: Only return unread messages
    """
    if account not in ACCOUNTS:
        return {"error": f"Unknown account '{account}'. Available: {list(ACCOUNTS.keys())}"}

    try:
        conn = _connect(account)
        conn.select(folder, readonly=True)

        since_date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")
        parts = [f"SINCE {since_date}"]
        if query:
            parts.append(f'SUBJECT "{query}"')
        if unread_only:
            parts.append("UNSEEN")

        criteria = f"({' '.join(parts)})"
        _, data = conn.search(None, criteria)
        uids = data[0].split()
        uids = list(reversed(uids[-limit:]))

        messages = []
        for uid in uids:
            _, msg_data = conn.fetch(uid, "(RFC822)")
            if msg_data and msg_data[0]:
                raw = msg_data[0][1]
                parsed = _parse_message(raw, uid.decode(), account)
                parsed["folder"] = folder
                parsed["body_preview"] = parsed["body"][:200] + "..."
                del parsed["body"]
                parsed["security"] = _detect_phishing(parsed)
                messages.append(parsed)

        conn.close()
        conn.logout()

        return {
            "account": account,
            "folder": folder,
            "total": len(messages),
            "messages": messages,
        }

    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def daily_briefing(
    days_back: int = 1,
) -> dict:
    """Generate Wolf's daily email briefing across all accounts.

    Categories:
    - ACTION REQUIRED: Orders, deadlines, approvals needed
    - BUSINESS: Archive-35, Etsy, Stripe, CaFE, Indiewalls
    - SECURITY: Phishing/spam alerts
    - FYI: Newsletters, promotions, updates

    Returns a prioritized summary designed for ADHD-friendly scanning.

    Args:
        days_back: How many days to cover (default 1)
    """
    since_date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")
    criteria = f"(SINCE {since_date})"

    all_messages = []
    for key in ACCOUNTS:
        results = _search_account(key, criteria, 50)
        all_messages.extend([r for r in results if "error" not in r])

    all_messages.sort(key=lambda x: x.get("date", ""), reverse=True)

    # Categorize
    action_required = []
    business = []
    security_alerts = []
    fyi = []

    business_senders = [
        "etsy.com", "stripe.com", "pictorem.com", "callforentry.org",
        "indiewalls.com", "pinterest.com", "instagram.com", "archive-35.com",
    ]

    for msg in all_messages:
        phishing = _detect_phishing(msg)
        msg["security"] = phishing
        from_addr = msg.get("from_address", "").lower()
        subject = msg.get("subject", "").lower()

        # Truncate body
        msg["body_preview"] = msg.get("body", "")[:200]
        if "body" in msg:
            del msg["body"]

        if phishing["risk_level"] in ("HIGH", "MEDIUM"):
            security_alerts.append(msg)
        elif any(kw in subject for kw in ["order", "sale", "payment", "receipt", "shipped", "deadline", "approved", "accepted", "action required"]):
            action_required.append(msg)
        elif any(domain in from_addr for domain in business_senders):
            business.append(msg)
        else:
            fyi.append(msg)

    return {
        "briefing_date": datetime.now().isoformat(),
        "days_covered": days_back,
        "total_emails": len(all_messages),
        "summary": {
            "action_required": len(action_required),
            "business": len(business),
            "security_alerts": len(security_alerts),
            "fyi": len(fyi),
        },
        "action_required": action_required,
        "business": business,
        "security_alerts": security_alerts,
        "fyi": fyi[:10],  # Cap FYI to avoid noise
    }


if __name__ == "__main__":
    mcp.run()
