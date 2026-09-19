require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { body, validationResult } = require("express-validator");
const db = require("./database");
const SQLiteSessionStore = require("./sqlite-session-store");

const app = express();

const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

if (TRUST_PROXY) {
  app.set("trust proxy", "loopback");
}

const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required. Copy .env.example to .env and set a random value.");
}

/* -------------------------
   In-memory room state
------------------------- */

const onlineUsers = new Map();
const tempModeratorIds = new Set();
const nextVotes = new Map();

const AVATAR_STYLES = ["latte", "mocha", "matcha", "berry", "sky", "lavender"];
const PROFILE_IMAGE_MAX_BYTES = 512 * 1024;
const PROFILE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function validateProfileImageDataUrl(value) {
  const match = String(value || "").match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {
    return null;
  }

  const mime = match[1];
  if (!PROFILE_IMAGE_TYPES.has(mime)) {
    return null;
  }

  let bytes;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }

  if (!bytes.length || bytes.length > PROFILE_IMAGE_MAX_BYTES) {
    return null;
  }

  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  const isWebp =
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";

  if (
    (mime === "image/png" && !isPng) ||
    (mime === "image/jpeg" && !isJpeg) ||
    (mime === "image/webp" && !isWebp)
  ) {
    return null;
  }

  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function ensureBootstrapAdmin() {
  if (process.env.NODE_ENV === "production" && (!ADMIN_USERNAME || !ADMIN_PASSWORD)) {
    throw new Error(
      "ADMIN_USERNAME and ADMIN_PASSWORD are required in production."
    );
  }

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn(
      "No bootstrap admin configured. Set ADMIN_USERNAME and ADMIN_PASSWORD to provision one."
    );
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(ADMIN_USERNAME)) {
    throw new Error(
      "ADMIN_USERNAME must be 3-30 characters using letters, numbers, or underscores."
    );
  }

  if (ADMIN_PASSWORD.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  }

  const existing = await db.get(
    "SELECT id, username, role, password_hash FROM users WHERE username = ?",
    [ADMIN_USERNAME]
  );

  if (existing) {
    const passwordMatches = await bcrypt.compare(
      ADMIN_PASSWORD,
      existing.password_hash
    );

    if (existing.role !== "admin" || !passwordMatches) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

      await db.run(
        "UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?",
        [passwordHash, existing.id]
      );

      if (!passwordMatches) {
        await db.run("DELETE FROM sessions");
      }

      await writeAudit(
        existing.id,
        "admin.bootstrap_sync",
        "Synchronized configured permanent admin account",
        {
          details: {
            roleUpdated: existing.role !== "admin",
            passwordRotated: !passwordMatches,
            allSessionsInvalidated: !passwordMatches
          }
        }
      );

      await writeSecurityEvent({
        eventType: "admin.bootstrap_sync",
        severity: "NOTICE",
        actorUserId: existing.id,
        usernameSnapshot: ADMIN_USERNAME,
        outcome: "success",
        route: "startup",
        metadata: {
          roleUpdated: existing.role !== "admin",
          passwordRotated: !passwordMatches,
          allSessionsInvalidated: !passwordMatches
        }
      });
    }

    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const result = await db.run(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
    [ADMIN_USERNAME, passwordHash]
  );

  await writeAudit(
    result.lastID,
    "admin.bootstrap_create",
    "Provisioned permanent admin from server configuration",
    { details: { username: ADMIN_USERNAME } }
  );

  await writeSecurityEvent({
    eventType: "admin.bootstrap_create",
    severity: "NOTICE",
    actorUserId: result.lastID,
    usernameSnapshot: ADMIN_USERNAME,
    outcome: "success",
    route: "startup",
    metadata: { role: "admin" }
  });
}

function defaultAvatarState(userId) {
  const numericId = Math.max(1, Number(userId) || 1);
  return {
    avatarStyle: AVATAR_STYLES[(numericId - 1) % AVATAR_STYLES.length],
    avatarX: 18 + ((numericId * 23) % 64),
    avatarY: 22 + ((numericId * 17) % 56)
  };
}

function clampPercent(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(92, Math.max(8, number));
}

let controllerUserId = null;

let controllerState = {
  userId: null,
  username: null,
  trackId: null,
  trackTitle: "Not playing",
  videoId: null,
  currentSeconds: 0,
  isPlaying: false,
  updatedAt: null
};

/* -------------------------
   View engine
------------------------- */

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* -------------------------
   Middleware
------------------------- */

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));

/* -------------------------
   Security headers
------------------------- */

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://s.ytimg.com"
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com"
        ],
        imgSrc: ["'self'", "data:", "https://i.ytimg.com"],
        connectSrc: ["'self'", "ws:", "wss:"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

/* -------------------------
   Rate limiting
------------------------- */

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 250,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req, res) => {
    try {
      await recordRequestSecurityEvent(
        req,
        "auth.rate_limit",
        "WARNING",
        "blocked",
        {
          attemptedUsername:
            req.body && req.body.username
              ? String(req.body.username).slice(0, 30)
              : null
        }
      );
    } catch (err) {
      console.error("Rate-limit security log error:", err);
    }

    res
      .status(429)
      .send("Too many login or registration attempts. Please try again later.");
  }
});

app.use(generalLimiter);

/* -------------------------
   Sessions
------------------------- */

const sessionStore = new SQLiteSessionStore({
  defaultTtlMs: 1000 * 60 * 60
});

const sessionCleanupTimer = setInterval(() => {
  sessionStore
    .clearExpired()
    .catch((err) => console.error("Session cleanup error:", err));
}, 15 * 60 * 1000);

sessionCleanupTimer.unref();

const sessionMiddleware = session({
  store: sessionStore,
  name: "lofi.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60
  }
});

app.use(sessionMiddleware);

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  req.sessionRef = makeSessionRef(req.sessionID);
  res.setHeader("X-Request-ID", req.requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
    const durationMs = Number(elapsedNanoseconds / BigInt(1e6));
    const statusCode = res.statusCode;

    const severity =
      statusCode >= 500
        ? "HIGH"
        : statusCode >= 400
          ? "NOTICE"
          : "INFO";

    const outcome =
      statusCode >= 500
        ? "failed"
        : statusCode >= 400
          ? "blocked"
          : "success";

    writeSecurityEvent({
      eventType: "http.request",
      severity,
      actorUserId:
        req.session && req.session.user ? req.session.user.id : null,
      usernameSnapshot:
        req.session && req.session.user ? req.session.user.username : null,
      outcome,
      httpMethod: req.method,
      route:
        req.route && req.route.path
          ? String(req.route.path)
          : String(req.path || ""),
      requestId: req.requestId,
      sessionRef: makeSessionRef(req.sessionID),
      metadata: {
        statusCode,
        durationMs
      }
    }).catch((err) => console.error("HTTP security log error:", err));
  });

  next();
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

/* -------------------------
   CSRF token
------------------------- */

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  res.locals.csrfToken = req.session.csrfToken;
  res.locals.user = req.session.user || null;

  next();
});

function verifyCsrf(req, res, next) {
  if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
    recordRequestSecurityEvent(
      req,
      "csrf.validation_failed",
      "HIGH",
      "blocked",
      { reason: "missing_or_mismatched_token" }
    ).catch((err) => console.error("CSRF security log error:", err));

    return res.status(403).send("Invalid security token.");
  }

  next();
}

/* -------------------------
   Access control
------------------------- */

function requireLogin(req, res, next) {
  if (!req.session.user) {
    recordRequestSecurityEvent(
      req,
      "authorization.authentication_required",
      "NOTICE",
      "blocked"
    ).catch((err) => console.error("Authentication-required log error:", err));

    return res.redirect("/login");
  }

  next();
}

function isPermanentAdmin(user) {
  return user && user.role === "admin";
}

function isModerator(user) {
  return (
    user &&
    (user.role === "admin" || user.role === "mod" || tempModeratorIds.has(user.id))
  );
}

function requireModerator(req, res, next) {
  if (!isModerator(req.session.user)) {
    recordRequestSecurityEvent(
      req,
      "authorization.moderator_denied",
      "HIGH",
      "blocked"
    ).catch((err) => console.error("Moderator-denial log error:", err));

    return res.status(403).send("Access denied.");
  }

  next();
}

function requirePermanentAdmin(req, res, next) {
  if (!isPermanentAdmin(req.session.user)) {
    recordRequestSecurityEvent(
      req,
      "authorization.admin_denied",
      "HIGH",
      "blocked"
    ).catch((err) => console.error("Admin-denial log error:", err));

    return res.status(403).send("Only permanent admins can do that.");
  }

  next();
}

/* -------------------------
   Validation helper
------------------------- */

function getErrorMessages(req) {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    return [];
  }

  return errors.array().map((err) => err.msg);
}

/* -------------------------
   Chat censor
------------------------- */

const BLOCKED_WORDS = [
  "fuck",
  "fucking",
  "fucked",
  "fucker",
  "fuckers",
  "motherfucker",
  "motherfuckers",
  "shit",
  "shitty",
  "bullshit",
  "bitch",
  "bitches",
  "asshole",
  "assholes",
  "dick",
  "dicks",
  "cunt",
  "cunts",
  "bastard",
  "bastards"
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function censorBadWords(text) {
  let cleanText = String(text || "");

  for (const word of BLOCKED_WORDS) {
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
    cleanText = cleanText.replace(regex, "*".repeat(word.length));
  }

  return cleanText;
}

/* -------------------------
   Audit logging
------------------------- */

async function writeAudit(
  userId,
  eventType,
  action,
  { targetUserId = null, details = null } = {}
) {
  const safeDetails =
    details === null || details === undefined
      ? null
      : typeof details === "string"
        ? details.slice(0, 4000)
        : JSON.stringify(details).slice(0, 4000);

  await db.run(
    `
    INSERT INTO audit_logs
      (user_id, event_type, target_user_id, action, details)
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      userId || null,
      String(eventType || "activity").slice(0, 80),
      targetUserId || null,
      String(action || "").slice(0, 500),
      safeDetails
    ]
  );
}

function makeSessionRef(sessionId) {
  if (!sessionId) {
    return null;
  }

  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(String(sessionId))
    .digest("hex")
    .slice(0, 24);
}

function normalizeSeverity(value) {
  const severity = String(value || "INFO").toUpperCase();
  return ["INFO", "NOTICE", "WARNING", "HIGH"].includes(severity)
    ? severity
    : "INFO";
}

async function writeSecurityEvent({
  eventType,
  severity = "INFO",
  actorUserId = null,
  usernameSnapshot = null,
  targetUserId = null,
  outcome = "success",
  httpMethod = null,
  route = null,
  requestId = null,
  sessionRef = null,
  metadata = null
}) {
  const safeMetadata =
    metadata === null || metadata === undefined
      ? null
      : JSON.stringify(metadata).slice(0, 6000);

  await db.run(
    `
    INSERT INTO security_events (
      event_uuid,
      event_type,
      severity,
      actor_user_id,
      username_snapshot,
      target_user_id,
      outcome,
      http_method,
      route,
      request_id,
      session_ref,
      metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      crypto.randomUUID(),
      String(eventType || "security.event").slice(0, 100),
      normalizeSeverity(severity),
      actorUserId || null,
      usernameSnapshot ? String(usernameSnapshot).slice(0, 60) : null,
      targetUserId || null,
      String(outcome || "success").slice(0, 30),
      httpMethod ? String(httpMethod).slice(0, 12) : null,
      route ? String(route).slice(0, 200) : null,
      requestId ? String(requestId).slice(0, 80) : null,
      sessionRef ? String(sessionRef).slice(0, 64) : null,
      safeMetadata
    ]
  );
}

async function recordRequestSecurityEvent(
  req,
  eventType,
  severity = "INFO",
  outcome = "success",
  metadata = null,
  targetUserId = null
) {
  const sessionUser = req.session && req.session.user;

  return writeSecurityEvent({
    eventType,
    severity,
    actorUserId: sessionUser ? sessionUser.id : null,
    usernameSnapshot:
      sessionUser && sessionUser.username
        ? sessionUser.username
        : metadata && metadata.attemptedUsername
          ? metadata.attemptedUsername
          : null,
    targetUserId,
    outcome,
    httpMethod: req.method,
    route: req.route && req.route.path ? req.route.path : req.path,
    requestId: req.requestId || null,
    sessionRef: req.sessionRef || makeSessionRef(req.sessionID),
    metadata
  });
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

/* -------------------------
   YouTube parser
------------------------- */

function parseYouTubeInput(input) {
  try {
    const rawInput = String(input || "").trim();

    if (!rawInput) {
      return null;
    }

    let possibleUrl = rawInput;

    const iframeSrcMatch = rawInput.match(/src=["']([^"']+)["']/i);

    if (iframeSrcMatch && iframeSrcMatch[1]) {
      possibleUrl = iframeSrcMatch[1];
    }

    possibleUrl = possibleUrl.replace(/&amp;/g, "&");

    const parsedUrl = new URL(possibleUrl);
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");

    let videoId = null;

    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com"
    ) {
      videoId = parsedUrl.searchParams.get("v");
    }

    if (hostname === "youtu.be") {
      videoId = parsedUrl.pathname.split("/")[1];
    }

    if (
      (hostname === "youtube.com" || hostname === "youtube-nocookie.com") &&
      parsedUrl.pathname.startsWith("/embed/")
    ) {
      videoId = parsedUrl.pathname.split("/embed/")[1];
    }

    if (
      hostname === "youtube.com" &&
      parsedUrl.pathname.startsWith("/shorts/")
    ) {
      videoId = parsedUrl.pathname.split("/shorts/")[1];
    }

    if (videoId) {
      videoId = videoId.split("?")[0].split("&")[0].split("/")[0];
    }

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return null;
    }

    let startSeconds = 0;

    const tValue = parsedUrl.searchParams.get("t");
    const startValue = parsedUrl.searchParams.get("start");

    if (startValue && /^\d+$/.test(startValue)) {
      startSeconds = parseInt(startValue, 10);
    } else if (tValue) {
      startSeconds = parseYouTubeTimestamp(tValue);
    }

    if (!Number.isInteger(startSeconds) || startSeconds < 0) {
      startSeconds = 0;
    }

    const safeWatchUrl =
      startSeconds > 0
        ? `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`
        : `https://www.youtube.com/watch?v=${videoId}`;

    return {
      videoId,
      startSeconds,
      safeWatchUrl
    };
  } catch {
    return null;
  }
}

function parseYouTubeTimestamp(value) {
  const cleaned = String(value || "").trim().toLowerCase();

  if (/^\d+s?$/.test(cleaned)) {
    return parseInt(cleaned.replace("s", ""), 10);
  }

  const match = cleaned.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);

  if (!match) {
    return 0;
  }

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/* -------------------------
   Pending request helpers
------------------------- */

async function getPendingRequests() {
  return db.all(
    `
    SELECT music_requests.id,
           music_requests.title,
           music_requests.url,
           music_requests.created_at,
           users.username
    FROM music_requests
    JOIN users ON music_requests.user_id = users.id
    WHERE music_requests.status = 'pending'
    ORDER BY music_requests.created_at DESC
    `
  );
}

async function emitPendingRequests() {
  const pendingRequests = await getPendingRequests();

  io.emit("requests:update", {
    pendingRequests
  });
}

/* -------------------------
   Player helpers
------------------------- */

async function getPlayerState() {
  const currentTrack = await db.get(
    `
    SELECT music_queue.id,
           music_queue.title,
           music_queue.url,
           music_queue.video_id,
           music_queue.start_seconds,
           music_queue.started_at,
           music_queue.status,
           users.username AS requested_by_username
    FROM music_queue
    LEFT JOIN users ON music_queue.requested_by = users.id
    WHERE music_queue.status = 'playing'
    ORDER BY music_queue.started_at DESC
    LIMIT 1
    `
  );

  const queue = await db.all(
    `
    SELECT music_queue.id,
           music_queue.title,
           music_queue.url,
           music_queue.video_id,
           music_queue.start_seconds,
           music_queue.position,
           music_queue.status,
           users.username AS requested_by_username
    FROM music_queue
    LEFT JOIN users ON music_queue.requested_by = users.id
    WHERE music_queue.status = 'queued'
    ORDER BY music_queue.position ASC, music_queue.id ASC
    `
  );

  const history = await db.all(
    `
    SELECT music_queue.id,
           music_queue.title,
           music_queue.url,
           music_queue.video_id,
           music_queue.start_seconds,
           music_queue.started_at,
           music_queue.created_at,
           users.username AS requested_by_username
    FROM music_queue
    LEFT JOIN users ON music_queue.requested_by = users.id
    WHERE music_queue.status = 'played'
    ORDER BY music_queue.started_at DESC, music_queue.id DESC
    LIMIT 10
    `
  );

  return {
    currentTrack: currentTrack || null,
    queue,
    history,
    controller: getControllerPublicState(),
    vote: getVoteState(),
    serverNow: Date.now()
  };
}

function getControllerPublicState() {
  const controllerMember = controllerUserId ? onlineUsers.get(controllerUserId) : null;

  return {
    userId: controllerUserId,
    username: controllerMember ? controllerMember.username : controllerState.username,
    trackId: controllerState.trackId,
    trackTitle: controllerState.trackTitle,
    videoId: controllerState.videoId,
    currentSeconds: controllerState.currentSeconds,
    isPlaying: controllerState.isPlaying,
    updatedAt: controllerState.updatedAt
  };
}

function emitControllerUpdate() {
  io.emit("controller:update", {
    controller: getControllerPublicState(),
    serverNow: Date.now()
  });
}

async function emitPlayerState() {
  const state = await getPlayerState();
  io.emit("player:state", state);
}

async function resetVotesAndEmit() {
  nextVotes.clear();
  io.emit("vote:update", getVoteState());
}

function getVoteState() {
  const total = Math.max(onlineUsers.size, 1);
  const required = Math.floor(total / 2) + 1;

  const voters = Array.from(nextVotes.keys())
    .map((userId) => onlineUsers.get(userId))
    .filter(Boolean)
    .map((user) => user.username);

  return {
    count: nextVotes.size,
    total,
    required,
    voters
  };
}

async function startQueueTrack(trackId, moderatorId, options = {}) {
  const track = await db.get(
    "SELECT * FROM music_queue WHERE id = ? AND status IN ('queued', 'playing')",
    [trackId]
  );

  if (!track) {
    return null;
  }

  await db.run("UPDATE music_queue SET status = 'played' WHERE status = 'playing'");

  await db.run(
    "UPDATE music_queue SET status = 'playing', started_at = ? WHERE id = ?",
    [Date.now(), trackId]
  );

  controllerUserId = moderatorId;

  controllerState = {
    userId: moderatorId,
    username: onlineUsers.get(moderatorId)?.username || null,
    trackId: Number(trackId),
    trackTitle: track.title,
    videoId: track.video_id,
    currentSeconds: Number(track.start_seconds || 0),
    isPlaying: true,
    updatedAt: Date.now()
  };

  await writeAudit(
    moderatorId,
    "player.track_start",
    `Started queue track ID ${trackId}`,
    { details: { trackId: Number(trackId), title: track.title } }
  );

  await resetVotesAndEmit();
  await emitPlayerState();
  emitControllerUpdate();

  if (options.forceEveryone) {
    io.emit("player:force-sync", await getPlayerState());
  }

  emitPresence();

  return track;
}

async function startNextTrack(moderatorId, options = {}) {
  await db.run("UPDATE music_queue SET status = 'played' WHERE status = 'playing'");

  const nextTrack = await db.get(
    `
    SELECT *
    FROM music_queue
    WHERE status = 'queued'
    ORDER BY position ASC, id ASC
    LIMIT 1
    `
  );

  if (nextTrack) {
    await db.run(
      "UPDATE music_queue SET status = 'playing', started_at = ? WHERE id = ?",
      [Date.now(), nextTrack.id]
    );

    controllerUserId = moderatorId;

    controllerState = {
      userId: moderatorId,
      username: onlineUsers.get(moderatorId)?.username || null,
      trackId: Number(nextTrack.id),
      trackTitle: nextTrack.title,
      videoId: nextTrack.video_id,
      currentSeconds: Number(nextTrack.start_seconds || 0),
      isPlaying: true,
      updatedAt: Date.now()
    };

    await writeAudit(
      moderatorId,
      "player.track_next",
      `Skipped to next queue track ID ${nextTrack.id}`,
      { details: { trackId: nextTrack.id, title: nextTrack.title } }
    );
  } else {
    controllerState = {
      userId: controllerUserId,
      username: onlineUsers.get(controllerUserId)?.username || null,
      trackId: null,
      trackTitle: "Not playing",
      videoId: null,
      currentSeconds: 0,
      isPlaying: false,
      updatedAt: Date.now()
    };

    await writeAudit(
      moderatorId,
      "player.stop",
      "Stopped player because queue was empty"
    );
  }

  await resetVotesAndEmit();
  await emitPlayerState();
  emitControllerUpdate();

  if (options.forceEveryone) {
    io.emit("player:force-sync", await getPlayerState());
  }

  emitPresence();
}

async function queueTrackAgain(track, user) {
  const maxPosition = await db.get(
    "SELECT COALESCE(MAX(position), 0) AS max_position FROM music_queue WHERE status = 'queued'"
  );

  const newPosition = Number(maxPosition.max_position || 0) + 1;

  await db.run(
    `
    INSERT INTO music_queue
      (title, url, video_id, start_seconds, requested_by, approved_by, position, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
    `,
    [
      track.title,
      track.url,
      track.video_id,
      track.start_seconds,
      user.id,
      isModerator(user) ? user.id : null,
      newPosition
    ]
  );

  await emitPlayerState();
}

/* -------------------------
   Presence helpers
------------------------- */

function getMembersList() {
  return Array.from(onlineUsers.values()).map((member) => ({
    id: member.id,
    username: member.username,
    role: member.role,
    isTempAdmin: tempModeratorIds.has(member.id),
    isController: controllerUserId === member.id,
    playbackStatus: member.playbackStatus,
    trackTitle: member.trackTitle,
    followingRoom: member.followingRoom,
    currentSeconds: member.currentSeconds,
    isPlaying: member.isPlaying,
    updatedAt: member.updatedAt,
    avatarStyle: member.avatarStyle,
    avatarX: member.avatarX,
    avatarY: member.avatarY,
    avatarImageUrl: member.hasAvatarImage
      ? `/profile-image/${member.id}?v=${member.avatarImageVersion}`
      : null
  }));
}

function emitPresence() {
  io.emit("presence:update", {
    members: getMembersList()
  });
}

function selectFallbackController() {
  if (controllerUserId && onlineUsers.has(controllerUserId)) {
    return;
  }

  const availableModerator = Array.from(onlineUsers.values()).find((member) =>
    isModerator(member)
  );

  controllerUserId = availableModerator ? availableModerator.id : null;

  if (controllerUserId) {
    controllerState.userId = controllerUserId;
    controllerState.username = onlineUsers.get(controllerUserId)?.username || null;
  } else {
    controllerState.userId = null;
    controllerState.username = null;
  }

  controllerState.updatedAt = Date.now();
  emitControllerUpdate();
}

function addSocketToPresence(socket, user) {
  const existing = onlineUsers.get(user.id);
  const isNewJoin = !existing;

  if (existing) {
    existing.socketIds.add(socket.id);
    existing.updatedAt = Date.now();
  } else {
    const avatar = defaultAvatarState(user.id);

    onlineUsers.set(user.id, {
      id: user.id,
      username: user.username,
      role: user.role,
      socketIds: new Set([socket.id]),
      playbackStatus: "Online",
      trackTitle: "Not playing",
      followingRoom: true,
      currentSeconds: 0,
      isPlaying: false,
      avatarStyle: avatar.avatarStyle,
      avatarX: avatar.avatarX,
      avatarY: avatar.avatarY,
      hasAvatarImage: Boolean(user.avatarImage),
      avatarImageVersion: Date.now(),
      updatedAt: Date.now()
    });
  }

  if (!controllerUserId && isModerator(user)) {
    controllerUserId = user.id;
    controllerState.userId = user.id;
    controllerState.username = user.username;
    controllerState.updatedAt = Date.now();
    emitControllerUpdate();
  }

  if (isNewJoin) {
    writeAudit(
      user.id,
      "room.join",
      "Joined the study room"
    ).catch((err) => console.error("Join audit error:", err));

    io.emit("room:system", {
      text: `${user.username} joined the room.`
    });
  }

  emitPresence();
}

function removeSocketFromPresence(socket, user) {
  const member = onlineUsers.get(user.id);

  if (!member) {
    return;
  }

  member.socketIds.delete(socket.id);

  if (member.socketIds.size === 0) {
    onlineUsers.delete(user.id);
    nextVotes.delete(user.id);

    writeAudit(
      user.id,
      "room.leave",
      "Left the study room"
    ).catch((err) => console.error("Leave audit error:", err));

    io.emit("room:system", {
      text: `${user.username} left the room.`
    });
  }

  selectFallbackController();
  io.emit("vote:update", getVoteState());
  emitPresence();
}

function updateMemberStatus(userId, updates) {
  const member = onlineUsers.get(userId);

  if (!member) {
    return;
  }

  if (typeof updates.playbackStatus === "string") {
    member.playbackStatus = updates.playbackStatus.slice(0, 40);
  }

  if (typeof updates.trackTitle === "string") {
    member.trackTitle = updates.trackTitle.slice(0, 100);
  }

  if (typeof updates.followingRoom === "boolean") {
    member.followingRoom = updates.followingRoom;
  }

  if (Number.isFinite(Number(updates.currentSeconds))) {
    member.currentSeconds = Math.max(0, Math.floor(Number(updates.currentSeconds)));
  }

  if (typeof updates.isPlaying === "boolean") {
    member.isPlaying = updates.isPlaying;
  }

  member.updatedAt = Date.now();

  emitPresence();
}

/* -------------------------
   Routes
------------------------- */

app.get("/healthz", async (req, res) => {
  try {
    const row = await db.get("SELECT 1 AS ok");
    if (!row || row.ok !== 1) {
      return res.status(503).json({ status: "unhealthy" });
    }

    res.status(200).json({
      status: "ok",
      database: "reachable"
    });
  } catch (err) {
    console.error("Healthcheck database error:", err);
    res.status(503).json({ status: "unhealthy" });
  }
});

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/cafe");
  }

  res.redirect("/login");
});

app.get("/register", (req, res) => {
  res.render("register", { errors: [] });
});

app.post(
  "/register",
  authLimiter,
  verifyCsrf,
  body("username")
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must be between 3 and 30 characters.")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username can only contain letters, numbers, and underscores."),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters."),
  async (req, res) => {
    const errors = getErrorMessages(req);

    if (errors.length > 0) {
      return res.status(400).render("register", { errors });
    }

    const { username, password } = req.body;

    try {
      const existingUser = await db.get(
        "SELECT id FROM users WHERE username = ?",
        [username]
      );

      if (existingUser) {
        return res.status(400).render("register", {
          errors: ["Username is already taken."]
        });
      }

      const role = "user";

      const passwordHash = await bcrypt.hash(password, 12);

      const createdUser = await db.run(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        [username, passwordHash, role]
      );

      await writeAudit(
        createdUser.lastID,
        "account.register",
        `Account registered as ${role}`,
        { details: { username, role } }
      );

      await writeSecurityEvent({
        eventType: "account.register",
        severity: role === "admin" ? "NOTICE" : "INFO",
        actorUserId: createdUser.lastID,
        usernameSnapshot: username,
        outcome: "success",
        httpMethod: req.method,
        route: req.route.path,
        requestId: req.requestId,
        sessionRef: req.sessionRef,
        metadata: { role }
      });

      res.redirect("/login");
    } catch (err) {
      console.error("Registration error:", err);

      res.status(500).render("register", {
        errors: ["Something went wrong. Please try again."]
      });
    }
  }
);

app.get("/login", (req, res) => {
  res.render("login", { errors: [] });
});

app.post(
  "/login",
  authLimiter,
  verifyCsrf,
  body("username").trim().notEmpty().withMessage("Username is required."),
  body("password").notEmpty().withMessage("Password is required."),
  async (req, res) => {
    const errors = getErrorMessages(req);

    if (errors.length > 0) {
      return res.status(400).render("login", { errors });
    }

    const { username, password } = req.body;

    try {
      const user = await db.get(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
        [username]
      );

      if (!user) {
        await writeAudit(
          null,
          "auth.login_failed",
          "Failed login attempt",
          { details: { attemptedUsername: username } }
        );

        await recordRequestSecurityEvent(
          req,
          "auth.login_failed",
          "WARNING",
          "failed",
          { attemptedUsername: username, reason: "unknown_username" }
        );

        return res.status(400).render("login", {
          errors: ["Invalid username or password."]
        });
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatches) {
        await writeAudit(
          user.id,
          "auth.login_failed",
          "Failed login attempt",
          { details: { attemptedUsername: username } }
        );

        await writeSecurityEvent({
          eventType: "auth.login_failed",
          severity: "WARNING",
          actorUserId: user.id,
          usernameSnapshot: user.username,
          outcome: "failed",
          httpMethod: req.method,
          route: req.route.path,
          requestId: req.requestId,
          sessionRef: req.sessionRef,
          metadata: { reason: "invalid_password" }
        });

        return res.status(400).render("login", {
          errors: ["Invalid username or password."]
        });
      }

      req.session.regenerate(async (regenerateError) => {
        if (regenerateError) {
          console.error("Session regeneration error:", regenerateError);
          return res.status(500).render("login", {
            errors: ["Something went wrong. Please try again."]
          });
        }

        req.session.user = {
          id: user.id,
          username: user.username,
          role: user.role
        };
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");

        try {
          await writeAudit(
            user.id,
            "auth.login",
            "Successful login",
            { details: { role: user.role } }
          );

          await writeSecurityEvent({
            eventType: "auth.login_success",
            severity: "INFO",
            actorUserId: user.id,
            usernameSnapshot: user.username,
            outcome: "success",
            httpMethod: req.method,
            route: req.route.path,
            requestId: req.requestId,
            sessionRef: makeSessionRef(req.sessionID),
            metadata: { role: user.role, sessionRegenerated: true }
          });

          res.redirect("/cafe");
        } catch (loggingError) {
          console.error("Login security log error:", loggingError);
          res.redirect("/cafe");
        }
      });
    } catch (err) {
      console.error("Login error:", err);

      res.status(500).render("login", {
        errors: ["Something went wrong. Please try again."]
      });
    }
  }
);

app.post("/logout", verifyCsrf, async (req, res) => {
  const user = req.session.user;

  if (user) {
    try {
      await writeAudit(user.id, "auth.logout", "User logged out");
      await recordRequestSecurityEvent(
        req,
        "auth.logout",
        "INFO",
        "success"
      );
    } catch (err) {
      console.error("Logout audit error:", err);
    }
  }

  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/profile-image/:id", requireLogin, async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(404).end();
    }

    const row = await db.get(
      "SELECT avatar_image FROM users WHERE id = ?",
      [userId]
    );

    if (!row || !row.avatar_image) {
      return res.status(404).end();
    }

    const validatedImage = validateProfileImageDataUrl(row.avatar_image);

    if (!validatedImage) {
      return res.status(404).end();
    }

    const match = validatedImage.match(
      /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/
    );

    if (!match) {
      return res.status(404).end();
    }

    const imageBytes = Buffer.from(match[2], "base64");

    res.setHeader("Content-Type", match[1]);
    res.setHeader("Content-Length", String(imageBytes.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(imageBytes);
  } catch (err) {
    console.error("Profile image read error:", err);
    res.status(500).end();
  }
});

app.get(
  "/security",
  requireLogin,
  requirePermanentAdmin,
  (req, res) => {
    res.render("security");
  }
);

app.get("/cafe", requireLogin, async (req, res) => {
  try {
    const messages = await db.all(
      `
      SELECT messages.id,
             messages.message_text,
             messages.created_at,
             users.username,
             users.id AS user_id,
             users.role AS user_role
      FROM messages
      JOIN users ON messages.user_id = users.id
      WHERE messages.deleted_at IS NULL
      ORDER BY messages.created_at DESC
      LIMIT 50
      `
    );

    res.render("cafe", {
      messages,
      canModerate: isModerator(req.session.user),
      canAssignTempAdmin: isPermanentAdmin(req.session.user),
      currentUserId: req.session.user.id
    });
  } catch (err) {
    console.error("Cafe page error:", err);
    res.status(500).send("Something went wrong.");
  }
});

app.get("/api/player-state", requireLogin, async (req, res) => {
  try {
    const playerState = await getPlayerState();
    res.json(playerState);
  } catch (err) {
    console.error("Player state API error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.get("/api/members", requireLogin, (req, res) => {
  res.json({
    members: getMembersList()
  });
});

app.get("/api/pending-requests", requireLogin, requireModerator, async (req, res) => {
  try {
    res.json({
      pendingRequests: await getPendingRequests()
    });
  } catch (err) {
    console.error("Pending requests API error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

/* -------------------------
   Music requests
------------------------- */

app.post(
  "/music-requests",
  requireLogin,
  verifyCsrf,
  body("title")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Music title must be between 1 and 100 characters."),
  body("url")
    .trim()
    .isLength({ min: 1, max: 1500 })
    .withMessage("Please paste a YouTube URL or YouTube embed code."),
  async (req, res) => {
    const errors = getErrorMessages(req);

    if (errors.length > 0) {
      return res.status(400).send(errors.join(" "));
    }

    const { title, url } = req.body;
    const parsedVideo = parseYouTubeInput(url);

    if (!parsedVideo) {
      return res
        .status(400)
        .send("Only valid YouTube links or YouTube embed codes are allowed.");
    }

    try {
      const musicRequest = await db.run(
        `
        INSERT INTO music_requests (user_id, title, url, video_id, start_seconds)
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          req.session.user.id,
          title,
          parsedVideo.safeWatchUrl,
          parsedVideo.videoId,
          parsedVideo.startSeconds
        ]
      );

      await writeAudit(
        req.session.user.id,
        "music.request",
        `Submitted music request ID ${musicRequest.lastID}`,
        {
          details: {
            requestId: musicRequest.lastID,
            title,
            videoId: parsedVideo.videoId
          }
        }
      );

      await emitPendingRequests();

      res.redirect("/cafe");
    } catch (err) {
      console.error("Music request error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/admin/music-requests/:id/approve",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      const request = await db.get(
        "SELECT * FROM music_requests WHERE id = ? AND status = 'pending'",
        [req.params.id]
      );

      if (!request) {
        return res.status(404).send("Music request not found.");
      }

      const maxPosition = await db.get(
        "SELECT COALESCE(MAX(position), 0) AS max_position FROM music_queue WHERE status = 'queued'"
      );

      const newPosition = Number(maxPosition.max_position || 0) + 1;

      const result = await db.run(
        `
        INSERT INTO music_queue
          (title, url, video_id, start_seconds, requested_by, approved_by, position, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
        `,
        [
          request.title,
          request.url,
          request.video_id,
          request.start_seconds,
          request.user_id,
          req.session.user.id,
          newPosition
        ]
      );

      await db.run(
        "UPDATE music_requests SET status = 'approved' WHERE id = ?",
        [req.params.id]
      );

      await writeAudit(
        req.session.user.id,
        "music.approve",
        `Approved music request ID ${req.params.id}`,
        {
          targetUserId: request.user_id,
          details: { requestId: Number(req.params.id), title: request.title }
        }
      );

      const current = await db.get(
        "SELECT id FROM music_queue WHERE status = 'playing' LIMIT 1"
      );

      if (!current) {
        await startQueueTrack(result.lastID, req.session.user.id);
      } else {
        await emitPlayerState();
      }

      await emitPendingRequests();

      res.redirect("/cafe");
    } catch (err) {
      console.error("Music approval error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/admin/music-requests/:id/reject",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      await db.run(
        "UPDATE music_requests SET status = 'rejected' WHERE id = ?",
        [req.params.id]
      );

      const rejectedRequest = await db.get(
        "SELECT user_id, title FROM music_requests WHERE id = ?",
        [req.params.id]
      );

      await writeAudit(
        req.session.user.id,
        "music.reject",
        `Rejected music request ID ${req.params.id}`,
        {
          targetUserId: rejectedRequest ? rejectedRequest.user_id : null,
          details: {
            requestId: Number(req.params.id),
            title: rejectedRequest ? rejectedRequest.title : null
          }
        }
      );

      await emitPendingRequests();

      res.redirect("/cafe");
    } catch (err) {
      console.error("Music rejection error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

/* -------------------------
   Queue controls
------------------------- */

app.post(
  "/admin/player/next",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      await startNextTrack(req.session.user.id);
      res.redirect("/cafe");
    } catch (err) {
      console.error("Next track error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/admin/queue/:id/play",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      await startQueueTrack(req.params.id, req.session.user.id);
      res.redirect("/cafe");
    } catch (err) {
      console.error("Play queue track error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/admin/queue/:id/remove",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      await db.run(
        "UPDATE music_queue SET status = 'removed' WHERE id = ? AND status = 'queued'",
        [req.params.id]
      );

      await writeAudit(
        req.session.user.id,
        "music.queue_remove",
        `Removed queue track ID ${req.params.id}`,
        { details: { trackId: Number(req.params.id) } }
      );

      await emitPlayerState();
      res.redirect("/cafe");
    } catch (err) {
      console.error("Remove queue track error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/admin/queue/:id/up",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      const current = await db.get(
        "SELECT id, position FROM music_queue WHERE id = ? AND status = 'queued'",
        [req.params.id]
      );

      if (current) {
        const previous = await db.get(
          `
          SELECT id, position
          FROM music_queue
          WHERE status = 'queued' AND position < ?
          ORDER BY position DESC
          LIMIT 1
          `,
          [current.position]
        );

        if (previous) {
          await db.run("UPDATE music_queue SET position = ? WHERE id = ?", [
            previous.position,
            current.id
          ]);

          await db.run("UPDATE music_queue SET position = ? WHERE id = ?", [
            current.position,
            previous.id
          ]);

          await writeAudit(
            req.session.user.id,
            "music.queue_reorder",
            `Moved queue track ID ${current.id} up`,
            {
              details: {
                trackId: current.id,
                fromPosition: current.position,
                toPosition: previous.position
              }
            }
          );
        }
      }

      await emitPlayerState();
      res.redirect("/cafe");
    } catch (err) {
      console.error("Move up error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/admin/queue/:id/down",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      const current = await db.get(
        "SELECT id, position FROM music_queue WHERE id = ? AND status = 'queued'",
        [req.params.id]
      );

      if (current) {
        const next = await db.get(
          `
          SELECT id, position
          FROM music_queue
          WHERE status = 'queued' AND position > ?
          ORDER BY position ASC
          LIMIT 1
          `,
          [current.position]
        );

        if (next) {
          await db.run("UPDATE music_queue SET position = ? WHERE id = ?", [
            next.position,
            current.id
          ]);

          await db.run("UPDATE music_queue SET position = ? WHERE id = ?", [
            current.position,
            next.id
          ]);

          await writeAudit(
            req.session.user.id,
            "music.queue_reorder",
            `Moved queue track ID ${current.id} down`,
            {
              details: {
                trackId: current.id,
                fromPosition: current.position,
                toPosition: next.position
              }
            }
          );
        }
      }

      await emitPlayerState();
      res.redirect("/cafe");
    } catch (err) {
      console.error("Move down error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/history/:id/request-again",
  requireLogin,
  verifyCsrf,
  async (req, res) => {
    try {
      const track = await db.get(
        "SELECT * FROM music_queue WHERE id = ? AND status = 'played'",
        [req.params.id]
      );

      if (!track) {
        return res.status(404).send("History track not found.");
      }

      if (isModerator(req.session.user)) {
        await queueTrackAgain(track, req.session.user);
        await writeAudit(
          req.session.user.id,
          "music.request_again",
          `Re-queued history track ID ${track.id}`,
          { details: { trackId: track.id, title: track.title } }
        );
      } else {
        await db.run(
          `
          INSERT INTO music_requests (user_id, title, url, video_id, start_seconds, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
          `,
          [
            req.session.user.id,
            track.title,
            track.url,
            track.video_id,
            track.start_seconds
          ]
        );

        await writeAudit(
          req.session.user.id,
          "music.request_again",
          `Requested history track ID ${track.id} again`,
          { details: { trackId: track.id, title: track.title } }
        );

        await emitPendingRequests();
      }

      res.redirect("/cafe");
    } catch (err) {
      console.error("Request again error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

/* -------------------------
   Temp admin / controller
------------------------- */

app.post(
  "/admin/members/:id/temp-admin",
  requireLogin,
  requirePermanentAdmin,
  verifyCsrf,
  async (req, res) => {
    try {
      const userId = Number(req.params.id);

      const user = await db.get("SELECT id, username FROM users WHERE id = ?", [
        userId
      ]);

      if (!user) {
        return res.status(404).send("User not found.");
      }

      tempModeratorIds.add(userId);
      controllerUserId = userId;

      controllerState.userId = userId;
      controllerState.username = user.username;
      controllerState.updatedAt = Date.now();

      await writeAudit(
        req.session.user.id,
        "admin.temp_grant",
        `Assigned temporary admin/controller to ${user.username}`,
        { targetUserId: user.id }
      );

      io.emit("room:system", {
        text: `${user.username} was assigned as temporary room controller.`
      });

      emitPresence();
      await emitPlayerState();
      emitControllerUpdate();

      res.redirect("/cafe");
    } catch (err) {
      console.error("Temp admin assignment error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

app.post(
  "/admin/members/:id/remove-temp-admin",
  requireLogin,
  requirePermanentAdmin,
  verifyCsrf,
  async (req, res) => {
    try {
      const userId = Number(req.params.id);

      const user = await db.get("SELECT id, username FROM users WHERE id = ?", [
        userId
      ]);

      if (!user) {
        return res.status(404).send("User not found.");
      }

      tempModeratorIds.delete(userId);

      if (controllerUserId === userId) {
        controllerUserId = req.session.user.id;
        controllerState.userId = req.session.user.id;
        controllerState.username = req.session.user.username;
        controllerState.updatedAt = Date.now();
      }

      await writeAudit(
        req.session.user.id,
        "admin.temp_revoke",
        `Removed temporary admin/controller from ${user.username}`,
        { targetUserId: user.id }
      );

      io.emit("room:system", {
        text: `${user.username} is no longer a temporary room controller.`
      });

      emitPresence();
      await emitPlayerState();
      emitControllerUpdate();

      res.redirect("/cafe");
    } catch (err) {
      console.error("Temp admin removal error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

/* -------------------------
   Message moderation
------------------------- */

app.post(
  "/admin/messages/:id/delete",
  requireLogin,
  requireModerator,
  verifyCsrf,
  async (req, res) => {
    try {
      const messageId = req.params.id;

      const message = await db.get(
        `
        SELECT messages.id,
               messages.user_id,
               messages.message_text,
               users.username
        FROM messages
        JOIN users ON messages.user_id = users.id
        WHERE messages.id = ? AND messages.deleted_at IS NULL
        `,
        [messageId]
      );

      if (!message) {
        return res.status(404).send("Message not found.");
      }

      await db.run(
        "UPDATE messages SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?",
        [req.session.user.id, messageId]
      );

      await writeAudit(
        req.session.user.id,
        "chat.delete",
        `Deleted message ID ${messageId} from ${message.username}`,
        {
          targetUserId: message.user_id,
          details: {
            messageId: Number(messageId),
            messageText: message.message_text
          }
        }
      );

      io.emit("chat:deleted", {
        id: messageId
      });

      res.redirect("/cafe");
    } catch (err) {
      console.error("Admin delete error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);


/* -------------------------
   Permanent admin console
------------------------- */

app.get("/admin", requireLogin, requirePermanentAdmin, async (req, res) => {
  try {
    const users = await db.all(
      `
      SELECT users.id,
             users.username,
             users.role,
             users.created_at,
             COUNT(messages.id) AS message_count
      FROM users
      LEFT JOIN messages ON messages.user_id = users.id
      GROUP BY users.id
      ORDER BY users.created_at ASC
      `
    );

    const auditLogs = await db.all(
      `
      SELECT audit_logs.id,
             audit_logs.event_type,
             audit_logs.action,
             audit_logs.details,
             audit_logs.created_at,
             actor.username AS actor_username,
             target.username AS target_username
      FROM audit_logs
      LEFT JOIN users AS actor ON audit_logs.user_id = actor.id
      LEFT JOIN users AS target ON audit_logs.target_user_id = target.id
      ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
      LIMIT 500
      `
    );

    const securityEvents = await db.all(
      `
      SELECT security_events.id,
             security_events.event_uuid,
             security_events.event_type,
             security_events.severity,
             security_events.username_snapshot,
             security_events.outcome,
             security_events.http_method,
             security_events.route,
             security_events.request_id,
             security_events.session_ref,
             security_events.metadata,
             security_events.created_at,
             actor.username AS actor_username,
             target.username AS target_username
      FROM security_events
      LEFT JOIN users AS actor ON security_events.actor_user_id = actor.id
      LEFT JOIN users AS target ON security_events.target_user_id = target.id
      ORDER BY security_events.created_at DESC, security_events.id DESC
      LIMIT 750
      `
    );

    const messageHistory = await db.all(
      `
      SELECT messages.id,
             messages.message_text,
             messages.created_at,
             messages.deleted_at,
             author.username AS author_username,
             author.role AS author_role,
             deleter.username AS deleted_by_username
      FROM messages
      JOIN users AS author ON messages.user_id = author.id
      LEFT JOIN users AS deleter ON messages.deleted_by = deleter.id
      ORDER BY messages.created_at DESC, messages.id DESC
      LIMIT 500
      `
    );

    const musicRequests = await db.all(
      `
      SELECT music_requests.id,
             music_requests.title,
             music_requests.video_id,
             music_requests.status,
             music_requests.created_at,
             users.username
      FROM music_requests
      JOIN users ON music_requests.user_id = users.id
      ORDER BY music_requests.created_at DESC, music_requests.id DESC
      LIMIT 300
      `
    );

    const counts = {
      users: users.length,
      messages: await db.get("SELECT COUNT(*) AS count FROM messages"),
      activeMessages: await db.get(
        "SELECT COUNT(*) AS count FROM messages WHERE deleted_at IS NULL"
      ),
      deletedMessages: await db.get(
        "SELECT COUNT(*) AS count FROM messages WHERE deleted_at IS NOT NULL"
      ),
      auditEvents: await db.get("SELECT COUNT(*) AS count FROM audit_logs"),
      securityEvents: await db.get("SELECT COUNT(*) AS count FROM security_events"),
      highSecurityEvents: await db.get(
        "SELECT COUNT(*) AS count FROM security_events WHERE severity = 'HIGH'"
      ),
      blockedSecurityEvents: await db.get(
        "SELECT COUNT(*) AS count FROM security_events WHERE outcome IN ('blocked', 'failed')"
      ),
      musicRequests: await db.get("SELECT COUNT(*) AS count FROM music_requests")
    };

    res.render("admin", {
      users,
      auditLogs,
      securityEvents,
      messageHistory,
      musicRequests,
      counts: {
        users: counts.users,
        messages: counts.messages.count,
        activeMessages: counts.activeMessages.count,
        deletedMessages: counts.deletedMessages.count,
        auditEvents: counts.auditEvents.count,
        securityEvents: counts.securityEvents.count,
        highSecurityEvents: counts.highSecurityEvents.count,
        blockedSecurityEvents: counts.blockedSecurityEvents.count,
        musicRequests: counts.musicRequests.count
      }
    });
  } catch (err) {
    console.error("Admin console error:", err);
    res.status(500).send("Something went wrong.");
  }
});

app.get(
  "/admin/report.csv",
  requireLogin,
  requirePermanentAdmin,
  async (req, res) => {
    try {
      await writeAudit(
        req.session.user.id,
        "admin.report_export",
        "Downloaded full CSV audit report"
      );

      const records = [];

      const audits = await db.all(
        `
        SELECT audit_logs.id,
               audit_logs.event_type,
               audit_logs.action,
               audit_logs.details,
               audit_logs.created_at,
               actor.username AS actor_username,
               target.username AS target_username
        FROM audit_logs
        LEFT JOIN users AS actor ON audit_logs.user_id = actor.id
        LEFT JOIN users AS target ON audit_logs.target_user_id = target.id
        ORDER BY audit_logs.created_at ASC, audit_logs.id ASC
        `
      );

      for (const row of audits) {
        records.push({
          timestamp: row.created_at,
          category: "audit",
          eventType: row.event_type || "legacy",
          actor: row.actor_username || "system",
          target: row.target_username || "",
          action: row.action,
          content: row.details || "",
          status: "",
          resourceId: row.id
        });
      }

      const securityRows = await db.all(
        `
        SELECT security_events.id,
               security_events.event_type,
               security_events.severity,
               security_events.username_snapshot,
               security_events.outcome,
               security_events.http_method,
               security_events.route,
               security_events.request_id,
               security_events.session_ref,
               security_events.metadata,
               security_events.created_at,
               actor.username AS actor_username,
               target.username AS target_username
        FROM security_events
        LEFT JOIN users AS actor ON security_events.actor_user_id = actor.id
        LEFT JOIN users AS target ON security_events.target_user_id = target.id
        ORDER BY security_events.created_at ASC, security_events.id ASC
        `
      );

      for (const row of securityRows) {
        records.push({
          timestamp: row.created_at,
          category: "security",
          eventType: row.event_type,
          actor: row.actor_username || row.username_snapshot || "anonymous",
          target: row.target_username || "",
          action: `${row.severity} ${row.http_method || ""} ${row.route || ""}`.trim(),
          content: JSON.stringify({
            requestId: row.request_id,
            sessionRef: row.session_ref,
            metadata: row.metadata
          }),
          status: row.outcome,
          resourceId: row.id
        });
      }

      const messages = await db.all(
        `
        SELECT messages.id,
               messages.message_text,
               messages.created_at,
               messages.deleted_at,
               author.username AS author_username,
               deleter.username AS deleted_by_username
        FROM messages
        JOIN users AS author ON messages.user_id = author.id
        LEFT JOIN users AS deleter ON messages.deleted_by = deleter.id
        ORDER BY messages.created_at ASC, messages.id ASC
        `
      );

      for (const row of messages) {
        records.push({
          timestamp: row.created_at,
          category: "chat",
          eventType: "chat.message_record",
          actor: row.author_username,
          target: row.deleted_by_username || "",
          action: row.deleted_at ? "Message retained after moderation deletion" : "Message posted",
          content: row.message_text,
          status: row.deleted_at ? `deleted ${row.deleted_at}` : "active",
          resourceId: row.id
        });
      }

      const music = await db.all(
        `
        SELECT music_requests.id,
               music_requests.title,
               music_requests.video_id,
               music_requests.status,
               music_requests.created_at,
               users.username
        FROM music_requests
        JOIN users ON music_requests.user_id = users.id
        ORDER BY music_requests.created_at ASC, music_requests.id ASC
        `
      );

      for (const row of music) {
        records.push({
          timestamp: row.created_at,
          category: "music_request",
          eventType: "music.request_record",
          actor: row.username,
          target: "",
          action: row.title,
          content: row.video_id,
          status: row.status,
          resourceId: row.id
        });
      }

      records.sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp))
      );

      const header = [
        "timestamp",
        "category",
        "event_type",
        "actor",
        "target",
        "action",
        "content_or_details",
        "status",
        "resource_id"
      ];

      const rows = [
        header.map(csvCell).join(","),
        ...records.map((record) =>
          [
            record.timestamp,
            record.category,
            record.eventType,
            record.actor,
            record.target,
            record.action,
            record.content,
            record.status,
            record.resourceId
          ].map(csvCell).join(",")
        )
      ];

      const date = new Date().toISOString().slice(0, 10);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="secure-lofi-admin-audit-${date}.csv"`
      );

      res.send("\uFEFF" + rows.join("\n"));
    } catch (err) {
      console.error("Admin report export error:", err);
      res.status(500).send("Something went wrong.");
    }
  }
);

/* -------------------------
   Socket.IO
------------------------- */

io.on("connection", async (socket) => {
  const userSession = socket.request.session;

  if (!userSession || !userSession.user) {
    socket.disconnect();
    return;
  }

  const user = userSession.user;

  try {
    const profile = await db.get(
      "SELECT avatar_image FROM users WHERE id = ?",
      [user.id]
    );
    user.avatarImage = profile ? profile.avatar_image : null;
  } catch (err) {
    console.error("Profile image load error:", err);
    user.avatarImage = null;
  }

  addSocketToPresence(socket, user);

  writeSecurityEvent({
    eventType: "socket.connected",
    severity: "INFO",
    actorUserId: user.id,
    usernameSnapshot: user.username,
    outcome: "success",
    route: "socket.io",
    sessionRef: makeSessionRef(socket.request.sessionID),
    metadata: { socketId: crypto.createHash("sha256").update(socket.id).digest("hex").slice(0, 16) }
  }).catch((err) => console.error("Socket connection security log error:", err));

  try {
    socket.emit("player:state", await getPlayerState());
    socket.emit("presence:update", {
      members: getMembersList()
    });
    socket.emit("vote:update", getVoteState());
    socket.emit("controller:update", {
      controller: getControllerPublicState(),
      serverNow: Date.now()
    });

    if (isModerator(user)) {
      socket.emit("requests:update", {
        pendingRequests: await getPendingRequests()
      });
    }
  } catch (err) {
    console.error("Initial socket state error:", err);
  }

  socket.on("chat:send", async (data) => {
    try {
      if (!data || data.csrfToken !== userSession.csrfToken) {
        return;
      }

      const rawMessage = String(data.message || "").trim();

      if (rawMessage.length < 1 || rawMessage.length > 500) {
        return;
      }

      // Permanent admins may post uncensored messages. All other accounts,
      // including temporary moderators/controllers, are filtered server-side.
      const storedMessage =
        user.role === "admin" ? rawMessage : censorBadWords(rawMessage);

      const result = await db.run(
        "INSERT INTO messages (user_id, message_text) VALUES (?, ?)",
        [user.id, storedMessage]
      );

      await writeAudit(
        user.id,
        "chat.message",
        `Sent chat message ID ${result.lastID}`,
        {
          details: {
            messageId: result.lastID,
            filteredForNonAdmin: user.role !== "admin",
            originalSubmittedText: rawMessage,
            displayedText: storedMessage
          }
        }
      );

      const savedMessage = await db.get(
        `
        SELECT messages.id,
               messages.message_text,
               messages.created_at,
               users.username,
               users.id AS user_id,
               users.role AS user_role
        FROM messages
        JOIN users ON messages.user_id = users.id
        WHERE messages.id = ?
        `,
        [result.lastID]
      );

      io.emit("chat:new", savedMessage);
    } catch (err) {
      console.error("Live chat error:", err);
    }
  });

  socket.on("member:status", (data) => {
    updateMemberStatus(user.id, {
      playbackStatus: data && data.playbackStatus,
      trackTitle: data && data.trackTitle,
      followingRoom: data && data.followingRoom,
      currentSeconds: data && data.currentSeconds,
      isPlaying: data && data.isPlaying
    });
  });

  socket.on("member:move", (data) => {
    const member = onlineUsers.get(user.id);
    if (!member) {
      return;
    }

    member.avatarX = clampPercent(data && data.x, member.avatarX);
    member.avatarY = clampPercent(data && data.y, member.avatarY);
    member.updatedAt = Date.now();
    emitPresence();
  });

  socket.on("member:avatar", (data) => {
    const member = onlineUsers.get(user.id);
    if (!member) {
      return;
    }

    const requested = String((data && data.style) || "");
    if (!AVATAR_STYLES.includes(requested)) {
      return;
    }

    member.avatarStyle = requested;
    member.updatedAt = Date.now();
    emitPresence();
  });

  socket.on("member:profile-image", async (data, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};

    try {
      if (!data || data.csrfToken !== userSession.csrfToken) {
        await writeSecurityEvent({
          eventType: "profile.image_csrf_failed",
          severity: "HIGH",
          actorUserId: user.id,
          usernameSnapshot: user.username,
          outcome: "blocked",
          route: "socket.io/member:profile-image",
          sessionRef: makeSessionRef(socket.request.sessionID)
        });

        reply({ ok: false, error: "Invalid security token." });
        return;
      }

      const member = onlineUsers.get(user.id);
      if (!member) {
        reply({ ok: false, error: "User is not active in the room." });
        return;
      }

      if (data.remove === true) {
        await db.run("UPDATE users SET avatar_image = NULL WHERE id = ?", [user.id]);
        member.hasAvatarImage = false;
        member.avatarImageVersion = Date.now();
        member.updatedAt = Date.now();

        await writeAudit(
          user.id,
          "profile.image_remove",
          "Removed profile image"
        );

        emitPresence();
        reply({ ok: true, removed: true });
        return;
      }

      const validatedImage = validateProfileImageDataUrl(data.imageData);

      if (!validatedImage) {
        await writeSecurityEvent({
          eventType: "profile.image_rejected",
          severity: "WARNING",
          actorUserId: user.id,
          usernameSnapshot: user.username,
          outcome: "blocked",
          route: "socket.io/member:profile-image",
          sessionRef: makeSessionRef(socket.request.sessionID),
          metadata: { reason: "invalid_type_signature_or_size" }
        });

        reply({
          ok: false,
          error: "Use a PNG, JPEG, or WebP image no larger than 512 KB."
        });
        return;
      }

      await db.run(
        "UPDATE users SET avatar_image = ? WHERE id = ?",
        [validatedImage, user.id]
      );

      member.hasAvatarImage = true;
      member.avatarImageVersion = Date.now();
      member.updatedAt = Date.now();

      await writeAudit(
        user.id,
        "profile.image_update",
        "Updated profile image"
      );

      await writeSecurityEvent({
        eventType: "profile.image_update",
        severity: "INFO",
        actorUserId: user.id,
        usernameSnapshot: user.username,
        outcome: "success",
        route: "socket.io/member:profile-image",
        sessionRef: makeSessionRef(socket.request.sessionID)
      });

      emitPresence();
      reply({ ok: true });
    } catch (err) {
      console.error("Profile image update error:", err);
      reply({ ok: false, error: "Profile image update failed." });
    }
  });

  socket.on("controller:heartbeat", (data) => {
    if (user.id !== controllerUserId) {
      return;
    }

    controllerState = {
      userId: user.id,
      username: user.username,
      trackId: Number(data.trackId || 0) || null,
      trackTitle: String(data.trackTitle || "Not playing").slice(0, 100),
      videoId: String(data.videoId || "").slice(0, 20),
      currentSeconds: Math.max(0, Math.floor(Number(data.currentSeconds || 0))),
      isPlaying: Boolean(data.isPlaying),
      updatedAt: Date.now()
    };

    updateMemberStatus(user.id, {
      playbackStatus: controllerState.isPlaying ? "Playing" : "Paused",
      trackTitle: controllerState.trackTitle,
      followingRoom: true,
      currentSeconds: controllerState.currentSeconds,
      isPlaying: controllerState.isPlaying
    });

    emitControllerUpdate();
  });

  socket.on("vote:next", async (data) => {
    try {
      if (!data || data.csrfToken !== userSession.csrfToken) {
        return;
      }

      const firstVote = !nextVotes.has(user.id);
      nextVotes.set(user.id, user.username);

      if (firstVote) {
        await writeAudit(
          user.id,
          "player.vote_next",
          "Voted to advance to the next track"
        );
      }

      const voteState = getVoteState();
      io.emit("vote:update", voteState);

      if (voteState.count >= voteState.required) {
        io.emit("room:system", {
          text: "Majority vote passed. Moving everyone to the next video."
        });

        await startNextTrack(controllerUserId || user.id, {
          forceEveryone: true
        });
      }
    } catch (err) {
      console.error("Vote next error:", err);
    }
  });

  socket.on("disconnect", () => {
    removeSocketFromPresence(socket, user);

    writeSecurityEvent({
      eventType: "socket.disconnected",
      severity: "INFO",
      actorUserId: user.id,
      usernameSnapshot: user.username,
      outcome: "success",
      route: "socket.io",
      sessionRef: makeSessionRef(socket.request.sessionID)
    }).catch((err) => console.error("Socket disconnect security log error:", err));
  });
});

/* -------------------------
   Start
------------------------- */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully.`);

  clearInterval(sessionCleanupTimer);

  try {
    await db.checkpoint("TRUNCATE");
  } catch (err) {
    console.error("SQLite checkpoint during shutdown failed:", err);
  }

  try {
    await new Promise((resolve) => {
      io.close(() => resolve());
    });
  } catch (err) {
    console.error("Socket.IO shutdown error:", err);
  }

  try {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  } catch (err) {
    console.error("HTTP server shutdown error:", err);
  }

  try {
    await db.close();
  } catch (err) {
    console.error("SQLite close error:", err);
  }

  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((err) => {
    console.error("Shutdown error:", err);
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((err) => {
    console.error("Shutdown error:", err);
    process.exit(1);
  });
});

async function startServer() {
  await db.ready;
  await ensureBootstrapAdmin();

  server.listen(PORT, HOST, () => {
    console.log(
      `Secure Lo-Fi Study Café listening on http://${HOST}:${PORT}`
    );
    console.log(`SQLite database: ${db.path}`);
    console.log(
      `Proxy trust: ${TRUST_PROXY ? "loopback proxy only" : "disabled"}; secure cookies: ${COOKIE_SECURE}`
    );
  });
}

startServer().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});