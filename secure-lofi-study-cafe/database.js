"use strict";

const { createClient } = require("@libsql/client");

const databaseUrl =
  process.env.TURSO_DATABASE_URL || "file:lofi_cafe.db";

const databaseAuthToken =
  process.env.TURSO_AUTH_TOKEN || undefined;

if (
  process.env.NODE_ENV === "production" &&
  !process.env.TURSO_DATABASE_URL
) {
  throw new Error(
    "TURSO_DATABASE_URL is required in production."
  );
}

if (
  process.env.NODE_ENV === "production" &&
  String(databaseUrl).startsWith("libsql://") &&
  !databaseAuthToken
) {
  throw new Error(
    "TURSO_AUTH_TOKEN is required for the production Turso database."
  );
}

const client = createClient({
  url: databaseUrl,
  authToken: databaseAuthToken
});

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    avatar_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message_text TEXT NOT NULL,
    deleted_at DATETIME,
    deleted_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (deleted_by) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS music_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    video_id TEXT NOT NULL,
    start_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS music_queue (
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
  )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    event_type TEXT NOT NULL DEFAULT 'legacy',
    target_user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS security_events (
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
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
    ON sessions(expires_at)`,

  `CREATE INDEX IF NOT EXISTS idx_security_events_created_at
    ON security_events(created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_security_events_type
    ON security_events(event_type)`,

  `CREATE INDEX IF NOT EXISTS idx_security_events_actor
    ON security_events(actor_user_id)`,

  `CREATE INDEX IF NOT EXISTS idx_security_events_severity_outcome
    ON security_events(severity, outcome)`,

  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs(created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_messages_user_created
    ON messages(user_id, created_at)`
];

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

function normalizeValue(value) {
  return typeof value === "bigint" ? Number(value) : value;
}

function normalizeRow(row) {
  if (!row) {
    return row;
  }

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      normalizeValue(value)
    ])
  );
}

async function columnExists(table, column) {
  const result = await client.execute(
    `PRAGMA table_info(${table})`
  );

  return result.rows.some(
    (row) => String(row.name) === column
  );
}

async function initialize() {
  for (const statement of schemaStatements) {
    await client.execute(statement);
  }

  for (const [table, column, statement] of migrations) {
    if (!(await columnExists(table, column))) {
      await client.execute(statement);
    }
  }

  console.log(
    process.env.TURSO_DATABASE_URL
      ? "Connected to Turso/libSQL database."
      : "Connected to local libSQL database."
  );
}

const ready = initialize();

async function run(sql, params = []) {
  await ready;

  const result = await client.execute({
    sql,
    args: params
  });

  return {
    lastID:
      result.lastInsertRowid === undefined ||
      result.lastInsertRowid === null
        ? undefined
        : normalizeValue(result.lastInsertRowid),
    changes: Number(result.rowsAffected || 0)
  };
}

async function get(sql, params = []) {
  await ready;

  const result = await client.execute({
    sql,
    args: params
  });

  return result.rows.length
    ? normalizeRow(result.rows[0])
    : undefined;
}

async function all(sql, params = []) {
  await ready;

  const result = await client.execute({
    sql,
    args: params
  });

  return result.rows.map(normalizeRow);
}

module.exports = {
  ready,
  run,
  get,
  all
};
