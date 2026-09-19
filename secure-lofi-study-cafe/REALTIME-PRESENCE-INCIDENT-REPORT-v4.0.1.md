# Secure Lo-Fi Study Cafe
## Realtime Presence Incident Report — v4.0.1

### Incident

An administrator on one device could not see a newly registered normal user on another mobile device.

### Root cause

The affected users were opening the GitHub Pages build.

GitHub Pages is a static file host. The previous preview stored account/session state in each browser's local storage. That means:

```text
Admin browser localStorage
        X
Friend phone localStorage
```

There was no common Node.js process, session store, SQLite database, or Socket.IO room connecting the two browsers.

The application UI looked like a realtime room, but a browser-local static build cannot provide shared presence.

### Correct architecture

Realtime presence requires both devices to use the same self-hosted Node.js URL:

```text
Admin browser ─────┐
                   │
                   v
             Node.js server
             Express session
             Socket.IO room
             SQLite database
                   ^
                   │
Friend phone ──────┘
```

### Code changes

#### 1. Engine.IO now shares the Express session middleware

The Socket.IO transport layer now runs through the same Express session middleware used by HTTP.

This ensures the WebSocket/polling connection resolves the same authenticated server-side identity.

#### 2. Authoritative room snapshot

The server now builds an authoritative room snapshot containing:

* current online members;
* player state;
* vote state;
* controller state;
* pending moderator requests when authorized;
* server timestamp.

Each newly connected client receives a `room:snapshot`.

#### 3. Explicit reconnect synchronization

The browser now requests `room:sync-request` after every Socket.IO connection/reconnection.

The server responds with a fresh authoritative snapshot.

This prevents the browser from relying only on an event that may have occurred while the device was offline or switching networks.

#### 4. Presence remains server-authoritative

On connection:

1. the socket's authenticated session identifies the user;
2. the user is added to the server's `onlineUsers` map;
3. `presence:update` is emitted to every connected client;
4. each browser re-renders Members in Room and the Café Floor.

On disconnect:

1. the socket ID is removed;
2. a user is removed only after their final active socket disconnects;
3. the updated presence set is broadcast to the remaining room.

This supports the same account having more than one browser tab/socket without falsely marking the user offline.

#### 5. Static GitHub Pages behavior corrected

GitHub Pages no longer allows browser-local signup to look like a real shared account system.

The static build now:

* does not create normal-user registrations;
* does not accept normal-user local logins;
* removes fake remote members;
* removes fake realtime chat entries;
* labels the room as a static preview;
* explains that shared registration belongs on the live self-hosted server.

The showcase administrator remains available only for inspecting the interface.

### Automated proof

A new CI integration test starts a real application server with a disposable SQLite database.

It creates two independent authenticated browser-equivalent sessions:

```text
admin
bunny
```

The test verifies:

1. administrator login succeeds;
2. bunny registration/login succeeds;
3. admin opens a Socket.IO connection;
4. bunny opens a separate Socket.IO connection;
5. admin receives a presence update containing bunny;
6. bunny receives a room snapshot containing admin and bunny;
7. bunny sends `hello from bunny`;
8. admin receives the realtime chat event;
9. bunny receives HTTP 403 for `/admin`;
10. admin receives HTTP 200 for `/admin`;
11. bunny disconnects;
12. admin receives a presence update showing bunny removed.

The CI test is:

```text
scripts/realtime-presence-test.js
```

Run manually with:

```bash
npm run test:realtime
```

### Acceptance criteria

The issue is fixed only when both people open the same self-hosted server origin.

Expected:

```text
Admin computer:
  Role: admin
  Members in Room:
    admin
    bunny

Friend phone:
  Role: user
  Members in Room:
    admin
    bunny
```

A chat message sent by bunny must appear on admin's browser without reload.

Avatar movement must propagate through Socket.IO.

If one device uses `andyspyro.github.io` while another uses the self-hosted server URL, they are not in the same room.

### Operational verification

On the server:

```bash
sudo journalctl -u secure-lofi-study-cafe -f
```

The security event table can confirm Socket.IO lifecycle events:

```sql
SELECT
    created_at,
    event_type,
    username_snapshot,
    outcome
FROM security_events
WHERE event_type IN ('socket.connected', 'socket.disconnected')
ORDER BY created_at DESC
LIMIT 50;
```

The administrator can also inspect current room membership directly in the application.

### Final result

The realtime implementation is now server-authoritative, reconnect-safe, independently integration-tested, and no longer conflated with the static GitHub Pages preview.
