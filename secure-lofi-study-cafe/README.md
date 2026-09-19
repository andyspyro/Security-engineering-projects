# Secure Lo-Fi Study Cafe

> **Release:** 3.2.0  
> **Type:** Full-stack secure realtime web application  
> **Stack:** Node.js, Express, Turso/libSQL, EJS, Socket.IO  
> **Security focus:** authentication, sessions, RBAC, CSRF, parameterized SQL, structured security telemetry, audit logging, secure uploads, moderation, and incident reconstruction

## Live showcase

**Application UI:** https://andyspyro.github.io/Security-engineering-projects/secure-lofi-study-cafe/

**Cross-device showcase administrator**

```text
username: admin
password: admin12345
```

The public GitHub Pages site is static. The built-in administrator above is only a UI showcase credential.

Accounts created through the Pages registration form remain browser-local because GitHub Pages does not run Node.js, Socket.IO, or SQLite.

The production architecture is the full backend in this directory. Koyeb runs the Node.js/Socket.IO service and Turso provides the shared SQL database. Every device therefore connects to the same users, sessions, room, RBAC rules, audit trail, and security-event data.

## Version 3.2 free shared backend and security engineering

Version 3.2 keeps the structured SQL security telemetry pipeline while moving shared persistence to Turso/libSQL so the real multi-user backend can run without a paid persistent web-server volume.

### Structured SQL security events

`security_events` records:

* event UUID;
* event type;
* severity;
* actor and username snapshot;
* optional target user;
* outcome;
* HTTP method;
* route;
* request UUID;
* keyed session correlation reference;
* bounded metadata;
* timestamp.

Security telemetry covers:

* registration;
* login success and failure;
* logout;
* authentication rate-limit blocks;
* CSRF failures;
* unauthenticated protected-route access;
* moderator/admin authorization denial;
* HTTP request status and duration;
* Socket.IO connect/disconnect;
* profile-image acceptance and rejection.

The table is indexed for time, type, actor, severity, and outcome.

## Security controls

| Control | Implementation |
|---|---|
| Password storage | bcrypt cost factor 12 |
| Session fixation defense | session regeneration after successful login |
| Session cookies | HttpOnly, SameSite=Lax, Secure in production, one-hour expiration |
| Request correlation | random UUID returned as `X-Request-ID` |
| Session correlation | HMAC-derived reference; raw session ID is not logged |
| Authorization | server-side `requireLogin`, `requireModerator`, and `requirePermanentAdmin` |
| CSRF | random session-bound token on state-changing HTTP actions |
| Rate limiting | general limiter plus stricter authentication limiter |
| SQL injection reduction | parameter placeholders for user-controlled database values |
| XSS reduction | EJS escaping, `textContent`, Content Security Policy |
| Security headers | Helmet with CSP |
| Upload security | PNG/JPEG/WebP allowlist, 512 KB cap, binary signature validation |
| Moderation evidence | soft-deleted messages retain author/deleter/timestamps |
| Auditability | application `audit_logs` plus structured `security_events` |
| CSV injection defense | spreadsheet formula prefixes neutralized before export |
| Realtime security | Socket.IO tied to Express authenticated sessions |

## Backend architecture

```text
Browser
  |
  +-- Express HTTP
  |     +-- rate limiting
  |     +-- session authentication
  |     +-- request UUID
  |     +-- CSRF validation
  |     +-- RBAC
  |     +-- validation
  |     +-- parameterized SQL
  |
  +-- Socket.IO
        +-- authenticated session
        +-- chat
        +-- presence
        +-- avatar movement
        +-- player synchronization
        +-- voting

                    |
                    v
                 SQLite
        +-----------+-------------+
        |           |             |
    app tables   audit_logs   security_events
                              + indexes
                              + forensic queries
```

## Administrator console

Permanent administrators have a separate `/admin` console while retaining all café functionality.

The console includes:

* user/account directory;
* SQL security event stream;
* severity and outcome;
* actor/target attribution;
* route and HTTP method;
* request UUID;
* non-secret session correlation reference;
* structured metadata;
* application audit trail;
* chat-message history;
* soft-deleted moderation evidence;
* music request history;
* CSV report export.

The admin console does **not** expose plaintext passwords, password hashes, CSRF tokens, raw session cookies, browser history, precise location, or profile-image binary data in logs.

## SQL forensics

The repository includes [sql/security-forensics.sql](sql/security-forensics.sql).

Queries cover:

* high-severity events;
* blocked/failed activity;
* failed-login frequency;
* authorization denials;
* CSRF failures;
* session correlation;
* daily event summaries;
* privileged actions;
* deleted-message evidence;
* account activity;
* media moderation;
* unified incident timelines;
* index verification;
* `EXPLAIN QUERY PLAN` inspection.

## Security architecture page

The application includes a dedicated Security Engineering page.

In the full backend:

```text
/security
```

In the GitHub Pages build, the equivalent interface is guarded by the reserved showcase administrator session. In the full backend, `/security` is protected by `requirePermanentAdmin`.

It presents the backend controls, SQL event model, forensic examples, and trust boundaries directly from the application interface.

## Realtime café features

* account registration/login;
* live chat;
* profanity filtering for normal users;
* synchronized YouTube playback;
* shared queue;
* moderator approval;
* vote-next;
* temporary moderator/controller authority;
* online presence;
* profile pictures;
* avatar customization;
* smooth WASD/arrow/touch movement;
* click/tap-to-walk;
* avatar speech bubbles;
* responsive mobile interface.

Avatar positions are transient room state and are not persisted to the audit database.

## Secure profile images

The Node backend persists profile images with the user account.

Accepted formats:

* PNG;
* JPEG;
* WebP.

Validation includes:

* 512 KB decoded-size limit;
* MIME allowlist;
* binary file-signature validation;
* authenticated upload event;
* authenticated image-read route.

SVG is rejected.

Socket.IO presence packets carry a small profile-image URL/version instead of retransmitting base64 image data with every movement update.

## Audit logging vs security telemetry

Two SQL data sources serve different purposes.

### `audit_logs`

Application accountability:

* message deletion;
* chat submission;
* moderation;
* music approvals/rejections;
* queue changes;
* temporary privilege changes;
* report downloads.

### `security_events`

Security detection and correlation:

* authentication;
* authorization;
* CSRF;
* rate limiting;
* HTTP outcomes;
* request IDs;
* session references;
* Socket.IO lifecycle;
* upload validation.

## CI validation

GitHub Actions performs:

* Node.js syntax checks;
* EJS template compilation;
* SQLite in-memory schema creation;
* required-table verification;
* required-index verification;
* security-event insert/query verification;
* SQLite query-plan generation;
* persistent-session table verification;
* production Docker image build.

Run the database security test locally:

```bash
npm run test:security
```

## Run the full backend

```bash
cd secure-lofi-study-cafe
npm install
cp .env.example .env
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the generated value as `SESSION_SECRET`. Also set:

```text
ADMIN_USERNAME=<your permanent admin username>
ADMIN_PASSWORD=<a private password of at least 12 characters>
```

Then start:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Public registration always creates a normal `user` account. Permanent administrator provisioning is explicit and server-controlled.

## Free production deployment

Use:

```text
Koyeb Free Web Service
        |
        | Node.js / Express / Socket.IO
        v
Turso / libSQL
```

Required Koyeb variables:

```text
NODE_ENV=production
SESSION_SECRET=<strong random secret>
ADMIN_USERNAME=<private permanent-admin username>
ADMIN_PASSWORD=<private password, 12+ characters>
TURSO_DATABASE_URL=<Turso database URL>
TURSO_AUTH_TOKEN=<Turso database token>
```

Koyeb supplies `PORT` automatically.

No Koyeb persistent volume is required because users, sessions, messages, audit records, and security telemetry live in Turso.

See [KOYEB-TURSO-DEPLOYMENT.md](KOYEB-TURSO-DEPLOYMENT.md) for the complete deployment and cross-device verification procedure.

## Repository map

| File | Purpose |
|---|---|
| [server.js](server.js) | HTTP routes, authentication, sessions, CSRF, RBAC, Socket.IO, security telemetry |
| [database.js](database.js) | Turso/libSQL client, schema initialization, migrations, indexes, query helpers |
| [schema.sql](schema.sql) | documented relational/security schema |
| [sql/security-forensics.sql](sql/security-forensics.sql) | investigation and incident-response SQL |
| [views/admin.ejs](views/admin.ejs) | permanent-admin audit/security console |
| [views/security.ejs](views/security.ejs) | backend security architecture interface |
| [public/cafe.js](public/cafe.js) | realtime client behavior |
| [public/style.css](public/style.css) | responsive café/security interface |
| [libsql-session-store.js](libsql-session-store.js) | persistent SQL-backed Express session store |
| [scripts/security-smoke-test.js](scripts/security-smoke-test.js) | disposable libSQL security/database validation |
| [SECURITY-ENGINEERING-REPORT-v3.2.md](SECURITY-ENGINEERING-REPORT-v3.2.md) | latest free shared-backend/security engineering report |
| [KOYEB-TURSO-DEPLOYMENT.md](KOYEB-TURSO-DEPLOYMENT.md) | free production deployment runbook |
| [SECURITY-ENGINEERING-REPORT-v3.1.md](SECURITY-ENGINEERING-REPORT-v3.1.md) | version 3.1 shared-backend report |
| [SECURITY-ENGINEERING-REPORT-v3.0.md](SECURITY-ENGINEERING-REPORT-v3.0.md) | version 3.0 telemetry/security report |
| [CHANGELOG.md](CHANGELOG.md) | release history |
| [UI-UX-ENHANCEMENT-REPORT.md](UI-UX-ENHANCEMENT-REPORT.md) | interface, mobile, avatar, and accessibility design |

## Reference guidance

Security decisions were cross-checked against:

* OWASP Logging Cheat Sheet
* OWASP Session Management Cheat Sheet
* OWASP File Upload Cheat Sheet

Full implementation mapping is documented in [SECURITY-ENGINEERING-REPORT-v3.2.md](SECURITY-ENGINEERING-REPORT-v3.2.md).
