import * as vscode from "vscode";
import { SetupRunner } from "./auth/SetupRunner";
import { ChatController } from "./chat/ChatController";
import { ThreadStore } from "./chat/ThreadStore";
import { SearchLanguage } from "./chat/types";
import { McpClientManager } from "./mcp/McpClientManager";

let controller: ChatController | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Huge AI Chat");
  context.subscriptions.push(output);

  const maxThreads = vscode.workspace.getConfiguration("hugeAiChat").get<number>("maxThreads", 50);
  const defaultLanguage: SearchLanguage = "zh-CN";

  const store = new ThreadStore(context, maxThreads, defaultLanguage);
  const mcpManager = new McpClientManager(context, output);
  const setupRunner = new SetupRunner(output);

  controller = new ChatController(context, store, mcpManager, setupRunner, output);
  context.subscriptions.push(controller);

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
}

export async function deactivate(): Promise<void> {
  if (!controller) {
    return;
  }
  await controller.shutdown();
  controller = null;
}
