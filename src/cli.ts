/**
 * Agent-native CLI surface for Huge AI Search.
 * MCP remains the long-lived server; this module handles one-shot commands.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const SEARCH_LANGUAGES = [
  "zh-CN",
  "en-US",
  "ja-JP",
  "ko-KR",
  "de-DE",
  "fr-FR",
] as const;

export type SearchLanguage = (typeof SEARCH_LANGUAGES)[number];
export type OutputFormat = "json" | "markdown";
export type SkillInstallTarget = "all" | "cursor" | "claude" | "codex" | "agents";

export interface SearchToolArgs {
  query: string;
  language: SearchLanguage;
  follow_up: boolean;
  session_id?: string;
  image_path?: string;
  create_image: boolean;
}

export interface SearchHandleResult {
  ok: boolean;
  text: string;
  sessionId?: string;
  query?: string;
}

export type CliCommand =
  | { type: "mcp" }
  | { type: "version" }
  | { type: "release-channel" }
  | { type: "help"; topic?: "search" | "skill-install" | "schema" }
  | { type: "schema"; name: "search" | "skill-install" }
  | { type: "skill-install"; target: SkillInstallTarget }
  | { type: "search"; args: SearchToolArgs; format: OutputFormat }
  | { type: "error"; message: string; topic?: "search" | "skill-install" | "schema" };

const SKILL_DIR_NAME = "huge-ai-search";

export function isSearchLanguage(value: string): value is SearchLanguage {
  return (SEARCH_LANGUAGES as readonly string[]).includes(value);
}

export function detectDefaultFormat(): OutputFormat {
  if (process.env.NO_COLOR === undefined && process.stdout.isTTY) {
    return "markdown";
  }
  return "json";
}

export function parseCliArgs(argv: string[]): CliCommand {
  if (argv.length === 0) {
    return { type: "mcp" };
  }

  const head = argv[0];
  if (head === "--version" || head === "-v") {
    return { type: "version" };
  }
  if (head === "--release-channel") {
    return { type: "release-channel" };
  }
  if (head === "--help" || head === "-h" || head === "help") {
    return { type: "help", topic: parseHelpTopic(argv[1]) };
  }
  if (head === "schema") {
    const name = argv[1];
    if (name === "--help" || name === "-h") {
      return { type: "help", topic: "schema" };
    }
    if (name === "search" || name === "skill-install") {
      return { type: "schema", name };
    }
    return {
      type: "error",
      message: "用法: huge-ai-search schema <search|skill-install>",
      topic: "schema",
    };
  }
  if (head === "skill-install") {
    return parseSkillInstallArgs(argv.slice(1));
  }
  if (head === "search") {
    return parseSearchArgs(argv.slice(1));
  }

  if (head.startsWith("-")) {
    return {
      type: "error",
      message: `未知参数: ${head}`,
    };
  }

  return {
    type: "error",
    message: `未知命令: ${head}。可用命令: search, skill-install, schema, help`,
  };
}

function parseHelpTopic(value?: string): "search" | "skill-install" | "schema" | undefined {
  if (value === "search" || value === "skill-install" || value === "schema") {
    return value;
  }
  return undefined;
}

function parseSkillInstallArgs(argv: string[]): CliCommand {
  let target: SkillInstallTarget = "all";
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      return { type: "help", topic: "skill-install" };
    }
    if (token === "--target") {
      const next = argv[++i];
      if (!next || !isSkillInstallTarget(next)) {
        return {
          type: "error",
          message: "用法: huge-ai-search skill-install [--target all|cursor|claude|codex|agents]",
          topic: "skill-install",
        };
      }
      target = next;
      continue;
    }
    return {
      type: "error",
      message: `未知参数: ${token}`,
      topic: "skill-install",
    };
  }
  return { type: "skill-install", target };
}

function isSkillInstallTarget(value: string): value is SkillInstallTarget {
  return value === "all" || value === "cursor" || value === "claude" || value === "codex" || value === "agents";
}

function parseSearchArgs(argv: string[]): CliCommand {
  const args: SearchToolArgs = {
    query: "",
    language: "zh-CN",
    follow_up: false,
    create_image: false,
  };
  let format: OutputFormat | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      return { type: "help", topic: "search" };
    }
    if (token === "--json") {
      format = "json";
      continue;
    }
    if (token === "--format" || token === "-f") {
      const next = argv[++i];
      if (next === "json") {
        format = "json";
        continue;
      }
      if (next === "markdown" || next === "md") {
        format = "markdown";
        continue;
      }
      return {
        type: "error",
        message: "用法: --format json|markdown",
        topic: "search",
      };
    }
    if (token === "--query" || token === "-q") {
      const next = argv[++i];
      if (next === undefined) {
        return { type: "error", message: "--query 需要一个值", topic: "search" };
      }
      args.query = next;
      continue;
    }
    if (token === "--language" || token === "-l") {
      const next = argv[++i];
      if (!next || !isSearchLanguage(next)) {
        return {
          type: "error",
          message: `--language 必须是 ${SEARCH_LANGUAGES.join("|")} 之一`,
          topic: "search",
        };
      }
      args.language = next;
      continue;
    }
    if (token === "--follow-up" || token === "--follow_up") {
      args.follow_up = parseOptionalBoolean(argv[i + 1]);
      if (isBooleanToken(argv[i + 1])) {
        i++;
      }
      continue;
    }
    if (token === "--session-id" || token === "--session_id") {
      const next = argv[++i];
      if (!next) {
        return { type: "error", message: "--session-id 需要一个值", topic: "search" };
      }
      args.session_id = next;
      continue;
    }
    if (token === "--image" || token === "--image-path" || token === "--image_path") {
      const next = argv[++i];
      if (!next) {
        return { type: "error", message: "--image 需要一个本地图片绝对路径", topic: "search" };
      }
      args.image_path = next;
      continue;
    }
    if (token === "--create-image" || token === "--create_image") {
      args.create_image = parseOptionalBoolean(argv[i + 1]);
      if (isBooleanToken(argv[i + 1])) {
        i++;
      }
      continue;
    }
    if (token.startsWith("-")) {
      return { type: "error", message: `未知参数: ${token}`, topic: "search" };
    }
    positionals.push(token);
  }

  if (!args.query && positionals.length > 0) {
    args.query = positionals.join(" ");
  }

  if (!args.query.trim() && !args.image_path) {
    return {
      type: "error",
      message: "请提供搜索问题：huge-ai-search search --query \"...\"",
      topic: "search",
    };
  }

  return {
    type: "search",
    args,
    format: format ?? detectDefaultFormat(),
  };
}

function isBooleanToken(value?: string): boolean {
  if (value === undefined) {
    return false;
  }
  return value === "true" || value === "false" || value === "1" || value === "0";
}

function parseOptionalBoolean(value?: string): boolean {
  if (value === "false" || value === "0") {
    return false;
  }
  return true;
}

export function printHelp(topic?: "search" | "skill-install" | "schema"): void {
  if (topic === "search") {
    console.log(`huge-ai-search search — 一次性调用 Google AI Mode 搜索

用法:
  huge-ai-search search --query "<自然语言问题>" [选项]
  huge-ai-search search "<自然语言问题>"

选项:
  -q, --query <text>         搜索问题（推荐自然语言，不要堆关键词）
  -l, --language <lang>      zh-CN|en-US|ja-JP|ko-KR|de-DE|fr-FR（默认 zh-CN）
      --follow-up            在同一会话追问（需同时传 --session-id）
      --session-id <id>      上次结果里的 session_id
      --image <abs-path>     本地图片绝对路径（单图）
      --create-image         进入 Google AI Mode 画图
  -f, --format json|markdown 输出格式。非 TTY 默认 json，TTY 默认 markdown
      --json                 等同 --format json
  -h, --help                 显示本帮助

输出:
  stdout 只放结果；日志在 stderr。
  json 信封: { ok, command, data, error, meta }
  成功时 data.session_id 用于后续 --follow-up

示例:
  huge-ai-search search --query "React 19 有什么新特性" --language zh-CN
  huge-ai-search search --query "如果是中小型项目该怎么选" --follow-up --session-id session_xxx
`);
    return;
  }

  if (topic === "skill-install") {
    console.log(`huge-ai-search skill-install — 把 Skill 安装到本机 Agent 目录

用法:
  huge-ai-search skill-install [--target all|cursor|claude|codex|agents]

目标目录:
  cursor  ~/.cursor/skills/huge-ai-search
  claude  ~/.claude/skills/huge-ai-search
  codex   ~/.codex/skills/huge-ai-search
  agents  ~/.agents/skills/huge-ai-search
  all     以上全部（默认）
`);
    return;
  }

  if (topic === "schema") {
    console.log(`huge-ai-search schema — 输出命令的机器可读参数定义

用法:
  huge-ai-search schema search
  huge-ai-search schema skill-install
`);
    return;
  }

  console.log(`huge-ai-search — Google AI Mode 搜索

用法:
  huge-ai-search                         启动 MCP stdio 服务器（默认）
  huge-ai-search search [选项]           一次性搜索（给 Skill / 脚本用）
  huge-ai-search skill-install           安装 Agent Skill
  huge-ai-search schema <name>           输出命令 schema
  huge-ai-search --version               打印版本
  huge-ai-search --help                  打印帮助

说明:
  无子命令时进入 MCP 模式，供 Cursor / Claude Code / Codex 连接。
  Skill 没有 MCP 时，应调用 search 子命令，不要自己写 Playwright。

更多:
  huge-ai-search help search
  huge-ai-search help skill-install
`);
}

export function printSchema(name: "search" | "skill-install", version: string): void {
  const schema =
    name === "search"
      ? {
          name: "search",
          description: "One-shot Google AI Mode search. Prefer MCP search when a live server is connected.",
          args: {
            query: { type: "string", required: true, from: ["--query", "positional"] },
            language: {
              type: "string",
              enum: SEARCH_LANGUAGES,
              default: "zh-CN",
              from: ["--language"],
            },
            follow_up: { type: "boolean", default: false, from: ["--follow-up"] },
            session_id: { type: "string", required: false, from: ["--session-id"] },
            image_path: { type: "string", required: false, from: ["--image"] },
            create_image: { type: "boolean", default: false, from: ["--create-image"] },
            format: { type: "string", enum: ["json", "markdown"], from: ["--format", "--json"] },
          },
        }
      : {
          name: "skill-install",
          description: "Copy the Huge AI Search skill into local agent skill directories.",
          args: {
            target: {
              type: "string",
              enum: ["all", "cursor", "claude", "codex", "agents"],
              default: "all",
              from: ["--target"],
            },
          },
        };

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        command: "schema",
        data: schema,
        error: null,
        meta: { cli: "huge-ai-search", version },
      },
      null,
      2
    )}\n`
  );
}

export function resolvePackagedSkillDir(): string | null {
  const candidates = [
    path.resolve(__dirname, "..", "skills", SKILL_DIR_NAME),
    path.resolve(process.cwd(), "skills", SKILL_DIR_NAME),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      return dir;
    }
  }
  return null;
}

export function skillInstallDestinations(target: SkillInstallTarget): string[] {
  const home = os.homedir();
  const map: Record<Exclude<SkillInstallTarget, "all">, string> = {
    cursor: path.join(home, ".cursor", "skills", SKILL_DIR_NAME),
    claude: path.join(home, ".claude", "skills", SKILL_DIR_NAME),
    codex: path.join(home, ".codex", "skills", SKILL_DIR_NAME),
    agents: path.join(home, ".agents", "skills", SKILL_DIR_NAME),
  };
  if (target === "all") {
    return Object.values(map);
  }
  return [map[target]];
}

export function installSkill(target: SkillInstallTarget): { ok: boolean; lines: string[]; error?: string } {
  const source = resolvePackagedSkillDir();
  if (!source) {
    return {
      ok: false,
      lines: [],
      error: "找不到打包的 Skill（skills/huge-ai-search/SKILL.md）。请从仓库根目录运行，或重新安装 npm 包。",
    };
  }

  const dests = skillInstallDestinations(target);
  const lines: string[] = [`已从 ${source} 安装 Skill:`];
  for (const dest of dests) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(source, dest, { recursive: true });
    lines.push(`- ${dest}`);
  }
  lines.push("新开一个 Agent 会话后即可使用。没有 MCP 时，Skill 会走 huge-ai-search search CLI。");
  return { ok: true, lines };
}

export function resultLooksSuccessful(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("错误:")) {
    return false;
  }
  if (trimmed.startsWith("搜索繁忙")) {
    return false;
  }
  if (trimmed.startsWith("搜索等待验证")) {
    return false;
  }
  if (trimmed.startsWith("搜索执行异常")) {
    return false;
  }
  if (trimmed.startsWith("⏸️ HUGE AI")) {
    return false;
  }
  if (trimmed.includes("## ❌ 搜索失败")) {
    return false;
  }
  if (trimmed.includes("## ⏸️")) {
    return false;
  }
  if (trimmed.includes("## 🔁")) {
    return false;
  }
  return true;
}

export function extractSessionId(text: string): string | undefined {
  const match = text.match(/(?:^|\n)session_id:\s*(\S+)/);
  return match?.[1];
}

export function writeSearchOutput(
  result: SearchHandleResult,
  format: OutputFormat,
  version: string
): void {
  if (format === "markdown") {
    process.stdout.write(`${result.text.trimEnd()}\n`);
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: result.ok,
        command: "search",
        data: result.ok
          ? {
              query: result.query ?? "",
              answer_markdown: result.text,
              session_id: result.sessionId ?? extractSessionId(result.text) ?? null,
            }
          : null,
        error: result.ok ? null : { message: result.text, retryable: isRetryableSearchError(result.text) },
        meta: { cli: "huge-ai-search", version },
      },
      null,
      2
    )}\n`
  );
}

function isRetryableSearchError(text: string): boolean {
  return (
    text.includes("搜索繁忙") ||
    text.includes("请稍后重试") ||
    text.includes("请立即重试") ||
    text.includes("搜索超时") ||
    text.includes("验证已完成")
  );
}
