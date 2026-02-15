import * as vscode from "vscode";
import { SetupRunner } from "./auth/SetupRunner";
import { ChatController } from "./chat/ChatController";
import { ThreadStore } from "./chat/ThreadStore";
import { SearchLanguage } from "./chat/types";
import { McpClientManager } from "./mcp/McpClientManager";

let controller: ChatController | null = null;

class HugeSidebarViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly controller: ChatController) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.controller.attachSidebarView(webviewView);
  }
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

function getSelectedTextFromEditor(editor: vscode.TextEditor): string {
  const pieces = editor.selections
    .map((selection) => editor.document.getText(selection).trim())
    .filter((item) => item.length > 0);
  return pieces.join("\n\n");
}

function getNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function getEditDialogHtml(webview: vscode.Webview, nonce: string, initialText: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>发送到 Huge</title>
  <style>
    body {
      margin: 0;
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
    .wrap {
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: calc(100vh - 24px);
      min-height: 240px;
    }
    .title {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }
    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin: 0;
    }
    textarea {
      flex: 1;
      min-height: 160px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 10px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.45;
      box-sizing: border-box;
    }
    .foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .count {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button {
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 0 12px;
      cursor: pointer;
      font-family: inherit;
    }
    .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1 class="title">发送到 Huge</h1>
    <p class="hint">内容已预填，可编辑后点击“确认发送”。快捷键：Ctrl/Cmd + Enter</p>
    <textarea id="draftInput" spellcheck="false"></textarea>
    <div class="foot">
      <span id="charCount" class="count"></span>
      <div class="actions">
        <button id="cancelBtn" class="secondary" type="button">取消</button>
        <button id="confirmBtn" class="primary" type="button">确认发送</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const textarea = document.getElementById("draftInput");
      const count = document.getElementById("charCount");
      const confirmBtn = document.getElementById("confirmBtn");
      const cancelBtn = document.getElementById("cancelBtn");
      const initialText = ${JSON.stringify(initialText)};

      textarea.value = String(initialText || "");

      function updateState() {
        const value = textarea.value || "";
        const trimmed = value.trim();
        count.textContent = \`\${value.length} 字符\`;
        confirmBtn.disabled = trimmed.length === 0;
      }

      function confirm() {
        vscode.postMessage({
          type: "confirm",
          text: textarea.value || ""
        });
      }

      function cancel() {
        vscode.postMessage({ type: "cancel" });
      }

      confirmBtn.addEventListener("click", confirm);
      cancelBtn.addEventListener("click", cancel);
      textarea.addEventListener("input", updateState);
      textarea.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          confirm();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      });

      updateState();
      textarea.focus();
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
    })();
  </script>
</body>
</html>`;
}

async function promptSelectionDraft(
  context: vscode.ExtensionContext,
  initialText: string
): Promise<string | undefined> {
  const panel = vscode.window.createWebviewPanel(
    "hugeAiChat.selectionEditor",
    "发送到 Huge",
    {
      viewColumn: vscode.ViewColumn.Active,
      preserveFocus: false,
    },
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [context.extensionUri],
    }
  );

  const nonce = getNonce();
  panel.webview.html = getEditDialogHtml(panel.webview, nonce, initialText);

  return await new Promise<string | undefined>((resolve) => {
    let done = false;

    const finish = (value: string | undefined) => {
      if (done) {
        return;
      }
      done = true;
      resolve(value);
      panel.dispose();
    };

    const messageDisposable = panel.webview.onDidReceiveMessage((payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const message = payload as { type?: unknown; text?: unknown };
      if (message.type === "confirm") {
        const text = typeof message.text === "string" ? message.text : "";
        finish(text);
        return;
      }
      if (message.type === "cancel") {
        finish(undefined);
      }
    });

    const closeDisposable = panel.onDidDispose(() => {
      if (!done) {
        done = true;
        resolve(undefined);
      }
      messageDisposable.dispose();
      closeDisposable.dispose();
    });
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("HUGE");
  context.subscriptions.push(output);

  const maxThreads = 50;
  const defaultLanguage: SearchLanguage = "en-US";

  const store = new ThreadStore(context, maxThreads, defaultLanguage);
  const mcpManager = new McpClientManager(context, output);
  const setupRunner = new SetupRunner(output);

  controller = new ChatController(context, store, mcpManager, setupRunner, output);
  context.subscriptions.push(controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "hugeAiChat.home",
      new HugeSidebarViewProvider(controller),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hugeAiChat.openChat", async () => {
      if (!controller) {
        return;
      }
      await controller.openChatPanel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hugeAiChat.newThread", async () => {
      if (!controller) {
        return;
      }
      await controller.createThreadFromCommand();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hugeAiChat.runSetup", async () => {
      if (!controller) {
        return;
      }
      await controller.runSetupFromCommand();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hugeAiChat.clearHistory", async () => {
      if (!controller) {
        return;
      }
      await controller.clearHistoryFromCommand();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hugeAiChat.sendSelectionToHuge", async () => {
      if (!controller) {
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage("当前没有活动编辑器，无法发送选中文本。");
        return;
      }

      const selectedText = getSelectedTextFromEditor(editor);
      if (!selectedText) {
        void vscode.window.showWarningMessage("请先选中要发送到 Huge 的文本。");
        return;
      }

      const draft = await promptSelectionDraft(context, selectedText);
      if (typeof draft !== "string") {
        return;
      }

      const text = draft.trim();
      if (!text) {
        void vscode.window.showWarningMessage("发送内容为空，已取消发送。");
        return;
      }

      await controller.sendSelectionToNewThread(text);
    })
  );
}

export async function deactivate(): Promise<void> {
  if (!controller) {
    return;
  }
  await controller.shutdown();
  controller = null;
}
