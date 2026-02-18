(function () {
  const vscode = acquireVsCodeApi();
  const DEFAULT_INPUT_PLACEHOLDER = "输入问题，Enter 发送，Shift+Enter 换行（输入 / 查看命令）";
  const SLASH_COMMANDS = [
    { cmd: "/draw", alias: [], desc: "Google 画图 — 使用 Google AI 生成图片", placeholder: "输入图片描述，例如：一只可爱的小狗在草地上奔跑" },
    { cmd: "/fastdraw", alias: [], desc: "Grok 极速画图 — 直接调用 Grok 生成图片", placeholder: "输入图片描述，Grok 将快速生成..." },
  ];
  const MAX_ATTACHMENTS = 12;
  const ATTACHMENT_THUMB_MAX_EDGE = 320;
  const ATTACHMENT_THUMB_QUALITY = 0.82;
  const ATTACHMENT_PERSIST_ORIGINAL_MAX_BYTES = 3 * 1024 * 1024;
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
    previewImageUrl: "",
    threadStatus: {},
    attachments: [],
    slashMenuVisible: false,
    slashMenuItems: [],
    slashMenuActiveIndex: 0,
    slashActiveCommand: null,
    pendingScrollRaf: 0,
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
    attachImageBtn: document.getElementById("attachImageBtn"),
    drawImageBtn: document.getElementById("drawImageBtn"),
    fastDrawBtn: document.getElementById("fastDrawBtn"),
    slashCmdBtn: document.getElementById("slashCmdBtn"),
    authBanner: document.getElementById("authBanner"),
    authText: document.getElementById("authText"),
    statusBar: document.getElementById("statusBar"),
    statusDot: document.getElementById("statusDot"),
    statusTitle: document.getElementById("statusTitle"),
    statusTime: document.getElementById("statusTime"),
    statusDetail: document.getElementById("statusDetail"),
    statusSuggestion: document.getElementById("statusSuggestion"),
    imagePreview: document.getElementById("imagePreview"),
    imagePreviewBackdrop: document.getElementById("imagePreviewBackdrop"),
    imagePreviewImg: document.getElementById("imagePreviewImg"),
    imagePreviewCloseBtn: document.getElementById("imagePreviewCloseBtn"),
    imageDownloadBtn: document.getElementById("imageDownloadBtn"),
    attachmentBar: document.getElementById("attachmentBar"),
    attachmentSummary: document.getElementById("attachmentSummary"),
    attachmentList: document.getElementById("attachmentList"),
    clearAttachmentsBtn: document.getElementById("clearAttachmentsBtn"),
    slashMenu: document.getElementById("slashMenu"),
    followUpBar: document.getElementById("followUpBar"),
    followUpText: document.getElementById("followUpText"),
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

  function applyFullState(nextState) {
    const candidate = nextState && typeof nextState === "object" ? nextState : null;
    state.version = candidate && typeof candidate.version === "number" ? candidate.version : 1;
    state.activeThreadId =
      candidate &&
      (typeof candidate.activeThreadId === "string" || candidate.activeThreadId === null)
        ? candidate.activeThreadId
        : null;
    state.threads = candidate && Array.isArray(candidate.threads) ? candidate.threads : [];
  }

  function applyStatePatch(rawPatch) {
    if (!rawPatch || typeof rawPatch !== "object") {
      return;
    }
    const patch = rawPatch;

    if (patch.reset) {
      state.threads = [];
    }

    const removeIds = Array.isArray(patch.removeThreadIds)
      ? patch.removeThreadIds.filter((id) => typeof id === "string" && id.length > 0)
      : [];
    if (removeIds.length > 0) {
      const removeSet = new Set(removeIds);
      state.threads = state.threads.filter((thread) => !removeSet.has(thread.id));
    }

    const upsertMap = new Map();
    if (Array.isArray(patch.upsertThreads)) {
      for (const thread of patch.upsertThreads) {
        if (!thread || typeof thread !== "object" || typeof thread.id !== "string") {
          continue;
        }
        upsertMap.set(thread.id, thread);
      }
    }

    if (upsertMap.size > 0) {
      const merged = [];
      for (const thread of state.threads) {
        const replacement = upsertMap.get(thread.id);
        if (replacement) {
          merged.push(replacement);
          upsertMap.delete(thread.id);
          continue;
        }
        merged.push(thread);
      }
      for (const thread of upsertMap.values()) {
        merged.push(thread);
      }
      state.threads = merged;
    }

    if (Array.isArray(patch.threadOrder) && patch.threadOrder.length > 0) {
      const byId = new Map(state.threads.map((thread) => [thread.id, thread]));
      const ordered = [];
      for (const threadId of patch.threadOrder) {
        if (typeof threadId !== "string" || !byId.has(threadId)) {
          continue;
        }
        const orderedThread = byId.get(threadId);
        if (!orderedThread) {
          continue;
        }
        ordered.push(orderedThread);
        byId.delete(threadId);
      }
      for (const thread of byId.values()) {
        ordered.push(thread);
      }
      state.threads = ordered;
    }

    if (typeof patch.version === "number") {
      state.version = patch.version;
    }
    if (typeof patch.activeThreadId === "string" || patch.activeThreadId === null) {
      state.activeThreadId = patch.activeThreadId;
    }
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

  function estimateDataUrlBytes(dataUrl) {
    const value = String(dataUrl || "");
    const commaIndex = value.indexOf(",");
    if (commaIndex < 0) {
      return 0;
    }
    const base64 = value.slice(commaIndex + 1);
    if (!base64) {
      return 0;
    }
    const padding = (base64.match(/=+$/) || [""])[0].length;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  }

  async function buildThumbnailDataUrl(dataUrl) {
    const image = await loadImageFromDataUrl(dataUrl);
    const naturalWidth = image.naturalWidth || 1;
    const naturalHeight = image.naturalHeight || 1;
    const longEdge = Math.max(naturalWidth, naturalHeight);
    const scale = longEdge > ATTACHMENT_THUMB_MAX_EDGE
      ? ATTACHMENT_THUMB_MAX_EDGE / longEdge
      : 1;

    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法创建缩略图");
    }
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    let thumbDataUrl = canvas.toDataURL("image/webp", ATTACHMENT_THUMB_QUALITY);
    if (!thumbDataUrl.startsWith("data:image/")) {
      thumbDataUrl = canvas.toDataURL("image/jpeg", ATTACHMENT_THUMB_QUALITY);
    }

    return {
      thumbDataUrl,
      width: naturalWidth,
      height: naturalHeight,
    };
  }

  function normalizeAttachmentPayload() {
    const list = Array.isArray(runtime.attachments) ? runtime.attachments : [];
    if (!list.length) {
      return undefined;
    }
    const payload = list
      .slice(0, MAX_ATTACHMENTS)
      .map((attachment) => {
        const thumbDataUrl = sanitizeImageUrl(attachment.thumbDataUrl || attachment.dataUrl);
        const originalDataUrl = sanitizeImageUrl(attachment.originalDataUrl || "");
        if (!thumbDataUrl) {
          return null;
        }
        return {
          id: String(attachment.id || createAttachmentId()),
          thumbDataUrl,
          originalDataUrl: originalDataUrl || undefined,
          width: Number.isFinite(attachment.width) ? attachment.width : undefined,
          height: Number.isFinite(attachment.height) ? attachment.height : undefined,
          name: typeof attachment.name === "string" ? attachment.name : undefined,
        };
      })
      .filter((item) => Boolean(item));
    return payload.length ? payload : undefined;
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
      image.src = attachment.thumbDataUrl || attachment.dataUrl;
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
        const thumbnail = await buildThumbnailDataUrl(dataUrl);
        const originalDataUrl =
          estimateDataUrlBytes(dataUrl) <= ATTACHMENT_PERSIST_ORIGINAL_MAX_BYTES
            ? dataUrl
            : undefined;
        runtime.attachments.push({
          id: createAttachmentId(),
          dataUrl,
          thumbDataUrl: thumbnail.thumbDataUrl,
          originalDataUrl,
          width: thumbnail.width || 0,
          height: thumbnail.height || 0,
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
      const sourceDataUrl =
        attachment.dataUrl || attachment.originalDataUrl || attachment.thumbDataUrl;
      if (!sourceDataUrl) {
        continue;
      }
      const image = await loadImageFromDataUrl(sourceDataUrl);
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
    const content = (message.content || "").trim();
    const imageCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
    if (imageCount > 0) {
      if (content) {
        return `${content}\n\n[附图 ${imageCount} 张]`;
      }
      return `[附图 ${imageCount} 张]`;
    }
    return content;
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

  function sanitizeImageUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) {
      return null;
    }
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(value)) {
      return value;
    }
    return sanitizeHttpUrl(value);
  }

  function openImagePreview(rawUrl, altText) {
    const safeUrl = sanitizeImageUrl(rawUrl);
    if (!safeUrl || !dom.imagePreview || !dom.imagePreviewImg || !dom.imageDownloadBtn) {
      return;
    }
    runtime.previewImageUrl = safeUrl;
    dom.imagePreviewImg.src = safeUrl;
    dom.imagePreviewImg.alt = altText || "preview";
    dom.imageDownloadBtn.dataset.imageUrl = safeUrl;
    dom.imagePreview.classList.remove("hidden");
  }

  function closeImagePreview() {
    if (!dom.imagePreview || !dom.imagePreviewImg || !dom.imageDownloadBtn) {
      return;
    }
    dom.imagePreview.classList.add("hidden");
    dom.imagePreviewImg.src = "";
    dom.imageDownloadBtn.dataset.imageUrl = "";
    runtime.previewImageUrl = "";
  }

  function requestImageDownload(rawUrl) {
    const safeUrl = sanitizeImageUrl(rawUrl);
    if (!safeUrl) {
      return;
    }
    post({
      type: "image/download",
      href: safeUrl,
    });
    setStatus({
      kind: "progress",
      title: "正在下载图片",
      detail: safeUrl,
      suggestion: "稍后会弹出保存路径并写入本地文件。",
      at: Date.now(),
    });
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
    const imageBlocks = [];
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

    text = text.replace(
      /!\[((?:\\.|[^\]])*)\]\((?:<([^>]+)>|((?:https?:\/\/|data:image\/)[^\s)]+))\)/g,
      (_, rawAlt, angleWrappedUrl, plainUrl) => {
        const url = angleWrappedUrl || plainUrl || "";
        const safeUrl = sanitizeImageUrl(url);
        const alt = String(rawAlt || "").replace(/\\([\[\]\\])/g, "$1");
        if (!safeUrl) {
          return alt;
        }
        const token = `__IMAGE_BLOCK_${imageBlocks.length}__`;
        imageBlocks.push({
          alt,
          url: safeUrl,
        });
        return token;
      }
    );

    text = escapeHtml(text);
    text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(
      /\[((?:\\.|[^\]])+)\]\((?:&lt;((?:(?!&gt;).)+)&gt;|<([^>]+)>|(https?:\/\/[^\s)]+))\)/g,
      (_, rawLabel, escapedAngleWrappedUrl, angleWrappedUrl, plainUrl) => {
        const rawUrl = escapedAngleWrappedUrl || angleWrappedUrl || plainUrl || "";
        const url = rawUrl.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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
    text = text.replace(/<p>__IMAGE_BLOCK_(\d+)__<\/p>/g, "__IMAGE_BLOCK_$1__");

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

    text = text.replace(/__IMAGE_BLOCK_(\d+)__/g, (_, index) => {
      const block = imageBlocks[Number(index)];
      if (!block) {
        return "";
      }
      const safeUrl = escapeHtml(block.url);
      const safeAlt = escapeHtml(block.alt || "generated image");
      return [
        `<figure class="message-image-block">`,
        `  <img class="message-inline-image" src="${safeUrl}" alt="${safeAlt}" loading="lazy" referrerpolicy="no-referrer" data-image-url="${safeUrl}">`,
        `</figure>`,
      ].join("");
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

  function renderHistoryButtonState() {
    dom.historyBtn.disabled = state.threads.length === 0;
    const historyTooltip = "历史记录";
    dom.historyBtn.dataset.tooltip = historyTooltip;
    dom.historyBtn.title = historyTooltip;
    dom.historyBtn.removeAttribute("data-count");
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
    renderHistoryButtonState();
    if (!runtime.historyOpen) {
      return;
    }

    dom.threadList.innerHTML = "";

    const keyword = runtime.historyKeyword.trim().toLowerCase();
    const filteredThreads = keyword
      ? state.threads.filter((thread) => getThreadSearchText(thread).includes(keyword))
      : state.threads;

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

  /**
   * Populate a .message-body element with content for the given message.
   */
  function fillMessageBody(body, message) {
    if (message.role === "assistant") {
      body.innerHTML = renderMarkdown(message.content);
    } else {
      body.innerHTML = "";
      const userText = String(message.content || "");
      if (userText.trim().length > 0) {
        const textNode = document.createElement("p");
        textNode.className = "user-message-text";
        textNode.textContent = userText;
        body.appendChild(textNode);
      }
      const messageAttachments = Array.isArray(message.attachments) ? message.attachments : [];
      if (messageAttachments.length > 0) {
        const gallery = document.createElement("div");
        gallery.className = "message-attachment-gallery";
        for (const attachment of messageAttachments) {
          const thumbUrl = sanitizeImageUrl(attachment.thumbDataUrl || "");
          if (!thumbUrl) { continue; }
          const fullUrl = sanitizeImageUrl(attachment.originalDataUrl || "") || thumbUrl;
          const figure = document.createElement("figure");
          figure.className = "message-image-block";
          const image = document.createElement("img");
          image.className = "message-inline-image";
          image.src = thumbUrl;
          image.alt = attachment.name || "attachment";
          image.loading = "lazy";
          image.referrerPolicy = "no-referrer";
          image.dataset.imageUrl = fullUrl;
          figure.appendChild(image);
          gallery.appendChild(figure);
        }
        if (gallery.childElementCount > 0) {
          body.appendChild(gallery);
        }
      }
    }
  }

  /**
   * Create a complete message DOM element for the given message data.
   */
  function buildMessageElement(message) {
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
    fillMessageBody(body, message);
    wrapper.appendChild(body);
    return wrapper;
  }

  function scheduleMessagesScrollToBottom() {
    if (runtime.pendingScrollRaf) {
      return;
    }
    runtime.pendingScrollRaf = requestAnimationFrame(() => {
      runtime.pendingScrollRaf = 0;
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }

  function renderMessages(forceScrollToBottom) {
    const thread = getActiveThread();

    // --- Empty states: full clear ---
    if (!thread) {
      dom.messages.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "请先创建会话。";
      dom.messages.appendChild(empty);
      renderComposerState();
      return;
    }

    if (!thread.messages.length) {
      dom.messages.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "发送第一条消息开始对话。";
      dom.messages.appendChild(empty);
      renderComposerState();
      return;
    }

    // --- Incremental DOM update (no full innerHTML clear) ---
    // Only update/add messages that actually changed; untouched elements
    // stay in the DOM so the browser preserves the user's scroll position.

    const expectedIds = new Set(thread.messages.map(m => m.id));

    // Index existing rendered message elements; remove stale children
    // (optimistic placeholders, .empty hints, deleted messages).
    const existingMap = new Map();
    for (const child of Array.from(dom.messages.children)) {
      const mid = child.dataset && child.dataset.messageId;
      if (mid && expectedIds.has(mid)) {
        existingMap.set(mid, child);
      } else {
        child.remove();
      }
    }

    for (const message of thread.messages) {
      // Quick change-detection token: status + content length.
      // A "done" message never changes again, so the token is stable.
      const renderKey = message.status + "|" + (message.content || "").length;
      const el = existingMap.get(message.id);

      if (el) {
        // Element already in DOM — only re-render body if something changed
        if (el.dataset.renderKey !== renderKey) {
          el.className = `message ${message.role} ${message.status}`;
          const body = el.querySelector(".message-body");
          if (body) {
            fillMessageBody(body, message);
          }
          el.dataset.renderKey = renderKey;
        }
      } else {
        // New message — build full element and append
        const newEl = buildMessageElement(message);
        newEl.dataset.renderKey = renderKey;
        dom.messages.appendChild(newEl);
      }
    }

    // Scroll only on explicit request (thread switch / initial load).
    // Normal content updates keep the user's current scroll position.
    if (forceScrollToBottom) {
      scheduleMessagesScrollToBottom();
    }
    renderComposerState();
  }

  function getAllSlashTriggers() {
    const triggers = [];
    for (const command of SLASH_COMMANDS) {
      triggers.push({ trigger: command.cmd, command });
      for (const alias of command.alias || []) {
        triggers.push({ trigger: alias, command });
      }
    }
    return triggers;
  }

  function matchSlashCommands(input) {
    const text = input.toLowerCase();
    if (!text.startsWith("/")) {
      return [];
    }
    const allTriggers = getAllSlashTriggers();
    if (text === "/") {
      return allTriggers;
    }
    return allTriggers.filter((item) => item.trigger.toLowerCase().startsWith(text));
  }

  function renderSlashMenu() {
    if (!dom.slashMenu) {
      return;
    }
    if (!runtime.slashMenuVisible || runtime.slashMenuItems.length === 0) {
      dom.slashMenu.classList.add("hidden");
      dom.slashMenu.innerHTML = "";
      return;
    }
    dom.slashMenu.classList.remove("hidden");
    dom.slashMenu.innerHTML = "";
    for (let i = 0; i < runtime.slashMenuItems.length; i++) {
      const item = runtime.slashMenuItems[i];
      const el = document.createElement("div");
      el.className = `slash-menu-item${i === runtime.slashMenuActiveIndex ? " active" : ""}`;
      el.setAttribute("role", "option");
      el.dataset.index = String(i);

      const cmdSpan = document.createElement("span");
      cmdSpan.className = "slash-menu-item-cmd";
      cmdSpan.textContent = item.trigger;
      el.appendChild(cmdSpan);

      const descSpan = document.createElement("span");
      descSpan.className = "slash-menu-item-desc";
      descSpan.textContent = item.command.desc;
      el.appendChild(descSpan);

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
      });
      el.addEventListener("mouseenter", () => {
        if (runtime.slashMenuActiveIndex === i) {
          return;
        }
        runtime.slashMenuActiveIndex = i;
        const allItems = dom.slashMenu.querySelectorAll(".slash-menu-item");
        for (let k = 0; k < allItems.length; k++) {
          allItems[k].classList.toggle("active", k === i);
        }
      });
      el.addEventListener("click", () => {
        selectSlashCommand(i);
      });

      dom.slashMenu.appendChild(el);
    }
  }

  function showSlashMenu(items) {
    runtime.slashMenuItems = items;
    runtime.slashMenuVisible = true;
    runtime.slashMenuActiveIndex = 0;
    renderSlashMenu();
  }

  function hideSlashMenu() {
    runtime.slashMenuVisible = false;
    runtime.slashMenuItems = [];
    runtime.slashMenuActiveIndex = 0;
    renderSlashMenu();
  }

  function selectSlashCommand(index) {
    const item = runtime.slashMenuItems[index];
    if (!item) {
      hideSlashMenu();
      return;
    }
    dom.input.value = item.trigger + " ";
    runtime.slashActiveCommand = item.command;
    dom.input.placeholder = item.command.placeholder || DEFAULT_INPUT_PLACEHOLDER;
    hideSlashMenu();
    dom.input.focus();
    saveDraft();
    renderComposerState();
  }

  function updateSlashState() {
    const value = dom.input.value;
    const trimmed = value.trimStart();
    // Check if user cleared the command prefix
    if (runtime.slashActiveCommand) {
      const allTriggers = getAllSlashTriggers().filter((t) => t.command === runtime.slashActiveCommand);
      const stillHasPrefix = allTriggers.some((t) => trimmed.toLowerCase().startsWith(t.trigger.toLowerCase()));
      if (!stillHasPrefix) {
        runtime.slashActiveCommand = null;
      }
    }
    // Check for new command prefix match (after typing full command + space)
    if (!runtime.slashActiveCommand) {
      const allTriggers = getAllSlashTriggers();
      for (const item of allTriggers) {
        if (trimmed.toLowerCase().startsWith(item.trigger.toLowerCase() + " ") ||
            trimmed.toLowerCase() === item.trigger.toLowerCase()) {
          runtime.slashActiveCommand = item.command;
          break;
        }
      }
    }
    // Show/hide menu
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const matches = matchSlashCommands(trimmed);
      if (matches.length > 0) {
        showSlashMenu(matches);
        return;
      }
    }
    hideSlashMenu();
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
      dom.sendBtn.title = `发送中... ${formatElapsedTime(Date.now() - pendingSince)}`;
    } else {
      dom.sendBtn.title = pending ? "发送中..." : "发送";
    }

    if (!thread) {
      dom.input.placeholder = "请先创建会话，再输入问题。";
      if (dom.followUpBar) dom.followUpBar.classList.add("hidden");
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
    if (runtime.slashActiveCommand) {
      dom.input.placeholder = runtime.slashActiveCommand.placeholder || DEFAULT_INPUT_PLACEHOLDER;
      return;
    }
    dom.input.placeholder = DEFAULT_INPUT_PLACEHOLDER;

    // ── 追问上文指示器 ──
    if (dom.followUpBar && dom.followUpText) {
      const doneMessages = (thread.messages || []).filter(
        (m) => m.status === "done"
      );
      // 至少有一个完整的用户→助手问答对（2 条 done 消息）
      const hasPriorExchange = doneMessages.length >= 2;
      if (hasPriorExchange) {
        const lastDoneUser = [...doneMessages]
          .reverse()
          .find((m) => m.role === "user");
        if (lastDoneUser) {
          const preview =
            lastDoneUser.content.length > 60
              ? lastDoneUser.content.slice(0, 60) + "…"
              : lastDoneUser.content;
          dom.followUpText.textContent = "追问上文：" + preview;
          dom.followUpBar.classList.remove("hidden");
        } else {
          dom.followUpBar.classList.add("hidden");
        }
      } else {
        dom.followUpBar.classList.add("hidden");
      }
    }
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
        at: Date.now(),
      });
      return;
    }

    const imageNode = target.closest(".message-inline-image");
    if (imageNode instanceof HTMLImageElement) {
      const imageUrl = imageNode.dataset.imageUrl || imageNode.src || "";
      openImagePreview(imageUrl, imageNode.alt || "preview");
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

  /**
   * 乐观渲染：在 DOM 中立即注入用户消息 + pending 助手消息。
   * 这些元素是纯装饰性的，当 host 发回 state/updated 后
   * renderMessages() 的 innerHTML = "" 会自动清除它们。
   */
  function renderOptimisticMessages(text, attachments, hasImage) {
    // 如果当前线程已有 "发送第一条消息" 占位符，先清掉
    var emptyPlaceholder = dom.messages.querySelector(".empty");
    if (emptyPlaceholder) {
      emptyPlaceholder.remove();
    }

    // --- 用户消息气泡 ---
    var userWrapper = document.createElement("div");
    userWrapper.className = "message user done";

    var userMeta = document.createElement("div");
    userMeta.className = "meta";
    var userMetaLabel = document.createElement("span");
    userMetaLabel.textContent = "You \u00b7 " + formatStatusTime(Date.now());
    userMeta.appendChild(userMetaLabel);
    userWrapper.appendChild(userMeta);

    var userBody = document.createElement("div");
    userBody.className = "message-body";
    if (text && text.trim()) {
      var textNode = document.createElement("p");
      textNode.className = "user-message-text";
      textNode.textContent = text;
      userBody.appendChild(textNode);
    }
    if (attachments && attachments.length > 0) {
      var gallery = document.createElement("div");
      gallery.className = "message-attachment-gallery";
      for (var ai = 0; ai < attachments.length; ai++) {
        var att = attachments[ai];
        var thumbUrl = att.thumbDataUrl || "";
        if (!thumbUrl) { continue; }
        var figure = document.createElement("figure");
        figure.className = "message-image-block";
        var img = document.createElement("img");
        img.className = "message-inline-image";
        img.src = thumbUrl;
        img.alt = att.name || "attachment";
        img.loading = "lazy";
        figure.appendChild(img);
        gallery.appendChild(figure);
      }
      if (gallery.childElementCount > 0) {
        userBody.appendChild(gallery);
      }
    }
    userWrapper.appendChild(userBody);
    dom.messages.appendChild(userWrapper);

    // --- Pending 助手消息气泡 ---
    var pendingWrapper = document.createElement("div");
    pendingWrapper.className = "message assistant pending";

    var pendingMeta = document.createElement("div");
    pendingMeta.className = "meta";
    var pendingMetaLabel = document.createElement("span");
    pendingMetaLabel.textContent = "HUGE AI \u00b7 " + formatStatusTime(Date.now());
    pendingMeta.appendChild(pendingMetaLabel);
    pendingWrapper.appendChild(pendingMeta);

    var pendingBody = document.createElement("div");
    pendingBody.className = "message-body";
    var pendingText = document.createElement("p");
    pendingText.textContent = hasImage
      ? "\u6b63\u5728\u8c03\u7528 HUGE AI \u641c\u7d22\u5e76\u4e0a\u4f20\u622a\u56fe\uff0c\u8bf7\u7a0d\u5019..."
      : "\u6b63\u5728\u8c03\u7528 HUGE AI \u641c\u7d22\uff0c\u8bf7\u7a0d\u5019...";
    pendingBody.appendChild(pendingText);
    pendingWrapper.appendChild(pendingBody);
    dom.messages.appendChild(pendingWrapper);

    // 滚动到底部
    scheduleMessagesScrollToBottom();
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
      attachments: normalizeAttachmentPayload(),
    });
    setHistoryOpen(false);

    // 乐观渲染：立即在 UI 中显示用户消息和 pending 助手消息
    renderOptimisticMessages(text, runtime.attachments, Boolean(mergedImageDataUrl));

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
    runtime.slashActiveCommand = null;
    hideSlashMenu();
    clearAttachments();
    saveDraft();
    renderComposerState();
  }

  function handleHostMessage(message) {
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return;
    }

    switch (message.type) {
      case "state/full": {
        const previousActiveThreadId = state.activeThreadId;
        applyFullState(message.state);
        if (
          previousActiveThreadId &&
          previousActiveThreadId !== state.activeThreadId &&
          runtime.attachments.length > 0
        ) {
          clearAttachments();
        }
        pruneThreadStatus();
        renderThreads();
        renderMessages(true);
        renderAuthBanner();
        renderStatusBar();
        break;
      }
      case "state/updated": {
        const previousActiveThreadId = state.activeThreadId;
        if (message.patch && typeof message.patch === "object") {
          applyStatePatch(message.patch);
        } else if (message.state && typeof message.state === "object") {
          applyFullState(message.state);
        }
        if (
          previousActiveThreadId &&
          previousActiveThreadId !== state.activeThreadId &&
          runtime.attachments.length > 0
        ) {
          clearAttachments();
        }
        pruneThreadStatus();
        renderThreads();
        renderMessages(previousActiveThreadId !== state.activeThreadId);
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
          detail: "将启动 nodriver 登录验证窗口。",
          suggestion: "完成验证后返回插件点击 Retry。",
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

      // 重置全局状态，避免残留的 progress 让新线程显示蓝色指示灯
      setStatus({
        kind: "idle",
        title: "新会话已创建",
        detail: "发送消息开始搜索。",
        at: Date.now(),
      });

      // 乐观渲染：立即清空消息区域，显示新线程占位符
      dom.messages.innerHTML = "";
      var emptyHint = document.createElement("div");
      emptyHint.className = "empty";
      emptyHint.textContent = "发送第一条消息开始对话。";
      dom.messages.appendChild(emptyHint);

      // 重置输入框状态
      dom.input.value = "";
      runtime.slashActiveCommand = null;
      hideSlashMenu();
      dom.input.disabled = false;
      dom.input.placeholder = DEFAULT_INPUT_PLACEHOLDER;
      dom.sendBtn.disabled = true;
      dom.input.focus();
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

    if (dom.attachImageBtn) {
      dom.attachImageBtn.addEventListener("click", () => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.multiple = true;
        fileInput.style.display = "none";
        fileInput.addEventListener("change", () => {
          const files = fileInput.files ? Array.from(fileInput.files) : [];
          if (files.length) {
            void addAttachmentsFromFiles(files).then((added) => {
              if (added) {
                setStatus({
                  kind: "success",
                  title: "图片已添加",
                  detail: added > 1 ? `已添加 ${added} 张图片。` : "已添加 1 张图片。",
                  suggestion: "输入问题后发送，或继续添加更多图片。",
                  threadId: state.activeThreadId || undefined,
                  at: Date.now(),
                });
              }
            });
          }
          fileInput.remove();
        });
        document.body.appendChild(fileInput);
        fileInput.click();
      });
    }

    if (dom.slashCmdBtn) {
      dom.slashCmdBtn.addEventListener("click", () => {
        if (runtime.slashMenuVisible) {
          hideSlashMenu();
        } else {
          dom.input.value = "/";
          dom.input.focus();
          dom.input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }

    if (dom.drawImageBtn) {
      dom.drawImageBtn.addEventListener("click", () => {
        const drawCmd = SLASH_COMMANDS.find((c) => c.cmd === "/draw");
        if (drawCmd) {
          const existing = dom.input.value.trim();
          dom.input.value = existing ? "/draw " + existing : "/draw ";
          runtime.slashActiveCommand = drawCmd;
          dom.input.placeholder = drawCmd.placeholder || "输入图片描述...";
          hideSlashMenu();
          dom.input.focus();
          saveDraft();
          renderComposerState();
        }
      });
    }

    if (dom.fastDrawBtn) {
      dom.fastDrawBtn.addEventListener("click", () => {
        const fastDrawCmd = SLASH_COMMANDS.find((c) => c.cmd === "/fastdraw");
        if (fastDrawCmd) {
          const existing = dom.input.value.trim();
          dom.input.value = existing ? "/fastdraw " + existing : "/fastdraw ";
          runtime.slashActiveCommand = fastDrawCmd;
          dom.input.placeholder = fastDrawCmd.placeholder || "输入图片描述...";
          hideSlashMenu();
          dom.input.focus();
          saveDraft();
          renderComposerState();
        }
      });
    }

    dom.input.addEventListener("keydown", (event) => {
      // Slash menu keyboard navigation
      if (runtime.slashMenuVisible && runtime.slashMenuItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          runtime.slashMenuActiveIndex = (runtime.slashMenuActiveIndex + 1) % runtime.slashMenuItems.length;
          renderSlashMenu();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          runtime.slashMenuActiveIndex = (runtime.slashMenuActiveIndex - 1 + runtime.slashMenuItems.length) % runtime.slashMenuItems.length;
          renderSlashMenu();
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          selectSlashCommand(runtime.slashMenuActiveIndex);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          hideSlashMenu();
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendCurrentMessage();
      }
    });

    dom.input.addEventListener("input", () => {
      updateSlashState();
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

    if (dom.imagePreviewBackdrop) {
      dom.imagePreviewBackdrop.addEventListener("click", () => {
        closeImagePreview();
      });
    }

    if (dom.imagePreviewCloseBtn) {
      dom.imagePreviewCloseBtn.addEventListener("click", () => {
        closeImagePreview();
      });
    }

    if (dom.imageDownloadBtn) {
      dom.imageDownloadBtn.addEventListener("click", () => {
        const imageUrl = dom.imageDownloadBtn.dataset.imageUrl || runtime.previewImageUrl || "";
        requestImageDownload(imageUrl);
      });
    }

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dom.imagePreview && !dom.imagePreview.classList.contains("hidden")) {
        closeImagePreview();
        return;
      }
      if (event.key === "Escape" && runtime.historyOpen) {
        setHistoryOpen(false);
      }
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
