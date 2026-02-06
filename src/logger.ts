import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOG_DIR_ENV = "HUGE_AI_SEARCH_LOG_DIR";
const LOG_RETENTION_ENV = "HUGE_AI_SEARCH_LOG_RETENTION_DAYS";
const DEFAULT_LOG_RETENTION_DAYS = 14;

const DEFAULT_LOG_DIR = path.join(os.homedir(), ".huge-ai-search", "logs");
const LOG_DIR = (process.env[LOG_DIR_ENV] || "").trim() || DEFAULT_LOG_DIR;
const LOG_FILE = path.join(
  LOG_DIR,
  `search_${new Date().toISOString().split("T")[0]}.log`
);

let initialized = false;
let stderrHookInstalled = false;

function parseRetentionDays(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_LOG_RETENTION_DAYS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LOG_RETENTION_DAYS;
  }

  const normalized = Math.floor(parsed);
  if (normalized < 1 || normalized > 3650) {
    return DEFAULT_LOG_RETENTION_DAYS;
  }
  return normalized;
}

const LOG_RETENTION_DAYS = parseRetentionDays(process.env[LOG_RETENTION_ENV]);

function appendRaw(line: string): void {
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // ignore
  }
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === "string") {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function cleanupOldLogs(): void {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let entries: fs.Dirent[] = [];

  try {
    entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/^search_\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) {
      continue;
    }

    const filePath = path.join(LOG_DIR, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(filePath, { force: true });
      }
    } catch {
      // ignore
    }
  }
}

function installConsoleErrorHook(): void {
  if (stderrHookInstalled) {
    return;
  }

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = formatConsoleArgs(args);
    appendRaw(`[${timestamp}] [STDERR] ${message}\n`);
    originalConsoleError(...args);
  };

  stderrHookInstalled = true;
}

export function initializeLogger(): void {
  if (initialized) {
    return;
  }

  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // ignore
  }

  cleanupOldLogs();
  installConsoleErrorHook();
  initialized = true;
}

export function writeLog(
  level: "INFO" | "ERROR" | "DEBUG" | "CAPTCHA",
  message: string,
  scope?: string
): void {
  const timestamp = new Date().toISOString();
  const scopedLine = scope
    ? `[${timestamp}] [${level}] [${scope}] ${message}\n`
    : `[${timestamp}] [${level}] ${message}\n`;
  appendRaw(scopedLine);

  const stderrLine = scope ? `[${scope}] ${message}\n` : `${message}\n`;
  try {
    process.stderr.write(stderrLine);
  } catch {
    // ignore
  }
}

export function getLogPath(): string {
  return LOG_FILE;
}

export function getLogDir(): string {
  return LOG_DIR;
}

export function getLogRetentionDays(): number {
  return LOG_RETENTION_DAYS;
}

