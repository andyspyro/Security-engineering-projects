"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { io } = require("socket.io-client");

const projectDir = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "secure-lofi-multiclient-")
);
const databasePath = path.join(tempDir, "integration.db");
const port = 32123;
const baseUrl = `http://127.0.0.1:${port}`;

const adminUsername = "integration_admin";
const adminPassword = "IntegrationAdmin!123";
const bunnyUsername = "bunny";
const bunnyPassword = "BunnyIntegration!123";

let serverProcess = null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractCookie(response, currentCookie = "") {
  const raw = response.headers.get("set-cookie");
  if (!raw) {
    return currentCookie;
  }

  const first = raw.split(";")[0];
  return first || currentCookie;
}

async function http(pathname, {
  method = "GET",
  cookie = "",
  csrfToken = "",
  origin = "",
  body
} = {}) {
  const headers = {
    Accept: "application/json"
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  if (origin) {
    headers.Origin = origin;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(baseUrl + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let payload = null;
  const text = await response.text();

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return {
    response,
    payload,
    cookie: extractCookie(response, cookie)
  };
}

async function newBrowserSession() {
  const csrf = await http("/api/auth/csrf");
  assert(csrf.response.ok, "Could not establish CSRF session.");

  return {
    cookie: csrf.cookie,
    csrfToken: csrf.payload.csrfToken
  };
}

async function login(username, password) {
  const browser = await newBrowserSession();

  const result = await http("/api/auth/login", {
    method: "POST",
    cookie: browser.cookie,
    csrfToken: browser.csrfToken,
    body: { username, password }
  });

  assert(
    result.response.status === 200,
    `Login failed for ${username}: ${result.response.status} ${JSON.stringify(result.payload)}`
  );

  return {
    cookie: result.cookie,
    csrfToken: result.payload.csrfToken,
    user: result.payload.user
  };
}

async function registerBunny() {
  const browser = await newBrowserSession();

  const result = await http("/api/auth/register", {
    method: "POST",
    cookie: browser.cookie,
    csrfToken: browser.csrfToken,
    body: {
      username: bunnyUsername,
      password: bunnyPassword
    }
  });

  assert(
    result.response.status === 201,
    `Bunny registration failed: ${result.response.status} ${JSON.stringify(result.payload)}`
  );
}

function waitForEvent(socket, eventName, predicate = () => true, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function handler(payload) {
      try {
        if (!predicate(payload)) {
          return;
        }

        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(payload);
      } catch (err) {
        clearTimeout(timer);
        socket.off(eventName, handler);
        reject(err);
      }
    }

    socket.on(eventName, handler);
  });
}

async function connectSocket(session) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
    extraHeaders: {
      Cookie: session.cookie,
      Origin: baseUrl
    }
  });

  const readyPromise = waitForEvent(
    socket,
    "room:ready",
    (payload) => payload && payload.roomId === 1
  );

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Socket connection timed out."));
    }, 7000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });

    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  await readyPromise;
  return socket;
}

async function waitForHealth() {
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    try {
      const result = await http("/api/health");
      if (
        result.response.status === 200 &&
        result.payload &&
        result.payload.status === "ok"
      ) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Server did not become healthy.");
}

async function startServer() {
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: projectDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      TRUST_PROXY: "false",
      COOKIE_SECURE: "false",
      PUBLIC_ORIGIN: baseUrl,
      DB_PATH: databasePath,
      SESSION_SECRET:
        "integration-session-secret-0123456789abcdef0123456789abcdef",
      ADMIN_USERNAME: adminUsername,
      ADMIN_PASSWORD: adminPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });

  serverProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  serverProcess.once("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(`Server exited with code ${code}.\n`);
    }
  });

  await waitForHealth();
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  serverProcess.kill("SIGTERM");

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
      resolve();
    }, 5000);

    serverProcess.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  await startServer();

  const admin = await login(adminUsername, adminPassword);
  assert(admin.user.role === "admin", "Configured admin did not receive admin role.");

  await registerBunny();
  const bunny = await login(bunnyUsername, bunnyPassword);
  assert(bunny.user.role === "user", "Bunny was not created as a regular user.");

  const bunnyMe = await http("/api/auth/me", {
    cookie: bunny.cookie
  });
  assert(
    bunnyMe.response.status === 200 &&
      bunnyMe.payload.user.role === "user",
    "Bunny identity endpoint returned the wrong role."
  );

  const bunnyAdminAttempt = await http("/api/admin/users", {
    cookie: bunny.cookie
  });
  assert(
    bunnyAdminAttempt.response.status === 403,
    `Bunny admin API attempt should return 403, got ${bunnyAdminAttempt.response.status}.`
  );

  const bunnyAdminPage = await http("/admin", {
    cookie: bunny.cookie
  });
  assert(
    bunnyAdminPage.response.status === 403,
    `Bunny admin page attempt should return 403, got ${bunnyAdminPage.response.status}.`
  );

  const bunnySecurityPage = await http("/security", {
    cookie: bunny.cookie
  });
  assert(
    bunnySecurityPage.response.status === 403,
    `Bunny security page attempt should return 403, got ${bunnySecurityPage.response.status}.`
  );

  const crossOriginAttempt = await http("/api/auth/me", {
    cookie: bunny.cookie,
    origin: "https://evil.example"
  });
  assert(
    crossOriginAttempt.response.status === 403,
    `Unapproved API origin should return 403, got ${crossOriginAttempt.response.status}.`
  );

  const adminUsers = await http("/api/admin/users", {
    cookie: admin.cookie
  });
  assert(adminUsers.response.status === 200, "Admin could not read user directory.");
  assert(
    adminUsers.payload.users.some((user) => user.username === bunnyUsername),
    "Admin directory did not contain Bunny."
  );

  const adminSocket = await connectSocket(admin);

  const adminSnapshot = await new Promise((resolve, reject) => {
    adminSocket
      .timeout(5000)
      .emit("room:sync-request", (error, response) => {
        if (error) {
          reject(error);
          return;
        }

        if (
          !response ||
          !response.ok ||
          !response.snapshot ||
          !Array.isArray(response.snapshot.members)
        ) {
          reject(
            new Error(
              "Admin did not receive an authoritative room snapshot."
            )
          );
          return;
        }

        resolve(response.snapshot);
      });
  });

  assert(
    adminSnapshot.members.some(
      (member) => member.username === adminUsername
    ),
    "Admin room snapshot did not contain the admin."
  );

  const bunnyAppears = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      payload.members.some((member) => member.username === bunnyUsername)
  );

  const bunnySocketOne = await connectSocket(bunny);
  await bunnyAppears;

  const bunnyTwoTabs = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) => {
      if (!Array.isArray(payload.members)) {
        return false;
      }

      const bunnyMembers = payload.members.filter(
        (member) => member.username === bunnyUsername
      );

      return (
        bunnyMembers.length === 1 &&
        Number(bunnyMembers[0].connectionCount) >= 2
      );
    }
  );

  const bunnySocketTwo = await connectSocket(bunny);
  await bunnyTwoTabs;

  bunnySocketOne.disconnect();

  const bunnyStillOnline = await waitForEvent(
    adminSocket,
    "presence:update",
    (payload) => {
      if (!Array.isArray(payload.members)) {
        return false;
      }

      const bunnyMembers = payload.members.filter(
        (member) => member.username === bunnyUsername
      );

      return (
        bunnyMembers.length === 1 &&
        Number(bunnyMembers[0].connectionCount) === 1
      );
    }
  );

  assert(
    bunnyStillOnline.members.filter(
      (member) => member.username === bunnyUsername
    ).length === 1,
    "Multiple Bunny tabs created duplicate visible users."
  );

  const adminSeesWatchingStatus = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      payload.members.some(
        (member) =>
          member.username === bunnyUsername &&
          member.availabilityStatus === "watching"
      )
  );

  const availabilityAck = await new Promise((resolve, reject) => {
    bunnySocketTwo
      .timeout(5000)
      .emit(
        "member:availability",
        {
          status: "watching",
          csrfToken: bunny.csrfToken
        },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        }
      );
  });

  assert(
    availabilityAck && availabilityAck.ok,
    "Bunny availability update was rejected."
  );
  await adminSeesWatchingStatus;

  const adminReceivesTyping = waitForEvent(
    adminSocket,
    "chat:typing",
    (payload) =>
      payload &&
      payload.username === bunnyUsername &&
      payload.typing === true
  );

  bunnySocketTwo.emit("chat:typing", { typing: true });
  await adminReceivesTyping;
  bunnySocketTwo.emit("chat:typing", { typing: false });

  const adminReceivesMovement = waitForEvent(
    adminSocket,
    "member:moved",
    (payload) =>
      payload &&
      Number(payload.userId) === Number(bunny.user.id) &&
      Math.abs(Number(payload.x) - 72) < 0.01 &&
      Math.abs(Number(payload.y) - 64) < 0.01
  );

  bunnySocketTwo.emit("member:move", {
    x: 72,
    y: 64
  });

  await adminReceivesMovement;

  const adminReceivesMessage = waitForEvent(
    adminSocket,
    "chat:new",
    (message) =>
      message &&
      message.username === bunnyUsername &&
      message.message_text === "hello from bunny"
  );

  const adminReceivesLiveOps = waitForEvent(
    adminSocket,
    "admin:activity",
    (event) =>
      event &&
      event.type === "chat.message" &&
      event.username === bunnyUsername
  );

  bunnySocketTwo.emit("chat:send", {
    message: "hello from bunny",
    csrfToken: bunny.csrfToken
  });

  const message = await adminReceivesMessage;
  await adminReceivesLiveOps;
  assert(message.id, "Realtime chat message did not contain a database ID.");

  const bunnyReceivesReaction = waitForEvent(
    bunnySocketTwo,
    "message:reactions",
    (payload) =>
      payload &&
      Number(payload.messageId) === Number(message.id) &&
      Array.isArray(payload.reactions) &&
      payload.reactions.some(
        (reaction) => reaction.emoji === "💜" && Number(reaction.count) === 1
      )
  );

  const reactionAck = await new Promise((resolve, reject) => {
    adminSocket
      .timeout(5000)
      .emit(
        "chat:react",
        {
          messageId: message.id,
          emoji: "💜",
          csrfToken: admin.csrfToken
        },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        }
      );
  });

  assert(
    reactionAck && reactionAck.ok,
    "Admin reaction to Bunny message was rejected."
  );
  await bunnyReceivesReaction;

  const bunnyReceivesReply = waitForEvent(
    bunnySocketTwo,
    "chat:new",
    (reply) =>
      reply &&
      reply.username === adminUsername &&
      Number(reply.reply_to_message_id) === Number(message.id) &&
      reply.reply_username === bunnyUsername
  );

  adminSocket.emit("chat:send", {
    message: "@bunny keep studying!",
    replyToMessageId: message.id,
    csrfToken: admin.csrfToken
  });

  const replyMessage = await bunnyReceivesReply;
  assert(
    replyMessage.reply_message_text === "hello from bunny",
    "Reply event did not contain the referenced message preview."
  );

  const persistedMessages = await http("/api/rooms/1/messages", {
    cookie: admin.cookie
  });

  assert(
    persistedMessages.response.status === 200 &&
      persistedMessages.payload.messages.some(
        (item) =>
          item.id === message.id &&
          item.message_text === "hello from bunny"
      ),
    "Realtime message was not persisted in SQLite."
  );

  const persistedOriginal = persistedMessages.payload.messages.find(
    (item) => item.id === message.id
  );
  const persistedReply = persistedMessages.payload.messages.find(
    (item) => item.id === replyMessage.id
  );

  assert(
    persistedOriginal &&
      Array.isArray(persistedOriginal.reactions) &&
      persistedOriginal.reactions.some(
        (reaction) => reaction.emoji === "💜" && Number(reaction.count) === 1
      ),
    "Message reaction was not persisted."
  );

  assert(
    persistedReply &&
      Number(persistedReply.reply_to_message_id) === Number(message.id),
    "Message reply relationship was not persisted."
  );

  const bunnyLeavesAfterNetworkLoss = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      !payload.members.some((member) => member.username === bunnyUsername)
  );

  bunnySocketTwo.disconnect();
  await bunnyLeavesAfterNetworkLoss;

  const bunnyReconnects = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      payload.members.some(
        (member) =>
          member.username === bunnyUsername &&
          Number(member.connectionCount) === 1
      )
  );

  const bunnySocketThree = await connectSocket(bunny);
  await bunnyReconnects;

  const bunnyLogoutPresence = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      !payload.members.some((member) => member.username === bunnyUsername)
  );

  const bunnyLogout = await http("/api/auth/logout", {
    method: "POST",
    cookie: bunny.cookie,
    csrfToken: bunny.csrfToken
  });

  assert(
    bunnyLogout.response.status === 204,
    `Bunny logout should return 204, got ${bunnyLogout.response.status}.`
  );

  await bunnyLogoutPresence;
  bunnySocketThree.disconnect();

  const stillRegistered = await http("/api/admin/users", {
    cookie: admin.cookie
  });

  assert(
    stillRegistered.payload.users.some((user) => user.username === bunnyUsername),
    "Bunny account disappeared after disconnect."
  );

  adminSocket.disconnect();
  await stopServer();

  await startServer();

  const adminAfterRestart = await login(adminUsername, adminPassword);
  const messagesAfterRestart = await http("/api/rooms/1/messages", {
    cookie: adminAfterRestart.cookie
  });

  assert(
    messagesAfterRestart.response.status === 200 &&
      messagesAfterRestart.payload.messages.some(
        (item) => item.message_text === "hello from bunny"
      ),
    "Persisted message disappeared after server restart."
  );

  const usersAfterRestart = await http("/api/admin/users", {
    cookie: adminAfterRestart.cookie
  });

  assert(
    usersAfterRestart.payload.users.some((user) => user.username === bunnyUsername),
    "Bunny account disappeared after server restart."
  );

  console.log("Multi-client integration test passed.");
  console.log("Verified:");
  console.log("- permanent admin and regular Bunny accounts");
  console.log("- Bunny receives user role");
  console.log("- Bunny admin page/API and security page return 403");
  console.log("- unapproved API origin returns 403");
  console.log("- realtime cross-client presence");
  console.log("- multiple tabs collapse to one visible user with connection counting");
  console.log("- realtime avatar movement deltas");
  console.log("- server-authoritative availability states");
  console.log("- realtime typing indicators");
  console.log("- admin-only live operations events");
  console.log("- realtime cross-client chat");
  console.log("- persistent replies and emoji reactions");
  console.log("- persisted messages");
  console.log("- network-style disconnect and authenticated reconnect");
  console.log("- explicit logout removes Bunny from live presence");
  console.log("- account/message persistence across server restart");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    });
  });
