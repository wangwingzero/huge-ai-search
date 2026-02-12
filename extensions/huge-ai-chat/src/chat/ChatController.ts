import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { SetupRunner } from "../auth/SetupRunner";
import { McpClientManager } from "../mcp/McpClientManager";
import { ThreadStore } from "./ThreadStore";
import { isAuthRelatedError, parseSearchToolText } from "./responseFormatter";
import {
  HostToPanelMessage,
  PanelToHostMessage,
  SearchLanguage,
} from "./types";

function getNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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
  };

  if (typeof candidate.type !== "string") {
    return false;
  }

  switch (candidate.type) {
    case "panel/ready":
    case "thread/clearAll":
    case "auth/runSetup":
      return true;
    case "thread/create":
      return candidate.language === undefined || isSearchLanguage(candidate.language);
    case "thread/switch":
    case "thread/delete":
    case "chat/retryLast":
      return typeof candidate.threadId === "string";
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
  }

  async createThreadFromCommand(): Promise<void> {
    await this.openChatPanel();
    await this.store.createThread(this.getDefaultLanguage());
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
        return;
      case "thread/create": {
        const language = isSearchLanguage(payload.language)
          ? payload.language
          : this.getDefaultLanguage();
        await this.store.createThread(language);
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
        await this.sendMessage(payload.threadId, payload.text, payload.language);
        return;
      case "chat/retryLast":
        await this.retryLast(payload.threadId);
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
    rawText: string,
    languageFromPanel?: SearchLanguage
  ): Promise<void> {
    const text = rawText.trim();
    if (!text) {
      return;
    }
    if (this.pendingThreads.has(threadId)) {
      void vscode.window.showInformationMessage("当前线程仍在处理中，请稍候。");
      return;
    }

    const thread = this.store.getThread(threadId);
    if (!thread) {
      return;
    }

    if (isSearchLanguage(languageFromPanel) && languageFromPanel !== thread.language) {
      await this.store.setThreadLanguage(threadId, languageFromPanel);
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

    try {
      const latestThread = this.store.getThread(threadId);
      if (!latestThread) {
        throw new Error("线程不存在。");
      }

      const resultText = await this.mcpManager.callSearch({
        query: text,
        language: latestThread.language,
        follow_up: Boolean(latestThread.sessionId),
        session_id: latestThread.sessionId,
      });

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

      if (isAuthRelatedError(errorText)) {
        await this.runSetupFlow();
      }
    } finally {
      this.pendingThreads.delete(threadId);
    }
  }

  private async runSetupFlow(): Promise<{ success: boolean; message: string }> {
    this.postMessage({ type: "auth/running" });
    const result = await this.setupRunner.ensureRunning();
    this.postMessage({
      type: "auth/completed",
      success: result.success,
      message: result.message,
    });
    return {
      success: result.success,
      message: result.message,
    };
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

  private postMessage(message: HostToPanelMessage): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private getDefaultLanguage(): SearchLanguage {
    const configured = vscode.workspace
      .getConfiguration("hugeAiChat")
      .get<string>("defaultLanguage", "zh-CN");
    if (isSearchLanguage(configured)) {
      return configured;
    }
    return "zh-CN";
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
