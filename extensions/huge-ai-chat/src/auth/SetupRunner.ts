import { spawn } from "node:child_process";
import * as vscode from "vscode";

export interface SetupRunResult {
  success: boolean;
  message: string;
  exitCode: number | null;
}

interface CommandSpec {
  command: string;
  args: string[];
}

function getSanitizedEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value;
    }
  }
  return env;
}

function getSetupCommand(): CommandSpec {
  if (process.platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "npx", "-y", "-p", "huge-ai-search", "huge-ai-search-setup"],
    };
  }
  return {
    command: "npx",
    args: ["-y", "-p", "huge-ai-search", "huge-ai-search-setup"],
  };
}

export class SetupRunner {
  private running: Promise<SetupRunResult> | null = null;

  constructor(private readonly output: vscode.OutputChannel) {}

  isRunning(): boolean {
    return this.running !== null;
  }

  async ensureRunning(): Promise<SetupRunResult> {
    if (this.running) {
      return this.running;
    }

    this.running = this.runInternal().finally(() => {
      this.running = null;
    });

    return this.running;
  }

  private runInternal(): Promise<SetupRunResult> {
    return new Promise<SetupRunResult>((resolve) => {
      const spec = getSetupCommand();
      this.output.show(true);
      this.output.appendLine("[Setup] 开始执行登录验证流程...");
      this.output.appendLine(`[Setup] Command: ${spec.command} ${spec.args.join(" ")}`);

      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const child = spawn(spec.command, spec.args, {
        cwd,
        env: getSanitizedEnv(),
        shell: false,
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        this.output.append(chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        this.output.append(chunk.toString("utf8"));
      });

      child.on("error", (error) => {
        const message = `登录验证流程启动失败: ${error.message}`;
        this.output.appendLine(`[Setup] ${message}`);
        resolve({
          success: false,
          message,
          exitCode: null,
        });
      });

      child.on("close", (exitCode) => {
        if (exitCode === 0) {
          const message = "验证流程已完成。请点击“重试”继续搜索。";
          this.output.appendLine(`[Setup] ${message}`);
          resolve({
            success: true,
            message,
            exitCode,
          });
          return;
        }

        const message = `验证流程失败，退出码: ${exitCode ?? "unknown"}。请检查输出日志后重试。`;
        this.output.appendLine(`[Setup] ${message}`);
        resolve({
          success: false,
          message,
          exitCode,
        });
      });
    });
  }
}
