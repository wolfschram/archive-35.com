#!/usr/bin/env python3
"""
Schema.org JSON-LD Injector for archive-35.com
Injects structured data into HTML pages that don't already have it.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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

def inject_schema(filename, schema_data):
    filepath = os.path.join(ROOT, filename)
    if not os.path.exists(filepath):
        print(f"  SKIP: {filename} not found")
        return False

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'application/ld+json' in content:
        print(f"  SKIP: {filename} already has JSON-LD")
        return False

    schema_tag = f'\n<script type="application/ld+json">\n{json.dumps(schema_data, indent=2)}\n</script>\n'

    if '</head>' in content:
        content = content.replace('</head>', schema_tag + '</head>', 1)
    else:
        print(f"  ERROR: No </head> tag found in {filename}")
        return False

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"  OK: Injected JSON-LD into {filename}")
    return True

def main():
    print("[Schema.org] Injecting JSON-LD structured data...")
    results = {}
    for filename, schema in SCHEMAS.items():
        success = inject_schema(filename, schema)
        results[filename] = "injected" if success else "skipped"

    print(f"\nResults: {json.dumps(results, indent=2)}")
    return results

if __name__ == "__main__":
    main()
