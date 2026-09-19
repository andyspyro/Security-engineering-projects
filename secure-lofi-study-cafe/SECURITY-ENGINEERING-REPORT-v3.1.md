# Secure Lo-Fi Study Cafe
## Security Engineering Report — Version 3.1

**Release:** 3.1.0  
**Architecture:** Node.js + Express + Socket.IO + SQLite  
**Deployment target:** Railway persistent service with persistent volume  
**Primary change:** shared cross-device backend with server-enforced role boundaries

---

## 1. Why version 3.1 was required

The GitHub Pages interface is static. Browser-created identities on that build are stored in browser storage, so a user created on one device does not exist on another device.

That architecture cannot provide:

* shared authentication;
* shared user presence;
* realtime cross-device chat;
* server-enforced role authorization;
* common SQL logs;
* a common audit history.

Version 3.1 prepares the full Node.js application as the production application instead of treating the static Pages build as the authoritative service.

When deployed as one backend service, both a desktop browser and a phone connect to the same:

* Express authentication service;
* SQLite account database;
* persistent session store;
* Socket.IO room;
* admin authorization rules;
* audit/security telemetry.

This is the architecture required for an administrator on one device to see a normal user such as `bunny` join from another device.

---

## 2. Production RBAC correction

Public registration now always creates:

```text
role = user
```

The earlier bootstrap behavior in which the first account could become an administrator has been removed.

Permanent administrators are provisioned by server configuration:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

In production, the application refuses to start if these values are missing.

This prevents an unauthenticated visitor from winning a race to become the first privileged account after a fresh deployment.

### Permanent-admin-only resources

The following controls remain server-side:

```text
requireLogin
requireModerator
requirePermanentAdmin
```

The Security Engineering route now requires permanent-admin authorization.

UI hiding is treated only as presentation. Authorization is enforced by the Express route itself.

---

## 3. Shared SQL account database

All devices authenticate against the same SQLite `users` table.

A normal user created from a phone therefore becomes immediately available to the same backend that serves an administrator on a computer.

Relevant data model:

```sql
users
messages
music_requests
music_queue
audit_logs
security_events
sessions
```

This means there is one identity source instead of one browser-local account store per device.

---

## 4. Persistent server-side sessions

Version 3.1 adds an SQLite-backed Express session store.

```sql
CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_expires_at
ON sessions(expires_at);
```

Session operations implement:

* get;
* set;
* destroy;
* touch;
* expiration cleanup.

Production sessions therefore use the same persistent SQL database as the application instead of Express's default in-memory store.

The session cookie remains:

* HttpOnly;
* SameSite=Lax;
* Secure in production;
* limited to one hour.

The backend also regenerates the session identifier after successful login.

---

## 5. Cross-device realtime communication

Socket.IO uses the authenticated Express session.

After login:

1. the socket is associated with the authenticated account;
2. the account enters the shared online-presence map;
3. all connected clients receive `presence:update`;
4. chat messages are stored in SQLite;
5. `chat:new` is broadcast to connected members;
6. the sender's avatar speech bubble uses the server-returned message;
7. disconnect events update shared presence.

Therefore:

```text
Desktop admin
      |
      |          same backend
      v
Express / Socket.IO / SQLite
      ^
      |
Phone user "bunny"
```

When both clients use the deployed Node application, the administrator sees `bunny` in **Members in Room** and on the **Café Floor** while bunny is connected.

---

## 6. Railway deployment model

The repository now includes:

```text
Dockerfile
```

The production image:

* uses Node.js 20;
* installs the project dependencies;
* runs the Express/Socket.IO application;
* creates a writable `/data` directory;
* sets `NODE_ENV=production`;
* uses `DB_PATH=/data/lofi_cafe.db`;
* runs as the non-root Node user.

Railway deployment uses root Dockerfile auto-detection. The Railway service settings configure the `/healthz` deployment healthcheck, a single replica, public networking, and the `/data` persistent volume.

### Persistent volume requirement

SQLite data must live on a Railway volume mounted at:

```text
/data
```

The production database path is:

```text
/data/lofi_cafe.db
```

Without a volume, Railway filesystem storage is deployment-ephemeral and account/log data would not survive redeployments.

---

## 7. Database-aware healthcheck

Version 3.1 adds:

```text
GET /healthz
```

The endpoint executes:

```sql
SELECT 1 AS ok
```

It returns HTTP 200 only when the application can query SQLite.

This provides a stronger deployment readiness check than merely confirming that the Node process started.

---

## 8. Reverse proxy and secure cookies

Railway terminates public TLS in front of the Node process.

In production the application enables:

```js
app.set("trust proxy", 1);
```

This allows Express to correctly recognize the proxied HTTPS request and issue the production `Secure` session cookie.

---

## 9. Static showcase hardening

The GitHub Pages build remains useful for interface review, but it is not the production identity provider.

Version 3.1 hardens that build so old browser state cannot make an ordinary account appear privileged.

The static client now:

* reserves the showcase administrator identity;
* normalizes all other locally stored roles to `user`;
* normalizes the active session on each café load;
* hides privileged navigation from normal users;
* requires both the reserved administrator username and admin role before opening the static admin/security pages.

This is defense against stale showcase state, not a substitute for server-side authorization.

The deployed Node backend remains the authoritative security boundary.

---

## 10. Security logging and forensics

The production backend retains the version 3.0 structured logging model.

### Application accountability

`audit_logs` records actions such as:

* chat submission;
* message deletion;
* moderator actions;
* music approval/rejection;
* queue manipulation;
* temporary privilege assignment;
* administrator report export.

### Security telemetry

`security_events` records:

* registration;
* login success/failure;
* logout;
* rate-limit blocks;
* CSRF failures;
* authorization denials;
* correlated HTTP requests;
* Socket.IO connection lifecycle;
* rejected/accepted profile-image actions.

### Correlation

Security records include:

* event UUID;
* request UUID;
* event type;
* severity;
* outcome;
* actor;
* route;
* HTTP method;
* HMAC-derived session reference;
* metadata;
* timestamp.

Raw session IDs and authentication secrets are not written to the security-event table.

---

## 11. CI proof

The GitHub Actions validation pipeline now checks:

* `server.js` syntax;
* `database.js` syntax;
* `sqlite-session-store.js` syntax;
* browser JavaScript syntax;
* EJS compilation;
* SQL schema creation in memory;
* required application/security tables;
* required SQL indexes;
* persistent-session table operation;
* structured security-event insertion/query;
* SQLite query-plan generation;
* production Docker image build.

This makes production container buildability and the security persistence layer part of automated validation.

---

## 12. Required production variables

A production deployment requires:

```text
NODE_ENV=production
SESSION_SECRET=<strong random secret>
ADMIN_USERNAME=<private permanent-admin username>
ADMIN_PASSWORD=<strong private password, 12+ characters>
DB_PATH=/data/lofi_cafe.db
```

`PORT` is supplied by Railway.

The public GitHub Pages showcase password must not be reused as the production administrator password.

---

## 13. Expected production test

After deployment:

### Device A — administrator

1. Open the Railway public domain.
2. Sign in using the private administrator account.
3. Confirm that **Admin Console** and **Security Engineering** appear.
4. Open the Café Floor.

### Device B — normal user

1. Open the same Railway public domain on the phone.
2. Register `bunny`.
3. Sign in as `bunny`.
4. Confirm role displays as `user`.
5. Confirm no Admin Console or Security Engineering controls are present.
6. Send `hello`.

### Expected result

On Device A:

* bunny appears in Members in Room;
* bunny appears on the Café Floor;
* bunny's message appears in live chat;
* `hello` appears temporarily over bunny's avatar;
* the audit/security backend records the appropriate account/session/chat events.

On Device B:

* the administrator appears as another connected room member;
* bunny cannot access permanent-admin routes;
* attempts to access protected administrator URLs directly return authorization denial.

---

## 14. Scaling boundary

This version intentionally uses one application service and one persistent SQLite database.

Do not horizontally scale multiple application replicas while using a single local SQLite volume and in-memory room-state maps.

If horizontal scaling becomes necessary, the next architecture should move:

* relational persistence to PostgreSQL;
* session/realtime coordination to a shared store such as Redis;
* Socket.IO fan-out to a compatible multi-instance adapter.

For the current project scale, a single Railway service with a persistent volume keeps the design understandable, demonstrable, and consistent.

---

## 15. Version 3.1 outcome

Version 3.1 changes the project from a browser-isolated showcase architecture into a production-ready shared-backend design.

The key security rule is now:

```text
Authentication and authorization are decided by the server.
Browser UI state is never authoritative.
```

The key realtime rule is:

```text
All devices must connect to the same Node.js/Socket.IO backend
to share identity, presence, chat, avatars, and moderation state.
```
