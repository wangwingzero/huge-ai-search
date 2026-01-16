# Google AI Search MCP Server

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果的 MCP 服务器。

## 功能

- 🔍 访问 Google AI 模式（udm=50）获取 AI 总结的搜索结果
- 🛡️ 使用 Patchright 绕过反爬检测
- 🌐 支持多语言搜索
- 📚 返回 AI 回答和来源链接
- 🔄 支持多轮对话追问（保持上下文，增量返回新内容）

## 安装

```bash
# 克隆项目
git clone https://github.com/yourname/google-ai-search-mcp.git
cd google-ai-search-mcp

# 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac

# 安装依赖
pip install -e .

# 安装 Patchright 浏览器驱动（可选，会使用系统浏览器）
# patchright install chromium
```

## 配置 MCP

### Kiro 配置

编辑 `~/.kiro/settings/mcp.json`：

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "D:/google-ai-search-mcp/.venv/Scripts/python.exe",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "D:/google-ai-search-mcp/src"
    }
  }
}
```

### Claude Desktop 配置

编辑 `%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "python",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "D:/google-ai-search-mcp/src"
    }
  }
}
```

## 使用

配置完成后，在 Kiro 或 Claude Desktop 中可以直接使用：

```
请用 Google AI 搜索：什么是量子计算
```

## 工具说明

### google_ai_search

使用 Google AI 模式搜索，获取 AI 总结的搜索结果。支持多轮对话追问。

**参数**：
- `query` (必需): 搜索关键词或问题
- `language` (可选): 语言代码，默认 `zh-CN`
- `follow_up` (可选): 是否为追问，默认 `false`
  - `false`: 首次搜索或开启新话题
  - `true`: 在上一次搜索基础上继续对话，只返回新增内容

**返回**：
- AI 生成的综合回答
- 相关来源链接列表

**多轮对话示例**：
```
# 首次搜索
google_ai_search(query="Python 异步编程最佳实践")

# 追问深挖（设置 follow_up: true）
google_ai_search(query="asyncio 和 threading 有什么区别？", follow_up=true)
```

## 开发

```bash
# 安装开发依赖
pip install -e ".[dev]"

# 运行测试
pytest tests/ -v
```
