"""
Reddit Queue API Routes for Archive-35 Agent
Endpoints for viewing, managing, and tracking the Reddit content queue.
Posts are formatted for manual copy-paste (Reddit blocks all automation).
"""
from __future__ import annotations

import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reddit", tags=["reddit"])

AGENT_BASE = Path(__file__).resolve().parents[2]
QUEUE_FILE = AGENT_BASE / "data" / "reddit_queue.json"
STATE_FILE = AGENT_BASE / "data" / "agent_state" / "reddit.json"


def _check_reddit_status() -> dict:
    """Check Reddit posting status from state file."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
            return {
                "configured": True,
                "method": "manual_copy_paste",
                "last_post": state.get("last_post_time"),
                "posts_today": state.get("posts_today", 0),
            }
        except (json.JSONDecodeError, IOError):
            pass
    return {
        "configured": True,
        "method": "manual_copy_paste",
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
    session = _check_reddit_status()
    queue = _load_queue()
    posts = queue.get("posts", [])

    queued = [p for p in posts if p.get("status") == "queued"]
    posted = [p for p in posts if p.get("status") == "posted"]
    skipped = [p for p in posts if p.get("status") == "skipped"]

    return {
        "credentials": session,
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


class MarkPostedRequest(BaseModel):
    post_id: str
    reddit_url: Optional[str] = None


@router.post("/mark-posted")
def mark_posted(req: MarkPostedRequest):
    """Mark a queued post as manually posted."""
    queue = _load_queue()
    posts = queue.get("posts", [])

    for i, post in enumerate(posts):
        if post.get("id") == req.post_id:
            posts[i]["status"] = "posted"
            posts[i]["posted_at"] = datetime.now(timezone.utc).isoformat()
            posts[i]["posted_via"] = "manual"
            if req.reddit_url:
                posts[i]["reddit_url"] = req.reddit_url
            _save_queue(queue)
            return {"status": "posted", "post_id": req.post_id}

    raise HTTPException(status_code=404, detail=f"Post '{req.post_id}' not found")


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
