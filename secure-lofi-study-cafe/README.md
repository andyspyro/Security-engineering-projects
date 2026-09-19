# Secure Lo-Fi Study Cafe

> **Release:** 4.0.1  
> **Type:** self-hosted secure realtime web application  
> **Runtime:** Node.js 24 LTS, Express, EJS, Socket.IO  
> **Persistence:** self-hosted SQLite in WAL mode  
> **Service manager:** systemd  
> **Security focus:** authentication, RBAC, CSRF, session security, host hardening, SQL telemetry, audit logging, backups, incident reconstruction

## What changed in v4.0

Version 4.0 removes the requirement for a hosted backend/database provider.

The full application is designed to run on a Linux machine you control:

```text
Phone / computer
      |
      v
your server
  |
  +-- optional Caddy HTTPS or Cloudflare Tunnel
  |
  +-- Node.js / Express / Socket.IO
  |
  +-- SQLite
      +-- users
      +-- sessions
      +-- messages
      +-- audit_logs
      +-- security_events
```

This is the deployment where an administrator on one device and a normal user such as `bunny` on another device use the same account database, room presence, chat, moderation state, and security logs.

The GitHub Pages build remains a static interface showcase only. It is not the authoritative multi-user backend.

## Quick start

Recommended host:

* Ubuntu Server or Debian;
* Node.js 24 LTS;
* a machine that can remain powered on;
* local SSD/storage for SQLite.

Clone:

```bash
git clone https://github.com/andyspyro/Security-engineering-projects.git
cd Security-engineering-projects/secure-lofi-study-cafe
```

Review and run the installer:

```bash
less deploy/scripts/install-self-hosted.sh
sudo bash deploy/scripts/install-self-hosted.sh
```

The installer can configure either:

1. LAN-only access for a phone/computer on the same network; or
2. public HTTPS behind Caddy or an outbound Cloudflare Tunnel.

Full instructions:

[SELF-HOSTING.md](SELF-HOSTING.md)

## Host security model

The application service runs as:

```text
securelofi:securelofi
```

with no interactive shell.

The systemd unit applies controls including:

```ini
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictSUIDSGID=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadWritePaths=/var/lib/secure-lofi-study-cafe
```

Application source is root-owned and read-only to the service.

The application can write only to its database directory.

## Network architecture

### LAN

For controlled local testing:

```text
HOST=0.0.0.0
TRUST_PROXY=false
COOKIE_SECURE=false
```

Restrict TCP 3000 with UFW to the actual private subnet.

### Public

Recommended:

```text
HOST=127.0.0.1
TRUST_PROXY=true
COOKIE_SECURE=true
```

Then use either:

* Caddy on TCP 80/443 for automatic HTTPS; or
* Cloudflare Tunnel for outbound-only public ingress.

Do not port-forward Node port 3000 directly to the public Internet.

## SQLite security and durability

Version 4.0 enables:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

Default production database:

```text
/var/lib/secure-lofi-study-cafe/lofi_cafe.db
```

Persistent tables:

* users;
* messages;
* music_requests;
* music_queue;
* sessions;
* audit_logs;
* security_events.

The database is outside the web root and restricted to the service account.

## Authentication and RBAC

Security controls include:

| Control | Implementation |
|---|---|
| Password storage | bcrypt cost factor 12 |
| Public registration | always creates `user` |
| Permanent admin | server-configured `ADMIN_USERNAME` / `ADMIN_PASSWORD` |
| Session fixation defense | session regeneration after login |
| Session persistence | SQLite `sessions` table |
| Session cookie | HttpOnly, SameSite=Lax, optional Secure |
| Authorization | server-side `requireLogin`, `requireModerator`, `requirePermanentAdmin` |
| CSRF | session-bound random token |
| Rate limiting | general + tighter auth limiter |
| Request correlation | UUID returned in `X-Request-ID` |
| Session correlation | HMAC-derived reference, not raw session ID |

Normal users cannot gain administrator access by changing browser state.

## Application security controls

* parameterized SQL;
* EJS output escaping;
* DOM `textContent` for realtime user content;
* Helmet security headers and CSP;
* profile-image MIME and magic-byte verification;
* PNG/JPEG/WebP allowlist;
* 512 KB image cap;
* CSV formula-injection neutralization;
* profanity filtering for normal users;
* soft-delete moderation evidence;
* authenticated Socket.IO sessions.

## Security telemetry

`security_events` records structured security activity:

* registration;
* successful/failed login;
* logout;
* auth rate-limit blocks;
* CSRF failures;
* authentication-required events;
* moderator/admin authorization denial;
* HTTP status/duration;
* Socket.IO connect/disconnect;
* profile-image acceptance/rejection.

Fields include:

```text
event UUID
event type
severity
actor
target
outcome
HTTP method
route
request ID
HMAC-derived session reference
metadata
timestamp
```

Sensitive credentials and raw session tokens are intentionally excluded.

## Application audit trail

`audit_logs` records accountability events such as:

* chat submission;
* message deletion;
* music approval/rejection;
* queue manipulation;
* temporary privilege changes;
* administrator report downloads.

This is separate from security telemetry so operational events and security-detection events remain independently useful.

## Backups and recovery

The installer enables a daily systemd timer.

Backup script:

```text
deploy/scripts/backup-sqlite.sh
```

It:

1. uses SQLite's online backup command;
2. runs `PRAGMA quick_check`;
3. compresses the backup;
4. creates a SHA-256 checksum;
5. applies restrictive permissions;
6. removes backups older than the retention policy.

Restore script:

```text
deploy/scripts/restore-sqlite.sh
```

It validates the checksum and SQLite integrity before replacing the live database.

## Health and host audit

Health:

```bash
/opt/secure-lofi-study-cafe/deploy/scripts/healthcheck.sh
```

Host-security review:

```bash
sudo /opt/secure-lofi-study-cafe/deploy/scripts/security-audit.sh
```

The audit checks:

* systemd status/hardening;
* listening ports;
* secret-file permissions;
* database permissions;
* SQLite quick_check;
* WAL mode;
* UFW status;
* application health;
* systemd security analysis.

## SQL forensics

The repository includes:

[sql/security-forensics.sql](sql/security-forensics.sql)

It contains investigation queries for:

* high-severity events;
* failed logins;
* authorization denials;
* CSRF failures;
* session correlation;
* daily event summaries;
* privileged actions;
* deleted-message evidence;
* user activity;
* media moderation;
* unified incident timelines;
* index inspection;
* query-plan analysis.

## Realtime café features

* shared account registration/login;
* live chat;
* shared member presence;
* synchronized avatars;
* profile pictures;
* WASD/arrow/touch avatar movement;
* click/tap-to-walk;
* avatar speech bubbles;
* shared music queue;
* moderator approval;
* vote-next;
* synchronized player state;
* mobile-responsive interface.

Avatar X/Y movement is transient and intentionally not persisted to the audit database.

## Realtime presence guarantee

The Node backend now sends a full authoritative room snapshot at initial connection and after reconnect. Every join/leave also broadcasts `presence:update` to all connected clients.

CI includes a two-session integration test that logs in `admin` and `bunny` independently and verifies:

* admin sees bunny join;
* bunny sees admin;
* bunny's chat reaches admin in realtime;
* bunny cannot access `/admin`;
* admin can access `/admin`;
* bunny disappearing from the room is broadcast when the socket disconnects.

See [REALTIME-PRESENCE-INCIDENT-REPORT-v4.0.1.md](REALTIME-PRESENCE-INCIDENT-REPORT-v4.0.1.md).

## Acceptance test

### Admin computer

Expected:

```text
Role: admin
Admin Console: visible
Security Engineering: visible
```

### Bunny phone

Expected:

```text
Role: user
Admin Console: absent
Security Engineering: absent
```

With both clients connected to the same self-hosted server, each should see the other in Members in Room and on the Café Floor, and chat should arrive in realtime.

## Repository map

| File | Purpose |
|---|---|
| [server.js](server.js) | Express/Socket.IO server, authentication, RBAC, telemetry |
| [database.js](database.js) | hardened SQLite wrapper, WAL, migrations, query helpers |
| [sqlite-session-store.js](sqlite-session-store.js) | persistent SQLite-backed Express sessions |
| [schema.sql](schema.sql) | documented SQLite schema and runtime pragmas |
| [sql/security-forensics.sql](sql/security-forensics.sql) | incident-response SQL |
| [deploy/README.md](deploy/README.md) | deployment asset map |
| [deploy/scripts/install-self-hosted.sh](deploy/scripts/install-self-hosted.sh) | interactive hardened installer |
| [deploy/systemd/secure-lofi-study-cafe.service](deploy/systemd/secure-lofi-study-cafe.service) | systemd service sandbox |
| [deploy/scripts/backup-sqlite.sh](deploy/scripts/backup-sqlite.sh) | online verified backups |
| [deploy/scripts/restore-sqlite.sh](deploy/scripts/restore-sqlite.sh) | verified restore workflow |
| [deploy/scripts/security-audit.sh](deploy/scripts/security-audit.sh) | host/application security verification |
| [SELF-HOSTING.md](SELF-HOSTING.md) | full operations runbook |
| [SECURITY-ENGINEERING-REPORT-v4.0.md](SECURITY-ENGINEERING-REPORT-v4.0.md) | v4 architecture/security report |
| [REALTIME-PRESENCE-INCIDENT-REPORT-v4.0.1.md](REALTIME-PRESENCE-INCIDENT-REPORT-v4.0.1.md) | realtime root cause, repair, and two-session validation |
| [CHANGELOG.md](CHANGELOG.md) | release history |

## CI validation

GitHub Actions uses Node.js 24 LTS and checks:

* JavaScript syntax;
* EJS compilation;
* Bash deployment-script syntax;
* SQLite schema/tables/indexes;
* WAL mode;
* foreign-key enforcement;
* session persistence;
* security-event queries;
* SQLite quick_check;
* query plans;
* production Docker build.

Run locally:

```bash
npm install
npm run test:security
```

## Documentation

Start here:

* [SELF-HOSTING.md](SELF-HOSTING.md)
* [SECURITY-ENGINEERING-REPORT-v4.0.md](SECURITY-ENGINEERING-REPORT-v4.0.md)
* [UI-UX-ENHANCEMENT-REPORT.md](UI-UX-ENHANCEMENT-REPORT.md)
* [CHANGELOG.md](CHANGELOG.md)

Previous version reports remain in the repository as architecture history.
