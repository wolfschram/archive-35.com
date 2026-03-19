# Verify All Live Pages

Check that all critical pages on archive-35.com are loading correctly.
Run this after every deploy.

```bash
echo 'Checking archive-35.com pages...'
for page in '' 'gallery' 'licensing' 'micro-licensing' 'hospitality' 'about' 'contact' 'search' 'agent-dashboard' 'sitemap.xml' 'llms.txt' 'robots.txt' '.well-known/openapi.json' '.well-known/mcp/server.json' 'api/license/gallery'; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://archive-35.com/$page")
  if [ "$code" = "200" ] || [ "$code" = "308" ]; then
    echo "  ✓ /$page ($code)"
  else
    echo "  ✗ /$page ($code) — BROKEN"
  fi
done
```

If ANY page shows BROKEN, investigate and fix before continuing.
