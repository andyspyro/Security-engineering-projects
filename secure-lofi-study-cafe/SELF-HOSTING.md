# Secure Lo-Fi Study Cafe v4.0 — Self-Hosting Runbook

## Objective

Version 4.0 is designed to run on infrastructure you control.

A single Linux server owns:

* the Node.js / Express backend;
* Socket.IO realtime communication;
* the SQLite database;
* server-side sessions;
* audit logs;
* security telemetry;
* administrator authorization;
* backups.

Both the administrator computer and normal-user phones connect to that same server.

```text
Admin computer ─────┐
                    │
                    v
              HTTPS / LAN
                    │
                    v
        Your Linux server
        ┌─────────────────────┐
        │ Caddy or tunnel     │  optional public edge
        │        │            │
        │        v            │
        │ Node.js :3000       │
        │ Express + Socket.IO │
        │        │            │
        │        v            │
        │ SQLite              │
        └─────────────────────┘
                    ^
                    │
Bunny's phone ──────┘
```

This is a true shared backend. Accounts are not stored independently in each browser.

---

## 1. Recommended host

Recommended:

* an old laptop, desktop, mini PC, or small Linux server;
* Ubuntu Server or Debian;
* wired Ethernet when practical;
* a machine that can stay powered on;
* disk encryption when the server contains sensitive data;
* automatic operating-system security updates.

WSL is fine for local development and same-machine testing, but it is not the preferred always-on server because Windows sleep, WSL lifecycle, and NAT behavior can interrupt inbound access.

### Node.js version

Use Node.js **24 LTS**.

Do not deploy this project on Node.js 20; Node.js 20 is end-of-life.

Verify:

```bash
node --version
npm --version
```

The project declares:

```json
"engines": {
  "node": ">=24 <27"
}
```

---

## 2. Clone the repository

On the Linux server:

```bash
git clone https://github.com/andyspyro/Security-engineering-projects.git
cd Security-engineering-projects/secure-lofi-study-cafe
```

Review the installer before running it:

```bash
less deploy/scripts/install-self-hosted.sh
```

Then:

```bash
sudo bash deploy/scripts/install-self-hosted.sh
```

The installer:

1. verifies Node.js and npm;
2. installs Linux prerequisites on Debian/Ubuntu;
3. creates a dedicated non-login service account named `securelofi`;
4. copies application code to `/opt/secure-lofi-study-cafe`;
5. installs production Node dependencies;
6. creates the protected data directory;
7. creates the protected configuration directory;
8. prompts for the permanent-admin account;
9. generates a random 256-bit session secret;
10. installs the hardened systemd service;
11. installs the daily database-backup timer;
12. starts the application;
13. runs the local healthcheck.

The installer deliberately does not write the administrator password to the Git repository.

---

## 3. Filesystem layout

```text
/opt/secure-lofi-study-cafe/
    application code
    node_modules/
    deploy/

/etc/secure-lofi-study-cafe/
    secure-lofi.env

/var/lib/secure-lofi-study-cafe/
    lofi_cafe.db
    lofi_cafe.db-wal
    lofi_cafe.db-shm

/var/backups/secure-lofi-study-cafe/
    secure-lofi-YYYYMMDDTHHMMSSZ.db.gz
    secure-lofi-YYYYMMDDTHHMMSSZ.db.gz.sha256
```

### Permission model

Application source:

```text
root:root
read-only to the application service
```

Database directory:

```text
securelofi:securelofi
mode 0700
```

Environment/secrets file:

```text
root:root
mode 0600
```

The Node process runs as `securelofi`, not root.

---

## 4. Runtime configuration

Production configuration is stored outside the Git repository:

```text
/etc/secure-lofi-study-cafe/secure-lofi.env
```

Example:

```text
NODE_ENV="production"
HOST="127.0.0.1"
PORT="3000"
TRUST_PROXY="true"
COOKIE_SECURE="true"
DB_PATH="/var/lib/secure-lofi-study-cafe/lofi_cafe.db"
SESSION_SECRET="<random secret>"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="<private strong password>"
```

### Why the binding matters

For a public deployment behind Caddy or Cloudflare Tunnel:

```text
HOST=127.0.0.1
```

Node can then be reached only from the server itself. Port 3000 is not the public Internet edge.

For LAN-only testing:

```text
HOST=0.0.0.0
TRUST_PROXY=false
COOKIE_SECURE=false
```

Then restrict TCP 3000 with the host firewall to your private network.

---

## 5. systemd service security

The supplied unit is:

```text
deploy/systemd/secure-lofi-study-cafe.service
```

Important controls include:

```ini
User=securelofi
Group=securelofi
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
ReadWritePaths=/var/lib/secure-lofi-study-cafe
```

The service can read the application but cannot modify it.

Its persistent write access is restricted to the database directory.

### Service commands

Status:

```bash
sudo systemctl status secure-lofi-study-cafe
```

Live logs:

```bash
sudo journalctl -u secure-lofi-study-cafe -f
```

Recent logs:

```bash
sudo journalctl -u secure-lofi-study-cafe -n 100 --no-pager
```

Restart:

```bash
sudo systemctl restart secure-lofi-study-cafe
```

---

## 6. LAN-only mode

LAN-only is the simplest real multi-device test.

Choose LAN mode in the installer.

The application listens on:

```text
0.0.0.0:3000
```

Find the server's private IP:

```bash
hostname -I
```

Example:

```text
192.168.1.50
```

The administrator computer and phone then use:

```text
http://192.168.1.50:3000
```

### Firewall

Before enabling UFW, preserve remote SSH access if you administer the host over SSH:

```bash
sudo ufw allow OpenSSH
```

Determine the actual LAN subnet before creating a rule.

Example only:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
sudo ufw enable
sudo ufw status verbose
```

Do not blindly copy `192.168.1.0/24` if your network uses a different subnet.

LAN HTTP is appropriate for a controlled local lab. Do not publish plaintext port 3000 to the Internet.

---

## 7. Public mode A — Caddy HTTPS

Use this when:

* you own a domain;
* your ISP/router allows inbound connections;
* you are comfortable forwarding TCP 80 and 443;
* you want the reverse proxy and TLS termination to live on your server.

Application settings:

```text
HOST=127.0.0.1
TRUST_PROXY=true
COOKIE_SECURE=true
```

The included example is:

```text
deploy/caddy/Caddyfile.example
```

Basic configuration:

```caddyfile
cafe.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Caddy supports WebSocket proxying through `reverse_proxy`, so Socket.IO can use the same HTTPS origin.

With a valid public DNS name pointing to the server and TCP 80/443 reachable, Caddy can automatically obtain and renew public TLS certificates.

### Firewall

Allow SSH before enabling UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3000/tcp
sudo ufw enable
sudo ufw status verbose
```

The router should forward only 80/443 to the server.

Do not forward 3000.

---

## 8. Public mode B — Cloudflare Tunnel

Use this when:

* you do not want to forward router ports;
* the ISP uses CGNAT;
* you want the origin server to make only outbound connections.

Application settings remain:

```text
HOST=127.0.0.1
TRUST_PROXY=true
COOKIE_SECURE=true
```

Example tunnel configuration:

```text
deploy/cloudflare/config.yml.example
```

Traffic path:

```text
Browser
  |
  v
Cloudflare HTTPS edge
  |
  v
outbound Cloudflare Tunnel
  |
  v
127.0.0.1:3000
```

No inbound application port needs to be opened on the home router.

This does use Cloudflare as the public ingress provider, but the application backend, account database, sessions, logs, and administrator controls remain on your own server.

---

## 9. SQLite design

The production database is local to the server.

Version 4.0 enables:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

WAL mode lets readers continue while a writer appends committed changes and is suitable for this single-host application.

The database is not placed on NFS, SMB, or another network filesystem.

### Persistent tables

```text
users
messages
music_requests
music_queue
sessions
audit_logs
security_events
```

### Security indexes

```text
idx_sessions_expires_at
idx_security_events_created_at
idx_security_events_type
idx_security_events_actor
idx_security_events_severity_outcome
idx_audit_logs_created_at
idx_messages_user_created
```

---

## 10. Backups

A self-hosted server is responsible for its own data durability.

The installer enables:

```text
secure-lofi-backup.timer
```

Check the timer:

```bash
systemctl list-timers secure-lofi-backup.timer
```

Run a backup manually:

```bash
sudo -u securelofi \
  /opt/secure-lofi-study-cafe/deploy/scripts/backup-sqlite.sh
```

The script uses SQLite's online `.backup` operation rather than copying the active database file blindly.

It then:

1. runs `PRAGMA quick_check` against the backup;
2. compresses it;
3. creates a SHA-256 checksum;
4. restricts permissions;
5. removes backups older than the configured retention period.

Default retention:

```text
30 days
```

A backup stored only on the same physical disk is not enough for disaster recovery. Periodically copy encrypted backups to a second device or offline storage.

---

## 11. Restore procedure

List backups:

```bash
sudo ls -lh /var/backups/secure-lofi-study-cafe/
```

Restore:

```bash
sudo /opt/secure-lofi-study-cafe/deploy/scripts/restore-sqlite.sh \
  /var/backups/secure-lofi-study-cafe/secure-lofi-YYYYMMDDTHHMMSSZ.db.gz
```

The restore script:

1. checks the SHA-256 file when present;
2. decompresses to a temporary file;
3. runs `PRAGMA quick_check`;
4. requires an explicit `RESTORE` confirmation;
5. stops the application;
6. preserves the previous database;
7. removes stale WAL/SHM sidecars;
8. installs the verified backup with restricted ownership;
9. starts the service again.

---

## 12. Health and host-security verification

Application health:

```bash
/opt/secure-lofi-study-cafe/deploy/scripts/healthcheck.sh
```

Expected:

```text
{"status":"ok","database":"reachable"}
```

Run the host security audit:

```bash
sudo /opt/secure-lofi-study-cafe/deploy/scripts/security-audit.sh
```

It checks:

* systemd service state;
* service user;
* hardening properties;
* TCP listeners;
* environment-file permissions;
* database permissions;
* SQLite integrity;
* WAL mode;
* local health;
* UFW status;
* `systemd-analyze security` output.

---

## 13. Security logging

Two SQL data sets intentionally serve different purposes.

### audit_logs

Answers accountability questions:

* Who sent the message?
* Who deleted it?
* Who approved music?
* Who changed queue state?
* Who granted temporary privilege?
* Who downloaded an administrator report?

### security_events

Answers detection/incident questions:

* Which logins failed?
* Which login succeeded?
* Which CSRF requests were blocked?
* Which authorization checks failed?
* Which HTTP request produced a 4xx/5xx?
* Which session reference was involved?
* When did a Socket.IO client connect or disconnect?
* Which profile-image payloads were rejected?

The database does not log plaintext passwords, password hashes, raw session IDs, CSRF tokens, browser history, or precise location.

---

## 14. Forensic SQL

Run the investigation library against the live database:

```bash
sudo -u securelofi sqlite3 \
  /var/lib/secure-lofi-study-cafe/lofi_cafe.db \
  < /opt/secure-lofi-study-cafe/sql/security-forensics.sql
```

For interactive investigation:

```bash
sudo -u securelofi sqlite3 \
  /var/lib/secure-lofi-study-cafe/lofi_cafe.db
```

Useful commands:

```sql
.headers on
.mode column

SELECT created_at, event_type, severity, outcome, username_snapshot
FROM security_events
ORDER BY created_at DESC
LIMIT 25;
```

---

## 15. Administrator credential rotation

Edit:

```bash
sudoedit /etc/secure-lofi-study-cafe/secure-lofi.env
```

Change `ADMIN_PASSWORD`.

Then:

```bash
sudo systemctl restart secure-lofi-study-cafe
```

At startup, the configured administrator credentials are authoritative.

If the configured password changed, the application updates the bcrypt hash and invalidates stored sessions.

---

## 16. Updating the application

From the Git clone:

```bash
git pull
cd secure-lofi-study-cafe
sudo bash deploy/scripts/install-self-hosted.sh
```

The installer preserves the existing environment file.

Before a major update:

```bash
sudo -u securelofi \
  /opt/secure-lofi-study-cafe/deploy/scripts/backup-sqlite.sh
```

After updating:

```bash
sudo systemctl status secure-lofi-study-cafe
/opt/secure-lofi-study-cafe/deploy/scripts/healthcheck.sh
```

---

## 17. Cross-device acceptance test

### Administrator computer

1. Open the server URL.
2. Sign in with the configured permanent-admin account.
3. Confirm `Role: admin`.
4. Confirm **Admin Console**.
5. Confirm **Security Engineering**.

### Phone

1. Open the exact same server URL.
2. Register `bunny`.
3. Sign in.
4. Confirm `Role: user`.
5. Confirm no Admin Console.
6. Confirm no Security Engineering.

### Realtime test

Keep both browsers open.

Expected on the administrator computer:

* Bunny appears in Members in Room.
* Bunny appears on the Café Floor.
* Bunny movement updates arrive.
* Bunny chat arrives immediately.
* Bunny's speech bubble appears.
* account/chat/socket/security events become visible in admin logging.

Expected on the phone:

* the administrator appears as another online member;
* administrator chat appears immediately;
* shared player/presence state comes from the same backend;
* direct attempts to access permanent-admin routes are denied.

---

## 18. Incident-response checklist

If suspicious activity appears:

1. Do not delete the SQLite database.
2. Record the current UTC time.
3. Export the administrator CSV report.
4. Run a verified SQLite backup.
5. Preserve relevant `journalctl` output.
6. Review `security_events` by request ID/session reference.
7. Review `audit_logs` for privileged actions.
8. Review UFW/Caddy/Cloudflare logs when applicable.
9. Rotate the administrator password if credential compromise is suspected.
10. Restart the service after credential rotation so sessions are invalidated.
11. Patch the host and application before restoring public access.

---

## 19. Threat boundary

This design protects against several common application/host mistakes, but self-hosting means the server owner is responsible for the operating system.

You are responsible for:

* installing security updates;
* securing SSH;
* limiting firewall exposure;
* maintaining the domain/TLS or tunnel configuration;
* protecting physical access;
* monitoring disk capacity;
* testing backups;
* rotating credentials;
* reviewing security logs.

Do not expose an unpatched personal workstation directly to the Internet merely to make the portfolio application public.

A dedicated Linux host plus Caddy or an outbound tunnel is the preferred architecture.

---

## 20. Primary references

The v4.0 design was cross-checked against:

* Node.js release guidance  
  https://nodejs.org/en/about/previous-releases
* SQLite WAL documentation  
  https://www.sqlite.org/wal.html
* SQLite online backup documentation  
  https://www.sqlite.org/backup.html
* Ubuntu UFW documentation  
  https://ubuntu.com/server/docs/how-to/security/firewalls/
* Ubuntu server security suggestions  
  https://ubuntu.com/server/docs/explanation/security/security_suggestions/
* Caddy reverse-proxy documentation  
  https://caddyserver.com/docs/quick-starts/reverse-proxy
* Caddy automatic HTTPS documentation  
  https://caddyserver.com/docs/automatic-https
* Cloudflare Tunnel documentation  
  https://developers.cloudflare.com/tunnel/
* OWASP Logging Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
* OWASP Session Management Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
* OWASP File Upload Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
