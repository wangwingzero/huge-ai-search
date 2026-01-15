"""
Git Proxy MCP Server

自动检测本地代理（v2ray、clash 等）并配置 Git 代理
"""

import socket
import subprocess
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent


# 创建 MCP 服务器
server = Server("git-proxy-mcp")


def detect_proxy() -> dict:
    """检测本地代理端口
    
    Returns:
        包含 http_proxy 和 socks_proxy 的字典
    """
    result = {"http_proxy": None, "socks_proxy": None, "detected": []}
    
    # 常见代理端口配置（HTTP 优先）
    proxy_ports = [
        (10809, "http", "http://127.0.0.1:10809"),      # v2ray HTTP
        (7890, "http", "http://127.0.0.1:7890"),        # clash HTTP
        (10808, "socks5", "socks5://127.0.0.1:10808"),  # v2ray SOCKS5
        (7891, "socks5", "socks5://127.0.0.1:7891"),    # clash SOCKS5
        (1080, "socks5", "socks5://127.0.0.1:1080"),    # 通用 SOCKS5
    ]
    
    for port, proxy_type, proxy_url in proxy_ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            conn_result = sock.connect_ex(('127.0.0.1', port))
            sock.close()
            if conn_result == 0:
                result["detected"].append({"type": proxy_type, "url": proxy_url, "port": port})
                if proxy_type == "http" and not result["http_proxy"]:
                    result["http_proxy"] = proxy_url
                elif proxy_type == "socks5" and not result["socks_proxy"]:
                    result["socks_proxy"] = proxy_url
        except Exception:
            pass
    
    return result


def get_current_config() -> dict:
    """获取当前 Git 代理配置"""
    configs = {}
    keys = ["http.proxy", "https.proxy", "http.https://github.com.proxy"]
    
    for key in keys:
        try:
            result = subprocess.run(
                ["git", "config", "--global", "--get", key],
                capture_output=True, text=True
            )
            configs[key] = result.stdout.strip() or None
        except Exception:
            configs[key] = None
    
    return configs


def set_git_proxy(proxy: str) -> dict:
    """设置 Git 代理"""
    results = {"success": True, "commands": [], "errors": []}
    
    commands = [
        ["git", "config", "--global", "http.proxy", proxy],
        ["git", "config", "--global", "https.proxy", proxy],
        ["git", "config", "--global", "http.https://github.com.proxy", proxy],
    ]
    
    for cmd in commands:
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            results["commands"].append(" ".join(cmd))
        except subprocess.CalledProcessError as e:
            results["success"] = False
            results["errors"].append(f"{' '.join(cmd)}: {e}")
    
    return results


def remove_git_proxy() -> dict:
    """移除 Git 代理配置"""
    results = {"success": True, "commands": [], "errors": []}
    
    commands = [
        ["git", "config", "--global", "--unset", "http.proxy"],
        ["git", "config", "--global", "--unset", "https.proxy"],
        ["git", "config", "--global", "--unset", "http.https://github.com.proxy"],
    ]
    
    for cmd in commands:
        try:
            subprocess.run(cmd, capture_output=True)
            results["commands"].append(" ".join(cmd))
        except Exception:
            pass  # 忽略 unset 不存在的配置
    
    return results


@server.list_tools()
async def list_tools() -> list[Tool]:
    """列出可用工具"""
    return [
        Tool(
            name="git_proxy_detect",
            description="检测本地运行的代理软件（v2ray、clash 等）",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="git_proxy_status",
            description="查看当前 Git 代理配置状态",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="git_proxy_setup",
            description="自动检测代理并配置 Git 使用该代理（用于加速 GitHub 访问）",
            inputSchema={
                "type": "object",
                "properties": {
                    "proxy": {
                        "type": "string",
                        "description": "手动指定代理地址（可选，如 http://127.0.0.1:7890）。不指定则自动检测"
                    }
                },
                "required": []
            }
        ),
        Tool(
            name="git_proxy_remove",
            description="移除 Git 代理配置（恢复直连）",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """处理工具调用"""
    
    if name == "git_proxy_detect":
        proxy_info = detect_proxy()
        
        if not proxy_info["detected"]:
            text = "## 代理检测结果\n\n未检测到运行中的代理软件。\n\n请确保 v2ray、clash 或其他代理软件正在运行。"
        else:
            lines = ["## 代理检测结果\n"]
            lines.append("检测到以下代理：\n")
            for p in proxy_info["detected"]:
                lines.append(f"- **{p['type'].upper()}**: `{p['url']}` (端口 {p['port']})")
            
            lines.append("\n### 推荐使用")
            if proxy_info["http_proxy"]:
                lines.append(f"- HTTP 代理（推荐）: `{proxy_info['http_proxy']}`")
            if proxy_info["socks_proxy"]:
                lines.append(f"- SOCKS5 代理: `{proxy_info['socks_proxy']}`")
            
            text = "\n".join(lines)
        
        return [TextContent(type="text", text=text)]
    
    elif name == "git_proxy_status":
        config = get_current_config()
        proxy_info = detect_proxy()
        
        lines = ["## Git 代理配置状态\n"]
        lines.append("### 当前配置\n")
        
        has_config = False
        for key, value in config.items():
            status = f"`{value}`" if value else "_(未设置)_"
            lines.append(f"- `{key}`: {status}")
            if value:
                has_config = True
        
        if not has_config:
            lines.append("\n> Git 当前未配置代理，使用直连模式")
        
        lines.append("\n### 本地代理状态\n")
        if proxy_info["detected"]:
            for p in proxy_info["detected"]:
                lines.append(f"- {p['type'].upper()}: `{p['url']}` ✓ 运行中")
        else:
            lines.append("- 未检测到运行中的代理")
        
        return [TextContent(type="text", text="\n".join(lines))]
    
    elif name == "git_proxy_setup":
        proxy = arguments.get("proxy")
        
        if not proxy:
            # 自动检测
            proxy_info = detect_proxy()
            proxy = proxy_info["http_proxy"] or proxy_info["socks_proxy"]
            
            if not proxy:
                return [TextContent(
                    type="text",
                    text="## 配置失败\n\n未检测到运行中的代理软件。请先启动 v2ray、clash 或其他代理工具，或手动指定代理地址。"
                )]
        
        result = set_git_proxy(proxy)
        config = get_current_config()
        
        if result["success"]:
            lines = ["## Git 代理配置成功 ✓\n"]
            lines.append(f"已配置代理: `{proxy}`\n")
            lines.append("### 执行的命令\n")
            for cmd in result["commands"]:
                lines.append(f"- `{cmd}`")
            lines.append("\n### 当前配置\n")
            for key, value in config.items():
                lines.append(f"- `{key}`: `{value}`")
            lines.append("\n现在可以正常使用 `git push` / `git pull` 访问 GitHub 了！")
        else:
            lines = ["## 配置失败\n"]
            for err in result["errors"]:
                lines.append(f"- {err}")
        
        return [TextContent(type="text", text="\n".join(lines))]
    
    elif name == "git_proxy_remove":
        remove_git_proxy()
        config = get_current_config()
        
        lines = ["## Git 代理已移除 ✓\n"]
        lines.append("Git 现在使用直连模式。\n")
        lines.append("### 当前配置\n")
        for key, value in config.items():
            status = f"`{value}`" if value else "_(未设置)_"
            lines.append(f"- `{key}`: {status}")
        
        return [TextContent(type="text", text="\n".join(lines))]
    
    else:
        return [TextContent(type="text", text=f"未知工具: {name}")]


async def run_server():
    """运行 MCP 服务器"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )


def main():
    """入口函数"""
    asyncio.run(run_server())


if __name__ == "__main__":
    main()
