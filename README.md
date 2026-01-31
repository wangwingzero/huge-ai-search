# Huge AI Search MCP Server

🔍 AI 搜索聚合 MCP 服务器 - 获取 AI 总结的搜索结果

[![NPM Version](https://img.shields.io/npm/v/huge-ai-search?color=red)](https://www.npmjs.com/package/huge-ai-search) [![MIT licensed](https://img.shields.io/npm/l/huge-ai-search)](./LICENSE)

## ❌ 没有 Huge AI Search

- ❌ AI 助手无法获取最新信息
- ❌ 回答基于过时的训练数据
- ❌ 无法验证实时信息的准确性

## ✅ 使用 Huge AI Search

Huge AI Search 让你的 AI 助手能够实时搜索并获取 AI 总结的搜索结果：

- ✅ 获取最新、实时的信息
- ✅ AI 总结的搜索结果，直接可用
- ✅ 支持多语言搜索
- ✅ 自动处理验证码，弹窗让用户完成验证

## 特性

- 🤖 **AI 总结** - 获取 AI 模式的搜索结果，而非原始网页
- 🌐 **多语言支持** - 支持中文、英文、日文、韩文等
- 🔐 **验证码处理** - 检测到验证码时自动弹出浏览器窗口
- 💾 **状态持久化** - 保存登录状态，避免重复验证
- 🚀 **简单易用** - 一行命令即可安装使用

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

## MCP 配置

### Cursor

进入：`Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

编辑 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search"]
    }
  }
}
```

### Claude Code

运行命令添加 MCP 服务器：

```sh
claude mcp add huge-ai-search -- npx -y huge-ai-search
```

### Kiro

编辑 `~/.kiro/settings/mcp.json`：

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search"]
    }
  }
}
```

### Windsurf

编辑 `~/.windsurf/mcp.json`：

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search"]
    }
  }
}
```

### VS Code + Cline

编辑 Cline MCP 设置：

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["-y", "huge-ai-search"]
    }
  }
}
```

### 本地开发

如果你克隆了仓库进行本地开发：

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "node",
      "args": ["<项目路径>/dist/index.js"]
    }
  }
}
```

## 使用方法

### 基本搜索

在 AI 助手中直接提问，工具会自动被调用：

```
搜索一下 React 19 有什么新特性
```

### 指定语言

```
用英文搜索 TypeScript 5.0 new features
```

### 追问模式

```
继续追问上一个问题的细节
```

## 工具参数

| 参数 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | ✅ | - | 搜索问题（使用自然语言提问） |
| `language` | ❌ | `zh-CN` | 结果语言（zh-CN, en-US, ja-JP, ko-KR, de-DE, fr-FR） |
| `follow_up` | ❌ | `false` | 是否在当前对话上下文中追问 |

## 首次使用

首次使用时，如果遇到验证码，浏览器窗口会自动弹出，请完成验证后等待自动继续。

也可以提前运行设置脚本完成验证：

```bash
# 克隆仓库后
npx ts-node setup-browser.ts
```

## 开发

```bash
# 克隆仓库
git clone https://github.com/wanghui5801/huge-ai-search.git
cd huge-ai-search

# 安装依赖
npm install

# 安装浏览器驱动
npx playwright install chromium

# 构建
npm run build

# 运行
npm start
```

## Python 版本

Python 版本位于 `python/` 文件夹，详见 [python/README.md](python/README.md)。

```bash
cd python
pip install -e .
python -m huge_ai_search.server
```

## 常见问题

### Q: 验证码弹窗后窗口很快关闭？

A: 这是因为页面已经加载了搜索结果。如果确实需要验证，窗口会等待你完成验证（最长 5 分钟）。

### Q: 如何更换浏览器？

A: 默认使用系统安装的 Chrome。如果没有 Chrome，会使用 Playwright 内置的 Chromium。

### Q: 登录状态保存在哪里？

A: 保存在 `browser_data/storage_state.json`，这个文件包含 cookies，请勿分享。

## 技术栈

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Browser Automation**: Playwright
- **MCP SDK**: @modelcontextprotocol/sdk

## License

MIT

## 🤝 联系我们

- 📢 GitHub Issues: [提交问题](https://github.com/wanghui5801/huge-ai-search/issues)
- 🌐 GitHub: [wanghui5801](https://github.com/wanghui5801)
