(() => {
  "use strict";

  const form = document.getElementById("auth-form");
  const errorBox = document.getElementById("auth-error");

  if (!form) {
    return;
  }

  const mode = form.dataset.authMode;
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  const ACCOUNTS_KEY = "secureLofiDemoAccounts";
  const SESSION_KEY = "secureLofiDemoSession";
  const AUDIT_KEY = "secureLofiDemoAudit";

  const SHOWCASE_ADMIN = Object.freeze({
    username: "admin",
    password: "admin12345",
    role: "admin",
    createdAt: "Built-in cross-device showcase account"
  });

  function logAudit(account, eventType, action, details = {}) {
    let audit = [];

    try {
      const parsed = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
      audit = Array.isArray(parsed) ? parsed : [];
    } catch {
      audit = [];
    }

    audit.push({
      timestamp: new Date().toISOString(),
      eventType,
      actor: account.username,
      role: account.role,
      action,
      details
    });

    localStorage.setItem(AUDIT_KEY, JSON.stringify(audit.slice(-1000)));
  }

  function showError(message) {
    errorBox.hidden = false;
    errorBox.textContent = message;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function getAccounts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
      const accounts = Array.isArray(parsed) ? parsed : [];
      let changed = false;

      const normalized = accounts.map((account) => {
        const isShowcaseAdmin =
          String(account.username || "").toLowerCase() === SHOWCASE_ADMIN.username &&
          account.showcase === true;

        if (!isShowcaseAdmin && account.role !== "user") {
          changed = true;
          return { ...account, role: "user" };
        }

        return account;
      });

      if (changed) {
        saveAccounts(normalized);
      }

      return normalized;
    } catch {
      return [];
    }
  }

  function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  async function derivePassword(password, saltBytes) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes,
        iterations: 100000
      },
      material,
      256
    );

    return new Uint8Array(bits);
  }

  function sameBytes(left, right) {
    if (left.length !== right.length) {
      return false;
    }

    let diff = 0;

    for (let i = 0; i < left.length; i += 1) {
      diff |= left[i] ^ right[i];
    }

    return diff === 0;
  }

  function startSession(account) {
    const normalizedAccount =
      String(account.username || "").toLowerCase() === SHOWCASE_ADMIN.username
        ? { ...account, role: "admin" }
        : { ...account, role: "user" };

    logAudit(normalizedAccount, "auth.login", "Successful login");

    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        username: normalizedAccount.username,
        role: normalizedAccount.role
      })
    );

    window.location.href = "./cafe.html";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const accounts = getAccounts();

    if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
      showError(
        "Username must be 3 to 30 characters and contain only letters, numbers, or underscores."
      );
      return;
    }

    if (password.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }

    if (mode === "register") {
      if (username.toLowerCase() === SHOWCASE_ADMIN.username) {
        showError("That username is reserved for the cross-device showcase administrator.");
        return;
      }

      const exists = accounts.some(
        (account) => account.username.toLowerCase() === username.toLowerCase()
      );

      if (exists) {
        showError("Username is already taken.");
        return;
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const derived = await derivePassword(password, salt);

      const account = {
        username,
        role: "user",
        createdAt: new Date().toISOString(),
        salt: bytesToBase64(salt),
        verifier: bytesToBase64(derived)
      };

      accounts.push(account);
      saveAccounts(accounts);
      logAudit(
        account,
        "account.register",
        `Account registered as ${account.role}`
      );
      startSession(account);
      return;
    }

    if (
      username.toLowerCase() === SHOWCASE_ADMIN.username &&
      password === SHOWCASE_ADMIN.password
    ) {
      const existingShowcase = accounts.find(
        (candidate) =>
          candidate.username.toLowerCase() === SHOWCASE_ADMIN.username
      );

      if (!existingShowcase) {
        accounts.unshift({
          username: SHOWCASE_ADMIN.username,
          role: SHOWCASE_ADMIN.role,
          createdAt: SHOWCASE_ADMIN.createdAt,
          showcase: true
        });
        saveAccounts(accounts);
      }

      startSession(SHOWCASE_ADMIN);
      return;
    }

    const account = accounts.find(
      (candidate) =>
        candidate.username.toLowerCase() === username.toLowerCase()
    );

    if (!account) {
      showError("Invalid username or password.");
      return;
    }

    const derived = await derivePassword(
      password,
      base64ToBytes(account.salt)
    );

    if (!sameBytes(derived, base64ToBytes(account.verifier))) {
      showError("Invalid username or password.");
      return;
    }

    startSession(account);
  });
})();
