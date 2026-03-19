# Restart Agent API

Restart the Docker agent API service and verify it comes back online.

```bash
cd ~/Documents/ACTIVE/archive-35/Archive\ 35\ Agent
docker compose restart agent-api
sleep 10
curl -s http://localhost:8035/health | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Agent: {d[\"status\"]}')" || echo 'AGENT NOT RESPONDING'
```
