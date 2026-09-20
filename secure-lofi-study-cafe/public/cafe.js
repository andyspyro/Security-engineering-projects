(() => {
  "use strict";

  const body = document.body;
  const csrfToken = body.dataset.csrf;
  const currentUserId = Number(body.dataset.userId);
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
  const queueList = document.getElementById("queue-list");
  const historyList = document.getElementById("history-list");
  const membersList = document.getElementById("members-list");
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

  let latestMembers = [];
  let player = null;
  let youtubeReady = false;
  let playerState = null;
  let controllerState = null;
  let followingRoom = true;

  const speechBubbles = new Map();
  const heldKeys = new Set();
  let heldPointerVector = null;
  let movementTarget = null;
  let movementFrame = null;
  let lastMovementTime = 0;
  let lastMovementEmit = 0;
  let isWalking = false;

  const WALK_SPEED = 24;
  const MOVE_EMIT_INTERVAL_MS = 90;
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

  function renderQueue(queue = []) {
    queueList.replaceChildren();

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
        `room-avatar avatar-${style}${isCurrent ? " is-you" : ""}${isCurrent && isWalking ? " is-walking" : ""}`;
      avatar.style.left = `${Number(member.avatarX || 50)}%`;
      avatar.style.top = `${Number(member.avatarY || 50)}%`;
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
      socket.emit("member:move", {
        x: member.avatarX,
        y: member.avatarY
      });
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
      const item = document.createElement("div");
      item.className = "member-card";

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

      status.textContent = `${playback}${track} · ${mode}`;

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

      if (canAssign && member.id !== currentUserId) {
        right.appendChild(
          actionForm(
            `/admin/members/${member.id}/${member.isTempAdmin ? "remove-temp-admin" : "temp-admin"}`,
            member.isTempAdmin ? "Remove Temp Admin" : "Make Temp Admin"
          )
        );
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

  function appendMessage(message, system = false) {
    const article = document.createElement("article");
    article.className = system ? "message system" : "message";

    if (message.id) {
      article.dataset.messageId = message.id;
    }

    if (system) {
      const text = document.createElement("p");
      text.textContent = message.text;
      article.appendChild(text);
    } else {
      const meta = document.createElement("div");
      meta.className = "message-meta";

      const author = document.createElement("strong");
      author.textContent = message.username;

      const time = document.createElement("span");
      time.textContent = new Date(
        message.created_at || Date.now()
      ).toLocaleString();

      const text = document.createElement("p");
      text.textContent = message.message_text;

      meta.append(author, time);
      article.append(meta, text);

      if (canModerate && message.id) {
        const form = actionForm(
          `/admin/messages/${message.id}/delete`,
          "Delete",
          "danger"
        );
        form.className = "inline-form";
        article.appendChild(form);
      }
    }

    chatLog.appendChild(article);
    loadInitialRoomMembers();
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
        modestbranding: 1
      },
      events: {
        onReady: () => {
          if (followingRoom) {
            syncPlayer();
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
      csrfToken
    });

    chatInput.value = "";
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

  socket.on("connect", () => {
    socketStatus.textContent = "Syncing";
    socketStatus.classList.remove("live");
    loadInitialRoomMembers();
    requestAuthoritativeRoomState();
  });

  socket.on("disconnect", () => {
    socketStatus.textContent = "Reconnecting";
    socketStatus.classList.remove("live");
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
  });

  socket.on("chat:deleted", ({ id }) => {
    const node = chatLog.querySelector(
      `[data-message-id="${String(id)}"]`
    );

    if (node) {
      node.remove();
    }
  });

  socket.on("room:system", (message) => {
    appendMessage(message, true);
  });

  socket.on("presence:update", ({ members }) => {
    renderMembers(members || []);
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

  chatLog.scrollTop = chatLog.scrollHeight;
})();
