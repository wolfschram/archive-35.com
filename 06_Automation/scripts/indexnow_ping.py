#!/usr/bin/env python3
"""
IndexNow URL Submission for archive-35.com
Pings Bing/Yandex/IndexNow API to request immediate crawling.
Run after every deploy or content update.
"""
import requests
import json
import sys

INDEXNOW_KEY = "bec4410ec1fa5d67379a63e652ce0c4d"
HOST = "archive-35.com"
KEY_LOCATION = f"https://{HOST}/{INDEXNOW_KEY}.txt"

# All pages that should be indexed
URLS = [
    f"https://{HOST}/",
    f"https://{HOST}/gallery.html",
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
    f"https://{HOST}/terms.html",
    f"https://{HOST}/privacy.html",
]

def submit_urls():
    payload = {
        "host": HOST,
        "key": INDEXNOW_KEY,
        "keyLocation": KEY_LOCATION,
        "urlList": URLS
    }

    endpoints = [
        "https://api.indexnow.org/indexnow",
        "https://www.bing.com/indexnow",
        "https://yandex.com/indexnow",
    ]

    results = []
    for endpoint in endpoints:
        try:
            r = requests.post(endpoint, json=payload, headers={"Content-Type": "application/json"})
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
    submit_urls()
