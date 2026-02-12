(function () {
  const vscode = acquireVsCodeApi();
  const DEFAULT_INPUT_PLACEHOLDER = "输入问题，Enter 发送，Shift+Enter 换行";
  const DEBUG_BLOCK_START = ":::huge_ai_chat_debug_start:::";
  const DEBUG_BLOCK_END = ":::huge_ai_chat_debug_end:::";
  const KNOWN_CODE_LANGUAGES = new Set([
    "python",
    "py",
    "javascript",
    "js",
    "typescript",
    "ts",
    "tsx",
    "jsx",
    "java",
    "c",
    "cpp",
    "c++",
    "csharp",
    "cs",
    "go",
    "rust",
    "ruby",
    "php",
    "kotlin",
    "swift",
    "sql",
    "bash",
    "shell",
    "sh",
    "powershell",
    "ps1",
    "yaml",
    "yml",
    "json",
    "xml",
    "html",
    "css",
    "scss",
    "less",
    "vue",
    "svelte",
    "text",
  ]);

  const state = {
    version: 1,
    activeThreadId: null,
    threads: [],
  };

  const runtime = {
    authRunning: false,
    authMessage: "",
    canRetry: false,
    historyOpen: false,
    historyKeyword: "",
    globalStatus: {
      kind: "idle",
      title: "系统就绪",
      detail: "等待你的提问。",
      suggestion: "输入问题后按 Enter 发送。",
      at: Date.now(),
    },
    threadStatus: {},
  };

  const dom = {
    newThreadBtn: document.getElementById("newThreadBtn"),
    historyBtn: document.getElementById("historyBtn"),
    historyPanel: document.getElementById("historyPanel"),
    historyBackdrop: document.getElementById("historyBackdrop"),
    historyCloseBtn: document.getElementById("historyCloseBtn"),
    historySearchInput: document.getElementById("historySearchInput"),
    copyThreadBtn: document.getElementById("copyThreadBtn"),
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
    statusBar: document.getElementById("statusBar"),
    statusTitle: document.getElementById("statusTitle"),
    statusTime: document.getElementById("statusTime"),
    statusDetail: document.getElementById("statusDetail"),
    statusSuggestion: document.getElementById("statusSuggestion"),
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

  function normalizeStatus(status) {
    if (!status || typeof status !== "object") {
      return null;
    }

    const candidate = status;
    const allowedKinds = new Set(["idle", "progress", "success", "warning", "error"]);
    const kind = allowedKinds.has(candidate.kind) ? candidate.kind : "idle";

    return {
      kind,
      title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : "状态更新",
      detail: typeof candidate.detail === "string" ? candidate.detail.trim() : "",
      suggestion: typeof candidate.suggestion === "string" ? candidate.suggestion.trim() : "",
      threadId: typeof candidate.threadId === "string" && candidate.threadId ? candidate.threadId : undefined,
      at: typeof candidate.at === "number" ? candidate.at : Date.now(),
    };
  }

  function setStatus(status) {
    const normalized = normalizeStatus(status);
    if (!normalized) {
      return;
    }
    if (normalized.threadId) {
      runtime.threadStatus[normalized.threadId] = normalized;
    } else {
      runtime.globalStatus = normalized;
    }
    renderStatusBar();
  }

  function pruneThreadStatus() {
    const validThreadIds = new Set(state.threads.map((thread) => thread.id));
    for (const threadId of Object.keys(runtime.threadStatus)) {
      if (!validThreadIds.has(threadId)) {
        delete runtime.threadStatus[threadId];
      }
    }
  }

  function getVisibleStatus() {
    const activeThread = getActiveThread();
    if (activeThread && runtime.threadStatus[activeThread.id]) {
      return runtime.threadStatus[activeThread.id];
    }
    return runtime.globalStatus;
  }

  function formatStatusTime(value) {
    if (!value) {
      return "";
    }
    try {
      return new Date(value).toLocaleTimeString([], {
        hour12: false,
      });
    } catch {
      return "";
    }
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatThreadLastTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    const sameMonth = date.getMonth() === now.getMonth();
    const sameDay = date.getDate() === now.getDate();

    const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    if (sameYear && sameMonth && sameDay) {
      return hm;
    }
    if (sameYear) {
      return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${hm}`;
    }
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "";
    }
  }

  function normalizeAssistantMarkdownForExport(raw) {
    if (!raw) {
      return "";
    }
    const debugPattern = new RegExp(
      `${DEBUG_BLOCK_START}\\n([A-Za-z0-9+/=]+)\\n${DEBUG_BLOCK_END}`,
      "g"
    );
    return raw.replace(debugPattern, (_, payload) => {
      const debugText = decodeBase64Utf8(payload).trim();
      if (!debugText) {
        return "";
      }
      return [
        "<details>",
        "<summary>调试信息</summary>",
        "",
        "```text",
        debugText,
        "```",
        "",
        "</details>",
      ].join("\n");
    });
  }

  function buildMessageMarkdown(message) {
    if (!message) {
      return "";
    }
    if (message.role === "assistant") {
      return normalizeAssistantMarkdownForExport(message.content || "").trim();
    }
    return (message.content || "").trim();
  }

  function buildThreadMarkdown(thread) {
    if (!thread) {
      return "";
    }
    const lines = [];
    lines.push(`# ${thread.title || "未命名会话"}`);
    lines.push(`- 导出时间: ${formatDateTime(Date.now())}`);
    lines.push(`- 会话ID: \`${thread.id}\``);
    if (thread.sessionId) {
      lines.push(`- 搜索Session: \`${thread.sessionId}\``);
    }
    lines.push("");

    thread.messages.forEach((message, index) => {
      const roleTitle = message.role === "user" ? "User" : "Assistant";
      lines.push(`## ${roleTitle} ${index + 1}`);
      lines.push(`- 时间: ${formatDateTime(message.createdAt)}`);
      lines.push("");
      lines.push(buildMessageMarkdown(message) || "_(空内容)_");
      lines.push("");
    });

    return lines.join("\n").trim();
  }

  async function copyTextToClipboard(text) {
    if (!text) {
      return false;
    }

    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below.
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const result = document.execCommand("copy");
      document.body.removeChild(textarea);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  function flashButton(button, nextLabel, duration = 1300) {
    if (!button) {
      return;
    }
    const origin = button.dataset.label || button.textContent || "";
    if (!button.dataset.label) {
      button.dataset.label = origin;
    }
    button.textContent = nextLabel;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = button.dataset.label || origin;
      button.disabled = false;
    }, duration);
  }

  async function copyWithFeedback(text, options) {
    const {
      button,
      successTitle,
      successDetail,
      successSuggestion,
      failureTitle,
      failureDetail,
      failureSuggestion,
      threadId,
    } = options;

    const ok = await copyTextToClipboard(text);
    if (button) {
      flashButton(button, ok ? "已复制" : "复制失败");
    }

    setStatus({
      kind: ok ? "success" : "error",
      title: ok ? successTitle : failureTitle,
      detail: ok ? successDetail : failureDetail,
      suggestion: ok ? successSuggestion : failureSuggestion,
      threadId,
      at: Date.now(),
    });

    return ok;
  }

  function renderStatusBar() {
    const status = getVisibleStatus();
    dom.statusBar.className = `status-bar status-${status.kind}`;
    dom.statusTitle.textContent = status.title;
    dom.statusTime.textContent = formatStatusTime(status.at);

    if (status.detail) {
      dom.statusDetail.textContent = status.detail;
      dom.statusDetail.style.display = "block";
    } else {
      dom.statusDetail.textContent = "";
      dom.statusDetail.style.display = "none";
    }

    if (status.suggestion) {
      dom.statusSuggestion.textContent = status.suggestion;
      dom.statusSuggestion.style.display = "block";
    } else {
      dom.statusSuggestion.textContent = "";
      dom.statusSuggestion.style.display = "none";
    }
  }

  function isThreadPending(thread) {
    if (!thread) {
      return false;
    }
    return thread.messages.some((message) => message.role === "assistant" && message.status === "pending");
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

  function normalizeLanguageName(raw) {
    const language = String(raw || "").trim().toLowerCase();
    if (!language) {
      return "";
    }
    if (language === "py") {
      return "python";
    }
    if (language === "js") {
      return "javascript";
    }
    if (language === "ts") {
      return "typescript";
    }
    if (language === "sh") {
      return "bash";
    }
    if (language === "ps1") {
      return "powershell";
    }
    if (language === "yml") {
      return "yaml";
    }
    if (language === "c++") {
      return "cpp";
    }
    return language;
  }

  function isLanguageMarkerLine(line) {
    const normalized = normalizeLanguageName(line);
    return KNOWN_CODE_LANGUAGES.has(normalized);
  }

  function looksLikeCodeLine(line) {
    const text = String(line || "");
    const trimmed = text.trim();
    if (!trimmed) {
      return true;
    }
    if (/^```/.test(trimmed)) {
      return true;
    }
    if (/^(import|from|def|class|function|const|let|var|if|elif|else|for|while|try|except|catch|finally|return|print|console\.log)\b/.test(trimmed)) {
      return true;
    }
    if (/^(#|\/\/|\/\*|\*|--)/.test(trimmed)) {
      return true;
    }
    if (/^[\]\[(){}]/.test(trimmed) || /[=;{}()[\]<>]|=>|::|:=|->/.test(trimmed)) {
      return true;
    }
    if (/^\s{2,}\S/.test(text)) {
      return true;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*[:(]/.test(trimmed)) {
      return true;
    }
    if (/^[-+/*%]/.test(trimmed)) {
      return true;
    }
    return false;
  }

  function isLikelyProseLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      return false;
    }
    if (/[\u4e00-\u9fff]/.test(trimmed) && /[。！？；，]/.test(trimmed) && !/[=;{}()[\]<>]/.test(trimmed)) {
      return true;
    }
    if (/^(你可以|你还可以|如果你|想让我|需要我|说明|总结|参考)/.test(trimmed)) {
      return true;
    }
    return false;
  }

  function autoFenceLooseCodeBlocks(raw) {
    if (!raw || raw.includes("```")) {
      return raw;
    }

    const lines = raw.split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const marker = lines[i].trim();
      if (!isLanguageMarkerLine(marker)) {
        out.push(lines[i]);
        i += 1;
        continue;
      }

      const language = normalizeLanguageName(marker);
      let j = i + 1;
      let codeLikeCount = 0;
      let endedByProse = false;

      while (j < lines.length) {
        const line = lines[j];
        const trimmed = line.trim();
        if (!trimmed) {
          j += 1;
          continue;
        }
        if (isLikelyProseLine(line)) {
          endedByProse = true;
          break;
        }
        if (looksLikeCodeLine(line)) {
          codeLikeCount += 1;
          j += 1;
          continue;
        }
        endedByProse = true;
        break;
      }

      if (codeLikeCount < 2) {
        out.push(lines[i]);
        i += 1;
        continue;
      }

      const blockLines = lines.slice(i + 1, j);
      while (blockLines.length && !blockLines[0].trim()) {
        blockLines.shift();
      }
      while (blockLines.length && !blockLines[blockLines.length - 1].trim()) {
        blockLines.pop();
      }

      if (blockLines.length === 0) {
        out.push(lines[i]);
        i += 1;
        continue;
      }

      out.push("```" + language);
      out.push(...blockLines);
      out.push("```");

      i = j;
      if (endedByProse && i < lines.length) {
        out.push(lines[i]);
        i += 1;
      }
    }

    return out.join("\n");
  }

  function renderMarkdown(raw) {
    if (!raw) {
      return "";
    }

    let text = autoFenceLooseCodeBlocks(raw);
    const debugBlocks = [];
    const codeBlocks = [];
    const debugRegex = new RegExp(
      `${DEBUG_BLOCK_START}\\n([A-Za-z0-9+/=]+)\\n${DEBUG_BLOCK_END}`,
      "g"
    );

    text = text.replace(debugRegex, (_, payload) => {
      const token = `__DEBUG_BLOCK_${debugBlocks.length}__`;
      debugBlocks.push(decodeBase64Utf8(payload));
      return token;
    });

    text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, info, code) => {
      const token = `__CODE_BLOCK_${codeBlocks.length}__`;
      const language = String(info || "").trim().split(/\s+/)[0] || "";
      codeBlocks.push({
        code,
        language,
      });
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
        return `<a class="source-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(safeUrl)}">${label}</a>`;
      }
    );

    text = text
      .split(/\n{2,}/)
      .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
      .join("");

    text = text.replace(/<p>__CODE_BLOCK_(\d+)__<\/p>/g, "__CODE_BLOCK_$1__");
    text = text.replace(/<p>__DEBUG_BLOCK_(\d+)__<\/p>/g, "__DEBUG_BLOCK_$1__");

    text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => {
      const block = codeBlocks[Number(index)];
      if (!block) {
        return "";
      }
      const languageLabel = block.language || "text";
      return [
        `<div class="code-block">`,
        `  <div class="code-toolbar">`,
        `    <span class="code-lang">${escapeHtml(languageLabel)}</span>`,
        `    <button type="button" class="mini-btn copy-code-btn" data-label="复制代码">复制代码</button>`,
        `  </div>`,
        `  <pre><code>${escapeHtml(block.code)}</code></pre>`,
        `</div>`,
      ].join("");
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

  function getThreadSearchText(thread) {
    if (!thread) {
      return "";
    }
    const title = thread.title || "";
    const messages = Array.isArray(thread.messages)
      ? thread.messages
          .map((message) => (message && typeof message.content === "string" ? message.content : ""))
          .join("\n")
      : "";
    return `${title}\n${messages}`.toLowerCase();
  }

  function setHistoryOpen(open) {
    runtime.historyOpen = Boolean(open);
    dom.historyPanel.classList.toggle("hidden", !runtime.historyOpen);
    dom.historyBackdrop.classList.toggle("hidden", !runtime.historyOpen);
    dom.historyBtn.classList.toggle("active", runtime.historyOpen);
    dom.historyBtn.setAttribute("aria-expanded", runtime.historyOpen ? "true" : "false");

    if (runtime.historyOpen) {
      renderThreads();
      setTimeout(() => {
        dom.historySearchInput.focus();
      }, 0);
    }
  }

  function toggleHistoryOpen() {
    setHistoryOpen(!runtime.historyOpen);
  }

  function renderThreads() {
    dom.threadList.innerHTML = "";

    const keyword = runtime.historyKeyword.trim().toLowerCase();
    const filteredThreads = keyword
      ? state.threads.filter((thread) => getThreadSearchText(thread).includes(keyword))
      : state.threads;

    dom.historyBtn.disabled = state.threads.length === 0;
    if (state.threads.length === 0) {
      dom.historyBtn.textContent = "History";
    } else {
      dom.historyBtn.textContent = `History (${state.threads.length})`;
    }

    if (!filteredThreads.length) {
      const li = document.createElement("li");
      li.className = "thread-item";
      li.textContent = keyword ? "未找到匹配记录" : "暂无历史记录";
      dom.threadList.appendChild(li);
      return;
    }

    for (const thread of filteredThreads) {
      const li = document.createElement("li");
      li.className = `thread-item ${thread.id === state.activeThreadId ? "active" : ""}`;
      li.dataset.threadId = thread.id;

      const content = document.createElement("div");
      content.className = "thread-content";

      const title = document.createElement("div");
      title.className = "thread-title";
      title.textContent = thread.title || "新会话";
      content.appendChild(title);

      const threadTime = document.createElement("div");
      threadTime.className = "thread-time";
      const lastAt = thread.updatedAt || thread.createdAt;
      threadTime.textContent = formatThreadLastTime(lastAt);
      threadTime.title = formatDateTime(lastAt);
      content.appendChild(threadTime);

      li.appendChild(content);

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
        setHistoryOpen(false);
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
      renderComposerState();
      return;
    }

    dom.languageSelect.value = thread.language;

    if (!thread.messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "发送第一条消息开始对话。";
      dom.messages.appendChild(empty);
      renderComposerState();
      return;
    }

    for (const message of thread.messages) {
      const wrapper = document.createElement("div");
      wrapper.className = `message ${message.role} ${message.status}`;
      wrapper.dataset.messageId = message.id;

      const meta = document.createElement("div");
      meta.className = "meta";
      const roleText = message.role === "user" ? "You" : "Google AI";

      const metaLabel = document.createElement("span");
      metaLabel.textContent = `${roleText} · ${formatStatusTime(message.createdAt)}`;
      meta.appendChild(metaLabel);

      const metaActions = document.createElement("div");
      metaActions.className = "meta-actions";
      const copyMessageBtn = document.createElement("button");
      copyMessageBtn.type = "button";
      copyMessageBtn.className = "mini-btn copy-message-btn";
      copyMessageBtn.dataset.messageId = message.id;
      copyMessageBtn.dataset.label = "复制消息";
      copyMessageBtn.textContent = "复制消息";
      metaActions.appendChild(copyMessageBtn);
      meta.appendChild(metaActions);
      wrapper.appendChild(meta);

      const body = document.createElement("div");
      body.className = "message-body";
      if (message.role === "assistant") {
        body.innerHTML = renderMarkdown(message.content);
      } else {
        body.textContent = message.content;
      }
      wrapper.appendChild(body);
      dom.messages.appendChild(wrapper);
    }

    dom.messages.scrollTop = dom.messages.scrollHeight;
    renderComposerState();
  }

  function renderComposerState() {
    const thread = getActiveThread();
    const pending = isThreadPending(thread);
    const canSend = Boolean(thread) && !pending && !runtime.authRunning;
    const hasMessages = Boolean(thread && Array.isArray(thread.messages) && thread.messages.length > 0);

    dom.sendBtn.disabled = !canSend;
    dom.input.disabled = !thread || runtime.authRunning;
    dom.retryBtn.disabled = runtime.authRunning || !runtime.canRetry || !state.activeThreadId;
    if (dom.copyThreadBtn) {
      dom.copyThreadBtn.disabled = !hasMessages;
    }
    dom.sendBtn.textContent = pending ? "发送中..." : "Send";

    if (!thread) {
      dom.input.placeholder = "请先创建会话，再输入问题。";
      return;
    }
    if (runtime.authRunning) {
      dom.input.placeholder = "正在进行登录验证，完成后可继续提问。";
      return;
    }
    if (pending) {
      dom.input.placeholder = "正在等待当前请求完成...";
      return;
    }
    dom.input.placeholder = DEFAULT_INPUT_PLACEHOLDER;
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
    renderComposerState();
  }

  function findActiveMessageById(messageId) {
    if (!messageId) {
      return null;
    }
    const thread = getActiveThread();
    if (!thread || !Array.isArray(thread.messages)) {
      return null;
    }
    return thread.messages.find((message) => message.id === messageId) || null;
  }

  async function handleMessagesClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const link = target.closest("a[href]");
    if (link instanceof HTMLAnchorElement) {
      const href = sanitizeHttpUrl(link.href);
      if (!href) {
        return;
      }
      event.preventDefault();
      post({
        type: "link/open",
        href,
      });
      setStatus({
        kind: "progress",
        title: "正在打开来源链接",
        detail: href,
        suggestion: "若浏览器未弹出，可稍后重试或手动复制链接。",
        threadId: state.activeThreadId || undefined,
        at: Date.now(),
      });
      return;
    }

    const copyCodeBtn = target.closest(".copy-code-btn");
    if (copyCodeBtn instanceof HTMLButtonElement) {
      const codeBlock = copyCodeBtn.closest(".code-block");
      const codeElement = codeBlock ? codeBlock.querySelector("code") : null;
      const codeText = codeElement ? codeElement.textContent || "" : "";
      await copyWithFeedback(codeText, {
        button: copyCodeBtn,
        successTitle: "代码已复制",
        successDetail: "代码块内容已写入剪贴板。",
        successSuggestion: "可直接粘贴到编辑器或其他模型。",
        failureTitle: "代码复制失败",
        failureDetail: "无法访问剪贴板，请重试。",
        failureSuggestion: "你也可以手动选择代码后复制。",
        threadId: state.activeThreadId || undefined,
      });
      return;
    }

    const copyMessageBtn = target.closest(".copy-message-btn");
    if (copyMessageBtn instanceof HTMLButtonElement) {
      const messageId = copyMessageBtn.dataset.messageId || "";
      const message = findActiveMessageById(messageId);
      if (!message) {
        setStatus({
          kind: "warning",
          title: "消息不存在",
          detail: "当前消息可能已被删除或线程已切换。",
          suggestion: "请刷新线程后重试。",
          threadId: state.activeThreadId || undefined,
          at: Date.now(),
        });
        return;
      }

      const text = buildMessageMarkdown(message);
      await copyWithFeedback(text, {
        button: copyMessageBtn,
        successTitle: "消息已复制",
        successDetail: "当前消息已复制为可粘贴文本。",
        successSuggestion: "可直接发给其他模型继续处理。",
        failureTitle: "消息复制失败",
        failureDetail: "无法访问剪贴板，请重试。",
        failureSuggestion: "你也可以手动选中文本复制。",
        threadId: state.activeThreadId || undefined,
      });
    }
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
    setHistoryOpen(false);
    setStatus({
      kind: "progress",
      title: "消息已发送",
      detail: "请求已提交给扩展，正在启动搜索。",
      suggestion: "请稍候，结果返回后会自动更新。",
      threadId: thread.id,
      at: Date.now(),
    });

    dom.input.value = "";
    saveDraft();
    renderComposerState();
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
        pruneThreadStatus();
        renderThreads();
        renderMessages();
        renderAuthBanner();
        renderStatusBar();
        break;
      case "chat/status":
        setStatus(message.status);
        break;
      case "chat/pending":
        runtime.canRetry = false;
        renderAuthBanner();
        renderComposerState();
        break;
      case "chat/answer":
        runtime.canRetry = false;
        renderAuthBanner();
        renderComposerState();
        break;
      case "chat/error":
        runtime.canRetry = Boolean(message.canRetry);
        renderAuthBanner();
        renderComposerState();
        break;
      case "auth/running":
        runtime.authRunning = true;
        runtime.authMessage = "";
        runtime.canRetry = false;
        setStatus({
          kind: "progress",
          title: "等待登录验证",
          detail: "浏览器将打开登录页面，请完成验证流程。",
          suggestion: "完成后返回 VS Code 点击 Retry。",
          at: Date.now(),
        });
        renderAuthBanner();
        break;
      case "auth/completed":
        runtime.authRunning = false;
        runtime.authMessage = message.message || "";
        runtime.canRetry = true;
        setStatus({
          kind: message.success ? "success" : "warning",
          title: message.success ? "登录验证完成" : "登录验证未完成",
          detail: message.message || "",
          suggestion: message.success ? "点击 Retry 继续当前请求。" : "请再次执行 Run Setup。",
          at: Date.now(),
        });
        renderAuthBanner();
        break;
      default:
        break;
    }
  }

  function wireEvents() {
    dom.historyBtn.addEventListener("click", () => {
      toggleHistoryOpen();
    });

    dom.historyCloseBtn.addEventListener("click", () => {
      setHistoryOpen(false);
    });

    dom.historyBackdrop.addEventListener("click", () => {
      setHistoryOpen(false);
    });

    dom.historySearchInput.addEventListener("input", () => {
      runtime.historyKeyword = dom.historySearchInput.value || "";
      renderThreads();
    });

    dom.historySearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHistoryOpen(false);
      }
    });

    if (dom.copyThreadBtn) {
      dom.copyThreadBtn.dataset.label = "Copy Thread";
      dom.copyThreadBtn.addEventListener("click", async () => {
        const thread = getActiveThread();
        if (!thread || !thread.messages.length) {
          setStatus({
            kind: "warning",
            title: "没有可复制的内容",
            detail: "当前线程为空，无法复制。",
            suggestion: "先发送一条消息，再使用 Copy Thread。",
            at: Date.now(),
          });
          return;
        }

        const markdown = buildThreadMarkdown(thread);
        await copyWithFeedback(markdown, {
          button: dom.copyThreadBtn,
          successTitle: "对话已复制",
          successDetail: "当前线程已按 Markdown 格式复制。",
          successSuggestion: "可直接粘贴给其他模型继续分析。",
          failureTitle: "对话复制失败",
          failureDetail: "无法访问剪贴板，请重试。",
          failureSuggestion: "你也可以逐条点击“复制消息”。",
          threadId: thread.id,
        });
      });
    }

    dom.newThreadBtn.addEventListener("click", () => {
      post({
        type: "thread/create",
        language: dom.languageSelect.value,
      });
      runtime.historyKeyword = "";
      dom.historySearchInput.value = "";
      setHistoryOpen(false);
    });

    dom.clearHistoryBtn.addEventListener("click", () => {
      const ok = window.confirm("确定清空所有聊天线程吗？");
      if (!ok) {
        return;
      }
      post({ type: "thread/clearAll" });
      runtime.authMessage = "";
      runtime.canRetry = false;
      runtime.threadStatus = {};
      runtime.globalStatus = {
        kind: "idle",
        title: "历史已清空",
        detail: "所有线程和会话记录已移除。",
        suggestion: "点击 New Chat 开始新的提问。",
        at: Date.now(),
      };
      runtime.historyKeyword = "";
      dom.historySearchInput.value = "";
      setHistoryOpen(false);
      renderAuthBanner();
      renderStatusBar();
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

    dom.messages.addEventListener("click", (event) => {
      void handleMessagesClick(event);
    });

    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !runtime.historyOpen) {
        return;
      }
      setHistoryOpen(false);
    });
  }

  window.addEventListener("message", (event) => {
    handleHostMessage(event.data);
  });

  restoreDraft();
  wireEvents();
  renderStatusBar();
  renderComposerState();
  post({ type: "panel/ready" });
})();
