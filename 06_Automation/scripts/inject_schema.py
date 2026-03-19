#!/usr/bin/env python3
"""
Schema.org JSON-LD Injector for archive-35.com
Injects structured data into HTML pages that don't already have it.
Also injects license-specific schema with acquireLicensePage for licensing pages.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CATALOG_FILE = os.path.join(ROOT, "data", "licensing-catalog.json")

def build_licensing_schema():
    """Build ImageGallery schema with license URLs from the catalog (sample of 50)."""
    if not os.path.exists(CATALOG_FILE):
        print("  WARN: licensing-catalog.json not found, skipping license schema")
        return None

    with open(CATALOG_FILE, "r") as f:
        catalog = json.load(f)

    images = catalog.get("images", [])
    # Take a representative sample: mix of classifications, up to 50
    sample = []
    by_class = {"ULTRA": [], "PREMIUM": [], "STANDARD": []}
    for img in images:
        c = img.get("classification", "STANDARD")
        if c in by_class:
            by_class[c].append(img)

    # Take proportionally: ~15 ULTRA, ~25 PREMIUM, ~10 STANDARD
    for cls, count in [("ULTRA", 15), ("PREMIUM", 25), ("STANDARD", 10)]:
        sample.extend(by_class[cls][:count])

    item_list = []
    for i, img in enumerate(sample):
        item_list.append({
            "@type": "ListItem",
            "position": i + 1,
            "item": {
                "@type": "ImageObject",
                "name": img.get("title", img.get("id", "")),
                "license": "https://archive-35.com/terms.html",
                "acquireLicensePage": f"https://archive-35.com/micro-licensing.html?image={img['id']}",
                "creditText": "Wolf Schram / Archive-35",
                "copyrightNotice": "\u00a9 2026 Wolf Schram"
            }
        })

    return {
        "@context": "https://schema.org",
        "@type": "ImageGallery",
        "name": "Archive-35 Licensed Photography",
        "description": "Fine art photography available for licensing. Web, editorial, commercial, billboard, and hospitality tiers.",
        "url": "https://archive-35.com/licensing.html",
        "numberOfItems": len(images),
        "creator": {
            "@type": "Person",
            "name": "Wolf Schram"
        },
        "itemListElement": item_list
    }


SCHEMAS = {
    "gallery.html": {
        "@context": "https://schema.org",
        "@type": "ImageGallery",
        "name": "Archive-35 Gallery",
        "description": "Fine art photography collection. Landscape, wildlife, and nature photography from 55+ countries.",
        "url": "https://archive-35.com/gallery.html",
        "creator": {
            "@type": "Person",
            "name": "Wolf Schram"
        }
    },
    "hospitality.html": {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": "Archive-35 Hospitality Art Programs",
        "description": "Art programs for hotels, resorts, restaurants, and commercial interiors. Statement pieces, guest room programs, and custom commissions. Source files up to 40,000 pixels wide.",
        "provider": {
            "@type": "Organization",
            "name": "Archive-35"
        },
        "url": "https://archive-35.com/hospitality.html",
        "areaServed": "Worldwide"
    },
    "about.html": {
        "@context": "https://schema.org",
        "@type": "Person",
        "name": "Wolf Schram",
        "jobTitle": "Fine Art Photographer",
        "description": "Fine art landscape and wildlife photographer with 25 years of experience across 55+ countries. C2PA verified authentic photography.",
        "url": "https://archive-35.com/about.html",
        "worksFor": {
            "@type": "Organization",
            "name": "Archive-35"
        }
    },
    "contact.html": {
        "@context": "https://schema.org",
        "@type": "ContactPage",
        "name": "Contact Archive-35",
        "description": "Get in touch with Wolf Schram for print inquiries, licensing, hospitality art programs, and commissions.",
        "url": "https://archive-35.com/contact.html",
        "mainEntity": {
            "@type": "Organization",
            "name": "Archive-35",
            "email": "wolf@archive-35.com",
            "contactPoint": {
                "@type": "ContactPoint",
                "email": "wolf@archive-35.com",
                "contactType": "sales"
            }
        }
    },
    "search.html": {
        "@context": "https://schema.org",
        "@type": "SearchResultsPage",
        "name": "Search Archive-35 Photography",
        "description": "Search fine art photography by subject, mood, location, and orientation. 166+ images available for prints and licensing.",
        "url": "https://archive-35.com/search.html",
        "mainEntity": {
            "@type": "WebSite",
            "name": "Archive-35",
            "url": "https://archive-35.com"
        }
    },
    "collection.html": {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Archive-35 Photography Collections",
        "description": "Browse curated photography collections from Archive-35. Landscapes, wildlife, urban, and nature photography from 55+ countries.",
        "url": "https://archive-35.com/collection.html",
        "creator": {
            "@type": "Person",
            "name": "Wolf Schram"
        }
    }
}

import re

def inject_schema(filename, schema_data, force_replace=False):
    filepath = os.path.join(ROOT, filename)
    if not os.path.exists(filepath):
        print(f"  SKIP: {filename} not found")
        return False

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    schema_tag = f'\n<script type="application/ld+json">\n{json.dumps(schema_data, indent=2)}\n</script>\n'

    if 'application/ld+json' in content:
        if force_replace:
            # Replace existing JSON-LD block (use lambda to avoid escape issues)
            content = re.sub(
                r'\n?<script type="application/ld\+json">.*?</script>\n?',
                lambda m: schema_tag,
                content,
                count=1,
                flags=re.DOTALL
            )
            print(f"  OK: Replaced JSON-LD in {filename}")
        else:
            print(f"  SKIP: {filename} already has JSON-LD")
            return False
    else:
        if '</head>' in content:
            content = content.replace('</head>', schema_tag + '</head>', 1)
            print(f"  OK: Injected JSON-LD into {filename}")
        else:
            print(f"  ERROR: No </head> tag found in {filename}")
            return False

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    return True


def main():
    print("[Schema.org] Injecting JSON-LD structured data...")
    results = {}

    # Standard pages
    for filename, schema in SCHEMAS.items():
        success = inject_schema(filename, schema)
        results[filename] = "injected" if success else "skipped"

    # Licensing pages — build dynamic schema from catalog, force replace
    license_schema = build_licensing_schema()
    if license_schema:
        for page in ["licensing.html", "micro-licensing.html"]:
            schema_copy = dict(license_schema)
            if page == "micro-licensing.html":
                schema_copy["url"] = "https://archive-35.com/micro-licensing.html"
                schema_copy["name"] = "Archive-35 Micro-Licensing"
                schema_copy["description"] = "License fine art photography starting at $2.50. Instant download for web, editorial, and commercial use."
            success = inject_schema(page, schema_copy, force_replace=True)
            results[page] = "injected" if success else "skipped"

    print(f"\nResults: {json.dumps(results, indent=2)}")
    return results

if __name__ == "__main__":
    main()
