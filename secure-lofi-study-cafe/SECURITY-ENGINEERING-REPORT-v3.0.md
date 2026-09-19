# Secure Lo-Fi Study Cafe
## Security Engineering Report — Version 3.0

**Release:** 3.0.0  
**Stack:** Node.js, Express, SQLite, EJS, Socket.IO  
**Primary focus:** secure authentication, authorization, application security logging, realtime security controls, moderation accountability, and incident reconstruction.

---

## 1. Release summary

Version 3.0 separates two logging concerns:

1. **Application audit logging** records user and administrator actions that must be attributable later.
2. **Security telemetry** records authentication, authorization, CSRF, rate-limit, socket, upload-validation, and HTTP request events in a dedicated indexed SQLite table.

The release also adds request correlation, keyed session correlation, session regeneration after authentication, SQL forensic queries, a backend security architecture page, and CI validation of the SQLite security schema.

The GitHub Pages build remains static. A built-in showcase account is available so the same administrator login works from different browsers and devices:

```text
username: admin
password: admin12345
```

That credential is only for the public static showcase. It is not used by the Node.js backend.

---

## 2. Why desktop-created accounts did not work on a phone

The GitHub Pages build has no Node.js process, database, or shared server-side session store.

Browser-created showcase accounts are stored in `localStorage`. Browser storage is isolated by device and browser profile. An account created in Firefox on one computer therefore does not exist in Safari or Chrome on a phone.

Version 3.0 keeps locally created showcase accounts browser-local, but adds a deterministic cross-device showcase administrator account so the public interface can be reviewed consistently.

The full application does not have this limitation because authentication is performed against SQLite on the server.

---

## 3. Security architecture

```text
Browser
  |
  | HTTPS / HTTP routes
  v
Express
  |
  +-- general rate limit
  +-- authentication rate limit
  +-- Express session
  +-- request UUID
  +-- CSRF validation
  +-- server-side RBAC
  +-- input validation
  +-- parameterized SQL
  |
  +------------------------------+
  |                              |
  v                              v
SQLite                         Socket.IO
  |                              |
  +-- users                       +-- authenticated session
  +-- messages                    +-- live chat
  +-- music_requests              +-- room presence
  +-- music_queue                 +-- avatar movement
  +-- audit_logs                  +-- player synchronization
  +-- security_events             +-- vote state
```

The browser is never treated as the authorization boundary. Privileged operations are checked on the server.

---

## 4. Authentication controls

### 4.1 Password hashing

The backend hashes passwords with bcrypt before storage.

```js
const passwordHash = await bcrypt.hash(password, 12);
```

The database stores the hash, not the plaintext password.

### 4.2 Generic login errors

Unknown usernames and incorrect passwords return the same user-facing message:

```text
Invalid username or password.
```

This reduces username enumeration through the normal authentication response.

### 4.3 Session regeneration

After a successful password check, the Express session is regenerated before authenticated identity and role data are attached.

This reduces session-fixation risk.

### 4.4 Session cookie controls

The application uses:

* `httpOnly: true`
* `sameSite: "lax"`
* `secure: true` in production
* one-hour expiration

The raw session ID is not written to application security logs.

### 4.5 Login rate limiting

Authentication endpoints are subject to a tighter rate limit than normal application traffic. Rate-limit blocks are recorded in `security_events`.

---

## 5. Request and session correlation

Every non-static HTTP request receives a random UUID.

The response includes:

```http
X-Request-ID: <uuid>
```

Security events can therefore be correlated to one request without relying on log-message text.

For session correlation, the application derives a keyed reference using HMAC-SHA-256 and the server-side session secret.

Only the shortened HMAC-derived reference is logged.

The real session cookie is not stored in logs.

This follows the security principle of allowing session correlation without exposing the credential-equivalent session identifier.

---

## 6. CSRF protection

State-changing HTTP routes require a random 32-byte session-bound CSRF token.

A missing or mismatched token creates a high-severity security event:

```text
event_type: csrf.validation_failed
severity: HIGH
outcome: blocked
```

The request is rejected with HTTP 403.

---

## 7. Server-side authorization

The application uses separate authorization checks:

```text
requireLogin
requireModerator
requirePermanentAdmin
```

Temporary moderator/controller status can grant limited moderation capability without converting the account into a permanent administrator.

Denied moderator or administrator actions are written to SQL security telemetry.

---

## 8. SQL security logging

### 8.1 security_events table

Version 3.0 adds the following structured table:

```sql
CREATE TABLE security_events (
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 8.2 Indexes

Security investigations frequently filter by time, event type, actor, severity, or outcome. The schema creates indexes for those paths:

```sql
CREATE INDEX idx_security_events_created_at
ON security_events(created_at);

CREATE INDEX idx_security_events_type
ON security_events(event_type);

CREATE INDEX idx_security_events_actor
ON security_events(actor_user_id);

CREATE INDEX idx_security_events_severity_outcome
ON security_events(severity, outcome);
```

Additional indexes support audit and message investigation.

### 8.3 HTTP telemetry

Application-route requests produce structured `http.request` events with:

* method;
* route;
* response status;
* duration;
* request UUID;
* non-secret session reference;
* authenticated actor when available.

Static CSS and browser assets are served before this middleware and are not written into the security-event table.

### 8.4 Security event coverage

Current SQL security events include:

| Event | Purpose |
|---|---|
| `account.register` | account creation |
| `auth.login_success` | successful authentication |
| `auth.login_failed` | failed authentication |
| `auth.logout` | session logout |
| `auth.rate_limit` | authentication throttling |
| `csrf.validation_failed` | rejected CSRF token |
| `authorization.authentication_required` | unauthenticated protected-route access |
| `authorization.moderator_denied` | rejected moderator action |
| `authorization.admin_denied` | rejected permanent-admin action |
| `http.request` | correlated application request telemetry |
| `socket.connected` | realtime connection |
| `socket.disconnected` | realtime disconnect |
| `profile.image_update` | accepted image update |
| `profile.image_rejected` | invalid image type/signature/size |
| `profile.image_csrf_failed` | rejected upload event |

---

## 9. Audit logging

`audit_logs` remains separate from `security_events`.

Audit records answer questions such as:

* Who deleted a message?
* Who granted temporary administrative authority?
* Who approved or rejected a music request?
* Who moved or removed a queue item?
* Who downloaded the administrator report?
* Which user submitted a chat message?

This separation keeps operational security telemetry distinct from application accountability records.

---

## 10. Message evidence and moderation

Live messages are stored in SQLite with the author and timestamp.

Moderated messages use soft deletion:

```text
deleted_at
deleted_by
```

The message disappears from the live room but remains available in the permanent-admin audit console for incident reconstruction.

Regular-user profanity is censored in the public room. The originally submitted text is retained in the administrator audit trail for moderation evidence.

---

## 11. SQL forensic queries

The repository includes:

```text
sql/security-forensics.sql
```

It contains investigation queries for:

* high-severity events;
* blocked or failed events;
* failed-login frequency;
* authorization denials;
* CSRF failures;
* session correlation;
* event counts by type/severity/outcome;
* daily security summaries;
* privileged administrative actions;
* moderated-message evidence;
* account activity;
* music moderation;
* unified incident timelines;
* index verification;
* SQLite query-plan inspection.

Example:

```sql
SELECT
    COALESCE(username_snapshot, 'anonymous') AS attempted_user,
    COUNT(*) AS failure_count,
    MIN(created_at) AS first_failure,
    MAX(created_at) AS last_failure
FROM security_events
WHERE event_type = 'auth.login_failed'
  AND created_at >= datetime('now', '-24 hours')
GROUP BY COALESCE(username_snapshot, 'anonymous')
ORDER BY failure_count DESC;
```

---

## 12. SQL injection resistance

Database calls use parameter placeholders rather than interpolating user input into SQL.

Example:

```js
const user = await db.get(
  "SELECT id, username, password_hash, role FROM users WHERE username = ?",
  [username]
);
```

This pattern is used throughout authentication, message, moderation, profile, and media operations.

---

## 13. XSS resistance

Server-rendered EJS values use escaped output.

Live chat, avatar labels, and speech bubbles are created with DOM `textContent`, not `innerHTML`.

The application also uses Helmet and a Content Security Policy.

---

## 14. Profile-image upload security

Profile images are limited to:

* PNG;
* JPEG;
* WebP;
* maximum decoded size of 512 KB.

The backend does not trust the browser-declared MIME type alone. It validates the decoded binary signature:

* PNG signature;
* JPEG SOI bytes;
* WebP RIFF/WEBP structure.

SVG is not accepted.

Images are served through an authenticated application route.

Large base64 image data is not placed in every Socket.IO presence update. Presence packets contain only a small image URL and cache version.

---

## 15. CSV export protection

User-controlled data can become dangerous when opened by spreadsheet software if a cell begins with a formula prefix.

CSV export checks for:

```text
=
+
-
@
tab
carriage return
```

Potential formula values are prefixed before export.

This reduces spreadsheet formula injection risk.

---

## 16. Realtime security

Socket.IO uses the Express session middleware.

Unauthenticated sockets are disconnected.

Realtime events validate:

* authenticated session;
* CSRF token where required;
* allowed avatar themes;
* profile-image validation;
* chat size limits;
* bounded avatar coordinates;
* controller authority before player heartbeat changes.

Socket connection and disconnection events are written to SQL security telemetry.

---

## 17. Administrator security console

The permanent-admin console now includes:

* user directory;
* application audit trail;
* SQL security event stream;
* severity;
* outcome;
* actor;
* event type;
* HTTP method and route;
* request UUID;
* session correlation reference;
* event metadata;
* chat evidence;
* deleted-message evidence;
* music moderation history;
* CSV report export.

The admin interface does not expose:

* plaintext passwords;
* password hashes;
* CSRF tokens;
* raw session cookies;
* browser history;
* precise location;
* unrelated device fingerprint data;
* profile-image binary data in the logs.

---

## 18. CI security validation

GitHub Actions validates:

1. JavaScript syntax;
2. EJS template compilation;
3. SQLite schema creation;
4. required security tables;
5. required indexes;
6. parameterized security-event insertion;
7. security-event query execution;
8. SQLite query-plan generation.

The security schema test uses an in-memory SQLite database and does not require production data.

---

## 19. Public static showcase vs full backend

### GitHub Pages

The Pages deployment is static.

It can demonstrate:

* responsive UI;
* avatar movement;
* profile-picture controls;
* chat behavior;
* admin interface;
* security architecture;
* cross-device showcase administrator login.

It cannot provide shared server-side authentication or a common SQLite database.

### Full Node.js application

The full application provides:

* shared accounts across devices;
* bcrypt authentication;
* server-side sessions;
* SQLite persistence;
* SQL audit/security logs;
* live Socket.IO state;
* protected profile images;
* server-side RBAC;
* actual administrative audit data.

---

## 20. Standards and references

Implementation decisions were checked against current OWASP guidance:

* OWASP Logging Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
* OWASP Session Management Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
* OWASP File Upload Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

Key principles applied:

* security-relevant application events should be logged consistently;
* sensitive session tokens should not be written into logs;
* session IDs should be regenerated after authentication;
* uploaded content should be allowlisted, size-limited, and independently validated;
* authorization belongs on the server;
* security logs should support investigation without collecting unrelated data.

---

## 21. Version 3.0 change summary

### Added

* structured `security_events` SQLite table;
* security-event indexes;
* correlated HTTP request logging;
* HMAC-derived session references;
* request UUID response header;
* login session regeneration;
* rate-limit security events;
* CSRF-failure security events;
* authorization-denial security events;
* Socket.IO connection telemetry;
* profile-upload security telemetry;
* SQL forensic query library;
* backend security architecture page;
* SQLite security smoke test in CI;
* cross-device static showcase administrator.

### Preserved

* bcrypt password hashing;
* CSRF tokens;
* RBAC;
* profanity filtering;
* soft-delete moderation;
* audit logging;
* parameterized SQL;
* Helmet headers;
* Content Security Policy;
* CSV formula-injection defense;
* profile-image signature validation;
* responsive/mobile UI;
* realtime café presence and chat.

---

## 22. Next production steps

A production deployment should add:

* a persistent server-side session store instead of the default in-memory Express store;
* TLS termination at the deployment platform;
* centralized log shipping or SIEM ingestion;
* log retention/rotation policy;
* account password-change and recovery workflow;
* MFA for permanent administrators;
* administrator session inventory and remote revocation;
* automated dependency scanning;
* SAST and dependency checks in CI;
* backup and recovery procedures for SQLite or migration to a managed relational database when concurrency requirements increase.
