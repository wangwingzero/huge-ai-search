# Huge AI Search MCP Server

🔍 AI 搜索聚合 MCP 服务器 - 获取 AI 总结的搜索结果。

## 特性

- 🤖 获取 AI 总结的搜索结果
- 🌐 支持多语言搜索
- 🔐 验证码自动弹窗处理
- 💾 登录状态持久化

## 安装

```bash
npm install -g huge-ai-search
```

或使用 npx 直接运行：

```bash
npx huge-ai-search
```

## MCP 配置

### Claude Desktop / Kiro / Cursor

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "npx",
      "args": ["huge-ai-search"]
    }
  }
}
```

### 本地开发

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

## 开发

```bash
# 安装依赖
npm install

# 安装浏览器驱动
npx playwright install chromium

# 构建
npm run build

# 运行
npm start
```

## 首次使用

首次使用时可能需要完成验证码验证：

```bash
npx ts-node setup-browser.ts
```

这会打开浏览器窗口，完成验证后登录状态会被保存。

## 工具参数

| 参数 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | ✅ | - | 搜索问题（使用自然语言） |
| `language` | ❌ | `zh-CN` | 结果语言 |
| `follow_up` | ❌ | `false` | 是否在当前对话上下文中追问 |

## Python 版本

Python 版本位于 `python/` 文件夹，详见 [python/README.md](python/README.md)。

## License

MIT
