#!/usr/bin/env python3
"""
AI Agent Broadcast Campaign for archive-35.com
Actively pushes the site into AI search indices and agent discovery networks.

Actions:
1. Ping IndexNow for all pages
2. Ping Google Indexing API (if credentials available)
3. Submit sitemaps to Bing Webmaster Tools API
4. Submit sitemaps to Google Search Console API
5. Verify robots.txt is accessible
6. Verify llms.txt is accessible
7. Verify .well-known/mcp/server.json is accessible
8. Log all submissions with timestamps

Run as one-shot: python3 ai_broadcast.py
Or schedule via agent scheduler.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # archive-35 root
AGENT_BASE = ROOT / "Archive 35 Agent"
LOG_FILE = AGENT_BASE / "data" / "broadcast_log.json"

HOST = "archive-35.com"
BASE_URL = f"https://{HOST}"

# IndexNow key (from Task 1)
INDEXNOW_KEY = "bec4410ec1fa5d67379a63e652ce0c4d"

# All pages to index
URLS = [
    f"{BASE_URL}/",
    f"{BASE_URL}/gallery.html",
    f"{BASE_URL}/licensing.html",
    f"{BASE_URL}/hospitality.html",
    f"{BASE_URL}/about.html",
    f"{BASE_URL}/contact.html",
    f"{BASE_URL}/search.html",
    f"{BASE_URL}/collection.html",
    f"{BASE_URL}/llms.txt",
    f"{BASE_URL}/llms-full.txt",
    f"{BASE_URL}/data/photos.json",
    f"{BASE_URL}/data/licensing-catalog.json",
    f"{BASE_URL}/data/product-catalog.json",
    f"{BASE_URL}/sitemap.xml",
    f"{BASE_URL}/sitemap-images.xml",
    f"{BASE_URL}/terms.html",
    f"{BASE_URL}/privacy.html",
]

# Files to verify accessibility
VERIFY_FILES = {
    "robots.txt": f"{BASE_URL}/robots.txt",
    "llms.txt": f"{BASE_URL}/llms.txt",
    "llms-full.txt": f"{BASE_URL}/llms-full.txt",
    "sitemap.xml": f"{BASE_URL}/sitemap.xml",
    "sitemap-images.xml": f"{BASE_URL}/sitemap-images.xml",
    "mcp_server.json": f"{BASE_URL}/.well-known/mcp/server.json",
    "indexnow_key": f"{BASE_URL}/{INDEXNOW_KEY}.txt",
    "photos.json": f"{BASE_URL}/data/photos.json",
    "licensing-catalog.json": f"{BASE_URL}/data/licensing-catalog.json",
}


def _log_entry(action: str, status: str, details: str = "") -> dict:
    """Create a log entry."""
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "status": status,
        "details": details,
    }


def _load_log() -> list:
    """Load broadcast log."""
    if LOG_FILE.exists():
        try:
            with open(LOG_FILE) as f:
                data = json.load(f)
                return data if isinstance(data, list) else data.get("entries", [])
        except (json.JSONDecodeError, IOError):
            pass
    return []


def _save_log(entries: list):
    """Save broadcast log."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "w") as f:
        json.dump({
            "last_broadcast": datetime.now(timezone.utc).isoformat(),
            "total_broadcasts": len(entries),
            "entries": entries,
        }, f, indent=2)


def ping_indexnow() -> dict:
    """Ping IndexNow endpoints for all pages."""
    results = {}
    payload = json.dumps({
        "host": HOST,
        "key": INDEXNOW_KEY,
        "keyLocation": f"{BASE_URL}/{INDEXNOW_KEY}.txt",
        "urlList": URLS,
    }).encode()

    endpoints = [
        "https://api.indexnow.org/indexnow",
        "https://www.bing.com/indexnow",
        "https://yandex.com/indexnow",
    ]

    for endpoint in endpoints:
        try:
            req = urllib.request.Request(
                endpoint,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                status = resp.status
                results[endpoint] = {
                    "status_code": status,
                    "success": status in (200, 202),
                    "urls_submitted": len(URLS),
                }
                print(f"  [IndexNow] {endpoint}: {status} ({len(URLS)} URLs)")
        except urllib.error.HTTPError as e:
            results[endpoint] = {
                "status_code": e.code,
                "success": False,
                "error": str(e.reason),
            }
            print(f"  [IndexNow] {endpoint}: {e.code} {e.reason}")
        except Exception as e:
            results[endpoint] = {
                "status_code": 0,
                "success": False,
                "error": str(e),
            }
            print(f"  [IndexNow] {endpoint}: Error - {e}")

    return results


def submit_sitemap_bing() -> dict:
    """Submit sitemaps to Bing Webmaster Tools."""
    # Bing allows anonymous sitemap submission via ping URL
    results = {}
    sitemaps = [
        f"{BASE_URL}/sitemap.xml",
        f"{BASE_URL}/sitemap-images.xml",
    ]

    for sitemap_url in sitemaps:
        ping_url = f"https://www.bing.com/ping?sitemap={urllib.request.quote(sitemap_url, safe='')}"
        try:
            req = urllib.request.Request(ping_url, method="GET")
            with urllib.request.urlopen(req, timeout=15) as resp:
                status = resp.status
                results[sitemap_url] = {
                    "status_code": status,
                    "success": status == 200,
                }
                print(f"  [Bing Sitemap] {sitemap_url}: {status}")
        except Exception as e:
            results[sitemap_url] = {
                "status_code": 0,
                "success": False,
                "error": str(e),
            }
            print(f"  [Bing Sitemap] {sitemap_url}: Error - {e}")

    return results


def submit_sitemap_google() -> dict:
    """Submit sitemaps to Google via ping endpoint."""
    # Google allows anonymous sitemap ping
    results = {}
    sitemaps = [
        f"{BASE_URL}/sitemap.xml",
        f"{BASE_URL}/sitemap-images.xml",
    ]

    for sitemap_url in sitemaps:
        ping_url = f"https://www.google.com/ping?sitemap={urllib.request.quote(sitemap_url, safe='')}"
        try:
            req = urllib.request.Request(ping_url, method="GET")
            with urllib.request.urlopen(req, timeout=15) as resp:
                status = resp.status
                results[sitemap_url] = {
                    "status_code": status,
                    "success": status == 200,
                }
                print(f"  [Google Sitemap] {sitemap_url}: {status}")
        except Exception as e:
            results[sitemap_url] = {
                "status_code": 0,
                "success": False,
                "error": str(e),
            }
            print(f"  [Google Sitemap] {sitemap_url}: Error - {e}")

    return results


def ping_google_indexing_api() -> dict:
    """Ping Google Indexing API if credentials are available."""
    # Check for Google service account credentials
    cred_paths = [
        ROOT / "google-credentials.json",
        AGENT_BASE / "google-credentials.json",
        Path(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent")),
    ]

    cred_file = None
    for p in cred_paths:
        if p.exists():
            cred_file = p
            break

    if not cred_file:
        return {
            "status": "skipped",
            "reason": "No Google service account credentials found. "
                      "Add google-credentials.json to project root and set "
                      "GOOGLE_APPLICATION_CREDENTIALS env var to enable.",
        }

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        credentials = service_account.Credentials.from_service_account_file(
            str(cred_file),
            scopes=["https://www.googleapis.com/auth/indexing"],
        )
        service = build("indexing", "v3", credentials=credentials)

        results = {}
        # Submit top pages only (API has quotas)
        priority_urls = URLS[:5]
        for url in priority_urls:
            try:
                body = {"url": url, "type": "URL_UPDATED"}
                response = service.urlNotifications().publish(body=body).execute()
                results[url] = {"status": "submitted", "response": str(response)}
            except Exception as e:
                results[url] = {"status": "failed", "error": str(e)}

        return {"status": "submitted", "results": results}

    except ImportError:
        return {
            "status": "skipped",
            "reason": "google-api-python-client not installed. "
                      "Run: pip install google-api-python-client google-auth",
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


def verify_files() -> dict:
    """Verify that all discovery files are accessible."""
    results = {}
    print("\nVerification:")

    for name, url in VERIFY_FILES.items():
        try:
            req = urllib.request.Request(url, method="HEAD")
            req.add_header("User-Agent", "Archive35-Broadcast/1.0")
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.status
                content_type = resp.headers.get("Content-Type", "")
                results[name] = {
                    "url": url,
                    "status_code": status,
                    "accessible": status == 200,
                    "content_type": content_type,
                }
                symbol = "OK" if status == 200 else "WARN"
                print(f"  [{symbol}] {name}: {status} ({content_type})")
        except urllib.error.HTTPError as e:
            results[name] = {
                "url": url,
                "status_code": e.code,
                "accessible": False,
                "error": str(e.reason),
            }
            print(f"  [FAIL] {name}: {e.code} {e.reason}")
        except Exception as e:
            results[name] = {
                "url": url,
                "status_code": 0,
                "accessible": False,
                "error": str(e),
            }
            print(f"  [FAIL] {name}: {e}")

    return results


def run_broadcast():
    """Run the full broadcast campaign."""
    print("=" * 60)
    print("Archive-35 AI Agent Broadcast Campaign")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    log_entries = _load_log()
    broadcast_result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "steps": {},
    }

    # Step 1: IndexNow
    print("\n1. Pinging IndexNow endpoints...")
    indexnow_results = ping_indexnow()
    broadcast_result["steps"]["indexnow"] = indexnow_results
    any_success = any(r.get("success") for r in indexnow_results.values())
    log_entries.append(_log_entry(
        "IndexNow ping",
        "success" if any_success else "failed",
        f"{len(URLS)} URLs submitted to {len(indexnow_results)} endpoints",
    ))

    # Step 2: Google Indexing API
    print("\n2. Google Indexing API...")
    google_api_result = ping_google_indexing_api()
    broadcast_result["steps"]["google_indexing_api"] = google_api_result
    print(f"  Status: {google_api_result.get('status')}")
    if google_api_result.get("reason"):
        print(f"  Note: {google_api_result['reason']}")
    log_entries.append(_log_entry(
        "Google Indexing API",
        google_api_result.get("status", "unknown"),
        google_api_result.get("reason", ""),
    ))

    # Step 3: Bing sitemap submission
    print("\n3. Submitting sitemaps to Bing...")
    bing_results = submit_sitemap_bing()
    broadcast_result["steps"]["bing_sitemaps"] = bing_results
    bing_ok = any(r.get("success") for r in bing_results.values())
    log_entries.append(_log_entry(
        "Bing sitemap submission",
        "success" if bing_ok else "failed",
        f"{len(bing_results)} sitemaps submitted",
    ))

    # Step 4: Google sitemap submission
    print("\n4. Submitting sitemaps to Google...")
    google_results = submit_sitemap_google()
    broadcast_result["steps"]["google_sitemaps"] = google_results
    google_ok = any(r.get("success") for r in google_results.values())
    log_entries.append(_log_entry(
        "Google sitemap submission",
        "success" if google_ok else "failed",
        f"{len(google_results)} sitemaps submitted",
    ))

    # Step 5: Verify discovery files
    print("\n5. Verifying discovery files...")
    verify_results = verify_files()
    broadcast_result["steps"]["verification"] = verify_results
    accessible_count = sum(1 for r in verify_results.values() if r.get("accessible"))
    total_count = len(verify_results)
    log_entries.append(_log_entry(
        "File verification",
        "success" if accessible_count == total_count else "partial",
        f"{accessible_count}/{total_count} files accessible",
    ))

    # Save log
    _save_log(log_entries)

    # Summary
    print("\n" + "=" * 60)
    print("BROADCAST SUMMARY")
    print("=" * 60)
    print(f"  IndexNow: {'OK' if any_success else 'FAILED'}")
    print(f"  Google Indexing API: {google_api_result.get('status')}")
    print(f"  Bing Sitemaps: {'OK' if bing_ok else 'FAILED'}")
    print(f"  Google Sitemaps: {'OK' if google_ok else 'FAILED'}")
    print(f"  Discovery Files: {accessible_count}/{total_count} accessible")
    print(f"\nLog saved to: {LOG_FILE}")

    return broadcast_result


if __name__ == "__main__":
    run_broadcast()
