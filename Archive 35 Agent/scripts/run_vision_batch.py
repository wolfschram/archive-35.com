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

total_analyzed = 0
total_failed = 0

print("Starting vision analysis (1 photo at a time)", flush=True)
print("=" * 60, flush=True)

while True:
    try:
        # Get next unanalyzed photo
        req = urllib.request.Request(
            f"{API}/photos?analyzed=false&limit=1",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        items = data.get("items", [])
        if not items:
            print("\n" + "=" * 60, flush=True)
            print(f"DONE! Analyzed: {total_analyzed}, Failed: {total_failed}", flush=True)
            break

        photo = items[0]
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
                pct = round(total_analyzed / 721 * 100)
                print(f"OK  {total_analyzed:3d} | score={score} | {remaining} left | {fname}", flush=True)
            else:
                total_failed += 1
                print(f"SKIP {fname} (failed, marked)", flush=True)

        except (urllib.error.URLError, TimeoutError) as e:
            total_failed += 1
            print(f"TIMEOUT {fname} — skipping", flush=True)
            # Mark it as failed via a direct call
            try:
                req = urllib.request.Request(
                    f"{API}/photos/analyze",
                    data=json.dumps({"photo_ids": [photo_id], "limit": 1}).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception:
                pass

        time.sleep(0.2)

    except Exception as e:
        print(f"Error: {e}", flush=True)
        time.sleep(3)
