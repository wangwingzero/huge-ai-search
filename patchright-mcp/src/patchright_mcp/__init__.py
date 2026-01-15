"""
Patchright MCP Server

防检测浏览器自动化 MCP 服务器，可替代 fetch 和 playwright MCP。
"""

from .browser import PatchrightBrowser, BrowserResult

__all__ = ["PatchrightBrowser", "BrowserResult"]
