# Secure Lo Fi Study Cafe

> **Type:** Full stack secure web application  
> **Stack:** Node.js, Express, SQLite, EJS, Socket.IO  
> **Status:** Runnable full-stack app with a GitHub Pages UI demo

I built this as a study room app where people can sign in, chat, request music, and share a synchronized player. I also wanted the security controls to be part of the app itself instead of something I added at the end.

## Live UI demo

**GitHub Pages:** https://andyspyro.github.io/Security-engineering-projects/secure-lofi-study-cafe/

The Pages build is a safe static demonstration of the actual interface. GitHub Pages cannot run the Node.js server, SQLite database, sessions, or Socket.IO backend, so the security and real-time controls are demonstrated by the full application source below rather than faked as production security in the static preview.

## Run the full application locally

```bash
cd secure-lofi-study-cafe
npm install
cp .env.example .env
```

Replace the example `SESSION_SECRET` in `.env` with a long random value. One way to generate one is:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then start the application:

```bash
npm start
```

Open `http://localhost:3000`.

## What the app does

* Account registration and login
* Live chat
* Shared music queue
* Music requests with moderator approval
* Synchronized YouTube playback
* Vote to move to the next track
* Temporary moderator and controller roles
* Online member presence
* Message deletion and moderation
* Audit records for privileged actions

## Security I built into it

| Control | How I used it |
|---|---|
| Password storage | bcrypt hashes passwords before they are stored |
| Sessions | Express sessions keep authenticated state on the server side |
| Authorization | Privileged routes check roles on the server |
| CSRF | State changing actions require a session token |
| SQL safety | Queries use placeholders instead of joining user input into SQL |
| Input validation | Registration, chat, titles, and media input have format or length checks |
| XSS reduction | EJS escapes normal output and live chat uses `textContent` instead of trusted HTML |
| Rate limiting | Authentication routes have tighter limits than normal traffic |
| Security headers | Helmet sets browser security headers and a content security policy |
| Auditability | Admin and moderation actions are written to the audit table |

## One part I paid attention to

The music request field can accept a YouTube URL, but I did not want the server to trust arbitrary iframe code.

The backend extracts the video ID, checks the host and ID format, reads the optional starting time, and then rebuilds the media target from known values.

That keeps the feature useful without accepting arbitrary embed markup.

## Architecture

```text
Browser and EJS views
        |
        +--> HTTP forms and API routes
        |
        +--> Socket.IO events
                 |
                 v
          Express application
                 |
        authentication
        authorization
        CSRF checks
        validation
                 |
                 v
              SQLite
        users
        messages
        requests
        queue
        audit logs
```

## Frontend restored in this repository

* [views/register.ejs](views/register.ejs) renders account registration.
* [views/login.ejs](views/login.ejs) renders authentication.
* [views/cafe.ejs](views/cafe.ejs) renders the live study-room dashboard.
* [public/styles.css](public/styles.css) contains the responsive interface.
* [public/cafe.js](public/cafe.js) handles Socket.IO state, chat, presence, queue updates, voting, and player synchronization.
* [demo/](demo/) contains the static GitHub Pages preview.

## Backend proof in this folder

* [server.js](server.js) contains the Express routes, sessions, authorization checks, CSRF checks, rate limiting, Socket.IO logic, and player controls.
* [database.js](database.js) contains the SQLite setup and query helpers.
* [schema.sql](schema.sql) shows the database schema in plain SQL.
* [package.json](package.json) shows the main dependencies.
* [FRONTEND.md](FRONTEND.md) documents the EJS, Socket.IO, and player behavior.

## Public safety

The working database and local environment file are not published. The public repo excludes user records, passwords, session data, and local secrets.

For local development, the first registered account becomes an administrator. That bootstrap behavior is convenient for a private demo but should be replaced with an explicit administrator provisioning process before exposing the full Node.js application to untrusted public users.

The GitHub Pages version is intentionally static and does not expose the backend database or authentication system.


## Permanent admin audit console

The permanent admin has an additional `/admin` console while retaining normal café access.

The console includes:

* User/account directory with roles and registration timestamps.
* Structured audit events for registration, login/logout, chat, music requests, moderation, queue controls, controller/temp-admin changes, votes, and report exports.
* Chat-message history with authorship and timestamps.
* Soft-deleted moderated messages retained for accountability, including who performed the deletion.
* Music request history and request status.
* Search/filtering across admin-visible records.
* Downloadable CSV audit report.
* CSV formula-injection protection before user-controlled values are exported.

Regular-user profanity is still censored in the live room. For moderation purposes, the original submitted chat text is retained in the permanent-admin audit trail. The registration and chat interfaces disclose that activity may be retained for moderation.

The audit design intentionally avoids exposing passwords/password hashes, session cookies, CSRF tokens, precise location, browser history, or unrelated device-fingerprint data to the admin interface.
