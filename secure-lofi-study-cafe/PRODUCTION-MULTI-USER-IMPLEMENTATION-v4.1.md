# Secure Lo-Fi Study Cafe
## Production Multi-User Implementation Report — v4.1.0

**Release:** 4.1.0  
**Status:** production-capable self-hosted backend implemented and CI-validated  
**Important verification boundary:** automated tests use independent authenticated clients and a real Socket.IO server. A final public two-physical-device test still requires deploying the server to a reachable host and connecting both devices to that same origin.

---

## 1. Original root cause

The original cross-device failure was architectural.

The GitHub Pages build was static and browser-local. Accounts, roles, presence, and simulated room state could exist independently in:

```text
Desktop browser storage
        X
Phone browser storage
```

There was no shared process, database, authenticated session store, or realtime room connecting those browsers.

That meant:

* Bunny could exist only on the phone;
* Admin could exist only on the desktop;
* each browser could render a different connected-user list;
* a browser could retain stale role state;
* "realtime" UI behavior in the static preview could not prove multi-device synchronization.

GitHub Pages is now treated only as an architecture/project landing page, not as the real multi-user application.

---

## 2. Authoritative production architecture

The real application path is:

```text
Desktop / Phone
      |
      | HTTPS + Socket.IO
      v
Reverse proxy / secure tunnel
      |
      v
Node.js 24 LTS
Express + Socket.IO
      |
      +-- authenticated API
      +-- server-side RBAC
      +-- realtime room state
      |
      v
SQLite WAL
      |
      +-- users
      +-- user_profiles
      +-- roles
      +-- permissions
      +-- role_permissions
      +-- rooms
      +-- room_memberships
      +-- messages
      +-- presence_sessions
      +-- sessions
      +-- audit_logs
      +-- security_events
```

The backend is the source of truth for identity, authorization, persistent room membership, messages, sessions, last-seen data, audit records, and security events.

Current online socket state is maintained server-side and reconciled with persistent last-seen data.

---

## 3. Persistent data model

Version 4.1 adds or formalizes:

### Users

`users`

* stable integer ID;
* username;
* bcrypt password hash;
* server-owned role;
* profile-image data reference/storage;
* creation timestamp.

### Profiles

`user_profiles`

* user ID;
* display name;
* avatar style;
* last-seen timestamp;
* created/updated timestamps.

### RBAC

`roles`

`permissions`

`role_permissions`

Roles include:

```text
admin
mod
user
```

Permissions include:

```text
room.use
room.moderate
admin.console
admin.users.read
admin.users.write
```

### Rooms

`rooms`

* stable room ID;
* slug;
* name;
* creator;
* timestamps.

### Membership

`room_memberships`

* room ID;
* user ID;
* initial join timestamp;
* latest join timestamp;
* latest leave timestamp.

### Messages

`messages`

Messages belong to a room and persist after page refresh/server restart unless intentionally removed according to moderation behavior.

### Realtime connection history

`presence_sessions`

Tracks:

* server-generated connection UUID;
* non-secret socket reference;
* authenticated user ID;
* room ID;
* status;
* connected timestamp;
* heartbeat/last-seen timestamp;
* disconnected timestamp.

### Authentication sessions

`sessions`

Express sessions are server-side and SQLite-backed.

---

## 4. Authentication

Authentication is implemented server-side.

Passwords use bcrypt with cost factor 12.

The browser never chooses its own role.

Registration always creates:

```text
role = user
```

The permanent administrator is provisioned by protected server configuration:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

Successful login regenerates the Express session identifier before authenticated state is stored.

The browser receives an HttpOnly session cookie.

Public HTTPS deployments use a Secure cookie.

---

## 5. Server-side authorization

Privileged access is enforced by the server.

Normal page middleware:

```text
requireLogin
requireModerator
requirePermanentAdmin
```

API middleware independently returns JSON errors.

An authenticated regular user attempting an administrator API receives:

```text
HTTP 403 Forbidden
```

The application does not treat hidden buttons as authorization.

Bunny can alter HTML, JavaScript, URLs, request bodies, browser storage, or role-looking values locally; none of those operations grant server-side administrator authority.

---

## 6. API layer

The production backend exposes authenticated JSON APIs under:

```text
/api
```

Implemented API areas include:

```text
GET  /api/health
GET  /api/auth/csrf
GET  /api/auth/me
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/users/me
GET  /api/rooms
GET  /api/rooms/:roomId
GET  /api/rooms/:roomId/members
POST /api/rooms/:roomId/join
POST /api/rooms/:roomId/leave
GET  /api/rooms/:roomId/messages
POST /api/rooms/:roomId/messages
GET  /api/admin/users
PATCH /api/admin/users/:userId/role
```

State-changing API requests use a session-bound CSRF token carried in:

```text
X-CSRF-Token
```

API errors use consistent JSON error objects with appropriate HTTP status codes.

---

## 7. Realtime authentication

Socket.IO does not accept a client-supplied username/user ID as identity.

Engine.IO uses the same Express session middleware as HTTP.

During connection:

1. the server reads the session cookie;
2. the server loads the server-side session;
3. the authenticated user is resolved;
4. unauthorized sockets are rejected;
5. origin policy is evaluated;
6. the server joins the socket to the authorized Socket.IO room.

The client cannot claim to be Bunny, Admin, or another database user by changing an event payload.

---

## 8. Realtime presence

Presence is managed by:

```text
services/room-presence.js
```

It tracks users by stable database user ID.

Each user can own multiple socket IDs.

Therefore:

```text
Bunny tab 1 connected
Bunny tab 2 connected
close tab 1
=> Bunny remains online
```

Bunny is removed from online presence only when the final active socket is gone.

Persistent last-seen and connection timestamps are recorded separately.

---

## 9. Presence lifecycle

### Connection

When a valid authenticated socket connects:

1. server verifies identity;
2. persistent room membership is ensured;
3. user profile last-seen is updated;
4. a `presence_sessions` row is created;
5. socket joins `room:<id>`;
6. active socket count is incremented;
7. server emits the authoritative presence state.

### Heartbeat

The realtime layer periodically refreshes last-seen state.

This gives the server a persisted timestamp even when a browser or network disappears unexpectedly.

### Disconnect

On disconnect:

1. the individual socket is removed;
2. the corresponding presence session becomes offline;
3. other sockets for that user are checked;
4. only the final socket makes the user offline;
5. profile last-seen is updated;
6. room last-left timestamp is recorded;
7. updated presence is broadcast.

### Server restart

At database initialization, previously-online connection records are marked offline because an old process cannot prove those sockets still exist.

Their most recent heartbeat remains available as last-seen evidence.

---

## 10. Initial state plus realtime events

The frontend no longer depends solely on future events.

On initial load/reconnect it retrieves or receives authoritative current state.

The browser fetches current room data such as:

```text
/api/rooms/:roomId/members
/api/rooms/:roomId/messages
```

Socket.IO also supports:

```text
room:snapshot
room:sync-request
presence:update
user:joined
user:left
chat:new
```

The browser requests a fresh synchronization snapshot after connection/reconnection.

This prevents the UI from remaining stale after temporary network interruption.

---

## 11. Idempotent frontend state

Stable numeric database user IDs are used for user identity.

Member rendering replaces/reconciles authoritative state rather than blindly appending duplicate usernames.

Message IDs are tracked in the client to prevent duplicate rendering of repeated/replayed message events.

Multiple tabs are collapsed into one visible member with a connection count.

---

## 12. Message flow

Normal message flow is:

```text
Bunny client
   |
   | authenticated request / socket action
   v
Node backend
   |
   +-- resolve Bunny from session
   +-- validate room
   +-- validate content
   +-- apply moderation/censor rules
   +-- INSERT message into SQLite
   |
   v
Socket.IO broadcast
   |
   +--> Admin
   +--> Bunny
   +--> other authorized room clients
```

The database write happens before the authoritative broadcast.

Refreshing a page reloads persisted messages.

---

## 13. Reconnection

The Socket.IO browser client enables automatic reconnection.

After a new connection:

1. authenticated session is reused if valid;
2. room subscription is restored by the server;
3. client requests `room:sync-request`;
4. server sends a new authoritative snapshot;
5. room members/messages/player state are reconciled.

Short network interruptions therefore do not require a full manual page refresh.

If the authentication session is no longer valid, connection authentication fails instead of silently accepting client identity.

---

## 14. Origin/CORS policy

The application has an explicit origin policy module:

```text
security/origin-policy.js
```

Environment variables:

```text
PUBLIC_ORIGIN
ALLOWED_ORIGINS
```

Socket.IO handshakes validate the browser origin.

The intended public deployment is same-origin, which avoids unnecessarily broad authenticated CORS.

Production must not use wildcard authenticated origins.

---

## 15. Bunny authorization requirement

Bunny is a normal user.

Expected:

```text
username: bunny
role: user
```

Bunny must not receive or use:

```text
Admin Console
Security Engineering
user administration
role management
system management
permanent-admin APIs
```

Direct server access is still enforced.

CI verifies Bunny receives 403 for privileged resources while Admin succeeds.

---

## 16. Health checks

Two health endpoints exist for deployment/operations:

```text
GET /healthz
GET /api/health
```

The API health response is intentionally minimal:

```json
{"status":"ok"}
```

The internal health endpoint also verifies database reachability.

Neither endpoint returns secrets or environment configuration.

---

## 17. Production configuration

Required variables are documented in:

```text
.env.example
```

Important settings:

```text
NODE_ENV
HOST
PORT
PUBLIC_ORIGIN
ALLOWED_ORIGINS
TRUST_PROXY
COOKIE_SECURE
DB_PATH
SESSION_SECRET
ADMIN_USERNAME
ADMIN_PASSWORD
```

Actual values are not committed.

For public reverse-proxy/tunnel deployment:

```text
HOST=127.0.0.1
TRUST_PROXY=true
COOKIE_SECURE=true
PUBLIC_ORIGIN=https://your-real-domain.example
```

---

## 18. Public deployment

The repository supports an owner-controlled Linux server.

Deployment assets include:

```text
deploy/systemd/
deploy/caddy/
deploy/cloudflare/
deploy/scripts/
```

Recommended public paths:

### Caddy

Internet clients connect over HTTPS/WSS to Caddy.

Caddy reverse-proxies to:

```text
127.0.0.1:3000
```

Node is not exposed directly.

### Cloudflare Tunnel

The host makes an outbound tunnel connection.

The public origin is mapped to the localhost Node service.

No public inbound application port is required.

---

## 19. Automated multi-client validation

CI runs:

```bash
npm run test:security
npm run test:realtime
npm run test:integration
```

The multi-client integration test starts a real application server with a disposable SQLite database and uses independent authenticated sessions.

It validates:

* permanent Admin account;
* separately-created Bunny user account;
* Bunny role is `user`;
* Bunny admin page/API access returns 403;
* Security Engineering is denied to Bunny;
* unapproved realtime origin is rejected;
* Admin and Bunny connect independently through Socket.IO;
* Admin receives Bunny's realtime join;
* Bunny receives authoritative room state;
* duplicate Bunny tabs do not create duplicate visible users;
* closing one Bunny socket does not incorrectly mark Bunny offline;
* chat sent by Bunny reaches Admin in realtime;
* messages persist in SQLite;
* disconnect/reconnect restores authoritative state;
* explicit Bunny logout removes Bunny from live presence;
* Bunny's account remains persisted;
* messages/accounts survive an application restart.

This is substantially stronger than testing two tabs that share one browser session.

---

## 20. What automated tests do not prove

CI does **not** prove that a specific public DNS/router/tunnel deployment is reachable from two physical networks.

That requires the actual server to be deployed.

Do not claim the physical-device requirement has passed until this manual test is completed:

```text
Device A: administrator desktop
Device B: Bunny phone
both use the exact same public application origin
```

The application code and automated network clients are ready for that deployment test.

---

## 21. Required physical-device acceptance test

1. Deploy the Linux server.
2. Configure HTTPS/WSS public ingress.
3. Set `PUBLIC_ORIGIN` to the exact public origin.
4. Open the public URL on Device A.
5. Log in as permanent Admin.
6. Open the main room.
7. Open the same public URL on Device B.
8. Register/log in Bunny.
9. Verify Bunny displays `Role: user`.
10. Verify Bunny has no Admin Console or Security Engineering navigation.
11. Verify Admin sees Bunny appear without refresh.
12. Verify Bunny sees Admin.
13. Send a message from Bunny.
14. Verify Admin receives it immediately.
15. Refresh both devices.
16. Verify the message remains.
17. Open a second Bunny tab.
18. Close one Bunny tab.
19. Verify Bunny stays online.
20. Temporarily disable the phone network.
21. Restore network.
22. Verify Socket.IO reconnects and the room snapshot is restored.
23. Attempt `/api/admin/users` using Bunny's authenticated browser.
24. Verify HTTP 403.
25. Log Bunny out.
26. Verify Admin receives Bunny's removal from active presence.
27. Restart the service.
28. Verify Bunny's account and persisted message still exist.

Only after this checklist passes should the public deployment be described as physically verified cross-device.

---

## 22. Current limitations

### Single application process

Realtime presence is maintained in process.

Run one Node application instance.

Horizontal scaling would require shared realtime coordination, such as a Socket.IO adapter backed by Redis or another shared broker.

### SQLite is local-host persistence

Keep the SQLite database on local disk.

Do not place the active WAL database on an arbitrary network filesystem.

### Presence is intentionally partly transient

Current connection/socket state is transient.

Persistent `presence_sessions` and profile last-seen fields provide history/recovery context, but an online state is valid only while a live authenticated server connection exists.

### Static GitHub Pages is not the app

GitHub Pages is only documentation/architecture presentation.

The actual application is the Node server URL.

---

## 23. Final implementation result

Version 4.1 implements the requested shared-backend model:

```text
Client action
  -> authenticated server
  -> server identity resolution
  -> authorization
  -> validation
  -> database update
  -> realtime broadcast
  -> authorized clients reconcile state
```

There are no browser-created fake remote users in the authoritative production path.

The user ID and role are not trusted from frontend storage.

Persistent shared data survives browser reloads and backend restarts.

Realtime user presence is attached to authenticated server sessions and stable database user IDs.

The remaining step is deployment to a real reachable host followed by the documented two-physical-device acceptance test.
