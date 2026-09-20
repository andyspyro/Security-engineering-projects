"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { io } = require("socket.io-client");

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "secure-lofi-integration-")
);
const dbPath = path.join(tempDir, "integration.db");
const port = 43127;
const baseUrl = `http://127.0.0.1:${port}`;

const adminUsername = "admin";
const adminPassword = "AdminIntegrationPassword!2026";
const bunnyUsername = "bunny";
const bunnyPassword = "BunnyIntegrationPassword!2026";

let child = null;

class CookieClient {
  constructor() {
    this.cookie = "";
  }

  async request(urlPath, options = {}) {
    const headers = new Headers(options.headers || {});

    if (this.cookie) {
      headers.set("Cookie", this.cookie);
    }

    const response = await fetch(baseUrl + urlPath, {
      ...options,
      headers,
      redirect: "manual"
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }

    return response;
  }

  async json(urlPath, options = {}) {
    const response = await this.request(urlPath, options);
    let body = null;

    if (response.status !== 204) {
      body = await response.json();
    }

    return { response, body };
  }
}

function startServer() {
  child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      TRUST_PROXY: "false",
      COOKIE_SECURE: "false",
      DB_PATH: dbPath,
      SESSION_SECRET:
        "integration-session-secret-0123456789abcdef0123456789abcdef",
      ADMIN_USERNAME: adminUsername,
      ADMIN_PASSWORD: adminPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(
        `Server exited unexpectedly (code=${code}, signal=${signal}).`
      );
    }
  });

  return child;
}

async function stopServer() {
  if (!child || child.exitCode !== null) {
    return;
  }

  const processToStop = child;

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      processToStop.kill("SIGKILL");
      resolve();
    }, 5000);

    processToStop.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    processToStop.kill("SIGTERM");
  });

  child = null;
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok") {
          return;
        }
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Server did not become healthy in time.");
}

function waitForSocketEvent(socket, eventName, predicate = () => true, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function handler(payload) {
      try {
        if (!predicate(payload)) {
          return;
        }

        clearTimeout(timeout);
        socket.off(eventName, handler);
        resolve(payload);
      } catch (err) {
        clearTimeout(timeout);
        socket.off(eventName, handler);
        reject(err);
      }
    }

    socket.on(eventName, handler);
  });
}

async function getCsrf(client) {
  const { response, body } = await client.json("/api/auth/csrf");

  if (!response.ok || !body || !body.csrfToken) {
    throw new Error("Could not obtain CSRF token.");
  }

  return body.csrfToken;
}

async function login(client, username, password) {
  const csrfToken = await getCsrf(client);

  const { response, body } = await client.json("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken
    },
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    throw new Error(
      `Login failed for ${username}: HTTP ${response.status} ${JSON.stringify(body)}`
    );
  }

  return body;
}

async function registerBunny(client) {
  const csrfToken = await getCsrf(client);

  const { response, body } = await client.json("/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken
    },
    body: JSON.stringify({
      username: bunnyUsername,
      password: bunnyPassword
    })
  });

  if (response.status !== 201) {
    throw new Error(
      `Bunny registration failed: HTTP ${response.status} ${JSON.stringify(body)}`
    );
  }

  if (!body.user || body.user.role !== "user") {
    throw new Error("Bunny was not provisioned as a regular user.");
  }
}

function connectSocket(client) {
  return io(baseUrl, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    timeout: 5000,
    extraHeaders: {
      Cookie: client.cookie
    }
  });
}

async function waitForConnect(socket) {
  if (socket.connected) {
    return;
  }

  await Promise.race([
    waitForSocketEvent(socket, "connect", () => true, 7000),
    waitForSocketEvent(
      socket,
      "connect_error",
      () => true,
      7000
    ).then((error) => {
      throw error;
    })
  ]);
}

async function assertBunnyHasNoAdminUi(client) {
  const response = await client.request("/cafe");
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Bunny cafe page failed: HTTP ${response.status}`);
  }

  if (
    html.includes("Admin Console") ||
    html.includes("Security Engineering")
  ) {
    throw new Error("Regular user received administrator-only UI controls.");
  }

  const adminPage = await client.request("/admin");
  if (adminPage.status !== 403) {
    throw new Error(
      `Expected Bunny GET /admin to return 403, got ${adminPage.status}.`
    );
  }

  const adminApi = await client.request("/api/admin/users", {
    headers: {
      Accept: "application/json"
    }
  });

  if (adminApi.status !== 403) {
    throw new Error(
      `Expected Bunny GET /api/admin/users to return 403, got ${adminApi.status}.`
    );
  }
}

async function main() {
  const adminClient = new CookieClient();
  const bunnyRegistrationClient = new CookieClient();
  const bunnyClient = new CookieClient();

  console.log("Starting first application instance...");
  startServer();
  await waitForHealth();

  await registerBunny(bunnyRegistrationClient);

  const adminLogin = await login(
    adminClient,
    adminUsername,
    adminPassword
  );

  const bunnyLogin = await login(
    bunnyClient,
    bunnyUsername,
    bunnyPassword
  );

  if (adminLogin.user.role !== "admin") {
    throw new Error("Configured administrator did not receive admin role.");
  }

  if (bunnyLogin.user.role !== "user") {
    throw new Error("Bunny did not receive regular-user role.");
  }

  await assertBunnyHasNoAdminUi(bunnyClient);

  const adminSocket = connectSocket(adminClient);
  await waitForConnect(adminSocket);

  const adminSnapshot = await new Promise((resolve, reject) => {
    adminSocket
      .timeout(5000)
      .emit("room:sync-request", (err, response) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
  });

  if (
    !adminSnapshot ||
    !adminSnapshot.ok ||
    !adminSnapshot.snapshot.members.some(
      (member) => member.username === adminUsername
    )
  ) {
    throw new Error("Admin did not receive authoritative room snapshot.");
  }

  const bunnyJoined = waitForSocketEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      payload.members.some(
        (member) =>
          member.username === bunnyUsername &&
          member.role === "user"
      )
  );

  const bunnySocket = connectSocket(bunnyClient);
  await waitForConnect(bunnySocket);
  await bunnyJoined;

  const membersResponse = await adminClient.json("/api/rooms/1/members");
  if (
    !membersResponse.response.ok ||
    !membersResponse.body.members.some(
      (member) => member.username === bunnyUsername
    )
  ) {
    throw new Error(
      "Authoritative members API did not show Bunny online."
    );
  }

  const messageSeen = waitForSocketEvent(
    adminSocket,
    "message:created",
    (message) =>
      message &&
      message.username === bunnyUsername &&
      message.message_text === "hello from bunny"
  );

  bunnySocket.emit("chat:send", {
    csrfToken: bunnyLogin.csrfToken,
    message: "hello from bunny"
  });

  const deliveredMessage = await messageSeen;

  const persistedMessages = await adminClient.json(
    "/api/rooms/1/messages"
  );

  if (
    !persistedMessages.response.ok ||
    !persistedMessages.body.messages.some(
      (message) => message.id === deliveredMessage.id
    )
  ) {
    throw new Error(
      "Realtime Bunny message was not persisted in the database."
    );
  }

  const bunnyLeft = waitForSocketEvent(
    adminSocket,
    "presence:update",
    (payload) =>
      Array.isArray(payload.members) &&
      !payload.members.some(
        (member) => member.username === bunnyUsername
      )
  );

  const logoutResponse = await bunnyClient.request("/api/auth/logout", {
    method: "POST",
    headers: {
      "X-CSRF-Token": bunnyLogin.csrfToken
    }
  });

  if (logoutResponse.status !== 204) {
    throw new Error(
      `Bunny logout failed: HTTP ${logoutResponse.status}`
    );
  }

  await bunnyLeft;

  bunnySocket.close();
  adminSocket.close();

  console.log("Restarting server to verify persistence...");
  await stopServer();

  startServer();
  await waitForHealth();

  const bunnyAfterRestart = new CookieClient();
  const persistedLogin = await login(
    bunnyAfterRestart,
    bunnyUsername,
    bunnyPassword
  );

  if (
    !persistedLogin.user ||
    persistedLogin.user.username !== bunnyUsername ||
    persistedLogin.user.role !== "user"
  ) {
    throw new Error(
      "Bunny account did not persist across server restart."
    );
  }

  const history = await bunnyAfterRestart.json("/api/rooms/1/messages");

  if (
    !history.response.ok ||
    !history.body.messages.some(
      (message) => message.id === deliveredMessage.id
    )
  ) {
    throw new Error(
      "Persisted chat did not survive server restart."
    );
  }

  console.log("");
  console.log("Multi-user integration test passed.");
  console.log("Verified:");
  console.log("  - persistent admin and Bunny accounts");
  console.log("  - Bunny role=user");
  console.log("  - admin-only page/API returns 403 for Bunny");
  console.log("  - two independent authenticated Socket.IO clients");
  console.log("  - admin receives Bunny presence without refresh");
  console.log("  - realtime Bunny chat delivery");
  console.log("  - chat database persistence");
  console.log("  - Bunny logout removes live presence");
  console.log("  - account/message persistence across server restart");
}

async function cleanup() {
  await stopServer();
  fs.rmSync(tempDir, {
    recursive: true,
    force: true
  });
}

main()
  .then(cleanup)
  .catch(async (err) => {
    console.error(err);
    await cleanup();
    process.exit(1);
  });
