import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { SearchLanguage } from "../chat/types";

export interface SearchToolArgs {
  query: string;
  language: SearchLanguage;
  follow_up: boolean;
  session_id?: string;
  image_path?: string;
}

export interface McpWarmupResult {
  ready: boolean;
  detail: string;
  suggestion?: string;
}

interface ResolvedServerCommand {
  command: string;
  args: string[];
  cwd?: string;
  source: "configured" | "development" | "npx-auto";
}

function getSanitizedEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      env[key] = value;
    }
  }
  return env;
}

export class McpClientManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private stderrHooked = false;
  private lastResolvedCommand: ResolvedServerCommand | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  async callSearch(args: SearchToolArgs): Promise<string> {
    try {
      return await this.callSearchOnce(args);
    } catch (firstError) {
      this.log(`[MCP] 首次调用失败，将尝试重连后重试: ${this.getErrorMessage(firstError)}`);
      if (!this.shouldRetry(firstError)) {
        throw this.toUserFacingError(firstError);
      }
      await this.disconnect();
      try {
        return await this.callSearchOnce(args);
      } catch (retryError) {
        throw this.toUserFacingError(retryError);
      }
    }
  }

  async warmup(): Promise<McpWarmupResult> {
    try {
      await this.ensureConnected();
      const resolved = this.lastResolvedCommand ?? this.resolveServerCommand();
      const commandText = this.toCommandLine(resolved);
      const modeLabel = this.getModeLabel(resolved.source);
      return {
        ready: true,
        detail: `已连接搜索服务（${modeLabel}）：${commandText}`,
        suggestion:
          resolved.source === "npx-auto"
            ? "无需手动安装 MCP；首次可能稍慢，后续会复用连接。"
            : "现在可以直接发送问题，系统会复用当前连接。",
      };
    } catch (error) {
      await this.disconnect();
      return {
        ready: false,
        detail: this.toUserFacingError(error).message,
        suggestion:
          "可继续打开聊天界面；发送消息时会再次尝试连接。若持续失败，请检查 Node/npm、网络代理，或在设置中覆盖 hugeAiChat.mcp.command。",
      };
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect();
  }

  private async callSearchOnce(args: SearchToolArgs): Promise<string> {
    await this.ensureConnected();
    if (!this.client) {
      throw new Error("MCP 客户端未连接。");
    }

    const result = await this.client.callTool(
      {
        name: "search",
        arguments: args as unknown as Record<string, unknown>,
      },
      CallToolResultSchema
    );

    const text = this.extractTextFromToolResult(result);
    if (!text) {
      throw new Error("MCP 搜索返回了空响应。");
    }
    return text;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client && this.transport) {
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connectInternal().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private async connectInternal(): Promise<void> {
    const resolved = this.resolveServerCommand();
    this.lastResolvedCommand = resolved;
    const settings = vscode.workspace.getConfiguration("hugeAiChat");
    const extraEnv = settings.get<Record<string, string>>("mcp.env") || {};

    const serverParams: StdioServerParameters = {
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: getSanitizedEnv(extraEnv),
      stderr: "pipe",
    };

    this.log(
      `[MCP] Connecting with command: ${serverParams.command} ${(serverParams.args || []).join(" ")}`
    );
    if (serverParams.cwd) {
      this.log(`[MCP] CWD: ${serverParams.cwd}`);
    }

    const transport = new StdioClientTransport(serverParams);
    this.hookTransportStderr(transport);

    const client = new Client(
      {
        name: "huge-ai-chat",
        version: "0.1.0",
      },
      { capabilities: {} }
    );

    client.onerror = (error: Error) => {
      this.log(`[MCP] Client error: ${error.message}`);
    };

    client.onclose = () => {
      this.log("[MCP] Client closed.");
      this.client = null;
      this.transport = null;
    };

    await client.connect(transport);

    this.client = client;
    this.transport = transport;
    this.log("[MCP] Connected.");
  }

  private async disconnect(): Promise<void> {
    if (!this.transport) {
      this.client = null;
      return;
    }

    const currentTransport = this.transport;
    this.transport = null;
    this.client = null;
    this.stderrHooked = false;

    try {
      await currentTransport.close();
      this.log("[MCP] Transport closed.");
    } catch (error) {
      this.log(`[MCP] Transport close failed: ${this.getErrorMessage(error)}`);
    }
  }

  private hookTransportStderr(transport: StdioClientTransport): void {
    if (this.stderrHooked) {
      return;
    }
    const stderr = transport.stderr;
    if (!stderr) {
      return;
    }
    stderr.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.output.append(text);
    });
    this.stderrHooked = true;
  }

  private extractTextFromToolResult(result: unknown): string {
    if (!result || typeof result !== "object") {
      return "";
    }

    const value = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    const parts: string[] = [];

    if (Array.isArray(value.content)) {
      for (const item of value.content) {
        if (item.type === "text" && typeof item.text === "string") {
          parts.push(item.text);
        }
      }
    }

    if (parts.length > 0) {
      return parts.join("\n\n").trim();
    }

    if (value.isError) {
      return "MCP 工具调用失败，但未返回文本错误信息。";
    }

    return "";
  }

  private resolveServerCommand(): ResolvedServerCommand {
    const config = vscode.workspace.getConfiguration("hugeAiChat");
    const configuredCommand = (config.get<string>("mcp.command") || "").trim();
    const configuredArgs = (config.get<string[]>("mcp.args") || []).filter(
      (item) => typeof item === "string" && item.trim().length > 0
    );
    const configuredCwd = (config.get<string>("mcp.cwd") || "").trim();

    if (configuredCommand) {
      return {
        command: configuredCommand,
        args: configuredArgs,
        cwd: configuredCwd || undefined,
        source: "configured",
      };
    }

    if (this.context.extensionMode === vscode.ExtensionMode.Development) {
      const localEntry = this.findLocalServerEntry();
      if (localEntry) {
        return {
          command: "node",
          args: [localEntry],
          cwd: path.dirname(path.dirname(localEntry)),
          source: "development",
        };
      }
    }

    if (process.platform === "win32") {
      return {
        command: "cmd",
        args: ["/c", "npx", "-y", "huge-ai-search@latest"],
        cwd: configuredCwd || undefined,
        source: "npx-auto",
      };
    }

    return {
      command: "npx",
      args: ["-y", "huge-ai-search@latest"],
      cwd: configuredCwd || undefined,
      source: "npx-auto",
    };
  }

  private findLocalServerEntry(): string | null {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const extensionRoot = this.context.extensionUri.fsPath;

    const candidates = [
      path.resolve(extensionRoot, "..", "..", "dist", "index.js"),
      workspaceRoot ? path.resolve(workspaceRoot, "dist", "index.js") : null,
      path.resolve(process.cwd(), "dist", "index.js"),
    ].filter((item): item is string => Boolean(item));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.log(`[MCP] Development mode: use local server ${candidate}`);
        return candidate;
      }
    }

    return null;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private toCommandLine(resolved: ResolvedServerCommand): string {
    return `${resolved.command} ${(resolved.args || []).join(" ")}`.trim();
  }

  private getModeLabel(source: ResolvedServerCommand["source"]): string {
    switch (source) {
      case "configured":
        return "用户自定义";
      case "development":
        return "开发本地服务";
      case "npx-auto":
      default:
        return "自动 npx";
    }
  }

  private shouldRetry(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();
    if (
      message.includes("enoent") ||
      message.includes("command not found") ||
      message.includes("not recognized as an internal or external command") ||
      message.includes("e404")
    ) {
      return false;
    }
    return true;
  }

  private toUserFacingError(error: unknown): Error {
    const raw = this.getErrorMessage(error);
    const lower = raw.toLowerCase();
    const resolved = this.lastResolvedCommand ?? this.resolveServerCommand();
    const commandText = this.toCommandLine(resolved);

    if (
      lower.includes("enoent") ||
      lower.includes("command not found") ||
      lower.includes("not recognized as an internal or external command")
    ) {
      return new Error(
        `无法启动搜索服务（命令不可用）：${commandText}\n` +
          "请确认本机可用 Node.js/npm（含 npx），或在设置里指定 hugeAiChat.mcp.command。"
      );
    }

    if (
      lower.includes("econnreset") ||
      lower.includes("etimedout") ||
      lower.includes("enotfound") ||
      lower.includes("econnrefused") ||
      lower.includes("network")
    ) {
      return new Error(
        "搜索服务连接失败（网络/代理异常）。\n" +
          "无需手动安装 MCP，插件会自动通过 npx 拉起 huge-ai-search；请检查网络与代理后重试。"
      );
    }

    return new Error(
      `搜索服务不可用：${raw}\n` +
        "若持续失败，请在设置中配置 hugeAiChat.mcp.command / hugeAiChat.mcp.args 指向可用服务。"
    );
  }

  private log(line: string): void {
    this.output.appendLine(line);
  }
}
