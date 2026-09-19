# Changelog

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
