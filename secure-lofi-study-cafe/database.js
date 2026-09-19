const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./lofi_cafe.db", (err) => {
  if (err) {
    console.error("Database connection failed.");
    process.exit(1);
  }

  console.log("Connected to SQLite database.");
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message_text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
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
    )
  `);

  db.run(`
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
    )
  `);

  db.run(`
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
    )
  `);

  db.run(
    `ALTER TABLE music_requests ADD COLUMN start_seconds INTEGER NOT NULL DEFAULT 0`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Migration error:", err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE messages ADD COLUMN deleted_at DATETIME`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Migration error:", err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE messages ADD COLUMN deleted_by INTEGER`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Migration error:", err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE audit_logs ADD COLUMN event_type TEXT NOT NULL DEFAULT 'legacy'`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Migration error:", err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE audit_logs ADD COLUMN target_user_id INTEGER`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Migration error:", err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE audit_logs ADD COLUMN details TEXT`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Migration error:", err.message);
      }
    }
  );
});

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

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

module.exports = {
  run,
  get,
  all,
};