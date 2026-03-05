/**
 * Database wrapper — uses Node.js 22 built-in sqlite module.
 * Provides a consistent API similar to better-sqlite3.
 * Falls back to better-sqlite3 if available (for Wolf's local Mac).
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'pipeline.db');

let db;

try {
  // Try better-sqlite3 first (Wolf's local environment)
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db._engine = 'better-sqlite3';
} catch {
  // Fall back to Node.js built-in sqlite (Node 22+)
  const { DatabaseSync } = require('node:sqlite');
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`pipeline.db not found at ${DB_PATH}. Run: npm run init-db`);
  }
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db._engine = 'node:sqlite';

  // Add transaction helper (better-sqlite3 compat)
  db.transaction = function(fn) {
    return function(...args) {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    };
  };
}

module.exports = db;
module.exports.DB_PATH = DB_PATH;
