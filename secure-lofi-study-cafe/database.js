"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DEFAULT_ROOM_ID = 1;

const defaultDatabasePath =
  process.env.NODE_ENV === "production"
    ? "/var/lib/secure-lofi-study-cafe/lofi_cafe.db"
    : path.join(__dirname, "data", "lofi_cafe.db");

const databasePath = path.resolve(
  process.env.DB_PATH || defaultDatabasePath
);

fs.mkdirSync(path.dirname(databasePath), {
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

async function addColumnIfMissing(table, column, sql) {
  if (!(await columnExists(table, column))) {
    await rawRun(sql);
  }
}

async function initialize() {
  await rawExec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS roles (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_name TEXT NOT NULL,
      permission_name TEXT NOT NULL,
      PRIMARY KEY (role_name, permission_name),
      FOREIGN KEY (role_name) REFERENCES roles(name) ON DELETE CASCADE,
      FOREIGN KEY (permission_name) REFERENCES permissions(name) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      avatar_image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY,
      display_name TEXT,
      avatar_style TEXT NOT NULL DEFAULT 'latte',
      availability_status TEXT NOT NULL DEFAULT 'studying',
      last_seen_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS room_memberships (
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_joined_at DATETIME,
      last_left_at DATETIME,
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER NOT NULL,
      message_text TEXT NOT NULL,
      deleted_at DATETIME,
      deleted_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (deleted_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS music_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      video_id TEXT NOT NULL,
      start_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS music_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL DEFAULT 1,
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
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_by) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS presence_sessions (
      id TEXT PRIMARY KEY,
      socket_ref TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'online',
      connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      disconnected_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
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
      client_ip TEXT,
      user_agent TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    );
  `);

  // Backward-compatible migrations for databases created by earlier releases.
  await addColumnIfMissing(
    "users",
    "avatar_image",
    "ALTER TABLE users ADD COLUMN avatar_image TEXT"
  );
  await addColumnIfMissing(
    "user_profiles",
    "availability_status",
    "ALTER TABLE user_profiles ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'studying'"
  );
  await addColumnIfMissing(
    "messages",
    "room_id",
    "ALTER TABLE messages ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1"
  );
  await addColumnIfMissing(
    "messages",
    "deleted_at",
    "ALTER TABLE messages ADD COLUMN deleted_at DATETIME"
  );
  await addColumnIfMissing(
    "messages",
    "deleted_by",
    "ALTER TABLE messages ADD COLUMN deleted_by INTEGER"
  );
  await addColumnIfMissing(
    "music_requests",
    "room_id",
    "ALTER TABLE music_requests ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1"
  );
  await addColumnIfMissing(
    "music_requests",
    "start_seconds",
    "ALTER TABLE music_requests ADD COLUMN start_seconds INTEGER NOT NULL DEFAULT 0"
  );
  await addColumnIfMissing(
    "music_queue",
    "room_id",
    "ALTER TABLE music_queue ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1"
  );
  await addColumnIfMissing(
    "audit_logs",
    "event_type",
    "ALTER TABLE audit_logs ADD COLUMN event_type TEXT NOT NULL DEFAULT 'legacy'"
  );
  await addColumnIfMissing(
    "audit_logs",
    "target_user_id",
    "ALTER TABLE audit_logs ADD COLUMN target_user_id INTEGER"
  );
  await addColumnIfMissing(
    "audit_logs",
    "details",
    "ALTER TABLE audit_logs ADD COLUMN details TEXT"
  );
  await addColumnIfMissing(
    "security_events",
    "client_ip",
    "ALTER TABLE security_events ADD COLUMN client_ip TEXT"
  );
  await addColumnIfMissing(
    "security_events",
    "user_agent",
    "ALTER TABLE security_events ADD COLUMN user_agent TEXT"
  );

  await rawExec(`
    INSERT OR IGNORE INTO roles (name, description) VALUES
      ('admin', 'Permanent administrator'),
      ('mod', 'Moderator'),
      ('user', 'Regular user');

    INSERT OR IGNORE INTO permissions (name, description) VALUES
      ('room.use', 'Use normal room features'),
      ('room.moderate', 'Moderate room content'),
      ('admin.console', 'Open the administrator console'),
      ('admin.users.read', 'Read administrative user data'),
      ('admin.users.write', 'Change user roles');

    INSERT OR IGNORE INTO role_permissions (role_name, permission_name) VALUES
      ('user', 'room.use'),
      ('mod', 'room.use'),
      ('mod', 'room.moderate'),
      ('admin', 'room.use'),
      ('admin', 'room.moderate'),
      ('admin', 'admin.console'),
      ('admin', 'admin.users.read'),
      ('admin', 'admin.users.write');

    INSERT OR IGNORE INTO rooms (id, slug, name, created_by)
      VALUES (1, 'main', 'Main Study Café', NULL);

    INSERT OR IGNORE INTO user_profiles (
      user_id,
      display_name,
      last_seen_at
    )
    SELECT id, username, created_at
    FROM users;

    INSERT OR IGNORE INTO room_memberships (
      room_id,
      user_id,
      last_joined_at
    )
    SELECT 1, id, created_at
    FROM users;

    UPDATE messages
    SET room_id = 1
    WHERE room_id IS NULL;

    UPDATE music_requests
    SET room_id = 1
    WHERE room_id IS NULL;

    UPDATE music_queue
    SET room_id = 1
    WHERE room_id IS NULL;

    -- A process restart cannot prove an old socket is still connected.
    -- Preserve the most recent heartbeat as last-seen, then mark stale sockets offline.
    UPDATE user_profiles
    SET last_seen_at = COALESCE(
      (
        SELECT MAX(presence_sessions.last_seen_at)
        FROM presence_sessions
        WHERE presence_sessions.user_id = user_profiles.user_id
      ),
      user_profiles.last_seen_at
    )
    WHERE EXISTS (
      SELECT 1
      FROM presence_sessions
      WHERE presence_sessions.user_id = user_profiles.user_id
        AND presence_sessions.status = 'online'
    );

    UPDATE presence_sessions
    SET status = 'offline',
        disconnected_at = COALESCE(disconnected_at, CURRENT_TIMESTAMP)
    WHERE status = 'online';

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);

    CREATE INDEX IF NOT EXISTS idx_presence_room_status
      ON presence_sessions(room_id, status, last_seen_at);

    CREATE INDEX IF NOT EXISTS idx_presence_user_status
      ON presence_sessions(user_id, status, last_seen_at);

    CREATE INDEX IF NOT EXISTS idx_room_memberships_user
      ON room_memberships(user_id, room_id);

    CREATE INDEX IF NOT EXISTS idx_messages_room_created
      ON messages(room_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_security_events_created_at
      ON security_events(created_at);

    CREATE INDEX IF NOT EXISTS idx_security_events_type
      ON security_events(event_type);

    CREATE INDEX IF NOT EXISTS idx_security_events_actor
      ON security_events(actor_user_id);

    CREATE INDEX IF NOT EXISTS idx_security_events_client_ip
      ON security_events(client_ip, created_at);

    CREATE INDEX IF NOT EXISTS idx_security_events_severity_outcome
      ON security_events(severity, outcome);

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
      ON audit_logs(created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_user_created
      ON messages(user_id, created_at);
  `);

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
  DEFAULT_ROOM_ID,
  path: databasePath,
  ready,
  run,
  get,
  all,
  exec,
  checkpoint,
  close
};
