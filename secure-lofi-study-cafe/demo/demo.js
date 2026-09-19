(() => {
  "use strict";

  const SESSION_KEY = "secureLofiDemoSession";

  let session;

  try {
    session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    session = null;
  }

  if (!session || !session.username || !session.role) {
    window.location.replace("./index.html");
    return;
  }

  const isAdmin = session.role === "admin";
  const AUDIT_KEY = "secureLofiDemoAudit";

  function logAudit(eventType, action, details = {}) {
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
      actor: session.username,
      role: session.role,
      action,
      details
    });

    localStorage.setItem(AUDIT_KEY, JSON.stringify(audit.slice(-1000)));
  }

  const usernameEl = document.getElementById("session-username");
  const roleEl = document.getElementById("session-role");
  const controllerName = document.getElementById("controller-name");
  const logoutButton = document.getElementById("logout-button");
  const adminConsoleLink = document.getElementById("admin-console-link");
  const queueList = document.getElementById("queue-list");
  const historyList = document.getElementById("history-list");
  const pendingList = document.getElementById("pending-list");
  const pendingSection = document.getElementById("pending-section");
  const requestForm = document.getElementById("request-form");
  const requestTitle = document.getElementById("request-title");
  const requestUrl = document.getElementById("request-url");
  const requestFeedback = document.getElementById("request-feedback");
  const player = document.getElementById("demo-player");
  const nowPlayingTitle = document.getElementById("now-playing-title");
  const requestedByLine = document.getElementById("requested-by-line");
  const playerStatus = document.getElementById("player-status");
  const controllerBadge = document.getElementById("controller-badge");
  const voteCount = document.getElementById("vote-count");
  const adminNextButton = document.getElementById("admin-next-button");
  const membersList = document.getElementById("members-list");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatLog = document.getElementById("chat-log");
  const minimizeChat = document.getElementById("minimize-chat");
  const chatBody = document.getElementById("chat-body");
  const avatarStage = document.getElementById("avatar-stage");
  const avatarLayer = document.getElementById("avatar-layer");
  const floorMemberCount = document.getElementById("floor-member-count");

  usernameEl.textContent = session.username;
  roleEl.textContent = session.role;
  controllerName.textContent = session.username;

  if (adminConsoleLink) {
    adminConsoleLink.hidden = !isAdmin;
  }

  const members = [
    {
      id: 1,
      username: session.username,
      role: session.role,
      controller: isAdmin,
      tempAdmin: false,
      status: "Paused: 0:00 · Synced",
      avatarStyle: "latte",
      avatarX: 36,
      avatarY: 58
    },
    {
      id: 2,
      username: "Test",
      role: "user",
      controller: false,
      tempAdmin: false,
      status: "Paused: 0:00 · Independent",
      avatarStyle: "lavender",
      avatarX: 67,
      avatarY: 36
    },
    {
      id: 3,
      username: "StudyBuddy",
      role: "user",
      controller: false,
      tempAdmin: false,
      status: "Online · Synced",
      avatarStyle: "matcha",
      avatarX: 73,
      avatarY: 72
    }
  ];

  let queue = [];
  let pending = [];
  let history = [];
  let currentTrack = null;
  let votes = 0;
  let followingRoom = true;

  const BLOCKED_WORDS = [
    "fuck", "fucking", "fucked", "fucker", "fuckers",
    "motherfucker", "motherfuckers", "shit", "shitty", "bullshit",
    "bitch", "bitches", "asshole", "assholes", "dick", "dicks",
    "cunt", "cunts", "bastard", "bastards"
  ];

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function censorBadWords(text) {
    let cleanText = String(text || "");

    for (const word of BLOCKED_WORDS) {
      const regex = new RegExp("\\b" + escapeRegex(word) + "\\b", "gi");
      cleanText = cleanText.replace(regex, "*".repeat(word.length));
    }

    return cleanText;
  }


  function avatarGlyph(style) {
    const glyphs = {
      latte: "☕",
      mocha: "🧸",
      matcha: "🌿",
      berry: "🍓",
      sky: "☁",
      lavender: "✦"
    };

    return glyphs[style] || "☕";
  }

  function renderAvatars() {
    if (!avatarLayer) {
      return;
    }

    avatarLayer.replaceChildren();

    if (floorMemberCount) {
      floorMemberCount.textContent = String(members.length);
    }

    members.forEach((member, index) => {
      const avatar = document.createElement("div");
      const isCurrent = index === 0;

      avatar.className = `room-avatar avatar-${member.avatarStyle}${isCurrent ? " is-you" : ""}`;
      avatar.style.left = `${member.avatarX}%`;
      avatar.style.top = `${member.avatarY}%`;

      const face = document.createElement("span");
      face.className = "avatar-face";
      face.textContent = avatarGlyph(member.avatarStyle);

      const label = document.createElement("span");
      label.className = "avatar-name";
      label.textContent = isCurrent ? `${member.username} · you` : member.username;

      const state = document.createElement("span");
      state.className = "avatar-state-dot";
      if (member.controller) {
        state.classList.add("controller");
      }

      avatar.append(face, label, state);
      avatarLayer.appendChild(avatar);
    });
  }

  function moveCurrentAvatar(dx, dy) {
    const member = members[0];
    member.avatarX = Math.min(92, Math.max(8, member.avatarX + dx));
    member.avatarY = Math.min(92, Math.max(8, member.avatarY + dy));
    renderAvatars();
  }

  function setCurrentAvatarStyle(style) {
    const allowed = ["latte", "mocha", "matcha", "berry", "sky", "lavender"];
    if (!allowed.includes(style)) {
      return;
    }

    members[0].avatarStyle = style;
    renderAvatars();
  }

  function makeButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${className || "secondary"}`;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function makeListItem(title, meta) {
    const item = document.createElement("div");
    item.className = "list-item";

    const copy = document.createElement("div");
    copy.className = "list-item-copy";

    const heading = document.createElement("p");
    heading.className = "list-item-title";
    heading.textContent = title;

    const detail = document.createElement("p");
    detail.className = "list-item-meta";
    detail.textContent = meta;

    const actions = document.createElement("div");
    actions.className = "list-actions";

    copy.append(heading, detail);
    item.append(copy, actions);

    return { item, actions };
  }

  function parseYouTube(input) {
    try {
      const parsed = new URL(input.trim());
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      let id = null;

      if (
        host === "youtube.com" ||
        host === "m.youtube.com" ||
        host === "music.youtube.com"
      ) {
        id = parsed.searchParams.get("v");

        if (!id && parsed.pathname.startsWith("/shorts/")) {
          id = parsed.pathname.split("/")[2];
        }

        if (!id && parsed.pathname.startsWith("/embed/")) {
          id = parsed.pathname.split("/")[2];
        }
      }

      if (host === "youtu.be") {
        id = parsed.pathname.split("/")[1];
      }

      if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
        return null;
      }

      return id;
    } catch {
      return null;
    }
  }

  function renderMembers() {
    membersList.replaceChildren();

    members.forEach((member) => {
      const card = document.createElement("div");
      card.className = "member-card";

      const left = document.createElement("div");

      const name = document.createElement("div");
      name.className =
        member.role === "admin" ? "member-name admin-name" : "member-name";
      name.textContent =
        member.role === "admin" ? `♛ ${member.username}` : member.username;

      const status = document.createElement("p");
      status.className = "member-status";
      status.textContent = member.status;

      left.append(name, status);

      const right = document.createElement("div");
      right.className = "list-actions";

      const role = document.createElement("span");
      role.className = `badge ${member.role === "admin" ? "admin" : "user"}`;
      role.textContent = member.role;
      right.appendChild(role);

      if (member.controller) {
        const controller = document.createElement("span");
        controller.className = "badge controller";
        controller.textContent = "controller";
        right.appendChild(controller);
      }

      if (member.tempAdmin && member.role !== "admin") {
        const temp = document.createElement("span");
        temp.className = "badge admin";
        temp.textContent = "temp admin";
        right.appendChild(temp);
      }

      if (isAdmin && member.id !== 1) {
        right.appendChild(
          makeButton(
            member.tempAdmin ? "Remove Temp Admin" : "Make Temp Admin",
            "secondary",
            () => {
              member.tempAdmin = !member.tempAdmin;
              member.controller = member.tempAdmin;

              logAudit(
                member.tempAdmin ? "admin.temp_grant" : "admin.temp_revoke",
                member.tempAdmin
                  ? `Granted temporary admin/controller to ${member.username}`
                  : `Removed temporary admin/controller from ${member.username}`,
                { target: member.username }
              );

              if (member.tempAdmin) {
                members[0].controller = false;
                controllerName.textContent = member.username;
                controllerBadge.textContent = "Synced Room";
                appendSystem(
                  `${member.username} was assigned as temporary room controller.`
                );
              } else {
                member.controller = false;
                members[0].controller = true;
                controllerName.textContent = session.username;
                appendSystem(
                  `${member.username} is no longer a temporary room controller.`
                );
              }

              renderMembers();
            }
          )
        );
      }

      card.append(left, right);
      membersList.appendChild(card);
    });
  }

  function renderQueue() {
    queueList.replaceChildren();

    if (!queue.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Nothing is queued yet.";
      queueList.appendChild(empty);
      return;
    }

    queue.forEach((track, index) => {
      const { item, actions } = makeListItem(
        `${index + 1}. ${track.title}`,
        `Requested by ${track.requestedBy}`
      );

      if (isAdmin) {
        actions.append(
          makeButton("Up", "secondary", () => moveTrack(index, -1)),
          makeButton("Down", "secondary", () => moveTrack(index, 1)),
          makeButton("Play Now", "secondary", () => playTrack(index)),
          makeButton("Remove", "danger", () => {
            const removed = queue[index];
            queue.splice(index, 1);
            logAudit(
              "music.queue_remove",
              `Removed ${removed.title} from shared playlist`,
              { title: removed.title, requestedBy: removed.requestedBy }
            );
            renderQueue();
          })
        );
      }

      queueList.appendChild(item);
    });
  }

  function renderPending() {
    if (!isAdmin) {
      pendingSection.hidden = true;
      return;
    }

    pendingSection.hidden = false;
    pendingList.replaceChildren();

    if (!pending.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No pending requests.";
      pendingList.appendChild(empty);
      return;
    }

    pending.forEach((track, index) => {
      const { item, actions } = makeListItem(
        track.title,
        `Requested by ${track.requestedBy}`
      );

      actions.append(
        makeButton("Approve", "primary", () => {
          queue.push(track);
          pending.splice(index, 1);
          logAudit(
            "music.approve",
            `Approved music request: ${track.title}`,
            { title: track.title, requestedBy: track.requestedBy, videoId: track.videoId }
          );
          requestFeedback.textContent = `${track.title} was approved and added to the shared playlist.`;
          renderPending();
          renderQueue();
        }),
        makeButton("Reject", "danger", () => {
          pending.splice(index, 1);
          logAudit(
            "music.reject",
            `Rejected music request: ${track.title}`,
            { title: track.title, requestedBy: track.requestedBy, videoId: track.videoId }
          );
          requestFeedback.textContent = `${track.title} was rejected.`;
          renderPending();
        })
      );

      pendingList.appendChild(item);
    });
  }

  function renderHistory() {
    historyList.replaceChildren();

    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No tracks have played yet.";
      historyList.appendChild(empty);
      return;
    }

    history.forEach((track) => {
      const { item, actions } = makeListItem(
        track.title,
        `Requested by ${track.requestedBy}`
      );

      actions.appendChild(
        makeButton("Request Again", "secondary", () => {
          pending.push({ ...track });
          requestFeedback.textContent = `${track.title} was requested again.`;
          renderPending();
        })
      );

      historyList.appendChild(item);
    });
  }

  function moveTrack(index, delta) {
    const target = index + delta;

    if (target < 0 || target >= queue.length) {
      return;
    }

    const moved = queue[index];
    [queue[index], queue[target]] = [queue[target], queue[index]];
    logAudit(
      "music.queue_reorder",
      `Moved ${moved.title} in the shared playlist`,
      { title: moved.title, from: index + 1, to: target + 1 }
    );
    renderQueue();
  }

  function showPlayer(track) {
    player.replaceChildren();

    const iframe = document.createElement("iframe");
    iframe.src =
      `https://www.youtube-nocookie.com/embed/${encodeURIComponent(track.videoId)}?rel=0`;
    iframe.title = track.title;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";

    player.appendChild(iframe);
  }

  function playTrack(index) {
    if (index < 0 || index >= queue.length) {
      return;
    }

    if (currentTrack) {
      history.unshift(currentTrack);
    }

    currentTrack = queue.splice(index, 1)[0];

    logAudit(
      "music.play",
      `Started track: ${currentTrack.title}`,
      { title: currentTrack.title, requestedBy: currentTrack.requestedBy, videoId: currentTrack.videoId }
    );

    nowPlayingTitle.textContent = currentTrack.title;
    requestedByLine.textContent = `Requested by ${currentTrack.requestedBy}`;
    playerStatus.textContent =
      "You are the room controller. Other users sync to your exact playback.";

    showPlayer(currentTrack);
    renderQueue();
    renderHistory();
  }

  function playNext() {
    if (!queue.length) {
      playerStatus.textContent = "The shared playlist is empty.";
      return;
    }

    playTrack(0);
    votes = 0;
    voteCount.textContent = "0/2";
  }

  function appendSystem(text) {
    const message = document.createElement("article");
    message.className = "message system";

    const p = document.createElement("p");
    p.textContent = text;

    message.appendChild(p);
    chatLog.appendChild(message);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function appendChat(text) {
    const article = document.createElement("article");
    article.className = "message";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const author = document.createElement("strong");
    author.textContent = session.username;

    const time = document.createElement("span");
    time.textContent = "just now";

    const body = document.createElement("p");
    body.textContent = isAdmin ? text : censorBadWords(text);

    meta.append(author, time);
    article.append(meta, body);

    if (isAdmin) {
      article.appendChild(
        makeButton("Delete", "danger", () => {
          logAudit(
            "chat.delete",
            "Deleted chat message",
            { author: session.username, message: body.textContent }
          );
          article.remove();
        })
      );
    }

    chatLog.appendChild(article);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  requestForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const title = requestTitle.value.trim();
    const videoId = parseYouTube(requestUrl.value);

    if (!videoId) {
      requestFeedback.textContent =
        "Please enter a valid YouTube watch, short, embed, or youtu.be URL.";
      return;
    }

    const request = {
      title,
      videoId,
      requestedBy: session.username
    };

    pending.push(request);

    logAudit(
      "music.request",
      `Submitted music request: ${title}`,
      { title, videoId, requestedBy: session.username }
    );

    requestFeedback.textContent = isAdmin
      ? `${title} is waiting for admin approval below.`
      : `${title} was submitted and is waiting for an admin.`;

    requestForm.reset();
    renderPending();
  });


  if (avatarStage) {
    avatarStage.addEventListener("keydown", (event) => {
      const moves = {
        ArrowUp: [0, -5],
        ArrowDown: [0, 5],
        ArrowLeft: [-5, 0],
        ArrowRight: [5, 0],
        w: [0, -5],
        W: [0, -5],
        s: [0, 5],
        S: [0, 5],
        a: [-5, 0],
        A: [-5, 0],
        d: [5, 0],
        D: [5, 0]
      };

      const move = moves[event.key];
      if (!move) {
        return;
      }

      event.preventDefault();
      moveCurrentAvatar(move[0], move[1]);
    });
  }

  document.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const moves = {
        up: [0, -5],
        down: [0, 5],
        left: [-5, 0],
        right: [5, 0]
      };
      const move = moves[button.dataset.move];
      if (move) {
        moveCurrentAvatar(move[0], move[1]);
      }
    });
  });

  document.querySelectorAll("[data-avatar-style]").forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentAvatarStyle(button.dataset.avatarStyle);
    });
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = chatInput.value.trim();

    if (!text) {
      return;
    }

    appendChat(text);
    logAudit(
      "chat.message",
      "Sent chat message",
      { message: isAdmin ? text : censorBadWords(text) }
    );
    chatInput.value = "";
  });

  document.getElementById("sync-button").addEventListener("click", () => {
    followingRoom = true;
    logAudit("player.sync", "Synced to room controller");
    playerStatus.textContent = "You are synced to the room controller.";
  });

  document
    .getElementById("independent-button")
    .addEventListener("click", () => {
      followingRoom = false;
      logAudit("player.independent", "Switched to independent listening");
      playerStatus.textContent =
        "Independent listening enabled. Use Sync to Controller to rejoin.";
    });

  document.getElementById("vote-button").addEventListener("click", () => {
    votes = Math.min(votes + 1, 2);
    logAudit("player.vote_next", "Voted to advance to the next track");
    voteCount.textContent = `${votes}/2`;

    if (votes >= 2) {
      appendSystem("Majority vote passed. Moving everyone to the next video.");
      playNext();
    }
  });

  adminNextButton.hidden = !isAdmin;
  adminNextButton.addEventListener("click", playNext);

  minimizeChat.addEventListener("click", () => {
    const minimized = chatBody.classList.toggle("is-minimized");
    minimizeChat.textContent = minimized ? "Open Chat" : "Minimize Chat";
  });

  logoutButton.addEventListener("click", () => {
    logAudit("auth.logout", "Logged out");
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "./index.html";
  });

  if (!isAdmin) {
    controllerBadge.textContent = "Synced Room";
    playerStatus.textContent = followingRoom
      ? "You are synced to the room controller."
      : "Independent listening enabled.";
  }

  renderMembers();
  renderAvatars();
  renderQueue();
  renderPending();
  renderHistory();
})();
