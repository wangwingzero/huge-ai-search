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
  create_image?: boolean;
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
  source: "configured" | "development" | "local-auto" | "cmd-auto";
}

const DEFAULT_MCP_ENV: Record<string, string> = {
  HUGE_AI_SEARCH_IMAGE_DRIVER: "playwright",
  HUGE_AI_SEARCH_IMAGE_UPLOAD_FLOW_BUDGET_MS: "35000",
  HUGE_AI_SEARCH_IMAGE_UPLOAD_TIMEOUT_MULTIPLIER: "1.0",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_LOGLEVEL: "error",
};

function getSanitizedEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(DEFAULT_MCP_ENV)) {
    if (!env[key] || env[key].trim().length === 0) {
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
  private static readonly TOOL_TIMEOUT_TEXT_MS = 70_000;
  private static readonly TOOL_TIMEOUT_IMAGE_MS = 110_000;
  private static readonly CALL_MAX_RETRIES = 3;
  private static readonly CONNECT_MAX_RETRIES = 2;
  private static readonly RETRY_BASE_DELAY_MS = 450;
  private static readonly RETRY_MAX_DELAY_MS = 3200;

  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private lastResolvedCommand: ResolvedServerCommand | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  isConnected(): boolean {
    return Boolean(this.client && this.transport);
  }

  /**
   * 获取已解析的 MCP 服务器目录（dist 目录），用于定位 setup.js 等工具脚本。
   * 仅当使用 node 直接运行本地 index.js 时可用。
   */
  getServerDir(): string | null {
    const resolved = this.lastResolvedCommand;
    if (!resolved) return null;
    // 命令格式: node /path/to/dist/index.js
    const entry = resolved.args?.[resolved.args.length - 1];
    if (!entry || !entry.endsWith("index.js")) return null;
    return path.dirname(entry);
  }

  async callSearch(args: SearchToolArgs): Promise<string> {
    const maxAttempts = 1 + McpClientManager.CALL_MAX_RETRIES;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.callSearchOnce(args);
      } catch (error) {
        lastError = error;
        const rawMessage = this.getErrorMessage(error);
        const phase = this.getErrorPhase(rawMessage);
        this.log(
          `[MCP] callSearch 失败 (attempt=${attempt}/${maxAttempts}, phase=${phase}): ${rawMessage}`
        );

        if (!this.shouldRetry(error) || attempt >= maxAttempts) {
          break;
        }

        await this.disconnect();
        const delayMs = this.getRetryDelayMs(attempt);
        this.log(`[MCP] ${delayMs}ms 后重试 MCP 调用...`);
        await this.sleep(delayMs);
      }
    }

    throw this.toUserFacingError(lastError);
  }

  async warmup(): Promise<McpWarmupResult> {
    try {
      await this.ensureConnectedWithRetry(McpClientManager.CONNECT_MAX_RETRIES, "warmup");
      const resolved = this.lastResolvedCommand ?? this.resolveServerCommand();
      const commandText = this.toCommandLine(resolved);
      const modeLabel = this.getModeLabel(resolved.source);
      return {
        ready: true,
        detail: `已连接搜索服务（${modeLabel}）：${commandText}`,
        suggestion:
          resolved.source === "cmd-auto"
            ? "Windows 已使用 cmd 兼容启动方式，建议先全局安装 huge-ai-search。"
            : resolved.source === "local-auto"
              ? "已优先复用本地 huge-ai-search 服务，失败时会自动回退到 cmd 兼容命令。"
            : "现在可以直接发送问题，系统会复用当前连接。",
      };
    } catch (error) {
      await this.disconnect();
      return {
        ready: false,
        detail: this.toUserFacingError(error).message,
        suggestion:
          "可继续打开聊天界面；发送消息时会再次尝试连接。若持续失败，请检查 Node/npm 和网络代理。",
      };
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect();
  }

  private async callSearchOnce(args: SearchToolArgs): Promise<string> {
    try {
      await this.ensureConnected();
    } catch (error) {
      throw this.withPhasePrefix("connect", error);
    }
    if (!this.client) {
      throw new Error("[connect] MCP 客户端未连接。");
    }

    const hasImageInput = Boolean(args.image_path && args.image_path.trim().length > 0);
    const timeoutMs = hasImageInput
      ? McpClientManager.TOOL_TIMEOUT_IMAGE_MS
      : McpClientManager.TOOL_TIMEOUT_TEXT_MS;

    let result: unknown;
    try {
      result = await this.client.callTool(
        {
          name: "search",
          arguments: args as unknown as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          timeout: timeoutMs,
        }
      );
    } catch (error) {
      throw this.withPhasePrefix("tool", error);
    }

    const text = this.extractTextFromToolResult(result);
    if (!text) {
      throw new Error("[tool] MCP 搜索返回了空响应。");
    }
    return text;
  }

  private async ensureConnectedWithRetry(maxRetries: number, reason: string): Promise<void> {
    const maxAttempts = 1 + Math.max(0, maxRetries);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.ensureConnected();
        return;
      } catch (error) {
        lastError = error;
        const message = this.getErrorMessage(error);
        this.log(
          `[MCP] ${reason} 连接失败 (attempt=${attempt}/${maxAttempts}): ${message}`
        );
        if (!this.shouldRetry(error) || attempt >= maxAttempts) {
          break;
        }
        await this.disconnect();
        await this.sleep(this.getRetryDelayMs(attempt));
      }
    }

    throw lastError ?? new Error(`[connect] ${reason} 连接失败`);
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
    const candidates = this.resolveServerCommands();
    let lastError: unknown = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const resolved = candidates[index];
      this.lastResolvedCommand = resolved;
      try {
        await this.connectWithCommand(resolved);
        return;
      } catch (error) {
        lastError = error;
        const phase = this.getErrorPhase(this.getErrorMessage(error));
        this.log(
          `[MCP] connect 失败 (candidate=${index + 1}/${candidates.length}, source=${resolved.source}, phase=${phase}): ${this.getErrorMessage(error)}`
        );
        await this.disconnect();

        if (index < candidates.length - 1) {
          this.log("[MCP] 当前命令连接失败，尝试下一个候选命令...");
        }
      }
    }

    throw this.withPhasePrefix("connect", lastError ?? new Error("MCP 连接失败"));
  }

  private async connectWithCommand(resolved: ResolvedServerCommand): Promise<void> {
    const extraEnv: Record<string, string> = {
      HUGE_AI_SEARCH_IMAGE_DRIVER: "playwright",
      HUGE_AI_SEARCH_IMAGE_UPLOAD_FLOW_BUDGET_MS: "35000",
      HUGE_AI_SEARCH_IMAGE_UPLOAD_TIMEOUT_MULTIPLIER: "1.0",
      // IDE 插件场景无 60s MCP deadline 限制，放宽服务端执行超时
      HUGE_AI_SEARCH_TOTAL_BUDGET_TEXT_MS: "55000",
      HUGE_AI_SEARCH_TOTAL_BUDGET_IMAGE_MS: "100000",
      HUGE_AI_SEARCH_EXECUTION_TIMEOUT_TEXT_MS: "50000",
      HUGE_AI_SEARCH_EXECUTION_TIMEOUT_IMAGE_MS: "90000",
    };
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
    this.log(
      `[MCP] Effective env: HUGE_AI_SEARCH_IMAGE_DRIVER=${serverParams.env?.HUGE_AI_SEARCH_IMAGE_DRIVER || "(unset)"}, HUGE_AI_SEARCH_IMAGE_UPLOAD_FLOW_BUDGET_MS=${serverParams.env?.HUGE_AI_SEARCH_IMAGE_UPLOAD_FLOW_BUDGET_MS || "(unset)"}, HUGE_AI_SEARCH_IMAGE_UPLOAD_TIMEOUT_MULTIPLIER=${serverParams.env?.HUGE_AI_SEARCH_IMAGE_UPLOAD_TIMEOUT_MULTIPLIER || "(unset)"}`
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
      if (this.client === client) {
        this.client = null;
      }
      if (this.transport === transport) {
        this.transport = null;
      }
    };

    try {
      await client.connect(transport);
    } catch (error) {
      try {
        await transport.close();
      } catch (closeError) {
        this.log(`[MCP] 握手失败后关闭 transport 失败: ${this.getErrorMessage(closeError)}`);
      }
      throw this.withPhasePrefix("handshake", error);
    }

    this.client = client;
    this.transport = transport;
    this.lastResolvedCommand = resolved;
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

    try {
      await currentTransport.close();
      this.log("[MCP] Transport closed.");
    } catch (error) {
      this.log(`[MCP] Transport close failed: ${this.getErrorMessage(error)}`);
    }
  }

  private hookTransportStderr(transport: StdioClientTransport): void {
    const stderr = transport.stderr;
    if (!stderr) {
      return;
    }
    stderr.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.output.append(text);
    });
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
    return this.resolveServerCommands()[0];
  }

  private resolveServerCommands(): ResolvedServerCommand[] {
    const commands: ResolvedServerCommand[] = [];
    const localEntry = this.findLocalServerEntry();
    if (localEntry) {
      commands.push({
        command: "node",
        args: [localEntry],
        cwd: path.dirname(path.dirname(localEntry)),
        source:
          this.context.extensionMode === vscode.ExtensionMode.Development
            ? "development"
            : "local-auto",
      });
    }

    commands.push(this.resolveNpxCommand());
    return commands;
  }

  private resolveNpxCommand(cwd?: string): ResolvedServerCommand {
    if (process.platform === "win32") {
      return {
        command: "cmd",
        args: ["/c", "huge-ai-search"],
        cwd,
        source: "cmd-auto",
      };
    }

    return {
      command: "npx",
      args: ["--yes", "huge-ai-search@latest"],
      cwd,
      source: "cmd-auto",
    };
  }

  private findLocalServerEntry(): string | null {
    const extensionRoot = this.context.extensionUri.fsPath;
    const workspaceRoot =
      this.context.extensionMode === vscode.ExtensionMode.Development
        ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        : undefined;

    const candidates = [
      path.resolve(extensionRoot, "server", "dist", "index.js"),
      path.resolve(extensionRoot, "dist", "server", "index.js"),
      path.resolve(extensionRoot, "node_modules", "huge-ai-search", "dist", "index.js"),
      path.resolve(extensionRoot, "..", "..", "dist", "index.js"),
      workspaceRoot ? path.resolve(workspaceRoot, "dist", "index.js") : undefined,
      workspaceRoot ? path.resolve(process.cwd(), "dist", "index.js") : undefined,
    ].filter((item): item is string => Boolean(item));

    for (const candidate of new Set(candidates)) {
      if (fs.existsSync(candidate)) {
        this.log(`[MCP] Local MCP server detected: ${candidate}`);
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
      case "local-auto":
        return "自动本地服务";
      case "cmd-auto":
      default:
        return process.platform === "win32" ? "自动 cmd 兼容模式" : "自动 npx";
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
    if (
      message.includes("request timed out") ||
      message.includes("mcp error -32001") ||
      message.includes("maximum total timeout exceeded")
    ) {
      return false;
    }
    return true;
  }

  private toUserFacingError(error: unknown): Error {
    const wrapped = this.getErrorMessage(error);
    const phase = this.getErrorPhase(wrapped);
    const raw = this.stripPhasePrefix(wrapped);
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
          "请确认本机可用 Node.js/npm（含 npx）。"
      );
    }

    if (
      lower.includes("econnreset") ||
      lower.includes("etimedout") ||
      lower.includes("enotfound") ||
      lower.includes("econnrefused") ||
      lower.includes("connection closed") ||
      lower.includes("channel has been closed") ||
      lower.includes("transport closed") ||
      lower.includes("network")
    ) {
      return new Error(
        `搜索服务连接失败（阶段: ${phase}）。\n` +
          "插件已自动执行重连与重试；若仍失败，请检查网络/代理。"
      );
    }

    return new Error(
      `搜索服务不可用：${raw}\n` +
        "若持续失败，请检查 Node.js/npm 环境及网络代理设置。"
    );
  }

  private withPhasePrefix(phase: "connect" | "handshake" | "tool", error: unknown): Error {
    const message = this.getErrorMessage(error);
    if (/^\[(connect|handshake|tool)\]\s+/i.test(message)) {
      return new Error(message);
    }
    return new Error(`[${phase}] ${message}`);
  }

  private getErrorPhase(message: string): "connect" | "handshake" | "tool" | "unknown" {
    const normalized = message.trim().toLowerCase();
    if (normalized.startsWith("[connect]")) {
      return "connect";
    }
    if (normalized.startsWith("[handshake]")) {
      return "handshake";
    }
    if (normalized.startsWith("[tool]")) {
      return "tool";
    }
    return "unknown";
  }

  private stripPhasePrefix(message: string): string {
    return message.replace(/^\[(connect|handshake|tool)\]\s+/i, "");
  }

  private getRetryDelayMs(attempt: number): number {
    const base = McpClientManager.RETRY_BASE_DELAY_MS * Math.max(1, attempt);
    const jitter = Math.floor(Math.random() * 220);
    return Math.min(McpClientManager.RETRY_MAX_DELAY_MS, base + jitter);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(line: string): void {
    this.output.appendLine(line);
  }
}
