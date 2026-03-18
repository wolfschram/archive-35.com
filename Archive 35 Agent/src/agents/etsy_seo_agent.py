#!/usr/bin/env python3
"""
Etsy SEO Analyzer Agent for Archive-35
Analyzes current Etsy listings against SEO best practices and generates
optimization recommendations with title rewrites, tag additions, and
description improvements.
"""
import json
import os
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parents[3]  # archive-35 root
AGENT_BASE = Path(__file__).resolve().parents[2]  # Archive 35 Agent
ETSY_EXPORT = BASE / "06_Automation" / "etsy-export"
REPORT_FILE = AGENT_BASE / "data" / "etsy_seo_report.json"

# ── Etsy SEO Constants ─────────────────────────────────────────────
MAX_TITLE_LENGTH = 140
MAX_TAGS = 13
MAX_TAG_LENGTH = 20

# Seasonal keywords (March 2026)
SEASONAL_KEYWORDS = {
    "spring": ["spring decor", "spring refresh", "spring wall art", "fresh decor"],
    "easter": ["easter gift", "easter decor"],
    "mothers_day": ["mothers day gift", "gift for mom", "gift for her"],
    "st_patricks": ["green landscape", "ireland art", "emerald"],
    "new_year": ["new year new space", "office refresh", "fresh start"],
}

# Room-type keywords (high search volume on Etsy)
ROOM_KEYWORDS = [
    "living room art", "bedroom decor", "office wall art",
    "bathroom art", "nursery decor", "kitchen wall art",
    "dining room art", "entryway art", "home office",
]

# Style keywords
STYLE_KEYWORDS = [
    "modern", "rustic", "minimalist", "boho", "farmhouse",
    "contemporary", "mid century", "scandinavian",
]

# Gift keywords
GIFT_KEYWORDS = [
    "gift for him", "gift for her", "housewarming gift",
    "christmas gift", "birthday gift", "anniversary gift",
    "wedding gift", "new home gift",
]

# Differentiator keywords (2026 trends)
DIFFERENTIATOR_KEYWORDS = [
    "not ai", "authentic photography", "real photography",
    "C2PA verified", "original photo", "hand-captured",
]

# Subject keywords for front-loading
SUBJECT_KEYWORDS = {
    "antelope": ["slot canyon", "antelope canyon", "southwest", "sandstone"],
    "arizona": ["desert", "arizona", "sonoran", "southwest"],
    "black-and-white": ["black and white", "monochrome", "b&w"],
    "canyon": ["canyon", "slot canyon", "desert canyon"],
    "desert": ["desert", "sand dunes", "arid", "southwest"],
    "elephant": ["elephant", "african wildlife", "safari"],
    "flower": ["flower", "botanical", "floral", "nature"],
    "glacier": ["glacier", "mountain", "alpine", "national park"],
    "grand-teton": ["grand teton", "mountain", "national park", "wyoming"],
    "iceland": ["iceland", "nordic", "volcanic", "aurora"],
    "italy": ["italy", "italian", "european", "tuscany"],
    "monument": ["monument valley", "desert", "mesa", "navajo"],
    "new-york": ["new york", "manhattan", "urban", "cityscape"],
    "new-zealand": ["new zealand", "kiwi", "oceania"],
    "ocean": ["ocean", "coastal", "beach", "seascape"],
    "safari": ["safari", "african wildlife", "savanna"],
    "south-africa": ["south africa", "african", "cape town"],
    "tanzania": ["tanzania", "serengeti", "safari", "african"],
    "utah": ["utah", "national park", "red rock", "desert"],
    "valley-of-fire": ["valley of fire", "nevada", "red rock"],
    "white-sands": ["white sands", "new mexico", "gypsum dunes"],
    "yosemite": ["yosemite", "california", "national park"],
}


def load_listings() -> list[dict]:
    """Load all listing.json files from etsy-export directory."""
    listings = []
    if not ETSY_EXPORT.exists():
        return listings

    for folder in sorted(ETSY_EXPORT.iterdir()):
        if not folder.is_dir():
            continue
        listing_file = folder / "listing.json"
        if listing_file.exists():
            with open(listing_file) as f:
                data = json.load(f)
                data["_folder"] = folder.name
                listings.append(data)
    return listings


def analyze_title(listing: dict) -> dict:
    """Analyze title SEO quality."""
    title = listing.get("title", "")
    issues = []
    score = 100

    # Check length utilization
    length = len(title)
    if length < 100:
        issues.append(f"Title only uses {length}/140 characters ({140 - length} wasted)")
        score -= 15
    elif length < 120:
        issues.append(f"Title uses {length}/140 characters (room for more keywords)")
        score -= 5

    # Check for keyword stuffing (too many separators)
    separators = title.count("|") + title.count(",") + title.count("-")
    if separators > 5:
        issues.append(f"Possible keyword stuffing ({separators} separators)")
        score -= 10

    # Check if "not AI" / "authentic" differentiators present
    title_lower = title.lower()
    has_differentiator = any(kw in title_lower for kw in ["not ai", "authentic", "real photo", "c2pa"])
    if not has_differentiator:
        issues.append("Missing authenticity differentiator (e.g., 'Authentic Photography' or 'Not AI')")
        score -= 5

    # Check for room keywords
    has_room = any(kw in title_lower for kw in ROOM_KEYWORDS)
    if not has_room:
        issues.append("No room-type keyword (e.g., 'living room art', 'office wall art')")
        score -= 5

    # Check for gift keywords
    has_gift = any(kw in title_lower for kw in GIFT_KEYWORDS)

    # Check front-loading: most specific keyword should be first
    words = title.split()
    first_3 = " ".join(words[:3]).lower() if len(words) >= 3 else title_lower
    has_specific_lead = any(
        kw in first_3
        for subject_kws in SUBJECT_KEYWORDS.values()
        for kw in subject_kws
    )
    if not has_specific_lead:
        issues.append("First 3 words may not contain the most specific keyword")
        score -= 5

    return {
        "current_title": title,
        "length": length,
        "separators": separators,
        "has_differentiator": has_differentiator,
        "has_room_keyword": has_room,
        "has_gift_keyword": has_gift,
        "has_specific_lead": has_specific_lead,
        "issues": issues,
        "score": max(0, score),
    }


def analyze_tags(listing: dict) -> dict:
    """Analyze tag SEO quality."""
    tags = listing.get("tags", [])
    issues = []
    score = 100

    # Check tag count
    tag_count = len(tags)
    if tag_count < MAX_TAGS:
        issues.append(f"Only {tag_count}/{MAX_TAGS} tags used ({MAX_TAGS - tag_count} unused)")
        score -= (MAX_TAGS - tag_count) * 5

    # Check for truncated tags (common issue)
    truncated = [t for t in tags if len(t) == MAX_TAG_LENGTH]
    if truncated:
        issues.append(f"{len(truncated)} tags may be truncated at {MAX_TAG_LENGTH} chars: {truncated}")
        score -= len(truncated) * 3

    # Check for missing categories
    tags_lower = " ".join(tags).lower()

    missing_categories = []
    has_room = any(kw.replace(" ", "") in tags_lower.replace(" ", "") for kw in ROOM_KEYWORDS)
    if not has_room:
        missing_categories.append("room-type (e.g., 'living room art')")

    has_style = any(kw in tags_lower for kw in STYLE_KEYWORDS)
    if not has_style:
        missing_categories.append("style (e.g., 'modern', 'minimalist')")

    has_gift = any("gift" in t.lower() for t in tags)
    if not has_gift:
        missing_categories.append("gift (e.g., 'gift for him', 'housewarming')")

    has_seasonal = any(
        kw in tags_lower
        for season_kws in SEASONAL_KEYWORDS.values()
        for kw in season_kws
    )
    if not has_seasonal:
        missing_categories.append("seasonal (e.g., 'spring decor', 'mothers day gift')")

    if missing_categories:
        issues.append(f"Missing tag categories: {', '.join(missing_categories)}")
        score -= len(missing_categories) * 5

    # Check tag diversity (no too-similar tags)
    tag_words = set()
    duplicate_roots = []
    for t in tags:
        words = set(t.lower().split())
        overlap = words & tag_words
        if len(overlap) > 1:
            duplicate_roots.append(t)
        tag_words.update(words)
    if duplicate_roots:
        issues.append(f"Some tags overlap heavily: {duplicate_roots[:3]}")
        score -= 5

    # Suggest tags to add
    suggested_tags = []
    if not has_room:
        suggested_tags.extend(["living room art", "office wall art"])
    if not has_style:
        suggested_tags.append("modern wall art")
    if not has_gift:
        suggested_tags.append("housewarming gift")
    if not has_seasonal:
        suggested_tags.extend(["spring decor", "mothers day gift"])

    return {
        "current_tags": tags,
        "tag_count": tag_count,
        "truncated_tags": truncated,
        "missing_categories": missing_categories,
        "suggested_tags": suggested_tags[:MAX_TAGS - tag_count] if tag_count < MAX_TAGS else [],
        "issues": issues,
        "score": max(0, score),
    }


def analyze_description(listing: dict) -> dict:
    """Analyze description SEO quality."""
    desc = listing.get("description", "")
    issues = []
    score = 100

    desc_lower = desc.lower()

    # Check for C2PA mention
    has_c2pa = "c2pa" in desc_lower or "content credentials" in desc_lower
    if not has_c2pa:
        issues.append("No C2PA / content credentials mention (key differentiator in 2026)")
        score -= 10

    # Check for "not AI" mention
    has_not_ai = "not ai" in desc_lower or "not ai-generated" in desc_lower or "authentic photograph" in desc_lower
    if not has_not_ai:
        issues.append("No 'authentic photography' / 'not AI-generated' statement")
        score -= 10

    # Check for CTA
    has_cta = any(cta in desc_lower for cta in [
        "visit", "shop", "browse", "explore", "see more", "check out",
        "archive-35.com", "archive35"
    ])
    if not has_cta:
        issues.append("No clear call-to-action or website link")
        score -= 5

    # Check description length
    if len(desc) < 200:
        issues.append("Description too short (under 200 chars)")
        score -= 15
    elif len(desc) < 500:
        issues.append("Description could be longer for SEO (under 500 chars)")
        score -= 5

    # Check for structured sections
    has_sections = desc.count("\n\n") >= 2
    if not has_sections:
        issues.append("Description lacks clear sections (paragraphs)")
        score -= 5

    return {
        "description_length": len(desc),
        "has_c2pa": has_c2pa,
        "has_not_ai": has_not_ai,
        "has_cta": has_cta,
        "has_sections": has_sections,
        "issues": issues,
        "score": max(0, score),
    }


def generate_title_rewrite(listing: dict, title_analysis: dict) -> str:
    """Generate an improved title suggestion."""
    title = listing.get("title", "")
    folder = listing.get("_folder", "")
    tags = listing.get("tags", [])

    # If title is already good, return it
    if title_analysis["score"] >= 90:
        return title

    parts = [p.strip() for p in title.replace("|", ",").split(",")]
    primary = parts[0] if parts else title

    # Build improved title
    improvements = [primary]

    # Add room keyword if missing
    if not title_analysis["has_room_keyword"]:
        improvements.append("Wall Art")

    # Add what's already there (not the primary)
    for p in parts[1:4]:
        if p and p not in improvements:
            improvements.append(p)

    # Add differentiator if missing
    if not title_analysis["has_differentiator"]:
        improvements.append("Authentic Photography Print")

    result = ", ".join(improvements)

    # Trim to 140 chars
    if len(result) > MAX_TITLE_LENGTH:
        result = result[:MAX_TITLE_LENGTH].rsplit(",", 1)[0]

    return result


def generate_seasonal_recommendations() -> dict:
    """Generate current seasonal keyword recommendations."""
    return {
        "current_month": "March 2026",
        "active_seasons": [
            {
                "event": "Spring Refresh",
                "keywords": ["spring decor", "spring wall art", "fresh decor", "new season art"],
                "priority": "HIGH",
                "window": "March-May",
            },
            {
                "event": "Easter",
                "keywords": ["easter gift", "spring decoration", "easter decor"],
                "priority": "MEDIUM",
                "window": "Now - April",
            },
            {
                "event": "Mother's Day",
                "keywords": ["mothers day gift", "gift for mom", "gift for her", "unique gift for mother"],
                "priority": "HIGH",
                "window": "Start promoting now (May delivery)",
            },
            {
                "event": "St. Patrick's Day",
                "keywords": ["green landscape", "ireland art", "irish decor"],
                "priority": "LOW",
                "window": "Today (March 17)",
                "note": "Feature Iceland/Ireland green landscapes",
            },
            {
                "event": "Office Refresh",
                "keywords": ["office wall art", "home office decor", "workspace art"],
                "priority": "MEDIUM",
                "window": "Year-round but peaks Q1",
            },
        ],
    }


def run_analysis() -> dict:
    """Run full SEO analysis on all Etsy listings."""
    listings = load_listings()
    if not listings:
        return {"error": "No listings found in etsy-export directory", "path": str(ETSY_EXPORT)}

    report = {
        "generated_at": datetime.now().isoformat(),
        "total_listings": len(listings),
        "summary": {
            "overall_score": 0,
            "titles_full_length": 0,
            "using_all_tags": 0,
            "seasonal_keywords_present": 0,
            "room_keywords_present": 0,
            "c2pa_mentioned": 0,
            "not_ai_mentioned": 0,
        },
        "seasonal": generate_seasonal_recommendations(),
        "listings": [],
    }

    total_score = 0

    for listing in listings:
        title_analysis = analyze_title(listing)
        tag_analysis = analyze_tags(listing)
        desc_analysis = analyze_description(listing)

        listing_score = (title_analysis["score"] + tag_analysis["score"] + desc_analysis["score"]) / 3
        total_score += listing_score

        # Update summary counts
        if title_analysis["length"] >= 130:
            report["summary"]["titles_full_length"] += 1
        if tag_analysis["tag_count"] >= MAX_TAGS:
            report["summary"]["using_all_tags"] += 1
        if title_analysis["has_room_keyword"]:
            report["summary"]["room_keywords_present"] += 1
        if desc_analysis["has_c2pa"]:
            report["summary"]["c2pa_mentioned"] += 1
        if desc_analysis["has_not_ai"]:
            report["summary"]["not_ai_mentioned"] += 1

        # Check seasonal keywords across title + tags
        all_text = f"{listing.get('title', '')} {' '.join(listing.get('tags', []))}".lower()
        has_seasonal = any(
            kw in all_text
            for season_kws in SEASONAL_KEYWORDS.values()
            for kw in season_kws
        )
        if has_seasonal:
            report["summary"]["seasonal_keywords_present"] += 1

        improved_title = generate_title_rewrite(listing, title_analysis)

        entry = {
            "folder": listing.get("_folder", ""),
            "current_title": listing.get("title", ""),
            "recommended_title": improved_title,
            "title_changed": improved_title != listing.get("title", ""),
            "title_analysis": title_analysis,
            "tag_analysis": tag_analysis,
            "description_analysis": desc_analysis,
            "overall_score": round(listing_score, 1),
            "priority": "HIGH" if listing_score < 50 else ("MEDIUM" if listing_score < 75 else "LOW"),
        }
        report["listings"].append(entry)

    # Calculate overall score
    report["summary"]["overall_score"] = round(total_score / len(listings), 1) if listings else 0

    # Sort listings by priority (lowest score first)
    report["listings"].sort(key=lambda x: x["overall_score"])

    # Top improvements
    report["top_improvements"] = []
    for entry in report["listings"][:10]:
        if entry["title_changed"]:
            report["top_improvements"].append({
                "folder": entry["folder"],
                "action": "Rewrite title",
                "current": entry["current_title"],
                "recommended": entry["recommended_title"],
                "score_gain": "estimated +10-20 points",
            })

    return report


def main():
    """Run analysis and save report."""
    print("Running Etsy SEO analysis...")
    report = run_analysis()

    REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_FILE, "w") as f:
        json.dump(report, f, indent=2)

    total = report.get("total_listings", 0)
    score = report.get("summary", {}).get("overall_score", 0)
    print(f"Analysis complete: {total} listings, overall score: {score}/100")
    print(f"Report saved to: {REPORT_FILE}")

    # Print summary
    summary = report.get("summary", {})
    print(f"\nSummary:")
    print(f"  Titles using full length: {summary.get('titles_full_length', 0)}/{total}")
    print(f"  Using all 13 tags: {summary.get('using_all_tags', 0)}/{total}")
    print(f"  Seasonal keywords: {summary.get('seasonal_keywords_present', 0)}/{total}")
    print(f"  Room keywords: {summary.get('room_keywords_present', 0)}/{total}")
    print(f"  C2PA mentioned: {summary.get('c2pa_mentioned', 0)}/{total}")
    print(f"  Not-AI mentioned: {summary.get('not_ai_mentioned', 0)}/{total}")


if __name__ == "__main__":
    main()
