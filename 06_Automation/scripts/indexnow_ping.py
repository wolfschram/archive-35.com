#!/usr/bin/env python3
"""
IndexNow URL Submission for archive-35.com
Notifies the shared IndexNow endpoint after verifying site ownership.
Run after every deploy or content update.
"""
import requests
import json
import sys
from pathlib import Path

INDEXNOW_KEY = "18ec60561b312a029d7821d84812a085"
HOST = "archive-35.com"
KEY_LOCATION = f"https://{HOST}/{INDEXNOW_KEY}.txt"
SPEC_PATH = (
    Path(__file__).resolve().parents[2]
    / "Archive 35 Agent/experiments/etsy-digital-mvp.json"
)


def printable_urls():
    spec = json.loads(SPEC_PATH.read_text())
    return [
        f"https://{HOST}/printable-{product['web_slug']}.html"
        for product in spec["products"]
    ]

# All pages that should be indexed
URLS = [
    f"https://{HOST}/",
    f"https://{HOST}/gallery.html",
    f"https://{HOST}/printables",
    f"https://{HOST}/printable-desert-wall-art-set-of-3.html",
    f"https://{HOST}/licensing.html",
    f"https://{HOST}/hospitality.html",
    f"https://{HOST}/about.html",
    f"https://{HOST}/contact.html",
    f"https://{HOST}/search.html",
    f"https://{HOST}/collection.html",
    f"https://{HOST}/llms.txt",
    f"https://{HOST}/llms-full.txt",
    f"https://{HOST}/data/photos.json",
    f"https://{HOST}/data/licensing-catalog.json",
    f"https://{HOST}/data/product-catalog.json",
    f"https://{HOST}/sitemap.xml",
    f"https://{HOST}/sitemap-printables.xml",
    f"https://{HOST}/terms.html",
    f"https://{HOST}/privacy.html",
] + printable_urls()

def submit_urls():
    payload = {
        "host": HOST,
        "key": INDEXNOW_KEY,
        "keyLocation": KEY_LOCATION,
        "urlList": URLS
    }

    endpoints = ["https://api.indexnow.org/indexnow"]

    results = []
    for endpoint in endpoints:
        try:
            r = requests.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json; charset=utf-8"},
                timeout=15,
            )
            print(f"[IndexNow] {endpoint}: {r.status_code}")
            if r.status_code in (200, 202):
                print(f"  OK Submitted {len(URLS)} URLs successfully")
                results.append({"endpoint": endpoint, "status": r.status_code, "success": True})
            else:
                print(f"  FAIL Response: {r.text[:200]}")
                results.append({"endpoint": endpoint, "status": r.status_code, "success": False})
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({"endpoint": endpoint, "error": str(e), "success": False})

    return results

if __name__ == "__main__":
    sys.exit(0 if any(r.get("success") for r in submit_urls()) else 1)
