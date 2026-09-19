(() => {
  "use strict";

  const body = document.body;
  const csrfToken = body.dataset.csrf;
  const currentUserId = Number(body.dataset.userId);
  const canModerate = body.dataset.canModerate === "true";
  const canAssign = body.dataset.canAssign === "true";

  const socket = io();

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

  let player = null;
  let youtubeReady = false;
  let playerState = null;
  let controllerState = null;
  let followingRoom = true;

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

  function renderMembers(members = []) {
    membersList.replaceChildren();

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

      item.append(left, right);
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

  socket.on("connect", () => {
    socketStatus.textContent = "Live";
    socketStatus.classList.add("live");
  });

  socket.on("disconnect", () => {
    socketStatus.textContent = "Reconnecting";
    socketStatus.classList.remove("live");
  });

  socket.on("chat:new", (message) => {
    appendMessage(message);
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
