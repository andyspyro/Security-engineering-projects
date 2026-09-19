"use strict";

const fs = require("fs");
const path = require("path");

const testDatabasePath = path.join(
  __dirname,
  "..",
  "security-smoke.db"
);

for (const suffix of ["", "-wal", "-shm"]) {
  try {
    fs.rmSync(testDatabasePath + suffix, { force: true });
  } catch {}
}

process.env.TURSO_DATABASE_URL = "file:security-smoke.db";
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.NODE_ENV;

const db = require("../database");

async function main() {
  await db.ready;

  const requiredTables = new Set([
    "users",
    "messages",
    "music_requests",
    "music_queue",
    "audit_logs",
    "security_events",
    "sessions"
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
    "idx_security_events_created_at",
    "idx_security_events_type",
    "idx_security_events_actor",
    "idx_security_events_severity_outcome",
    "idx_audit_logs_created_at",
    "idx_messages_user_created",
    "idx_sessions_expires_at"
  ]);

  const indexes = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'index'"
  );

  for (const index of requiredIndexes) {
    if (!indexes.some((row) => row.name === index)) {
      throw new Error(`Missing required index: ${index}`);
    }
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
    throw new Error(
      "Turso/libSQL session persistence verification failed."
    );
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
      metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify({ reason: "test" })
    ]
  );

  const row = await db.get(
    `
    SELECT event_type, severity, outcome
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
    row.outcome !== "failed"
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
    throw new Error("libSQL query-plan verification failed.");
  }

  console.log("Security database smoke test passed.");
  console.log(
    `Verified ${requiredTables.size} tables and ${requiredIndexes.size} indexes using @libsql/client.`
  );
}

async function cleanup() {
  try {
    await db.close();
  } catch {}

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(testDatabasePath + suffix, { force: true });
    } catch {}
  }
}

main()
  .then(async () => {
    await cleanup();
  })
  .catch(async (err) => {
    console.error(err);
    await cleanup();
    process.exit(1);
  });
