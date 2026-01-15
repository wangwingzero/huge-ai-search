# Google AI Search MCP 实现方案

基于 Patchright（Playwright 防检测分支）实现 Google AI 搜索的 MCP Server。

## 项目结构

```
google-ai-search-mcp/
├── src/
│   └── google_ai_search/
│       ├── __init__.py
│       ├── server.py          # MCP Server 入口
│       └── searcher.py        # 核心搜索逻辑
├── pyproject.toml
├── README.md
└── LICENSE
```

## 核心代码

### 1. searcher.py - 核心搜索逻辑

```python
"""
Google AI Search - 核心搜索逻辑

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果。
"""

import os
import re
from dataclasses import dataclass
from typing import Optional, List
from urllib.parse import quote_plus


@dataclass
class SearchSource:
    """搜索来源"""
    title: str
    url: str
    snippet: str = ""


@dataclass
class SearchResult:
    """搜索结果"""
    success: bool
    query: str
    ai_answer: str = ""
    sources: List[SearchSource] = None
    error: str = ""
    
    def __post_init__(self):
        if self.sources is None:
            self.sources = []


class GoogleAISearcher:
    """Google AI 搜索器
    
    使用 Patchright 访问 Google AI 模式（udm=50）获取 AI 总结的搜索结果。
    """
    
    # Chrome 可能的安装路径（Windows）
    CHROME_PATHS = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
    ]
    
    # Edge 可能的安装路径（Windows）
    EDGE_PATHS = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    
    def __init__(self, timeout: int = 30, headless: bool = True):
        """初始化
        
        Args:
            timeout: 页面加载超时时间（秒）
            headless: 是否无头模式
        """
        self.timeout = timeout
        self.headless = headless
        self._browser_path = self._find_browser()
    
    def _find_browser(self) -> Optional[str]:
        """查找可用的浏览器"""
        # 优先 Edge（Windows 预装）
        for path in self.EDGE_PATHS:
            if os.path.exists(path):
                return path
        for path in self.CHROME_PATHS:
            if os.path.exists(path):
                return path
        return None
    
    def search(self, query: str, language: str = "zh-CN") -> SearchResult:
        """执行 Google AI 搜索
        
        Args:
            query: 搜索关键词
            language: 语言代码（zh-CN, en-US 等）
            
        Returns:
            SearchResult 包含 AI 回答和来源
        """
        if not self._browser_path:
            return SearchResult(
                success=False,
                query=query,
                error="未找到可用的浏览器（Chrome 或 Edge）"
            )
        
        # 构造 Google AI 模式 URL
        encoded_query = quote_plus(query)
        url = f"https://www.google.com/search?q={encoded_query}&udm=50&hl={language}"
        
        try:
            # 优先使用 Patchright（防检测）
            try:
                from patchright.sync_api import sync_playwright
            except ImportError:
                from playwright.sync_api import sync_playwright
            
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    executable_path=self._browser_path,
                    headless=self.headless,
                    args=[
                        '--disable-blink-features=AutomationControlled',
                        '--disable-infobars',
                        '--no-sandbox',
                    ]
                )
                
                try:
                    context = browser.new_context(
                        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        viewport={'width': 1920, 'height': 1080},
                        locale=language,
                    )
                    
                    page = context.new_page()
                    
                    # 访问页面
                    page.goto(url, timeout=self.timeout * 1000, wait_until='networkidle')
                    
                    # 等待 AI 回答加载
                    page.wait_for_timeout(2000)
                    
                    # 提取内容
                    result = self._extract_ai_answer(page)
                    result.query = query
                    
                    return result
                    
                finally:
                    browser.close()
                    
        except Exception as e:
            return SearchResult(
                success=False,
                query=query,
                error=str(e)
            )
    
    def _extract_ai_answer(self, page) -> SearchResult:
        """从页面提取 AI 回答
        
        Args:
            page: Playwright Page 对象
            
        Returns:
            SearchResult
        """
        js_code = """
        () => {
            const result = {
                aiAnswer: '',
                sources: []
            };
            
            // 提取 AI 回答主体
            // Google AI 模式的回答通常在特定的容器中
            const mainContent = document.body.innerText;
            
            // 查找 AI 回答区域（在"AI 模式"标签和"搜索结果"之间）
            const aiModeIndex = mainContent.indexOf('AI 模式');
            const searchResultIndex = mainContent.indexOf('搜索结果');
            
            if (aiModeIndex !== -1 && searchResultIndex !== -1) {
                let answer = mainContent.substring(aiModeIndex, searchResultIndex);
                
                // 清理不需要的内容
                answer = answer.replace(/^AI 模式\\s*/, '');
                answer = answer.replace(/全部\\s*图片\\s*视频\\s*新闻\\s*更多/g, '');
                answer = answer.replace(/登录/g, '');
                answer = answer.replace(/AI 的回答未必正确无误，请注意核查/g, '');
                answer = answer.replace(/\\d+ 个网站/g, '');
                answer = answer.replace(/全部显示/g, '');
                answer = answer.replace(/查看相关链接/g, '');
                answer = answer.replace(/关于这条结果/g, '');
                answer = answer.trim();
                
                result.aiAnswer = answer;
            } else {
                // 备用方案：直接获取主要文本
                result.aiAnswer = mainContent.substring(0, 5000);
            }
            
            // 提取来源链接
            const links = document.querySelectorAll('a[href^="http"]');
            const seenUrls = new Set();
            
            links.forEach(link => {
                const href = link.href;
                const text = link.textContent?.trim() || '';
                
                // 过滤 Google 自身的链接
                if (href.includes('google.com') || 
                    href.includes('accounts.google') ||
                    seenUrls.has(href) ||
                    text.length < 5) {
                    return;
                }
                
                seenUrls.add(href);
                
                // 只保留前 10 个来源
                if (result.sources.length < 10) {
                    result.sources.push({
                        title: text.substring(0, 200),
                        url: href,
                        snippet: ''
                    });
                }
            });
            
            return result;
        }
        """
        
        try:
            data = page.evaluate(js_code)
            
            sources = [
                SearchSource(
                    title=s.get('title', ''),
                    url=s.get('url', ''),
                    snippet=s.get('snippet', '')
                )
                for s in data.get('sources', [])
            ]
            
            return SearchResult(
                success=True,
                query='',
                ai_answer=data.get('aiAnswer', ''),
                sources=sources
            )
            
        except Exception as e:
            return SearchResult(
                success=False,
                query='',
                error=f"提取内容失败: {e}"
            )


# 测试代码
if __name__ == "__main__":
    searcher = GoogleAISearcher(headless=False)  # 调试时设为 False 可以看到浏览器
    result = searcher.search("什么是 MCP 协议")
    
    print(f"查询: {result.query}")
    print(f"成功: {result.success}")
    print(f"\nAI 回答:\n{result.ai_answer[:1000]}...")
    print(f"\n来源 ({len(result.sources)} 个):")
    for s in result.sources[:5]:
        print(f"  - {s.title}: {s.url}")
```

### 2. server.py - MCP Server 入口

```python
"""
Google AI Search MCP Server

提供 Google AI 搜索功能的 MCP 服务器。
"""

import json
import sys
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from .searcher import GoogleAISearcher


# 创建 MCP Server
server = Server("google-ai-search")

# 创建搜索器实例
searcher = GoogleAISearcher()


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
    output = f"## Google AI 搜索结果\n\n"
    output += f"**查询**: {result.query}\n\n"
    output += f"### AI 回答\n\n{result.ai_answer}\n\n"
    
    if result.sources:
        output += f"### 来源 ({len(result.sources)} 个)\n\n"
        for i, source in enumerate(result.sources[:5], 1):
            output += f"{i}. [{source.title}]({source.url})\n"
    
    return [TextContent(type="text", text=output)]


async def main():
    """主入口"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

### 3. __init__.py

```python
"""Google AI Search MCP Server"""

from .searcher import GoogleAISearcher, SearchResult, SearchSource

__version__ = "0.1.0"
__all__ = ["GoogleAISearcher", "SearchResult", "SearchSource"]
```

### 4. pyproject.toml

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "google-ai-search-mcp"
version = "0.1.0"
description = "Google AI Search MCP Server - 使用 Patchright 抓取 Google AI 模式搜索结果"
readme = "README.md"
license = "MIT"
requires-python = ">=3.10"
authors = [
    { name = "Your Name", email = "your@email.com" }
]
keywords = ["mcp", "google", "ai", "search", "patchright"]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]

dependencies = [
    "mcp>=1.0.0",
    "patchright>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
]

[project.scripts]
google-ai-search-mcp = "google_ai_search.server:main"

[tool.hatch.build.targets.wheel]
packages = ["src/google_ai_search"]
```

### 5. README.md

```markdown
# Google AI Search MCP Server

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果的 MCP 服务器。

## 功能

- 🔍 访问 Google AI 模式（udm=50）获取 AI 总结的搜索结果
- 🛡️ 使用 Patchright 绕过反爬检测
- 🌐 支持多语言搜索
- 📚 返回 AI 回答和来源链接

## 安装

```bash
# 克隆项目
git clone https://github.com/yourname/google-ai-search-mcp.git
cd google-ai-search-mcp

# 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac

# 安装依赖
pip install -e .

# 安装 Patchright 浏览器驱动（可选，会使用系统浏览器）
# patchright install chromium
```

## 配置 MCP

### Kiro 配置

编辑 `~/.kiro/settings/mcp.json`：

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "python",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "D:/google-ai-search-mcp/src"
    }
  }
}
```

### Claude Desktop 配置

编辑 `%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "python",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "D:/google-ai-search-mcp/src"
    }
  }
}
```

## 使用

配置完成后，在 Kiro 或 Claude Desktop 中可以直接使用：

```
请用 Google AI 搜索：什么是量子计算
```

## 工具说明

### google_ai_search

使用 Google AI 模式搜索，获取 AI 总结的搜索结果。

**参数**：
- `query` (必需): 搜索关键词或问题
- `language` (可选): 语言代码，默认 `zh-CN`

**返回**：
- AI 生成的综合回答
- 相关来源链接列表

## 注意事项

1. **需要浏览器**: 需要系统安装 Chrome 或 Edge 浏览器
2. **频率限制**: 频繁搜索可能触发 Google 验证码
3. **免责声明**: 本工具仅供学习研究，请遵守 Google 服务条款

## License

MIT
```

## 虎哥截图集成

在虎哥截图中，可以直接复用 `searcher.py` 的逻辑：

### screenshot_tool/services/google_ai_search.py

```python
"""
Google AI 搜索服务

集成到虎哥截图，提供 Google AI 搜索功能。
可以复用 google-ai-search-mcp 的核心逻辑。
"""

# 如果安装了 google-ai-search-mcp，直接导入
try:
    from google_ai_search import GoogleAISearcher, SearchResult
except ImportError:
    # 否则使用内置实现（从 browser_fetcher.py 扩展）
    from .browser_fetcher import BrowserFetcher
    from dataclasses import dataclass
    from typing import List
    from urllib.parse import quote_plus
    
    @dataclass
    class SearchSource:
        title: str
        url: str
        snippet: str = ""
    
    @dataclass
    class SearchResult:
        success: bool
        query: str
        ai_answer: str = ""
        sources: List[SearchSource] = None
        error: str = ""
        
        def __post_init__(self):
            if self.sources is None:
                self.sources = []
    
    class GoogleAISearcher:
        """Google AI 搜索器（内置实现）"""
        
        def __init__(self, timeout: int = 30):
            self.fetcher = BrowserFetcher(timeout=timeout)
        
        def search(self, query: str, language: str = "zh-CN") -> SearchResult:
            encoded_query = quote_plus(query)
            url = f"https://www.google.com/search?q={encoded_query}&udm=50&hl={language}"
            
            result = self.fetcher.fetch(url, use_cookies=True, extract_markdown=True)
            
            if not result.success:
                return SearchResult(
                    success=False,
                    query=query,
                    error=result.error
                )
            
            # 简单提取（可以进一步优化）
            return SearchResult(
                success=True,
                query=query,
                ai_answer=result.markdown or result.html[:5000],
                sources=[]
            )


# 便捷函数
def google_ai_search(query: str, language: str = "zh-CN") -> SearchResult:
    """执行 Google AI 搜索
    
    Args:
        query: 搜索关键词
        language: 语言代码
        
    Returns:
        SearchResult
    """
    searcher = GoogleAISearcher()
    return searcher.search(query, language)
```

## 使用步骤

### 1. 创建独立 MCP 项目

```bash
# 创建项目目录
mkdir D:\google-ai-search-mcp
cd D:\google-ai-search-mcp

# 创建目录结构
mkdir src\google_ai_search

# 复制上面的代码到对应文件
# - src/google_ai_search/__init__.py
# - src/google_ai_search/searcher.py
# - src/google_ai_search/server.py
# - pyproject.toml
# - README.md

# 创建虚拟环境并安装
python -m venv .venv
.venv\Scripts\activate
pip install -e .
pip install patchright
```

### 2. 配置 Kiro MCP

编辑 `~/.kiro/settings/mcp.json`，添加：

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

### 3. 测试

重启 Kiro，然后在聊天中输入：

```
请用 google_ai_search 工具搜索：什么是 MCP 协议
```

## 后续优化

1. **Cookie 复用**: 使用用户已登录的 Google 账号获取更好的结果
2. **缓存机制**: 缓存搜索结果避免重复请求
3. **代理支持**: 支持配置代理服务器
4. **错误重试**: 遇到验证码时自动重试
5. **结果解析优化**: 更精确地提取 AI 回答的结构化内容
