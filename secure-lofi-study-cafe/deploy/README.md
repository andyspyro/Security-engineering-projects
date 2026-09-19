# Self-host deployment assets

This directory contains the operating-system side of Secure Lo-Fi Study Cafe v4.0.

## Layout

```text
deploy/
├── caddy/
│   └── Caddyfile.example
├── cloudflare/
│   └── config.yml.example
├── scripts/
│   ├── install-self-hosted.sh
│   ├── backup-sqlite.sh
│   ├── restore-sqlite.sh
│   ├── healthcheck.sh
│   └── security-audit.sh
└── systemd/
    ├── secure-lofi-study-cafe.service
    ├── secure-lofi-backup.service
    └── secure-lofi-backup.timer
```

## Security intent

The Node process is not designed to run as root.

The hardened systemd unit:

* runs as the dedicated `securelofi` account;
* denies privilege escalation;
* makes the operating-system filesystem read-only to the process except for the application database directory;
* hides home directories;
* isolates temporary files and devices;
* blocks kernel/module/control-group modification;
* drops Linux capabilities;
* restricts available address families.

The recommended public architecture keeps Node bound to `127.0.0.1:3000` and uses either Caddy or Cloudflare Tunnel as the ingress layer.

See [../SELF-HOSTING.md](../SELF-HOSTING.md) for the complete deployment procedure.
