<p align="center">
  <img src="./resources/icon.png" alt="Huge AI Search" width="220" />
</p>

<h1 align="center">Huge AI Search MCP Server</h1>

<p align="center">
  把 Google AI Mode 搜索接入到 Cursor、Claude Code、Codex 等客户端，支持连续追问与来源链接。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/huge-ai-search"><img src="https://img.shields.io/npm/v/huge-ai-search?color=red" alt="NPM Version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/huge-ai-search" alt="MIT licensed" /></a>
</p>

## 这是什么

- 让 AI 客户端直接调用 `huge-ai-search` 做联网搜索
- 返回 AI 总结结果 + 来源链接
- 支持同一会话连续追问（更深入）
- 支持文本 + 图片搜索（`image_path`）

## 使用前准备

1. 安装 Microsoft Edge（必需）
2. 首次使用建议先做一次登录验证：

```bash
npx -y -p huge-ai-search@latest huge-ai-search-setup
```

3. 中国大陆用户请配置代理（推荐设置 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`）

## Installation

> [!NOTE]
> Windows 默认推荐：先全局安装 `npm i -g huge-ai-search`，配置里使用 `cmd /c huge-ai-search`。  
> 如需 npx，请写成 `cmd /c npx ...`，不要直接把 `command` 写成 `npx`。

<details>
<summary><b>Quick Install</b></summary>

免安装运行：

```bash
npx huge-ai-search
```

全局安装：

```bash
npm install -g huge-ai-search
```

</details>

<details>
<summary><b>Install in Cursor</b></summary>

配置文件：
- macOS / Linux: `~/.cursor/mcp.json`
- Windows: `%USERPROFILE%\\.cursor\\mcp.json`

macOS / Linux:

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

Windows:

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

</details>

<details>
<summary><b>Install in Claude Code</b></summary>

macOS / Linux:

```sh
claude mcp add huge-ai-search -- npx -y huge-ai-search@latest
```

Windows (PowerShell):

```powershell
claude mcp add-json huge-ai-search -s user '{"command":"cmd", "args":["/c", "huge-ai-search"]}'
```

Windows (CMD):

```cmd
claude mcp add-json huge-ai-search -s user "{\"command\":\"cmd\", \"args\":[\"/c\", \"huge-ai-search\"]}"
```

</details>

<details>
<summary><b>Install in Codex CLI</b></summary>

配置文件：`~/.codex/config.toml`

默认写法：

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

</details>

<details>
<summary><b>Other IDEs and Clients (Use Cursor Template)</b></summary>

以下客户端直接复用 Cursor 的 JSON 模板，仅替换配置文件路径：

- Kiro: `~/.kiro/settings/mcp.json`（Windows: `%USERPROFILE%\\.kiro\\settings\\mcp.json`）
- Windsurf: `~/.codeium/windsurf/mcp_config.json`（Windows: `%APPDATA%\\Codeium\\Windsurf\\mcp_config.json`）
- Claude Desktop:  
  macOS `~/Library/Application Support/Claude/claude_desktop_config.json`  
  Windows `%APPDATA%\\Claude\\claude_desktop_config.json`
- VS Code (GitHub Copilot): 项目根目录 `.vscode/mcp.json`
- VS Code + Cline:  
  macOS `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`  
  Windows `%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json`

</details>

## 怎么用

### 基本搜索

直接让你的 AI 助手调用搜索工具，例如：

- “搜索一下 React 19 有什么新特性”
- “用英文搜索 TypeScript 5.0 new features”

### 连续追问（推荐）

先问概况，再追问细节/场景/避坑，效果最好：

1. 第一次：问整体方案  
2. 第二次：结合你的场景问怎么选  
3. 第三次：问常见坑和最佳实践

### 图片搜索

工具支持传 `image_path`（本地图片绝对路径）进行图文联合搜索。

## 工具参数

| 参数 | 必需 | 默认值 | 说明 |
|---|---|---|---|
| `query` | ✅ | - | 搜索问题（自然语言） |
| `language` | ❌ | `zh-CN` | 结果语言（`zh-CN`/`en-US`/`ja-JP`/`ko-KR`/`de-DE`/`fr-FR`） |
| `follow_up` | ❌ | `false` | 是否在当前会话中追问 |
| `session_id` | ❌ | 自动生成 | 会话 ID（用于多窗口独立追问） |
| `image_path` | ❌ | - | 本地图片绝对路径（单图） |

## 常见问题

### 1) 提示找不到 Edge

请先安装 Microsoft Edge。本工具仅支持 Edge 驱动流程。

### 2) Windows 下 `npx` 启动不稳定

改用：

- `command = "cmd"`
- `args = ["/c", "huge-ai-search"]`

或 npx 兼容写法：

- `command = "cmd"`
- `args = ["/c", "npx", "-y", "huge-ai-search@latest"]`

### 3) 需要登录/验证码怎么办

执行：

```bash
npx -y -p huge-ai-search@latest huge-ai-search-setup
```

按提示在浏览器完成登录/验证后关闭窗口即可。

### 4) 日志在哪

- Windows: `C:\\Users\\<用户名>\\.huge-ai-search\\logs\\`
- macOS: `/Users/<用户名>/.huge-ai-search/logs/`
- Linux: `/home/<用户名>/.huge-ai-search/logs/`

## License

MIT
