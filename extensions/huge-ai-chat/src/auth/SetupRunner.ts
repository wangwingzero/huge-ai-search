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

interface SetupLaunchContext {
  cwd?: string;
  fallbackReason?: string;
}

function hasNonAsciiChars(value: string): boolean {
  return /[^\u0000-\u007f]/.test(value);
}

function resolveSetupLaunchContext(): SetupLaunchContext {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    return {};
  }

  // Avoid known Windows command execution issues on non-ASCII workspace paths.
  if (process.platform === "win32" && hasNonAsciiChars(cwd)) {
    return {
      fallbackReason: `检测到工作区路径包含非 ASCII 字符，Windows 下可能导致 setup 命令启动失败: ${cwd}`,
    };
  }

  return { cwd };
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
      args: ["/c", "npx", "-y", "-p", "huge-ai-search@latest", "huge-ai-search-setup"],
    };
  }
  return {
    command: "npx",
    args: ["-y", "-p", "huge-ai-search@latest", "huge-ai-search-setup"],
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
      const launchContext = resolveSetupLaunchContext();
      const cwd = launchContext.cwd;
      this.output.show(true);
      this.output.appendLine("[Setup] 开始执行登录验证流程...");
      this.output.appendLine(`[Setup] Command: ${spec.command} ${spec.args.join(" ")}`);
      if (launchContext.fallbackReason) {
        this.output.appendLine(`[Setup] 路径兼容回退: ${launchContext.fallbackReason}`);
        this.output.appendLine("[Setup] 已回退为系统默认工作目录执行 setup。");
      }
      this.output.appendLine(`[Setup] CWD: ${cwd || "<default>"}`);

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
