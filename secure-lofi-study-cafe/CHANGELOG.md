# Changelog

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
