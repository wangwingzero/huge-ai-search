# Google AI Search MCP Server

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果的 MCP 服务器。

## 🚀 一键安装（推荐）

**Clone 项目后，把下面这段话复制给你的 AI 助手，它会自动完成所有配置：**

```
请帮我安装配置当前目录的 google-ai-search-mcp 项目。

执行以下步骤：
1. 创建并激活虚拟环境（python -m venv .venv）
2. 安装项目（pip install -e .）
3. 安装浏览器驱动（patchright install msedge）
4. 获取项目绝对路径，配置 MCP：
   - Kiro 配置文件：~/.kiro/settings/mcp.json
   - Claude 配置文件：%APPDATA%\Claude\claude_desktop_config.json
   - 添加 google-ai-search 服务，command 用 .venv 里的 python 绝对路径，cwd 用 src 目录绝对路径
5. 完成后提醒我重启 AI 工具
```

---

## 功能

- 🔍 访问 Google AI 模式获取 AI 总结的搜索结果
- 🛡️ 使用 Patchright 绕过反爬检测
- 🌐 支持多语言搜索（中/英/日/韩/德/法）
- 📚 返回 AI 回答和来源链接
- 🔄 支持多轮对话追问

## 手动安装

如果 AI 自动配置失败，按以下步骤手动操作：

### 1. 安装依赖

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

### 2. 配置 MCP

编辑配置文件，添加以下内容（把路径换成你的实际路径）：

**Kiro** (`~/.kiro/settings/mcp.json`)：
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

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json`)：
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

### 3. 重启 AI 工具

配置完成后重启 Kiro/Claude Desktop 即可使用。

## 使用方法

直接对 AI 说：
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
