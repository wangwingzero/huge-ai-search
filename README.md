# Huge AI Search MCP Server

🔍 AI 搜索聚合 MCP 服务器 - 获取 Google AI Mode 总结的搜索结果

[![NPM Version](https://img.shields.io/npm/v/huge-ai-search?color=red)](https://www.npmjs.com/package/huge-ai-search) [![MIT licensed](https://img.shields.io/npm/l/huge-ai-search)](./LICENSE)

## ⚠️ 前置条件

### 1. 安装 Microsoft Edge 浏览器（必需）

本工具**仅支持 Microsoft Edge 浏览器**，不支持 Chrome 或其他浏览器。

| 平台              | 安装方式                                                     |
| ----------------- | ------------------------------------------------------------ |
| **Windows** | 系统自带，无需安装                                           |
| **macOS**   | 从[microsoft.com/edge](https://www.microsoft.com/edge) 下载安装 |
| **Linux**   | `sudo apt install microsoft-edge-stable` 或从官网下载      |

### 2. 登录 Google 账户（推荐）

为了获得最佳搜索体验，建议提前登录 Google 账户：

```bash
# 方法 1：克隆仓库后运行设置脚本
git clone https://github.com/wanghui5801/huge-ai-search.git
cd huge-ai-search
npm install
npx ts-node setup-browser.ts
```

运行后会打开 Edge 浏览器窗口，请：

1. 完成 Google 账户登录
2. 如有验证码，完成验证
3. 关闭浏览器窗口

登录状态会保存到 `browser_data/storage_state.json`，后续搜索无需重复登录。

> **注意**：如果不登录，首次搜索时可能会遇到验证码，工具会自动弹出浏览器窗口让你完成验证。

### 3. 代理设置（中国大陆用户）

如果你在中国大陆，需要配置代理才能访问 Google：

- 工具会自动检测常见代理端口（10809、7890 等）
- 也可以设置环境变量：`HTTP_PROXY=http://127.0.0.1:10809`

## 特性

- 🤖 **AI 总结** - 获取 Google AI Mode 的搜索结果，而非原始网页
- 🔄 **追问对话** - 支持在同一会话中追问，获取更深入的答案
- 🌐 **多语言支持** - 支持中文、英文、日文、韩文等
- 🔐 **验证码处理** - 检测到验证码时自动弹出浏览器窗口
- 💾 **状态持久化** - 保存登录状态，避免重复验证
- 🚀 **多会话并发** - 支持多个独立会话同时进行

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

编辑 Cline MCP 设置，添加相同配置。

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

## 多会话支持

- 首次搜索自动生成 `session_id` 并在结果中返回
- 追问时传入相同的 `session_id` 继续该会话
- 最多支持 5 个并发会话
- 会话 10 分钟无活动自动清理

## 常见问题

### Q: 报错「未找到 Microsoft Edge 浏览器」？

A: 本工具仅支持 Edge 浏览器。请从 [microsoft.com/edge](https://www.microsoft.com/edge) 下载安装。

### Q: 搜索结果显示「地区不可用」？

A: 需要配置代理访问 Google。工具会自动检测 10809、7890 等常见代理端口，或设置 `HTTP_PROXY` 环境变量。

### Q: 验证码弹窗后怎么办？

A: 在弹出的浏览器窗口中完成验证，验证成功后会自动继续搜索。

### Q: 登录状态保存在哪里？

A: 保存在 `browser_data/storage_state.json`，包含 cookies，请勿分享。

### Q: 如何清除登录状态？

A: 删除 `browser_data/` 文件夹即可。

## 开发

```bash
# 克隆仓库
git clone https://github.com/wanghui5801/huge-ai-search.git
cd huge-ai-search

# 安装依赖
npm install

# 构建
npm run build

# 运行
npm start
```

## 技术栈

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Browser**: Microsoft Edge (via Playwright)
- **MCP SDK**: @modelcontextprotocol/sdk

## License

MIT

## 联系

- GitHub Issues: [提交问题](https://github.com/wangwingzero/huge-ai-search/issues)
- GitHub: [wangwingzero](https://github.com/wangwingzero)
