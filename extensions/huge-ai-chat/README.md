# Huge AI Chat (VS Code Extension)

在 VS Code 内提供独立聊天窗口，复用 `huge-ai-search` MCP Server，直接向 Google AI Mode 提问并显示回复。

## 功能

- 独立 Webview 聊天窗口（无需打开浏览器页面提问）
- 复用现有 MCP `search` 工具能力
- 线程化会话（支持追问上下文）
- 历史记录持久化到 VS Code `globalState`
- 验证异常自动触发 `huge-ai-search-setup`

## 命令

- `Huge AI Chat: Open Chat`
- `Huge AI Chat: New Thread`
- `Huge AI Chat: Run Login Setup`
- `Huge AI Chat: Clear History`

## 配置

- `hugeAiChat.defaultLanguage`
- `hugeAiChat.maxThreads`
- `hugeAiChat.mcp.command`
- `hugeAiChat.mcp.args`
- `hugeAiChat.mcp.cwd`
- `hugeAiChat.mcp.env`

## 本地开发

```bash
cd extensions/huge-ai-chat
npm install
npm run test
```

然后按 `F5` 启动 Extension Development Host。

## 打包

```bash
cd extensions/huge-ai-chat
npm run package:vsix
```

生成文件：`artifacts/huge-ai-chat.vsix`。

本地安装：

```bash
code --install-extension artifacts/huge-ai-chat.vsix
```

## 发布

本仓库内置 GitHub Actions 工作流：

- CI 构建与测试：`.github/workflows/huge-ai-chat.yml`
- 发布触发：`release published`、`huge-ai-chat-v*` 标签、或手动 `workflow_dispatch`（`publish=true`）

需要在 GitHub Repository Secrets 配置：

- `VSCE_PAT`：Visual Studio Marketplace 发布令牌
- `OVSX_PAT`：Open VSX 发布令牌

可选发布触发方式：

- 创建并推送标签：`huge-ai-chat-vX.Y.Z`
- 在 GitHub Releases 发布新 Release
- 手动运行 Actions 并勾选 `publish=true`

## 说明

- 开发模式会优先尝试复用 monorepo 根目录下的 `dist/index.js` 作为 MCP Server。
- 若本地入口不存在，则回退到 `npx -y huge-ai-search@latest`。
- 用户无需手动安装 `huge-ai-search` / `huge-ai-research` MCP；插件会在首次打开后自动预热连接（失败时会在状态区提示如何恢复）。
