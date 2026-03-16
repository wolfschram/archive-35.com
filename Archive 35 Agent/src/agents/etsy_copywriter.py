"""Etsy listing copywriter using LISTING_REWRITE_BRIEF story bank.

Rewrites listing descriptions in Wolf's brand voice. Matches image
subject to story bank entries. Runs sanity checks before output.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Story bank from LISTING_REWRITE_BRIEF.md ───────────────────────────

STORY_BANK = {
    "hawaii": (
        "The Big Island holds something primal. I've stood at the edge of "
        "active lava flows — you feel the heat before you see the glow. "
        "The ground beneath you is being made in real time. There is no "
        "other place on earth like it."
    ),
    "tanzania": (
        "In 2017, my sister and I took our mother back to Tanzania — to "
        "the foothills of Kilimanjaro where she was born. Our grandfather "
        "had a coffee farm there. We went to find the house she grew up in. "
        "Then we drove out across the Serengeti. Every wildlife image from "
        "that trip carries that weight."
    ),
    "iceland": (
        "Iceland stops you. The light is different there — low and sideways, "
        "even at midday in summer. Waterfalls appear where there should be "
        "no water. The landscape feels like it's still deciding what it "
        "wants to be."
    ),
    "venice": (
        "The touring years took me to every major city in Europe — but "
        "Venice resists being rushed. You have to get lost in it. The light "
        "off the canals at dawn, before the tourists arrive, is unlike "
        "anything else in Europe."
    ),
    "italy": (
        "The touring years took me to every major city in Europe — but "
        "Venice resists being rushed. You have to get lost in it. The light "
        "off the canals at dawn, before the tourists arrive, is unlike "
        "anything else in Europe."
    ),
    "desert": (
        "White Sands, New Mexico. I went there alone on a day off. Drove "
        "out before sunrise. The dunes in that early light are so still and "
        "so vast that your shadow becomes the most interesting thing in the "
        "frame."
    ),
    "antelope canyon": (
        "Antelope Canyon is a cathedral made by water. The light enters "
        "from above in beams. The stone is the color of fire. Nothing "
        "you've photographed elsewhere prepares you for it."
    ),
    "new york": (
        "In 2008 I walked into a camera store in New York before heading "
        "out on tour. I just thought — this city looks incredible, and I "
        "know how to frame an image. I bought a camera and pointed it at "
        "the world. Something clicked. Not just the shutter."
    ),
    "los angeles": (
        "I've lived in Southern California long enough to know that the "
        "light here is not subtle. The Santa Ana winds come through and "
        "scour the sky clean. The city looks like no other place when the "
        "storms roll in off the Pacific."
    ),
    "architecture": (
        "I don't photograph buildings. I photograph what buildings do to "
        "the light around them — the shadows they throw, the reflections "
        "they create, the geometry they impose on the sky. Structure is "
        "just an excuse to study how light behaves."
    ),
    "planes": (
        "25 years of touring means 25 years of airports, cargo bays, "
        "maintenance hangars, loading docks. Most people walk past these "
        "spaces. I stopped. The geometry of a maintenance hangar at 3am "
        "is extraordinary if you're looking."
    ),
    "ocean": (
        "The Pacific off the Hawaiian coast doesn't negotiate. The waves "
        "there are not decorative — they're geological forces. Standing at "
        "the edge of volcanic rock while the ocean comes in is one of the "
        "few places where you truly feel the scale of things."
    ),
    "grand teton": (
        "The Tetons don't ease you in. You round a bend on a Wyoming road "
        "and they're just there — three thousand feet of vertical granite "
        "rising from a flat valley floor. The old barn in the foreground "
        "was somebody's life's work."
    ),
    "monument valley": (
        "Monument Valley is a place that exists in the American imagination "
        "before you ever arrive. The buttes rise from the desert floor like "
        "monuments to silence. Every photograph taken here is a conversation "
        "with a century of images that came before."
    ),
    "cuba": (
        "Cuba is frozen and alive at the same time. The cars, the walls, "
        "the light — everything carries the weight of decades. The colors "
        "are impossible. You photograph Cuba and realize you're "
        "photographing time itself."
    ),
    "south africa": (
        "South Africa is not one place — it's a continent compressed into "
        "a country. The wildlife, the coast, the light shifting across "
        "the savanna. Every frame holds more than what you see."
    ),
    "new zealand": (
        "New Zealand feels like the planet before people got to it. The "
        "scale is overwhelming — mountains rising straight from the sea, "
        "valleys carved by ice. You point the camera and the land does "
        "the rest."
    ),
    "canada": (
        "The Canadian Rockies are water and stone in conversation. Every "
        "waterfall, every glacier, every canyon — you're watching a "
        "negotiation that's been going on for ten thousand years."
    ),
    "black and white": (
        "Black and white is not a filter. It's a decision. You strip the "
        "color and what remains is structure, light, and the thing you "
        "actually felt when you pressed the shutter."
    ),
    "flowers": (
        "I photograph flowers the way I photograph landscapes — as "
        "architecture. The geometry of petals. The tension in a stem. "
        "The way light passes through something living."
    ),
}

# Keywords → story bank key mapping
COLLECTION_STORY_MAP = {
    "antelope canyon": "antelope canyon",
    "iceland": "iceland",
    "tanzania": "tanzania",
    "grand teton": "grand teton",
    "cuba": "cuba",
    "black and white": "black and white",
    "italy": "italy",
    "venice": "venice",
    "hawaii": "hawaii",
    "desert dunes": "desert",
    "white sands": "desert",
    "monument valley": "monument valley",
    "new york": "new york",
    "los angeles": "los angeles",
    "planes": "planes",
    "south africa": "south africa",
    "new zealand": "new zealand",
    "canada": "canada",
    "flowers": "flowers",
    "coast of california": "ocean",
    "arizona": "desert",
}


def get_story_for_collection(collection: str) -> str:
    """Match a collection name to the story bank."""
    coll_lower = collection.lower().strip()
    for key, story_key in COLLECTION_STORY_MAP.items():
        if key in coll_lower:
            return STORY_BANK.get(story_key, "")
    return ""


# ── Sanity checks ──────────────────────────────────────────────────────

BANNED_PHRASES = [
    "random stuff", "placeholder", "generic", "lorem ipsum",
    "wolf wildlife", "wolf photography print",
    "someone_else", "made by someone",
]


def sanity_check(title: str, description: str, collection: str) -> list[str]:
    """Check listing copy for banned phrases and mismatches.

    Returns list of issues found. Empty = clean.
    """
    issues = []
    combined = (title + " " + description).lower()

    for phrase in BANNED_PHRASES:
        if phrase in combined:
            issues.append(f"Banned phrase found: '{phrase}'")

    if len(title) > 140:
        issues.append(f"Title too long: {len(title)} chars (max 140)")

    if "free shipping" not in description.lower():
        issues.append("Missing 'FREE SHIPPING' in description")

    return issues


# ── Claude rewrite prompt ──────────────────────────────────────────────

REWRITE_PROMPT = (
    "You are Wolf Schram's copywriter for Archive-35 Etsy listings.\n"
    "Rewrite this listing using the brand voice and story below.\n\n"
    "BRAND VOICE RULES:\n"
    "- Never salesy. Never corporate.\n"
    "- Short sentences. Present tense for the moment. Past tense for story.\n"
    "- Never: 'perfect for your home', 'stunning', 'beautiful', 'amazing'\n"
    "- Always: specific detail, real location, felt emotion\n\n"
    "COLLECTION: {collection}\n"
    "STORY BANK: {story}\n"
    "ORIGINAL TITLE: {old_title}\n"
    "ORIGINAL DESCRIPTION: {old_desc_preview}\n\n"
    "WRITE using this exact template:\n"
    "[One sentence — the moment in the image, present tense]\n\n"
    "FREE SHIPPING — Ships free across North America and Canada. "
    "Arrives ready to hang. No frame needed.\n\n"
    "[THE MOMENT — 2-3 sentences. What is in the image. Where. The light.]\n\n"
    "[THE STORY — 2-3 sentences from the story bank above. Real, not invented.]\n\n"
    "Printed on ChromaLuxe HD Metal — white gloss aluminum. Colors appear "
    "luminous, almost backlit. Blacks are deep. Highlights glow. Rated 60+ "
    "years of archival permanence. Metal standoff brackets float the print "
    "off your wall. No frame needed — unpack and hang in minutes.\n\n"
    "{size_label} | Free shipping North America & Canada | "
    "100% satisfaction guarantee.\n\n"
    "Wolf Schram | The Restless Eye | 25 years, 55 countries.\n\n"
    "Also generate:\n"
    "TITLE: max 140 chars, SEO-optimized for Etsy. No brand name.\n"
    "TAGS: exactly 13, each max 20 chars.\n\n"
    'JSON ONLY: {{"title":"...","description":"...","tags":[...]}}'
)
