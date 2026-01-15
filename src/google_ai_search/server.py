"""
Google AI Search MCP Server

提供 Google AI 搜索功能的 MCP 服务器。
"""

import asyncio
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from .searcher import GoogleAISearcher, SearchResult


# 创建 MCP Server
server = Server("google-ai-search")

# 创建搜索器实例（使用持久化用户数据目录）
searcher = GoogleAISearcher(headless=True, use_user_data=True, timeout=60)


@server.list_tools()
async def list_tools() -> list[Tool]:
    """列出可用的工具"""
    return [
        Tool(
            name="google_ai_search",
            description="""使用 Google AI 模式搜索，获取 AI 总结的搜索结果。

触发关键词: 谷歌、Google、搜索、search、查询、查找、搜一下、帮我搜、网上查、最新信息、实时信息

适用场景:
- 需要获取最新、实时的信息（如新闻、技术动态、产品发布）
- 需要 AI 总结的综合答案而非原始网页列表
- 查询技术问题、编程问题、API 用法
- 了解某个话题的概述和要点
- 需要带来源引用的可靠信息

特点: 使用 Patchright 防检测技术，支持中英文搜索，返回 AI 总结 + 来源链接。""",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或自然语言问题。支持中文、英文或混合查询。例如: 'Python asyncio 最佳实践'、'2024年最流行的前端框架'、'如何配置 nginx 反向代理'"
                    },
                    "language": {
                        "type": "string",
                        "description": "搜索结果语言。zh-CN 返回中文结果，en-US 返回英文结果。根据查询内容自动选择合适的语言。",
                        "default": "zh-CN",
                        "enum": ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR"]
                    }
                },
                "required": ["query"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """执行工具调用"""
    if name != "google_ai_search":
        raise ValueError(f"未知工具: {name}")
    
    query = arguments.get("query", "")
    language = arguments.get("language", "zh-CN")
    
    if not query:
        return [TextContent(type="text", text="错误: 请提供搜索关键词")]
    
    # 执行搜索
    result = searcher.search(query, language)
    
    if not result.success:
        return [TextContent(type="text", text=f"搜索失败: {result.error}")]
    
    # 格式化输出
    output = format_search_result(result)
    
    return [TextContent(type="text", text=output)]


def format_search_result(result: SearchResult) -> str:
    """格式化搜索结果为 Markdown
    
    Args:
        result: SearchResult 对象
        
    Returns:
        Markdown 格式的字符串
    """
    output = f"## Google AI 搜索结果\n\n"
    output += f"**查询**: {result.query}\n\n"
    output += f"### AI 回答\n\n{result.ai_answer}\n\n"
    
    if result.sources:
        output += f"### 来源 ({len(result.sources)} 个)\n\n"
        for i, source in enumerate(result.sources[:5], 1):
            output += f"{i}. [{source.title}]({source.url})\n"
    
    return output


async def main():
    """主入口"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream, 
            write_stream,
            server.create_initialization_options()
        )


def run():
    """同步入口点，供命令行使用"""
    asyncio.run(main())


if __name__ == "__main__":
    run()
