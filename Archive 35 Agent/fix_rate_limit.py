# Run with: cd "Archive 35 Agent" && uv run python fix_rate_limit.py

from src.config import get_settings
from src.db import get_initialized_connection
from datetime import datetime, timezone

settings = get_settings()
conn = get_initialized_connection(settings.db_path)

conn.execute("""
    UPDATE rate_limits
    SET calls_today = 0, cost_today_usd = 0.0, last_reset = ?
    WHERE api_name = 'anthropic'
""", (datetime.now(timezone.utc).date().isoformat(),))
conn.commit()

rows = conn.execute("SELECT api_name, calls_today, cost_today_usd FROM rate_limits").fetchall()
for r in rows:
    print(dict(r))
print("Done")
