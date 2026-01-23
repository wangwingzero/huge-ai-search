# Google AI Search MCP Server

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果的 MCP 服务器。

## 🚀 一键安装（推荐）

### 第一步：下载项目

```bash
git clone https://github.com/wangwingzero/google-ai-search-mcp.git
cd google-ai-search-mcp
```

### 第二步：让 AI 自动配置

把下面这段话复制给你的 AI 助手，它会自动完成所有配置：

```
请帮我安装配置当前目录的 google-ai-search-mcp 项目。

执行以下步骤：
1. 创建并激活虚拟环境（python -m venv .venv）
2. 安装项目（pip install -e .）
3. 安装浏览器驱动（patchright install msedge）
4. 获取项目绝对路径，根据我使用的 AI 工具配置 MCP（参考下方配置路径）
5. 完成后提醒我重启 AI 工具
```

---

## 功能

- 🔍 访问 Google AI 模式获取 AI 总结的搜索结果
- 🛡️ 使用 Patchright 绕过反爬检测
- 🌐 支持多语言搜索（中/英/日/韩/德/法）
- 📚 返回 AI 回答和来源链接
- 🔄 支持多轮对话追问

## 各 AI 工具 MCP 配置

安装完成后，根据你使用的工具选择对应配置：

### Kiro

配置文件：`~/.kiro/settings/mcp.json`（Windows: `C:\Users\用户名\.kiro\settings\mcp.json`）

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "项目路径/.venv/Scripts/python.exe",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "项目路径/src"
    }
  }
}
```

### Cursor

配置文件：
- 全局：`~/.cursor/mcp.json`（Windows: `%USERPROFILE%\.cursor\mcp.json`）
- 项目级：`.cursor/mcp.json`

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "项目路径/.venv/Scripts/python.exe",
      "args": ["-m", "google_ai_search.server"],
      "env": {
        "PYTHONPATH": "项目路径/src"
      }
    }
  }
}
```

或通过 GUI：Settings → Cursor Settings → Features → MCP Servers

### Claude Code (CLI)

配置文件：`~/.claude.json` 或项目目录下 `.mcp.json`

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "项目路径/.venv/bin/python",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "项目路径/src"
    }
  }
}
```

或用命令添加：
```bash
claude mcp add google-ai-search 项目路径/.venv/bin/python -- -m google_ai_search.server
```

### OpenAI Codex CLI

先安装 Codex CLI（需要 Node.js）：
```bash
npm install -g @openai/codex
```

配置文件：`~/.codex/config.toml`（Windows: `%USERPROFILE%\.codex\config.toml`）

```toml
[mcp_servers.google-ai-search]
command = "项目路径/.venv/Scripts/python.exe"
args = ["-m", "google_ai_search.server"]
env = { PYTHONPATH = "项目路径/src" }
```

或用命令添加：
```bash
codex mcp add google-ai-search -- 项目路径/.venv/Scripts/python.exe -m google_ai_search.server
```

---

## 手动安装

```bash
cd google-ai-search-mcp

# 创建虚拟环境
python -m venv .venv

# 激活（Windows）
.venv\Scripts\activate
# 激活（Mac/Linux）
# source .venv/bin/activate

# 安装
pip install -e .
patchright install msedge
```

## 使用方法

配置完成后重启 AI 工具，直接对话：
```
请用 Google 搜索：什么是量子计算
```

**首次使用会弹出浏览器窗口**，如果遇到验证码请手动完成，之后就不需要了。

## 工具参数

| 参数 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| query | ✅ | - | 搜索问题 |
| language | ❌ | zh-CN | 语言代码 |
| follow_up | ❌ | false | 是否追问 |

## License

MIT
