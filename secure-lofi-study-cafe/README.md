# Secure Lo-Fi Study Cafe

> **Release:** 6.2.0  
> **Type:** self-hosted secure realtime web application  
> **Runtime:** Node.js 24 LTS, Express, EJS, Socket.IO  
> **Persistence:** self-hosted SQLite in WAL mode  
> **Service manager:** systemd  
> **Security focus:** authentication, RBAC, CSRF, session security, host hardening, SQL telemetry, audit logging, backups, incident reconstruction

## What changed in v6.0

Version 6.0 adds device-specific mobile/tablet/desktop application shells, a synchronized Watch Together player embedded with the realtime communication experience, persistent chat replies and emoji reactions, typing/mention/unread UX, Listening/Watching presence states, a Pomodoro focus timer, themes/notification preferences, container-query component behavior, richer motion with reduced-motion support, and an admin-only live operations stream.

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

## v6.0 responsive Watch Together experience

Phones no longer receive a compressed desktop layout. Mobile uses a compact header and sticky bottom navigation for Room, Chat, Music, Profile, and Admin when authorized. Only one primary mobile view is shown at a time.

Tablets use a two-pane room + communication layout. Desktop keeps the three-zone navigation / main room / communication shell.

The Chat view now includes a pinned **Watch Together** panel above chat with the authoritative YouTube player, title, requester, sync state, progress, queue preview, and permission-aware controls. On mobile the panel can collapse into a compact mini-player.

Chat now supports server-backed replies and emoji reactions plus ephemeral typing indicators, mention highlighting, and unread indicators. User presence adds Listening and Watching states. Profile preferences add Espresso/Midnight/Plum themes, optional browser notifications, and a local 25/5 Pomodoro timer.

The permanent-admin console includes a live operations stream for authorized admin sockets alongside the existing user inspector, sessions, IP/user-agent telemetry, audit logs, and security events.

See [RESPONSIVE-WATCH-TOGETHER-v6.0.md](RESPONSIVE-WATCH-TOGETHER-v6.0.md).

## v5.0 product UI

Desktop now uses a responsive application shell:

```text
Left rail       Main experience           Right rail
Room nav        Large Café Floor          Members
Profile         Shared music              Realtime chat
Status
Connection
```

The layout stacks appropriately on tablets/phones instead of compressing the interface into a narrow centered column.

Realtime remote movement now interpolates between server-accepted coordinates on `requestAnimationFrame`, while the backend remains authoritative for shared presence. Users can set Studying, Available to chat, Do not disturb, or AFK; the server validates, persists, and rebroadcasts the selected status.

Normal member cards expose room-safe information only. The permanent-admin console keeps IP/session/runtime/security telemetry separated behind server-side authorization.

See [PRODUCTION-UI-UX-REDESIGN-v5.0.md](PRODUCTION-UI-UX-REDESIGN-v5.0.md).

## WSL quick host reminder

If you forget how to start the real café from Windows Subsystem for Linux (WSL), use this.

### Public test from WSL — computer + phone + friends

Open WSL, then run:

```bash
cd ~/Security-engineering-projects/secure-lofi-study-cafe
git pull origin main
bash deploy/scripts/start-free-public-test.sh
```

The script will:

1. start the real Node.js / Express / Socket.IO server;
2. use the persistent SQLite database in the project;
3. ask for the permanent admin username and password;
4. start a temporary Cloudflare Quick Tunnel;
5. print a public HTTPS address similar to:

```text
https://random-words.trycloudflare.com
```

Use the **same newly generated URL** on the computer, phone, tablet, or another user's device.

Keep the WSL terminal open while the café is running.

To stop the server and tunnel:

```text
Ctrl+C
```

A Cloudflare Quick Tunnel URL is temporary. After stopping or restarting the script, the previous `trycloudflare.com` address may no longer work. Start the script again and use the new URL it prints.

Do **not** run `npm start` at the same time as `start-free-public-test.sh`, because both try to use port 3000 and the public-test script already starts the Node server.

### Local-only WSL test

If a local `.env` file is already configured and you only want to open the café on the Windows computer:

```bash
cd ~/Security-engineering-projects/secure-lofi-study-cafe
npm start
```

Then open:

```text
http://localhost:3000
```

If port 3000 is already in use, stop the old café process with `Ctrl+C` before starting another copy.

## Hosting command

If a hosting provider asks for the process **Start Command**, use:

```text
npm start
```

That runs `node server.js`.

For the permanent self-hosted Linux service:

```bash
sudo systemctl enable --now secure-lofi-study-cafe
```

See [HOSTING-COMMANDS.md](HOSTING-COMMANDS.md) for temporary, raw Node, systemd, restart, status, and log commands.

## Start a real public test immediately

For the shortest free cross-device test, use the actual backend plus a temporary Cloudflare Quick Tunnel:

```bash
cd Security-engineering-projects/secure-lofi-study-cafe
bash deploy/scripts/start-free-public-test.sh
```

The script starts the real Node/Express/Socket.IO backend and SQLite database, then prints a temporary public HTTPS URL. Use that exact URL on both the administrator computer and Bunny's phone.

See [START-NOW.md](START-NOW.md).

Cloudflare Quick Tunnels are for testing/development, not the final stable production endpoint. Use the named-tunnel or Caddy instructions in [SELF-HOSTING.md](SELF-HOSTING.md) for a stable public deployment.

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

Version 4.1 uses:

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
* message_reactions;
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

## API and realtime architecture

The production app combines authoritative API state with incremental realtime events.

Key API routes include:

```text
GET  /api/health
GET  /api/auth/me
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
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

Realtime state includes authoritative room snapshots, presence updates, join/leave events, chat events, player state, and reconnect synchronization. Socket identity comes from the server-side Express session rather than a browser-supplied username or role.

Persistent room/presence schema includes `rooms`, `room_memberships`, `user_profiles`, and `presence_sessions`.

## v4.2 realtime performance

Avatar movement now uses lightweight volatile position deltas rather than broadcasting and rebuilding the entire presence list for every movement packet.

The moving browser renders locally at animation-frame speed. Remote browsers receive `member:moved` updates and update only the matching avatar. The server caps inbound movement processing near 30 Hz and the client emits roughly every 45 ms.

The café also displays a live Socket.IO round-trip latency estimate.

## v4.2 admin operations

The permanent-admin console now adds:

* online-user, live-socket, active-session, and failed-login counts;
* current client IP and browser user-agent;
* safe HMAC-derived session references;
* cookie flags without revealing the raw cookie;
* active server-side sessions;
* realtime presence connection history;
* Node uptime, memory, PID, listen address, proxy mode, public origin, database path, and SQLite journal mode;
* IP/user-agent fields in security-event telemetry and CSV exports;
* a **Revoke Sessions** control for invalidating another user's sessions and live sockets.

See [PERFORMANCE-ADMIN-OPS-v4.2.md](PERFORMANCE-ADMIN-OPS-v4.2.md).

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
* mobile tabbed interface;
* tablet two-pane interface;
* desktop three-zone interface;
* Watch Together player + mini-player;
* typing indicators;
* persistent replies and emoji reactions;
* mentions and unread indicators;
* Pomodoro focus timer;
* theme and notification preferences.

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
| [deploy/scripts/start-free-public-test.sh](deploy/scripts/start-free-public-test.sh) | one-command real public multi-device test |
| [START-NOW.md](START-NOW.md) | shortest path to a free public test URL |
| [HOSTING-COMMANDS.md](HOSTING-COMMANDS.md) | exact start, systemd, restart, status, and log commands |
| [deploy/scripts/install-self-hosted.sh](deploy/scripts/install-self-hosted.sh) | interactive hardened installer |
| [deploy/systemd/secure-lofi-study-cafe.service](deploy/systemd/secure-lofi-study-cafe.service) | systemd service sandbox |
| [deploy/scripts/backup-sqlite.sh](deploy/scripts/backup-sqlite.sh) | online verified backups |
| [deploy/scripts/restore-sqlite.sh](deploy/scripts/restore-sqlite.sh) | verified restore workflow |
| [deploy/scripts/security-audit.sh](deploy/scripts/security-audit.sh) | host/application security verification |
| [SELF-HOSTING.md](SELF-HOSTING.md) | full operations runbook |
| [SECURITY-ENGINEERING-REPORT-v4.0.md](SECURITY-ENGINEERING-REPORT-v4.0.md) | v4 architecture/security report |
| [REALTIME-PRESENCE-INCIDENT-REPORT-v4.0.1.md](REALTIME-PRESENCE-INCIDENT-REPORT-v4.0.1.md) | realtime root cause and first two-session repair |
| [PRODUCTION-MULTI-USER-IMPLEMENTATION-v4.1.md](PRODUCTION-MULTI-USER-IMPLEMENTATION-v4.1.md) | production architecture, API, presence, RBAC, test matrix, deployment acceptance criteria |
| [PERFORMANCE-ADMIN-OPS-v4.2.md](PERFORMANCE-ADMIN-OPS-v4.2.md) | movement optimization, latency diagnostics, admin session/network operations |
| [PRODUCTION-UI-UX-REDESIGN-v5.0.md](PRODUCTION-UI-UX-REDESIGN-v5.0.md) | production application shell, member UX, interpolated movement, admin control plane |
| [RESPONSIVE-WATCH-TOGETHER-v6.0.md](RESPONSIVE-WATCH-TOGETHER-v6.0.md) | native mobile/tablet/desktop shell, Watch Together, richer chat, focus tools, admin live ops |
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
* origin policy validation;
* real two-session Socket.IO presence/RBAC test;
* multi-client disconnect/reconnect/logout/restart integration test;
* typing, availability, movement, reply/reaction and admin live-ops integration checks;
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
