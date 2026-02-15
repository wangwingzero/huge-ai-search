(function () {
  const vscode = acquireVsCodeApi();
  const DEFAULT_INPUT_PLACEHOLDER = "输入问题，Enter 发送，Shift+Enter 换行";
  const MAX_ATTACHMENTS = 12;
  const MERGED_IMAGE_MAX_WIDTH = 1800;
  const MERGED_IMAGE_MAX_TOTAL_HEIGHT = 9000;
  const MERGED_IMAGE_PADDING = 12;
  const REQUEST_STATUS_TICK_MS = 500;
  const WAIT_STAGE_QUICK_MS = 1000;
  const WAIT_STAGE_RUNNING_MS = 3000;
  const WAIT_STAGE_PROCESSING_MS = 8000;
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
    preparingImage: false,
    authMessage: "",
    canRetry: false,
    historyOpen: false,
    historyKeyword: "",
    statusExpanded: false,
    globalStatus: {
      kind: "idle",
      title: "系统就绪",
      detail: "等待你的提问。",
      suggestion: "输入问题后按 Enter 发送。",
      at: Date.now(),
    },
    threadStatus: {},
    attachments: [],
  };

  const dom = {
    newThreadBtn: document.getElementById("newThreadBtn"),
    openBrowserBtn: document.getElementById("openBrowserBtn"),
    historyBtn: document.getElementById("historyBtn"),
    historyPanel: document.getElementById("historyPanel"),
    historyBackdrop: document.getElementById("historyBackdrop"),
    historyCloseBtn: document.getElementById("historyCloseBtn"),
    historySearchInput: document.getElementById("historySearchInput"),
    copyThreadBtn: document.getElementById("copyThreadBtn"),
    exportThreadBtn: document.getElementById("exportThreadBtn"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    statusToggleBtn: document.getElementById("statusToggleBtn"),
    runSetupBtn: document.getElementById("runSetupBtn"),
    retryBtn: document.getElementById("retryBtn"),
    threadList: document.getElementById("threadList"),
    messages: document.getElementById("messages"),
    input: document.getElementById("input"),
    sendBtn: document.getElementById("sendBtn"),
    authBanner: document.getElementById("authBanner"),
    authText: document.getElementById("authText"),
    statusBar: document.getElementById("statusBar"),
    statusDot: document.getElementById("statusDot"),
    statusTitle: document.getElementById("statusTitle"),
    statusTime: document.getElementById("statusTime"),
    statusDetail: document.getElementById("statusDetail"),
    statusSuggestion: document.getElementById("statusSuggestion"),
    attachmentBar: document.getElementById("attachmentBar"),
    attachmentSummary: document.getElementById("attachmentSummary"),
    attachmentList: document.getElementById("attachmentList"),
    clearAttachmentsBtn: document.getElementById("clearAttachmentsBtn"),
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

  function getStatusIndicatorKind(status) {
    if (!status) {
      return "success";
    }
    if (status.kind === "success" || status.kind === "idle") {
      return "success";
    }
    if (status.kind === "warning" || status.kind === "error") {
      return "error";
    }
    if (status.kind === "progress") {
      return "progress";
    }
    return "idle";
  }

  function setStatusExpanded(nextValue) {
    runtime.statusExpanded = Boolean(nextValue);
    if (dom.statusToggleBtn) {
      dom.statusToggleBtn.setAttribute("aria-pressed", runtime.statusExpanded ? "true" : "false");
    }
    saveDraft();
    renderStatusBar();
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

  function formatElapsedTime(ms) {
    const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (safeMs < 10000) {
      return `${(safeMs / 1000).toFixed(1)}s`;
    }
    const totalSeconds = Math.round(safeMs / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${pad2(seconds)}s`;
  }

  function getThreadPendingSince(thread) {
    if (!thread || !Array.isArray(thread.messages)) {
      return null;
    }
    let pendingSince = null;
    for (const message of thread.messages) {
      if (!message || message.role !== "assistant" || message.status !== "pending") {
        continue;
      }
      const createdAt = Number(message.createdAt);
      if (!Number.isFinite(createdAt) || createdAt <= 0) {
        continue;
      }
      if (pendingSince === null || createdAt < pendingSince) {
        pendingSince = createdAt;
      }
    }
    return pendingSince;
  }

  function buildPendingStatusOverlay(status, thread) {
    if (!status || status.kind !== "progress" || runtime.authRunning || runtime.preparingImage) {
      return null;
    }
    if (!isThreadPending(thread)) {
      return null;
    }

    const pendingSince = getThreadPendingSince(thread);
    const fallbackSince = Number(status.at);
    const startAt =
      typeof pendingSince === "number" && Number.isFinite(pendingSince)
        ? pendingSince
        : Number.isFinite(fallbackSince)
          ? fallbackSince
          : Date.now();
    const elapsedMs = Math.max(0, Date.now() - startAt);
    const elapsedLabel = formatElapsedTime(elapsedMs);
    const timeText = `已等待 ${elapsedLabel}`;

    if (elapsedMs < WAIT_STAGE_QUICK_MS) {
      return {
        kind: "progress",
        title: "请求已发送",
        detail: `请求已发送，正在调用搜索服务（${timeText}）。`,
        suggestion: "连接正常，通常几秒内会返回。",
        timeText,
      };
    }

    if (elapsedMs < WAIT_STAGE_RUNNING_MS) {
      return {
        kind: "progress",
        title: "搜索进行中",
        detail: `正在等待 AI 生成回答（${timeText}）。`,
        suggestion: "流程正常，请稍候。",
        timeText,
      };
    }

    if (elapsedMs < WAIT_STAGE_PROCESSING_MS) {
      return {
        kind: "progress",
        title: "正在整理结果",
        detail: `已拿到部分内容，正在整理来源与格式（${timeText}）。`,
        suggestion: "来源链接可能稍后出现，属于正常现象。",
        timeText,
      };
    }

    return {
      kind: "progress",
      title: "响应较慢但流程正常",
      detail: `当前网络或页面响应较慢，请求仍在执行（${timeText}）。`,
      suggestion: "",
      timeText,
    };
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

  function createAttachmentId() {
    return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("加载图片失败"));
      image.src = dataUrl;
    });
  }

  function clearAttachments() {
    runtime.attachments = [];
    renderAttachments();
  }

  function removeAttachment(attachmentId) {
    runtime.attachments = runtime.attachments.filter((item) => item.id !== attachmentId);
    renderAttachments();
  }

  function renderAttachments() {
    const list = Array.isArray(runtime.attachments) ? runtime.attachments : [];
    const hasAny = list.length > 0;
    dom.attachmentBar.classList.toggle("hidden", !hasAny);

    if (!hasAny) {
      dom.attachmentSummary.textContent = "";
      dom.attachmentList.innerHTML = "";
      renderComposerState();
      return;
    }

    dom.attachmentSummary.textContent =
      list.length > 1
        ? `已粘贴 ${list.length} 张截图（发送时会自动合并）`
        : "已粘贴 1 张截图";
    dom.attachmentList.innerHTML = "";

    for (const attachment of list) {
      const item = document.createElement("div");
      item.className = "attachment-item";
      item.dataset.attachmentId = attachment.id;

      const image = document.createElement("img");
      image.src = attachment.dataUrl;
      image.alt = "attachment";
      item.appendChild(image);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "attachment-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "移除图片";
      removeBtn.dataset.attachmentId = attachment.id;
      item.appendChild(removeBtn);

      dom.attachmentList.appendChild(item);
    }

    renderComposerState();
  }

  async function addAttachmentsFromFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file && String(file.type || "").startsWith("image/"));
    if (!files.length) {
      return 0;
    }

    const remain = MAX_ATTACHMENTS - runtime.attachments.length;
    if (remain <= 0) {
      setStatus({
        kind: "warning",
        title: "图片数量已达上限",
        detail: `最多可粘贴 ${MAX_ATTACHMENTS} 张图片。`,
        suggestion: "请先移除部分截图后再粘贴。",
        threadId: state.activeThreadId || undefined,
        at: Date.now(),
      });
      return 0;
    }

    const acceptedFiles = files.slice(0, remain);
    let added = 0;
    for (const file of acceptedFiles) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const image = await loadImageFromDataUrl(dataUrl);
        runtime.attachments.push({
          id: createAttachmentId(),
          dataUrl,
          width: image.naturalWidth || 0,
          height: image.naturalHeight || 0,
          name: file.name || "pasted-image.png",
        });
        added += 1;
      } catch {
        continue;
      }
    }

    renderAttachments();
    return added;
  }

  async function buildMergedAttachmentDataUrl() {
    const attachments = Array.isArray(runtime.attachments) ? runtime.attachments : [];
    if (!attachments.length) {
      return undefined;
    }
    if (attachments.length === 1) {
      return attachments[0].dataUrl;
    }

    const decodedImages = [];
    for (const attachment of attachments) {
      const image = await loadImageFromDataUrl(attachment.dataUrl);
      decodedImages.push(image);
    }
    if (!decodedImages.length) {
      return undefined;
    }

    const baseWidth = Math.max(...decodedImages.map((image) => image.naturalWidth || 1));
    const targetWidth = Math.min(MERGED_IMAGE_MAX_WIDTH, Math.max(1, baseWidth));

    const scaledHeights = decodedImages.map((image) => {
      const width = image.naturalWidth || targetWidth;
      const height = image.naturalHeight || 1;
      return Math.max(1, Math.round((height * targetWidth) / width));
    });

    const gapTotal = MERGED_IMAGE_PADDING * (decodedImages.length - 1);
    let totalHeight = scaledHeights.reduce((sum, value) => sum + value, 0) + gapTotal;
    let globalScale = 1;
    if (totalHeight > MERGED_IMAGE_MAX_TOTAL_HEIGHT) {
      globalScale = MERGED_IMAGE_MAX_TOTAL_HEIGHT / totalHeight;
      totalHeight = MERGED_IMAGE_MAX_TOTAL_HEIGHT;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(targetWidth * globalScale));
    canvas.height = Math.max(1, Math.round(totalHeight));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let offsetY = 0;
    for (let i = 0; i < decodedImages.length; i += 1) {
      const image = decodedImages[i];
      const drawWidth = canvas.width;
      const drawHeight = Math.max(1, Math.round(scaledHeights[i] * globalScale));
      ctx.drawImage(image, 0, offsetY, drawWidth, drawHeight);
      offsetY += drawHeight;
      if (i < decodedImages.length - 1) {
        ctx.fillStyle = "#e5e7eb";
        ctx.fillRect(0, offsetY, drawWidth, Math.max(1, Math.round(MERGED_IMAGE_PADDING * globalScale)));
        offsetY += Math.max(1, Math.round(MERGED_IMAGE_PADDING * globalScale));
      }
    }

    return canvas.toDataURL("image/png");
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
      return "";
    });
  }

  function buildMessageMarkdown(message) {
    if (!message) {
      return "";
    }
    if (message.role === "assistant") {
      return normalizeBrokenMathTokenLines(
        normalizeAssistantMarkdownForExport(message.content || "")
      ).trim();
    }
    return (message.content || "").trim();
  }

  function buildThreadMarkdown(thread) {
    if (!thread) {
      return "";
    }
    const lines = [];
    const title = (thread.title || "").trim();
    if (title) {
      lines.push(`# ${title}`);
      lines.push("");
    }

    thread.messages.forEach((message) => {
      const roleTitle = message.role === "user" ? "User" : "Assistant";
      lines.push(`## ${roleTitle}`);
      lines.push("");
      lines.push(buildMessageMarkdown(message) || "_(空内容)_");
      lines.push("");
    });

    return lines.join("\n").trim();
  }

  function buildExportTitle(thread) {
    const raw = String(thread?.title || "huge-ai-chat").trim();
    return raw || "huge-ai-chat";
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
    const isIconButton = button.classList.contains("icon-btn");
    const origin = button.dataset.label || button.dataset.tooltip || button.title || button.textContent || "";
    if (!button.dataset.label) {
      button.dataset.label = origin;
    }
    if (isIconButton) {
      button.dataset.tooltip = nextLabel;
      button.title = nextLabel;
    } else {
      button.textContent = nextLabel;
    }
    button.disabled = true;
    setTimeout(() => {
      if (isIconButton) {
        const label = button.dataset.label || origin;
        button.dataset.tooltip = label;
        button.title = label;
      } else {
        button.textContent = button.dataset.label || origin;
      }
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
    const activeThread = getActiveThread();
    const pendingOverlay = buildPendingStatusOverlay(status, activeThread);
    const renderStatus = pendingOverlay ? { ...status, ...pendingOverlay } : status;
    const shouldShowExpanded = runtime.statusExpanded || Boolean(pendingOverlay);
    const indicatorKind = getStatusIndicatorKind(renderStatus);

    dom.statusBar.className = `status-bar status-${renderStatus.kind}${shouldShowExpanded ? "" : " hidden"}`;
    dom.statusTitle.textContent = renderStatus.title;
    dom.statusTime.textContent = pendingOverlay?.timeText || formatStatusTime(renderStatus.at);

    if (dom.statusToggleBtn) {
      dom.statusToggleBtn.className = `btn icon-btn status-toggle status-${indicatorKind}`;
      dom.statusToggleBtn.setAttribute("aria-pressed", shouldShowExpanded ? "true" : "false");
      dom.statusToggleBtn.setAttribute("aria-label", `状态：${renderStatus.title}`);
      const toggleHint = shouldShowExpanded ? "点击收起状态详情" : "点击展开状态详情";
      const tooltip = `${renderStatus.title} (${toggleHint})`;
      dom.statusToggleBtn.dataset.tooltip = tooltip;
      dom.statusToggleBtn.title = tooltip;
    }

    if (renderStatus.detail) {
      dom.statusDetail.textContent = renderStatus.detail;
      dom.statusDetail.style.display = "block";
    } else {
      dom.statusDetail.textContent = "";
      dom.statusDetail.style.display = "none";
    }

    if (renderStatus.suggestion) {
      dom.statusSuggestion.textContent = renderStatus.suggestion;
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

      if (codeLikeCount < 1) {
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

  function isMathTokenLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      return false;
    }
    if (/^[(){}\[\]=+\-−*/%^]$/.test(trimmed)) {
      return true;
    }
    if (/^[+\-−]?\d+(?:\.\d+)?$/.test(trimmed)) {
      return true;
    }
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
      return true;
    }
    return false;
  }

  function isSingleMathOperator(token) {
    return /^[(){}\[\]=+\-−*/%^]$/.test(token);
  }

  function normalizeBrokenMathTokenLines(raw) {
    if (!raw) {
      return raw;
    }

    const lines = raw.split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      if (!isMathTokenLine(lines[i])) {
        out.push(lines[i]);
        i += 1;
        continue;
      }

      let j = i;
      const tokens = [];
      while (j < lines.length && isMathTokenLine(lines[j])) {
        tokens.push(lines[j].trim());
        j += 1;
      }

      const totalEquals = tokens.filter((token) => token === "=").length;
      if (tokens.length < 4 || totalEquals === 0) {
        out.push(...lines.slice(i, j));
        i = j;
        continue;
      }

      const chunks = [];
      let chunk = [];
      for (const token of tokens) {
        const hasEquals = chunk.includes("=");
        const previous = chunk.length > 0 ? chunk[chunk.length - 1] : "";
        if (
          token === "(" &&
          hasEquals &&
          chunk.length >= 4 &&
          /[0-9A-Za-z)\]]$/.test(previous)
        ) {
          chunks.push(chunk);
          chunk = [token];
          continue;
        }
        chunk.push(token);
      }
      if (chunk.length) {
        chunks.push(chunk);
      }

      for (const part of chunks) {
        const equalsCount = part.filter((token) => token === "=").length;
        const hasSingleOperatorLine = part.some((token) => isSingleMathOperator(token));
        if (part.length >= 4 && equalsCount === 1 && hasSingleOperatorLine) {
          out.push(part.join(""));
        } else {
          out.push(...part);
        }
      }

      i = j;
    }

    return out.join("\n");
  }

  function renderMarkdown(raw) {
    if (!raw) {
      return "";
    }

    let text = normalizeBrokenMathTokenLines(autoFenceLooseCodeBlocks(raw));
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
      /\[((?:\\.|[^\]])+)\]\((?:<([^>]+)>|(https?:\/\/[^\s)]+))\)/g,
      (_, rawLabel, angleWrappedUrl, plainUrl) => {
        const url = angleWrappedUrl || plainUrl || "";
        const safeUrl = sanitizeHttpUrl(url);
        const label = String(rawLabel || "").replace(/\\([\[\]\\])/g, "$1");
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
        `    <button type="button" class="mini-btn icon-btn copy-code-btn" data-label="复制代码" data-tooltip="复制代码" title="复制代码" aria-label="复制代码">`,
        `      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">`,
        `        <path d="M5.75 1h6.5A1.75 1.75 0 0 1 14 2.75v6.5A1.75 1.75 0 0 1 12.25 11h-6.5A1.75 1.75 0 0 1 4 9.25v-6.5A1.75 1.75 0 0 1 5.75 1Zm0 1a.75.75 0 0 0-.75.75v6.5c0 .414.336.75.75.75h6.5a.75.75 0 0 0 .75-.75v-6.5a.75.75 0 0 0-.75-.75h-6.5Z"></path>`,
        `        <path d="M2.75 5A1.75 1.75 0 0 0 1 6.75v6.5C1 14.216 1.784 15 2.75 15h6.5A1.75 1.75 0 0 0 11 13.25V13h-1v.25a.75.75 0 0 1-.75.75h-6.5a.75.75 0 0 1-.75-.75v-6.5a.75.75 0 0 1 .75-.75H3V5h-.25Z"></path>`,
        `      </svg>`,
        `    </button>`,
        `  </div>`,
        `  <pre><code>${escapeHtml(block.code)}</code></pre>`,
        `</div>`,
      ].join("");
    });

    text = text.replace(/__DEBUG_BLOCK_(\d+)__/g, () => {
      // 用户要求：调试信息不在 UI 展示。
      return "";
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
    const historyTooltip = "历史记录";
    dom.historyBtn.dataset.tooltip = historyTooltip;
    dom.historyBtn.title = historyTooltip;
    dom.historyBtn.removeAttribute("data-count");

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
        clearAttachments();
        setHistoryOpen(false);
      });

      dom.threadList.appendChild(li);
    }
  }

  function renderMessages(forceScrollToBottom) {
    const thread = getActiveThread();

    // Capture scroll state before clearing DOM
    var savedScrollTop = dom.messages.scrollTop;
    var nearBottom = dom.messages.scrollHeight - dom.messages.scrollTop - dom.messages.clientHeight < 80;

    dom.messages.innerHTML = "";

    if (!thread) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "请先创建会话。";
      dom.messages.appendChild(empty);
      renderComposerState();
      return;
    }

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
      const roleText = message.role === "user" ? "You" : "HUGE AI";

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

    // Only scroll to bottom if: forced (thread switch / initial load), or user was already near bottom
    if (forceScrollToBottom || nearBottom) {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    } else {
      dom.messages.scrollTop = savedScrollTop;
    }
    renderComposerState();
  }

  function renderComposerState() {
    const thread = getActiveThread();
    const pending = isThreadPending(thread) || runtime.preparingImage;
    const hasInputText = Boolean((dom.input.value || "").trim());
    const hasAttachments = Array.isArray(runtime.attachments) && runtime.attachments.length > 0;
    const hasPayload = hasInputText || hasAttachments;
    const canSend = Boolean(thread) && !pending && !runtime.authRunning && hasPayload;
    const hasMessages = Boolean(thread && Array.isArray(thread.messages) && thread.messages.length > 0);

    dom.sendBtn.disabled = !canSend;
    dom.input.disabled = !thread || runtime.authRunning;
    dom.retryBtn.disabled = runtime.authRunning || !runtime.canRetry || !state.activeThreadId;
    if (dom.clearAttachmentsBtn) {
      dom.clearAttachmentsBtn.disabled = !hasAttachments || pending || runtime.authRunning;
    }
    if (dom.copyThreadBtn) {
      dom.copyThreadBtn.disabled = !hasMessages;
    }
    if (dom.exportThreadBtn) {
      dom.exportThreadBtn.disabled = !hasMessages;
    }
    const pendingSince = getThreadPendingSince(thread);
    if (pending && pendingSince) {
      dom.sendBtn.textContent = `发送中... ${formatElapsedTime(Date.now() - pendingSince)}`;
    } else {
      dom.sendBtn.textContent = pending ? "发送中..." : "Send";
    }

    if (!thread) {
      dom.input.placeholder = "请先创建会话，再输入问题。";
      return;
    }
    if (runtime.authRunning) {
      dom.input.placeholder = "正在进行登录验证，完成后可继续提问。";
      return;
    }
    if (runtime.preparingImage) {
      dom.input.placeholder = "正在处理截图，请稍候...";
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
      statusExpanded: runtime.statusExpanded,
    });
  }

  function restoreDraft() {
    const oldState = vscode.getState() || {};
    if (typeof oldState.draft === "string") {
      dom.input.value = oldState.draft;
    }
    if (typeof oldState.statusExpanded === "boolean") {
      runtime.statusExpanded = oldState.statusExpanded;
    }
  }

  async function sendCurrentMessage() {
    const thread = getActiveThread();
    if (!thread) {
      return;
    }

    const text = dom.input.value.trim();
    const imageCount = Array.isArray(runtime.attachments) ? runtime.attachments.length : 0;
    if (!text && imageCount <= 0) {
      return;
    }

    let mergedImageDataUrl;
    if (imageCount > 0) {
      runtime.preparingImage = true;
      renderComposerState();
      try {
        mergedImageDataUrl = await buildMergedAttachmentDataUrl();
      } catch {
        mergedImageDataUrl = undefined;
      } finally {
        runtime.preparingImage = false;
        renderComposerState();
      }

      if (!mergedImageDataUrl) {
        setStatus({
          kind: "error",
          title: "图片处理失败",
          detail: "无法合并截图，请重新粘贴后重试。",
          suggestion: "可先清除图片后再粘贴，或减少截图数量。",
          threadId: thread.id,
          at: Date.now(),
        });
        return;
      }
    }

    post({
      type: "chat/send",
      threadId: thread.id,
      text,
      language: thread.language,
      imageDataUrl: mergedImageDataUrl,
      imageCount: imageCount > 0 ? imageCount : undefined,
    });
    setHistoryOpen(false);
    setStatus({
      kind: "progress",
      title: "消息已发送",
      detail:
        imageCount > 0
          ? `请求已提交给扩展，正在上传 ${imageCount} 张截图${imageCount > 1 ? "（已合并）" : ""}。`
          : "请求已提交给扩展，正在启动搜索。",
      suggestion: "请稍候，结果返回后会自动更新。",
      threadId: thread.id,
      at: Date.now(),
    });

    dom.input.value = "";
    clearAttachments();
    saveDraft();
    renderComposerState();
  }

  function handleHostMessage(message) {
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return;
    }

    switch (message.type) {
      case "state/full":
      case "state/updated": {
        const previousActiveThreadId = state.activeThreadId;
        state.version = message.state.version;
        state.activeThreadId = message.state.activeThreadId;
        state.threads = Array.isArray(message.state.threads) ? message.state.threads : [];
        if (
          previousActiveThreadId &&
          previousActiveThreadId !== state.activeThreadId &&
          runtime.attachments.length > 0
        ) {
          clearAttachments();
        }
        pruneThreadStatus();
        renderThreads();
        var threadChanged = message.type === "state/full" || previousActiveThreadId !== state.activeThreadId;
        renderMessages(threadChanged);
        renderAuthBanner();
        renderStatusBar();
        break;
      }
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
    if (dom.openBrowserBtn) {
      dom.openBrowserBtn.addEventListener("click", () => {
        post({ type: "browser/open" });
        setStatus({
          kind: "progress",
          title: "正在打开浏览器",
          detail: "将启动与验证码流程相同的 Playwright 浏览器窗口。",
          suggestion: "你可以在浏览器中直接对话，登录状态会自动持久化。",
          at: Date.now(),
        });
      });
    }

    if (dom.statusToggleBtn) {
      dom.statusToggleBtn.addEventListener("click", () => {
        setStatusExpanded(!runtime.statusExpanded);
      });
    }

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
      dom.copyThreadBtn.dataset.label = "复制会话";
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

    if (dom.exportThreadBtn) {
      dom.exportThreadBtn.addEventListener("click", () => {
        const thread = getActiveThread();
        if (!thread || !thread.messages.length) {
          setStatus({
            kind: "warning",
            title: "没有可导出的内容",
            detail: "当前线程为空，无法导出 Markdown。",
            suggestion: "先发送一条消息，再点击导出。",
            at: Date.now(),
          });
          return;
        }

        const markdown = buildThreadMarkdown(thread);
        post({
          type: "thread/exportMarkdown",
          threadId: thread.id,
          title: buildExportTitle(thread),
          markdown,
        });
        setStatus({
          kind: "progress",
          title: "正在导出 Markdown",
          detail: "文件写入完成后会自动在编辑器中打开。",
          suggestion: "可直接在打开的文档中继续编辑。",
          threadId: thread.id,
          at: Date.now(),
        });
      });
    }

    dom.newThreadBtn.addEventListener("click", () => {
      post({ type: "thread/create" });
      clearAttachments();
      runtime.historyKeyword = "";
      dom.historySearchInput.value = "";
      setHistoryOpen(false);
    });

    dom.clearHistoryBtn.addEventListener("click", () => {
      post({ type: "thread/clearAll" });
      clearAttachments();
      setStatus({
        kind: "progress",
        title: "正在清空历史",
        detail: "已请求扩展清空所有聊天线程。",
        suggestion: "完成后会自动刷新为空会话。",
        at: Date.now(),
      });
      setHistoryOpen(false);
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
      void sendCurrentMessage();
    });

    dom.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendCurrentMessage();
      }
    });

    dom.input.addEventListener("input", () => {
      saveDraft();
      renderComposerState();
    });

    dom.input.addEventListener("paste", (event) => {
      const clipboardItems = event.clipboardData ? Array.from(event.clipboardData.items || []) : [];
      const imageFiles = clipboardItems
        .filter((item) => item && item.kind === "file" && String(item.type || "").startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file) => Boolean(file));
      if (!imageFiles.length) {
        return;
      }

      event.preventDefault();
      void addAttachmentsFromFiles(imageFiles).then((added) => {
        if (!added) {
          return;
        }
        setStatus({
          kind: "success",
          title: "截图已粘贴",
          detail:
            added > 1
              ? `本次新增 ${added} 张截图，发送时会自动合并成单图。`
              : "已添加 1 张截图。",
          suggestion: "可继续输入问题后发送，或再粘贴更多截图。",
          threadId: state.activeThreadId || undefined,
          at: Date.now(),
        });
      });
    });

    if (dom.clearAttachmentsBtn) {
      dom.clearAttachmentsBtn.addEventListener("click", () => {
        clearAttachments();
        setStatus({
          kind: "idle",
          title: "已清除截图",
          detail: "附件区已清空。",
          suggestion: "你可以重新 Ctrl+V 粘贴截图。",
          threadId: state.activeThreadId || undefined,
          at: Date.now(),
        });
      });
    }

    if (dom.attachmentList) {
      dom.attachmentList.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const removeBtn = target.closest(".attachment-remove");
        if (!(removeBtn instanceof HTMLButtonElement)) {
          return;
        }
        const attachmentId = removeBtn.dataset.attachmentId || "";
        if (!attachmentId) {
          return;
        }
        removeAttachment(attachmentId);
      });
    }

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
  setInterval(() => {
    const activeThread = getActiveThread();
    if (!activeThread) {
      return;
    }
    if (!isThreadPending(activeThread) || runtime.authRunning) {
      return;
    }
    renderStatusBar();
    renderComposerState();
  }, REQUEST_STATUS_TICK_MS);
  renderStatusBar();
  renderAttachments();
  renderComposerState();
  post({ type: "panel/ready" });
})();
