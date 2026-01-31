"""Huge AI Search MCP Server

使用 nodriver（防检测浏览器自动化库）抓取虎哥 AI 模式搜索结果的 MCP 服务器。
"""

from .searcher import AsyncGoogleAISearcher, GoogleAISearcher, SearchResult, SearchSource

__version__ = "0.1.0"
__all__ = ["AsyncGoogleAISearcher", "GoogleAISearcher", "SearchResult", "SearchSource"]
