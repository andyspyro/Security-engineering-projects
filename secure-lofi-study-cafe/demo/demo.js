(() => {
  "use strict";

  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatLog = document.getElementById("chat-log");
  const requestForm = document.getElementById("request-form");
  const requestTitle = document.getElementById("request-title");
  const requestUrl = document.getElementById("request-url");
  const queueList = document.getElementById("queue-list");
  const voteButton = document.getElementById("vote-button");
  const voteCount = document.getElementById("vote-count");
  const playerStatus = document.getElementById("player-status");

  let votes = 0;

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = chatInput.value.trim();
    if (!value) return;

    const article = document.createElement("article");
    article.className = "message";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const author = document.createElement("strong");
    author.textContent = "portfolio_demo";

    const time = document.createElement("span");
    time.textContent = "just now";

    const message = document.createElement("p");
    message.textContent = value;

    meta.append(author, time);
    article.append(meta, message);
    chatLog.appendChild(article);
    chatInput.value = "";
    chatLog.scrollTop = chatLog.scrollHeight;
  });

  requestForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = requestTitle.value.trim();
    const url = requestUrl.value.trim();

    if (!title || !url) return;

    const item = document.createElement("div");
    item.className = "list-item";

    const copy = document.createElement("div");
    copy.className = "list-item-copy";

    const heading = document.createElement("p");
    heading.className = "list-item-title";
    heading.textContent = title;

    const meta = document.createElement("p");
    meta.className = "list-item-meta";
    meta.textContent = "demo request · portfolio_demo";

    copy.append(heading, meta);
    item.appendChild(copy);
    queueList.appendChild(item);

    requestForm.reset();
  });

  voteButton.addEventListener("click", () => {
    votes = Math.min(votes + 1, 2);
    voteCount.textContent = `${votes}/2`;

    if (votes >= 2) {
      playerStatus.textContent = "Demo majority reached. The full app would advance the synchronized room.";
      votes = 0;
      setTimeout(() => {
        voteCount.textContent = "0/2";
      }, 1200);
    }
  });

  document.getElementById("sync-button").addEventListener("click", () => {
    playerStatus.textContent = "Synced with the room controller.";
  });

  document.getElementById("independent-button").addEventListener("click", () => {
    playerStatus.textContent = "Independent listening enabled. Click Sync with room to rejoin.";
  });
})();
