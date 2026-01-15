"""
Patchright MCP Server

提供防检测浏览器自动化功能的 MCP 服务器。
可替代 fetch（当被阻止时）和 playwright MCP（当被检测时）。
"""

import asyncio
import base64
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent

from .browser import PatchrightBrowser, BrowserResult


# Login timeout cooldown mechanism
_login_timeout_timestamp: Optional[float] = None
_LOGIN_COOLDOWN_SECONDS = 300  # 5 minutes


def _is_login_timeout_error(error: str) -> bool:
    """Determine if an error indicates a login/verification timeout.
    
    Args:
        error: The error message string
        
    Returns:
        True if the error indicates a login timeout, False otherwise
    """
    timeout_keywords = [
        "验证超时",
        "登录超时",
        "timeout",
        "captcha",
        "验证码",
        "login required",
        "authentication",
    ]
    error_lower = error.lower()
    return any(keyword.lower() in error_lower for keyword in timeout_keywords)


def _check_cooldown() -> Optional[TextContent]:
    """Check if server is in cooldown state and return message if so.
    
    Returns:
        TextContent with cooldown message if in cooldown, None otherwise
    """
    global _login_timeout_timestamp
    
    if _login_timeout_timestamp is None:
        return None
    
    elapsed = time.time() - _login_timeout_timestamp
    
    if elapsed < _LOGIN_COOLDOWN_SECONDS:
        remaining = int(_LOGIN_COOLDOWN_SECONDS - elapsed)
        remaining_min = remaining // 60
        remaining_sec = remaining % 60
        return TextContent(
            type="text",
            text=f"⏸️ Patchright 浏览器工具暂时不可用\n\n"
                 f"上次操作需要用户登录验证但超时未完成（可能用户不在电脑前）。\n"
                 f"冷却剩余: {remaining_min} 分 {remaining_sec} 秒\n\n"
                 f"**建议**: 如果这是新的对话，用户可能已经回来了，可以告知用户手动触发重试。\n"
                 f"或者使用其他工具（如 fetch MCP）作为替代。"
        )
    else:
        # Cooldown expired, reset state

server = Server("patchright-mcp")

# 创建浏览器实例
browser = PatchrightBrowser(headless=True, timeout=30)

# 线程池
_executor = ThreadPoolExecutor(max_workers=2)


def _html_to_markdown(html: str) -> str:
    """将 HTML 转换为 Markdown"""
    try:
        from markdownify import markdownify
        return markdownify(html, heading_style="ATX", strip=['script', 'style'])
    except ImportError:
        return html


@server.list_tools()
async def list_tools() -> list[Tool]:
    """列出可用工具"""
    return [
        Tool(
            name="patchright_fetch",
            description="""使用防检测浏览器抓取网页内容。

适用场景:
- 普通 HTTP 请求被 Cloudflare/DataDome 等反爬虫系统阻止
- 需要渲染 JavaScript 动态内容
- 需要绕过机器人检测

特点: 使用 Patchright 防检测技术，模拟真实浏览器行为。""",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "要抓取的网页 URL"
                    },
                    "wait_for": {
                        "type": "string",
                        "description": "等待出现的 CSS 选择器（可选，用于动态内容）"
                    },
                    "format": {
                        "type": "string",
                        "enum": ["text", "markdown", "html"],
                        "default": "markdown",
                        "description": "返回格式：text（纯文本）、markdown（默认）、html"
                    }
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="patchright_screenshot",
            description="""使用防检测浏览器截取网页截图。

适用场景:
- 需要查看网页视觉效果
- 验证页面渲染结果
- 捕获动态内容的视觉状态""",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "要截图的网页 URL"
                    },
                    "full_page": {
                        "type": "boolean",
                        "default": False,
                        "description": "是否截取整个页面（包括滚动区域）"
                    }
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="patchright_click",
            description="""在网页上点击指定元素。

适用场景:
- 需要点击按钮加载更多内容
- 触发 JavaScript 交互
- 展开折叠内容""",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "目标网页 URL"
                    },
                    "selector": {
                        "type": "string",
                        "description": "要点击元素的 CSS 选择器"
                    }
                },
                "required": ["url", "selector"]
            }
        ),
        Tool(
            name="patchright_fill_form",
            description="""填写并提交网页表单。

适用场景:
- 登录页面
- 搜索表单
- 数据提交""",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "表单页面 URL"
                    },
                    "fields": {
                        "type": "object",
                        "description": "字段映射，格式: {\"CSS选择器\": \"值\"}",
                        "additionalProperties": {"type": "string"}
                    },
                    "submit_selector": {
                        "type": "string",
                        "description": "提交按钮的 CSS 选择器（可选）"
                    }
                },
                "required": ["url", "fields"]
            }
        ),
        Tool(
            name="patchright_execute_js",
            description="""在网页上执行 JavaScript 代码。

适用场景:
- 提取复杂数据结构
- 触发自定义交互
- 获取页面状态""",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "目标网页 URL"
                    },
                    "script": {
                        "type": "string",
                        "description": "要执行的 JavaScript 代码（应返回结果）"
                    }
                },
                "required": ["url", "script"]
            }
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent | ImageContent]:
    """执行工具调用"""
    loop = asyncio.get_running_loop()
    
    if name == "patchright_fetch":
        url = arguments.get("url", "")
        wait_for = arguments.get("wait_for")
        fmt = arguments.get("format", "markdown")
        
        if not url:
            return [TextContent(type="text", text="错误: 请提供 URL")]
        
        result = await loop.run_in_executor(_executor, browser.fetch, url, wait_for)
        
        if not result.success:
            return [TextContent(type="text", text=f"抓取失败: {result.error}")]
        
        if fmt == "html":
            content = result.html
        elif fmt == "text":
            content = result.content
        else:  # markdown
            content = _html_to_markdown(result.html)
        
        output = f"## {result.title}\n\n**URL**: {result.url}\n\n{content}"
        return [TextContent(type="text", text=output)]
    
    elif name == "patchright_screenshot":
        url = arguments.get("url", "")
        full_page = arguments.get("full_page", False)
        
        if not url:
            return [TextContent(type="text", text="错误: 请提供 URL")]
        
        result = await loop.run_in_executor(_executor, browser.screenshot, url, full_page)
        
        if not result.success:
            return [TextContent(type="text", text=f"截图失败: {result.error}")]
        
        # 返回 base64 编码的图片
        img_base64 = base64.b64encode(result.screenshot).decode('utf-8')
        return [
            TextContent(type="text", text=f"截图: {result.title} ({result.url})"),
            ImageContent(type="image", data=img_base64, mimeType="image/png")
        ]
    
    elif name == "patchright_click":
        url = arguments.get("url", "")
        selector = arguments.get("selector", "")
        
        if not url or not selector:
            return [TextContent(type="text", text="错误: 请提供 URL 和选择器")]
        
        result = await loop.run_in_executor(_executor, browser.click, url, selector)
        
        if not result.success:
            return [TextContent(type="text", text=f"点击失败: {result.error}")]
        
        content = _html_to_markdown(result.html)
        output = f"## 点击后页面\n\n**URL**: {result.url}\n**标题**: {result.title}\n\n{content}"
        return [TextContent(type="text", text=output)]
    
    elif name == "patchright_fill_form":
        url = arguments.get("url", "")
        fields = arguments.get("fields", {})
        submit_selector = arguments.get("submit_selector")
        
        if not url or not fields:
            return [TextContent(type="text", text="错误: 请提供 URL 和字段")]
        
        result = await loop.run_in_executor(
            _executor, browser.fill_form, url, fields, submit_selector
        )
        
        if not result.success:
            return [TextContent(type="text", text=f"表单提交失败: {result.error}")]
        
        content = _html_to_markdown(result.html)
        output = f"## 表单提交结果\n\n**URL**: {result.url}\n**标题**: {result.title}\n\n{content}"
        return [TextContent(type="text", text=output)]
    
    elif name == "patchright_execute_js":
        url = arguments.get("url", "")
        script = arguments.get("script", "")
        
        if not url or not script:
            return [TextContent(type="text", text="错误: 请提供 URL 和脚本")]
        
        result = await loop.run_in_executor(_executor, browser.execute_js, url, script)
        
        if not result.success:
            return [TextContent(type="text", text=f"执行失败: {result.error}")]
        
        output = f"## JavaScript 执行结果\n\n**URL**: {result.url}\n\n```\n{result.content}\n```"
        return [TextContent(type="text", text=output)]
    
    else:
        raise ValueError(f"未知工具: {name}")


async def main():
    """主入口"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )


def run():
    """同步入口点"""
    asyncio.run(main())


if __name__ == "__main__":
    run()
