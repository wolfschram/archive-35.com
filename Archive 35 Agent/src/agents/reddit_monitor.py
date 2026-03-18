#!/usr/bin/env python3
"""
Reddit Comment Monitor for Archive-35
Monitors comments on Archive-35 Reddit posts for engagement opportunities,
especially "do you sell prints?" questions and purchase intent signals.

If Reddit credentials are not available, creates the framework and logs
what it would monitor. Activatable when credentials are added.
"""
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

AGENT_BASE = Path(__file__).resolve().parents[2]  # Archive 35 Agent
QUEUE_FILE = AGENT_BASE / "data" / "reddit_queue.json"
ALERTS_FILE = AGENT_BASE / "data" / "reddit_alerts.json"

# Keywords that indicate purchase interest
PURCHASE_KEYWORDS = [
    "print", "buy", "purchase", "sell", "where", "how much",
    "price", "wall", "frame", "order", "shop", "store",
    "poster", "canvas", "metal", "acrylic", "paper",
    "shipping", "ship", "deliver", "cost",
]

# Keywords that indicate compliments (engagement opportunity)
COMPLIMENT_KEYWORDS = [
    "beautiful", "stunning", "amazing", "incredible", "gorgeous",
    "love this", "wonderful", "breathtaking", "spectacular",
    "favorite", "favourite", "wallpaper", "desktop",
]

# Keywords that indicate technical questions
TECHNICAL_KEYWORDS = [
    "camera", "lens", "settings", "exposure", "iso",
    "aperture", "f/", "shutter", "focal", "gear",
    "what did you shoot", "how did you", "what camera",
    "edited", "lightroom", "photoshop", "processed",
]

# Wolf's voice templates for reply drafts
REPLY_TEMPLATES = {
    "purchase_interest": [
        "Thanks — I do sell prints. These are available on museum-quality paper, canvas, "
        "metal, and acrylic through my Etsy shop (Archive35Photo) and at archive-35.com. "
        "Happy to answer any questions about sizes or materials.",

        "Appreciate that. I have prints available in multiple formats — canvas, metal, "
        "acrylic, and archival paper. You can find the full collection at archive-35.com "
        "or search Archive35Photo on Etsy. Everything ships free in the US.",
    ],
    "compliment": [
        "Thank you. Moments like this are why I keep showing up with a camera.",

        "Thanks for saying that. This one was special to capture.",
    ],
    "technical": [
        "Happy to share the details. ",
        "Good question. ",
    ],
}


def _load_env() -> dict:
    """Load .env file."""
    env = {}
    env_path = AGENT_BASE / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    env.update(os.environ)
    return env


def _check_reddit_creds() -> bool:
    """Check if Reddit API credentials are configured."""
    env = _load_env()
    return bool(
        env.get("REDDIT_CLIENT_ID")
        and env.get("REDDIT_CLIENT_SECRET")
        and env.get("REDDIT_USERNAME")
    )


def _load_queue() -> dict:
    """Load Reddit queue for posted items."""
    if not QUEUE_FILE.exists():
        return {"posts": []}
    try:
        with open(QUEUE_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"posts": []}


def _load_alerts() -> list:
    """Load existing alerts."""
    if not ALERTS_FILE.exists():
        return []
    try:
        with open(ALERTS_FILE) as f:
            data = json.load(f)
            return data if isinstance(data, list) else data.get("alerts", [])
    except (json.JSONDecodeError, IOError):
        return []


def _save_alerts(alerts: list):
    """Save alerts to file."""
    ALERTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ALERTS_FILE, "w") as f:
        json.dump({
            "last_checked": datetime.now(timezone.utc).isoformat(),
            "total_alerts": len(alerts),
            "alerts": alerts,
        }, f, indent=2)


def classify_comment(text: str) -> dict:
    """Classify a comment by intent type and match keywords."""
    text_lower = text.lower()

    result = {
        "has_purchase_intent": False,
        "has_compliment": False,
        "has_technical_question": False,
        "matched_keywords": [],
        "priority": "LOW",
        "suggested_reply_type": None,
    }

    # Check purchase intent
    purchase_matches = [kw for kw in PURCHASE_KEYWORDS if kw in text_lower]
    if purchase_matches:
        result["has_purchase_intent"] = True
        result["matched_keywords"].extend(purchase_matches)
        result["priority"] = "HIGH"
        result["suggested_reply_type"] = "purchase_interest"

    # Check compliments
    compliment_matches = [kw for kw in COMPLIMENT_KEYWORDS if kw in text_lower]
    if compliment_matches:
        result["has_compliment"] = True
        result["matched_keywords"].extend(compliment_matches)
        if result["priority"] == "LOW":
            result["priority"] = "MEDIUM"
            result["suggested_reply_type"] = "compliment"

    # Check technical questions
    tech_matches = [kw for kw in TECHNICAL_KEYWORDS if kw in text_lower]
    if tech_matches:
        result["has_technical_question"] = True
        result["matched_keywords"].extend(tech_matches)
        if result["priority"] == "LOW":
            result["priority"] = "MEDIUM"
            result["suggested_reply_type"] = "technical"

    return result


def generate_reply_draft(classification: dict, comment_text: str, post_title: str) -> str:
    """Generate a reply draft in Wolf's voice."""
    reply_type = classification.get("suggested_reply_type")
    if not reply_type or reply_type not in REPLY_TEMPLATES:
        return ""

    templates = REPLY_TEMPLATES[reply_type]
    # Pick the first template (in production, could rotate)
    base_reply = templates[0]

    return base_reply


def monitor_comments_live() -> list:
    """Monitor comments on posted Reddit submissions using PRAW.

    Returns list of new alerts.
    """
    if not _check_reddit_creds():
        logger.warning("Reddit credentials not configured. Monitor is in standby mode.")
        return []

    try:
        import praw
    except ImportError:
        logger.error("PRAW not installed. Run: pip install praw")
        return []

    env = _load_env()
    reddit = praw.Reddit(
        client_id=env.get("REDDIT_CLIENT_ID"),
        client_secret=env.get("REDDIT_CLIENT_SECRET"),
        username=env.get("REDDIT_USERNAME"),
        password=env.get("REDDIT_PASSWORD", ""),
        user_agent=env.get("REDDIT_USER_AGENT", "Archive35Bot/1.0"),
    )

    # Load posted items from queue
    queue = _load_queue()
    posted = [p for p in queue.get("posts", []) if p.get("status") == "posted" and p.get("reddit_id")]

    if not posted:
        logger.info("No posted Reddit items to monitor")
        return []

    # Load existing alerts to avoid duplicates
    existing_alerts = _load_alerts()
    seen_comment_ids = {a.get("comment_id") for a in existing_alerts}

    new_alerts = []

    for post_data in posted:
        try:
            submission = reddit.submission(id=post_data["reddit_id"])
            submission.comments.replace_more(limit=0)

            for comment in submission.comments.list():
                if comment.id in seen_comment_ids:
                    continue

                classification = classify_comment(comment.body)
                if not classification["matched_keywords"]:
                    continue

                reply_draft = generate_reply_draft(
                    classification,
                    comment.body,
                    post_data.get("title", ""),
                )

                alert = {
                    "id": f"alert_{comment.id}",
                    "comment_id": comment.id,
                    "post_id": post_data.get("id"),
                    "reddit_post_id": post_data.get("reddit_id"),
                    "subreddit": post_data.get("subreddit"),
                    "post_title": post_data.get("title"),
                    "comment_author": str(comment.author),
                    "comment_body": comment.body[:500],
                    "comment_url": f"https://reddit.com{comment.permalink}",
                    "classification": classification,
                    "reply_draft": reply_draft,
                    "status": "new",
                    "detected_at": datetime.now(timezone.utc).isoformat(),
                }
                new_alerts.append(alert)
                seen_comment_ids.add(comment.id)

        except Exception as e:
            logger.error(f"Error monitoring post {post_data.get('reddit_id')}: {e}")

    return new_alerts


def run_monitor():
    """Run the full monitoring cycle."""
    print("Reddit Comment Monitor starting...")

    # Check credentials
    if not _check_reddit_creds():
        print("Reddit API credentials not configured.")
        print("Add the following to .env to activate:")
        print("  REDDIT_CLIENT_ID=")
        print("  REDDIT_CLIENT_SECRET=")
        print("  REDDIT_USERNAME=")
        print("  REDDIT_PASSWORD=")
        print("  REDDIT_USER_AGENT=Archive35Bot/1.0")
        print("\nMonitor is in standby mode. Framework is ready.")

        # Save empty alerts file to show framework is in place
        alerts = _load_alerts()
        _save_alerts(alerts)
        print(f"Alerts file: {ALERTS_FILE}")
        return

    # Run live monitoring
    new_alerts = monitor_comments_live()

    # Merge with existing alerts
    existing = _load_alerts()
    all_alerts = existing + new_alerts
    _save_alerts(all_alerts)

    print(f"Monitoring complete.")
    print(f"  New alerts: {len(new_alerts)}")
    print(f"  Total alerts: {len(all_alerts)}")
    print(f"  Alerts file: {ALERTS_FILE}")

    # Print high-priority alerts
    high = [a for a in new_alerts if a.get("classification", {}).get("priority") == "HIGH"]
    if high:
        print(f"\n  HIGH PRIORITY ({len(high)}):")
        for a in high:
            print(f"    {a['subreddit']} — {a['comment_author']}: {a['comment_body'][:80]}")

    # Try email notification for high-priority alerts
    if high:
        _try_email_notification(high)


def _try_email_notification(alerts: list):
    """Try to send email notification for high-priority alerts."""
    try:
        from src.notifications.email import send_notification

        body = f"Reddit Comment Monitor: {len(alerts)} high-priority comment(s) detected.\n\n"
        for a in alerts:
            body += f"Subreddit: {a.get('subreddit')}\n"
            body += f"Post: {a.get('post_title')}\n"
            body += f"Comment by u/{a.get('comment_author')}:\n"
            body += f"  {a.get('comment_body', '')[:200]}\n"
            body += f"Keywords: {', '.join(a.get('classification', {}).get('matched_keywords', []))}\n"
            body += f"Suggested reply: {a.get('reply_draft', '')[:150]}\n"
            body += f"URL: {a.get('comment_url', '')}\n\n"

        send_notification(
            subject=f"Archive-35 Reddit Alert: {len(alerts)} purchase-intent comment(s)",
            body=body,
        )
    except Exception as e:
        logger.warning(f"Email notification failed: {e}")


def test_classifier():
    """Test the comment classifier with sample comments."""
    test_comments = [
        "Where can I buy a print of this?",
        "This is absolutely stunning. What camera did you use?",
        "Do you sell these as wall art? I'd love this in my living room.",
        "Nice shot",
        "How much for a large canvas print?",
        "What settings did you use? The exposure is perfect.",
        "I need this on my wall. Do you have a shop?",
        "Beautiful colors",
    ]

    print("Comment Classification Tests:")
    print("-" * 60)
    for comment in test_comments:
        result = classify_comment(comment)
        reply = generate_reply_draft(result, comment, "Test Post")
        print(f"Comment: '{comment}'")
        print(f"  Priority: {result['priority']}")
        print(f"  Purchase: {result['has_purchase_intent']}")
        print(f"  Compliment: {result['has_compliment']}")
        print(f"  Technical: {result['has_technical_question']}")
        print(f"  Keywords: {result['matched_keywords']}")
        if reply:
            print(f"  Reply draft: {reply[:80]}...")
        print()


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        test_classifier()
    else:
        run_monitor()
