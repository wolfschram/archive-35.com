#!/usr/bin/env python3
"""
Etsy SEO Analyzer Agent for Archive-35
Analyzes current Etsy listings against SEO best practices and generates
optimization recommendations with title rewrites, tag additions, and
description improvements.
"""
import json
import re
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parents[3]  # archive-35 root
AGENT_BASE = Path(__file__).resolve().parents[2]  # Archive 35 Agent
ETSY_EXPORT = BASE / "06_Automation" / "etsy-export"
DIGITAL_DRAFTS = AGENT_BASE / "data" / "etsy_digital_drafts"
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
    """Load the controlled digital catalog, falling back to the legacy export."""
    listings = []
    source = DIGITAL_DRAFTS if DIGITAL_DRAFTS.exists() else ETSY_EXPORT
    if not source.exists():
        return listings

    for folder in sorted(source.iterdir()):
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
    """Score title clarity using Etsy's April 2026 buyer-friendly guidance."""
    title = listing.get("title", "")
    issues = []
    score = 100
    length = len(title)
    words = re.findall(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?", title)
    word_count = len(words)
    separators = title.count("|") + title.count(",") + title.count("-")
    title_lower = title.lower()
    item_terms = ("wall art", "printable", "digital download", "metal print", "photography")
    has_item_term = any(term in title_lower for term in item_terms)
    sales_terms = ("on sale", "sale", "free shipping", "% off")
    repeated = {
        word.lower() for word in words
        if word.lower() not in {"and", "the", "of", "a", "for"}
        and sum(1 for candidate in words if candidate.lower() == word.lower()) > 1
    }

    if not title.strip():
        issues.append("Title is empty")
        score = 0
    if length > MAX_TITLE_LENGTH:
        issues.append(f"Title exceeds Etsy's {MAX_TITLE_LENGTH}-character limit")
        score -= 30
    if word_count > 15:
        issues.append(f"Title uses {word_count} words; Etsy suggests considering fewer than 15")
        score -= 15
    if separators > 2:
        issues.append(f"Title may be hard to scan ({separators} separators)")
        score -= 10
    if not has_item_term:
        issues.append("Title does not clearly state the item type")
        score -= 20
    if any(term in title_lower for term in sales_terms):
        issues.append("Remove sale, discount, or shipping language from the title")
        score -= 15
    if repeated:
        issues.append(f"Avoid repeated words: {sorted(repeated)}")
        score -= 10

    has_differentiator = any(kw in title_lower for kw in ["not ai", "authentic", "real photo", "c2pa"])
    has_room = any(kw in title_lower for kw in ROOM_KEYWORDS)
    has_gift = any(kw in title_lower for kw in GIFT_KEYWORDS)
    first_3 = " ".join(words[:3]).lower() if len(words) >= 3 else title_lower
    has_specific_lead = any(
        kw in first_3
        for subject_kws in SUBJECT_KEYWORDS.values()
        for kw in subject_kws
    )

    return {
        "current_title": title,
        "length": length,
        "word_count": word_count,
        "separators": separators,
        "has_item_term": has_item_term,
        "repeated_words": sorted(repeated),
        "has_differentiator": has_differentiator,
        "has_room_keyword": has_room,
        "has_gift_keyword": has_gift,
        "has_specific_lead": has_specific_lead,
        "issues": issues,
        "score": max(0, score),
    }


def analyze_tags(listing: dict) -> dict:
    """Score tag coverage without inventing irrelevant seasonal or gift terms."""
    tags = listing.get("tags", [])
    issues = []
    score = 100
    tag_count = len(tags)

    if tag_count < MAX_TAGS:
        issues.append(f"Only {tag_count}/{MAX_TAGS} tags used ({MAX_TAGS - tag_count} unused)")
        score -= (MAX_TAGS - tag_count) * 5
    if tag_count > MAX_TAGS:
        issues.append(f"Too many tags ({tag_count}/{MAX_TAGS})")
        score -= 10

    oversized = [tag for tag in tags if len(tag) > MAX_TAG_LENGTH]
    if oversized:
        issues.append(f"Tags exceed Etsy's {MAX_TAG_LENGTH}-character limit: {oversized}")
        score -= len(oversized) * 10

    normalized = [tag.strip().lower() for tag in tags]
    duplicates = sorted({tag for tag in normalized if normalized.count(tag) > 1})
    if duplicates:
        issues.append(f"Duplicate tags reduce query coverage: {duplicates}")
        score -= len(duplicates) * 10
    if any(not tag for tag in normalized):
        issues.append("Empty tags are not useful")
        score -= 10

    # Retain category diagnostics for the dashboard, but do not penalize
    # relevant listings for omitting inapplicable room, style, gift, or season terms.
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

    return {
        "current_tags": tags,
        "tag_count": tag_count,
        "truncated_tags": oversized,
        "missing_categories": missing_categories,
        "suggested_tags": [],
        "duplicate_tags": duplicates,
        "issues": issues,
        "score": max(0, score),
    }


def analyze_description(listing: dict) -> dict:
    """Score buyer-critical description details for the controlled downloads."""
    desc = listing.get("description", "")
    issues = []
    score = 100
    desc_lower = desc.lower()
    has_c2pa = "c2pa" in desc_lower or "content credentials" in desc_lower
    has_not_ai = "not ai" in desc_lower or "not ai-generated" in desc_lower or "authentic photograph" in desc_lower
    has_digital_disclosure = "digital download" in desc_lower and "no physical" in desc_lower
    has_file_details = "jpeg" in desc_lower and any(
        ratio in desc_lower for ratio in ("2:3", "3:4", "4:5", "11:14")
    )
    has_license = "personal" in desc_lower and any(
        term in desc_lower for term in ("no resale", "commercial use", "redistribution")
    )

    if not has_digital_disclosure:
        issues.append("State clearly that this is a digital download with no physical item")
        score -= 20
    if not has_file_details:
        issues.append("Explain the supplied JPEG files and print ratios")
        score -= 15
    if not has_license:
        issues.append("Explain personal-use licensing and resale restrictions")
        score -= 10
    if not has_not_ai:
        issues.append("Add an accurate authentic-photography statement")
        score -= 5

    has_cta = any(cta in desc_lower for cta in [
        "visit", "shop", "browse", "explore", "see more", "check out",
        "archive-35.com", "archive35"
    ])
    if len(desc) < 200:
        issues.append("Description too short (under 200 chars)")
        score -= 15
    elif len(desc) < 500:
        issues.append("Description could be longer for SEO (under 500 chars)")
        score -= 5

    has_sections = desc.count("\n\n") >= 2
    if not has_sections:
        issues.append("Description lacks clear sections (paragraphs)")
        score -= 5

    return {
        "description_length": len(desc),
        "has_c2pa": has_c2pa,
        "has_not_ai": has_not_ai,
        "has_cta": has_cta,
        "has_digital_disclosure": has_digital_disclosure,
        "has_file_details": has_file_details,
        "has_license": has_license,
        "has_sections": has_sections,
        "issues": issues,
        "score": max(0, score),
    }


def generate_title_rewrite(listing: dict, title_analysis: dict) -> str:
    """Preserve titles; Etsy's signed-in suggestions are optional experiments."""
    return listing.get("title", "")


def generate_seasonal_recommendations() -> dict:
    """Avoid forcing irrelevant seasonal terms into evergreen photography."""
    return {
        "current_month": datetime.now().strftime("%B %Y"),
        "active_seasons": [],
        "note": (
            "Only use holidays, occasions, or recipients when essential to the item. "
            "Do not force seasonal keywords into evergreen photography."
        ),
    }


def run_analysis() -> dict:
    """Run full SEO analysis on all Etsy listings."""
    listings = load_listings()
    if not listings:
        return {"error": "No listings found in etsy-export directory", "path": str(ETSY_EXPORT)}

    report = {
        "generated_at": datetime.now().isoformat(),
        "total_listings": len(listings),
        "catalog_scope": "controlled_digital_downloads",
        "guidance": {
            "reviewed_on": "2026-07-30",
            "title_guidance": "Clear, scannable, relevant; consider fewer than 15 words",
            "title_source": "https://www.etsy.com/seller-handbook/article/1399426136697",
            "search_source": "https://www.etsy.com/seller-handbook/article/how-etsy-search-works/375461474487",
        },
        "summary": {
            "overall_score": 0,
            "titles_full_length": 0,
            "titles_buyer_friendly": 0,
            "using_all_tags": 0,
            "descriptions_buyer_complete": 0,
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
        if title_analysis["score"] == 100:
            report["summary"]["titles_full_length"] += 1
            report["summary"]["titles_buyer_friendly"] += 1
        if tag_analysis["tag_count"] >= MAX_TAGS:
            report["summary"]["using_all_tags"] += 1
        if desc_analysis["score"] == 100:
            report["summary"]["descriptions_buyer_complete"] += 1
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
    print(f"  Buyer-friendly titles: {summary.get('titles_buyer_friendly', 0)}/{total}")
    print(f"  Using all 13 tags: {summary.get('using_all_tags', 0)}/{total}")
    print(f"  Buyer-complete descriptions: {summary.get('descriptions_buyer_complete', 0)}/{total}")


if __name__ == "__main__":
    main()
