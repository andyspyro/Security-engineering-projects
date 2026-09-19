"use strict";

const session = require("express-session");
const db = require("./database");

class LibSQLSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.defaultTtlMs = Number(options.defaultTtlMs) || 60 * 60 * 1000;
  }

  get(sid, callback) {
    db.get(
      "SELECT sess, expires_at FROM sessions WHERE sid = ?",
      [sid]
    )
      .then(async (row) => {
        if (!row) {
          callback(null, null);
          return;
        }

        if (Number(row.expires_at) <= Date.now()) {
          await db.run("DELETE FROM sessions WHERE sid = ?", [sid]);
          callback(null, null);
          return;
        }

        try {
          callback(null, JSON.parse(row.sess));
        } catch (err) {
          await db.run("DELETE FROM sessions WHERE sid = ?", [sid]);
          callback(err);
        }
      })
      .catch((err) => callback(err));
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expiresAt =
        sess &&
        sess.cookie &&
        sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + this.defaultTtlMs;

      db.run(
        `
        INSERT INTO sessions (sid, sess, expires_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(sid) DO UPDATE SET
          sess = excluded.sess,
          expires_at = excluded.expires_at,
          updated_at = CURRENT_TIMESTAMP
        `,
        [sid, JSON.stringify(sess), expiresAt]
      )
        .then(() => callback(null))
        .catch((err) => callback(err));
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback = () => {}) {
    db.run("DELETE FROM sessions WHERE sid = ?", [sid])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const expiresAt =
        sess &&
        sess.cookie &&
        sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + this.defaultTtlMs;

      db.run(
        `
        UPDATE sessions
        SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE sid = ?
        `,
        [expiresAt, sid]
      )
        .then(() => callback(null))
        .catch((err) => callback(err));
    } catch (err) {
      callback(err);
    }
  }

  clearExpired() {
    return db.run(
      "DELETE FROM sessions WHERE expires_at <= ?",
      [Date.now()]
    );
  }
}

module.exports = LibSQLSessionStore;
