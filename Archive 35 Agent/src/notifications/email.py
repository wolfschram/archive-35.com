"""Email notifications for Archive-35 agent events.

Uses Python smtplib — no external services needed.
Configured via .env:

    NOTIFY_EMAIL=wolf@archive-35.com
    SMTP_HOST=smtp.gmail.com        (or your mail provider)
    SMTP_PORT=587
    SMTP_USER=wolf@archive-35.com
    SMTP_PASS=your-app-password

For Gmail: use an App Password (not your main password).
Settings → Security → 2-Step Verification → App passwords.

For Cloudflare Email Routing (archive-35.com):
    SMTP_HOST=smtp.gmail.com  (route via Gmail)
    SMTP_USER=wolfbroadcast@gmail.com
    SMTP_PASS=gmail-app-password
    NOTIFY_EMAIL=wolf@archive-35.com
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    env.update(os.environ)
    return env


def send_notification(
    subject: str,
    body: str,
    to: Optional[str] = None,
) -> bool:
    """Send an email notification.

    Args:
        subject: Email subject line.
        body: Plain text body.
        to: Recipient (defaults to NOTIFY_EMAIL env var).

    Returns:
        True if sent successfully, False otherwise.
    """
    env = _load_env()

    recipient = to or env.get("NOTIFICATION_EMAIL") or env.get("NOTIFY_EMAIL", "wolf@archive-35.com")
    smtp_host = env.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(env.get("SMTP_PORT", "587"))
    smtp_user = env.get("SMTP_USER", "")
    smtp_pass = env.get("SMTP_PASS", "")

    if not smtp_user or not smtp_pass:
        logger.warning("SMTP_USER or SMTP_PASS not set — email notification skipped")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"Archive-35 Agent <{smtp_user}>"
    msg["To"] = recipient

    msg.attach(MIMEText(body, "plain"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, recipient, msg.as_string())
        logger.info("Email sent: %s -> %s", subject, recipient)
        return True
    except Exception as e:
        logger.error("Email failed: %s", e)
        return False


def notify_x402_sale(
    image_id: str,
    image_title: str,
    tier: str,
    amount_usd: float,
    tx_hash: str,
    buyer_address: str,
) -> bool:
    """Send email when an AI agent purchases a license."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    subject = f"\U0001f4b0 Archive-35 License Sale \u2014 {image_title}"

    body = f"""Image: {image_title}
License tier: {tier.title()}
Amount: ${amount_usd:.2f} USDC
Buyer wallet: {buyer_address}
Transaction: {tx_hash}
Time: {now}

View transaction: https://basescan.org/tx/{tx_hash}

\u2014
Archive-35 Agent
https://archive-35.com
"""
    return send_notification(subject, body)


def notify_etsy_sale(
    listing_title: str,
    amount: float,
    currency: str,
    buyer_country: str,
    order_id: str,
) -> bool:
    """Send email when an Etsy order comes in."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    subject = f"🛒 Archive-35 Etsy Sale — {currency} {amount:.2f}"

    body = f"""You have a new Etsy sale!

Print:    {listing_title}
Amount:   {currency} {amount:.2f}
Country:  {buyer_country}
Order ID: {order_id}
Time:     {now}

View in Etsy:
https://www.etsy.com/your/orders

—
Archive-35 Agent
https://archive-35.com
"""
    return send_notification(subject, body)


def notify_instagram_post(
    image_title: str,
    caption_preview: str,
    media_id: str,
) -> bool:
    """Send email confirming an Instagram post went live."""
    subject = f"📸 Archive-35 Posted to Instagram"

    body = f"""A new photo was posted to @archive35photo.

Image:   {image_title}
Caption: {caption_preview[:100]}...
ID:      {media_id}

View: https://www.instagram.com/archive35photo

—
Archive-35 Agent
"""
    return send_notification(subject, body)
