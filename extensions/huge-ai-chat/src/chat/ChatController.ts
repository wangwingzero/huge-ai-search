import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { SetupRunner } from "../auth/SetupRunner";
import { McpClientManager, McpWarmupResult } from "../mcp/McpClientManager";
import { ThreadStore } from "./ThreadStore";
import { isAuthRelatedError, isNoRecordResponseText, parseSearchToolText } from "./responseFormatter";
import {
  ChatAttachment,
  ChatStatusKind,
  HostToPanelMessage,
  PanelToHostMessage,
  SearchLanguage,
} from "./types";

const SEARCH_REQUEST_TIMEOUT_TEXT_MS = 120_000;
const SEARCH_REQUEST_TIMEOUT_IMAGE_MS = 170_000;
const MCP_WARMUP_WAIT_MS = 12_000;
const MAX_PASTED_IMAGE_BYTES = 15 * 1024 * 1024;
const TEMP_IMAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const TEMP_IMAGE_CLEANUP_DELAY_MS = 10 * 60 * 1000;
const TEMP_IMAGE_DIR_NAME = "huge-ai-chat-images";
const AI_IMAGE_CACHE_DIR_NAME = "ai-image-cache";
const NO_RECORD_MESSAGE = "该词条在当前技术语料库和实时搜索中无可验证记录。";
const NO_RECORD_DISCLAIMER = "说明：当前仅表示未检索到可验证权威来源，不等于该词条绝对不存在。";

function getNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isSearchLanguage(value: unknown): value is SearchLanguage {
  return (
    value === "zh-CN" ||
    value === "en-US" ||
    value === "ja-JP" ||
    value === "ko-KR" ||
    value === "de-DE" ||
    value === "fr-FR"
  );
}

function isDataImageUrl(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(value);
}

function sanitizeUserAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }
  const out: ChatAttachment[] = [];
  for (const item of input.slice(0, 12)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<ChatAttachment>;
    if (typeof candidate.id !== "string" || typeof candidate.thumbDataUrl !== "string") {
      continue;
    }
    const thumb = candidate.thumbDataUrl.trim();
    if (!isDataImageUrl(thumb)) {
      continue;
    }
    const original =
      typeof candidate.originalDataUrl === "string" && isDataImageUrl(candidate.originalDataUrl.trim())
        ? candidate.originalDataUrl.trim()
        : undefined;
    out.push({
      id: candidate.id,
      thumbDataUrl: thumb,
      originalDataUrl: original,
      width: typeof candidate.width === "number" ? candidate.width : undefined,
      height: typeof candidate.height === "number" ? candidate.height : undefined,
      name: typeof candidate.name === "string" ? candidate.name : undefined,
    });
  }
  return out;
}

interface ParsedDataUrlImage {
  mimeType: string;
  buffer: Buffer;
  extension: string;
}

interface PersistedImageFile {
  filePath: string;
  byteLength: number;
}

interface StateUpdateOptions {
  upsertThreadIds?: string[];
  removeThreadIds?: string[];
  reset?: boolean;
}

function decodeImageDataUrl(raw: string): ParsedDataUrlImage {
  const value = raw.trim();
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("图片数据格式无效，请重新粘贴截图后重试。");
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length <= 0) {
    throw new Error("图片内容为空，请重新截图后重试。");
  }
  if (buffer.length > MAX_PASTED_IMAGE_BYTES) {
    throw new Error(`图片过大（>${Math.floor(MAX_PASTED_IMAGE_BYTES / 1024 / 1024)}MB），请裁剪后重试。`);
  }

  const extensionByMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
  };
  const extension = extensionByMime[mimeType] || "png";

  return {
    mimeType,
    buffer,
    extension,
  };
}

function isTechTermLookupQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = trimmed.replace(/[?？!！。,.，；;:：]+$/g, "").trim();
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  const explicitLookupHints = ["词条", "定义", "concept", "definition", "meaning"];
  if (explicitLookupHints.some((keyword) => lower.includes(keyword))) {
    return true;
  }

  if (
    /^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9._:+#-]{1,63})\s*(是什么|是啥|什么意思|含义|定义)$/.test(
      normalized
    )
  ) {
    return true;
  }

  if (/^what\s+is\s+[A-Za-z][A-Za-z0-9._:+#-]{1,63}$/i.test(normalized)) {
    return true;
  }

  if (/^[A-Za-z][A-Za-z0-9._:+#-]{1,63}$/.test(normalized)) {
    return true;
  }

  return false;
}

function hasAuthoritativeSource(sources: Array<{ url: string }>, query?: string): boolean {
  // Extract a normalized term from the query for official-site matching.
  let queryTerm = "";
  if (query) {
    const trimmed = query.trim().replace(/[?？!！。,.，；;:：]+$/g, "").trim();
    const lower = trimmed.toLowerCase();
    const enMatch = lower.match(/^what\s+is\s+(.+)$/i);
    const zhMatch = lower.match(/^(.+?)\s*(?:是什么|是啥|什么意思|含义|定义)$/);
    if (enMatch) {
      queryTerm = enMatch[1].trim().toLowerCase();
    } else if (zhMatch) {
      queryTerm = zhMatch[1].trim().toLowerCase();
    } else if (/^[A-Za-z][A-Za-z0-9._:+#-]{1,63}$/.test(trimmed)) {
      queryTerm = lower;
    }
  }

  return sources.some((source) => {
    try {
      const parsed = new URL(source.url);
      const host = parsed.hostname.toLowerCase();
      const pathName = parsed.pathname.toLowerCase();

      if (
        host === "stackoverflow.com" ||
        host.endsWith(".stackoverflow.com") ||
        host.endsWith(".stackexchange.com")
      ) {
        return false;
      }

      if (host === "github.com" || host.endsWith(".github.com")) {
        return true;
      }

      // Standards bodies
      if (
        host === "rfc-editor.org" ||
        host.endsWith(".rfc-editor.org") ||
        host === "ietf.org" ||
        host.endsWith(".ietf.org") ||
        host === "w3.org" ||
        host.endsWith(".w3.org") ||
        host === "iso.org" ||
        host.endsWith(".iso.org") ||
        host === "ecma-international.org" ||
        host.endsWith(".ecma-international.org") ||
        host === "whatwg.org" ||
        host.endsWith(".whatwg.org")
      ) {
        return true;
      }

      // Package registries
      if (
        host === "www.npmjs.com" || host === "npmjs.com" ||
        host === "pypi.org" || host.endsWith(".pypi.org") ||
        host === "crates.io" ||
        host === "pkg.go.dev" ||
        host === "rubygems.org" ||
        host === "www.nuget.org" || host === "nuget.org" ||
        host === "packagist.org" ||
        host === "pub.dev" ||
        host === "mvnrepository.com" || host === "www.mvnrepository.com"
      ) {
        return true;
      }

      // Well-known tech platforms
      if (
        host === "dev.to" ||
        host === "medium.com" || host.endsWith(".medium.com") ||
        host === "wikipedia.org" || host.endsWith(".wikipedia.org")
      ) {
        return true;
      }

      // Documentation sites
      if (
        host.startsWith("docs.") ||
        host.includes(".docs.") ||
        host === "developer.mozilla.org" ||
        host.endsWith(".readthedocs.io") ||
        pathName.includes("/docs/") ||
        pathName.includes("/reference/") ||
        pathName.includes("/api/")
      ) {
        return true;
      }

      // Official sites: domain contains the query term
      if (queryTerm && queryTerm.length >= 2) {
        const hostBase = host.replace(/^www\./, "");
        if (hostBase.includes(queryTerm)) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  });
}

function hasSubstantiveAnswer(answer: string, sourceCount: number): boolean {
  return (answer || "").length > 200 && sourceCount >= 1;
}

function isValidPanelToHostMessage(payload: unknown): payload is PanelToHostMessage {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as {
    type?: unknown;
    threadId?: unknown;
    text?: unknown;
    language?: unknown;
    title?: unknown;
    markdown?: unknown;
    href?: unknown;
    imageDataUrl?: unknown;
    imageCount?: unknown;
    attachments?: unknown;
  };

  if (typeof candidate.type !== "string") {
    return false;
  }

  switch (candidate.type) {
    case "panel/ready":
    case "browser/open":
    case "thread/clearAll":
    case "auth/runSetup":
      return true;
    case "thread/create":
      return candidate.language === undefined || isSearchLanguage(candidate.language);
    case "thread/exportMarkdown":
      return (
        typeof candidate.threadId === "string" &&
        typeof candidate.title === "string" &&
        typeof candidate.markdown === "string"
      );
    case "thread/switch":
    case "thread/delete":
    case "chat/retryLast":
      return typeof candidate.threadId === "string";
    case "link/open":
    case "image/download":
      return typeof candidate.href === "string";
    case "chat/send": {
      const validImageData =
        candidate.imageDataUrl === undefined || typeof candidate.imageDataUrl === "string";
      const validImageCount =
        candidate.imageCount === undefined ||
        (typeof candidate.imageCount === "number" &&
          Number.isFinite(candidate.imageCount) &&
          candidate.imageCount >= 1 &&
          candidate.imageCount <= 32);
      const validAttachments =
        candidate.attachments === undefined ||
        (Array.isArray(candidate.attachments) &&
          candidate.attachments.length <= 12 &&
          candidate.attachments.every((item) => {
            if (!item || typeof item !== "object") {
              return false;
            }
            const typed = item as Partial<ChatAttachment>;
            return (
              typeof typed.id === "string" &&
              typeof typed.thumbDataUrl === "string"
            );
          }));
      return (
        typeof candidate.threadId === "string" &&
        typeof candidate.text === "string" &&
        (candidate.language === undefined || isSearchLanguage(candidate.language)) &&
        validImageData &&
        validImageCount &&
        validAttachments
      );
    }
    default:
      return false;
  }
}

export class ChatController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private sidebarWebview: vscode.Webview | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];
  private sidebarDisposables: vscode.Disposable[] = [];
  private readonly pendingThreads = new Set<string>();
  private readonly lastQueryByThread = new Map<string, string>();
  private warmupTask: Promise<McpWarmupResult> | null = null;
  private readonly tempImageDir = path.join(os.tmpdir(), TEMP_IMAGE_DIR_NAME);
  private readonly aiImageCacheDir = path.join(os.homedir(), ".huge-ai-search", AI_IMAGE_CACHE_DIR_NAME);
  private tempImageDirPrepared = false;
  private aiImageCacheDirPrepared = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ThreadStore,
    private readonly mcpManager: McpClientManager,
    private readonly setupRunner: SetupRunner,
    private readonly output: vscode.OutputChannel
  ) {
    // 让 SetupRunner 能找到本地 setup.js（与 MCP 服务器同目录）
    this.setupRunner.setServerDirResolver(() => this.mcpManager.getServerDir());
  }

  private getConfiguredDefaultLanguage(): SearchLanguage {
    return "en-US";
  }

  private isStrictGroundingEnabled(): boolean {
    const processFlag = process.env.HUGE_AI_SEARCH_STRICT_GROUNDING;
    if (typeof processFlag === "string" && processFlag.trim().length > 0) {
      return processFlag.trim() !== "0";
    }

    return true;
  }

  private shouldForceNoRecord(
    query: string,
    sources: Array<{ url: string }>,
    answer: string,
    isFollowUp: boolean,
    hasImageInput: boolean
  ): boolean {
    if (!this.isStrictGroundingEnabled()) {
      return false;
    }
    if (isFollowUp || hasImageInput) {
      return false;
    }
    if (!isTechTermLookupQuery(query)) {
      return false;
    }
    if (hasAuthoritativeSource(sources, query)) {
      return false;
    }
    if (hasSubstantiveAnswer(answer, sources.length)) {
      return false;
    }
    return true;
  }

  private buildNoRecordMarkdown(): string {
    return `${NO_RECORD_MESSAGE}\n\n${NO_RECORD_DISCLAIMER}`;
  }

  attachSidebarView(webviewView: vscode.WebviewView): void {
    this.disposeSidebarListeners();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);
    this.sidebarWebview = webviewView.webview;

    this.sidebarDisposables.push(
      webviewView.onDidDispose(() => {
        this.sidebarWebview = null;
        this.disposeSidebarListeners();
      })
    );

    this.sidebarDisposables.push(
      webviewView.webview.onDidReceiveMessage((payload: unknown) => {
        void this.handlePanelMessage(payload);
      })
    );

    void this.ensureMcpWarmup();
  }

  async openChatPanel(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.postStateUpdated();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "hugeAiChat.panel",
      "HUGE",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );
    const panelIcon = vscode.Uri.joinPath(this.context.extensionUri, "media", "huge-ai-chat-icon.png");
    this.panel.iconPath = {
      light: panelIcon,
      dark: panelIcon,
    };

    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
    this.installPanelListeners(this.panel);
    this.postStateFull();
    void this.ensureMcpWarmup();
  }

  async createThreadFromCommand(): Promise<void> {
    await this.openChatPanel();
    const thread = await this.store.createThread(this.getConfiguredDefaultLanguage());
    this.postStateUpdated({ upsertThreadIds: [thread.id] });
  }

  async sendSelectionToNewThread(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) {
      void vscode.window.showWarningMessage("选中文本为空，无法发送到 Huge AI Chat。");
      return;
    }

    await this.openChatPanel();
    const language = this.getConfiguredDefaultLanguage();
    const thread = await this.store.createThread(language);
    this.postStateUpdated({ upsertThreadIds: [thread.id] });
    await this.sendMessage(thread.id, text, undefined, undefined, language);
  }

  async clearHistoryFromCommand(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      "确定清空 Huge AI Chat 的全部历史记录吗？",
      { modal: true },
      "清空"
    );
    if (confirm !== "清空") {
      return;
    }

    const thread = await this.store.clearHistory();
    this.postStateUpdated({
      reset: true,
      upsertThreadIds: [thread.id],
    });
  }

  async runSetupFromCommand(): Promise<void> {
    const result = await this.runSetupFlow();
    if (result.success) {
      void vscode.window.showInformationMessage(result.message);
      return;
    }
    void vscode.window.showErrorMessage(result.message);
  }

  async shutdown(): Promise<void> {
    this.dispose();
    await this.mcpManager.dispose();
  }

  dispose(): void {
    this.disposePanelListeners();
    this.disposeSidebarListeners();
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
    this.sidebarWebview = null;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private installPanelListeners(panel: vscode.WebviewPanel): void {
    this.disposePanelListeners();

    this.panelDisposables.push(
      panel.onDidDispose(() => {
        this.panel = null;
        this.disposePanelListeners();
      })
    );

    this.panelDisposables.push(
      panel.webview.onDidReceiveMessage((payload: unknown) => {
        void this.handlePanelMessage(payload);
      })
    );
  }

  private disposePanelListeners(): void {
    for (const disposable of this.panelDisposables) {
      disposable.dispose();
    }
    this.panelDisposables = [];
  }

  private disposeSidebarListeners(): void {
    for (const disposable of this.sidebarDisposables) {
      disposable.dispose();
    }
    this.sidebarDisposables = [];
  }

  private async handlePanelMessage(payload: unknown): Promise<void> {
    if (!this.isPanelToHostMessage(payload)) {
      return;
    }

    switch (payload.type) {
      case "panel/ready":
        this.postStateFull();
        void this.ensureMcpWarmup();
        return;
      case "browser/open":
        this.openBrowserView();
        return;
      case "thread/create": {
        const language =
          payload.language && isSearchLanguage(payload.language)
            ? payload.language
            : this.getConfiguredDefaultLanguage();
        const thread = await this.store.createThread(language);
        this.postStateUpdated({ upsertThreadIds: [thread.id] });
        return;
      }
      case "thread/exportMarkdown":
        await this.exportThreadMarkdown(payload.threadId, payload.title, payload.markdown);
        return;
      case "thread/clearAll": {
        const thread = await this.store.clearHistory();
        this.pendingThreads.clear();
        this.lastQueryByThread.clear();
        this.postStateUpdated({
          reset: true,
          upsertThreadIds: [thread.id],
        });
        this.postStatus(
          "success",
          "历史已清空",
          "所有线程和会话记录已移除。",
          "点击新聊天开始新的提问。"
        );
        return;
      }
      case "thread/switch":
        await this.store.switchThread(payload.threadId);
        this.postStateUpdated();
        return;
      case "thread/delete":
        await this.store.deleteThread(payload.threadId);
        this.postStateUpdated({
          removeThreadIds: [payload.threadId],
        });
        return;
      case "chat/send":
        await this.sendMessage(
          payload.threadId,
          payload.text,
          payload.imageDataUrl,
          payload.imageCount,
          payload.language,
          payload.attachments
        );
        return;
      case "chat/retryLast":
        await this.retryLast(payload.threadId);
        return;
      case "link/open":
        await this.openExternalLink(payload.href);
        return;
      case "image/download":
        await this.downloadExternalImage(payload.href);
        return;
      case "auth/runSetup":
        await this.runSetupFlow();
        return;
      default:
        return;
    }
  }

  private async retryLast(threadId: string): Promise<void> {
    const cached = this.lastQueryByThread.get(threadId);
    if (cached) {
      await this.sendMessage(threadId, cached);
      return;
    }

    const thread = this.store.getThread(threadId);
    const fallback = [...(thread?.messages || [])]
      .reverse()
      .find(
        (message) =>
          message.role === "user" &&
          (!Array.isArray(message.attachments) || message.attachments.length === 0) &&
          message.content.trim().length > 0
      );
    if (!fallback) {
      void vscode.window.showWarningMessage("没有可重试的问题（仅图片消息暂不支持自动重试）。");
      return;
    }
    await this.sendMessage(threadId, fallback.content);
  }

  private async sendMessage(
    threadId: string,
    rawText: string,
    imageDataUrl?: string,
    imageCount?: number,
    language?: SearchLanguage,
    attachments?: ChatAttachment[]
  ): Promise<void> {
    const text = rawText.trim();
    const normalizedImageDataUrl =
      typeof imageDataUrl === "string" && imageDataUrl.trim().length > 0
        ? imageDataUrl.trim()
        : undefined;
    const normalizedImageCount = normalizedImageDataUrl
      ? Math.max(1, Math.min(32, Math.floor(imageCount || 1)))
      : 0;
    const normalizedUserAttachments = sanitizeUserAttachments(attachments);
    if (!text && !normalizedImageDataUrl) {
      return;
    }
    if (this.pendingThreads.has(threadId)) {
      this.postStatus(
        "warning",
        "当前线程正在处理中",
        "上一条请求尚未完成，暂时不能重复发送。",
        "请等待当前请求完成，或稍后点击 Retry。"
      );
      void vscode.window.showInformationMessage("当前线程仍在处理中，请稍候。");
      return;
    }

    const thread = this.store.getThread(threadId);
    if (!thread) {
      return;
    }

    const targetLanguage =
      (language && isSearchLanguage(language) ? language : undefined) ||
      thread.language ||
      this.getConfiguredDefaultLanguage();

    if (thread.language !== targetLanguage) {
      await this.store.setThreadLanguage(threadId, targetLanguage);
    }

    this.pendingThreads.add(threadId);
    if (text) {
      this.lastQueryByThread.set(threadId, text);
    } else {
      this.lastQueryByThread.delete(threadId);
    }

    // 立即显示用户消息和 pending 提示，不要等 warmup
    const userText = this.buildUserMessageContent(text);

    const userMessage = await this.store.addMessage(
      threadId,
      "user",
      userText,
      "done",
      normalizedUserAttachments
    );
    const pendingMessage = await this.store.addMessage(
      threadId,
      "assistant",
      normalizedImageDataUrl
        ? "正在调用 HUGE AI 搜索并上传截图，请稍候..."
        : text.toLowerCase().startsWith("/fastdraw")
          ? "正在调用 Grok 极速画图，请稍候..."
          : "正在调用 HUGE AI 搜索，请稍候...",
      "pending"
    );
    if (!userMessage || !pendingMessage) {
      this.pendingThreads.delete(threadId);
      return;
    }

    this.postStateUpdated({ upsertThreadIds: [threadId] });
    this.postMessage({
      type: "chat/pending",
      threadId,
      messageId: pendingMessage.id,
    });
    this.postStatus(
      "progress",
      "请求已提交",
      normalizedImageDataUrl
        ? `正在准备调用 HUGE AI 搜索服务（附带 ${normalizedImageCount} 张截图${normalizedImageCount > 1 ? "，已自动合并" : ""}）。`
        : "正在准备调用 HUGE AI 搜索服务。",
      "可在下方继续输入，当前请求完成后再发送下一条。",
      threadId
    );

    // warmup 和图片处理在消息显示之后执行
    const warmupReady = await this.waitForMcpWarmupBeforeSend(threadId);
    if (!warmupReady) {
      this.output.appendLine(
        `[Chat] Warmup not ready, continue with direct request: thread=${threadId}`
      );
    }

    let persistedImage: PersistedImageFile | null = null;
    if (normalizedImageDataUrl) {
      try {
        persistedImage = await this.persistImageAttachment(normalizedImageDataUrl);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        const errMarkdown = `## ❌ 图片处理失败\n\n${errorText}`;
        await this.store.updateMessage(threadId, pendingMessage.id, {
          content: errMarkdown,
          status: "error",
        });
        this.pendingThreads.delete(threadId);
        this.postStateUpdated({ upsertThreadIds: [threadId] });
        this.postMessage({
          type: "chat/error",
          threadId,
          message: { ...pendingMessage, content: errMarkdown, status: "error" },
          error: errorText,
          canRetry: false,
        });
        this.postStatus(
          "error",
          "图片处理失败",
          errorText,
          "请重新截图后粘贴，或改用较小尺寸图片。",
          threadId
        );
        return;
      }
    }

    try {
      const latestThread = this.store.getThread(threadId);
      if (!latestThread) {
        throw new Error("线程不存在。");
      }

      const hasExistingSession = Boolean(latestThread.sessionId);
      const useFollowUp = hasExistingSession;
      const { createImage, fastDraw, query: searchQuery } = this.parseCreateImagePrefix(text);

      // ── /fastdraw：Grok-only 画图路径 ──
      if (fastDraw) {
        this.postStatus(
          "progress",
          "正在调用 Grok 极速画图",
          "使用 Grok 快速生成图片，不经过 Google AI...",
          `如果长时间无响应，请检查 Grok API 配置。`,
          threadId
        );
        this.output.appendLine(
          `[Chat] Grok fastdraw start: thread=${threadId}, query=${searchQuery}`
        );

        const grokMarkdown = await this.callGrokImageGeneration(searchQuery);

        if (!grokMarkdown) {
          throw new Error(
            "Grok 画图失败：未能生成任何图片。请检查 Grok API 密钥和地址配置，或稍后重试。"
          );
        }

        this.output.appendLine(`[Chat] Grok fastdraw done: thread=${threadId}`);
        this.postStatus("progress", "已收到 Grok 画图结果", "正在渲染图片...", undefined, threadId);

        const finalMarkdown = await this.cacheRemoteImagesInMarkdown(grokMarkdown);
        const message = await this.store.updateMessage(threadId, pendingMessage.id, {
          content: finalMarkdown,
          status: "done",
        });
        this.postStateUpdated({ upsertThreadIds: [threadId] });
        this.postMessage({
          type: "chat/answer",
          threadId,
          message: message || { ...pendingMessage, content: finalMarkdown, status: "done" },
        });
        this.postStatus(
          "success",
          "Grok 画图完成",
          "图片已生成并渲染完毕。",
          "可继续输入新的画图描述，或切换到 /draw 使用 Google AI。",
          threadId
        );
        return;
      }

      // ── /draw 或普通搜索路径 ──
      const effectiveFollowUp = useFollowUp && !createImage;
      this.postStatus(
        "progress",
        "正在调用搜索服务",
        createImage
          ? hasExistingSession
            ? "当前为画图模式（复用会话），将使用 Google AI 的 Create images 功能。"
            : "当前为画图模式，将使用 Google AI 的 Create images 功能。"
          : effectiveFollowUp
            ? persistedImage
              ? "当前为追问+图片模式，将在当前会话中上传图片并提问。"
              : "当前为追问模式，将复用历史会话上下文。"
            : persistedImage
              ? "检测到截图输入，本次将使用新请求并上传图片。"
              : "当前为新会话，将创建新的搜索会话。",
        `如果长时间无响应，可执行 "Huge AI Chat: Run Login Setup"。`,
        threadId
      );
      this.output.appendLine(
        `[Chat] Search start: thread=${threadId}, follow_up=${effectiveFollowUp}, has_image=${Boolean(persistedImage)}, create_image=${createImage}`
      );
      const requestTimeoutMs = persistedImage
        ? SEARCH_REQUEST_TIMEOUT_IMAGE_MS
        : SEARCH_REQUEST_TIMEOUT_TEXT_MS;

      const resultText = await withTimeout(
        this.mcpManager.callSearch({
          query: searchQuery,
          language: targetLanguage,
          follow_up: effectiveFollowUp,
          session_id: hasExistingSession ? latestThread.sessionId : undefined,
          image_path: persistedImage?.filePath,
          create_image: createImage || undefined,
        }),
        requestTimeoutMs,
        `请求超时（${Math.floor(requestTimeoutMs / 1000)} 秒），请重试或先执行 "Huge AI Chat: Run Login Setup"。`
      );

      this.output.appendLine(`[Chat] Search done: thread=${threadId}`);
      this.postStatus(
        "progress",
        "已收到响应",
        "正在解析并渲染回答内容。",
        undefined,
        threadId
      );

      const parsed = parseSearchToolText(resultText);
      if (parsed.sessionId && parsed.sessionId !== latestThread.sessionId) {
        await this.store.setThreadSessionId(threadId, parsed.sessionId);
      }

      if (parsed.isError) {
        const message = await this.store.updateMessage(threadId, pendingMessage.id, {
          content: parsed.renderedMarkdown,
          status: "error",
        });
        this.postStateUpdated({ upsertThreadIds: [threadId] });
        this.postMessage({
          type: "chat/error",
          threadId,
          message: message || { ...pendingMessage, content: parsed.renderedMarkdown, status: "error" },
          error: parsed.answer,
          canRetry: true,
        });
        this.postStatus(
          parsed.isAuthError ? "warning" : "error",
          parsed.isAuthError ? "需要登录验证" : "请求失败",
          parsed.answer,
          parsed.isAuthError
            ? "请点击 Run Setup 完成登录/验证码，然后点击 Retry。"
            : "请点击 Retry 重试，或更换问题后再次发送。",
          threadId
        );

        if (parsed.isAuthError) {
          await this.runSetupFlow();
        }
        return;
      }

      const serverReturnedNoRecord =
        isNoRecordResponseText(parsed.answer) || isNoRecordResponseText(parsed.renderedMarkdown);
      const forceNoRecord = this.shouldForceNoRecord(
        text,
        parsed.sources,
        parsed.answer,
        useFollowUp,
        Boolean(persistedImage)
      );
      const finalNoRecord = serverReturnedNoRecord || forceNoRecord;
      const markdownBeforeCache = finalNoRecord
        ? this.buildNoRecordMarkdown()
        : parsed.renderedMarkdown;

      const finalMarkdown = finalNoRecord
        ? markdownBeforeCache
        : await this.cacheRemoteImagesInMarkdown(markdownBeforeCache);

      if (forceNoRecord && !serverReturnedNoRecord) {
        this.output.appendLine(
          `[Chat] Strict grounding forced no-record: thread=${threadId}, query=${text}`
        );
      }

      const message = await this.store.updateMessage(threadId, pendingMessage.id, {
        content: finalMarkdown,
        status: "done",
      });
      this.postStateUpdated({ upsertThreadIds: [threadId] });
      this.postMessage({
        type: "chat/answer",
        threadId,
        message: message || { ...pendingMessage, content: finalMarkdown, status: "done" },
      });
      if (finalNoRecord) {
        this.postStatus(
          "warning",
          "回答已按防幻觉策略拦截",
          "未检索到可验证权威来源，已替换为拒答文案。",
          "可补充更精确术语后重试；若需放宽策略，可将 HUGE_AI_SEARCH_STRICT_GROUNDING 设为 0。",
          threadId
        );
      } else {
        this.postStatus(
          "success",
          "回答已生成",
          parsed.sessionId ? `会话已更新：${parsed.sessionId}` : "本次回答已完成。",
          "可以继续追问，系统会自动保持上下文。",
          threadId
        );
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const markdown = `## ❌ 请求失败\n\n${errorText}`;
      const message = await this.store.updateMessage(threadId, pendingMessage.id, {
        content: markdown,
        status: "error",
      });
      this.postStateUpdated({ upsertThreadIds: [threadId] });
      this.postMessage({
        type: "chat/error",
        threadId,
        message: message || { ...pendingMessage, content: markdown, status: "error" },
        error: errorText,
        canRetry: true,
      });
      this.postStatus(
        isAuthRelatedError(errorText) ? "warning" : "error",
        "请求执行失败",
        errorText,
        isAuthRelatedError(errorText)
          ? "请点击 Run Setup 完成登录验证后重试。"
          : "请点击 Retry 重试；若持续失败，请查看 Output: Huge AI Chat 日志。",
        threadId
      );

      if (isAuthRelatedError(errorText)) {
        await this.runSetupFlow();
      }
    } finally {
      this.pendingThreads.delete(threadId);
      if (persistedImage) {
        this.scheduleTempImageCleanup(persistedImage.filePath);
      }
    }
  }

  private buildUserMessageContent(text: string): string {
    return text;
  }

  /**
   * 检测 /draw 或 /fastdraw 前缀，返回 { createImage, fastDraw, query }。
   * /draw → Google AI 画图；/fastdraw → Grok 极速画图。
   */
  private parseCreateImagePrefix(text: string): { createImage: boolean; fastDraw: boolean; query: string } {
    const lower = text.toLowerCase();

    // /fastdraw 必须在 /draw 之前检测（因为 /fastdraw 以 /draw 为前缀的超集）
    const fastPrefixes = ["/fastdraw ", "/fastdraw\t"];
    for (const prefix of fastPrefixes) {
      if (lower.startsWith(prefix) || text.startsWith(prefix)) {
        const query = text.slice(prefix.length).trim();
        return { createImage: true, fastDraw: true, query: query || text };
      }
    }
    if (lower.startsWith("/fastdraw") && text.length > 9) {
      return { createImage: true, fastDraw: true, query: text.slice(9).trim() };
    }

    const drawPrefixes = ["/draw ", "/draw\t"];
    for (const prefix of drawPrefixes) {
      if (lower.startsWith(prefix) || text.startsWith(prefix)) {
        const query = text.slice(prefix.length).trim();
        return { createImage: true, fastDraw: false, query: query || text };
      }
    }
    if (lower.startsWith("/draw") && text.length > 5) {
      return { createImage: true, fastDraw: false, query: text.slice(5).trim() };
    }

    return { createImage: false, fastDraw: false, query: text };
  }

  /**
   * Call Grok API to generate images in parallel with Google AI.
   * Tries primary endpoint first, falls back to backup if primary fails.
   * Returns markdown string with base64-embedded images, or "" on failure/no config.
   */
  private async callGrokImageGeneration(prompt: string): Promise<string> {
    const config = vscode.workspace.getConfiguration("hugeAiChat");
    const primaryKey = (config.get<string>("grokApiKey") || "").trim();
    const primaryUrl = (config.get<string>("grokApiBaseUrl") || "").trim().replace(/\/+$/, "");
    const backupKey = (config.get<string>("grokApiKeyBackup") || "").trim();
    const backupUrl = (config.get<string>("grokApiBaseUrlBackup") || "").trim().replace(/\/+$/, "");

    if (!primaryKey && !backupKey) {
      return "";
    }

    // Try primary endpoint
    if (primaryKey && primaryUrl) {
      const result = await this.callGrokEndpoint(prompt, primaryUrl, primaryKey, "grok-imagine-image", 3);
      if (result) {
        return result;
      }
    }

    // Fallback to backup endpoint
    if (backupKey && backupUrl) {
      this.output.appendLine("[Grok] Primary failed or unconfigured, trying backup...");
      const result = await this.callGrokEndpoint(prompt, backupUrl, backupKey, "grok-imagine-1.0", 1);
      if (result) {
        return result;
      }
    }

    return "";
  }

  /**
   * Call a single Grok-compatible image generation endpoint.
   * Returns markdown string with images, or "" on failure.
   */
  private async callGrokEndpoint(
    prompt: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    n: number
  ): Promise<string> {
    const endpoint = `${baseUrl}/v1/images/generations`;
    try {
      this.output.appendLine(`[Grok] Trying ${baseUrl}: model=${model}, n=${n}`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ prompt, model, n, size: "1024x1024" }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        this.output.appendLine(`[Grok] ${baseUrl} error: HTTP ${response.status} ${body.slice(0, 200)}`);
        return "";
      }

      const data = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
      const items = data.data || [];

      const imageResults = await Promise.allSettled(
        items.map(async (item) => {
          if (item.b64_json && item.b64_json !== "error") {
            return `data:image/jpeg;base64,${item.b64_json}`;
          }
          const url = (item.url || "").trim();
          if (!url || url === "error") {
            throw new Error("No valid URL");
          }
          return this.downloadImageAsDataUrl(url);
        })
      );

      const imageLines: string[] = [];
      for (const result of imageResults) {
        if (result.status === "fulfilled" && result.value) {
          imageLines.push(
            `![Grok 生成图片 ${imageLines.length + 1}](<${result.value}>)`
          );
        }
      }

      if (imageLines.length === 0) {
        this.output.appendLine(`[Grok] ${baseUrl}: no images obtained`);
        return "";
      }

      this.output.appendLine(`[Grok] ${baseUrl}: got ${imageLines.length} images`);
      return `### Grok 生成图片\n\n${imageLines.join("\n\n")}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[Grok] ${baseUrl} failed: ${msg}`);
      return "";
    }
  }

  /**
   * Download an image URL and return a base64 data URL.
   */
  private async downloadImageAsDataUrl(imageUrl: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(imageUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error("Empty response");
      }
      const contentType = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      const buffer = Buffer.from(arrayBuffer);
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    } finally {
      clearTimeout(timer);
    }
  }

  private async persistImageAttachment(imageDataUrl: string): Promise<PersistedImageFile> {
    const parsed = decodeImageDataUrl(imageDataUrl);
    await this.ensureTempImageDirectory();
    const fileName = `paste_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${parsed.extension}`;
    const filePath = path.join(this.tempImageDir, fileName);
    await fs.promises.writeFile(filePath, parsed.buffer);
    this.output.appendLine(
      `[Chat] Image attachment saved: ${filePath} (${parsed.mimeType}, ${parsed.buffer.length} bytes)`
    );
    return {
      filePath,
      byteLength: parsed.buffer.length,
    };
  }

  private async ensureTempImageDirectory(): Promise<void> {
    await fs.promises.mkdir(this.tempImageDir, { recursive: true });
    if (this.tempImageDirPrepared) {
      return;
    }
    this.tempImageDirPrepared = true;
    const expireBefore = Date.now() - TEMP_IMAGE_RETENTION_MS;
    try {
      const entries = await fs.promises.readdir(this.tempImageDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const fullPath = path.join(this.tempImageDir, entry.name);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.mtimeMs < expireBefore) {
            await fs.promises.unlink(fullPath);
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Ignore cleanup errors.
    }
  }

  private scheduleTempImageCleanup(filePath: string): void {
    const timer = setTimeout(() => {
      void fs.promises.unlink(filePath).catch(() => undefined);
    }, TEMP_IMAGE_CLEANUP_DELAY_MS);
    if (typeof (timer as NodeJS.Timeout).unref === "function") {
      (timer as NodeJS.Timeout).unref();
    }
  }

  private getImageExtensionFromContentType(contentType: string | null): string {
    const value = String(contentType || "").toLowerCase();
    if (value.includes("image/png")) {
      return "png";
    }
    if (value.includes("image/jpeg") || value.includes("image/jpg")) {
      return "jpg";
    }
    if (value.includes("image/webp")) {
      return "webp";
    }
    if (value.includes("image/gif")) {
      return "gif";
    }
    if (value.includes("image/bmp")) {
      return "bmp";
    }
    return "png";
  }

  private isSupportedImageMime(mimeType: string): boolean {
    return (
      mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/jpg" ||
      mimeType === "image/webp" ||
      mimeType === "image/gif" ||
      mimeType === "image/bmp"
    );
  }

  private async ensureAiImageCacheDirectory(): Promise<void> {
    await fs.promises.mkdir(this.aiImageCacheDir, { recursive: true });
    if (this.aiImageCacheDirPrepared) {
      return;
    }
    this.aiImageCacheDirPrepared = true;
    const expireBefore = Date.now() - TEMP_IMAGE_RETENTION_MS;
    try {
      const entries = await fs.promises.readdir(this.aiImageCacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const fullPath = path.join(this.aiImageCacheDir, entry.name);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.mtimeMs < expireBefore) {
            await fs.promises.unlink(fullPath);
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Ignore cleanup errors.
    }
  }

  private async cacheRemoteImagesInMarkdown(markdown: string): Promise<string> {
    const text = (markdown || "").trim();
    if (!text) {
      return markdown;
    }

    const imageRegex = /!\[((?:\\.|[^\]])*)\]\((?:<([^>]+)>|(https?:\/\/[^\s)]+))\)/g;
    const replacements = new Map<string, string>();
    const seenUrls = new Set<string>();
    await this.ensureAiImageCacheDirectory();

    let match: RegExpExecArray | null = null;
    while ((match = imageRegex.exec(text)) !== null) {
      const rawUrl = (match[2] || match[3] || "").trim();
      if (!rawUrl) {
        continue;
      }
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        continue;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      if (seenUrls.has(parsed.href)) {
        continue;
      }
      seenUrls.add(parsed.href);
      try {
        const response = await fetch(parsed.href, { method: "GET", redirect: "follow" });
        if (!response.ok) {
          continue;
        }
        const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!this.isSupportedImageMime(contentType)) {
          continue;
        }
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
          continue;
        }
        const ext = this.getImageExtensionFromContentType(contentType);
        const hash = createHash("sha1").update(parsed.href).digest("hex").slice(0, 16);
        const fileName = `${Date.now()}_${hash}.${ext}`;
        const filePath = path.join(this.aiImageCacheDir, fileName);
        const buffer = Buffer.from(arrayBuffer);
        await fs.promises.writeFile(filePath, buffer);
        const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
        replacements.set(parsed.href, dataUrl);
      } catch {
        continue;
      }
    }

    if (!replacements.size) {
      return markdown;
    }

    return text.replace(imageRegex, (full, altText, angleWrappedUrl, plainUrl) => {
      const rawUrl = String(angleWrappedUrl || plainUrl || "").trim();
      const replacement = replacements.get(rawUrl);
      if (!replacement) {
        return full;
      }
      return `![${altText || ""}](<${replacement}>)`;
    });
  }

  private async runSetupFlow(): Promise<{ success: boolean; message: string }> {
    this.postStatus(
      "progress",
      "正在启动登录流程",
      "将打开浏览器执行 Google 账号登录/验证码验证。",
      "完成后返回 VS Code 点击 Retry。"
    );
    this.postMessage({ type: "auth/running" });
    const result = await this.setupRunner.ensureRunning();
    this.postMessage({
      type: "auth/completed",
      success: result.success,
      message: result.message,
    });
    this.postStatus(
      result.success ? "success" : "warning",
      result.success ? "登录流程完成" : "登录流程未完成",
      result.message,
      result.success ? "请点击 Retry 继续当前请求。" : "请再次执行 Run Setup 并完成所有步骤。"
    );
    return {
      success: result.success,
      message: result.message,
    };
  }

  private openBrowserView(): void {
    if (this.setupRunner.isRunning()) {
      this.postStatus(
        "warning",
        "浏览器已在运行",
        "已有一个浏览器窗口正在运行。",
        "请先完成当前浏览器中的操作，或关闭后再试。"
      );
      return;
    }

    this.postStatus(
      "progress",
      "正在打开浏览器",
      "将启动浏览器窗口，您可以自由浏览和操作。",
      "关闭浏览器窗口后将自动保存当前账户状态。"
    );

    void this.setupRunner.ensureRunning("browser").then((result) => {
      this.postStatus(
        result.success ? "success" : "warning",
        result.success ? "浏览器会话已结束" : "浏览器会话异常结束",
        result.message,
        result.success
          ? "认证状态已更新保存，可继续在插件中提问。"
          : "可再次点击\u201c浏览器查看\u201d重试，或执行 Run Setup。"
      );
      if (!result.success) {
        void vscode.window.showWarningMessage(result.message);
      }
    });
  }

  private async openExternalLink(rawHref: string): Promise<void> {
    const href = rawHref.trim();
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(href);
    } catch {
      this.postStatus("warning", "链接无效", "无法解析该来源链接。", "请检查链接格式后重试。");
      return;
    }

    if (uri.scheme !== "http" && uri.scheme !== "https") {
      this.postStatus("warning", "链接被拦截", "仅允许打开 http/https 来源链接。", "请使用网页链接。");
      return;
    }

    try {
      const opened = await vscode.env.openExternal(uri);
      if (opened) {
        this.postStatus("success", "已打开来源链接", uri.toString(), "可在浏览器核实答案来源。");
        return;
      }
      this.postStatus("warning", "链接未打开", "系统未能处理该链接。", "请复制链接后在浏览器手动打开。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postStatus("error", "打开链接失败", message, "请稍后重试，或复制链接到浏览器。");
    }
  }

  private buildImageFileBaseName(rawPath: string): string {
    const fileName = path.basename(rawPath || "").trim();
    if (!fileName) {
      return `huge-ai-image-${Date.now()}`;
    }
    const clean = fileName
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return clean || `huge-ai-image-${Date.now()}`;
  }

  private async downloadExternalImage(rawHref: string): Promise<void> {
    const href = rawHref.trim();
    try {
      let ext = "png";
      let baseName = `huge-ai-image-${Date.now()}`;
      let bytes = new Uint8Array();

      const dataMatch = href.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (dataMatch) {
        const mime = dataMatch[1].toLowerCase();
        if (!this.isSupportedImageMime(mime)) {
          this.postStatus("warning", "下载被拦截", "仅允许下载常见图片格式（png/jpg/webp/gif/bmp）。", undefined);
          return;
        }
        ext = this.getImageExtensionFromContentType(mime);
        bytes = new Uint8Array(Buffer.from(dataMatch[2], "base64"));
      } else {
        let uri: vscode.Uri;
        try {
          uri = vscode.Uri.parse(href);
        } catch {
          this.postStatus("warning", "图片地址无效", "无法解析该图片链接。", "请检查链接格式后重试。");
          return;
        }

        if (uri.scheme !== "http" && uri.scheme !== "https") {
          this.postStatus("warning", "下载被拦截", "仅允许下载 http/https 或 data:image 链接。", "请使用网页图片链接。");
          return;
        }

        this.postStatus("progress", "正在下载图片", uri.toString(), "正在获取图片数据并准备保存。");
        const response = await fetch(uri.toString(), {
          method: "GET",
          redirect: "follow",
        });
        if (!response.ok) {
          throw new Error(`下载失败（HTTP ${response.status}）`);
        }
        const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!this.isSupportedImageMime(contentType)) {
          throw new Error(`不支持的图片类型: ${contentType || "unknown"}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
          throw new Error("图片内容为空");
        }
        bytes = new Uint8Array(arrayBuffer);
        ext = this.getImageExtensionFromContentType(contentType);
        baseName = this.buildImageFileBaseName(uri.path);
      }

      const normalizedBaseName = baseName.includes(".") ? baseName.replace(/\.[^.]+$/, "") : baseName;
      const suggestedName = `${normalizedBaseName}.${ext}`;
      const saveUri = await vscode.window.showSaveDialog({
        saveLabel: "保存图片",
        defaultUri: vscode.Uri.file(path.join(os.homedir(), "Downloads", suggestedName)),
        filters: {
          Images: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
          All: ["*"],
        },
      });

      if (!saveUri) {
        this.postStatus("idle", "已取消保存", "图片下载已取消。", undefined);
        return;
      }

      await vscode.workspace.fs.writeFile(saveUri, bytes);
      this.postStatus("success", "图片已保存", saveUri.fsPath, "可在本地直接查看或继续编辑。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postStatus(
        "error",
        "图片下载失败",
        message,
        "你可以先点击图片链接在浏览器打开，再手动另存为。"
      );
    }
  }

  private buildExportFileStamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "-",
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join("");
  }

  private sanitizeExportFileName(rawTitle: string): string {
    const compact = (rawTitle || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!compact) {
      return "huge-ai-chat";
    }
    return compact.slice(0, 48);
  }

  private getExportRootUri(): vscode.Uri {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceRoot) {
      return vscode.Uri.joinPath(workspaceRoot, "docs", "huge-ai-chat-exports");
    }
    if (this.context.globalStorageUri) {
      return vscode.Uri.joinPath(this.context.globalStorageUri, "exports");
    }
    return vscode.Uri.joinPath(this.context.extensionUri, ".huge-ai-chat-exports");
  }

  private async exportThreadMarkdown(
    threadId: string,
    title: string,
    markdown: string
  ): Promise<void> {
    const content = markdown.trim();
    if (!content) {
      this.postStatus(
        "warning",
        "导出失败",
        "当前线程内容为空，无法导出 Markdown 文件。",
        "请先发送至少一条消息后再导出。",
        threadId
      );
      return;
    }

    const exportRoot = this.getExportRootUri();
    const fileName = `${this.sanitizeExportFileName(title)}-${this.buildExportFileStamp()}.md`;
    const fileUri = vscode.Uri.joinPath(exportRoot, fileName);

    try {
      await vscode.workspace.fs.createDirectory(exportRoot);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));

      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });

      this.postStatus(
        "success",
        "Markdown 已导出",
        fileUri.fsPath,
        "文件已在编辑器中打开并聚焦，可直接继续编辑。",
        threadId
      );
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.postStatus(
        "error",
        "导出失败",
        errorText,
        "请检查工作区目录权限后重试。",
        threadId
      );
      void vscode.window.showErrorMessage(`导出 Markdown 失败：${errorText}`);
    }
  }

  private async waitForMcpWarmupBeforeSend(threadId: string): Promise<boolean> {
    if (this.mcpManager.isConnected()) {
      return true;
    }

    this.postStatus(
      "progress",
      "正在等待搜索服务就绪",
      "首条消息会优先等待 MCP 预热连接完成。",
      "若预热超时，将自动降级为直接请求并触发重连。",
      threadId
    );

    const task = this.ensureMcpWarmup();
    try {
      const result = await withTimeout(
        task,
        MCP_WARMUP_WAIT_MS,
        `搜索服务预热超时（>${Math.floor(MCP_WARMUP_WAIT_MS / 1000)} 秒）`
      );
      if (result.ready) {
        return true;
      }
      this.postStatus(
        "warning",
        "搜索服务预热未完成",
        result.detail,
        "将继续直接请求，并由连接层执行自动重连。",
        threadId
      );
      return false;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.postStatus(
        "warning",
        "搜索服务预热超时",
        detail,
        "将继续直接请求，并由连接层执行自动重连。",
        threadId
      );
      return false;
    }
  }

  private ensureMcpWarmup(): Promise<McpWarmupResult> {
    if (this.warmupTask) {
      return this.warmupTask;
    }

    const task = (async () => {
      // 静默预热：不立即设置 progress 状态，避免启动时蓝点。
      // 预热完成或失败后才更新状态。
      const result = await this.mcpManager.warmup();
      if (result.ready) {
        this.postStatus("success", "搜索服务已就绪", result.detail, result.suggestion);
        return result;
      }

      this.postStatus("warning", "搜索服务暂未就绪", result.detail, result.suggestion);
      return result;
    })().finally(() => {
      if (this.warmupTask === task) {
        this.warmupTask = null;
      }
    });

    this.warmupTask = task;
    return task;
  }

  private postStateFull(): void {
    this.postMessage({
      type: "state/full",
      state: this.store.getState(),
    });
  }

  private postStateUpdated(options?: StateUpdateOptions): void {
    this.postMessage({
      type: "state/updated",
      patch: this.store.getStatePatch(options),
    });
  }

  private postStatus(
    kind: ChatStatusKind,
    title: string,
    detail?: string,
    suggestion?: string,
    threadId?: string
  ): void {
    this.postMessage({
      type: "chat/status",
      status: {
        kind,
        title,
        detail,
        suggestion,
        threadId,
        at: Date.now(),
      },
    });
  }

  private postMessage(message: HostToPanelMessage): void {
    if (this.panel) {
      void this.panel.webview.postMessage(message);
    }
    if (this.sidebarWebview) {
      void this.sidebarWebview.postMessage(message);
    }
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const templatePath = path.join(this.context.extensionUri.fsPath, "media", "index.html");
    let template = "";
    try {
      template = fs.readFileSync(templatePath, "utf8");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[Webview] Failed to load template: ${errorText}`);
      template = "<html><body><h3>Failed to load webview template.</h3></body></html>";
    }

    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"));

    return template
      .replaceAll("{{cspSource}}", webview.cspSource)
      .replaceAll("{{nonce}}", nonce)
      .replaceAll("{{scriptUri}}", scriptUri.toString())
      .replaceAll("{{styleUri}}", styleUri.toString());
  }

  private isPanelToHostMessage(payload: unknown): payload is PanelToHostMessage {
    return isValidPanelToHostMessage(payload);
  }
}
