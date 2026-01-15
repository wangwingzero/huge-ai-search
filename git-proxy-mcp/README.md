# Git Proxy MCP Server

自动检测本地代理（v2ray、clash 等）并配置 Git 代理的 MCP 服务器。

## 功能

- **git_proxy_detect** - 检测本地运行的代理软件
- **git_proxy_status** - 查看当前 Git 代理配置状态
- **git_proxy_setup** - 自动检测并配置 Git 代理
- **git_proxy_remove** - 移除 Git 代理配置

## 支持的代理软件

- v2ray (HTTP: 10809, SOCKS5: 10808)
- clash (HTTP: 7890, SOCKS5: 7891)
- 通用 SOCKS5 (1080)

## 安装

```bash
cd git-proxy-mcp
pip install -e .
```

## MCP 配置

Kiro (`~/.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "git-proxy": {
      "command": "python",
      "args": ["-m", "git_proxy_mcp.server"],
      "cwd": "D:/google-ai-search-mcp/git-proxy-mcp/src"
    }
  }
}
```

## 使用示例

在 AI 助手中：

- "帮我配置 Git 代理"
- "检测一下本地有没有代理"
- "查看 Git 代理状态"
- "移除 Git 代理"
