# Start Secure Lo-Fi Right Now — Free Public Test

This is the shortest path from the GitHub repository to a real public multi-device test.

It runs the actual Node.js / Express / Socket.IO backend and the actual SQLite database on your computer, then exposes that local server through a temporary Cloudflare Quick Tunnel.

No browser-local fake users are used by the real application.

## What this gives you

```text
Admin computer ─────┐
                    │ HTTPS / WSS
Bunny phone ────────┤
                    ▼
*.trycloudflare.com
                    │
                    ▼
Cloudflare Quick Tunnel
                    │
                    ▼
127.0.0.1:3000
Node / Express / Socket.IO
                    │
                    ▼
data/lofi_cafe.db
```

Both devices must use the same generated `https://...trycloudflare.com` URL.

## Requirements

* WSL/Linux shell
* Internet access

The launcher now bootstraps missing runtime dependencies automatically:

* Node.js 24 LTS through nvm;
* npm with Node.js;
* a user-local `cloudflared` binary for the public tunnel.

If Node.js 24 is already installed, the launcher reuses it.

## One-command launcher

From the repository:

```bash
cd Security-engineering-projects/secure-lofi-study-cafe
bash deploy/scripts/start-free-public-test.sh
```

The launcher will:

1. install/activate Node.js 24 LTS with nvm when necessary;
2. install a user-local Cloudflare Tunnel client when necessary;
3. install npm dependencies if needed;
4. create the local persistent data directory;
5. securely prompt for the permanent-admin username/password;
6. generate a random session secret;
7. start the real backend on localhost;
8. wait for the database-aware healthcheck;
9. start a free Cloudflare Quick Tunnel;
10. print the public HTTPS URL.

The password is entered without terminal echo and is not written to GitHub.

## Test

Computer:

```text
Open generated URL
log in as Admin
keep the café open
```

Phone:

```text
Open THE SAME generated URL
register bunny
log in
```

Expected without refreshing Admin:

* Bunny appears in Members in Room.
* Bunny appears on the Café Floor.
* Bunny has role `user`.
* Bunny has no Admin Console.
* Bunny has no Security Engineering link.
* Bunny chat appears on Admin immediately.
* Admin chat appears on Bunny immediately.

## Important limitation

Cloudflare explicitly classifies Quick Tunnels as testing/development infrastructure. The hostname is random and changes when the tunnel restarts.

This launcher is for immediate cross-device verification.

For a stable public production URL, follow [SELF-HOSTING.md](SELF-HOSTING.md) and configure either:

* a named Cloudflare Tunnel with your domain; or
* Caddy with HTTPS and your domain.

The backend/application code is the same.
