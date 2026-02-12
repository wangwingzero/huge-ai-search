import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { SetupRunner } from "../auth/SetupRunner";
import { McpClientManager } from "../mcp/McpClientManager";
import { ThreadStore } from "./ThreadStore";
import { isAuthRelatedError, parseSearchToolText } from "./responseFormatter";
import {
  ChatStatusKind,
  HostToPanelMessage,
  PanelToHostMessage,
  SearchLanguage,
} from "./types";

const SEARCH_REQUEST_TIMEOUT_MS = 120_000;
const FIXED_CHAT_LANGUAGE: SearchLanguage = "zh-CN";

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

function isValidPanelToHostMessage(payload: unknown): payload is PanelToHostMessage {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as {
    type?: unknown;
    threadId?: unknown;
    text?: unknown;
    language?: unknown;
    href?: unknown;
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
    case "thread/switch":
    case "thread/delete":
    case "chat/retryLast":
      return typeof candidate.threadId === "string";
    case "link/open":
      return typeof candidate.href === "string";
    case "chat/send":
      return (
        typeof candidate.threadId === "string" &&
        typeof candidate.text === "string" &&
        (candidate.language === undefined || isSearchLanguage(candidate.language))
      );
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ThreadStore,
    private readonly mcpManager: McpClientManager,
    private readonly setupRunner: SetupRunner,
    private readonly output: vscode.OutputChannel
  ) {}

  async openChatPanel(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.postStateUpdated();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "hugeAiChat.panel",
      "Huge AI Chat",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );

    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
    this.installPanelListeners(this.panel);
    this.postStateFull();
    this.ensureMcpWarmup();
  }

  async createThreadFromCommand(): Promise<void> {
    await this.openChatPanel();
    await this.store.createThread(FIXED_CHAT_LANGUAGE);
    this.postStateUpdated();
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
        await this.store.createThread(FIXED_CHAT_LANGUAGE);
        this.postStateUpdated();
        return;
      }
      case "thread/clearAll":
        await this.store.clearHistory();
        this.postStateUpdated();
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
        await this.sendMessage(payload.threadId, payload.text);
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
    const fallback = [...(thread?.messages || [])].reverse().find((message) => message.role === "user");
    if (!fallback) {
      void vscode.window.showWarningMessage("没有可重试的问题。");
      return;
    }
    await this.sendMessage(threadId, fallback.content);
  }

  private async sendMessage(
    threadId: string,
    rawText: string
  ): Promise<void> {
    const text = rawText.trim();
    if (!text) {
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

    if (thread.language !== FIXED_CHAT_LANGUAGE) {
      await this.store.setThreadLanguage(threadId, FIXED_CHAT_LANGUAGE);
    }

    this.pendingThreads.add(threadId);
    this.lastQueryByThread.set(threadId, text);

    const userMessage = await this.store.addMessage(threadId, "user", text, "done");
    const pendingMessage = await this.store.addMessage(
      threadId,
      "assistant",
      "正在调用 Google AI 搜索，请稍候...",
      "pending"
    );
    if (!userMessage || !pendingMessage) {
      this.pendingThreads.delete(threadId);
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
      "正在准备调用 Google AI 搜索服务。",
      "可在下方继续输入，当前请求完成后再发送下一条。",
      threadId
    );

    try {
      const latestThread = this.store.getThread(threadId);
      if (!latestThread) {
        throw new Error("线程不存在。");
      }

      this.postStatus(
        "progress",
        "正在调用搜索服务",
        Boolean(latestThread.sessionId) ? "当前为追问模式，将复用历史会话上下文。" : "当前为新会话，将创建新的搜索会话。",
        "如果长时间无响应，可执行 “Huge AI Chat: Run Login Setup”。",
        threadId
      );
      this.output.appendLine(`[Chat] Search start: thread=${threadId}, follow_up=${Boolean(latestThread.sessionId)}`);
      const resultText = await withTimeout(
        this.mcpManager.callSearch({
          query: text,
          language: FIXED_CHAT_LANGUAGE,
          follow_up: Boolean(latestThread.sessionId),
          session_id: latestThread.sessionId,
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

      const message = await this.store.updateMessage(threadId, pendingMessage.id, {
        content: parsed.renderedMarkdown,
        status: "done",
      });
      this.postStateUpdated();
      this.postMessage({
        type: "chat/answer",
        threadId,
        message: message || { ...pendingMessage, content: parsed.renderedMarkdown, status: "done" },
      });
      this.postStatus(
        "success",
        "回答已生成",
        parsed.sessionId ? `会话已更新：${parsed.sessionId}` : "本次回答已完成。",
        "可以继续追问，系统会自动保持上下文。",
        threadId
      );
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
