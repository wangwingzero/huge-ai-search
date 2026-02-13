import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { SetupRunner } from "../auth/SetupRunner";
import { McpClientManager } from "../mcp/McpClientManager";
import { ThreadStore } from "./ThreadStore";
import { isAuthRelatedError, isNoRecordResponseText, parseSearchToolText } from "./responseFormatter";
import {
  ChatStatusKind,
  HostToPanelMessage,
  PanelToHostMessage,
  SearchLanguage,
} from "./types";

const SEARCH_REQUEST_TIMEOUT_MS = 120_000;
const MAX_PASTED_IMAGE_BYTES = 15 * 1024 * 1024;
const TEMP_IMAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const TEMP_IMAGE_CLEANUP_DELAY_MS = 10 * 60 * 1000;
const TEMP_IMAGE_DIR_NAME = "huge-ai-chat-images";
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

interface ParsedDataUrlImage {
  mimeType: string;
  buffer: Buffer;
  extension: string;
}

interface PersistedImageFile {
  filePath: string;
  byteLength: number;
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

function hasAuthoritativeSource(sources: Array<{ url: string }>): boolean {
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

      return false;
    } catch {
      return false;
    }
  });
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
      return (
        typeof candidate.threadId === "string" &&
        typeof candidate.text === "string" &&
        (candidate.language === undefined || isSearchLanguage(candidate.language)) &&
        validImageData &&
        validImageCount
      );
    }
    default:
      return false;
  }
}

export class ChatController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];
  private readonly pendingThreads = new Set<string>();
  private readonly lastQueryByThread = new Map<string, string>();
  private warmupTask: Promise<void> | null = null;
  private readonly tempImageDir = path.join(os.tmpdir(), TEMP_IMAGE_DIR_NAME);
  private tempImageDirPrepared = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ThreadStore,
    private readonly mcpManager: McpClientManager,
    private readonly setupRunner: SetupRunner,
    private readonly output: vscode.OutputChannel
  ) {}

  private getConfiguredDefaultLanguage(): SearchLanguage {
    const configured = vscode.workspace
      .getConfiguration("hugeAiChat")
      .get<string>("defaultLanguage", "zh-CN");
    return isSearchLanguage(configured) ? configured : "zh-CN";
  }

  private isStrictGroundingEnabled(): boolean {
    const configuredEnv = vscode.workspace
      .getConfiguration("hugeAiChat")
      .get<Record<string, string>>("mcp.env", {});
    const configuredFlag = configuredEnv?.HUGE_AI_SEARCH_STRICT_GROUNDING;
    if (typeof configuredFlag === "string" && configuredFlag.trim().length > 0) {
      return configuredFlag.trim() !== "0";
    }

    const processFlag = process.env.HUGE_AI_SEARCH_STRICT_GROUNDING;
    if (typeof processFlag === "string" && processFlag.trim().length > 0) {
      return processFlag.trim() !== "0";
    }

    return true;
  }

  private shouldForceNoRecord(
    query: string,
    sources: Array<{ url: string }>,
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
    return !hasAuthoritativeSource(sources);
  }

  private buildNoRecordMarkdown(): string {
    return `${NO_RECORD_MESSAGE}\n\n${NO_RECORD_DISCLAIMER}`;
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
    this.ensureMcpWarmup();
  }

  async createThreadFromCommand(): Promise<void> {
    await this.openChatPanel();
    await this.store.createThread(this.getConfiguredDefaultLanguage());
    this.postStateUpdated();
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
    this.postStateUpdated();
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

    await this.store.clearHistory();
    this.postStateUpdated();
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
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
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

  private async handlePanelMessage(payload: unknown): Promise<void> {
    if (!this.isPanelToHostMessage(payload)) {
      return;
    }

    switch (payload.type) {
      case "panel/ready":
        this.postStateFull();
        this.ensureMcpWarmup();
        return;
      case "browser/open":
        this.openBrowserView();
        return;
      case "thread/create": {
        const language =
          payload.language && isSearchLanguage(payload.language)
            ? payload.language
            : this.getConfiguredDefaultLanguage();
        await this.store.createThread(language);
        this.postStateUpdated();
        return;
      }
      case "thread/exportMarkdown":
        await this.exportThreadMarkdown(payload.threadId, payload.title, payload.markdown);
        return;
      case "thread/clearAll":
        await this.store.clearHistory();
        this.pendingThreads.clear();
        this.lastQueryByThread.clear();
        this.postStateUpdated();
        this.postStatus(
          "success",
          "历史已清空",
          "所有线程和会话记录已移除。",
          "点击新聊天开始新的提问。"
        );
        return;
      case "thread/switch":
        await this.store.switchThread(payload.threadId);
        this.postStateUpdated();
        return;
      case "thread/delete":
        await this.store.deleteThread(payload.threadId);
        this.postStateUpdated();
        return;
      case "chat/send":
        await this.sendMessage(
          payload.threadId,
          payload.text,
          payload.imageDataUrl,
          payload.imageCount,
          payload.language
        );
        return;
      case "chat/retryLast":
        await this.retryLast(payload.threadId);
        return;
      case "link/open":
        await this.openExternalLink(payload.href);
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
          message.role === "user" && !message.content.trim().startsWith("[附图]")
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
    language?: SearchLanguage
  ): Promise<void> {
    const text = rawText.trim();
    const normalizedImageDataUrl =
      typeof imageDataUrl === "string" && imageDataUrl.trim().length > 0
        ? imageDataUrl.trim()
        : undefined;
    const normalizedImageCount = normalizedImageDataUrl
      ? Math.max(1, Math.min(32, Math.floor(imageCount || 1)))
      : 0;
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

    let persistedImage: PersistedImageFile | null = null;
    if (normalizedImageDataUrl) {
      try {
        persistedImage = await this.persistImageAttachment(normalizedImageDataUrl);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        this.pendingThreads.delete(threadId);
        this.postStatus(
          "error",
          "图片处理失败",
          errorText,
          "请重新截图后粘贴，或改用较小尺寸图片。",
          threadId
        );
        void vscode.window.showErrorMessage(errorText);
        return;
      }
    }

    const userText = this.buildUserMessageContent(text, normalizedImageCount);

    const userMessage = await this.store.addMessage(threadId, "user", userText, "done");
    const pendingMessage = await this.store.addMessage(
      threadId,
      "assistant",
      persistedImage
        ? "正在调用 Google AI 搜索并上传截图，请稍候..."
        : "正在调用 Google AI 搜索，请稍候...",
      "pending"
    );
    if (!userMessage || !pendingMessage) {
      this.pendingThreads.delete(threadId);
      if (persistedImage) {
        this.scheduleTempImageCleanup(persistedImage.filePath);
      }
      return;
    }

    this.postStateUpdated();
    this.postMessage({
      type: "chat/pending",
      threadId,
      messageId: pendingMessage.id,
    });
    this.postStatus(
      "progress",
      "请求已提交",
      persistedImage
        ? `正在准备调用 Google AI 搜索服务（附带 ${normalizedImageCount} 张截图${normalizedImageCount > 1 ? "，已自动合并" : ""}）。`
        : "正在准备调用 Google AI 搜索服务。",
      "可在下方继续输入，当前请求完成后再发送下一条。",
      threadId
    );

    try {
      const latestThread = this.store.getThread(threadId);
      if (!latestThread) {
        throw new Error("线程不存在。");
      }

      const useFollowUp = Boolean(latestThread.sessionId) && !persistedImage;
      this.postStatus(
        "progress",
        "正在调用搜索服务",
        useFollowUp
          ? "当前为追问模式，将复用历史会话上下文。"
          : persistedImage
            ? "检测到截图输入，本次将使用新请求并上传图片。"
            : "当前为新会话，将创建新的搜索会话。",
        "如果长时间无响应，可执行 “Huge AI Chat: Run Login Setup”。",
        threadId
      );
      this.output.appendLine(
        `[Chat] Search start: thread=${threadId}, follow_up=${useFollowUp}, has_image=${Boolean(persistedImage)}`
      );
      const resultText = await withTimeout(
        this.mcpManager.callSearch({
          query: text,
          language: targetLanguage,
          follow_up: useFollowUp,
          session_id: useFollowUp ? latestThread.sessionId : undefined,
          image_path: persistedImage?.filePath,
        }),
        SEARCH_REQUEST_TIMEOUT_MS,
        `请求超时（${Math.floor(SEARCH_REQUEST_TIMEOUT_MS / 1000)} 秒），请重试或先执行 “Huge AI Chat: Run Login Setup”。`
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
        this.postStateUpdated();
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
        useFollowUp,
        Boolean(persistedImage)
      );
      const finalNoRecord = serverReturnedNoRecord || forceNoRecord;
      const finalMarkdown = finalNoRecord
        ? this.buildNoRecordMarkdown()
        : parsed.renderedMarkdown;

      if (forceNoRecord && !serverReturnedNoRecord) {
        this.output.appendLine(
          `[Chat] Strict grounding forced no-record: thread=${threadId}, query=${text}`
        );
      }

      const message = await this.store.updateMessage(threadId, pendingMessage.id, {
        content: finalMarkdown,
        status: "done",
      });
      this.postStateUpdated();
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
      this.postStateUpdated();
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

  private buildUserMessageContent(text: string, imageCount: number): string {
    if (imageCount <= 0) {
      return text;
    }
    const imageLabel = `[附图] ${imageCount} 张${imageCount > 1 ? "（已合并）" : ""}`;
    if (!text) {
      return imageLabel;
    }
    return `${text}\n\n${imageLabel}`;
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
        "已有一个 Playwright 浏览器窗口正在使用中。",
        "请先完成当前浏览器中的操作，或关闭后再试。"
      );
      return;
    }

    this.postStatus(
      "progress",
      "正在打开浏览器",
      "将启动与验证码流程相同的 Playwright 浏览器窗口。",
      "你可以在浏览器中直接对话，登录状态会自动持久化。"
    );

    void this.setupRunner.ensureRunning("browser").then((result) => {
      this.postStatus(
        result.success ? "success" : "warning",
        result.success ? "浏览器会话已结束" : "浏览器会话异常结束",
        result.message,
        result.success
          ? "登录状态已持久化，可继续在插件中提问。"
          : "可再次点击“浏览器查看”重试，或执行 Run Setup。"
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

  private ensureMcpWarmup(): void {
    if (this.warmupTask) {
      return;
    }

    this.warmupTask = (async () => {
      this.postStatus(
        "progress",
        "正在准备搜索服务",
        "首次会自动连接 MCP 搜索服务，可能需要几秒。",
        "无需手动安装 huge-ai-search MCP；连接完成后即可直接提问。"
      );

      const result = await this.mcpManager.warmup();
      if (result.ready) {
        this.postStatus("success", "搜索服务已就绪", result.detail, result.suggestion);
        return;
      }

      this.postStatus("warning", "搜索服务暂未就绪", result.detail, result.suggestion);
    })().finally(() => {
      this.warmupTask = null;
    });
  }

  private postStateFull(): void {
    this.postMessage({
      type: "state/full",
      state: this.store.getState(),
    });
  }

  private postStateUpdated(): void {
    this.postMessage({
      type: "state/updated",
      state: this.store.getState(),
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
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage(message);
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
