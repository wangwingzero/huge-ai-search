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
            description="使用 Google AI 模式搜索，获取 AI 总结的搜索结果。适合需要快速获取某个问题的综合答案的场景。",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或问题"
                    },
                    "language": {
                        "type": "string",
                        "description": "语言代码，如 zh-CN（中文）、en-US（英文）",
                        "default": "zh-CN"
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
