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
}

interface ResolvedServerCommand {
  command: string;
  args: string[];
  cwd?: string;
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  async callSearch(args: SearchToolArgs): Promise<string> {
    try {
      return await this.callSearchOnce(args);
    } catch (firstError) {
      this.log(`[MCP] 首次调用失败，将尝试重连后重试: ${this.getErrorMessage(firstError)}`);
      await this.disconnect();
      return this.callSearchOnce(args);
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
      };
    }

    if (this.context.extensionMode === vscode.ExtensionMode.Development) {
      const localEntry = this.findLocalServerEntry();
      if (localEntry) {
        return {
          command: "node",
          args: [localEntry],
          cwd: path.dirname(path.dirname(localEntry)),
        };
      }
    }

    if (process.platform === "win32") {
      return {
        command: "cmd",
        args: ["/c", "npx", "-y", "huge-ai-search@latest"],
        cwd: configuredCwd || undefined,
      };
    }

    return {
      command: "npx",
      args: ["-y", "huge-ai-search@latest"],
      cwd: configuredCwd || undefined,
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

  private log(line: string): void {
    this.output.appendLine(line);
  }
}
