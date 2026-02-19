"""Tests for the database module."""

import sqlite3
import tempfile
from pathlib import Path

import pytest

from src.db import get_connection, get_initialized_connection, init_schema


@pytest.fixture
def tmp_db_path(tmp_path: Path) -> str:
    """Return a temporary database path."""
    return str(tmp_path / "test.db")


def test_get_connection_creates_file(tmp_db_path: str):
    """get_connection should create the database file."""
    conn = get_connection(tmp_db_path)
    assert Path(tmp_db_path).exists()
    conn.close()


def test_wal_mode_enabled(tmp_db_path: str):
    """Connection should use WAL journal mode."""
    conn = get_connection(tmp_db_path)
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode == "wal"
    conn.close()


def test_foreign_keys_enabled(tmp_db_path: str):
    """Foreign keys should be enabled."""
    conn = get_connection(tmp_db_path)
    fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    assert fk == 1
    conn.close()


def test_row_factory_is_row(tmp_db_path: str):
    """Row factory should be sqlite3.Row for dict-like access."""
    conn = get_connection(tmp_db_path)
    assert conn.row_factory == sqlite3.Row
    conn.close()


def test_init_schema_creates_all_tables(tmp_db_path: str):
    """init_schema should create all expected tables."""
    conn = get_connection(tmp_db_path)
    init_schema(conn)

    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = {row[0] for row in cursor.fetchall()}

    expected = {
        "photos",
        "content",
        "actions_ledger",
        "rate_limits",
        "audit_log",
        "kill_switch",
        "sku_catalog",
        "greatest_hits",
    }
    assert expected.issubset(tables), f"Missing tables: {expected - tables}"
    conn.close()


def test_insert_and_read_photo(tmp_db_path: str):
    """Should be able to insert and read back a photo record."""
    conn = get_initialized_connection(tmp_db_path)

    conn.execute(
        """INSERT INTO photos (id, filename, path, imported_at)
           VALUES (?, ?, ?, ?)""",
        ("abc123", "test.jpg", "/photos/test.jpg", "2026-02-18T00:00:00Z"),
    )
    conn.commit()

    row = conn.execute("SELECT * FROM photos WHERE id = ?", ("abc123",)).fetchone()
    assert row["filename"] == "test.jpg"
    assert row["path"] == "/photos/test.jpg"
    conn.close()


def test_schema_is_idempotent(tmp_db_path: str):
    """Running init_schema twice should not error."""
    conn = get_connection(tmp_db_path)
    init_schema(conn)
    init_schema(conn)  # Should not raise

    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = [row[0] for row in cursor.fetchall()]
    assert len(tables) >= 8
    conn.close()


def test_creates_parent_directories(tmp_path: Path):
    """get_connection should create parent directories if needed."""
    db_path = str(tmp_path / "nested" / "dir" / "test.db")
    conn = get_connection(db_path)
    assert Path(db_path).exists()
    conn.close()
