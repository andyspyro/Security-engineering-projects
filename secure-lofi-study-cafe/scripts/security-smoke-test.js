"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const schema = fs.readFileSync(
  path.join(__dirname, "..", "schema.sql"),
  "utf8"
);

const db = new sqlite3.Database(":memory:");

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function main() {
  await exec(schema);

  const requiredTables = new Set([
    "users",
    "messages",
    "music_requests",
    "music_queue",
    "audit_logs",
    "security_events",
    "sessions"
  ]);

  const tables = await all(
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

  const indexes = await all(
    "SELECT name FROM sqlite_master WHERE type = 'index'"
  );

  for (const index of requiredIndexes) {
    if (!indexes.some((row) => row.name === index)) {
      throw new Error(`Missing required index: ${index}`);
    }
  }

  await run(
    `
    INSERT INTO sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
    `,
    [
      "smoke-session",
      JSON.stringify({ user: { id: 1, username: "admin", role: "admin" } }),
      Date.now() + 60_000
    ]
  );

  const sessionRows = await all(
    "SELECT sid, expires_at FROM sessions WHERE sid = ?",
    ["smoke-session"]
  );

  if (sessionRows.length !== 1 || sessionRows[0].sid !== "smoke-session") {
    throw new Error("Persistent session table verification failed.");
  }

  await run(
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

  const rows = await all(
    `
    SELECT event_type, severity, outcome
    FROM security_events
    WHERE severity = ?
    ORDER BY created_at DESC
    `,
    ["WARNING"]
  );

  if (
    rows.length !== 1 ||
    rows[0].event_type !== "auth.login_failed" ||
    rows[0].outcome !== "failed"
  ) {
    throw new Error("Security event insert/query verification failed.");
  }

  const queryPlan = await all(
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

  console.log("Security schema smoke test passed.");
  console.log(`Verified ${requiredTables.size} tables and ${requiredIndexes.size} indexes.`);
}

main()
  .then(() => db.close())
  .catch((err) => {
    console.error(err);
    db.close(() => process.exit(1));
  });
