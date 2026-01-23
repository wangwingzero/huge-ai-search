# Google AI Search MCP Server

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果的 MCP 服务器。

## 功能

- 🔍 访问 Google AI 模式（udm=50）获取 AI 总结的搜索结果
- 🛡️ 使用 Patchright 绕过反爬检测
- 🌐 支持多语言搜索（中/英/日/韩/德/法）
- 📚 返回 AI 回答和来源链接
- 🔄 支持多轮对话追问

## 快速安装（3 步搞定）

### 1. 下载项目

```bash
git clone https://github.com/wangwingzero/google-ai-search-mcp.git
cd google-ai-search-mcp
```

### 2. 安装依赖

```bash
# 创建虚拟环境（推荐）
python -m venv .venv

# 激活虚拟环境
# Windows:
.venv\Scripts\activate
# Mac/Linux:
# source .venv/bin/activate

# 安装项目
pip install -e .

# 安装浏览器驱动
patchright install msedge
```

### 3. 配置 MCP

根据你使用的 AI 工具，选择对应配置：

#### Kiro 配置

编辑 `~/.kiro/settings/mcp.json`（Windows 路径：`C:\Users\你的用户名\.kiro\settings\mcp.json`）：

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "你的项目路径/.venv/Scripts/python.exe",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "你的项目路径/src"
    }
  }
}
```

**示例**（假设项目在 `D:\google-ai-search-mcp`）：
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

#### Claude Desktop 配置

编辑 `%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "你的项目路径/.venv/Scripts/python.exe",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "你的项目路径/src"
    }
  }
}
```

## 首次使用

配置完成后重启 Kiro/Claude Desktop，然后直接对话：

```
请用 Google 搜索：什么是量子计算
```

**首次搜索会弹出浏览器窗口**，这是正常的：
1. 如果遇到 Google 验证码，手动完成验证
2. 验证后浏览器会自动关闭
3. 之后的搜索就不需要再验证了

## 工具参数

| 参数 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| query | ✅ | - | 搜索问题 |
| language | ❌ | zh-CN | 语言：zh-CN, en-US, ja-JP, ko-KR, de-DE, fr-FR |
| follow_up | ❌ | false | 是否追问（保持上下文） |

## 常见问题

### Q: 搜索时报错 "Failed to connect"
A: 检查网络是否能访问 Google

### Q: 浏览器一直弹出
A: 首次使用需要完成 Google 验证，验证后会保存登录状态

### Q: 返回内容是乱码
A: 检查 language 参数是否正确设置

## 开发

```bash
# 安装开发依赖
pip install -e ".[dev]"

# 运行测试
pytest tests/ -v
```

## License

MIT
