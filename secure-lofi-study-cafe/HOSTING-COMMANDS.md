# Secure Lo-Fi Study Cafe — Hosting Commands

## Temporary public test from WSL

Use this when you want the real backend online immediately with a temporary public URL:

```bash
cd ~/Security-engineering-projects
git pull
cd secure-lofi-study-cafe
bash deploy/scripts/start-free-public-test.sh
```

That script starts the Node.js/Express/Socket.IO backend, local SQLite database, and a Cloudflare Quick Tunnel. It prints a temporary `https://...trycloudflare.com` URL. Keep the terminal open while using that URL.

## The actual backend start command

If a host asks for a **Start Command**, use:

```text
npm start
```

The package maps that to:

```text
node server.js
```

The process must receive the production environment variables shown in `.env.example`. Do not put real secrets in GitHub.

## Recommended permanent self-hosted Linux service

Install/update the service:

```bash
cd ~/Security-engineering-projects
git pull
cd secure-lofi-study-cafe
sudo bash deploy/scripts/install-self-hosted.sh
```

Start it:

```bash
sudo systemctl start secure-lofi-study-cafe
```

Enable it at boot and start immediately:

```bash
sudo systemctl enable --now secure-lofi-study-cafe
```

Restart after an application/configuration update:

```bash
sudo systemctl restart secure-lofi-study-cafe
```

Stop:

```bash
sudo systemctl stop secure-lofi-study-cafe
```

Status:

```bash
sudo systemctl status secure-lofi-study-cafe
```

Live logs:

```bash
sudo journalctl -u secure-lofi-study-cafe -f
```

## Production process configuration

For a public deployment behind Caddy or Cloudflare Tunnel, use values equivalent to:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=true
COOKIE_SECURE=true
DB_PATH=/var/lib/secure-lofi-study-cafe/lofi_cafe.db
PUBLIC_ORIGIN=https://your-real-domain.example
SESSION_SECRET=<random secret>
ADMIN_USERNAME=<private admin username>
ADMIN_PASSWORD=<private strong password>
```

The Node process should normally stay on `127.0.0.1:3000`. Put HTTPS/WSS in front of it with Caddy or a Cloudflare Tunnel rather than exposing port 3000 directly.

See `SELF-HOSTING.md` for the full hardened deployment procedure.