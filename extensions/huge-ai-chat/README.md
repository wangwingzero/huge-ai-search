# Huge AI Chat (VS Code Extension)

在 VS Code 内提供独立聊天窗口，复用 `huge-ai-search` MCP Server，直接向 HUGE AI Mode 提问并显示回复。

## 功能

- 独立 Webview 聊天窗口（无需打开浏览器页面提问）
- 复用现有 MCP `search` 工具能力
- 线程化会话（支持追问上下文）
- 编辑器选中代码后可一键发送到 Huge（右键菜单 + 编辑器顶部按钮）
- 发送前会弹出可编辑确认框，默认填充选中文本，确认后新开线程并发送
- 历史记录持久化到 VS Code `globalState`
- 验证异常自动触发 `huge-ai-search-setup`
- 回答中的来源链接可点击，直接在系统浏览器打开核实
- 顶部 `History` 按钮查看历史会话，支持关键词搜索与快速切换
- 输入框支持 `Ctrl+V` 直接粘贴截图并预览
- 多张截图发送时会自动拼接合并为单张图片上传（适配当前单图输入能力）

## 命令

- `Huge AI Chat: Open Chat`
- `Huge AI Chat: New Thread`
- `Huge AI Chat: Run Login Setup`
- `Huge AI Chat: Clear History`
- `Huge AI Chat: 发送到 Huge`

## 配置

- `hugeAiChat.defaultLanguage`
- `hugeAiChat.maxThreads`
- `hugeAiChat.mcp.command`
- `hugeAiChat.mcp.args`
- `hugeAiChat.mcp.cwd`
- `hugeAiChat.mcp.env`

示例：通过 `hugeAiChat.mcp.env` 透传严格防幻觉策略到 MCP 子进程

```json
{
  "hugeAiChat.mcp.env": {
    "HUGE_AI_SEARCH_STRICT_GROUNDING": "1",
    "HUGE_AI_SEARCH_GUARDRAIL_PROMPT": "[HUGE_AI_GUARDRAIL_V1]\n当用户询问技术词条时，先检索官方文档与官方仓库；若无可验证权威来源，直接回答“该词条在当前技术语料库和实时搜索中无可验证记录。”"
  }
}
```

> 语义说明：拒答表示“当前未检索到可验证权威来源”，不等于“绝对不存在”。

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
