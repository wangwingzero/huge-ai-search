"""Google AI Search MCP Server

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果的 MCP 服务器。
"""

from .searcher import GoogleAISearcher, SearchResult, SearchSource

__version__ = "0.1.0"
__all__ = ["GoogleAISearcher", "SearchResult", "SearchSource"]
