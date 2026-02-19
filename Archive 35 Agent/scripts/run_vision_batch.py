"""Run vision analysis on all unanalyzed photos in batches.

Usage: uv run python scripts/run_vision_batch.py [batch_size]
"""
import json
import sys
import time
import urllib.request
import urllib.error

BATCH_SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 10
API = "http://127.0.0.1:8035"
REQUEST_TIMEOUT = 120  # 2 min max per batch

total_analyzed = 0
total_failed = 0
batch_num = 0

print(f"Starting vision analysis (batch size: {BATCH_SIZE}, timeout: {REQUEST_TIMEOUT}s)", flush=True)
print("=" * 60, flush=True)

while True:
    batch_num += 1
    try:
        req = urllib.request.Request(
            f"{API}/photos/analyze",
            data=json.dumps({"limit": BATCH_SIZE}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read())

        analyzed = data.get("analyzed", 0)
        requested = data.get("requested", 0)
        remaining = data.get("remaining_unanalyzed", 0)
        failed = requested - analyzed
        total_analyzed += analyzed
        total_failed += failed

        pct = round((total_analyzed / 721) * 100) if total_analyzed > 0 else 0
        print(
            f"Batch {batch_num}: +{analyzed} ok, {failed} skip | "
            f"Total: {total_analyzed} ({pct}%) | Remaining: {remaining}",
            flush=True,
        )

        if analyzed == 0 or remaining == 0:
            print("\n" + "=" * 60, flush=True)
            print(f"DONE! Analyzed: {total_analyzed}, Skipped: {total_failed}", flush=True)
            break

        time.sleep(0.5)

    except urllib.error.URLError as e:
        print(f"Batch {batch_num} timeout/error: {e}", flush=True)
        print("Retrying in 3s...", flush=True)
        time.sleep(3)
    except Exception as e:
        print(f"Batch {batch_num} unexpected error: {e}", flush=True)
        print("Retrying in 5s...", flush=True)
        time.sleep(5)
