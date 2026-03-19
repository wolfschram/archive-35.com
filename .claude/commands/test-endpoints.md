# Test All API Endpoints

Run a comprehensive check of every API endpoint on the agent (port 8035).

## Run all tests:

```bash
echo '=== HEALTH ===' && curl -s http://localhost:8035/health | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Status:{d[\"status\"]} Etsy:{d.get(\"etsy_listings\")} IG:{d.get(\"instagram_configured\")} Sales:{d.get(\"sales\")}')"

echo '=== CLOUDFLARE ANALYTICS ===' && curl -s http://localhost:8035/analytics/cloudflare | python3 -c "import sys,json;d=json.load(sys.stdin);t=d.get('totals',{});print(f'Visitors 7d:{t.get(\"visitors_7d\",\"ERR\")} Pages:{len(d.get(\"top_pages\",[]))}')"

echo '=== ATHOS ANALYTICS ===' && curl -s http://localhost:8035/analytics/athos | python3 -c "import sys,json;d=json.load(sys.stdin);t=d.get('totals',{});print(f'Visitors 7d:{t.get(\"visitors_7d\",\"ERR\")}')"

echo '=== REDDIT ===' && curl -s http://localhost:8035/reddit/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Queued:{d.get(\"queue\",{}).get(\"queued\",\"ERR\")} Posted:{d.get(\"queue\",{}).get(\"posted\",\"ERR\")}')"

echo '=== INSTAGRAM ===' && curl -s http://localhost:8035/instagram/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Configured:{d.get(\"configured\")} Valid:{d.get(\"valid\")} Expires:{d.get(\"token_expires\")}')"

echo '=== ETSY ===' && curl -s http://localhost:8035/etsy/shop-stats | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Listings:{d.get(\"total_listings\")} Views:{d.get(\"total_views\")} Error:{d.get(\"error\",\"none\")}')"

echo '=== PINTEREST ===' && curl -s http://localhost:8035/pinterest/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Connected:{d.get(\"connected\")} Expires:{d.get(\"token_expires\")}')"

echo '=== EMAIL ===' && curl -s http://localhost:8035/email/briefing | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Emails:{d.get(\"total_emails\",\"ERR\")} Action:{d.get(\"summary\",{}).get(\"action_required\",\"ERR\")}')"

echo '=== BROADCAST ===' && curl -s http://localhost:8035/broadcast/status | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Runs:{d.get(\"total_broadcasts\",\"ERR\")}')"

echo '=== x402 LICENSE ===' && curl -s -w ' HTTP:%{http_code}' 'https://archive-35.com/api/license/A35-20260210-0001' | python3 -c "import sys;data=sys.stdin.read();print(data[-10:])"

echo '=== CREDITS ===' && curl -s -w ' HTTP:%{http_code}' 'https://archive-35.com/api/credits/balance?api_key=test' | head -1
```

If ANY endpoint fails, log the error and fix it before proceeding with other work.
