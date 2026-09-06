---
name: huge-ai-search
description: Searches the live web through Google AI Mode via Huge AI Search (MCP or CLI). Use when the user needs current information, official docs, bug causes, API usage, comparisons, or any uncertain fact; when asked to 搜索, 搜一下, google, web search, or follow up on a previous Huge AI search; and before implementing unfamiliar libraries.
---

# Huge AI Search

通过 Google AI Mode 做联网搜索。先 MCP，没有 MCP 再走 CLI。不要自己写 Playwright，也不要改用无追问能力的普通搜索来替代。

## 调用顺序

1. **有 MCP `search` 工具**（名称可能是 `search` 或 `mcp_huge_ai_search_search`）→ 直接调工具。
2. **没有 MCP** → 运行 CLI（见下方）。先 `huge-ai-search --help` 确认命令可用。
3. 两者都不可用 → 告诉用户先安装：`npm i -g huge-ai-search`，并执行一次 `npx -y -p huge-ai-search@latest huge-ai-search-setup`。

## 提问规则

- 用自然语言提问，不要堆关键词。
- 技术词条用「X 是什么 / what is X」，不要只丢一个单词。
- 非琐碎问题必须追问 2–3 次。初次搜索只是开门。

## MCP 参数

| 参数 | 说明 |
|---|---|
| `query` | 自然语言问题 |
| `language` | `zh-CN` / `en-US` / `ja-JP` / `ko-KR` / `de-DE` / `fr-FR` |
| `follow_up` | 同一会话追问时为 `true` |
| `session_id` | 上次结果里的 `session_id` |
| `image_path` | 本地图片绝对路径（单图） |
| `create_image` | `true` 时走画图模式 |

## CLI（无 MCP 时）

Windows PowerShell / CMD / Unix 通用：

```bash
huge-ai-search search --query "问题" --language zh-CN --format json
```

未全局安装时：

```bash
npx -y huge-ai-search search --query "问题" --language zh-CN --format json
```

本仓库开发中：

```bash
node dist/index.js search --query "问题" --language zh-CN --format json
```

追问：

```bash
huge-ai-search search --query "结合我的场景该怎么选？" --follow-up --session-id "<上次 session_id>" --format json
```

- stdout 是结果；日志在 stderr。解析 JSON 时读 `data.answer_markdown` 和 `data.session_id`。
- 非 TTY 默认就是 JSON，不必强记 `--format`。
- CLI 每次都是新进程。`--follow-up` 只能复用浏览器登录态，**不能**复用 MCP 那种页内对话。没有 MCP 时，把上一轮要点写进下一条 `query` 再搜。
- 完整参数：`huge-ai-search help search` 或 `huge-ai-search schema search`。字段说明见 [references/cli.md](references/cli.md)。

## 追问流程（必须）

1. 概况：`{主题} 是什么？核心概念和常见用法？` → 记下 `session_id`
2. 场景：`如果我的场景是 {具体约束}，应该怎么做？`（`follow_up: true`）
3. 避坑：`有哪些常见坑和反模式？`（同一 `session_id`）

话题变了就开新搜索（`follow_up: false`），不要硬追。

## 输出给用户

- 用搜索到的结论回答，附关键来源。
- 不要把 `session_id`、debug 标记原样丢给用户；自己留下一轮追问即可。
- 失败且文案要求 setup / 登录 / 验证码：把命令给用户，等他们完成后重试。不要假装搜到了。

## 不要做

- 不要用网页抓取或别的搜索工具绕过本 Skill。
- 不要在能搜之前就对不确定的 API / 报错下结论。
- 用户明确说「不要搜索」时才跳过。
