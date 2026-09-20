# Secure Lo-Fi Study Cafe
## Responsive Watch Together & Social UX — v6.0.0

### Release objective

Version 6 turns the product shell into device-specific experiences instead of treating phones as narrow desktop windows.

The backend remains authoritative for authentication, RBAC, room membership, presence, messages, reactions, replies, media queue state, and shared playback.

Harmless interface preferences such as theme, notification preference, and collapsed mini-player state may use browser storage.

---

## Device architecture

### Mobile

Phones use a compact sticky header and bottom navigation:

```text
Room | Chat | Music | Profile | Admin (authorized only)
```

Only the selected primary view is shown.

The design avoids rendering the full desktop shell as one long vertical stack. Touch targets are enlarged, content density is reduced, and the chat composer accounts for the bottom safe-area/navigation region.

### Tablet

Tablets use a two-pane shell:

```text
Main room / activity  |  Watch Together + members + chat
```

Profile/navigation cards become a compact horizontally scrollable strip instead of consuming a permanent desktop sidebar.

### Desktop

Desktop keeps the full three-zone shell:

```text
Left rail        Main experience          Right rail
navigation       Café Floor               Watch Together
profile/status   room activity            members
focus tools      music management         realtime chat
connection
```

---

## Responsive implementation

The application uses both viewport media queries and component-level container queries.

Container query contexts are defined for:

* Watch Together;
* music panel;
* member panel.

This lets controls respond to the space a component actually receives rather than relying only on the overall browser width.

The app avoids horizontal page scrolling. Tables in the separate administrator console remain locally scrollable when their forensic data set requires many columns.

---

## Watch Together

The YouTube player now lives intentionally with realtime communication rather than appearing as an unrelated media widget.

The right-side communication experience contains:

* pinned shared player;
* currently playing title;
* requester;
* controller/sync state;
* progress bar;
* elapsed/duration readout;
* queue preview;
* Sync;
* Vote Next;
* permission-gated moderator Next;
* mobile mini-player mode.

The same server-authoritative player model continues to own:

```text
video ID
current track
play / pause state
current seconds
controller user
queue
vote state
room synchronization
```

The YouTube IFrame API uses `playsinline=1`.

If a browser blocks scripted autoplay, the interface exposes a clear user-gesture button instead of silently failing playback.

---

## Realtime chat

Version 6 adds richer shared communication while keeping writes server-controlled.

### Typing

`chat:typing` is ephemeral Socket.IO state.

The server derives the user identity from the authenticated session and rate-limits typing event frequency per socket.

Typing state is not persisted in SQLite.

### Replies

Messages may reference:

```text
reply_to_message_id
```

The server validates that the referenced message exists in the same room and has not been deleted.

The relation is persisted and survives reload/restart.

### Emoji reactions

Persistent reaction data is stored in:

```text
message_reactions
```

with a composite key of:

```text
message_id + user_id + emoji
```

Supported reactions are an explicit server allowlist.

Repeated selection toggles the reaction rather than generating duplicate rows.

### Mentions and unread state

The UI recognizes `@username` mentions after the server-authoritative chat message arrives.

Mention highlighting and unread badges are presentation behavior.

Optional browser notifications require explicit browser/user permission.

---

## Focus tools

The Profile view includes a lightweight Pomodoro timer:

* 25-minute focus;
* 5-minute break;
* start/pause;
* reset;
* mode switch;
* optional completion notification.

The timer is deliberately a local productivity preference and does not become shared authoritative room state.

---

## Themes and preferences

Local UI preferences include:

* Espresso;
* Midnight;
* Plum Night;
* room notification preference;
* collapsed Watch Together mini-player state.

These are safe uses of localStorage because another user's browser does not need to trust or synchronize them.

---

## Animation and ambience

Version 6 adds:

* remote avatar interpolation;
* subtle avatar idle motion;
* walking motion;
* presence pulse;
* ambient café glow;
* message entry transitions;
* join/leave banners;
* toast feedback;
* skeleton member loading;
* reconnect feedback;
* reaction/tap/hover feedback;
* media progress animation.

`prefers-reduced-motion: reduce` disables or minimizes nonessential movement.

---

## Accessibility

The responsive redesign includes:

* 44–48 px mobile interaction targets;
* semantic navigation;
* focus-visible styles;
* accessible dialog close controls;
* screen-reader live regions;
* viewport safe-area handling;
* no required hover interaction;
* touch-friendly avatar movement;
* reduced-motion support;
* readable mobile typography and vertical rhythm.

---

## Administrator control plane

The permanent-admin console remains a separate server-authorized mode.

Version 6 adds an admin-only realtime operations stream.

Admin sockets join:

```text
admin:ops
```

only after the backend confirms the persisted account role is `admin`.

Live operations display:

* realtime online-user count;
* live socket count;
* admin round-trip latency;
* connection events;
* disconnect events;
* chat activity;
* reaction activity.

The existing inspector continues to expose intentionally collected network/client metadata such as IP address and user-agent while withholding raw cookies, passwords, password hashes, tokens, and CSRF secrets.

---

## Persistent schema additions

Version 6 adds:

```text
messages.reply_to_message_id
message_reactions
user_profiles.availability_status
```

Availability supports:

```text
studying
chat
dnd
afk
listening
watching
```

---

## Realtime security

New realtime interactions preserve the existing security model:

```text
browser action
   -> authenticated Socket.IO session
   -> server resolves identity
   -> CSRF check when state changes
   -> input / allowlist validation
   -> SQLite write when persistence is required
   -> authoritative broadcast
```

Clients do not choose their own user ID or role.

---

## Validation

CI validates:

* JavaScript syntax;
* EJS template compilation;
* database migrations/schema/indexes;
* Socket.IO presence;
* RBAC;
* movement deltas;
* availability synchronization;
* typing events;
* chat replies;
* persistent reactions;
* admin-only live operations events;
* reconnect/logout behavior;
* persistence across server restart;
* production Docker build.

A final visual/touch acceptance pass still needs to be performed on actual phone/tablet/browser combinations after the host is restarted on v6.

---

## Known limits

The self-hosted architecture still intentionally runs a single Node process with local SQLite and in-process Socket.IO presence.

Horizontal multi-instance scaling would require a shared Socket.IO adapter/broker and database architecture appropriate for multiple application processes.

Browser autoplay policies remain outside application control; v6 handles this with an explicit user-gesture recovery path.
