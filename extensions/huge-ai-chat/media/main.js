(function () {
  const vscode = acquireVsCodeApi();

  const state = {
    version: 1,
    activeThreadId: null,
    threads: [],
  };

  const runtime = {
    authRunning: false,
    authMessage: "",
    canRetry: false,
  };

  const dom = {
    newThreadBtn: document.getElementById("newThreadBtn"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    runSetupBtn: document.getElementById("runSetupBtn"),
    retryBtn: document.getElementById("retryBtn"),
    languageSelect: document.getElementById("languageSelect"),
    threadList: document.getElementById("threadList"),
    messages: document.getElementById("messages"),
    input: document.getElementById("input"),
    sendBtn: document.getElementById("sendBtn"),
    authBanner: document.getElementById("authBanner"),
    authText: document.getElementById("authText"),
  };

  function post(message) {
    vscode.postMessage(message);
  }

  function getActiveThread() {
    if (!state.activeThreadId) {
      return null;
    }
    return state.threads.find((thread) => thread.id === state.activeThreadId) || null;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function decodeBase64Utf8(value) {
    try {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }

  function sanitizeHttpUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return parsed.href;
    } catch {
      return null;
    }
  }

  function renderMarkdown(raw) {
    if (!raw) {
      return "";
    }

    let text = raw;
    const debugBlocks = [];
    const codeBlocks = [];
    const DEBUG_BLOCK_REGEX =
      /:::huge_ai_chat_debug_start:::\n([A-Za-z0-9+/=]+)\n:::huge_ai_chat_debug_end:::/g;

    text = text.replace(DEBUG_BLOCK_REGEX, (_, payload) => {
      const token = `__DEBUG_BLOCK_${debugBlocks.length}__`;
      debugBlocks.push(decodeBase64Utf8(payload));
      return token;
    });

    text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
      const token = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(code);
      return token;
    });

    text = escapeHtml(text);
    text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => {
        const safeUrl = sanitizeHttpUrl(url);
        if (!safeUrl) {
          return label;
        }
        return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
    );

    text = text
      .split(/\n{2,}/)
      .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
      .join("");

    text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => {
      const code = codeBlocks[Number(index)] || "";
      return `<pre><code>${escapeHtml(code)}</code></pre>`;
    });

    text = text.replace(/__DEBUG_BLOCK_(\d+)__/g, (_, index) => {
      const debugText = debugBlocks[Number(index)] || "";
      return (
        "<details><summary>调试信息</summary><pre><code>" +
        escapeHtml(debugText) +
        "</code></pre></details>"
      );
    });

    return text;
  }

  function renderThreads() {
    dom.threadList.innerHTML = "";

    if (!state.threads.length) {
      const li = document.createElement("li");
      li.className = "thread-item";
      li.textContent = "暂无会话";
      dom.threadList.appendChild(li);
      return;
    }

    for (const thread of state.threads) {
      const li = document.createElement("li");
      li.className = `thread-item ${thread.id === state.activeThreadId ? "active" : ""}`;
      li.dataset.threadId = thread.id;

      const title = document.createElement("div");
      title.className = "thread-title";
      title.textContent = thread.title || "新会话";
      li.appendChild(title);

      const del = document.createElement("button");
      del.className = "thread-delete";
      del.textContent = "×";
      del.title = "删除线程";
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        post({
          type: "thread/delete",
          threadId: thread.id,
        });
      });
      li.appendChild(del);

      li.addEventListener("click", () => {
        post({
          type: "thread/switch",
          threadId: thread.id,
        });
      });

      dom.threadList.appendChild(li);
    }
  }

  function renderMessages() {
    const thread = getActiveThread();
    dom.messages.innerHTML = "";

    if (!thread) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "请先创建会话。";
      dom.messages.appendChild(empty);
      return;
    }

    dom.languageSelect.value = thread.language;

    if (!thread.messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "发送第一条消息开始对话。";
      dom.messages.appendChild(empty);
      return;
    }

    for (const message of thread.messages) {
      const wrapper = document.createElement("div");
      wrapper.className = `message ${message.role} ${message.status}`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = message.role === "user" ? "You" : "Google AI";
      wrapper.appendChild(meta);

      const body = document.createElement("div");
      if (message.role === "assistant") {
        body.innerHTML = renderMarkdown(message.content);
      } else {
        body.textContent = message.content;
      }
      wrapper.appendChild(body);
      dom.messages.appendChild(wrapper);
    }

    dom.messages.scrollTop = dom.messages.scrollHeight;
  }

  function renderAuthBanner() {
    const visible = runtime.authRunning || Boolean(runtime.authMessage);
    dom.authBanner.classList.toggle("hidden", !visible);
    if (!visible) {
      return;
    }

    dom.authText.textContent = runtime.authRunning
      ? "正在打开浏览器进行登录/验证码验证，请按提示完成。"
      : runtime.authMessage || "";
    dom.runSetupBtn.disabled = runtime.authRunning;
    dom.retryBtn.disabled = runtime.authRunning || !runtime.canRetry || !state.activeThreadId;
  }

  function saveDraft() {
    const oldState = vscode.getState() || {};
    vscode.setState({
      ...oldState,
      draft: dom.input.value,
    });
  }

  function restoreDraft() {
    const oldState = vscode.getState() || {};
    if (typeof oldState.draft === "string") {
      dom.input.value = oldState.draft;
    }
  }

  function sendCurrentMessage() {
    const thread = getActiveThread();
    if (!thread) {
      return;
    }

    const text = dom.input.value.trim();
    if (!text) {
      return;
    }

    post({
      type: "chat/send",
      threadId: thread.id,
      text,
      language: dom.languageSelect.value,
    });

    dom.input.value = "";
    saveDraft();
  }

  function handleHostMessage(message) {
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return;
    }

    switch (message.type) {
      case "state/full":
      case "state/updated":
        state.version = message.state.version;
        state.activeThreadId = message.state.activeThreadId;
        state.threads = Array.isArray(message.state.threads) ? message.state.threads : [];
        renderThreads();
        renderMessages();
        renderAuthBanner();
        break;
      case "chat/pending":
        runtime.canRetry = false;
        renderAuthBanner();
        break;
      case "chat/answer":
        runtime.canRetry = false;
        renderAuthBanner();
        break;
      case "chat/error":
        runtime.canRetry = Boolean(message.canRetry);
        renderAuthBanner();
        break;
      case "auth/running":
        runtime.authRunning = true;
        runtime.authMessage = "";
        runtime.canRetry = false;
        renderAuthBanner();
        break;
      case "auth/completed":
        runtime.authRunning = false;
        runtime.authMessage = message.message || "";
        runtime.canRetry = true;
        renderAuthBanner();
        break;
      default:
        break;
    }
  }

  function wireEvents() {
    dom.newThreadBtn.addEventListener("click", () => {
      post({
        type: "thread/create",
        language: dom.languageSelect.value,
      });
    });

    dom.clearHistoryBtn.addEventListener("click", () => {
      const ok = window.confirm("确定清空所有聊天线程吗？");
      if (!ok) {
        return;
      }
      post({ type: "thread/clearAll" });
      runtime.authMessage = "";
      runtime.canRetry = false;
      renderAuthBanner();
    });

    dom.runSetupBtn.addEventListener("click", () => {
      post({ type: "auth/runSetup" });
    });

    dom.retryBtn.addEventListener("click", () => {
      if (!state.activeThreadId) {
        return;
      }
      post({
        type: "chat/retryLast",
        threadId: state.activeThreadId,
      });
    });

    dom.sendBtn.addEventListener("click", () => {
      sendCurrentMessage();
    });

    dom.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendCurrentMessage();
      }
    });

    dom.input.addEventListener("input", () => {
      saveDraft();
    });
  }

  window.addEventListener("message", (event) => {
    handleHostMessage(event.data);
  });

  restoreDraft();
  wireEvents();
  post({ type: "panel/ready" });
})();
