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

  const isAdmin =
    String(session.username || "").toLowerCase() === "admin" &&
    session.role === "admin";

  session.role = isAdmin ? "admin" : "user";
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
  const securityEngineeringLink = document.getElementById("security-engineering-link");
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
  const profileImageInput = document.getElementById("profile-image-input");
  const removeProfileImageButton = document.getElementById("remove-profile-image");
  const profileImageStatus = document.getElementById("profile-image-status");

  const PROFILE_IMAGE_KEY = `secureLofiProfileImage:${session.username}`;
  const PROFILE_IMAGE_MAX_BYTES = 512 * 1024;

  usernameEl.textContent = session.username;
  roleEl.textContent = session.role;
  controllerName.textContent = isAdmin ? session.username : "admin";

  if (adminConsoleLink) {
    if (isAdmin) {
      adminConsoleLink.hidden = false;
    } else {
      adminConsoleLink.remove();
    }
  }

  if (securityEngineeringLink) {
    if (isAdmin) {
      securityEngineeringLink.hidden = false;
    } else {
      securityEngineeringLink.remove();
    }
  }

  const members = [
    {
      id: 1,
      username: session.username,
      role: session.role,
      controller: isAdmin,
      tempAdmin: false,
      status: "Static preview · not connected to other browsers",
      avatarStyle: "latte",
      avatarX: 50,
      avatarY: 55,
      avatarImage: localStorage.getItem(PROFILE_IMAGE_KEY) || null
    }
  ];

  let queue = [];
  let pending = [];
  let history = [];
  let currentTrack = null;
  let votes = 0;
  let followingRoom = true;

  const speechBubbles = new Map();
  const heldKeys = new Set();
  let heldPointerVector = null;
  let movementTarget = null;
  let movementFrame = null;
  let lastMovementTime = 0;
  let isWalking = false;

  const WALK_SPEED = 24;

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

  function setAvatarFace(face, member) {
    face.replaceChildren();

    if (member.avatarImage) {
      const image = document.createElement("img");
      image.src = member.avatarImage;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      face.appendChild(image);
      face.classList.add("has-profile-image");
    } else {
      face.textContent = avatarGlyph(member.avatarStyle);
      face.classList.remove("has-profile-image");
    }
  }

  function updateSpeechBubbleNode(avatar, member) {
    const bubbleState = speechBubbles.get(member.username);
    let bubble = avatar.querySelector(".avatar-speech");

    if (!bubbleState || bubbleState.expiresAt <= Date.now()) {
      if (bubble) {
        bubble.remove();
      }
      if (bubbleState) {
        speechBubbles.delete(member.username);
      }
      return;
    }

    if (!bubble) {
      bubble = document.createElement("span");
      bubble.className = "avatar-speech";
      avatar.prepend(bubble);
    }

    bubble.textContent = bubbleState.text;
  }

  function renderAvatars() {
    if (!avatarLayer) {
      return;
    }

    if (floorMemberCount) {
      floorMemberCount.textContent = String(members.length);
    }

    const activeIds = new Set();

    members.forEach((member, index) => {
      const memberId = String(member.id);
      activeIds.add(memberId);

      const isCurrent = index === 0;
      let avatar = avatarLayer.querySelector(
        `[data-user-id="${memberId}"]`
      );

      if (!avatar) {
        avatar = document.createElement("div");
        avatar.dataset.userId = memberId;

        const face = document.createElement("span");
        face.className = "avatar-face";

        const label = document.createElement("span");
        label.className = "avatar-name";

        const state = document.createElement("span");
        state.className = "avatar-state-dot";

        avatar.append(face, label, state);
        avatarLayer.appendChild(avatar);
      }

      avatar.className =
        `room-avatar avatar-${member.avatarStyle}${isCurrent ? " is-you" : ""}${isCurrent && isWalking ? " is-walking" : ""}`;
      avatar.style.left = `${member.avatarX}%`;
      avatar.style.top = `${member.avatarY}%`;

      const face = avatar.querySelector(".avatar-face");
      const label = avatar.querySelector(".avatar-name");
      const state = avatar.querySelector(".avatar-state-dot");

      setAvatarFace(face, member);
      label.textContent = isCurrent
        ? `${member.username} · you`
        : member.username;

      state.className = "avatar-state-dot";
      if (member.controller) {
        state.classList.add("controller");
      }

      updateSpeechBubbleNode(avatar, member);
    });

    avatarLayer.querySelectorAll(".room-avatar").forEach((avatar) => {
      if (!activeIds.has(avatar.dataset.userId)) {
        avatar.remove();
      }
    });
  }

  function setSpeechBubble(username, message) {
    const cleanText = String(message || "").trim().slice(0, 120);

    if (!username || !cleanText) {
      return;
    }

    const expiresAt = Date.now() + 5000;
    speechBubbles.set(username, { text: cleanText, expiresAt });
    renderAvatars();

    setTimeout(() => {
      const current = speechBubbles.get(username);
      if (current && current.expiresAt === expiresAt) {
        speechBubbles.delete(username);
        renderAvatars();
      }
    }, 5100);
  }

  function setLocalAvatarPosition(x, y) {
    const member = members[0];

    member.avatarX = Math.min(92, Math.max(8, Number(x)));
    member.avatarY = Math.min(92, Math.max(8, Number(y)));

    const avatar = avatarLayer
      ? avatarLayer.querySelector('[data-user-id="1"]')
      : null;

    if (avatar) {
      avatar.style.left = `${member.avatarX}%`;
      avatar.style.top = `${member.avatarY}%`;
      avatar.classList.toggle("is-walking", isWalking);
    }
  }

  function movementDirection() {
    let x = 0;
    let y = 0;

    if (heldKeys.has("ArrowLeft") || heldKeys.has("a") || heldKeys.has("A")) x -= 1;
    if (heldKeys.has("ArrowRight") || heldKeys.has("d") || heldKeys.has("D")) x += 1;
    if (heldKeys.has("ArrowUp") || heldKeys.has("w") || heldKeys.has("W")) y -= 1;
    if (heldKeys.has("ArrowDown") || heldKeys.has("s") || heldKeys.has("S")) y += 1;

    if (heldPointerVector) {
      x += heldPointerVector.x;
      y += heldPointerVector.y;
    }

    if (x === 0 && y === 0) {
      return null;
    }

    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }

  function stopWalking() {
    isWalking = false;
    movementFrame = null;
    lastMovementTime = 0;

    const avatar = avatarLayer
      ? avatarLayer.querySelector('[data-user-id="1"]')
      : null;

    if (avatar) {
      avatar.classList.remove("is-walking");
    }
  }

  function movementStep(now) {
    const member = members[0];

    if (!lastMovementTime) {
      lastMovementTime = now;
    }

    const deltaSeconds = Math.min(0.05, (now - lastMovementTime) / 1000);
    lastMovementTime = now;

    const direction = movementDirection();
    let nextX = member.avatarX;
    let nextY = member.avatarY;
    let active = false;

    if (direction) {
      movementTarget = null;
      nextX += direction.x * WALK_SPEED * deltaSeconds;
      nextY += direction.y * WALK_SPEED * deltaSeconds;
      active = true;
    } else if (movementTarget) {
      const dx = movementTarget.x - nextX;
      const dy = movementTarget.y - nextY;
      const distance = Math.hypot(dx, dy);

      if (distance <= 0.45) {
        nextX = movementTarget.x;
        nextY = movementTarget.y;
        movementTarget = null;
      } else {
        const step = Math.min(distance, WALK_SPEED * deltaSeconds);
        nextX += (dx / distance) * step;
        nextY += (dy / distance) * step;
        active = true;
      }
    }

    if (!active && !movementTarget) {
      setLocalAvatarPosition(nextX, nextY);
      stopWalking();
      return;
    }

    isWalking = true;
    setLocalAvatarPosition(nextX, nextY);
    movementFrame = requestAnimationFrame(movementStep);
  }

  function ensureMovementLoop() {
    if (movementFrame) {
      return;
    }

    lastMovementTime = 0;
    movementFrame = requestAnimationFrame(movementStep);
  }

  function walkTo(x, y) {
    movementTarget = {
      x: Math.min(92, Math.max(8, Number(x))),
      y: Math.min(92, Math.max(8, Number(y)))
    };
    ensureMovementLoop();
  }

  function setCurrentAvatarStyle(style) {
    const allowed = ["latte", "mocha", "matcha", "berry", "sky", "lavender"];
    if (!allowed.includes(style)) {
      return;
    }

    members[0].avatarStyle = style;

    document.querySelectorAll("[data-avatar-style]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        button.dataset.avatarStyle === style ? "true" : "false"
      );
    });

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

      const identity = document.createElement("div");
      identity.className = "member-identity";

      const thumb = document.createElement("span");
      thumb.className = `member-thumb avatar-${member.avatarStyle || "latte"}`;

      if (member.avatarImage) {
        const image = document.createElement("img");
        image.src = member.avatarImage;
        image.alt = "";
        image.loading = "lazy";
        thumb.appendChild(image);
      } else {
        thumb.textContent = avatarGlyph(member.avatarStyle || "latte");
      }

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
      identity.append(thumb, left);

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

      card.append(identity, right);
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
    avatarStage.addEventListener("click", (event) => {
      if (event.target.closest(".room-avatar")) {
        return;
      }

      const bounds = avatarStage.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 100;
      const y = ((event.clientY - bounds.top) / bounds.height) * 100;

      walkTo(x, y);
      avatarStage.focus();
    });

    avatarStage.addEventListener("keydown", (event) => {
      const allowed = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "w", "W", "a", "A", "s", "S", "d", "D"
      ];

      if (!allowed.includes(event.key)) {
        return;
      }

      event.preventDefault();
      heldKeys.add(event.key);
      movementTarget = null;
      ensureMovementLoop();
    });

    avatarStage.addEventListener("blur", () => {
      heldKeys.clear();
    });
  }

  document.addEventListener("keyup", (event) => {
    heldKeys.delete(event.key);
  });

  document.querySelectorAll("[data-move]").forEach((button) => {
    const vectors = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      heldPointerVector = vectors[button.dataset.move] || null;
      movementTarget = null;
      button.setPointerCapture?.(event.pointerId);
      ensureMovementLoop();
    });

    const release = () => {
      heldPointerVector = null;
    };

    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });

  document.querySelectorAll("[data-avatar-style]").forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentAvatarStyle(button.dataset.avatarStyle);
    });
  });

  if (profileImageInput) {
    profileImageInput.addEventListener("change", () => {
      const file = profileImageInput.files && profileImageInput.files[0];

      if (!file) {
        return;
      }

      const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

      if (!allowedTypes.includes(file.type)) {
        profileImageStatus.textContent = "Use PNG, JPEG, or WebP.";
        profileImageInput.value = "";
        return;
      }

      if (file.size > PROFILE_IMAGE_MAX_BYTES) {
        profileImageStatus.textContent = "Image must be 512 KB or smaller.";
        profileImageInput.value = "";
        return;
      }

      const reader = new FileReader();

      reader.addEventListener("load", () => {
        members[0].avatarImage = String(reader.result);
        localStorage.setItem(PROFILE_IMAGE_KEY, members[0].avatarImage);
        renderAvatars();
        profileImageStatus.textContent = "Profile picture updated.";
        profileImageInput.value = "";
      });

      reader.addEventListener("error", () => {
        profileImageStatus.textContent = "Could not read that image.";
        profileImageInput.value = "";
      });

      reader.readAsDataURL(file);
    });
  }

  if (removeProfileImageButton) {
    removeProfileImageButton.addEventListener("click", () => {
      members[0].avatarImage = null;
      localStorage.removeItem(PROFILE_IMAGE_KEY);
      renderAvatars();
      profileImageStatus.textContent = "Profile picture removed.";
    });
  }

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = chatInput.value.trim();

    if (!text) {
      return;
    }

    appendChat(text);
    setSpeechBubble(session.username, isAdmin ? text : censorBadWords(text));
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

  if (isAdmin) {
    adminNextButton.hidden = false;
    adminNextButton.addEventListener("click", playNext);
  } else {
    adminNextButton.remove();
    pendingSection.remove();
  }

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
