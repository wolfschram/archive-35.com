"""Archive-35 database module.

SQLite connection management with WAL mode for concurrent reads.
Provides connection factory and schema initialization.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional


# All CREATE TABLE statements for the Archive-35 schema.
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    exif_json TEXT,
    collection TEXT,
    vision_tags TEXT,
    vision_mood TEXT,
    vision_composition TEXT,
    vision_analyzed_at TEXT,
    marketability_score INTEGER
);

CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY,
    photo_id TEXT NOT NULL REFERENCES photos(id),
    platform TEXT NOT NULL,
    content_type TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT,
    variant INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    approved_at TEXT,
    posted_at TEXT,
    expires_at TEXT,
    provenance TEXT
);

CREATE TABLE IF NOT EXISTS actions_ledger (
    id TEXT PRIMARY KEY,
    action_hash TEXT UNIQUE NOT NULL,
    action_type TEXT NOT NULL,
    target TEXT NOT NULL,
    content_id TEXT REFERENCES content(id),
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    executed_at TEXT,
    cost_usd REAL DEFAULT 0,
    error TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
    api_name TEXT PRIMARY KEY,
    calls_today INTEGER DEFAULT 0,
    cost_today_usd REAL DEFAULT 0,
    daily_call_limit INTEGER NOT NULL,
    daily_cost_limit_usd REAL NOT NULL,
    last_reset TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    component TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    cost_usd REAL DEFAULT 0,
    success INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS kill_switch (
    scope TEXT PRIMARY KEY,
    active INTEGER DEFAULT 0,
    activated_at TEXT,
    activated_by TEXT,
    reason TEXT
);

CREATE TABLE IF NOT EXISTS sku_catalog (
    sku TEXT PRIMARY KEY,
    photo_id TEXT REFERENCES photos(id),
    collection TEXT NOT NULL,
    size_code TEXT NOT NULL,
    paper_code TEXT NOT NULL,
    edition_type TEXT NOT NULL,
    edition_total INTEGER,
    edition_sold INTEGER DEFAULT 0,
    base_cost_usd REAL NOT NULL,
    min_price_usd REAL NOT NULL,
    list_price_usd REAL NOT NULL,
    active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS greatest_hits (
    id TEXT PRIMARY KEY,
    content_id TEXT REFERENCES content(id),
    platform TEXT NOT NULL,
    times_posted INTEGER DEFAULT 1,
    last_posted_at TEXT,
    performance_score REAL,
    eligible INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS content_masters (
    id TEXT PRIMARY KEY,
    content_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    collection TEXT,
    title TEXT,
    body TEXT NOT NULL,
    tags TEXT,
    provenance TEXT,
    skus TEXT,
    approved_at TEXT NOT NULL,
    last_reused TEXT,
    reuse_count INTEGER DEFAULT 0,
    performance_score REAL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(content_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_content_masters_photo_id ON content_masters(photo_id);
CREATE INDEX IF NOT EXISTS idx_content_masters_platform ON content_masters(platform);

-- Sentinel row for mockup content (satisfies FK constraint when no real photo)
INSERT OR IGNORE INTO photos (id, filename, path, imported_at)
    VALUES ('__mockup__', '__mockup__', '__mockup__', '2026-01-01T00:00:00Z');
"""


def get_connection(db_path: str | Path = "data/archive35.db") -> sqlite3.Connection:
    """Create a SQLite connection with WAL mode and recommended pragmas.

    Args:
        db_path: Path to the SQLite database file.

    Returns:
        Configured sqlite3.Connection with WAL mode enabled.
    """
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create all tables if they don't exist.

    Args:
        conn: Active SQLite connection.
    """
    conn.executescript(SCHEMA_SQL)
    conn.commit()


def get_initialized_connection(
    db_path: str | Path = "data/archive35.db",
) -> sqlite3.Connection:
    """Get a connection with schema already initialized.

    Convenience function that combines get_connection + init_schema.

    Args:
        db_path: Path to the SQLite database file.

    Returns:
        Configured and initialized sqlite3.Connection.
    """
    conn = get_connection(db_path)
    init_schema(conn)
    return conn
