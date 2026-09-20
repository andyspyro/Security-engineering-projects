"use strict";

const express = require("express");
const bcrypt = require("bcrypt");

function jsonError(res, status, code, message) {
  return res.status(status).json({
    error: {
      code,
      message
    }
  });
}

function parsePositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function createApiRouter({
  db,
  io,
  presence,
  defaultRoomId,
  adminUsername,
  censorBadWords,
  writeAudit,
  writeSecurityEvent,
  makeSessionRef,
  authLimiter
}) {
  const router = express.Router();

  router.use(express.json({ limit: "32kb" }));

  async function refreshAuthenticatedUser(req) {
    const sessionUser = req.session && req.session.user;

    if (!sessionUser || !sessionUser.id) {
      return null;
    }

    const user = await db.get(
      "SELECT id, username, role FROM users WHERE id = ?",
      [sessionUser.id]
    );

    if (!user) {
      return null;
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    return req.session.user;
  }

  async function requireApiLogin(req, res, next) {
    try {
      const user = await refreshAuthenticatedUser(req);

      if (!user) {
        return jsonError(
          res,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required."
        );
      }

      next();
    } catch (err) {
      console.error("API authentication check failed:", err);
      jsonError(res, 500, "INTERNAL_ERROR", "Unexpected server failure.");
    }
  }

  async function requireApiAdmin(req, res, next) {
    try {
      const user = await refreshAuthenticatedUser(req);

      if (!user) {
        return jsonError(
          res,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required."
        );
      }

      if (user.role !== "admin") {
        await writeSecurityEvent({
          eventType: "authorization.api_admin_denied",
          severity: "HIGH",
          actorUserId: user.id,
          usernameSnapshot: user.username,
          outcome: "blocked",
          httpMethod: req.method,
          route: req.originalUrl,
          requestId: req.requestId,
          sessionRef: makeSessionRef(req.sessionID)
        });

        return jsonError(
          res,
          403,
          "FORBIDDEN",
          "Administrator permission is required."
        );
      }

      next();
    } catch (err) {
      console.error("API admin check failed:", err);
      jsonError(res, 500, "INTERNAL_ERROR", "Unexpected server failure.");
    }
  }

  function verifyApiCsrf(req, res, next) {
    const supplied = req.get("X-CSRF-Token");

    if (
      !req.session ||
      !req.session.csrfToken ||
      !supplied ||
      supplied !== req.session.csrfToken
    ) {
      const sessionUser = req.session && req.session.user;

      writeSecurityEvent({
        eventType: "csrf.api_validation_failed",
        severity: "HIGH",
        actorUserId: sessionUser ? sessionUser.id : null,
        usernameSnapshot: sessionUser ? sessionUser.username : null,
        outcome: "blocked",
        httpMethod: req.method,
        route: req.originalUrl,
        requestId: req.requestId,
        sessionRef: makeSessionRef(req.sessionID)
      }).catch((err) => {
        console.error("API CSRF security log failed:", err);
      });

      return jsonError(
        res,
        403,
        "CSRF_VALIDATION_FAILED",
        "Invalid security token."
      );
    }

    next();
  }

  async function getRoom(roomId) {
    return db.get(
      "SELECT id, slug, name, created_at, updated_at FROM rooms WHERE id = ?",
      [roomId]
    );
  }

  router.get("/health", async (req, res) => {
    try {
      const row = await db.get("SELECT 1 AS ok");
      if (!row || row.ok !== 1) {
        return res.status(503).json({ status: "unhealthy" });
      }

      res.json({ status: "ok" });
    } catch (err) {
      console.error("API healthcheck database failure:", err);
      res.status(503).json({ status: "unhealthy" });
    }
  });

  router.get("/auth/csrf", (req, res) => {
    res.json({ csrfToken: req.session.csrfToken });
  });

  router.get("/auth/me", requireApiLogin, async (req, res) => {
    const profile = await db.get(
      `
      SELECT user_profiles.display_name,
             user_profiles.avatar_style,
             user_profiles.last_seen_at
      FROM user_profiles
      WHERE user_id = ?
      `,
      [req.session.user.id]
    );

    res.json({
      user: {
        ...req.session.user,
        displayName:
          profile && profile.display_name
            ? profile.display_name
            : req.session.user.username,
        avatarStyle: profile ? profile.avatar_style : "latte",
        lastSeenAt: profile ? profile.last_seen_at : null
      },
      csrfToken: req.session.csrfToken
    });
  });

  router.post("/auth/register", authLimiter, verifyApiCsrf, async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
      return jsonError(
        res,
        400,
        "INVALID_USERNAME",
        "Username must be 3-30 letters, numbers, or underscores."
      );
    }

    if (password.length < 12 || password.length > 200) {
      return jsonError(
        res,
        400,
        "INVALID_PASSWORD",
        "Password must be between 12 and 200 characters."
      );
    }

    try {
      const existing = await db.get(
        "SELECT id FROM users WHERE username = ?",
        [username]
      );

      if (existing) {
        return jsonError(
          res,
          409,
          "USERNAME_CONFLICT",
          "That username is already registered."
        );
      }

      const passwordHash = await bcrypt.hash(password, 12);

      await db.exec("BEGIN IMMEDIATE");
      let userId;

      try {
        const created = await db.run(
          "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')",
          [username, passwordHash]
        );

        userId = created.lastID;

        await db.run(
          `
          INSERT INTO user_profiles (user_id, display_name, last_seen_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          `,
          [userId, username]
        );

        await db.run(
          `
          INSERT INTO room_memberships (room_id, user_id, last_joined_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          `,
          [defaultRoomId, userId]
        );

        await db.exec("COMMIT");
      } catch (err) {
        await db.exec("ROLLBACK");
        throw err;
      }

      await writeAudit(
        userId,
        "account.register",
        "Account registered as user",
        { details: { username, role: "user" } }
      );

      res.status(201).json({
        user: {
          id: userId,
          username,
          role: "user"
        }
      });
    } catch (err) {
      console.error("API registration error:", err);

      if (String(err.message || "").includes("UNIQUE")) {
        return jsonError(
          res,
          409,
          "USERNAME_CONFLICT",
          "That username is already registered."
        );
      }

      jsonError(res, 500, "INTERNAL_ERROR", "Unexpected server failure.");
    }
  });

  router.post("/auth/login", authLimiter, verifyApiCsrf, async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return jsonError(
        res,
        400,
        "INVALID_CREDENTIAL_INPUT",
        "Username and password are required."
      );
    }

    try {
      const user = await db.get(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
        [username]
      );

      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        await writeSecurityEvent({
          eventType: "auth.api_login_failed",
          severity: "WARNING",
          actorUserId: user ? user.id : null,
          usernameSnapshot: username.slice(0, 30),
          outcome: "failed",
          httpMethod: req.method,
          route: req.originalUrl,
          requestId: req.requestId,
          sessionRef: makeSessionRef(req.sessionID),
          metadata: {
            reason: user ? "bad_password" : "unknown_username"
          }
        });

        return jsonError(
          res,
          401,
          "INVALID_CREDENTIALS",
          "Invalid username or password."
        );
      }

      await new Promise((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });

      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role
      };

      req.session.csrfToken = require("crypto")
        .randomBytes(32)
        .toString("hex");

      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      await writeAudit(user.id, "auth.login", "Successful API login");

      await writeSecurityEvent({
        eventType: "auth.api_login_success",
        severity: "INFO",
        actorUserId: user.id,
        usernameSnapshot: user.username,
        outcome: "success",
        httpMethod: req.method,
        route: req.originalUrl,
        requestId: req.requestId,
        sessionRef: makeSessionRef(req.sessionID)
      });

      res.json({
        user: req.session.user,
        csrfToken: req.session.csrfToken
      });
    } catch (err) {
      console.error("API login error:", err);
      jsonError(res, 500, "INTERNAL_ERROR", "Unexpected server failure.");
    }
  });

  router.post(
    "/auth/logout",
    requireApiLogin,
    verifyApiCsrf,
    async (req, res) => {
      const user = req.session.user;

      await writeAudit(user.id, "auth.logout", "API logout");

      const sockets = await io.in(presence.channel(defaultRoomId)).fetchSockets();
      for (const socket of sockets) {
        const socketUser =
          socket.request &&
          socket.request.session &&
          socket.request.session.user;

        if (socketUser && socketUser.id === user.id) {
          socket.disconnect(true);
        }
      }

      await new Promise((resolve) => {
        req.session.destroy(() => resolve());
      });

      res.status(204).end();
    }
  );

  router.get("/users/me", requireApiLogin, async (req, res) => {
    const profile = await db.get(
      `
      SELECT users.id,
             users.username,
             users.role,
             users.created_at,
             user_profiles.display_name,
             user_profiles.avatar_style,
             user_profiles.last_seen_at
      FROM users
      LEFT JOIN user_profiles ON user_profiles.user_id = users.id
      WHERE users.id = ?
      `,
      [req.session.user.id]
    );

    res.json({ user: profile });
  });

  router.get("/rooms", requireApiLogin, async (req, res) => {
    const rooms = await db.all(
      `
      SELECT rooms.id,
             rooms.slug,
             rooms.name,
             rooms.created_at,
             EXISTS(
               SELECT 1
               FROM room_memberships
               WHERE room_memberships.room_id = rooms.id
                 AND room_memberships.user_id = ?
             ) AS is_member
      FROM rooms
      ORDER BY rooms.id ASC
      `,
      [req.session.user.id]
    );

    res.json({ rooms });
  });

  router.get("/rooms/:roomId", requireApiLogin, async (req, res) => {
    const roomId = parsePositiveInt(req.params.roomId);

    if (!roomId) {
      return jsonError(res, 400, "INVALID_ROOM_ID", "Invalid room ID.");
    }

    const room = await getRoom(roomId);

    if (!room) {
      return jsonError(res, 404, "ROOM_NOT_FOUND", "Room not found.");
    }

    res.json({ room });
  });

  router.get("/rooms/:roomId/members", requireApiLogin, async (req, res) => {
    const roomId = parsePositiveInt(req.params.roomId);

    if (!roomId) {
      return jsonError(res, 400, "INVALID_ROOM_ID", "Invalid room ID.");
    }

    const room = await getRoom(roomId);

    if (!room) {
      return jsonError(res, 404, "ROOM_NOT_FOUND", "Room not found.");
    }

    const membership = await db.get(
      `
      SELECT 1 AS allowed
      FROM room_memberships
      WHERE room_id = ? AND user_id = ?
      `,
      [roomId, req.session.user.id]
    );

    if (!membership && req.session.user.role !== "admin") {
      return jsonError(
        res,
        403,
        "ROOM_ACCESS_DENIED",
        "You are not a member of this room."
      );
    }

    res.json({
      room,
      members: presence.getMembers(roomId),
      membership: await presence.getMembershipState(roomId)
    });
  });

  router.post(
    "/rooms/:roomId/join",
    requireApiLogin,
    verifyApiCsrf,
    async (req, res) => {
      const roomId = parsePositiveInt(req.params.roomId);

      if (!roomId) {
        return jsonError(res, 400, "INVALID_ROOM_ID", "Invalid room ID.");
      }

      const room = await getRoom(roomId);

      if (!room) {
        return jsonError(res, 404, "ROOM_NOT_FOUND", "Room not found.");
      }

      await presence.ensureMembership(roomId, req.session.user.id);

      res.json({
        room,
        membership: "joined"
      });
    }
  );

  router.post(
    "/rooms/:roomId/leave",
    requireApiLogin,
    verifyApiCsrf,
    async (req, res) => {
      const roomId = parsePositiveInt(req.params.roomId);

      if (!roomId) {
        return jsonError(res, 400, "INVALID_ROOM_ID", "Invalid room ID.");
      }

      if (roomId === defaultRoomId) {
        return jsonError(
          res,
          409,
          "DEFAULT_ROOM_REQUIRED",
          "The main café room is required for this application."
        );
      }

      await db.run(
        "DELETE FROM room_memberships WHERE room_id = ? AND user_id = ?",
        [roomId, req.session.user.id]
      );

      const sockets = await io.in(presence.channel(roomId)).fetchSockets();

      for (const socket of sockets) {
        const socketUser =
          socket.request &&
          socket.request.session &&
          socket.request.session.user;

        if (socketUser && socketUser.id === req.session.user.id) {
          socket.leave(presence.channel(roomId));
        }
      }

      res.status(204).end();
    }
  );

  router.get("/rooms/:roomId/messages", requireApiLogin, async (req, res) => {
    const roomId = parsePositiveInt(req.params.roomId);

    if (!roomId) {
      return jsonError(res, 400, "INVALID_ROOM_ID", "Invalid room ID.");
    }

    const room = await getRoom(roomId);
    if (!room) {
      return jsonError(res, 404, "ROOM_NOT_FOUND", "Room not found.");
    }

    const membership = await db.get(
      "SELECT 1 AS allowed FROM room_memberships WHERE room_id = ? AND user_id = ?",
      [roomId, req.session.user.id]
    );

    if (!membership && req.session.user.role !== "admin") {
      return jsonError(
        res,
        403,
        "ROOM_ACCESS_DENIED",
        "You are not a member of this room."
      );
    }

    const messages = await db.all(
      `
      SELECT messages.id,
             messages.room_id,
             messages.message_text,
             messages.created_at,
             users.id AS user_id,
             users.username,
             users.role AS user_role
      FROM messages
      JOIN users ON users.id = messages.user_id
      WHERE messages.room_id = ?
        AND messages.deleted_at IS NULL
      ORDER BY messages.created_at DESC, messages.id DESC
      LIMIT 100
      `,
      [roomId]
    );

    res.json({ messages: messages.reverse() });
  });

  router.post(
    "/rooms/:roomId/messages",
    requireApiLogin,
    verifyApiCsrf,
    async (req, res) => {
      const roomId = parsePositiveInt(req.params.roomId);
      const rawMessage = String(req.body.message || "").trim();

      if (!roomId) {
        return jsonError(res, 400, "INVALID_ROOM_ID", "Invalid room ID.");
      }

      if (rawMessage.length < 1 || rawMessage.length > 500) {
        return jsonError(
          res,
          400,
          "INVALID_MESSAGE",
          "Message must be between 1 and 500 characters."
        );
      }

      const membership = await db.get(
        "SELECT 1 AS allowed FROM room_memberships WHERE room_id = ? AND user_id = ?",
        [roomId, req.session.user.id]
      );

      if (!membership) {
        return jsonError(
          res,
          403,
          "ROOM_ACCESS_DENIED",
          "You are not a member of this room."
        );
      }

      const displayed =
        req.session.user.role === "admin"
          ? rawMessage
          : censorBadWords(rawMessage);

      const result = await db.run(
        "INSERT INTO messages (room_id, user_id, message_text) VALUES (?, ?, ?)",
        [roomId, req.session.user.id, displayed]
      );

      const saved = await db.get(
        `
        SELECT messages.id,
               messages.room_id,
               messages.message_text,
               messages.created_at,
               users.id AS user_id,
               users.username,
               users.role AS user_role
        FROM messages
        JOIN users ON users.id = messages.user_id
        WHERE messages.id = ?
        `,
        [result.lastID]
      );

      await writeAudit(
        req.session.user.id,
        "chat.message",
        `Sent room ${roomId} chat message ID ${result.lastID}`,
        {
          details: {
            roomId,
            messageId: result.lastID,
            filteredForNonAdmin: req.session.user.role !== "admin"
          }
        }
      );

      io.to(presence.channel(roomId)).emit("message:created", saved);
      io.to(presence.channel(roomId)).emit("chat:new", saved);

      res.status(201).json({ message: saved });
    }
  );

  router.get("/admin/users", requireApiAdmin, async (req, res) => {
    const users = await db.all(
      `
      SELECT users.id,
             users.username,
             users.role,
             users.created_at,
             user_profiles.display_name,
             user_profiles.last_seen_at
      FROM users
      LEFT JOIN user_profiles ON user_profiles.user_id = users.id
      ORDER BY users.id ASC
      `
    );

    res.json({ users });
  });

  router.patch(
    "/admin/users/:userId/role",
    requireApiAdmin,
    verifyApiCsrf,
    async (req, res) => {
      const userId = parsePositiveInt(req.params.userId);
      const role = String(req.body.role || "").trim();

      if (!userId) {
        return jsonError(res, 400, "INVALID_USER_ID", "Invalid user ID.");
      }

      if (!["admin", "mod", "user"].includes(role)) {
        return jsonError(res, 400, "INVALID_ROLE", "Invalid role.");
      }

      const target = await db.get(
        "SELECT id, username, role FROM users WHERE id = ?",
        [userId]
      );

      if (!target) {
        return jsonError(res, 404, "USER_NOT_FOUND", "User not found.");
      }

      if (
        adminUsername &&
        target.username === adminUsername &&
        role !== "admin"
      ) {
        return jsonError(
          res,
          409,
          "PERMANENT_ADMIN_PROTECTED",
          "The configured permanent administrator cannot be demoted."
        );
      }

      await db.run(
        "UPDATE users SET role = ? WHERE id = ?",
        [role, userId]
      );

      presence.updateMember(defaultRoomId, userId, (member) => {
        member.role = role;
      });

      await writeAudit(
        req.session.user.id,
        "admin.role_change",
        `Changed ${target.username} role from ${target.role} to ${role}`,
        {
          targetUserId: userId,
          details: {
            previousRole: target.role,
            newRole: role
          }
        }
      );

      io.to(presence.channel(defaultRoomId)).emit("presence:update", {
        members: presence.getMembers(defaultRoomId)
      });

      const sockets = await io.in(presence.channel(defaultRoomId)).fetchSockets();

      for (const socket of sockets) {
        const socketUser =
          socket.request &&
          socket.request.session &&
          socket.request.session.user;

        if (socketUser && socketUser.id === userId) {
          socket.request.session.user.role = role;
          socket.request.session.save(() => {});
          socket.emit("authorization:updated", { role });
        }
      }

      res.json({
        user: {
          id: target.id,
          username: target.username,
          role
        }
      });
    }
  );

  router.use((req, res) => {
    jsonError(
      res,
      404,
      "API_ROUTE_NOT_FOUND",
      "Requested API route does not exist."
    );
  });

  router.use((err, req, res, next) => {
    console.error("Unhandled API error:", err);
    if (res.headersSent) {
      return next(err);
    }

    jsonError(
      res,
      500,
      "INTERNAL_ERROR",
      "Unexpected server failure."
    );
  });

  return router;
}

module.exports = createApiRouter;
