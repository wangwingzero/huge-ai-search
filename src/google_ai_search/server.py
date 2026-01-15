"""
Google AI Search MCP Server

提供 Google AI 搜索功能的 MCP 服务器。
"""

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from .searcher import GoogleAISearcher, SearchResult, logger as searcher_logger

# 使用与 searcher 相同的日志器
logger = logging.getLogger("google_ai_search")
logger.info("MCP Server 模块加载")


# 创建 MCP Server
server = Server("google-ai-search")

# 创建搜索器实例（使用持久化用户数据目录）
searcher = GoogleAISearcher(headless=True, use_user_data=True, timeout=60)

# 线程池用于运行同步的 Playwright 代码
_executor = ThreadPoolExecutor(max_workers=1)

# 登录超时冷却机制
# 注意：MCP 服务器无法检测"对话结束"事件，因为它是持久运行的进程
# 使用时间戳来判断是否应该重试，让 AI 助手决定是否在新对话中重试
_login_timeout_timestamp: Optional[float] = None  # 上次登录超时的时间戳
_LOGIN_COOLDOWN_SECONDS = 300  # 冷却时间：5分钟（用户可能回来了）


# 工具描述文本
_TOOL_DESCRIPTION = (
    "使用 Google AI 模式搜索，获取 AI 总结的搜索结果。\n\n"
    "🎯 核心原则：用自然语言提问，不要用关键词堆砌！\n"
    "Google AI 是对话式 AI，像和人说话一样提问效果最好。\n\n"
    "触发关键词: 谷歌、Google、搜索、search、查询、查找、搜一下、帮我搜、网上查、"
    "最新信息、实时信息、最佳实践、best practice、推荐做法、怎么做比较好、业界标准、"
    "行业规范、UI设计、UX设计、用户体验、界面设计、交互设计、设计规范、设计系统、"
    "design system、design pattern、组件设计、布局设计、响应式设计、无障碍设计、accessibility\n\n"
    "适用场景:\n"
    "- 需要获取最新、实时的信息（如新闻、技术动态、产品发布）\n"
    "- 需要 AI 总结的综合答案而非原始网页列表\n"
    "- 查询技术问题、编程问题、API 用法\n"
    "- 了解某个话题的概述和要点\n"
    "- 需要带来源引用的可靠信息\n"
    "- 查询最佳实践、推荐做法、行业标准\n"
    "- UI/UX 设计最佳实践和设计规范\n"
    "- 组件设计模式、交互设计指南\n"
    "- 设计系统参考（Material Design、Ant Design 等）\n"
    "- 响应式布局和无障碍设计标准\n\n"
    "⚠️ 搜索策略指南（重要）:\n"
    "搜索应聚焦于 AI 知识盲区，而非 AI 已知的基础知识：\n\n"
    "✅ 应该搜索:\n"
    "- 实时/时效性信息: 最新版本号、近期发布、当前价格、最新动态\n"
    "- 具体产品/服务细节: 特定 API 的最新用法、某产品的具体配置参数\n"
    "- 行业最新实践: 2024/2025 年的最佳实践、新兴技术趋势\n"
    "- 争议性/无定论问题: 不同方案的优劣对比、社区讨论热点\n"
    "- 小众/冷门知识: 特定框架的边缘用法、罕见错误的解决方案\n\n"
    "❌ 不需要搜索:\n"
    "- 基础概念: 什么是 REST API、JavaScript 闭包原理\n"
    "- 稳定的语法/用法: Python 列表操作、SQL 基本语法\n"
    "- 通用设计模式: 单例模式、观察者模式的基本实现\n"
    "- AI 训练数据内的知识: 经典算法、成熟框架的常规用法\n\n"
    "💡 提问技巧（从搜索思维转变为指令思维）:\n"
    "- 用完整的自然语言句子提问，不要堆砌关键词\n"
    "- 说明具体场景和需求，让 AI 理解你的意图\n"
    "- 可以要求特定输出格式（如「请列出步骤」、「请对比优缺点」）\n"
    "- 复杂问题加上「请一步步分析」引导 AI 展示思考过程\n"
    "- 加上时间限定词（如「2025年」、「最新」）获取时效性信息\n\n"
    "特点: 使用 Patchright 防检测技术，支持中英文搜索，返回 AI 总结 + 来源链接。"
)

_QUERY_DESCRIPTION = (
    "向 Google AI 提问的自然语言问题。\n\n"
    "⚠️ 重要：使用完整的自然语言句子提问，而非关键词堆砌！\n\n"
    "✅ 正确的提问方式（自然语言）:\n"
    "- 「GitHub push 大文件失败怎么解决？有哪些方案？」\n"
    "- 「2025年 React 和 Vue 哪个更适合新项目？各有什么优缺点？」\n"
    "- 「如何在 Python 中实现异步并发？请给出最佳实践和代码示例」\n"
    "- 「Next.js 14 的 App Router 和 Pages Router 有什么区别？该怎么选择？」\n\n"
    "❌ 错误的提问方式（关键词堆砌）:\n"
    "- 「GitHub push 大文件失败 解决方案 2025」\n"
    "- 「React Vue 对比 2025」\n"
    "- 「Python asyncio 最佳实践」\n"
    "- 「Next.js App Router Pages Router 区别」\n\n"
    "💡 提问技巧:\n"
    "1. 像和人对话一样提问，用完整句子\n"
    "2. 说明你的具体场景和需求\n"
    "3. 可以要求特定格式（如「请列出步骤」、「请对比优缺点」）\n"
    "4. 复杂问题可以要求「请一步步分析」"
)


@server.list_tools()
async def list_tools() -> list[Tool]:
    """列出可用的工具"""
    return [
        Tool(
            name="google_ai_search",
            description=_TOOL_DESCRIPTION,
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": _QUERY_DESCRIPTION
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
    global _login_timeout_timestamp
    
    logger.info(f"收到工具调用: name={name}, arguments={arguments}")
    
    if name != "google_ai_search":
        logger.error(f"未知工具: {name}")
        raise ValueError(f"未知工具: {name}")
    
    query = arguments.get("query", "")
    language = arguments.get("language", "zh-CN")
    
    if not query:
        logger.warning("搜索查询为空")
        return [TextContent(type="text", text="错误: 请提供搜索关键词")]
    
    # 检查是否在登录超时冷却期内
    if _login_timeout_timestamp is not None:
        elapsed = time.time() - _login_timeout_timestamp
        if elapsed < _LOGIN_COOLDOWN_SECONDS:
            remaining = int(_LOGIN_COOLDOWN_SECONDS - elapsed)
            remaining_min = remaining // 60
            logger.info(f"处于冷却期，剩余 {remaining_min}分{remaining % 60}秒")
            return [TextContent(
                type="text", 
                text=f"⏸️ Google AI 搜索暂时不可用\n\n"
                     f"上次搜索需要用户登录验证但超时未完成（可能用户不在电脑前）。\n"
                     f"冷却剩余: {remaining_min} 分 {remaining % 60} 秒\n\n"
                     f"**建议**: 如果这是新的对话，用户可能已经回来了，可以告知用户手动触发重试。\n"
                     f"或者使用其他搜索工具（如 exa_web_search）作为替代。"
            )]
        else:
            # 冷却期已过，重置状态
            logger.info("冷却期已过，重置状态")
            _login_timeout_timestamp = None
    
    # 在线程池中执行同步的 Playwright 搜索（避免阻塞 asyncio 事件循环）
    logger.info(f"开始执行搜索: query='{query}', language={language}")
    loop = asyncio.get_running_loop()
    
    try:
        result = await loop.run_in_executor(_executor, searcher.search, query, language)
    except Exception as e:
        logger.error(f"搜索执行异常: {type(e).__name__}: {e}")
        return [TextContent(type="text", text=f"搜索执行异常: {e}")]
    
    logger.info(f"搜索结果: success={result.success}, error={result.error if not result.success else 'N/A'}")
    
    # 检查是否是登录/验证超时错误
    if not result.success and _is_login_timeout_error(result.error):
        logger.warning(f"检测到登录超时错误，启动冷却机制")
        _login_timeout_timestamp = time.time()
        return [TextContent(
            type="text", 
            text=f"⏸️ 搜索需要用户验证但超时\n\n"
                 f"错误: {result.error}\n\n"
                 f"该工具将暂停 {_LOGIN_COOLDOWN_SECONDS // 60} 分钟，避免重复打扰不在场的用户。\n"
                 f"**注意**: 由于 MCP 协议限制，服务器无法检测对话边界。\n"
                 f"如果用户开始新对话，可以建议用户等待冷却期结束或使用其他搜索工具。"
        )]
    
    if not result.success:
        logger.error(f"搜索失败: {result.error}")
        return [TextContent(type="text", text=f"搜索失败: {result.error}")]
    
    # 格式化输出
    output = format_search_result(result)
    logger.info(f"搜索成功，返回结果长度: {len(output)}")
    
    return [TextContent(type="text", text=output)]


def _is_login_timeout_error(error: str) -> bool:
    """判断是否为登录/验证超时错误
    
    Args:
        error: 错误信息
        
    Returns:
        是否为登录超时相关错误
    """
    timeout_keywords = [
        "验证超时",
        "登录超时",
        "timeout",
        "5分钟",
        "captcha",
        "验证码",
    ]
    error_lower = error.lower()
    return any(keyword.lower() in error_lower for keyword in timeout_keywords)


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
