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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required. Copy .env.example to .env and set a random value.");
}

/* -------------------------
   In-memory room state
------------------------- */

const onlineUsers = new Map();
const tempModeratorIds = new Set();
const nextVotes = new Map();

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
  message: "Too many login or registration attempts. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false
});

app.use(generalLimiter);

/* -------------------------
   Sessions
------------------------- */

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60
  }
});

app.use(sessionMiddleware);

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
    return res.status(403).send("Invalid security token.");
  }

  next();
}

/* -------------------------
   Access control
------------------------- */

function requireLogin(req, res, next) {
  if (!req.session.user) {
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
    return res.status(403).send("Access denied.");
  }

  next();
}

function requirePermanentAdmin(req, res, next) {
  if (!isPermanentAdmin(req.session.user)) {
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
    updatedAt: member.updatedAt
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

      const userCount = await db.get("SELECT COUNT(*) AS count FROM users");
      const role = userCount.count === 0 ? "admin" : "user";

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
        return res.status(400).render("login", {
          errors: ["Invalid username or password."]
        });
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatches) {
        return res.status(400).render("login", {
          errors: ["Invalid username or password."]
        });
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role
      };

      await writeAudit(
        user.id,
        "auth.login",
        "Successful login",
        { details: { role: user.role } }
      );

      res.redirect("/cafe");
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
    } catch (err) {
      console.error("Logout audit error:", err);
    }
  }

  req.session.destroy(() => {
    res.redirect("/login");
  });
});

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
      musicRequests: await db.get("SELECT COUNT(*) AS count FROM music_requests")
    };

    res.render("admin", {
      users,
      auditLogs,
      messageHistory,
      musicRequests,
      counts: {
        users: counts.users,
        messages: counts.messages.count,
        activeMessages: counts.activeMessages.count,
        deletedMessages: counts.deletedMessages.count,
        auditEvents: counts.auditEvents.count,
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

  addSocketToPresence(socket, user);

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
  });
});

/* -------------------------
   Start
------------------------- */

server.listen(PORT, () => {
  console.log(`Secure Lo-Fi Study Café running at http://localhost:${PORT}`);
});