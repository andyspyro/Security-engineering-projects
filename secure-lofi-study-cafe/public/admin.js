(() => {
  "use strict";

  const search = document.getElementById("admin-search");
  const inspector = document.getElementById("admin-user-inspector");
  const inspectorContent = document.getElementById(
    "admin-user-inspector-content"
  );

  const rows = Array.from(document.querySelectorAll("[data-admin-row]"));
  const sections = Array.from(document.querySelectorAll("[data-admin-section]"));

  function applyFilter() {
    if (!search) {
      return;
    }

    const term = search.value.trim().toLowerCase();

    rows.forEach((row) => {
      const matches = !term || row.textContent.toLowerCase().includes(term);
      row.hidden = !matches;
    });

    sections.forEach((section) => {
      const sectionRows = Array.from(
        section.querySelectorAll("[data-admin-row]")
      );

      if (!sectionRows.length) {
        return;
      }

      section.hidden = sectionRows.every((row) => row.hidden);
    });
  }

  function browserFromUserAgent(userAgent) {
    const ua = String(userAgent || "");

    const candidates = [
      [/Edg\/([\d.]+)/, "Microsoft Edge"],
      [/OPR\/([\d.]+)/, "Opera"],
      [/Firefox\/([\d.]+)/, "Firefox"],
      [/Chrome\/([\d.]+)/, "Chrome"],
      [/Version\/([\d.]+).*Safari\//, "Safari"]
    ];

    for (const [pattern, name] of candidates) {
      const match = ua.match(pattern);
      if (match) {
        return {
          name,
          version: match[1]
        };
      }
    }

    return {
      name: ua ? "Other / unknown" : "Unavailable",
      version: ""
    };
  }

  function osFromUserAgent(userAgent) {
    const ua = String(userAgent || "");

    if (/Windows NT 10\.0/.test(ua)) return "Windows";
    if (/Android/.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/.test(ua)) return "iOS / iPadOS";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/Linux/.test(ua)) return "Linux";
    return ua ? "Other / unknown" : "Unavailable";
  }

  function deviceFromUserAgent(userAgent) {
    const ua = String(userAgent || "");
    if (/iPad|Tablet/i.test(ua)) return "Tablet";
    if (/Mobile|Android|iPhone|iPod/i.test(ua)) return "Mobile";
    return ua ? "Desktop / laptop" : "Unavailable";
  }

  function addFact(list, label, value) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value || "—";
    list.append(dt, dd);
  }

  function addInspectorSection(title, facts) {
    const section = document.createElement("section");
    section.className = "inspector-section";

    const heading = document.createElement("h3");
    heading.textContent = title;

    const list = document.createElement("dl");
    list.className = "inspector-grid";

    facts.forEach(([label, value]) => {
      addFact(list, label, value);
    });

    section.append(heading, list);
    return section;
  }

  function inspectUser(button) {
    if (!inspector || !inspectorContent) {
      return;
    }

    const browser = browserFromUserAgent(button.dataset.userAgent);
    const created = button.dataset.created
      ? new Date(button.dataset.created).toLocaleString()
      : "—";
    const lastSeen = button.dataset.lastSeen
      ? new Date(button.dataset.lastSeen).toLocaleString()
      : "—";

    inspectorContent.replaceChildren();

    const header = document.createElement("div");
    header.className = "member-profile-header";

    const avatar = document.createElement("span");
    avatar.className = "member-profile-avatar";
    avatar.textContent = (button.dataset.username || "?")
      .slice(0, 1)
      .toUpperCase();

    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent =
      button.dataset.online === "true" ? "Online account" : "Account";

    const title = document.createElement("h2");
    title.textContent = button.dataset.username || "Unknown user";

    const role = document.createElement("p");
    role.className = "member-profile-status";
    role.textContent = button.dataset.role || "user";

    titleWrap.append(eyebrow, title, role);
    header.append(avatar, titleWrap);

    inspectorContent.append(
      header,
      addInspectorSection("Account", [
        ["User ID", button.dataset.userId],
        ["Role", button.dataset.role],
        ["Created", created],
        ["Messages", button.dataset.messages]
      ]),
      addInspectorSection("Connection", [
        [
          "Presence",
          button.dataset.online === "true" ? "Online" : "Offline"
        ],
        ["Active sockets", button.dataset.connections || "0"],
        ["Last activity", lastSeen],
        ["IP address", button.dataset.ip || "Unavailable"],
        ["Device", deviceFromUserAgent(button.dataset.userAgent)],
        ["Operating system", osFromUserAgent(button.dataset.userAgent)],
        [
          "Browser",
          browser.version
            ? `${browser.name} ${browser.version}`
            : browser.name
        ],
        ["User agent", button.dataset.userAgent || "Unavailable"]
      ]),
      addInspectorSection("Security boundary", [
        ["Password", "Never displayed"],
        ["Raw session cookie", "Never displayed"],
        ["Authentication token", "Never displayed"],
        ["Session correlation", "See Sessions / Security Events"]
      ])
    );

    const note = document.createElement("p");
    note.className = "compact";
    note.textContent =
      "IP and client metadata are administrative security data. Raw credentials and session tokens remain hidden.";
    inspectorContent.appendChild(note);

    if (typeof inspector.showModal === "function") {
      inspector.showModal();
    } else {
      inspector.setAttribute("open", "");
    }
  }

  if (search) {
    search.addEventListener("input", applyFilter);
  }

  document.querySelectorAll("[data-admin-inspect]").forEach((button) => {
    button.addEventListener("click", () => inspectUser(button));
  });

  document.querySelectorAll("[data-confirm-revoke]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      const username = form.dataset.confirmRevoke || "this user";
      const confirmed = window.confirm(
        `Revoke every active session for ${username} and disconnect their live sockets?`
      );

      if (!confirmed) {
        event.preventDefault();
      }
    });
  });
})();
