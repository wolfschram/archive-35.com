"""Debug vision analysis — check each failure condition."""
import json
import urllib.request

API = "http://127.0.0.1:8035"

# 1. Check if Anthropic client works
print("=== Testing Anthropic API key ===")
try:
    req = urllib.request.Request(
        f"{API}/pipeline/run?dry_run=true",
        data=json.dumps({"component": "vision"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    print(f"Vision test: {json.dumps(result)}")
except Exception as e:
    print(f"Vision test FAILED: {e}")

# 2. Check rate limits
print("\n=== Checking rate limits / stats ===")
try:
    req = urllib.request.Request(f"{API}/stats")
    with urllib.request.urlopen(req, timeout=10) as resp:
        stats = json.loads(resp.read())
    print(f"Costs today: ${stats.get('costs', {}).get('today_usd', '?')}")
    print(f"Costs total: ${stats.get('costs', {}).get('total_usd', '?')}")
    print(f"Photos: {stats.get('photos', {})}")
except Exception as e:
    print(f"Stats FAILED: {e}")

# 3. Check pipeline logs for errors
print("\n=== Recent audit log (vision) ===")
try:
    req = urllib.request.Request(f"{API}/pipeline/logs?component=vision&limit=5")
    with urllib.request.urlopen(req, timeout=10) as resp:
        logs = json.loads(resp.read())
    for item in logs.get("items", []):
        print(f"  {item.get('action')} | {item.get('details', '')[:100]}")
except Exception as e:
    print(f"Logs FAILED: {e}")

# 4. Direct single-photo test with explicit ID
print("\n=== Direct photo analysis test ===")
try:
    req = urllib.request.Request(f"{API}/photos?analyzed=false&limit=1")
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    photo = data["items"][0]
    print(f"Photo: {photo['filename']}")
    print(f"Path: {photo.get('path', 'NO PATH')}")

    # Now try to analyze
    req = urllib.request.Request(
        f"{API}/photos/analyze",
        data=json.dumps({"photo_ids": [photo["id"]], "limit": 1}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    print(f"Result: {json.dumps(result, indent=2)}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"HTTP {e.code}: {body}")
except Exception as e:
    print(f"Error: {e}")
