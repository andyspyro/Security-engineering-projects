"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const defaultDatabasePath =
  process.env.NODE_ENV === "production"
    ? "/var/lib/secure-lofi-study-cafe/lofi_cafe.db"
    : path.join(__dirname, "data", "lofi_cafe.db");

const databasePath = path.resolve(
  process.env.DB_PATH || defaultDatabasePath
);

const databaseDirectory = path.dirname(databasePath);

fs.mkdirSync(databaseDirectory, {
  recursive: true,
  mode: 0o700
});

const raw = new sqlite3.Database(databasePath);

function rawRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    raw.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function rawGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    raw.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function rawAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    raw.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

function rawExec(sql) {
  return new Promise((resolve, reject) => {
    raw.exec(sql, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

async function columnExists(table, column) {
  const rows = await rawAll(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function initialize() {
  await rawExec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      avatar_image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message_text TEXT NOT NULL,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (deleted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS music_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      video_id TEXT NOT NULL,
      start_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS music_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      video_id TEXT NOT NULL,
      start_seconds INTEGER NOT NULL DEFAULT 0,
      requested_by INTEGER,
      approved_by INTEGER,
      position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requested_by) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_type TEXT NOT NULL DEFAULT 'legacy',
      target_user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uuid TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'INFO',
      actor_user_id INTEGER,
      username_snapshot TEXT,
      target_user_id INTEGER,
      outcome TEXT NOT NULL DEFAULT 'success',
      http_method TEXT,
      route TEXT,
      request_id TEXT,
      session_ref TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);

    CREATE INDEX IF NOT EXISTS idx_security_events_created_at
      ON security_events(created_at);

    CREATE INDEX IF NOT EXISTS idx_security_events_type
      ON security_events(event_type);

    CREATE INDEX IF NOT EXISTS idx_security_events_actor
      ON security_events(actor_user_id);

    CREATE INDEX IF NOT EXISTS idx_security_events_severity_outcome
      ON security_events(severity, outcome);

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
      ON audit_logs(created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_user_created
      ON messages(user_id, created_at);
  `);

  const migrations = [
    ["users", "avatar_image", "ALTER TABLE users ADD COLUMN avatar_image TEXT"],
    [
      "music_requests",
      "start_seconds",
      "ALTER TABLE music_requests ADD COLUMN start_seconds INTEGER NOT NULL DEFAULT 0"
    ],
    [
      "messages",
      "deleted_at",
      "ALTER TABLE messages ADD COLUMN deleted_at DATETIME"
    ],
    [
      "messages",
      "deleted_by",
      "ALTER TABLE messages ADD COLUMN deleted_by INTEGER"
    ],
    [
      "audit_logs",
      "event_type",
      "ALTER TABLE audit_logs ADD COLUMN event_type TEXT NOT NULL DEFAULT 'legacy'"
    ],
    [
      "audit_logs",
      "target_user_id",
      "ALTER TABLE audit_logs ADD COLUMN target_user_id INTEGER"
    ],
    [
      "audit_logs",
      "details",
      "ALTER TABLE audit_logs ADD COLUMN details TEXT"
    ]
  ];

  for (const [table, column, statement] of migrations) {
    if (!(await columnExists(table, column))) {
      await rawRun(statement);
    }
  }

  const journal = await rawGet("PRAGMA journal_mode");
  const foreignKeys = await rawGet("PRAGMA foreign_keys");

  console.log(
    `Connected to SQLite database at ${databasePath} (journal=${journal.journal_mode}, foreign_keys=${foreignKeys.foreign_keys}).`
  );
}

const ready = initialize();

async function run(sql, params = []) {
  await ready;
  return rawRun(sql, params);
}

async function get(sql, params = []) {
  await ready;
  return rawGet(sql, params);
}

async function all(sql, params = []) {
  await ready;
  return rawAll(sql, params);
}

async function exec(sql) {
  await ready;
  return rawExec(sql);
}

async function checkpoint(mode = "PASSIVE") {
  await ready;

  const allowed = new Set(["PASSIVE", "FULL", "RESTART", "TRUNCATE"]);
  const selected = allowed.has(String(mode).toUpperCase())
    ? String(mode).toUpperCase()
    : "PASSIVE";

  return rawGet(`PRAGMA wal_checkpoint(${selected})`);
}

async function close() {
  await ready;

  return new Promise((resolve, reject) => {
    raw.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

module.exports = {
  path: databasePath,
  ready,
  run,
  get,
  all,
  exec,
  checkpoint,
  close
};
