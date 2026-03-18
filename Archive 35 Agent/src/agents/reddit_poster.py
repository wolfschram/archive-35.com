#!/usr/bin/env python3
"""
Reddit Post Formatter for Archive-35
Generates copy-paste ready Reddit posts from the queue.
No browser automation — just formatted text Wolf can grab and post manually.

Usage:
    # Show all queued posts, ready to copy
    python reddit_poster.py

    # Show posts for a specific subreddit
    python reddit_poster.py --sub EarthPorn

    # Show a specific post by ID
    python reddit_poster.py --post-id "reddit_A35-20260210-0002_r_EarthPorn"

    # Mark a post as posted (after you manually post it)
    python reddit_poster.py --mark-posted "reddit_A35-20260210-0002_r_EarthPorn" --url "https://reddit.com/..."
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

AGENT_BASE = Path(__file__).resolve().parents[2]
QUEUE_FILE = AGENT_BASE / "data" / "reddit_queue.json"
STATE_FILE = AGENT_BASE / "data" / "agent_state" / "reddit.json"

# EarthPorn doesn't allow man-made objects in titles or images
EARTHPORN_MANMADE_WORDS = [
    "road", "aircraft", "abandoned", "building", "house", "barn",
    "homestead", "fence", "bridge", "car", "truck", "sign", "stop",
    "tower", "cabin", "church", "village", "town", "city",
]


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
    return {"posted_ids": []}


def save_state(state):
    state["_updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def check_rule_violations(post):
    """Flag posts that likely violate subreddit rules."""
    warnings = []
    sub = post.get("subreddit", "").lower().replace("r/", "")
    title = post.get("title", "").lower()
    rules = post.get("subreddit_rules", "").lower()

    if sub == "earthporn":
        for word in EARTHPORN_MANMADE_WORDS:
            if word in title:
                warnings.append(f"r/EarthPorn: title contains '{word}' — no man-made objects allowed")
                break

    if "must start with itap" in rules and not post.get("title", "").startswith("ITAP"):
        warnings.append(f"Title must start with 'ITAP'")

    return warnings


def format_post(post, index=None):
    """Format a single post as copy-paste ready text."""
    sub = post["subreddit"]
    title = post["title"]
    post_id = post["id"]
    image_id = post.get("image_id", "")
    status = post.get("status", "queued")
    warnings = check_rule_violations(post)

    lines = []
    lines.append(f"{'='*70}")

    # Header
    num = f"[{index}] " if index is not None else ""
    lines.append(f"{num}{sub}  |  {status.upper()}")
    lines.append(f"ID: {post_id}")
    if warnings:
        for w in warnings:
            lines.append(f"  ⚠  {w}")
    lines.append(f"{'─'*70}")

    # The stuff to copy
    lines.append("")
    lines.append("  TITLE (copy this):")
    lines.append(f"  {title}")
    lines.append("")

    # Direct link to subreddit submit page
    sub_name = sub.replace("r/", "")
    lines.append(f"  SUBMIT HERE:")
    lines.append(f"  https://old.reddit.com/r/{sub_name}/submit")
    lines.append("")

    # Image reference
    lines.append(f"  IMAGE: {image_id}")
    if post.get("width") and post.get("height"):
        lines.append(f"  Resolution: {post['width']}x{post['height']}")
    lines.append("")

    # Subreddit rules reminder
    if post.get("subreddit_rules"):
        lines.append(f"  RULES: {post['subreddit_rules']}")
        lines.append("")

    lines.append(f"{'='*70}")
    return "\n".join(lines)


def show_posts(sub_filter=None, post_id_filter=None, status_filter="queued"):
    """Display formatted posts."""
    queue = load_queue()
    posts = queue.get("posts", [])

    if not posts:
        print("No posts in queue.")
        return

    filtered = []
    for p in posts:
        if post_id_filter and p["id"] != post_id_filter:
            continue
        if sub_filter and sub_filter.lower() not in p.get("subreddit", "").lower():
            continue
        if status_filter and p.get("status") != status_filter:
            continue
        filtered.append(p)

    if not filtered:
        print(f"No matching posts found (filter: sub={sub_filter}, id={post_id_filter}, status={status_filter})")
        return

    # Group by subreddit
    by_sub = {}
    for p in filtered:
        sub = p["subreddit"]
        by_sub.setdefault(sub, []).append(p)

    total = len(filtered)
    warned = sum(1 for p in filtered if check_rule_violations(p))

    print(f"\n  REDDIT POST QUEUE — {total} posts ready")
    if warned:
        print(f"  ⚠  {warned} posts have rule warnings — review before posting")
    print()

    idx = 1
    for sub in sorted(by_sub.keys()):
        for p in by_sub[sub]:
            print(format_post(p, index=idx))
            print()
            idx += 1


def mark_posted(post_id, reddit_url=None):
    """Mark a post as manually posted."""
    queue = load_queue()
    posts = queue.get("posts", [])

    for p in posts:
        if p["id"] == post_id:
            p["status"] = "posted"
            p["posted_at"] = datetime.now(timezone.utc).isoformat()
            p["posted_via"] = "manual"
            if reddit_url:
                p["reddit_url"] = reddit_url
            save_queue(queue)
            print(f"Marked as posted: {post_id}")
            return

    print(f"Post not found: {post_id}", file=sys.stderr)
    sys.exit(1)


def show_summary():
    """Show a quick status summary."""
    queue = load_queue()
    posts = queue.get("posts", [])

    counts = {}
    for p in posts:
        status = p.get("status", "unknown")
        counts[status] = counts.get(status, 0) + 1

    sub_counts = {}
    for p in posts:
        if p.get("status") == "queued":
            sub = p["subreddit"]
            sub_counts[sub] = sub_counts.get(sub, 0) + 1

    print(f"\n  Queue Status:")
    for status, count in sorted(counts.items()):
        print(f"    {status}: {count}")

    if sub_counts:
        print(f"\n  Queued by subreddit:")
        for sub, count in sorted(sub_counts.items()):
            print(f"    {sub}: {count}")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reddit Post Formatter for Archive-35")
    parser.add_argument("--sub", help="Filter by subreddit name (e.g. EarthPorn)")
    parser.add_argument("--post-id", help="Show a specific post by ID")
    parser.add_argument("--mark-posted", help="Mark a post ID as manually posted")
    parser.add_argument("--url", help="Reddit URL (use with --mark-posted)")
    parser.add_argument("--all", action="store_true", help="Show all posts, not just queued")
    parser.add_argument("--summary", action="store_true", help="Show queue summary")
    args = parser.parse_args()

    if args.mark_posted:
        mark_posted(args.mark_posted, args.url)
    elif args.summary:
        show_summary()
    else:
        status = None if args.all else "queued"
        show_posts(sub_filter=args.sub, post_id_filter=args.post_id, status_filter=status)
