# Huge AI Search MCP Server

🔍 AI 搜索聚合 MCP 服务器 - 获取 HUGE AI Mode 总结的搜索结果

[![NPM Version](https://img.shields.io/npm/v/huge-ai-search?color=red)](https://www.npmjs.com/package/huge-ai-search) [![MIT licensed](https://img.shields.io/npm/l/huge-ai-search)](./LICENSE)

## ⚠️ 前置条件

### 1. 安装 Microsoft Edge 浏览器（必需）

本工具**仅支持 Microsoft Edge 浏览器**，不支持 Chrome 或其他浏览器。

| 平台              | 安装方式                                                     |
| ----------------- | ------------------------------------------------------------ |
| **Windows** | 系统自带，无需安装                                           |
| **macOS**   | 从[microsoft.com/edge](https://www.microsoft.com/edge) 下载安装 |
| **Linux**   | `sudo apt install microsoft-edge-stable` 或从官网下载      |

### 2. Google 账户验证

首次搜索时如果遇到验证码，工具会**自动弹出浏览器窗口**，完成验证后会自动继续搜索。

验证状态会自动保存，后续搜索无需重复验证。

### 3. Python + nodriver（推荐）

为降低 Google 对自动化浏览器的风险识别，登录/验证码流程默认优先使用 `nodriver`。
图片搜索（`image_path`）同样默认优先走 `nodriver`，失败时自动回退 Playwright。

- 安装 Python 3.10+
- 安装 nodriver：`pip install nodriver>=0.48.1`

若本机没有可用的 Python/nodriver，会自动回退到 Playwright 流程。

### 4. 首次设置（推荐）

配置完 MCP 后，建议先运行一次设置命令完成 Google 账号登录：

```bash
npx -y -p huge-ai-search@latest huge-ai-search-setup
```

会弹出 Edge 浏览器窗口，登录你的 Google 账号即可。有验证码就过一下，然后关掉浏览器。

登录状态会自动保存，后续使用无需重复登录。

### 5. 代理设置（中国大陆用户）

如果你在中国大陆，需要配置代理才能访问 Google：

- 工具会自动检测常见本地端口：`7890`、`7891`、`7892`、`7897`、`9090`、`1080`、`10808`、`10809`、`20170`、`20171`、`20172`、`2080`、`2081`、`2088`、`6152`、`6153`、`53`、`54321`、`2053`、`2083`、`2087`、`8080`、`8443`、`80`、`443`
- 其中 `7892`/`9090`/`53`/`54321` 仅做开放检测，不会被自动当成浏览器代理端口
- 低置信度端口（如 `80`、`443`、`8080`、`8443`、`2053`、`2083`、`2087`）可能与本地 Web 服务冲突，建议优先设置环境变量显式指定代理
- 可通过环境变量显式指定：`HTTP_PROXY=http://127.0.0.1:10809`

## 特性

- 🤖 **AI 总结** - 获取 HUGE AI Mode 的搜索结果，而非原始网页
- 🔄 **追问对话** - 支持在同一会话中追问，获取更深入的答案
- 🌐 **多语言支持** - 支持中文、英文、日文、韩文等
- 🔐 **验证码处理** - 检测到验证码时自动弹出浏览器窗口
- 💾 **状态持久化** - 保存登录状态，避免重复验证
- 🚀 **多会话并发** - 支持多个独立会话同时进行

## 版本通道识别

- 版本遵循 SemVer：无预发布后缀（如 `1.1.27`）即识别为 `stable`
- 启动后每次工具返回都会显示：`服务版本 + 通道`
- 命令行可直接识别：

```bash
npx huge-ai-search --version
npx huge-ai-search --release-channel
```

## 安装

### 使用 npx（推荐）

无需安装，直接运行：

```bash
npx huge-ai-search
```

### 全局安装

```bash
npm install -g huge-ai-search
```

> Windows 默认推荐：先全局安装 `npm i -g huge-ai-search`，再用 `cmd /c huge-ai-search`。  
> 如果必须用 npx，请使用 `cmd /c npx ...` 方式，不要直接把 `command` 写成 `npx`。

## MCP 配置

### Cursor

编辑 `~/.cursor/mcp.json`（Windows: `%USERPROFILE%\.cursor\mcp.json`）：

**macOS / Linux:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search@latest"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "cmd",
      "args": ["/c", "huge-ai-search"]
    }
  }
}
```

### Claude Code

**macOS / Linux:**

```sh
claude mcp add huge-ai-search -- npx -y huge-ai-search@latest
```

**Windows (PowerShell):**

```powershell
claude mcp add-json huge-ai-search -s user '{"command":"cmd", "args":["/c", "huge-ai-search"]}'
```

**Windows (CMD):**

```cmd
claude mcp add-json huge-ai-search -s user "{\"command\":\"cmd\", \"args\":[\"/c\", \"huge-ai-search\"]}"
```

> ⚠️ Windows 推荐直接用 `cmd /c huge-ai-search`，避免直接把 `command` 写成 `npx` 导致启动失败。
> - PowerShell：用单引号 `'...'` 包裹 JSON，内部双引号无需转义
> - CMD：用双引号 `"..."` 包裹 JSON，内部双引号需用 `\"` 转义

### Kiro

编辑 `~/.kiro/settings/mcp.json`（Windows: `%USERPROFILE%\.kiro\settings\mcp.json`）：

**macOS / Linux:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "disabled": false,
      "command": "npx",
      "args": ["-y", "huge-ai-search@latest"],
      "autoApprove": ["search"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "disabled": false,
      "command": "cmd",
      "args": ["/c", "huge-ai-search"],
      "autoApprove": ["search"]
    }
  }
}
```

### 推荐：Rules / Kiro Steering

仓库根目录提供了 `huge-ai-search.md`，内容是“搜索优先 + 深度追问”的完整规范，推荐作为通用规则文件复用：

- 在支持 `rules` 的客户端中：直接将 `huge-ai-search.md` 内容加入你的规则配置
- 在 Kiro 中：推荐作为 `steering` 文档引入，约束代理在代码修改前先搜索并连续追问

> 该文件路径：`./huge-ai-search.md`

### 提示词示例：搜索优先原则（深度追问通用版）

```markdown
# 搜索优先原则（深度追问通用版）

> **先知其不可为，方能有所为**

## 🚨 硬性规则

**每次代码修改前，必须调用 `mcp_huge_ai_search_search` 进行深度搜索**

- 不搜索就写代码 = 违规！
- 只搜一次不追问 = 浪费！
- 至少追问 2-3 次才算完成搜索！

## 🔥 核心工具：mcp_huge_ai_search_search

这是支持多轮追问的 AI 搜索工具，**必须进行深度追问**！

- 首次搜索返回 `session_id`
- 后续追问设置 `follow_up: true` + `session_id` 继续深入
- AI 会在上下文中持续回答，越问越深

## ⭐ 深度追问流程（必须遵循）

### 第一步：初次搜索
mcp_huge_ai_search_search({
  query: "{技术/问题} 是什么？核心概念和常见用法？",
  language: "zh-CN",
  follow_up: false
})
→ 获取 `session_id`

### 第二步：场景化追问（必追！）
mcp_huge_ai_search_search({
  query: "如果我的场景是 {具体场景}，应该怎么做？",
  session_id: "上一步返回的 session_id",
  follow_up: true
})

### 第三步：避坑追问（必追！）
mcp_huge_ai_search_search({
  query: "有哪些常见的坑和反模式需要避免？",
  session_id: "同一个 session_id",
  follow_up: true
})

### 第四步：最佳实践追问（推荐）
mcp_huge_ai_search_search({
  query: "有哪些推荐的最佳实践？",
  session_id: "同一个 session_id",
  follow_up: true
})

---

## 第一式：辨（明其性）

辨别请求之性质，决定行动路径：

| 请求类型 | 行动 |
|----------|------|
| 代码实现 / 架构设计 / 性能优化 | **必搜其坑 + 深度追问** |
| Bug 修复 | 走「捉虫三步」|
| 简单查询 / 文件操作 / 文档修改 | 可顺其自然 |
| 用户言「不搜索」或「直接做」| 从其意 |

---

## 🐛 捉虫三步（Bug 修复通用流程）

**第一步：搜（问道于网）**
使用 `mcp_huge_ai_search_search` 搜索并追问：
- 初次：「{错误信息} 常见原因和解决方案」
- 追问1：「在 {技术栈/框架} 环境下最可能是什么原因？」
- 追问2：「有哪些排查步骤和调试技巧？」

**第二步：查（问道于日志）**
查看日志文件定位问题：
- 关注：ERROR、WARNING、Exception、崩溃堆栈
- 若无相关日志 → 先添加调试日志，复现问题

**第三步：解（对症下药）**
根据搜索结果 + 日志信息，定位问题根因后修复。

---

## 🔧 常规开发流程

**第二式：避（知其不可为）**
使用 `mcp_huge_ai_search_search` 搜索避坑 + 深度追问：
- 初次：「{技术} 常见错误和反模式？」
- 追问1：「在我的场景（{具体场景}）下要注意什么？」
- 追问2：「有哪些最佳实践？」
- 追问3：「有哪些常见的坑需要避免？」

**第三式：记（铭其戒）**
简要总结需要避免的错误，作为实现的警示。

**第四式：行（顺势而为）**
知其不可为后，方可有所为。

---

## 追问策略模板

| 追问类型 | 示例查询 |
|----------|----------|
| **场景化** | 「如果我的场景是 {具体场景}，应该怎么做？」 |
| **细节深入** | 「刚才提到的 {某个点}，能详细说说吗？」 |
| **对比选型** | 「{方案A} 和 {方案B} 在我的场景下哪个更好？」 |
| **避坑** | 「这个方案有什么潜在的坑需要注意？」 |
| **最佳实践** | 「有哪些推荐的最佳实践？」 |

---

## 搜索触发条件

### ✅ 必须搜索 + 追问
- 修改任何代码文件
- 修复 bug
- 添加新功能
- 重构代码
- 遇到错误信息
- 性能优化
- 架构设计决策
- 技术选型

### ❌ 可跳过
- 纯文档修改（.md 文件）
- 简单配置文件修改
- 用户明确说「不搜索」或「直接做」
- 简单的文件操作（重命名、移动等）

---

## 金句

> 「搜而不追，等于白搜」

> 「宁可多追一次，不可少追一次」

> 「追问成本很低，踩坑代价很高」

> 「先知其不可为，方能有所为」
```

### Codex CLI

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.huge-ai-search]
command = "npx"
args = ["-y", "huge-ai-search@latest"]
```

Windows 推荐：

```toml
[mcp_servers.huge-ai-search]
type = "stdio"
command = "cmd"
args = ["/c", "huge-ai-search"]
startup_timeout_sec = 120
tool_timeout_sec = 180
```

Windows 如需坚持 npx（兼容写法）：

```toml
[mcp_servers.huge-ai-search]
type = "stdio"
command = "cmd"
args = ["/c", "npx", "-y", "huge-ai-search@latest"]
startup_timeout_sec = 120
tool_timeout_sec = 180
```

或使用命令行快捷添加：

```bash
codex mcp add huge-ai-search -- npx -y huge-ai-search@latest
```

### Windsurf

编辑 `~/.codeium/windsurf/mcp_config.json`（Windows: `%APPDATA%\Codeium\Windsurf\mcp_config.json`）：

**macOS / Linux:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search@latest"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "cmd",
      "args": ["/c", "huge-ai-search"]
    }
  }
}
```

### Claude Desktop

编辑配置文件：
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**macOS / Linux:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search@latest"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "cmd",
      "args": ["/c", "huge-ai-search"]
    }
  }
}
```

### VS Code (GitHub Copilot)

在项目根目录创建 `.vscode/mcp.json`：

**macOS / Linux:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search@latest"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "cmd",
      "args": ["/c", "huge-ai-search"]
    }
  }
}
```

或使用命令面板 `MCP: Add Server` 添加。

### VS Code + Cline

编辑 Cline MCP 设置文件：
- macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

**macOS / Linux:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search@latest"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "cmd",
      "args": ["/c", "huge-ai-search"]
    }
  }
}
```

## 使用方法

### 基本搜索

```
搜索一下 React 19 有什么新特性
```

### 指定语言

```
用英文搜索 TypeScript 5.0 new features
```

### ⭐ 追问模式（核心功能）

> **「搜而不追，等于白搜」** —— 追问是 Huge AI Search 的核心价值！

```
# 第一次搜索：了解概况
搜索 React 状态管理方案有哪些

# 追问 1：场景化
那如果是中小型项目，团队只有 3 人，应该选哪个？

# 追问 2：深入细节
Zustand 具体怎么用？有什么最佳实践？

# 追问 3：避坑
使用 Zustand 有哪些常见的坑要避免？
```

**追问策略**：

- 🎯 **场景化追问**：「如果我的场景是 XXX，应该怎么做？」
- 🔍 **细节追问**：「刚才提到的 XXX，能详细说说吗？」
- ⚖️ **对比追问**：「A 和 B 在我的场景下哪个更好？」
- ⚠️ **避坑追问**：「这个方案有什么潜在的坑？」

## 工具参数

| 参数           | 必需 | 默认值    | 说明                                                 |
| -------------- | ---- | --------- | ---------------------------------------------------- |
| `query`      | ✅   | -         | 搜索问题（使用自然语言提问）                         |
| `language`   | ❌   | `zh-CN` | 结果语言（zh-CN, en-US, ja-JP, ko-KR, de-DE, fr-FR） |
| `follow_up`  | ❌   | `false` | 追问模式：在当前对话上下文中追问                     |
| `session_id` | ❌   | 自动生成  | 会话 ID：用于多窗口独立追问                          |
| `image_path` | ❌   | -         | 本地图片绝对路径；当前为单图输入（可与文本问题一起发送） |

> 说明：传入 `image_path` 时会自动按“新搜索”处理（不走追问复用链路）。

## 多会话支持

- 首次搜索自动生成 `session_id` 并在结果中返回
- 追问时传入相同的 `session_id` 继续该会话
- 最多支持 5 个并发会话
- 会话 10 分钟无活动自动清理
- 支持**跨项目/跨进程**全局并发协调（基于 `~/.huge-ai-search/coordinator/` 锁目录）

## 常见问题

### Q: 报错「未找到 Microsoft Edge 浏览器」？

A: 本工具仅支持 Edge 浏览器。请从 [microsoft.com/edge](https://www.microsoft.com/edge) 下载安装。

### Q: 搜索结果显示「地区不可用」？

A: 需要配置代理访问 Google。工具会先自动检测常见本地代理端口（如 7890、10809、10808、7891、7897、20171 等），再尝试低置信度端口（如 8080、8443、80、443）。如果你本地跑了 Web 服务，建议直接设置 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 环境变量，避免误判。

### Q: 验证码弹窗后怎么办？

A: 在弹出的浏览器窗口中完成验证，验证成功后会自动继续搜索。

### Q: 为什么提示 nodriver 启动失败？

A: 请先确认 Python 和 nodriver 可用：

```bash
python --version
python -m pip install -U nodriver>=0.48.1
```

可选环境变量：

- `HUGE_AI_SEARCH_AUTH_DRIVER=playwright`：禁用 nodriver，强制走 Playwright 验证流程
- `HUGE_AI_SEARCH_IMAGE_DRIVER=playwright`：禁用 nodriver 图片搜索，强制走 Playwright 图片流程
- `HUGE_AI_SEARCH_NODRIVER_PYTHON=/path/to/python`：指定 Python 可执行文件
- `HUGE_AI_SEARCH_NODRIVER_WAIT_SECONDS=300`：nodriver 等待人工验证的超时秒数（30-900）
- `HUGE_AI_SEARCH_NODRIVER_IMAGE_TIMEOUT_SECONDS=85`：nodriver 图片搜索等待 AI 输出超时秒数（25-300）
- `HUGE_AI_SEARCH_NODRIVER_HEADLESS=1`：让 nodriver 使用 headless（默认 `0`，更利于规避风控）

### Q: 登录状态保存在哪里？

A: 保存在用户目录下的 `~/.huge-ai-search/browser_data/` 文件夹中。

### Q: 运行日志在哪里？如何发给开发者排查？

A: 默认日志目录是 `~/.huge-ai-search/logs/`，按天落盘，文件名示例：`search_2026-02-06.log`。

- Windows: `C:\Users\<用户名>\.huge-ai-search\logs\`
- macOS: `/Users/<用户名>/.huge-ai-search/logs/`
- Linux: `/home/<用户名>/.huge-ai-search/logs/`

排查时，直接把该目录下最近的 `search_*.log` 文件打包发送即可。

可选环境变量：

- `HUGE_AI_SEARCH_LOG_DIR`：自定义日志目录
- `HUGE_AI_SEARCH_LOG_RETENTION_DAYS`：日志保留天数（默认 14 天）
- `HUGE_AI_SEARCH_STRICT_GROUNDING`：严格防幻觉开关（默认 `1` 开启，设为 `0` 关闭）
- `HUGE_AI_SEARCH_GUARDRAIL_PROMPT`：覆盖默认防幻觉提示词（可自定义检索/拒答策略）

> 语义说明：当严格模式命中“无可验证记录”拒答时，表示“当前未检索到可验证权威来源”，不代表该词条绝对不存在。

默认并发策略为“均衡模式”（内置固定值）：

- 单进程并发：`3`
- 跨项目全局并发：`4`
- 本地排队等待：`6s`
- 全局排队等待：`8s`
- 单次执行超时：`42s`
- 单次总预算：`55s`（优先避免客户端 `60s` deadline 超时）

### Q: 如何清除登录状态？

A: 删除 `~/.huge-ai-search/browser_data/` 文件夹即可。

### Q: 如何手动完成登录/验证？

A: 运行以下命令会弹出浏览器窗口，完成登录后关闭即可：

```bash
npx -y -p huge-ai-search@latest huge-ai-search-setup
```

## 技术栈

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Auth Browser**: nodriver（默认）/ Playwright（回退）
- **Search Engine**: Microsoft Edge (via Playwright)
- **MCP SDK**: @modelcontextprotocol/sdk

## License

MIT

