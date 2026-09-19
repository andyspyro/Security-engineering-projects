# Railway Production Deployment Runbook

## Objective

Deploy the full Secure Lo-Fi Study Cafe backend so desktop and mobile clients share:

* one account database;
* one server-side session store;
* one Socket.IO room;
* one RBAC policy;
* one audit/security telemetry database.

This is the deployment that supports realtime communication between an administrator on one device and users such as `bunny` on another device.

## Repository configuration already included

The repository root contains:

```text
Dockerfile
railway.json
```

The service listens on Railway's injected `PORT` variable and exposes:

```text
GET /healthz
```

for a SQLite-backed readiness check.

## Required Railway service variables

Set:

```text
NODE_ENV=production
SESSION_SECRET=<random 32+ byte secret>
ADMIN_USERNAME=<private permanent-admin username>
ADMIN_PASSWORD=<private password of at least 12 characters>
DB_PATH=/data/lofi_cafe.db
```

Do not reuse the public GitHub Pages showcase password as the production administrator password.

Generate a session secret locally with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Persistent volume

Attach one Railway volume to the web service.

Mount path:

```text
/data
```

The application stores:

```text
/data/lofi_cafe.db
```

on that volume.

The SQLite database contains users, messages, music state, sessions, audit logs, and security telemetry.

## Service source

Use the GitHub repository:

```text
andyspyro/Security-engineering-projects
```

Railway will detect the root `Dockerfile`.

The Dockerfile copies only the Secure Lo-Fi Study Cafe application into the runtime image.

## Public networking

Generate a Railway public domain for the service.

Both the desktop administrator and mobile users must use the same Railway domain.

Do not use the GitHub Pages URL when testing shared accounts or realtime presence.

## Replica count

Use one application replica while this release uses SQLite and in-process room state.

Do not horizontally scale this release.

A future horizontally scaled architecture should move relational data to PostgreSQL and realtime/session coordination to shared infrastructure such as Redis.

## Deployment verification

### Health

Open:

```text
https://<railway-domain>/healthz
```

Expected:

```json
{"status":"ok","database":"reachable"}
```

### Administrator

From a desktop browser:

1. Open the Railway domain.
2. Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
3. Confirm the header shows role `admin`.
4. Confirm **Admin Console** is visible.
5. Confirm **Security Engineering** is visible.

### Normal user

From a phone:

1. Open the same Railway domain.
2. Register `bunny`.
3. Sign in as `bunny`.
4. Confirm the header shows role `user`.
5. Confirm **Admin Console** is absent.
6. Confirm **Security Engineering** is absent.
7. Attempting `/admin` or `/security` directly should return access denial.

### Realtime presence

Keep both devices logged in.

Expected on the administrator device:

* `bunny` appears under Members in Room;
* `bunny` appears on the Café Floor;
* movement updates arrive while bunny walks;
* bunny's live chat messages appear immediately;
* avatar speech bubbles appear above bunny;
* join/chat/session/security events appear in the SQL-backed admin records.

Expected on the phone:

* the administrator appears as another room member;
* live chat sent by the administrator arrives without refresh;
* shared player and presence state come from the same backend.

## Persistence verification

After both users exist:

1. Redeploy the Railway service.
2. Reopen the same domain.
3. Sign in using the same accounts.

Expected:

* accounts still exist;
* audit/security records still exist;
* server-side sessions are backed by SQLite;
* data survives because `/data` is a persistent volume.

## Security checks

The production backend should show:

* secure session cookies behind Railway HTTPS;
* session regeneration after authentication;
* normal registration always creating `user`;
* explicit administrator provisioning;
* CSRF rejection logging;
* authorization-denial logging;
* login success/failure telemetry;
* Socket.IO lifecycle telemetry;
* SQLite security-event indexes;
* CSV formula-injection protection;
* profile-image signature/type/size validation.

## Important distinction

GitHub Pages is retained only as a static interface showcase.

The Railway domain is the real multi-user application.
