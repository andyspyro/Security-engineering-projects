"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { io } = require("socket.io-client");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

function extractCookie(response, fallback = "") {
  const value = response.headers.get("set-cookie");
  if (!value) {
    return fallback;
  }
  return value.split(";")[0];
}

function extractCsrf(html) {
  const match = String(html).match(
    /name="_csrf"\s+value="([^"]+)"/
  );

  if (!match) {
    throw new Error("Could not find CSRF token in HTML response.");
  }

  return match[1];
}

async function requestPage(baseUrl, route, cookie = "") {
  const response = await fetch(baseUrl + route, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual"
  });

  return {
    response,
    cookie: extractCookie(response, cookie),
    body: await response.text()
  };
}

async function submitForm(
  baseUrl,
  route,
  values,
  cookie
) {
  const response = await fetch(baseUrl + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie
    },
    body: new URLSearchParams(values),
    redirect: "manual"
  });

  return {
    response,
    cookie: extractCookie(response, cookie),
    body: await response.text()
  };
}

async function registerUser(baseUrl, username, password) {
  const page = await requestPage(baseUrl, "/register");
  const csrf = extractCsrf(page.body);

  const submitted = await submitForm(
    baseUrl,
    "/register",
    {
      username,
      password,
      _csrf: csrf
    },
    page.cookie
  );

  if (submitted.response.status !== 302) {
    throw new Error(
      `Registration failed for ${username}: HTTP ${submitted.response.status}`
    );
  }
}

async function login(baseUrl, username, password) {
  const page = await requestPage(baseUrl, "/login");
  const csrf = extractCsrf(page.body);

  const submitted = await submitForm(
    baseUrl,
    "/login",
    {
      username,
      password,
      _csrf: csrf
    },
    page.cookie
  );

  if (submitted.response.status !== 302) {
    throw new Error(
      `Login failed for ${username}: HTTP ${submitted.response.status}`
    );
  }

  const cafe = await requestPage(
    baseUrl,
    "/cafe",
    submitted.cookie
  );

  if (cafe.response.status !== 200) {
    throw new Error(
      `Cafe load failed for ${username}: HTTP ${cafe.response.status}`
    );
  }

  return {
    cookie: cafe.cookie,
    csrf: extractCsrf(cafe.body)
  };
}

function waitForSocketEvent(
  socket,
  eventName,
  predicate = () => true,
  timeoutMs = 7000
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(
        new Error(
          `Timed out waiting for Socket.IO event ${eventName}`
        )
      );
    }, timeoutMs);

    function handler(payload) {
      if (!predicate(payload)) {
        return;
      }

      clearTimeout(timeout);
      socket.off(eventName, handler);
      resolve(payload);
    }

    socket.on(eventName, handler);
  });
}

function connectSocket(baseUrl, cookie) {
  return io(baseUrl, {
    autoConnect: false,
    transports: ["websocket", "polling"],
    extraHeaders: {
      Cookie: cookie
    },
    reconnection: false,
    timeout: 5000
  });
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Test server exited early with code ${child.exitCode}`
      );
    }

    try {
      const response = await fetch(baseUrl + "/healthz");
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(150);
  }

  throw new Error("Test server did not become healthy.");
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secure-lofi-realtime-")
  );
  const dbPath = path.join(tempDir, "lofi_cafe.db");

  const adminPassword = "AdminRealtimeTest-2026!";
  const bunnyPassword = "BunnyRealtimeTest-2026!";

  const child = spawn(
    process.execPath,
    ["server.js"],
    {
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
          "realtime-test-session-secret-0123456789abcdef",
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: adminPassword
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let childOutput = "";
  child.stdout.on("data", (chunk) => {
    childOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    childOutput += chunk.toString();
  });

  let adminSocket;
  let bunnySocket;

  try {
    await waitForHealth(baseUrl, child);

    await registerUser(
      baseUrl,
      "bunny",
      bunnyPassword
    );

    const admin = await login(
      baseUrl,
      "admin",
      adminPassword
    );

    const bunny = await login(
      baseUrl,
      "bunny",
      bunnyPassword
    );

    adminSocket = connectSocket(baseUrl, admin.cookie);

    const adminConnected = waitForSocketEvent(
      adminSocket,
      "connect"
    );

    const adminInitial = waitForSocketEvent(
      adminSocket,
      "room:snapshot",
      (snapshot) =>
        Array.isArray(snapshot && snapshot.members) &&
        snapshot.members.some(
          (member) => member.username === "admin"
        )
    );

    adminSocket.connect();
    await adminConnected;
    await adminInitial;

    const adminSeesBunny = waitForSocketEvent(
      adminSocket,
      "presence:update",
      (payload) =>
        Array.isArray(payload && payload.members) &&
        payload.members.some(
          (member) =>
            member.username === "admin" &&
            member.role === "admin"
        ) &&
        payload.members.some(
          (member) =>
            member.username === "bunny" &&
            member.role === "user"
        )
    );

    bunnySocket = connectSocket(baseUrl, bunny.cookie);

    const bunnyConnected = waitForSocketEvent(
      bunnySocket,
      "connect"
    );

    const bunnySeesBoth = waitForSocketEvent(
      bunnySocket,
      "room:snapshot",
      (snapshot) =>
        Array.isArray(snapshot && snapshot.members) &&
        snapshot.members.some(
          (member) => member.username === "admin"
        ) &&
        snapshot.members.some(
          (member) => member.username === "bunny"
        )
    );

    bunnySocket.connect();

    await bunnyConnected;
    await Promise.all([
      adminSeesBunny,
      bunnySeesBoth
    ]);

    const adminReceivesChat = waitForSocketEvent(
      adminSocket,
      "chat:new",
      (message) =>
        message &&
        message.username === "bunny" &&
        message.message_text === "hello from bunny"
    );

    bunnySocket.emit("chat:send", {
      message: "hello from bunny",
      csrfToken: bunny.csrf
    });

    await adminReceivesChat;

    const bunnyAdminResponse = await fetch(
      baseUrl + "/admin",
      {
        headers: {
          Cookie: bunny.cookie
        },
        redirect: "manual"
      }
    );

    if (bunnyAdminResponse.status !== 403) {
      throw new Error(
        `RBAC failed: bunny /admin returned HTTP ${bunnyAdminResponse.status}, expected 403.`
      );
    }

    const adminResponse = await fetch(
      baseUrl + "/admin",
      {
        headers: {
          Cookie: admin.cookie
        },
        redirect: "manual"
      }
    );

    if (adminResponse.status !== 200) {
      throw new Error(
        `Admin console failed: HTTP ${adminResponse.status}`
      );
    }

    bunnySocket.disconnect();

    await waitForSocketEvent(
      adminSocket,
      "presence:update",
      (payload) =>
        Array.isArray(payload && payload.members) &&
        payload.members.some(
          (member) => member.username === "admin"
        ) &&
        !payload.members.some(
          (member) => member.username === "bunny"
        )
    );

    console.log(
      "Realtime integration test passed: admin and bunny shared one authenticated Socket.IO room."
    );
    console.log(
      "Verified join presence, two-way room snapshot state, bunny-to-admin chat, RBAC denial, and disconnect presence."
    );
  } catch (err) {
    console.error(err);
    console.error("\n--- test server output ---");
    console.error(childOutput);
    throw err;
  } finally {
    if (adminSocket) {
      adminSocket.disconnect();
    }
    if (bunnySocket) {
      bunnySocket.disconnect();
    }

    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        delay(3000)
      ]);
    }

    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    });
  }
}

main().catch(() => {
  process.exit(1);
});
