(() => {
  "use strict";

  const body = document.body;
  const csrfToken = body.dataset.csrf;
  const currentUserId = Number(body.dataset.userId);
  const currentUsername = String(body.dataset.username || "");
  const roomId = Number(body.dataset.roomId || 1);
  const canModerate = body.dataset.canModerate === "true";
  const canAssign = body.dataset.canAssign === "true";

  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000
  });

  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const socketStatus = document.getElementById("socket-status");
  const latencyStatus = document.getElementById("latency-status");
  const queueList = document.getElementById("queue-list");
  const historyList = document.getElementById("history-list");
  const membersList = document.getElementById("members-list");
  const membersDetails = document.getElementById("members-details");
  const pendingList = document.getElementById("pending-list");
  const memberCount = document.getElementById("member-count");
  const inlineMemberCount = document.getElementById("inline-member-count");
  const voteCount = document.getElementById("vote-count");
  const nowPlayingTitle = document.getElementById("now-playing-title");
  const requestedByLine = document.getElementById("requested-by-line");
  const controllerLine = document.getElementById("controller-line");
  const controllerBadge = document.getElementById("controller-badge");
  const playerStatus = document.getElementById("player-status");
  const minimizeChatButton = document.getElementById("minimize-chat");
  const chatBody = document.getElementById("chat-body");
  const avatarStage = document.getElementById("avatar-stage");
  const avatarLayer = document.getElementById("avatar-layer");
  const floorMemberCount = document.getElementById("floor-member-count");
  const profileImageInput = document.getElementById("profile-image-input");
  const removeProfileImageButton = document.getElementById("remove-profile-image");
  const profileImageStatus = document.getElementById("profile-image-status");
  const availabilityStatus = document.getElementById("availability-status");
  const availabilityStatusNote = document.getElementById("availability-status-note");
  const memberProfileDialog = document.getElementById("member-profile-dialog");
  const memberProfileContent = document.getElementById("member-profile-content");
  const toastRegion = document.getElementById("toast-region");
  const mediaDock = document.getElementById("media-dock");
  const mediaTitle = document.getElementById("media-title");
  const mediaRequester = document.getElementById("media-requester");
  const mediaSyncState = document.getElementById("media-sync-state");
  const mediaProgressBar = document.getElementById("media-progress-bar");
  const mediaProgressText = document.getElementById("media-progress-text");
  const mediaCollapse = document.getElementById("media-collapse");
  const enablePlayback = document.getElementById("enable-playback");
  const mediaSyncButton = document.getElementById("media-sync-button");
  const mediaVoteButton = document.getElementById("media-vote-button");
  const mediaQueuePreview = document.getElementById("media-queue-preview");
  const typingIndicator = document.getElementById("typing-indicator");
  const unreadBadge = document.getElementById("unread-badge");
  const mobileUnreadDot = document.getElementById("mobile-unread-dot");
  const replyComposerBanner = document.getElementById("reply-composer-banner");
  const replyComposerTitle = document.getElementById("reply-composer-title");
  const replyComposerText = document.getElementById("reply-composer-text");
  const replyCancel = document.getElementById("reply-cancel");
  const themeSelect = document.getElementById("theme-select");
  const notificationPreference = document.getElementById("notification-preference");
  const focusDisplay = document.getElementById("focus-timer-display");
  const focusStart = document.getElementById("focus-start");
  const focusReset = document.getElementById("focus-reset");
  const focusMode = document.getElementById("focus-mode");
  const focusModeBadge = document.getElementById("focus-mode-badge");
  const joinLeaveBanner = document.getElementById("join-leave-banner");
  const mobileMoreButton = document.getElementById("mobile-more-button");

  let latestMembers = [];
  let player = null;
  let youtubeReady = false;
  let playerState = null;
  let controllerState = null;
  let followingRoom = true;
  let currentReply = null;
  let unreadCount = 0;
  let typingStopTimer = null;
  const typingUsers = new Map();
  let focusIsBreak = false;
  let focusRemainingSeconds = 25 * 60;
  let focusTimerId = null;

  const messageIds = new Set(
    Array.from(
      document.querySelectorAll("#chat-log [data-message-id]")
    ).map((node) => String(node.dataset.messageId))
  );
  const speechBubbles = new Map();
  const remoteAvatarTargets = new Map();
  const heldKeys = new Set();
  let heldPointerVector = null;
  let movementTarget = null;
  let movementFrame = null;
  let lastMovementTime = 0;
  let lastMovementEmit = 0;
  let remoteInterpolationFrame = null;
  let remoteInterpolationTime = 0;
  let isWalking = false;

  const WALK_SPEED = 24;
  const MOVE_EMIT_INTERVAL_MS = 45;
  const PROFILE_IMAGE_MAX_BYTES = 512 * 1024;

  function addCsrf(form) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "_csrf";
    input.value = csrfToken;
    form.appendChild(input);
  }

  function actionForm(action, label, style = "secondary") {
    const form = document.createElement("form");
    form.method = "post";
    form.action = action;
    addCsrf(form);

    const button = document.createElement("button");
    button.type = "submit";
    button.className = `button ${style}`;
    button.textContent = label;

    form.appendChild(button);
    return form;
  }

  function emptyState(text) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = text;
    return p;
  }

  function listItem(title, meta) {
    const item = document.createElement("div");
    item.className = "list-item";

    const copy = document.createElement("div");
    copy.className = "list-item-copy";

    const name = document.createElement("p");
    name.className = "list-item-title";
    name.textContent = title;

    const details = document.createElement("p");
    details.className = "list-item-meta";
    details.textContent = meta || "";

    const actions = document.createElement("div");
    actions.className = "list-actions";

    copy.append(name, details);
    item.append(copy, actions);

    return { item, actions };
  }

  function renderMediaQueuePreview(queue = []) {
    if (!mediaQueuePreview) {
      return;
    }

    mediaQueuePreview.replaceChildren();

    if (!queue.length) {
      mediaQueuePreview.appendChild(emptyState("Queue is empty."));
      return;
    }

    queue.slice(0, 3).forEach((track, index) => {
      const row = document.createElement("div");
      row.className = "mini-queue-row";

      const number = document.createElement("span");
      number.className = "mini-queue-number";
      number.textContent = String(index + 1);

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = track.title;
      const requester = document.createElement("span");
      requester.textContent = "by " + (track.requested_by_username || "unknown");

      copy.append(title, requester);
      row.append(number, copy);
      mediaQueuePreview.appendChild(row);
    });
  }
  function renderQueue(queue = []) {
    queueList.replaceChildren();
    renderMediaQueuePreview(queue);

    if (!queue.length) {
      queueList.appendChild(emptyState("Nothing is queued yet."));
      return;
    }

    queue.forEach((track, index) => {
      const { item, actions } = listItem(
        `${index + 1}. ${track.title}`,
        `Requested by ${track.requested_by_username || "unknown"}`
      );

      if (canModerate) {
        actions.append(
          actionForm(`/admin/queue/${track.id}/up`, "Up"),
          actionForm(`/admin/queue/${track.id}/down`, "Down"),
          actionForm(`/admin/queue/${track.id}/play`, "Play Now"),
          actionForm(`/admin/queue/${track.id}/remove`, "Remove", "danger")
        );
      }

      queueList.appendChild(item);
    });
  }

  function renderHistory(history = []) {
    historyList.replaceChildren();

    if (!history.length) {
      historyList.appendChild(emptyState("No tracks have played yet."));
      return;
    }

    history.forEach((track) => {
      const { item, actions } = listItem(
        track.title,
        `Requested by ${track.requested_by_username || "unknown"}`
      );

      actions.appendChild(
        actionForm(`/history/${track.id}/request-again`, "Request Again")
      );

      historyList.appendChild(item);
    });
  }

  function roleBadge(text, className) {
    const badge = document.createElement("span");
    badge.className = `badge ${className || ""}`.trim();
    badge.textContent = text;
    return badge;
  }


  const AVAILABILITY_LABELS = {
    studying: "Studying",
    chat: "Available to chat",
    dnd: "Do not disturb",
    afk: "AFK",
    listening: "Listening",
    watching: "Watching"
  };

  function availabilityLabel(value) {
    return AVAILABILITY_LABELS[value] || AVAILABILITY_LABELS.studying;
  }

  function showToast(message, tone = "info") {
    if (!toastRegion) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${tone}`;
    toast.textContent = String(message || "").slice(0, 220);
    toastRegion.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });

    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 180);
    }, 3200);
  }

  function openMemberProfile(member) {
    if (!member || !memberProfileDialog || !memberProfileContent) {
      return;
    }

    memberProfileContent.replaceChildren();

    const header = document.createElement("div");
    header.className = "member-profile-header";

    const visual = document.createElement("span");
    visual.className = `member-profile-avatar avatar-${member.avatarStyle || "latte"}`;
    if (member.avatarImageUrl) {
      const image = document.createElement("img");
      image.src = member.avatarImageUrl;
      image.alt = "";
      visual.appendChild(image);
    } else {
      visual.textContent = avatarGlyph(member.avatarStyle || "latte");
    }

    const heading = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = member.online === false ? "Room member" : "Online now";

    const title = document.createElement("h2");
    title.textContent = member.username;

    const status = document.createElement("p");
    status.className = "member-profile-status";
    status.textContent = availabilityLabel(member.availabilityStatus);

    heading.append(eyebrow, title, status);
    header.append(visual, heading);

    const facts = document.createElement("dl");
    facts.className = "profile-facts";

    const entries = [
      ["Role", member.role || "user"],
      ["Presence", member.online === false ? "Offline" : "Online"],
      ["Room", member.roomId ? `Main Study Café · #${member.roomId}` : "Main Study Café"],
      ["Connections", String(member.connectionCount || 1)],
      ["Listening", member.playbackStatus || "Online"],
      ["Music mode", member.followingRoom === false ? "Independent" : "Synced"],
      ["Last seen", member.lastSeenAt ? new Date(member.lastSeenAt).toLocaleString() : "Now"]
    ];

    if (member.isController) {
      entries.push(["Room role", "Controller / DJ"]);
    } else if (member.isTempAdmin) {
      entries.push(["Room role", "Temporary moderator"]);
    }

    entries.forEach(([label, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      facts.appendChild(row);
    });

    const privacy = document.createElement("p");
    privacy.className = "compact profile-privacy";
    privacy.textContent =
      "This profile shows room-safe information only. Administrative telemetry is not exposed here.";

    memberProfileContent.append(header, facts, privacy);

    if (typeof memberProfileDialog.showModal === "function") {
      memberProfileDialog.showModal();
    } else {
      memberProfileDialog.setAttribute("open", "");
    }
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

  function currentMember() {
    return latestMembers.find(
      (candidate) => Number(candidate.id) === currentUserId
    );
  }

  function setAvatarFace(face, member, style) {
    const faceKey = member.avatarImageUrl
      ? `image:${member.avatarImageUrl}`
      : `style:${style}`;

    if (face.dataset.faceKey === faceKey) {
      return;
    }

    face.dataset.faceKey = faceKey;
    face.replaceChildren();

    if (member.avatarImageUrl) {
      const image = document.createElement("img");
      image.src = member.avatarImageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      face.appendChild(image);
      face.classList.add("has-profile-image");
    } else {
      face.textContent = avatarGlyph(style);
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

  function renderAvatars(members = []) {
    if (!avatarLayer) {
      return;
    }

    if (floorMemberCount) {
      floorMemberCount.textContent = String(members.length);
    }

    const activeIds = new Set();

    members.forEach((member) => {
      const memberId = String(member.id);
      activeIds.add(memberId);

      const style = member.avatarStyle || "latte";
      const isCurrent = Number(member.id) === currentUserId;
      let avatar = avatarLayer.querySelector(
        `[data-user-id="${memberId}"]`
      );

      if (!avatar) {
        avatar = document.createElement("button");
        avatar.type = "button";
        avatar.dataset.userId = memberId;
        avatar.className = "room-avatar";
        avatar.addEventListener("click", (event) => {
          event.stopPropagation();
          const selected = latestMembers.find(
            (candidate) => Number(candidate.id) === Number(avatar.dataset.userId)
          );
          openMemberProfile(selected);
        });

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
        `room-avatar avatar-${style}${isCurrent ? " is-you" : ""}${isCurrent && isWalking ? " is-walking" : ""}`;
      const snapshotX = Number(member.avatarX || 50);
      const snapshotY = Number(member.avatarY || 50);

      if (isCurrent || !avatar.dataset.renderX) {
        avatar.dataset.renderX = String(snapshotX);
        avatar.dataset.renderY = String(snapshotY);
        avatar.style.left = `${snapshotX}%`;
        avatar.style.top = `${snapshotY}%`;
      } else if (!remoteAvatarTargets.has(Number(member.id))) {
        remoteAvatarTargets.set(Number(member.id), {
          x: snapshotX,
          y: snapshotY
        });
        ensureRemoteInterpolation();
      }
      avatar.setAttribute(
        "aria-label",
        `${member.username}${isCurrent ? ", your avatar" : ""}`
      );

      const face = avatar.querySelector(".avatar-face");
      const label = avatar.querySelector(".avatar-name");
      const state = avatar.querySelector(".avatar-state-dot");

      setAvatarFace(face, member, style);
      label.textContent = isCurrent
        ? `${member.username} · you`
        : member.username;

      state.className = "avatar-state-dot";

      if (member.isController) {
        state.classList.add("controller");
        state.title = "Room controller";
      } else if (member.isPlaying) {
        state.classList.add("playing");
        state.title = "Listening";
      } else {
        state.title = "Online";
      }

      updateSpeechBubbleNode(avatar, member);
    });

    avatarLayer.querySelectorAll(".room-avatar").forEach((avatar) => {
      if (!activeIds.has(avatar.dataset.userId)) {
        avatar.remove();
      }
    });
  }

  function ensureRemoteInterpolation() {
    if (remoteInterpolationFrame) {
      return;
    }

    remoteInterpolationTime = 0;
    remoteInterpolationFrame = requestAnimationFrame(stepRemoteInterpolation);
  }

  function stepRemoteInterpolation(now) {
    if (!remoteInterpolationTime) {
      remoteInterpolationTime = now;
    }

    const deltaSeconds = Math.min(
      0.05,
      Math.max(0.001, (now - remoteInterpolationTime) / 1000)
    );
    remoteInterpolationTime = now;

    let hasWork = false;

    for (const [memberId, target] of remoteAvatarTargets.entries()) {
      const avatar = avatarLayer
        ? avatarLayer.querySelector(
            `[data-user-id="${String(memberId)}"]`
          )
        : null;

      if (!avatar) {
        remoteAvatarTargets.delete(memberId);
        continue;
      }

      const currentX = Number(
        avatar.dataset.renderX || parseFloat(avatar.style.left) || target.x
      );
      const currentY = Number(
        avatar.dataset.renderY || parseFloat(avatar.style.top) || target.y
      );

      const smoothing = 1 - Math.exp(-14 * deltaSeconds);
      const nextX = currentX + (target.x - currentX) * smoothing;
      const nextY = currentY + (target.y - currentY) * smoothing;

      avatar.dataset.renderX = String(nextX);
      avatar.dataset.renderY = String(nextY);
      avatar.style.left = `${nextX}%`;
      avatar.style.top = `${nextY}%`;
      avatar.classList.add("is-network-moving");

      const settled =
        Math.abs(target.x - nextX) < 0.04 &&
        Math.abs(target.y - nextY) < 0.04;

      if (settled) {
        avatar.dataset.renderX = String(target.x);
        avatar.dataset.renderY = String(target.y);
        avatar.style.left = `${target.x}%`;
        avatar.style.top = `${target.y}%`;
        avatar.classList.remove("is-network-moving");
        remoteAvatarTargets.delete(memberId);
      } else {
        hasWork = true;
      }
    }

    if (hasWork || remoteAvatarTargets.size) {
      remoteInterpolationFrame = requestAnimationFrame(stepRemoteInterpolation);
      return;
    }

    remoteInterpolationFrame = null;
    remoteInterpolationTime = 0;
  }

  function applyRemoteAvatarMove(payload) {
    if (!payload || Number(payload.userId) === currentUserId) {
      return;
    }

    const member = latestMembers.find(
      (candidate) => Number(candidate.id) === Number(payload.userId)
    );

    if (!member) {
      return;
    }

    const x = Math.min(92, Math.max(8, Number(payload.x)));
    const y = Math.min(92, Math.max(8, Number(payload.y)));

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    member.avatarX = x;
    member.avatarY = y;
    remoteAvatarTargets.set(Number(payload.userId), { x, y });
    ensureRemoteInterpolation();
  }

  function setSpeechBubble(username, message) {
    const cleanText = String(message || "").trim().slice(0, 120);

    if (!username || !cleanText) {
      return;
    }

    const expiresAt = Date.now() + 5000;
    speechBubbles.set(username, { text: cleanText, expiresAt });
    renderAvatars(latestMembers);

    setTimeout(() => {
      const current = speechBubbles.get(username);
      if (current && current.expiresAt === expiresAt) {
        speechBubbles.delete(username);
        renderAvatars(latestMembers);
      }
    }, 5100);
  }

  function setLocalAvatarPosition(x, y, emitNow = false) {
    const member = currentMember();

    if (!member) {
      return;
    }

    member.avatarX = Math.min(92, Math.max(8, Number(x)));
    member.avatarY = Math.min(92, Math.max(8, Number(y)));

    const avatar = avatarLayer
      ? avatarLayer.querySelector(`[data-user-id="${currentUserId}"]`)
      : null;

    if (avatar) {
      avatar.style.left = `${member.avatarX}%`;
      avatar.style.top = `${member.avatarY}%`;
      avatar.classList.toggle("is-walking", isWalking);
    }

    const now = performance.now();

    if (
      emitNow ||
      now - lastMovementEmit >= MOVE_EMIT_INTERVAL_MS
    ) {
      lastMovementEmit = now;
      const movementPayload = {
        x: member.avatarX,
        y: member.avatarY
      };

      if (emitNow) {
        socket.emit("member:move", movementPayload);
      } else {
        socket.volatile.emit("member:move", movementPayload);
      }
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
    const wasWalking = isWalking;
    isWalking = false;
    movementFrame = null;
    lastMovementTime = 0;

    const avatar = avatarLayer
      ? avatarLayer.querySelector(`[data-user-id="${currentUserId}"]`)
      : null;

    if (avatar) {
      avatar.classList.remove("is-walking");
    }

    if (wasWalking) {
      const member = currentMember();
      if (member) {
        setLocalAvatarPosition(member.avatarX, member.avatarY, true);
      }
    }
  }

  function movementStep(now) {
    const member = currentMember();

    if (!member) {
      stopWalking();
      return;
    }

    if (!lastMovementTime) {
      lastMovementTime = now;
    }

    const deltaSeconds = Math.min(0.05, (now - lastMovementTime) / 1000);
    lastMovementTime = now;

    const direction = movementDirection();
    let nextX = Number(member.avatarX || 50);
    let nextY = Number(member.avatarY || 50);
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
      setLocalAvatarPosition(nextX, nextY, true);
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

    const member = currentMember();

    if (member) {
      member.avatarStyle = style;
      renderAvatars(latestMembers);
    }

    document.querySelectorAll("[data-avatar-style]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        button.dataset.avatarStyle === style ? "true" : "false"
      );
    });

    socket.emit("member:avatar", { style });
  }

  function renderMembers(members = []) {
    latestMembers = members;
    membersList.replaceChildren();
    renderAvatars(members);

    const self = currentMember();
    if (self && availabilityStatus) {
      availabilityStatus.value = self.availabilityStatus || "studying";
    }

    if (memberCount) {
      memberCount.textContent = `${members.length} online`;
    }

    if (inlineMemberCount) {
      inlineMemberCount.textContent = String(members.length);
    }

    if (!members.length) {
      membersList.appendChild(emptyState("No members are online."));
      return;
    }

    members.forEach((member) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "member-card";
      item.addEventListener("click", () => openMemberProfile(member));

      const identity = document.createElement("div");
      identity.className = "member-identity";

      const thumb = document.createElement("span");
      thumb.className = `member-thumb avatar-${member.avatarStyle || "latte"}`;

      if (member.avatarImageUrl) {
        const image = document.createElement("img");
        image.src = member.avatarImageUrl;
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
      name.textContent = member.role === "admin" ? `♛ ${member.username}` : member.username;

      const status = document.createElement("p");
      status.className = "member-status";

      const playback = member.playbackStatus || "Online";
      const track = member.trackTitle && member.trackTitle !== "Not playing"
        ? ` on ${member.trackTitle}`
        : "";
      const mode = member.followingRoom ? "Synced" : "Independent";

      status.textContent =
        `${availabilityLabel(member.availabilityStatus)} · ${playback}${track} · ${mode}`;

      left.append(name, status);
      identity.append(thumb, left);

      const right = document.createElement("div");
      right.className = "list-actions";

      right.appendChild(
        roleBadge(member.role, member.role === "admin" ? "admin" : "user")
      );

      if (member.isController) {
        right.appendChild(roleBadge("controller", "controller"));
      }

      if (member.isTempAdmin && member.role !== "admin") {
        right.appendChild(roleBadge("temp admin", "admin"));
      }

      item.append(identity, right);
      membersList.appendChild(item);
    });
  }

  function renderPending(requests = []) {
    if (!pendingList) {
      return;
    }

    pendingList.replaceChildren();

    if (!requests.length) {
      pendingList.appendChild(emptyState("No pending requests."));
      return;
    }

    requests.forEach((request) => {
      const { item, actions } = listItem(
        request.title,
        `Requested by ${request.username}`
      );

      actions.append(
        actionForm(
          `/admin/music-requests/${request.id}/approve`,
          "Approve",
          "primary"
        ),
        actionForm(
          `/admin/music-requests/${request.id}/reject`,
          "Reject",
          "danger"
        )
      );

      pendingList.appendChild(item);
    });
  }

  function formatClock(totalSeconds) {
    const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return minutes + ":" + String(seconds).padStart(2, "0");
  }

  function renderReactionSummary(messageId, reactions = []) {
    const container = chatLog.querySelector(
      "[data-reactions-for=\"" + String(messageId) + "\"]"
    );

    if (!container) {
      return;
    }

    container.replaceChildren();

    reactions.forEach((reaction) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reaction-chip";
      button.dataset.reactMessage = String(messageId);
      button.dataset.reactEmoji = reaction.emoji;

      const emoji = document.createElement("span");
      emoji.textContent = reaction.emoji;
      const count = document.createElement("strong");
      count.textContent = String(reaction.count || 0);

      button.append(emoji, count);
      container.appendChild(button);
    });
  }

  function setReplyTarget(messageId) {
    const article = chatLog.querySelector(
      "[data-message-id=\"" + String(messageId) + "\"]"
    );

    if (!article) {
      return;
    }

    const username = article.dataset.messageUser || "member";
    const messageText =
      article.querySelector(".message-text")?.textContent?.trim() || "";

    currentReply = {
      id: Number(messageId),
      username,
      text: messageText.slice(0, 120)
    };

    if (replyComposerBanner) {
      replyComposerBanner.hidden = false;
      replyComposerTitle.textContent = "Replying to " + username;
      replyComposerText.textContent = currentReply.text;
    }

    chatInput.focus();
  }

  function clearReplyTarget() {
    currentReply = null;
    if (replyComposerBanner) {
      replyComposerBanner.hidden = true;
    }
  }

  function updateUnread(delta = 1) {
    unreadCount = Math.max(0, unreadCount + delta);

    if (unreadBadge) {
      unreadBadge.hidden = unreadCount === 0;
      unreadBadge.textContent =
        unreadCount === 1 ? "1 unread" : unreadCount + " unread";
    }

    if (mobileUnreadDot) {
      mobileUnreadDot.hidden = unreadCount === 0;
    }
  }

  function showJoinLeaveBanner(text) {
    if (!joinLeaveBanner || !text) {
      return;
    }

    joinLeaveBanner.textContent = text;
    joinLeaveBanner.classList.add("is-visible");

    clearTimeout(joinLeaveBanner._hideTimer);
    joinLeaveBanner._hideTimer = setTimeout(() => {
      joinLeaveBanner.classList.remove("is-visible");
    }, 2600);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function notifyMention(message) {
    const text = String(message.message_text || "");
    const mention = currentUsername
      ? new RegExp("(^|\\s)@" + escapeRegExp(currentUsername) + "\\b", "i")
      : null;

    if (!mention || !mention.test(text)) {
      return;
    }

    const node = chatLog.querySelector(
      "[data-message-id=\"" + String(message.id) + "\"]"
    );
    node?.classList.add("message-mentioned");
    showToast(message.username + " mentioned you.", "success");

    if (
      notificationPreference &&
      notificationPreference.checked &&
      document.hidden &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification("Mention from " + message.username, {
        body: text.slice(0, 140)
      });
    }
  }

  function appendMessage(message, system = false) {
    const messageId =
      !system && message && message.id
        ? String(message.id)
        : null;

    if (messageId && messageIds.has(messageId)) {
      if (message.reactions) {
        renderReactionSummary(messageId, message.reactions);
      }
      return;
    }

    const article = document.createElement("article");
    article.className = system
      ? "message system message-enter"
      : "message message-enter";

    if (messageId) {
      article.dataset.messageId = messageId;
      article.dataset.messageUser = message.username || "";
      messageIds.add(messageId);
    }

    if (system) {
      const text = document.createElement("p");
      text.textContent = message.text;
      article.appendChild(text);
    } else {
      if (message.reply_to_message_id && message.reply_message_text) {
        const replyPreview = document.createElement("div");
        replyPreview.className = "reply-preview";
        const replyName = document.createElement("strong");
        replyName.textContent =
          "Replying to " + (message.reply_username || "message");
        const replyText = document.createElement("span");
        replyText.textContent = message.reply_message_text;
        replyPreview.append(replyName, replyText);
        article.appendChild(replyPreview);
      }

      const meta = document.createElement("div");
      meta.className = "message-meta";
      const authorWrap = document.createElement("div");
      authorWrap.className = "message-author";
      const avatar = document.createElement("span");
      avatar.className = "message-avatar";
      avatar.textContent = String(message.username || "?").slice(0, 1).toUpperCase();
      const author = document.createElement("strong");
      author.textContent = message.username;
      authorWrap.append(avatar, author);
      const time = document.createElement("span");
      time.textContent = new Date(message.created_at || Date.now()).toLocaleString();
      const text = document.createElement("p");
      text.className = "message-text";
      text.textContent = message.message_text;
      meta.append(authorWrap, time);
      article.append(meta, text);

      const reactionSummary = document.createElement("div");
      reactionSummary.className = "message-reactions";
      reactionSummary.dataset.reactionsFor = messageId;
      const inlineActions = document.createElement("div");
      inlineActions.className = "message-inline-actions";
      const replyButton = document.createElement("button");
      replyButton.type = "button";
      replyButton.className = "message-reply-button";
      replyButton.dataset.replyMessage = messageId;
      replyButton.textContent = "Reply";
      const picker = document.createElement("div");
      picker.className = "reaction-picker";
      ["☕", "💜", "👍", "✨", "😂"].forEach((emojiValue) => {
        const reactionButton = document.createElement("button");
        reactionButton.type = "button";
        reactionButton.dataset.reactMessage = messageId;
        reactionButton.dataset.reactEmoji = emojiValue;
        reactionButton.setAttribute("aria-label", "React " + emojiValue);
        reactionButton.textContent = emojiValue;
        picker.appendChild(reactionButton);
      });
      inlineActions.append(replyButton, picker);
      article.append(reactionSummary, inlineActions);

      if (canModerate && message.id) {
        const menu = document.createElement("details");
        menu.className = "message-action-menu";
        const summary = document.createElement("summary");
        summary.setAttribute("aria-label", "Message actions");
        summary.textContent = "•••";
        const form = actionForm(
          "/admin/messages/" + message.id + "/delete",
          "Delete message",
          "danger"
        );
        form.className = "inline-form";
        menu.append(summary, form);
        article.appendChild(menu);
      }
    }

    chatLog.appendChild(article);
    if (messageId && message.reactions) {
      renderReactionSummary(messageId, message.reactions);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function estimatedControllerSeconds() {
    if (!controllerState) {
      return 0;
    }

    let seconds = Number(controllerState.currentSeconds || 0);

    if (controllerState.isPlaying && controllerState.updatedAt) {
      seconds += Math.max(
        0,
        (Date.now() - Number(controllerState.updatedAt)) / 1000
      );
    }

    return seconds;
  }

  function syncPlayer() {
    if (
      !youtubeReady ||
      !player ||
      !controllerState ||
      !controllerState.videoId
    ) {
      return;
    }

    try {
      const data = player.getVideoData ? player.getVideoData() : {};
      const target = estimatedControllerSeconds();

      if (data.video_id !== controllerState.videoId) {
        player.loadVideoById({
          videoId: controllerState.videoId,
          startSeconds: target
        });
      } else if (
        Math.abs((player.getCurrentTime() || 0) - target) > 2.5
      ) {
        player.seekTo(target, true);
      }

      if (controllerState.isPlaying) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }

      followingRoom = true;
      playerStatus.textContent =
        "You are synced to the room controller's playback.";
    } catch (error) {
      console.error("Player sync failed:", error);
    }
  }

  function applyPlayerState(state, forceSync = false) {
    playerState = state;
    controllerState = state.controller || controllerState;

    renderQueue(state.queue || []);
    renderHistory(state.history || []);

    const current = state.currentTrack;
    nowPlayingTitle.textContent = current ? current.title : "Not playing";

    if (mediaTitle) {
      mediaTitle.textContent = current ? current.title : "No video playing";
    }

    if (mediaRequester) {
      mediaRequester.textContent = current
        ? "Requested by " + (current.requested_by_username || "unknown")
        : "Requested by —";
    }

    if (mediaSyncState) {
      mediaSyncState.textContent =
        controllerState && controllerState.username
          ? (controllerState.isPlaying ? "Playing" : "Paused") +
            " · synced by " + controllerState.username
          : "Waiting for room controller";
      mediaSyncState.classList.toggle(
        "live",
        Boolean(controllerState && controllerState.username)
      );
    }

    if (requestedByLine) {
      requestedByLine.textContent = current
        ? `Requested by ${current.requested_by_username || "unknown"}`
        : "Requested by —";
    }

    if (controllerState && controllerState.username) {
      controllerBadge.textContent = "Synced Room";

      if (controllerLine) {
        const stateText = controllerState.isPlaying ? "playing" : "paused";
        controllerLine.textContent =
          `Room controller: ${controllerState.username} is ${stateText} at ${Math.floor(estimatedControllerSeconds())}s.`;
      }

      if (Number(controllerState.userId) === currentUserId) {
        playerStatus.textContent =
          "You are the room controller. Other users sync to your exact playback.";
      }
    } else {
      controllerBadge.textContent = "No Controller";

      if (controllerLine) {
        controllerLine.textContent = "Room controller: none.";
      }

      playerStatus.textContent = "Waiting for a room controller.";
    }

    if (
      (followingRoom || forceSync) &&
      controllerState &&
      controllerState.videoId
    ) {
      syncPlayer();
    }
  }

  window.onYouTubeIframeAPIReady = () => {
    youtubeReady = true;

    player = new YT.Player("player", {
      height: "390",
      width: "640",
      videoId: "",
      playerVars: {
        rel: 0,
        playsinline: 1,
        autoplay: 0,
        origin: window.location.origin
      },
      events: {
        onReady: () => {
          if (followingRoom) {
            syncPlayer();
          }
        },
        onAutoplayBlocked: () => {
          if (enablePlayback) {
            enablePlayback.hidden = false;
          }
          if (mediaSyncState) {
            mediaSyncState.textContent = "Tap to enable playback";
            mediaSyncState.classList.remove("live");
          }
        },
        onStateChange: (event) => {
          if (
            enablePlayback &&
            event.data === YT.PlayerState.PLAYING
          ) {
            enablePlayback.hidden = true;
          }
        }
      }
    });
  };

  document.getElementById("sync-button").addEventListener("click", () => {
    followingRoom = true;
    syncPlayer();
  });

  document
    .getElementById("independent-button")
    .addEventListener("click", () => {
      followingRoom = false;
      playerStatus.textContent =
        "Independent listening enabled. Use Sync to Controller to rejoin.";
    });

  document.getElementById("vote-button").addEventListener("click", () => {
    socket.emit("vote:next", { csrfToken });
  });

  if (mediaSyncButton) {
    mediaSyncButton.addEventListener("click", () => {
      followingRoom = true;
      syncPlayer();
    });
  }

  if (mediaVoteButton) {
    mediaVoteButton.addEventListener("click", () => {
      socket.emit("vote:next", { csrfToken });
    });
  }

  if (enablePlayback) {
    enablePlayback.addEventListener("click", () => {
      followingRoom = true;
      enablePlayback.hidden = true;
      syncPlayer();
    });
  }

  if (mediaCollapse && mediaDock) {
    const storedMediaPreference = localStorage.getItem("lofi.mediaCollapsed");
    const compactByDefault =
      storedMediaPreference === null &&
      window.matchMedia("(max-width: 560px)").matches;
    const initialCollapsed =
      storedMediaPreference === "true" || compactByDefault;

    function setMediaCollapsed(collapsed, persist = true) {
      mediaDock.classList.toggle("is-collapsed", collapsed);
      mediaCollapse.setAttribute(
        "aria-expanded",
        collapsed ? "false" : "true"
      );
      mediaCollapse.textContent = collapsed ? "Expand" : "Mini player";

      if (persist) {
        localStorage.setItem("lofi.mediaCollapsed", String(collapsed));
      }
    }

    setMediaCollapsed(initialCollapsed, false);

    mediaCollapse.addEventListener("click", () => {
      setMediaCollapsed(!mediaDock.classList.contains("is-collapsed"));
    });
  }

  if (membersDetails) {
    const storedMembersPreference =
      localStorage.getItem("lofi.membersExpanded");
    const mobileByDefault =
      window.matchMedia("(max-width: 820px)").matches;

    if (storedMembersPreference === null && mobileByDefault) {
      membersDetails.open = false;
    } else if (storedMembersPreference !== null) {
      membersDetails.open = storedMembersPreference === "true";
    }

    membersDetails.addEventListener("toggle", () => {
      localStorage.setItem(
        "lofi.membersExpanded",
        String(membersDetails.open)
      );
    });
  }
  if (minimizeChatButton && chatBody) {
    minimizeChatButton.addEventListener("click", () => {
      const minimized = chatBody.classList.toggle("is-minimized");
      minimizeChatButton.textContent = minimized
        ? "Open Chat"
        : "Minimize Chat";
    });
  }


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
    if (heldKeys.delete(event.key) && heldKeys.size === 0 && !heldPointerVector) {
      ensureMovementLoop();
    }
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
      ensureMovementLoop();
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

  if (availabilityStatus) {
    availabilityStatus.addEventListener("change", () => {
      const status = availabilityStatus.value;

      availabilityStatus.disabled = true;
      socket.emit(
        "member:availability",
        {
          status,
          csrfToken
        },
        (response) => {
          availabilityStatus.disabled = false;

          if (!response || !response.ok) {
            showToast(
              (response && response.error) || "Could not update room status.",
              "error"
            );
            return;
          }

          if (availabilityStatusNote) {
            availabilityStatusNote.textContent =
              `Status updated: ${availabilityLabel(response.status)}.`;
          }

          showToast(
            `Status: ${availabilityLabel(response.status)}`,
            "success"
          );
        }
      );
    });
  }

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

      profileImageStatus.textContent = "Uploading…";

      const reader = new FileReader();

      reader.addEventListener("load", () => {
        socket.emit(
          "member:profile-image",
          {
            csrfToken,
            imageData: reader.result
          },
          (response) => {
            profileImageStatus.textContent =
              response && response.ok
                ? "Profile picture updated."
                : (response && response.error) || "Upload failed.";
            profileImageInput.value = "";
          }
        );
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
      socket.emit(
        "member:profile-image",
        {
          csrfToken,
          remove: true
        },
        (response) => {
          profileImageStatus.textContent =
            response && response.ok
              ? "Profile picture removed."
              : (response && response.error) || "Could not remove picture.";
        }
      );
    });
  }

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const message = chatInput.value.trim();

    if (!message) {
      return;
    }

    socket.emit("chat:send", {
      message,
      csrfToken,
      replyToMessageId: currentReply ? currentReply.id : null
    });

    chatInput.value = "";
    clearReplyTarget();
    socket.emit("chat:typing", { typing: false });
  });

  chatLog.addEventListener("click", (event) => {
    const replyButton = event.target.closest("[data-reply-message]");
    if (replyButton) {
      setReplyTarget(replyButton.dataset.replyMessage);
      return;
    }

    const reactionButton = event.target.closest("[data-react-message]");
    if (!reactionButton) {
      return;
    }

    socket.emit(
      "chat:react",
      {
        messageId: Number(reactionButton.dataset.reactMessage),
        emoji: reactionButton.dataset.reactEmoji,
        csrfToken
      },
      (response) => {
        if (!response || !response.ok) {
          showToast(
            (response && response.error) || "Could not update reaction.",
            "error"
          );
        }
      }
    );
  });

  if (replyCancel) {
    replyCancel.addEventListener("click", clearReplyTarget);
  }

  chatInput.addEventListener("input", () => {
    socket.emit("chat:typing", {
      typing: chatInput.value.trim().length > 0
    });

    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => {
      socket.emit("chat:typing", { typing: false });
    }, 1400);
  });
  function applyRoomSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    renderMembers(snapshot.members || []);

    if (snapshot.playerState) {
      applyPlayerState(snapshot.playerState);
    }

    if (snapshot.vote) {
      voteCount.textContent =
        `${snapshot.vote.count}/${snapshot.vote.required}`;
    }

    if (snapshot.controller) {
      controllerState = snapshot.controller;
    }

    if (canModerate && pendingList) {
      renderPending(snapshot.pendingRequests || []);
    }
  }

  function requestAuthoritativeRoomState() {
    socket
      .timeout(5000)
      .emit("room:sync-request", (error, response) => {
        if (error) {
          socketStatus.textContent = "Sync retrying";
          socketStatus.classList.remove("live");
          return;
        }

        if (!response || !response.ok) {
          socketStatus.textContent = "Sync failed";
          socketStatus.classList.remove("live");
          return;
        }

        applyRoomSnapshot(response.snapshot);
        socketStatus.textContent = "Live";
        socketStatus.classList.add("live");
      });
  }

  async function loadInitialRoomMembers() {
    try {
      const response = await fetch(`/api/rooms/${roomId}/members`, {
        headers: {
          Accept: "application/json"
        },
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(`members API returned ${response.status}`);
      }

      const payload = await response.json();
      renderMembers(payload.members || []);
    } catch (error) {
      console.error("Initial room member load failed:", error);
    }
  }

  async function loadInitialRoomMessages() {
    try {
      const response = await fetch(
        `/api/rooms/${roomId}/messages`,
        {
          headers: {
            Accept: "application/json"
          },
          credentials: "same-origin"
        }
      );

      if (!response.ok) {
        throw new Error(
          `messages API returned ${response.status}`
        );
      }

      const payload = await response.json();

      for (const message of payload.messages || []) {
        appendMessage(message);
      }
    } catch (error) {
      console.error("Initial room message load failed:", error);
    }
  }

  socket.on("connect", () => {
    socketStatus.textContent = "Syncing";
    document.getElementById("mobile-connection-dot")?.classList.add("online");
    showToast("Connected. Synchronizing room state…", "success");
    socketStatus.classList.remove("live");
    loadInitialRoomMembers();
    loadInitialRoomMessages();
    requestAuthoritativeRoomState();
  });

  socket.on("disconnect", () => {
    socketStatus.textContent = "Reconnecting";
    document.getElementById("mobile-connection-dot")?.classList.remove("online");
    showToast("Connection lost. Reconnecting automatically…", "warning");
    socketStatus.classList.remove("live");

    if (latencyStatus) {
      latencyStatus.textContent = "Latency —";
      latencyStatus.classList.remove("live");
    }
  });

  socket.on("connect_error", (error) => {
    console.error("Realtime connection failed:", error.message);
    socketStatus.textContent =
      error.message === "authentication required"
        ? "Session expired"
        : "Connection failed";
    socketStatus.classList.remove("live");
  });

  socket.on("session:expired", () => {
    window.location.assign("/login");
  });

  socket.on("authorization:updated", () => {
    window.location.reload();
  });

  socket.on("room:snapshot", (snapshot) => {
    applyRoomSnapshot(snapshot);
    socketStatus.textContent = "Live";
    socketStatus.classList.add("live");
  });

  socket.on("chat:new", (message) => {
    appendMessage(message);
    setSpeechBubble(message.username, message.message_text);
    notifyMention(message);

    const mobileChatActive = body.dataset.mobileActive === "chat";
    const chatVisible =
      window.matchMedia("(min-width: 821px)").matches || mobileChatActive;

    if (
      Number(message.user_id) !== currentUserId &&
      (!chatVisible || document.hidden)
    ) {
      updateUnread(1);
    }
  });

  socket.on("message:reactions", ({ messageId, reactions }) => {
    renderReactionSummary(messageId, reactions || []);
  });

  socket.on("chat:typing", ({ userId, username, typing }) => {
    if (Number(userId) === currentUserId) {
      return;
    }

    if (typing) {
      typingUsers.set(Number(userId), username);
    } else {
      typingUsers.delete(Number(userId));
    }

    if (typingIndicator) {
      const names = Array.from(typingUsers.values());
      typingIndicator.textContent = !names.length
        ? ""
        : names.length === 1
          ? names[0] + " is typing…"
          : names.slice(0, 2).join(", ") + " are typing…";
    }
  });

  socket.on("chat:deleted", ({ id }) => {
    const node = chatLog.querySelector(
      `[data-message-id="${String(id)}"]`
    );

    if (node) {
      node.remove();
    }

    messageIds.delete(String(id));
  });

  socket.on("room:system", (message) => {
    appendMessage(message, true);
    showJoinLeaveBanner(message && message.text);
  });

  socket.on("presence:update", ({ members }) => {
    renderMembers(members || []);
  });

  socket.on("member:moved", (payload) => {
    applyRemoteAvatarMove(payload);
  });

  socket.on("requests:update", ({ pendingRequests }) => {
    renderPending(pendingRequests || []);
  });

  socket.on("vote:update", (vote) => {
    voteCount.textContent = `${vote.count}/${vote.required}`;
  });

  socket.on("controller:update", ({ controller }) => {
    controllerState = controller;

    if (controllerState && controllerState.username && controllerLine) {
      const stateText = controllerState.isPlaying ? "playing" : "paused";
      controllerLine.textContent =
        `Room controller: ${controllerState.username} is ${stateText} at ${Math.floor(estimatedControllerSeconds())}s.`;
    }

    if (followingRoom) {
      syncPlayer();
    }
  });

  socket.on("player:state", (state) => {
    applyPlayerState(state);
  });

  socket.on("player:force-sync", (state) => {
    followingRoom = true;
    applyPlayerState(state, true);
  });

  setInterval(() => {
    if (!socket.connected || !latencyStatus) {
      return;
    }

    const started = performance.now();

    socket
      .timeout(3000)
      .emit("client:ping", (error) => {
        if (error) {
          latencyStatus.textContent = "Latency timeout";
          latencyStatus.classList.remove("live");
          return;
        }

        const roundTrip = Math.max(
          0,
          Math.round(performance.now() - started)
        );

        latencyStatus.textContent = `Latency ${roundTrip} ms`;
        latencyStatus.classList.toggle("live", roundTrip < 180);
      });
  }, 5000);

  setInterval(() => {
    if (!player || !youtubeReady) {
      return;
    }

    let currentSeconds = 0;
    let isPlaying = false;

    try {
      currentSeconds = Math.floor(player.getCurrentTime() || 0);
      isPlaying = player.getPlayerState() === YT.PlayerState.PLAYING;
    } catch {
      return;
    }

    const trackTitle =
      playerState && playerState.currentTrack
        ? playerState.currentTrack.title
        : "Not playing";

    socket.emit("member:status", {
      playbackStatus: isPlaying ? "Playing" : "Paused",
      trackTitle,
      followingRoom,
      currentSeconds,
      isPlaying
    });

    if (
      controllerState &&
      Number(controllerState.userId) === currentUserId
    ) {
      socket.emit("controller:heartbeat", {
        trackId:
          playerState && playerState.currentTrack
            ? playerState.currentTrack.id
            : null,
        trackTitle,
        videoId:
          playerState && playerState.currentTrack
            ? playerState.currentTrack.video_id
            : null,
        currentSeconds,
        isPlaying
      });
    }
  }, 5000);

  setInterval(() => {
    if (!player || !youtubeReady || !mediaProgressText || !mediaProgressBar) {
      return;
    }

    try {
      const current = Math.max(0, Number(player.getCurrentTime() || 0));
      const duration = Math.max(0, Number(player.getDuration() || 0));
      const percent = duration > 0
        ? Math.min(100, (current / duration) * 100)
        : 0;

      mediaProgressBar.style.width = percent + "%";
      mediaProgressText.textContent =
        formatClock(current) + " / " + formatClock(duration);
    } catch {
      // Player may be transitioning between videos.
    }
  }, 1000);

  function setMobileView(target) {
    const allowed = new Set(["room", "chat", "music", "profile"]);
    const selected = allowed.has(target) ? target : "room";

    body.dataset.mobileActive = selected;

    document.querySelectorAll("[data-mobile-target]").forEach((button) => {
      const active = button.dataset.mobileTarget === selected;
      button.classList.toggle("is-active", active);
      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    if (selected === "chat") {
      unreadCount = 0;
      updateUnread(0);
      requestAnimationFrame(() => {
        chatLog.scrollTop = chatLog.scrollHeight;
      });
    }

    if (window.matchMedia("(max-width: 820px)").matches) {
      const reduceMotion =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({
        top: 0,
        behavior: reduceMotion ? "auto" : "smooth"
      });
    }
  }

  document.querySelectorAll("[data-mobile-target]").forEach((button) => {
    button.addEventListener("click", () => {
      setMobileView(button.dataset.mobileTarget);
    });
  });

  if (mobileMoreButton) {
    mobileMoreButton.addEventListener("click", () => {
      setMobileView("profile");
    });
  }

  const savedTheme = localStorage.getItem("lofi.theme") || "espresso";
  body.dataset.theme = ["espresso", "midnight", "plum"].includes(savedTheme)
    ? savedTheme
    : "espresso";

  if (themeSelect) {
    themeSelect.value = body.dataset.theme;
    themeSelect.addEventListener("change", () => {
      body.dataset.theme = themeSelect.value;
      localStorage.setItem("lofi.theme", themeSelect.value);
    });
  }

  if (notificationPreference) {
    notificationPreference.checked =
      localStorage.getItem("lofi.notifications") === "true";

    notificationPreference.addEventListener("change", async () => {
      if (
        notificationPreference.checked &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        const permission = await Notification.requestPermission();
        notificationPreference.checked = permission === "granted";
      }

      localStorage.setItem(
        "lofi.notifications",
        String(notificationPreference.checked)
      );
    });
  }

  function renderFocusTimer() {
    if (!focusDisplay) {
      return;
    }

    focusDisplay.textContent = formatClock(focusRemainingSeconds);
    if (focusModeBadge) {
      focusModeBadge.textContent = focusIsBreak ? "5 min break" : "25 min";
    }
    if (focusMode) {
      focusMode.textContent = focusIsBreak
        ? "Switch to 25 min focus"
        : "Switch to 5 min break";
    }
  }

  function stopFocusTimer() {
    if (focusTimerId) {
      clearInterval(focusTimerId);
      focusTimerId = null;
    }

    if (focusStart) {
      focusStart.textContent = "Start";
    }
  }

  if (focusStart) {
    focusStart.addEventListener("click", () => {
      if (focusTimerId) {
        stopFocusTimer();
        return;
      }

      focusStart.textContent = "Pause";
      focusTimerId = setInterval(() => {
        focusRemainingSeconds -= 1;
        renderFocusTimer();

        if (focusRemainingSeconds <= 0) {
          stopFocusTimer();
          const completedWasBreak = focusIsBreak;
          focusRemainingSeconds = focusIsBreak ? 5 * 60 : 25 * 60;
          renderFocusTimer();
          showToast(
            completedWasBreak
              ? "Break complete. Ready to focus?"
              : "Focus session complete. Take a break.",
            "success"
          );

          if (
            notificationPreference &&
            notificationPreference.checked &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            new Notification("Secure Lo-Fi Study Café", {
              body: completedWasBreak
                ? "Break complete."
                : "Focus session complete."
            });
          }
        }
      }, 1000);
    });
  }

  if (focusReset) {
    focusReset.addEventListener("click", () => {
      stopFocusTimer();
      focusRemainingSeconds = focusIsBreak ? 5 * 60 : 25 * 60;
      renderFocusTimer();
    });
  }

  if (focusMode) {
    focusMode.addEventListener("click", () => {
      stopFocusTimer();
      focusIsBreak = !focusIsBreak;
      focusRemainingSeconds = focusIsBreak ? 5 * 60 : 25 * 60;
      renderFocusTimer();
    });
  }

  renderFocusTimer();
  fetch("/api/player-state", {
    headers: {
      Accept: "application/json"
    }
  })
    .then((response) =>
      response.ok
        ? response.json()
        : Promise.reject(new Error("player state failed"))
    )
    .then((state) => {
      applyPlayerState(state);
    })
    .catch(() => {
      playerStatus.textContent = "Waiting for live room state…";
    });

  if (canModerate && pendingList) {
    fetch("/api/pending-requests", {
      headers: {
        Accept: "application/json"
      }
    })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("pending request load failed"))
      )
      .then(({ pendingRequests }) => {
        renderPending(pendingRequests || []);
      })
      .catch(() => {
        renderPending([]);
      });
  }

  loadInitialRoomMembers();
  loadInitialRoomMessages();
  chatLog.scrollTop = chatLog.scrollHeight;
})();
