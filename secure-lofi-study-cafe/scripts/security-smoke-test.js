"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "secure-lofi-smoke-")
);

const testDatabasePath = path.join(tempDir, "security-smoke.db");

process.env.DB_PATH = testDatabasePath;
process.env.NODE_ENV = "test";

const db = require("../database");

async function main() {
  await db.ready;

  const requiredTables = new Set([
    "roles",
    "permissions",
    "role_permissions",
    "users",
    "user_profiles",
    "rooms",
    "room_memberships",
    "messages",
    "music_requests",
    "music_queue",
    "sessions",
    "presence_sessions",
    "audit_logs",
    "security_events"
  ]);

  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  );

  for (const table of requiredTables) {
    if (!tables.some((row) => row.name === table)) {
      throw new Error(`Missing required table: ${table}`);
    }
  }

  const requiredIndexes = new Set([
    "idx_sessions_expires_at",
    "idx_presence_room_status",
    "idx_presence_user_status",
    "idx_room_memberships_user",
    "idx_messages_room_created",
    "idx_security_events_created_at",
    "idx_security_events_type",
    "idx_security_events_actor",
    "idx_security_events_client_ip",
    "idx_security_events_severity_outcome",
    "idx_audit_logs_created_at",
    "idx_messages_user_created"
  ]);

  const indexes = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'index'"
  );

  for (const index of requiredIndexes) {
    if (!indexes.some((row) => row.name === index)) {
      throw new Error(`Missing required index: ${index}`);
    }
  }

  const securityColumns = await db.all(
    "PRAGMA table_info(security_events)"
  );
  const securityColumnNames = new Set(
    securityColumns.map((column) => column.name)
  );

  for (const column of ["client_ip", "user_agent"]) {
    if (!securityColumnNames.has(column)) {
      throw new Error(`Missing security_events column: ${column}`);
    }
  }

  const profileColumns = await db.all(
    "PRAGMA table_info(user_profiles)"
  );
  const profileColumnNames = new Set(
    profileColumns.map((column) => column.name)
  );

  if (!profileColumnNames.has("availability_status")) {
    throw new Error("Missing user_profiles availability_status column.");
  }

  const journal = await db.get("PRAGMA journal_mode");
  if (
    !journal ||
    String(journal.journal_mode || "").toLowerCase() !== "wal"
  ) {
    throw new Error("SQLite WAL mode is not enabled.");
  }

  const foreignKeys = await db.get("PRAGMA foreign_keys");
  if (!foreignKeys || Number(foreignKeys.foreign_keys) !== 1) {
    throw new Error("SQLite foreign-key enforcement is not enabled.");
  }

  const defaultRoom = await db.get(
    "SELECT id, slug, name FROM rooms WHERE id = ?",
    [1]
  );

  if (
    !defaultRoom ||
    defaultRoom.slug !== "main" ||
    !defaultRoom.name
  ) {
    throw new Error("Default room was not initialized.");
  }

  const adminPermission = await db.get(
    `
    SELECT 1 AS allowed
    FROM role_permissions
    WHERE role_name = 'admin'
      AND permission_name = 'admin.console'
    `
  );

  const userPermission = await db.get(
    `
    SELECT 1 AS allowed
    FROM role_permissions
    WHERE role_name = 'user'
      AND permission_name = 'room.use'
    `
  );

  if (!adminPermission || !userPermission) {
    throw new Error("Role/permission seed data is incomplete.");
  }

  await db.run(
    `
    INSERT INTO sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
    `,
    [
      "smoke-session",
      JSON.stringify({
        user: {
          id: 1,
          username: "admin",
          role: "admin"
        }
      }),
      Date.now() + 60_000
    ]
  );

  const session = await db.get(
    "SELECT sid, expires_at FROM sessions WHERE sid = ?",
    ["smoke-session"]
  );

  if (!session || session.sid !== "smoke-session") {
    throw new Error("SQLite session persistence verification failed.");
  }

  await db.run(
    `
    INSERT INTO security_events (
      event_uuid,
      event_type,
      severity,
      outcome,
      http_method,
      route,
      request_id,
      session_ref,
      client_ip,
      user_agent,
      metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      "smoke-test-event",
      "auth.login_failed",
      "WARNING",
      "failed",
      "POST",
      "/login",
      "request-test",
      "session-test",
      "127.0.0.1",
      "smoke-test-agent",
      JSON.stringify({ reason: "test" })
    ]
  );

  const row = await db.get(
    `
    SELECT event_type, severity, outcome, client_ip, user_agent
    FROM security_events
    WHERE severity = ?
    ORDER BY created_at DESC
    LIMIT 1
    `,
    ["WARNING"]
  );

  if (
    !row ||
    row.event_type !== "auth.login_failed" ||
    row.outcome !== "failed" ||
    row.client_ip !== "127.0.0.1" ||
    row.user_agent !== "smoke-test-agent"
  ) {
    throw new Error(
      "Security event insert/query verification failed."
    );
  }

  const queryPlan = await db.all(
    `
    EXPLAIN QUERY PLAN
    SELECT created_at, event_type, severity, outcome
    FROM security_events
    WHERE severity = 'HIGH'
    ORDER BY created_at DESC
    LIMIT 100
    `
  );

  if (!queryPlan.length) {
    throw new Error("SQLite query-plan verification failed.");
  }

  const integrity = await db.get("PRAGMA quick_check");
  if (!integrity || integrity.quick_check !== "ok") {
    throw new Error("SQLite quick_check did not return ok.");
  }

  await db.checkpoint("TRUNCATE");

  console.log("Self-hosted SQLite security smoke test passed.");
  console.log(
    `Verified ${requiredTables.size} tables, ${requiredIndexes.size} indexes, RBAC seed data, room schema, network telemetry columns, WAL mode, foreign keys, session persistence, and database integrity.`
  );
}

async function cleanup() {
  try {
    await db.close();
  } catch {}

  fs.rmSync(tempDir, {
    recursive: true,
    force: true
  });
}

main()
  .then(cleanup)
  .catch(async (err) => {
    console.error(err);
    await cleanup();
    process.exit(1);
  });
