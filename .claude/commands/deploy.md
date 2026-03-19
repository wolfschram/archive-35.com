# Deploy Website

Deploy the archive-35.com website to Cloudflare Pages.

## Steps

1. Run gallery sync (NEVER skip this):
```bash
python3 sync_gallery_data.py
```

2. Check for secrets in staged files:
```bash
git diff --cached | grep -i 'sk_live\|sk_test\|api_key\|password\|secret' && echo 'WARNING: Possible secrets detected!' || echo 'No secrets found'
```

3. Commit and push:
```bash
git add agent-dashboard.html micro-licensing.html licensing.html data/ functions/
git commit -m "$ARGUMENTS"
git push
```

4. Wait for Cloudflare deployment (2 minutes)

5. Verify critical pages:
```bash
curl -s -o /dev/null -w '%{http_code}' https://archive-35.com/ && echo ' homepage'
curl -s -o /dev/null -w '%{http_code}' https://archive-35.com/licensing && echo ' licensing'
curl -s -o /dev/null -w '%{http_code}' https://archive-35.com/micro-licensing && echo ' micro-licensing'
curl -s -o /dev/null -w '%{http_code}' https://archive-35.com/agent-dashboard && echo ' dashboard'
curl -s -o /dev/null -w '%{http_code}' https://archive-35.com/api/license/gallery && echo ' x402 gallery'
curl -s -o /dev/null -w '%{http_code}' https://archive-35.com/.well-known/openapi.json && echo ' openapi'
```

6. If ANY page returns non-200/308, STOP and investigate before continuing.
