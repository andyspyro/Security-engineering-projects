(() => {
  "use strict";

  const SESSION_KEY = "secureLofiDemoSession";
  const ACCOUNTS_KEY = "secureLofiDemoAccounts";
  const AUDIT_KEY = "secureLofiDemoAudit";

  let session;

  try {
    session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    session = null;
  }

  if (
    !session ||
    String(session.username || "").toLowerCase() !== "admin" ||
    session.role !== "admin"
  ) {
    window.location.replace("./cafe.html");
    return;
  }

  const adminUsername = document.getElementById("admin-username");
  const accountBody = document.getElementById("account-table-body");
  const auditBody = document.getElementById("audit-table-body");
  const search = document.getElementById("admin-search");
  const auditCountBadge = document.getElementById("audit-count-badge");
  const logoutButton = document.getElementById("logout-button");
  const downloadButton = document.getElementById("download-report");

  adminUsername.textContent = session.username;

  function loadArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function escapeCsv(value) {
    let text = value === null || value === undefined ? "" : String(value);

    if (/^[=+\-@\t\r]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function safeDetails(details) {
    if (!details || typeof details !== "object") {
      return details ? String(details) : "";
    }

    const copy = { ...details };

    delete copy.password;
    delete copy.verifier;
    delete copy.salt;
    delete copy.session;
    delete copy.token;

    return JSON.stringify(copy);
  }

  const accounts = loadArray(ACCOUNTS_KEY);
  const audit = loadArray(AUDIT_KEY);

  function renderAccounts() {
    accountBody.replaceChildren();

    accounts.forEach((account) => {
      const row = document.createElement("tr");
      row.dataset.adminRow = "";

      const username = document.createElement("td");
      const usernameStrong = document.createElement("strong");
      usernameStrong.textContent = account.username;
      username.appendChild(usernameStrong);

      const role = document.createElement("td");
      role.textContent = account.role || "user";

      const created = document.createElement("td");
      created.textContent = account.createdAt || "Earlier demo account";

      row.append(username, role, created);
      accountBody.appendChild(row);
    });
  }

  function renderAudit() {
    auditBody.replaceChildren();

    [...audit].reverse().forEach((entry) => {
      const row = document.createElement("tr");
      row.dataset.adminRow = "";

      const time = document.createElement("td");
      time.textContent = entry.timestamp || "";

      const actor = document.createElement("td");
      const actorStrong = document.createElement("strong");
      actorStrong.textContent = entry.actor || "system";
      actor.appendChild(actorStrong);

      const role = document.createElement("td");
      role.textContent = entry.role || "";

      const event = document.createElement("td");
      const code = document.createElement("code");
      code.textContent = entry.eventType || "activity";
      event.appendChild(code);

      const action = document.createElement("td");
      action.textContent = entry.action || "";

      const details = document.createElement("td");
      details.className = "admin-details";
      details.textContent = safeDetails(entry.details);

      row.append(time, actor, role, event, action, details);
      auditBody.appendChild(row);
    });

    auditCountBadge.textContent = `${audit.length} shown`;
  }

  function updateStats() {
    document.getElementById("stat-users").textContent = String(accounts.length);
    document.getElementById("stat-events").textContent = String(audit.length);
    document.getElementById("stat-chat").textContent = String(
      audit.filter((entry) => String(entry.eventType || "").startsWith("chat.")).length
    );
    document.getElementById("stat-music").textContent = String(
      audit.filter((entry) => String(entry.eventType || "").startsWith("music.")).length
    );
    document.getElementById("stat-admin").textContent = String(
      audit.filter((entry) => String(entry.eventType || "").startsWith("admin.")).length
    );
  }

  function applySearch() {
    const term = search.value.trim().toLowerCase();
    const rows = Array.from(document.querySelectorAll("[data-admin-row]"));

    rows.forEach((row) => {
      row.hidden = Boolean(term) && !row.textContent.toLowerCase().includes(term);
    });

    const visibleAuditRows = Array.from(auditBody.querySelectorAll("[data-admin-row]"))
      .filter((row) => !row.hidden).length;

    auditCountBadge.textContent = `${visibleAuditRows} shown`;
  }

  function downloadReport() {
    let currentAudit = loadArray(AUDIT_KEY);

    currentAudit.push({
      timestamp: new Date().toISOString(),
      eventType: "admin.report_export",
      actor: session.username,
      role: session.role,
      action: "Downloaded CSV audit report",
      details: {}
    });

    localStorage.setItem(AUDIT_KEY, JSON.stringify(currentAudit.slice(-1000)));
    audit.push(currentAudit[currentAudit.length - 1]);

    const header = [
      "timestamp",
      "actor",
      "role",
      "event_type",
      "action",
      "details"
    ];

    const rows = [
      header.map(escapeCsv).join(","),
      ...currentAudit.map((entry) =>
        [
          entry.timestamp || "",
          entry.actor || "system",
          entry.role || "",
          entry.eventType || "activity",
          entry.action || "",
          safeDetails(entry.details)
        ].map(escapeCsv).join(",")
      )
    ];

    const blob = new Blob(["\uFEFF" + rows.join("\n")], {
      type: "text/csv;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `secure-lofi-admin-audit-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  search.addEventListener("input", applySearch);
  downloadButton.addEventListener("click", downloadReport);

  logoutButton.addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "./index.html";
  });

  renderAccounts();
  renderAudit();
  updateStats();
})();
