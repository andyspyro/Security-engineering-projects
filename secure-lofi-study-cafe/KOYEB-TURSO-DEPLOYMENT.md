# Free Deployment Runbook — Koyeb + Turso

## Goal

Run the full Secure Lo-Fi Study Cafe backend without relying on browser-local accounts or a paid persistent volume.

The deployment uses:

```text
Koyeb Free Web Service
        |
        | Node.js / Express / Socket.IO
        v
Turso Free Database
        |
        +-- users
        +-- sessions
        +-- messages
        +-- music_requests
        +-- music_queue
        +-- audit_logs
        +-- security_events
```

Both desktop and mobile users connect to the same Koyeb URL and therefore share the same authentication database, sessions, room presence, chat, moderation state, and security logs.

---

## 1. Create the Turso database

Create a Turso account and a database for the application.

The application needs two values:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

Turso's CLI can return them with:

```bash
turso db show --url <database-name>
turso db tokens create <database-name>
```

Do not commit either value to GitHub.

The application creates its required tables and indexes automatically when it starts.

---

## 2. Create the Koyeb service

In Koyeb:

1. Create a Web Service.
2. Choose GitHub as the source.
3. Select `andyspyro/Security-engineering-projects`.
4. Select branch `main`.
5. Choose the Dockerfile builder.
6. Use the repository-root `Dockerfile`.
7. Select the Free instance.
8. Expose the HTTP port Koyeb assigns through its `PORT` environment variable.
9. Use one instance.

The root Dockerfile copies and runs only the Secure Lo-Fi Study Cafe application.

---

## 3. Configure Koyeb environment variables

Add:

```text
NODE_ENV=production
SESSION_SECRET=<strong random secret>
ADMIN_USERNAME=<private permanent-admin username>
ADMIN_PASSWORD=<private password, minimum 12 characters>
TURSO_DATABASE_URL=<Turso database URL>
TURSO_AUTH_TOKEN=<Turso database token>
```

Koyeb supplies `PORT` automatically.

Generate a session secret locally with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not reuse the public GitHub Pages showcase password for the real administrator account.

---

## 4. No persistent Koyeb volume is required

The free Koyeb instance does not need local persistent storage.

Persistent application state lives in Turso instead:

* users;
* password hashes;
* sessions;
* chat records;
* moderation evidence;
* media requests;
* audit events;
* security telemetry.

Koyeb can restart or scale the service to zero without deleting the application's database.

Realtime in-memory state such as current avatar positions is intentionally transient.

---

## 5. Health check

Configure the Koyeb service health check to:

```text
/healthz
```

The endpoint performs a real database query:

```sql
SELECT 1 AS ok
```

Expected response:

```json
{"status":"ok","database":"reachable"}
```

---

## 6. Cross-device verification

### Computer — permanent administrator

1. Open the Koyeb public URL.
2. Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
3. Confirm the account shows `Role: admin`.
4. Confirm **Admin Console** is visible.
5. Confirm **Security Engineering** is visible.

### Phone — normal user

1. Open the same Koyeb URL.
2. Register `bunny`.
3. Sign in as `bunny`.
4. Confirm the account shows `Role: user`.
5. Confirm **Admin Console** is absent.
6. Confirm **Security Engineering** is absent.

### Realtime test

Keep both devices connected.

Expected:

* admin sees bunny appear in **Members in Room**;
* admin sees bunny's avatar on the **Café Floor**;
* bunny sees admin;
* chat messages arrive on both devices;
* avatar speech bubbles show the server-delivered chat text;
* movement updates are synchronized through Socket.IO;
* administrator-only routes remain inaccessible to bunny;
* SQL logs record authentication, sessions, chat, moderation, and security events.

---

## 7. Database persistence verification

After creating users and generating activity:

1. Redeploy or restart the Koyeb service.
2. Reopen the same public URL.
3. Sign in again.

Expected:

* users remain;
* sessions and account data remain in Turso;
* audit records remain;
* security events remain;
* chat/moderation history remains.

No Koyeb filesystem persistence is required.

---

## 8. Local development

The same database wrapper supports a local libSQL file.

Set:

```text
TURSO_DATABASE_URL=file:lofi_cafe.db
```

Leave `TURSO_AUTH_TOKEN` empty.

Then:

```bash
npm install
npm start
```

This keeps local development SQLite-compatible while production uses the shared Turso database.

---

## 9. Security boundary

GitHub Pages remains only a static interface showcase.

The Koyeb service is the real application security boundary because it performs:

* bcrypt authentication;
* session creation and regeneration;
* CSRF checks;
* permanent-admin RBAC;
* moderator RBAC;
* rate limiting;
* parameterized SQL;
* upload validation;
* audit logging;
* structured security-event logging;
* Socket.IO authentication.

Turso is the shared persistence layer.

---

## 10. Free-tier behavior

Koyeb's Free instance may scale to zero after inactivity. The first request after sleeping can therefore take longer while the service wakes.

Turso stores the persistent SQL data independently of that Koyeb lifecycle.

For this project, that is preferable to storing SQLite on the free web server's ephemeral filesystem.
