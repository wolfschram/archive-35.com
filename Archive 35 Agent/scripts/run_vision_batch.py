"""Run vision analysis on all unanalyzed photos, one at a time.

Usage: python3 scripts/run_vision_batch.py
"""
import json
import sys
import time
import urllib.request
import urllib.error

API = "http://127.0.0.1:8035"
PHOTO_TIMEOUT = 60  # 60s max per single photo
MAX_PAGE = 500  # don't scan more than this many unanalyzed photos

total_analyzed = 0
total_failed = 0
failed_ids = set()  # Track failed IDs to skip them

print("Starting vision analysis (1 photo at a time)", flush=True)
print("=" * 60, flush=True)

while True:
    try:
        # Get unanalyzed photos (fetch a small batch to find one we haven't failed on)
        req = urllib.request.Request(
            f"{API}/photos?analyzed=false&limit=50",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        items = data.get("items", [])
        if not items:
            print("\n" + "=" * 60, flush=True)
            print(f"DONE! Analyzed: {total_analyzed}, Failed: {total_failed}", flush=True)
            break

        # Find first photo we haven't already failed on
        photo = None
        for item in items:
            if item["id"] not in failed_ids:
                photo = item
                break

        if photo is None:
            # All returned photos are known failures — check if there are more
            if len(failed_ids) >= MAX_PAGE:
                print(f"\nSTOPPED — too many failures ({len(failed_ids)})", flush=True)
                break
            # Try with a larger offset
            req = urllib.request.Request(
                f"{API}/photos?analyzed=false&limit=50&offset={len(failed_ids)}",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            items = data.get("items", [])
            for item in items:
                if item["id"] not in failed_ids:
                    photo = item
                    break
            if photo is None:
                print(f"\nDONE! All remaining photos failed. Analyzed: {total_analyzed}, Failed: {total_failed}", flush=True)
                break

        photo_id = photo["id"]
        fname = photo.get("filename", "unknown")

        # Analyze this single photo
        try:
            req = urllib.request.Request(
                f"{API}/photos/analyze",
                data=json.dumps({"photo_ids": [photo_id], "limit": 1}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=PHOTO_TIMEOUT) as resp:
                result = json.loads(resp.read())

            analyzed = result.get("analyzed", 0)
            remaining = result.get("remaining_unanalyzed", 0)

            if analyzed > 0:
                total_analyzed += 1
                score = result.get("results", [{}])[0].get("marketability_score", "?")
                print(f"OK  {total_analyzed:3d} | score={score} | {remaining} left | {fname}", flush=True)
            else:
                total_failed += 1
                failed_ids.add(photo_id)
                print(f"SKIP {fname} (failed, {len(failed_ids)} total skipped)", flush=True)

        except (urllib.error.URLError, TimeoutError) as e:
            total_failed += 1
            failed_ids.add(photo_id)
            print(f"TIMEOUT {fname} — skipping ({len(failed_ids)} total skipped)", flush=True)

        time.sleep(0.2)

    except Exception as e:
        print(f"Error: {e}", flush=True)
        time.sleep(3)
