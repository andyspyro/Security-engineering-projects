# Secure Lo-Fi Study Cafe
## Security Engineering Report — Version 4.0

**Release:** 4.0.0  
**Deployment model:** self-hosted Linux server  
**Runtime:** Node.js 24 LTS, Express, EJS, Socket.IO  
**Persistence:** local SQLite in WAL mode  
**Service manager:** systemd  
**Optional public ingress:** Caddy HTTPS or Cloudflare Tunnel

---

## Executive summary

Version 4.0 moves the project from third-party application/database hosting back to infrastructure controlled by the application owner.

The authoritative production state now lives on one Linux host:

```text
HTTP / Socket.IO
      |
      v
Node.js application
      |
      v
SQLite
```

This creates a clear security boundary:

* browser clients are untrusted;
* Express performs authentication/authorization;
* Socket.IO inherits authenticated server sessions;
* SQLite is reachable only through the local application process and local administrative tools;
* the Node service runs as a dedicated unprivileged Linux account;
* the public edge is separated from the application process.

Version 4.0 also adds host-level controls that were outside the earlier application-only model: systemd sandboxing, firewall guidance, TLS/reverse-proxy configuration, outbound tunnel configuration, service health checks, online backups, checksum verification, restore validation, and a host-security audit script.

---

## 1. Deployment architecture

### LAN

```text
Phone ──────────────┐
                    |
Admin computer ─────+── private LAN
                    |
                    v
              Linux server
                    |
              Node :3000
                    |
                 SQLite
```

### Public Caddy deployment

```text
Internet
   |
   v
TCP 443 / TLS
   |
   v
Caddy
   |
   v
127.0.0.1:3000
   |
   v
Node.js / Express / Socket.IO
   |
   v
SQLite
```

### Public outbound-tunnel deployment

```text
Internet
   |
   v
Cloudflare edge
   |
   v
outbound tunnel
   |
   v
127.0.0.1:3000
   |
   v
Node.js / SQLite
```

The Node process is not intended to be directly exposed to the public Internet.

---

## 2. Operating-system identity and least privilege

The application runs under:

```text
user:  securelofi
group: securelofi
shell: /usr/sbin/nologin
```

The service account cannot be used as an ordinary interactive login account.

Application source is owned by root.

Only the application data directory is writable by the service.

This makes application compromise less useful than running Node as root or as the administrator's normal shell account.

---

## 3. systemd sandbox

The supplied unit applies:

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
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
ReadWritePaths=/var/lib/secure-lofi-study-cafe
```

Important effects:

* child processes cannot acquire new privilege through setuid/file capabilities;
* the normal filesystem is read-only to the application service;
* home directories are hidden;
* kernel/module/control-group mutation is blocked;
* Linux capabilities are dropped;
* writable state is limited to the SQLite directory.

The repository includes a host audit command using:

```text
systemd-analyze security
```

to make service hardening visible during review.

---

## 4. Network exposure

The backend supports explicit binding through:

```text
HOST
PORT
```

### Public mode

```text
HOST=127.0.0.1
```

This prevents remote clients from bypassing the intended reverse proxy/tunnel and connecting directly to Node port 3000.

### LAN mode

```text
HOST=0.0.0.0
```

is permitted for local-network testing, but UFW should restrict port 3000 to the actual private subnet.

The firewall procedure preserves SSH access before enabling UFW.

---

## 5. Reverse-proxy trust

Proxy trust is no longer inferred solely from `NODE_ENV`.

It is explicit:

```text
TRUST_PROXY=true|false
```

When enabled, Express trusts only the loopback proxy boundary.

This avoids blindly trusting arbitrary client-supplied forwarded headers.

---

## 6. Secure-cookie mode

Cookie transport security is explicitly configured:

```text
COOKIE_SECURE=true|false
```

Public HTTPS deployments use:

```text
COOKIE_SECURE=true
```

LAN-only HTTP testing can use:

```text
COOKIE_SECURE=false
```

The session cookie remains:

* HttpOnly;
* SameSite=Lax;
* one-hour lifetime.

---

## 7. SQLite security and concurrency

The database wrapper enables:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

### Why WAL

For this single-host realtime application, WAL improves concurrency because readers can continue while writes are committed to the WAL.

SQLite documents that WAL relies on shared memory and is intended for processes on the same host.

The application therefore keeps the database on local storage rather than NFS/SMB.

### Busy timeout

A 5-second busy timeout gives brief concurrent write contention time to resolve instead of immediately returning a lock error.

### Graceful shutdown

SIGTERM/SIGINT handling performs a WAL checkpoint attempt and closes the SQLite connection cleanly.

That matters when systemd stops/restarts the service.

---

## 8. Database permissions

Default production path:

```text
/var/lib/secure-lofi-study-cafe/lofi_cafe.db
```

Directory:

```text
owner: securelofi:securelofi
mode: 0700
```

The database and sidecar files are therefore outside the web root and inaccessible to ordinary local users without permission.

The application never serves the database as a static file.

---

## 9. Persistent server-side sessions

Sessions use the local SQL `sessions` table.

They are not browser-local application identities.

The session store implements:

* get;
* set;
* destroy;
* touch;
* expiration cleanup.

The session ID itself is stored in the browser's HttpOnly cookie.

The application logs only an HMAC-derived correlation reference, not the raw session identifier.

Successful login regenerates the session identifier before privileged session state is attached.

---

## 10. Authentication and administrator provisioning

Passwords use bcrypt cost 12.

Public registration always creates:

```text
role = user
```

The permanent administrator is defined by protected server configuration:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

The server configuration is authoritative.

Changing the configured admin password causes the stored bcrypt value to be synchronized and existing sessions to be invalidated.

This avoids a browser or registration race deciding who becomes administrator.

---

## 11. Server-side authorization

Protected route middleware includes:

```text
requireLogin
requireModerator
requirePermanentAdmin
```

The Security Engineering and Admin Console routes are permanent-admin-only.

The browser hiding a button is not considered an authorization mechanism.

Direct access to a privileged route still reaches the server-side role check.

---

## 12. CSRF and request correlation

State-changing HTTP routes require a session-bound random CSRF token.

Rejected checks generate:

```text
event_type = csrf.validation_failed
severity   = HIGH
outcome    = blocked
```

Each request receives a UUID and an:

```text
X-Request-ID
```

response header.

Security events can therefore be reconstructed by request ID.

---

## 13. Security logging

### security_events

Security telemetry includes:

* registration;
* login success/failure;
* logout;
* rate-limit blocks;
* authentication-required denials;
* moderator/admin denials;
* CSRF failures;
* HTTP request outcomes/duration;
* Socket.IO lifecycle;
* upload validation.

### audit_logs

Application accountability includes:

* chat submission;
* message deletion;
* music moderation;
* queue manipulation;
* privilege changes;
* administrator report export.

Separating detection telemetry from application audit records keeps each data set useful for its intended purpose.

---

## 14. Log data minimization

The application deliberately does not place the following in its SQL event stream:

* plaintext passwords;
* password hashes;
* raw session cookies;
* CSRF tokens;
* browser history;
* precise geolocation;
* unrelated device fingerprint data;
* profile-image binary data.

A keyed session reference enables correlation without recording the actual session credential.

---

## 15. SQL injection controls

Database calls use placeholders.

Example:

```js
await db.get(
  "SELECT id, username, password_hash, role FROM users WHERE username = ?",
  [username]
);
```

User-controlled values are kept out of executable SQL syntax.

The forensic query library is read-oriented and separate from application request input.

---

## 16. XSS controls

Normal EJS output is escaped.

Dynamic live-room values use DOM `textContent`.

The application also sends a Helmet Content Security Policy.

Avatar speech bubbles use server-delivered text rather than HTML interpretation.

---

## 17. File-upload controls

Profile images are restricted to:

* PNG;
* JPEG;
* WebP.

The server verifies:

* declared MIME type;
* binary file signature;
* 512 KB decoded-size limit.

SVG is rejected.

The update requires an authenticated session and CSRF token.

Rejected uploads create security telemetry.

---

## 18. CSV formula-injection defense

Administrator reports may contain user-controlled strings.

Before CSV output, values beginning with formula-significant characters are neutralized.

Covered prefixes include:

```text
=
+
-
@
tab
carriage return
```

This reduces spreadsheet formula execution risk when the CSV is opened in Excel or similar software.

---

## 19. Firewall strategy

For public Caddy deployments:

* allow SSH;
* allow TCP 80;
* allow TCP 443;
* deny TCP 3000.

For Cloudflare Tunnel:

* preserve required administrative access such as SSH;
* no public inbound application port is necessary.

For LAN testing:

* allow TCP 3000 only from the private subnet.

The exact subnet must be verified rather than assumed.

---

## 20. TLS strategy

Caddy can automatically provision and renew public certificates when:

* the hostname resolves to the server;
* ports 80 and 443 reach Caddy;
* Caddy can persist certificate state.

The Node process receives local proxy traffic on loopback.

As an alternative, Cloudflare Tunnel creates an outbound connection so the origin does not require public inbound ports.

---

## 21. Online backups

The backup service uses the SQLite CLI `.backup` operation.

This is preferable to blindly copying a live WAL-mode database file.

Each backup is:

1. created from the live database;
2. checked with `PRAGMA quick_check`;
3. compressed;
4. hashed with SHA-256;
5. permission-restricted;
6. retained according to policy.

Default retention is 30 days.

The systemd timer runs daily with randomized delay.

---

## 22. Restore validation

The restore workflow:

* verifies checksum when available;
* decompresses to a temporary file;
* performs SQLite quick_check;
* requires explicit operator confirmation;
* stops the service;
* saves the pre-restore database;
* removes stale WAL/SHM sidecars;
* restores ownership and permissions;
* restarts the service.

This turns backup into a tested recovery procedure rather than merely producing archive files.

---

## 23. Health monitoring

```text
GET /healthz
```

executes:

```sql
SELECT 1 AS ok
```

Expected:

```json
{"status":"ok","database":"reachable"}
```

The repository also supplies a shell healthcheck suitable for cron, systemd, or manual verification.

---

## 24. Host audit

`deploy/scripts/security-audit.sh` checks:

* service enablement/activity;
* systemd hardening properties;
* TCP listeners;
* secret-file permissions;
* SQLite-file permissions;
* database quick_check;
* WAL mode;
* health endpoint;
* UFW status;
* systemd security analysis.

This provides repeatable evidence that the application is not only secure at the JavaScript layer.

---

## 25. CI validation

GitHub Actions uses Node.js 24 LTS and validates:

* server JavaScript syntax;
* SQLite wrapper syntax;
* session-store syntax;
* frontend/admin JavaScript syntax;
* EJS compilation;
* deployment shell-script syntax;
* schema/table/index creation;
* WAL mode;
* foreign-key enforcement;
* session persistence;
* security-event insertion/query;
* SQLite quick_check;
* query-plan generation;
* production Docker build.

---

## 26. Realtime cross-device acceptance criteria

When both devices connect to the same server:

### User Bunny

Must see:

```text
Role: user
```

Must not see:

```text
Admin Console
Security Engineering
permanent-admin controls
```

### Administrator

Must see Bunny:

* in Members in Room;
* on the Café Floor;
* in chat;
* in relevant audit/security records.

Messages and avatar movement are delivered by the same Socket.IO server process.

This is the acceptance criterion that proves the site is operating as one shared backend rather than two browser-local demonstrations.

---

## 27. Operational security responsibilities

Self-hosting removes the hosting-service bill, but it transfers operational security to the owner.

Required maintenance includes:

* operating-system updates;
* Node.js LTS updates;
* npm dependency review;
* SSH hardening;
* firewall review;
* TLS/tunnel maintenance;
* disk-capacity monitoring;
* backup testing;
* physical security;
* credential rotation;
* incident-log review.

---

## 28. Reference basis

Version 4.0 was cross-referenced against current primary guidance from:

* Node.js release documentation;
* SQLite WAL documentation;
* SQLite online backup documentation;
* Ubuntu UFW/server security documentation;
* Caddy reverse-proxy and automatic HTTPS documentation;
* Cloudflare Tunnel documentation;
* OWASP Logging, Session Management, and File Upload cheat sheets.

See [SELF-HOSTING.md](SELF-HOSTING.md) for operational procedures and source links.

---

## 29. Final v4.0 result

The application no longer requires Railway, Koyeb, Turso, or another application/database host to provide its backend.

The resulting system is:

```text
your Linux host
  |
  +-- hardened systemd service
  +-- Node.js 24 LTS
  +-- Express authentication/RBAC
  +-- Socket.IO realtime communication
  +-- local SQLite WAL database
  +-- SQL sessions
  +-- audit/security event logging
  +-- online backup + verified restore
  +-- health checks
  +-- host-security audit
  +-- optional Caddy HTTPS
  +-- optional outbound Cloudflare Tunnel
```

The machine owner controls the backend data and runtime.
