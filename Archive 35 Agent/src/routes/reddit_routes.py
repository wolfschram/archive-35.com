"""
Reddit Queue API Routes for Archive-35 Agent
Endpoints for viewing, posting, and managing the Reddit content queue.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reddit", tags=["reddit"])

AGENT_BASE = Path(__file__).resolve().parents[2]
QUEUE_FILE = AGENT_BASE / "data" / "reddit_queue.json"


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


def _check_reddit_creds() -> dict:
    """Check if Reddit API credentials are configured."""
    env = _load_env()
    client_id = env.get("REDDIT_CLIENT_ID", "")
    client_secret = env.get("REDDIT_CLIENT_SECRET", "")
    username = env.get("REDDIT_USERNAME", "")
    return {
        "configured": bool(client_id and client_secret and username),
        "has_client_id": bool(client_id),
        "has_client_secret": bool(client_secret),
        "has_username": bool(username),
        "username": username if username else None,
    }


def _load_queue() -> dict:
    """Load the Reddit queue file."""
    if not QUEUE_FILE.exists():
        return {"generated_at": None, "posts": []}
    try:
        with open(QUEUE_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"generated_at": None, "posts": []}


def _save_queue(queue_data: dict):
    """Save the Reddit queue file."""
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue_data, f, indent=2)


@router.get("/status")
def reddit_status():
    """Get Reddit integration status."""
    creds = _check_reddit_creds()
    queue = _load_queue()
    posts = queue.get("posts", [])

    queued = [p for p in posts if p.get("status") == "queued"]
    posted = [p for p in posts if p.get("status") == "posted"]
    skipped = [p for p in posts if p.get("status") == "skipped"]

    return {
        "credentials": creds,
        "queue": {
            "generated_at": queue.get("generated_at"),
            "total": len(posts),
            "queued": len(queued),
            "posted": len(posted),
            "skipped": len(skipped),
        },
    }


@router.get("/queue")
def get_queue(limit: int = 10, status: Optional[str] = None):
    """Get the Reddit post queue.

    Args:
        limit: Max number of posts to return (default 10)
        status: Filter by status (queued, posted, skipped)
    """
    queue = _load_queue()
    posts = queue.get("posts", [])

    if status:
        posts = [p for p in posts if p.get("status") == status]

    return {
        "generated_at": queue.get("generated_at"),
        "total": len(posts),
        "showing": min(limit, len(posts)),
        "posts": posts[:limit],
    }


class PostRequest(BaseModel):
    post_id: str


@router.post("/post")
def post_to_reddit(req: PostRequest):
    """Post a specific queued item to Reddit via PRAW.

    Requires REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME,
    and REDDIT_PASSWORD in .env file.
    """
    creds = _check_reddit_creds()
    if not creds["configured"]:
        missing = []
        if not creds["has_client_id"]:
            missing.append("REDDIT_CLIENT_ID")
        if not creds["has_client_secret"]:
            missing.append("REDDIT_CLIENT_SECRET")
        if not creds["has_username"]:
            missing.append("REDDIT_USERNAME")
        return {
            "status": "error",
            "message": "Reddit not configured. Add credentials to .env",
            "missing": missing,
        }

    queue = _load_queue()
    posts = queue.get("posts", [])
    target = None

    for i, post in enumerate(posts):
        if post.get("id") == req.post_id:
            target = post
            target_idx = i
            break

    if not target:
        raise HTTPException(status_code=404, detail=f"Post '{req.post_id}' not found in queue")

    if target.get("status") != "queued":
        return {
            "status": "skipped",
            "message": f"Post already has status '{target.get('status')}'",
        }

    # Try to post via PRAW
    try:
        import praw

        env = _load_env()
        reddit = praw.Reddit(
            client_id=env.get("REDDIT_CLIENT_ID"),
            client_secret=env.get("REDDIT_CLIENT_SECRET"),
            username=env.get("REDDIT_USERNAME"),
            password=env.get("REDDIT_PASSWORD", ""),
            user_agent=env.get("REDDIT_USER_AGENT", "Archive35Bot/1.0"),
        )

        subreddit_name = target.get("subreddit", "").lstrip("r/")
        subreddit = reddit.subreddit(subreddit_name)

        # Determine if image or text post
        image_id = target.get("image_id", "")
        title = target.get("title", "Untitled")

        submission = subreddit.submit(
            title=title,
            selftext=target.get("body", ""),
        )

        # Update queue
        posts[target_idx]["status"] = "posted"
        posts[target_idx]["posted_at"] = datetime.now(timezone.utc).isoformat()
        posts[target_idx]["reddit_url"] = f"https://reddit.com{submission.permalink}"
        posts[target_idx]["reddit_id"] = submission.id
        _save_queue(queue)

        return {
            "status": "posted",
            "reddit_url": f"https://reddit.com{submission.permalink}",
            "reddit_id": submission.id,
        }

    except ImportError:
        return {
            "status": "error",
            "message": "PRAW not installed. Run: pip install praw",
        }
    except Exception as e:
        logger.error(f"Reddit posting failed: {e}")
        return {
            "status": "error",
            "message": str(e),
        }


class SkipRequest(BaseModel):
    post_id: str


@router.post("/skip")
def skip_post(req: SkipRequest):
    """Skip a queued Reddit post."""
    queue = _load_queue()
    posts = queue.get("posts", [])

    for i, post in enumerate(posts):
        if post.get("id") == req.post_id:
            posts[i]["status"] = "skipped"
            posts[i]["skipped_at"] = datetime.now(timezone.utc).isoformat()
            _save_queue(queue)
            return {"status": "skipped", "post_id": req.post_id}

    raise HTTPException(status_code=404, detail=f"Post '{req.post_id}' not found")


@router.post("/generate")
def generate_queue():
    """Trigger reddit_agent.py to generate a new post queue."""
    try:
        import subprocess
        agent_script = AGENT_BASE / "src" / "agents" / "reddit_agent.py"
        if not agent_script.exists():
            return {
                "status": "error",
                "message": "reddit_agent.py not found. Task 4 may not be complete yet.",
            }

        result = subprocess.run(
            ["python3", str(agent_script)],
            cwd=str(AGENT_BASE.parent),
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            return {
                "status": "error",
                "message": result.stderr[:500],
            }

        return {
            "status": "success",
            "message": result.stdout.strip(),
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }
