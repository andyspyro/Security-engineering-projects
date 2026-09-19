# Secure Lo-Fi Study Cafe
## Security Engineering Report — Version 3.2

**Release:** 3.2.0  
**Application:** Node.js + Express + EJS + Socket.IO  
**Database:** Turso / libSQL with local SQLite-compatible development fallback  
**Deployment target:** Koyeb Free Web Service + Turso shared database  
**Primary change:** free shared persistence without a paid filesystem volume

---

## 1. Architecture change

Version 3.2 removes the production dependency on a local SQLite file.

The application now uses `@libsql/client` through a small database abstraction that exposes:

```text
db.run()
db.get()
db.all()
db.ready
```

The rest of the application continues to use parameterized SQL.

In development, the client can use:

```text
file:lofi_cafe.db
```

In production, it uses:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

This keeps the SQL-heavy design while making the data shared across devices and independent of the Koyeb container filesystem.

---

## 2. Shared cross-device identity

All production clients authenticate against the same Turso `users` table.

Therefore:

```text
Admin desktop ─────┐
                   │
                   v
             Koyeb Node service
             Express + Socket.IO
                   │
                   v
             Turso / libSQL
                   ^
                   │
Bunny phone ───────┘
```

A normal account created on the phone is immediately visible to the same backend used by the administrator on the computer.

The browser is not the identity authority.

---

## 3. Role enforcement

Public registration always creates:

```text
role = user
```

The permanent administrator is provisioned from:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

Server middleware enforces:

```text
requireLogin
requireModerator
requirePermanentAdmin
```

Normal users cannot obtain administrator privileges through client-side state.

The administrator/security pages are protected by server-side authorization.

---

## 4. Persistent shared sessions

Express sessions are stored in the SQL `sessions` table through `libsql-session-store.js`.

Session operations include:

* get;
* set;
* destroy;
* touch;
* expiration cleanup.

A Koyeb process restart therefore does not require session state to live on the container filesystem.

The session cookie remains:

* HttpOnly;
* SameSite=Lax;
* Secure in production;
* one-hour lifetime.

The session identifier is regenerated after successful login.

---

## 5. Database schema

The shared database contains:

```text
users
messages
music_requests
music_queue
audit_logs
sessions
security_events
```

The application initializes missing tables/indexes at startup and runs compatibility migrations for older schema versions.

Important indexes include:

```text
idx_sessions_expires_at
idx_security_events_created_at
idx_security_events_type
idx_security_events_actor
idx_security_events_severity_outcome
idx_audit_logs_created_at
idx_messages_user_created
```

---

## 6. Security telemetry

`security_events` records structured events with:

* event UUID;
* event type;
* severity;
* actor;
* username snapshot;
* target user;
* outcome;
* HTTP method;
* route;
* request UUID;
* HMAC-derived session reference;
* bounded JSON metadata;
* timestamp.

Coverage includes:

* account registration;
* login success;
* login failure;
* logout;
* authentication rate limiting;
* CSRF failures;
* authorization denials;
* HTTP request results;
* Socket.IO connect/disconnect;
* accepted/rejected profile-image actions.

Raw session tokens are not stored in the security event table.

---

## 7. Application audit trail

`audit_logs` remains separate from security telemetry.

It answers accountability questions such as:

* who deleted a message;
* who granted temporary moderator authority;
* who approved or rejected a media request;
* who manipulated the queue;
* who exported an administrator report;
* who submitted a chat message.

This separation mirrors the distinction between security monitoring and business/application audit evidence.

---

## 8. Secure SQL access

User-controlled values continue to use parameter placeholders.

Example:

```js
await db.get(
  "SELECT id, username, password_hash, role FROM users WHERE username = ?",
  [username]
);
```

The Turso migration therefore preserves the SQL injection-resistant query model instead of replacing SQL with string-built requests.

---

## 9. Realtime security

Socket.IO reuses the authenticated Express session.

Realtime controls include:

* unauthenticated socket rejection;
* bounded avatar coordinates;
* server-controlled user identity;
* server-side role checks for privileged controls;
* chat length limits;
* profanity filtering for normal users;
* upload CSRF validation;
* controller authority checks.

Presence, avatar movement, chat, and player state are shared between connected clients through the Koyeb Node service.

---

## 10. Secure uploads

Profile images accept:

* PNG;
* JPEG;
* WebP.

Controls include:

* 512 KB maximum decoded size;
* MIME allowlist;
* binary file-signature verification;
* SVG rejection;
* authenticated update event;
* authenticated image-read route;
* security logging for rejected uploads.

Profile image data is stored in the shared SQL account record.

---

## 11. Free hosting design

### Koyeb

Koyeb runs the Node/Express/Socket.IO container.

The root `Dockerfile`:

* uses Node.js 20;
* installs runtime dependencies;
* copies the application;
* runs as the unprivileged `node` user;
* exposes port 3000;
* launches `node server.js`.

No writable production database directory is required.

### Turso

Turso stores shared persistent SQL data.

Required production variables:

```text
NODE_ENV=production
SESSION_SECRET=<strong random secret>
ADMIN_USERNAME=<private admin username>
ADMIN_PASSWORD=<private password, 12+ characters>
TURSO_DATABASE_URL=<Turso URL>
TURSO_AUTH_TOKEN=<Turso token>
```

Koyeb supplies `PORT`.

---

## 12. Health verification

```text
GET /healthz
```

executes:

```sql
SELECT 1 AS ok
```

The service reports healthy only when the shared database can answer a query.

---

## 13. CI validation

GitHub Actions validates:

* server syntax;
* database wrapper syntax;
* libSQL session-store syntax;
* browser JavaScript syntax;
* EJS compilation;
* local libSQL schema initialization;
* required table creation;
* required index creation;
* session write/read behavior;
* security-event write/read behavior;
* query-plan generation;
* production Docker build.

The smoke test uses `@libsql/client` against a disposable local libSQL database so CI exercises the same API used by production.

---

## 14. Forensic SQL

`sql/security-forensics.sql` remains usable against the Turso/libSQL schema.

It contains queries for:

* high-severity events;
* failed authentication;
* authorization denials;
* CSRF failures;
* session correlation;
* daily security summaries;
* privileged administrative actions;
* moderated chat evidence;
* account activity;
* media moderation;
* unified incident timelines;
* index inspection;
* query-plan analysis.

---

## 15. Persistence model

Persistent:

* accounts;
* password hashes;
* sessions;
* profile images;
* chat;
* moderation evidence;
* music requests;
* audit logs;
* security telemetry.

Transient by design:

* current Socket.IO connection IDs;
* current avatar X/Y position;
* current in-process presence map;
* temporary animation state.

This minimizes unnecessary tracking while preserving security-relevant evidence.

---

## 16. Free-tier operational behavior

The Koyeb free service may sleep after inactivity.

When it wakes:

* the Node process reconstructs the application;
* the database schema check runs;
* persistent accounts/logs remain in Turso;
* users reconnect through Socket.IO;
* transient room positions start fresh.

The database is not tied to the web container lifecycle.

---

## 17. Version 3.2 outcome

Version 3.2 provides the project's intended real multi-device behavior without requiring paid persistent web-server storage.

The authoritative flow is:

```text
Browser
  -> Koyeb Node/Express/Socket.IO
  -> server authentication and RBAC
  -> Turso shared SQL database
```

The GitHub Pages build remains an interface showcase only.

The Koyeb URL is the real shared application once deployment is complete.
