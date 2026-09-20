# Changelog

## 4.1.0 — Production Multi-User Backend

### Shared backend

* Added persistent `rooms`, `room_memberships`, `user_profiles`, and `presence_sessions` models.
* Added stable database IDs as the authoritative user identity.
* Added authenticated JSON APIs for auth, current user, rooms, membership, messages, and admin users/roles.
* Added consistent JSON error responses and CSRF protection for state-changing API requests.

### Realtime presence

* Added dedicated `RoomPresence` service.
* Tracks authenticated users by room and stable user ID.
* Supports multiple active sockets/tabs per user without premature offline transitions.
* Persists connect/heartbeat/disconnect/last-seen history.
* Marks stale online socket records offline after process restart.
* Added explicit room snapshot/reconnect synchronization.
* Added idempotent member/message reconciliation on the frontend.

### Realtime security

* Engine.IO and Express use the same server-side session middleware.
* Socket.IO rejects unauthenticated connections.
* Added explicit allowed-origin policy for realtime handshakes.
* Client-supplied usernames/roles are not trusted for socket identity.

### RBAC

* Formalized roles, permissions, and role-permission mappings in SQL.
* Regular registration always produces the `user` role.
* Admin APIs enforce server-side authorization and return 403 to regular users.
* Bunny/regular-user privileged-page/API denial is covered by integration tests.

### Verification

* Added independent multi-client Socket.IO integration testing.
* Tests duplicate tabs, reconnect, logout, persisted messages, restart persistence, and direct privileged API access.
* Latest CI validates JavaScript, templates, shell deployment assets, security schema, realtime behavior, multi-client behavior, origin policy, and Docker build.
* Added `PRODUCTION-MULTI-USER-IMPLEMENTATION-v4.1.md`.

## 4.0.1 — Realtime Presence Reliability

### Realtime

* Moved Socket.IO authentication onto the shared Engine.IO/Express session middleware.
* Added a complete server-authoritative `room:snapshot`.
* Added explicit `room:sync-request` handling after every browser connection/reconnection.
* Kept join/leave presence broadcasts authoritative on the Node server.
* Added client connection-error/synchronization status.

### Static Pages correction

* Disabled browser-local normal-user registration on GitHub Pages.
* Disabled browser-local normal-user login on GitHub Pages.
* Removed fake remote members and fake live chat from the static preview.
* Clarified that cross-device accounts require the self-hosted Node server.

### Automated verification

* Added `scripts/realtime-presence-test.js`.
* CI now launches a real server with two independent authenticated sessions.
* The test proves admin sees bunny join in realtime.
* The test proves bunny sees admin.
* The test proves bunny chat reaches admin over Socket.IO.
* The test proves bunny receives HTTP 403 for `/admin`.
* The test proves the admin receives HTTP 200 for `/admin`.
* The test proves disconnect presence is broadcast.

* Added `REALTIME-PRESENCE-INCIDENT-REPORT-v4.0.1.md`.

## 4.0.0 — Self-Hosted Security Engineering Server

### Runtime

* Moved the authoritative backend to a self-hosted Linux deployment model.
* Standardized on Node.js 24 LTS.
* Added explicit `HOST`, `TRUST_PROXY`, and `COOKIE_SECURE` runtime controls.
* Added graceful SIGTERM/SIGINT handling with SQLite checkpoint/close behavior.
* Removed the production dependency on Koyeb/Turso.

### SQLite

* Restored local `sqlite3` persistence.
* Enabled WAL mode, foreign keys, NORMAL synchronous mode, and a 5-second busy timeout.
* Kept SQL-backed Express sessions, security telemetry, audit logs, and forensic queries.
* Added SQLite quick-check verification in CI.

### Linux hardening

* Added an interactive Ubuntu/Debian self-host installer.
* Added a dedicated non-login `securelofi` service account.
* Added a hardened systemd unit using `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, private devices/tmp, dropped capabilities, and a restricted writable database path.
* Added a host security-audit script using service-state checks, socket inspection, permissions, SQLite integrity, UFW status, and `systemd-analyze security`.

### Network security

* Added LAN-only deployment guidance with subnet-scoped UFW rules.
* Added Caddy reverse-proxy configuration for HTTPS/public deployments.
* Added Cloudflare Tunnel configuration for outbound-only public ingress.
* Documented that Node port 3000 should not be directly forwarded to the Internet.

### Backup and recovery

* Added a daily systemd backup timer.
* Added SQLite online backups using the CLI `.backup` operation.
* Added backup `PRAGMA quick_check`, gzip compression, SHA-256 checksums, permissions, and retention.
* Added a restore script with checksum/integrity verification, explicit confirmation, service stop/start, pre-restore preservation, and WAL/SHM cleanup.

### Documentation

* Added `SELF-HOSTING.md`.
* Added `SECURITY-ENGINEERING-REPORT-v4.0.md`.
* Added deployment asset documentation.
* Updated the admin/security UI to identify the self-hosted SQLite architecture.
* Updated the project README to make v4.0 the authoritative deployment model.

## 3.2.0 — Free Shared Persistence with Koyeb and Turso

### Database

* Replaced the production-local `sqlite3` driver with `@libsql/client`.
* Added Turso remote database support with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
* Preserved local SQLite-compatible development through `file:lofi_cafe.db`.
* Preserved parameterized SQL, schema migrations, security indexes, audit logs, and forensic queries.
* Migrated Express sessions to the shared libSQL database.

### Free deployment

* Reworked the production Docker image for Koyeb's Free Web Service.
* Removed the requirement for a paid/persistent web-server volume.
* Moved durable state to Turso so Koyeb can restart or sleep without losing users or logs.
* Added `KOYEB-TURSO-DEPLOYMENT.md`.
* Added Security Engineering Report v3.2.

### CI

* Updated the security smoke test to exercise `@libsql/client`.
* Verifies tables, indexes, sessions, security events, and query plans using the same database API as production.
* Production Docker image continues to build in GitHub Actions.

## 3.1.0 — Shared Backend, Persistent Sessions, and Production RBAC

### Cross-device behavior

* Moved the production design away from browser-local identity and toward one shared Node.js/Socket.IO service.
* Added SQLite-backed Express sessions so authenticated sessions survive process restarts when the database is stored on persistent storage.
* Added Railway deployment configuration and a production Docker image.
* Added a database-aware `/healthz` endpoint.
* Added configurable `DB_PATH` support for a mounted Railway volume.
* Added production trust-proxy handling for secure cookies behind Railway TLS.

### Role security

* Public registration now always creates `user` accounts.
* Removed the unsafe "first registered account becomes admin" rule.
* Added explicit server-side administrator provisioning through `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
* Production startup fails closed when administrator provisioning variables are missing.
* The Security Engineering route is protected by permanent-admin authorization.
* The static showcase now normalizes stale browser roles so accounts such as `bunny` cannot retain administrator access from an older browser-local build.
* Static admin and security pages verify both the reserved admin identity and admin role before displaying privileged interfaces.

### Persistence and validation

* Added a persistent `sessions` SQL table and expiration index.
* Added a custom SQLite Express session store.
* Added session-table checks to the security smoke test.
* Added production-container builds to CI.
* Added Docker and Railway configuration files to CI change detection.

### Deployment model

The production topology is intentionally single-service/single-replica while SQLite is the shared persistence layer. Railway persistent storage must be mounted at `/data`, with `DB_PATH=/data/lofi_cafe.db`.

This release is the point at which two different devices can authenticate against the same account database, share the same Socket.IO room, see each other's presence, exchange chat messages, and enforce the same server-side roles.

## 3.0.0 — Security Telemetry and Backend Showcase

### Security

* Added indexed SQLite `security_events` telemetry.
* Added per-request UUID correlation and `X-Request-ID`.
* Added HMAC-derived session references instead of logging raw session IDs.
* Regenerated sessions after successful authentication.
* Added SQL events for failed/successful authentication, logout, rate limiting, CSRF failures, authorization denials, HTTP request outcomes, Socket.IO lifecycle, and profile-image validation.
* Added SQL forensic investigation queries.
* Added SQLite schema/index smoke testing in CI.
* Expanded permanent-admin security-event visibility and CSV export coverage.
* Preserved parameterized SQL, bcrypt, CSRF, RBAC, Helmet/CSP, soft-delete moderation, and CSV formula-injection protection.

### Public showcase

* Added a cross-device showcase administrator: `admin / admin12345`.
* Reserved the `admin` username in browser-local showcase registration.
* Added a Security Engineering page describing the real backend architecture.
* Changed project copy from portfolio/demo-oriented wording to engineering-oriented documentation.

### Realtime and UI

* Added persistent profile images in the Node backend.
* Added secure image type/signature/size validation.
* Added avatar profile thumbnails.
* Added smooth continuous walking.
* Added click/tap-to-walk.
* Added live avatar speech bubbles.
* Kept transient avatar movement out of persistent audit logs.

## 2.x — Interactive Café and Admin Audit

* Added Café Floor avatars and live movement.
* Added responsive mobile layouts.
* Added animated coffee identity.
* Added permanent-admin audit console.
* Added CSV audit report.
* Added soft-delete message moderation.
* Added browser-side profanity filtering behavior to the static showcase.

## 1.0.0 — Original Secure Lo-Fi Study Cafe

* Express/EJS application.
* SQLite persistence.
* bcrypt account authentication.
* Socket.IO chat and presence.
* shared music queue and synchronized player.
* moderator approval workflow.
* CSRF protection.
* role-based authorization.
