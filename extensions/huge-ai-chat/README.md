# HUGE

在 VS Code 里直接和 HUGE AI 对话，不用切网页。  
适合代码问答、技术检索、资料核对和基于上下文持续追问。

## 为什么用 HUGE

- 就在编辑器侧边栏聊天，专注不被打断
- 支持连续对话，问题可以越问越深
- 回答附带来源链接，方便核实
- 选中代码可一键发送，减少复制粘贴
- 支持截图粘贴，图文一起问更高效

## 你可以这样用

1. 打开命令面板，运行 `HUGE: Open Chat`
2. 首次使用按提示完成登录
3. 直接提问，或先选中代码再点“发送到 Huge”

## 核心体验

- 历史会话自动保存，可随时搜索和切换
- 发送前可编辑内容，避免误发
- 登录状态异常时可一键重新 Setup
- 多张截图会自动合并后发送，减少上传失败

## 主要命令

- `HUGE: Open Chat`
- `HUGE: New Thread`
- `HUGE: Run Login Setup`
- `HUGE: Clear History`
- `发送到 Huge`

## 常用设置

- `hugeAiChat.defaultLanguage`：默认语言
- `hugeAiChat.maxThreads`：本地保留会话数量

高级用户可配置 MCP 启动参数：

- `hugeAiChat.mcp.command`
- `hugeAiChat.mcp.args`
- `hugeAiChat.mcp.cwd`
- `hugeAiChat.mcp.env`

## 隐私与说明

- 会话历史保存在 VS Code 本地存储中
- 回答中的来源链接可直接打开进行二次核验
- 当检索不到可验证来源时，模型可能返回“无可验证记录”

---

如果这个插件帮到了你，欢迎评分与反馈，帮助我们持续改进体验。
