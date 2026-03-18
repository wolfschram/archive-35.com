#!/usr/bin/env python3
"""
Reddit Content Generator for Archive-35
Generates authentic, story-driven posts in Wolf's voice.
Output: JSON queue file for dashboard posting.
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parents[3]  # archive-35 root
DATA_DIR = BASE / "data"
QUEUE_FILE = BASE / "Archive 35 Agent" / "data" / "reddit_queue.json"

# Brand voice rules
VOICE = {
    "tone": "contemplative, technical when relevant, story-driven",
    "person": "first person singular",
    "tense": "present tense for moments",
    "never": ["exclamation points", "emojis", "like and follow", "blessed", "amazing"],
    "structure": ["the moment", "the context (place, conditions, timing)", "the why (optional)"]
}

# Subreddit targeting
SUBREDDITS = {
    "r/itookapicture": {
        "title_prefix": "ITAP of ",
        "rules": "Must start with ITAP. OC only.",
        "tags": ["landscape", "wildlife", "nature", "travel"]
    },
    "r/EarthPorn": {
        "title_suffix": " [OC] [{width}x{height}]",
        "rules": "No man-made objects. Include resolution. Include [OC].",
        "tags": ["landscape", "mountain", "waterfall", "desert", "ocean"]
    },
    "r/NationalPark": {
        "rules": "Informative, include park name.",
        "tags": ["grand-teton", "glacier", "death-valley", "joshua-tree", "yosemite", "white-sands"]
    },
    "r/wildlifephotography": {
        "rules": "Tag species in title.",
        "tags": ["wildlife", "elephant", "cheetah", "puffin", "bird"]
    },
    "r/malelivingspace": {
        "rules": "Show print in room context. Be helpful about decor.",
        "tags": ["landscape", "minimalist", "modern"]
    },
    "r/AbandonedPorn": {
        "rules": "Include location in brackets.",
        "tags": ["abandoned", "wreck", "ruin"]
    }
}

def load_catalog():
    """Load all image data."""
    images = []

    # Licensing catalog (166 images, rich metadata)
    lc_path = DATA_DIR / "licensing-catalog.json"
    if lc_path.exists():
        with open(lc_path) as f:
            lc = json.load(f)
            images.extend(lc.get("images", []))

    # Photos.json (gallery images)
    ph_path = DATA_DIR / "photos.json"
    if ph_path.exists():
        with open(ph_path) as f:
            ph = json.load(f)
            if isinstance(ph, dict):
                images.extend(ph.get("photos", []))
            elif isinstance(ph, list):
                images.extend(ph)

    return images

def match_subreddit(image):
    """Find best subreddit match for an image."""
    tags = set()
    for field in ["tags", "subjects", "mood"]:
        val = image.get(field, [])
        if isinstance(val, list):
            tags.update([t.lower() for t in val])
        elif isinstance(val, str):
            tags.add(val.lower())

    # Add location-derived tags
    location = image.get("location", "").lower()
    title = image.get("title", "").lower()
    search_text = f"{location} {title}"

    if "grand teton" in search_text or "teton" in search_text:
        tags.add("grand-teton")
    if "glacier" in search_text:
        tags.add("glacier")
    if "iceland" in search_text:
        tags.add("iceland")
    if "tanzania" in search_text or "serengeti" in search_text:
        tags.add("wildlife")
    if "death valley" in search_text:
        tags.add("death-valley")
    if "joshua tree" in search_text:
        tags.add("joshua-tree")
    if "yosemite" in search_text:
        tags.add("yosemite")
    if "white sands" in search_text:
        tags.add("white-sands")
    if any(w in search_text for w in ["elephant", "cheetah", "lion", "leopard", "zebra", "giraffe"]):
        tags.add("wildlife")
    if any(w in search_text for w in ["landscape", "mountain", "peak", "valley", "canyon"]):
        tags.add("landscape")
    if any(w in search_text for w in ["desert", "dune", "sand"]):
        tags.add("desert")
    if any(w in search_text for w in ["ocean", "sea", "coast", "beach", "wave"]):
        tags.add("ocean")
    if any(w in search_text for w in ["city", "urban", "street", "building"]):
        tags.add("urban")

    matches = []
    for sub, config in SUBREDDITS.items():
        overlap = tags.intersection(set(config.get("tags", [])))
        if overlap:
            matches.append((sub, len(overlap)))

    matches.sort(key=lambda x: -x[1])
    return [m[0] for m in matches[:2]]  # Top 2 subreddits

def generate_post(image, subreddit):
    """Generate a post for a specific image and subreddit."""
    title = image.get("title", "Untitled")
    location = image.get("location", "")
    width = image.get("width", 4000)
    height = image.get("height", 2667)
    collection = image.get("collection", "")

    # Format title based on subreddit rules
    sub_config = SUBREDDITS.get(subreddit, {})
    if "title_prefix" in sub_config:
        formatted_title = f"{sub_config['title_prefix']}{title}"
        if location:
            formatted_title += f" -- {location}"
    elif "title_suffix" in sub_config:
        suffix = sub_config["title_suffix"].format(width=width, height=height)
        formatted_title = f"{title}, {location}{suffix}"
    else:
        formatted_title = f"{title} -- {location}" if location else title

    post = {
        "id": f"reddit_{image.get('id', 'unknown')}_{subreddit.replace('/', '_')}",
        "subreddit": subreddit,
        "title": formatted_title,
        "image_id": image.get("id", ""),
        "image_title": title,
        "location": location,
        "width": width,
        "height": height,
        "body_prompt": f"Write an authentic first-person story about photographing '{title}' at {location}. Include specific details: time of day, weather conditions, camera settings, what made this moment special. Voice: contemplative, technical when relevant. No exclamation points. No emojis.",
        "status": "queued",
        "created_at": datetime.utcnow().isoformat(),
        "scheduled_date": None,
        "posted_at": None,
        "subreddit_rules": sub_config.get("rules", "")
    }

    return post

def generate_queue(count=30):
    """Generate a queue of Reddit posts."""
    images = load_catalog()
    queue = []
    seen_images = set()

    for image in images:
        if len(queue) >= count:
            break

        img_id = image.get("id", image.get("filename", ""))
        if img_id in seen_images:
            continue
        seen_images.add(img_id)

        subreddits = match_subreddit(image)
        for sub in subreddits[:1]:  # One post per image for now
            post = generate_post(image, sub)
            queue.append(post)

    # Save queue
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_FILE, "w") as f:
        json.dump({"generated_at": datetime.utcnow().isoformat(), "posts": queue}, f, indent=2)

    print(f"Generated {len(queue)} Reddit posts -> {QUEUE_FILE}")
    return queue

if __name__ == "__main__":
    generate_queue(30)
