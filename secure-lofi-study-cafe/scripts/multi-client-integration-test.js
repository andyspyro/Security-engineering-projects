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

  const adminUsers = await http("/api/admin/users", {
    cookie: admin.cookie
  });
  assert(adminUsers.response.status === 200, "Admin could not read user directory.");
  assert(
    adminUsers.payload.users.some((user) => user.username === bunnyUsername),
    "Admin directory did not contain Bunny."
  );

  const adminSocket = await connectSocket(admin);
  const adminSnapshotPromise = waitForEvent(
    adminSocket,
    "room:snapshot",
    (snapshot) => Array.isArray(snapshot.members)
  );
  adminSocket.emit("room:sync-request", () => {});
  await adminSnapshotPromise;

  const bunnyAppears = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      payload.members.some((member) => member.username === bunnyUsername)
  );

  const bunnySocketOne = await connectSocket(bunny);
  await bunnyAppears;

  const bunnySocketTwo = await connectSocket(bunny);

  bunnySocketOne.disconnect();

  const bunnyStillOnline = await waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      payload.members.some(
        (member) =>
          member.username === bunnyUsername &&
          Number(member.connectionCount) >= 1
      )
  );

  assert(
    bunnyStillOnline.members.some((member) => member.username === bunnyUsername),
    "Closing one Bunny tab incorrectly marked Bunny offline."
  );

  const adminReceivesMessage = waitForEvent(
    adminSocket,
    "chat:new",
    (message) =>
      message &&
      message.username === bunnyUsername &&
      message.message_text === "hello from bunny"
  );

  bunnySocketTwo.emit("chat:send", {
    message: "hello from bunny",
    csrfToken: bunny.csrfToken
  });

  const message = await adminReceivesMessage;
  assert(message.id, "Realtime chat message did not contain a database ID.");

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

  const bunnyLeaves = waitForEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      !payload.members.some((member) => member.username === bunnyUsername)
  );

  bunnySocketTwo.disconnect();
  await bunnyLeaves;

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
  console.log("- Bunny admin API request returns 403");
  console.log("- realtime cross-client presence");
  console.log("- multiple-tab presence reference counting");
  console.log("- realtime cross-client chat");
  console.log("- persisted messages");
  console.log("- offline transition after final socket disconnect");
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
