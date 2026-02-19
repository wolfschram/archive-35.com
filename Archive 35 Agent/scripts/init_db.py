"""Initialize the Archive-35 SQLite database.

Creates all tables defined in the schema. Safe to run multiple times
(uses CREATE TABLE IF NOT EXISTS).

Usage:
    uv run python scripts/init_db.py
    uv run python scripts/init_db.py --db-path /custom/path.db
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add project root to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import get_initialized_connection


def main() -> None:
    """Initialize the database with all tables."""
    parser = argparse.ArgumentParser(description="Initialize Archive-35 database")
    parser.add_argument(
        "--db-path",
        default="data/archive35.db",
        help="Path to SQLite database (default: data/archive35.db)",
    )
    args = parser.parse_args()

    conn = get_initialized_connection(args.db_path)

    # Verify tables were created
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = [row[0] for row in cursor.fetchall()]

    print(f"Database initialized at: {args.db_path}")
    print(f"Tables created: {', '.join(tables)}")

    conn.close()


if __name__ == "__main__":
    main()
