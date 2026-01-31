# Huge AI Search MCP Server

使用 nodriver（防检测浏览器自动化库）抓取虎哥 AI 模式搜索结果的 MCP 服务器。

## 🚀 一键安装（推荐）

### 第一步：下载项目

```bash
git clone https://github.com/wangwingzero/huge-ai-search.git
cd huge-ai-search
```

### 第二步：让 AI 自动配置

把下面这段话复制给你的 AI 助手，它会自动完成所有配置：

```
请帮我安装配置当前目录的 huge-ai-search 项目。

执行以下步骤：
1. 创建并激活虚拟环境（python -m venv .venv）
2. 安装项目（pip install -e .）
3. 获取项目绝对路径，根据我使用的 AI 工具配置 MCP（参考下方配置路径）
4. 完成后提醒我：
   - 运行 python login_chrome.py 登录虎哥账号
   - 重启 AI 工具
```

---

## 功能

- 🔍 访问虎哥 AI 模式获取 AI 总结的搜索结果
- 🛡️ 使用 nodriver 绕过反爬检测（内置防检测功能）
- 🌐 支持多语言搜索（中/英/日/韩/德/法）
- 📚 返回 AI 回答和来源链接
- 🔄 支持多轮对话追问
- ⚡ 纯异步 API，高性能并发

## 技术栈

- **浏览器自动化**: nodriver（基于 Chrome DevTools Protocol 的防检测库）
- **协议**: MCP (Model Context Protocol)
- **Python**: 3.10+
- **API 风格**: 纯异步（async/await）

## 各 AI 工具 MCP 配置

安装完成后，根据你使用的工具选择对应配置：

### Kiro

配置文件：`~/.kiro/settings/mcp.json`（Windows: `C:\Users\用户名\.kiro\settings\mcp.json`）

```json
{
  "mcpServers": {
    "huge-ai-search": {
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
    "huge-ai-search": {
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
    "huge-ai-search": {
      "command": "项目路径/.venv/bin/python",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "项目路径/src"
    }
  }
}
```

或用命令添加：
```bash
claude mcp add huge-ai-search 项目路径/.venv/bin/python -- -m google_ai_search.server
```

### OpenAI Codex CLI

先安装 Codex CLI（需要 Node.js）：
```bash
npm install -g @openai/codex
```

配置文件：`~/.codex/config.toml`（Windows: `%USERPROFILE%\.codex\config.toml`）

```toml
[mcp_servers.huge-ai-search]
command = "项目路径/.venv/Scripts/python.exe"
args = ["-m", "google_ai_search.server"]
env = { PYTHONPATH = "项目路径/src" }
```

或用命令添加：
```bash
codex mcp add huge-ai-search -- 项目路径/.venv/Scripts/python.exe -m google_ai_search.server
```

---

## 手动安装

```bash
# 1. 克隆项目
git clone https://github.com/wangwingzero/huge-ai-search.git
cd huge-ai-search

# 2. 创建虚拟环境
python -m venv .venv

# 3. 激活虚拟环境
# Windows:
.venv\Scripts\activate
# Mac/Linux:
# source .venv/bin/activate

# 4. 安装依赖
pip install -e .

# 5. 首次登录（重要！）
python login_chrome.py
```

## 依赖说明

本项目使用以下核心依赖：

| 依赖 | 版本 | 说明 |
|------|------|------|
| `mcp` | >=1.0.0 | Model Context Protocol SDK |
| `nodriver` | >=0.38 | 防检测浏览器自动化库 |

nodriver 是一个基于 Chrome DevTools Protocol 的浏览器自动化库，具有内置的防检测功能，无需额外安装浏览器驱动。

## ⚠️ 首次登录（必须）

安装完成后，**必须先运行登录脚本**保存虎哥账号登录状态：

```bash
python login_chrome.py
```

这会打开 Chrome 浏览器，请手动登录你的虎哥账号，登录成功后关闭浏览器即可。

登录状态会保存到 `chrome_browser_data/` 目录，之后 MCP 服务器会自动使用这个登录状态。

## 使用方法

配置完成后重启 AI 工具，直接对话：
```
请用虎哥搜索：什么是量子计算
```

首次搜索时如果遇到验证码，会弹出浏览器窗口，手动完成验证即可。

## 工具参数

| 参数 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| query | ✅ | - | 搜索问题 |
| language | ❌ | zh-CN | 语言代码 |
| follow_up | ❌ | false | 是否追问 |

## 编程接口

本项目提供异步 API，可在 Python 代码中直接使用：

```python
import asyncio
from google_ai_search import AsyncGoogleAISearcher, SearchResult

async def main():
    # 创建搜索器实例
    searcher = AsyncGoogleAISearcher(
        timeout=60,
        headless=False,  # nodriver 推荐使用有头模式
        use_user_data=True
    )
    
    try:
        # 执行搜索
        result: SearchResult = await searcher.search(
            query="什么是量子计算",
            language="zh-CN"
        )
        
        if result.success:
            print(f"AI 回答: {result.ai_answer}")
            print(f"来源数量: {len(result.sources)}")
            
            # 追问（多轮对话）
            if searcher.has_active_session():
                follow_up_result = await searcher.continue_conversation(
                    query="它有什么实际应用？"
                )
                print(f"追问回答: {follow_up_result.ai_answer}")
        else:
            print(f"搜索失败: {result.error}")
    finally:
        # 关闭会话
        await searcher.close_session()

# 运行
asyncio.run(main())
```

### API 说明

#### AsyncGoogleAISearcher

异步搜索器类，主要方法：

| 方法 | 说明 |
|------|------|
| `async search(query, language)` | 执行搜索，返回 SearchResult |
| `async continue_conversation(query)` | 在当前会话中追问 |
| `async close_session()` | 关闭浏览器会话 |
| `has_active_session()` | 检查是否有活跃会话 |

#### SearchResult

搜索结果数据类：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | bool | 搜索是否成功 |
| `query` | str | 搜索查询 |
| `ai_answer` | str | AI 回答内容 |
| `sources` | List[SearchSource] | 来源列表 |
| `error` | str | 错误信息（失败时） |

## 常见问题

### ModuleNotFoundError: No module named 'nodriver'

依赖未安装。请确保：
1. 已激活虚拟环境：`.venv\Scripts\activate`
2. 已安装依赖：`pip install -e .`

### 搜索失败或返回空结果

1. 确认已运行 `python login_chrome.py` 登录虎哥账号
2. 检查 `chrome_browser_data/` 目录是否存在
3. 如果登录状态过期，重新运行登录脚本

### 浏览器相关问题

nodriver 会自动检测并使用系统安装的浏览器（优先 Chrome，其次 Edge），无需手动安装浏览器驱动。

如果遇到浏览器启动问题：
1. 确保系统已安装 Chrome 或 Microsoft Edge
2. 检查浏览器是否可以正常打开

## 从旧版本迁移

如果你之前使用的是基于 Patchright/Playwright 的版本，请注意以下变化：

1. **依赖变更**: `patchright` → `nodriver`
2. **API 变更**: 同步 API → 异步 API（async/await）
3. **类名变更**: `GoogleAISearcher` → `AsyncGoogleAISearcher`
4. **无需安装驱动**: 不再需要运行 `patchright install msedge`

## License

MIT
