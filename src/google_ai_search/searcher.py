"""
Google AI Search - 核心搜索逻辑

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果。
"""

import os
from dataclasses import dataclass, field
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
    sources: List[SearchSource] = field(default_factory=list)
    error: str = ""


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
    
    # Edge 可能的安装路径（Windows）- 优先级更高
    EDGE_PATHS = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    
    # 验证码检测关键词
    CAPTCHA_KEYWORDS = [
        "异常流量",
        "我们的系统检测到",
        "unusual traffic",
        "automated requests",
        "验证您是真人",
        "prove you're not a robot",
        "recaptcha",
    ]
    
    def __init__(self, timeout: int = 30, headless: bool = True, use_user_data: bool = False):
        """初始化
        
        Args:
            timeout: 页面加载超时时间（秒）
            headless: 是否无头模式
            use_user_data: 是否使用用户浏览器数据（可复用登录状态）
        """
        self.timeout = timeout
        self.headless = headless
        self.use_user_data = use_user_data
        self._browser_path = self._find_browser()
        self._user_data_dir = self._get_user_data_dir()
    
    def _find_browser(self) -> Optional[str]:
        """查找可用的浏览器
        
        优先检测 Edge（Windows 预装），然后检测 Chrome。
        
        Returns:
            浏览器可执行文件路径，未找到返回 None
        """
        # 优先 Edge（Windows 预装）
        for path in self.EDGE_PATHS:
            if os.path.exists(path):
                return path
        # 然后 Chrome
        for path in self.CHROME_PATHS:
            if os.path.exists(path):
                return path
        return None
    
    def _get_user_data_dir(self) -> Optional[str]:
        """获取用户数据目录
        
        优先使用项目内的 browser_data 目录（已保存登录状态）
        """
        # 优先使用项目内的 browser_data 目录
        project_data = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "browser_data")
        if os.path.exists(project_data):
            return project_data
        
        # 备用：Edge 用户数据目录
        edge_user_data = os.path.expanduser(r"~\AppData\Local\Microsoft\Edge\User Data")
        if os.path.exists(edge_user_data):
            return edge_user_data
        return None

    def _build_url(self, query: str, language: str = "zh-CN") -> str:
        """构造 Google AI 模式 URL
        
        Args:
            query: 搜索关键词
            language: 语言代码（如 zh-CN, en-US）
            
        Returns:
            包含 udm=50 参数的 Google AI 模式 URL
        """
        encoded_query = quote_plus(query)
        return f"https://www.google.com/search?q={encoded_query}&udm=50&hl={language}"
    
    def _is_captcha_page(self, content: str) -> bool:
        """检测页面是否为验证码页面
        
        Args:
            content: 页面文本内容
            
        Returns:
            是否为验证码页面
        """
        content_lower = content.lower()
        for keyword in self.CAPTCHA_KEYWORDS:
            if keyword.lower() in content_lower:
                return True
        return False
    
    def _handle_captcha(self, playwright, url: str, query: str) -> SearchResult:
        """处理验证码 - 弹出浏览器窗口让用户完成验证
        
        Args:
            playwright: Playwright 实例
            url: 搜索 URL
            query: 搜索查询
            
        Returns:
            SearchResult
        """
        print("\n" + "="*60)
        print("⚠️  检测到 Google 验证码！")
        print("正在打开浏览器窗口，请完成验证...")
        print("="*60 + "\n")
        
        try:
            # 使用持久化上下文打开非无头浏览器
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=self._user_data_dir or os.path.join(os.path.dirname(__file__), "..", "..", "browser_data"),
                executable_path=self._browser_path,
                headless=False,  # 必须显示窗口让用户操作
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--no-sandbox',
                ],
                viewport={'width': 1280, 'height': 800},
            )
            
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(url, wait_until='networkidle')
            
            print("请在浏览器中完成验证...")
            print("验证完成后，系统将自动继续。")
            
            # 等待验证完成（最多等待 5 分钟）
            max_wait = 300  # 秒
            check_interval = 2  # 秒
            waited = 0
            
            while waited < max_wait:
                page.wait_for_timeout(check_interval * 1000)
                waited += check_interval
                
                # 检查是否还在验证码页面
                content = page.evaluate("() => document.body.innerText")
                if not self._is_captcha_page(content):
                    print("\n✅ 验证完成！正在获取搜索结果...")
                    page.wait_for_timeout(2000)
                    result = self._extract_ai_answer(page)
                    result.query = query
                    context.close()
                    return result
            
            # 超时
            context.close()
            return SearchResult(
                success=False,
                query=query,
                error="验证超时（5分钟），请重试"
            )
            
        except Exception as e:
            return SearchResult(
                success=False,
                query=query,
                error=f"验证过程出错: {e}"
            )

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
        url = self._build_url(query, language)
        
        try:
            # 优先使用 Patchright（防检测）
            try:
                from patchright.sync_api import sync_playwright
            except ImportError:
                from playwright.sync_api import sync_playwright
            
            with sync_playwright() as p:
                # 构建启动参数
                launch_args = [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ]
                
                # 如果使用用户数据目录，需要用 launch_persistent_context
                if self.use_user_data and self._user_data_dir:
                    context = p.chromium.launch_persistent_context(
                        user_data_dir=self._user_data_dir,
                        executable_path=self._browser_path,
                        headless=self.headless,
                        args=launch_args,
                        channel='msedge',
                        viewport={'width': 1920, 'height': 1080},
                    )
                    page = context.new_page()
                    
                    try:
                        page.goto(url, timeout=self.timeout * 1000, wait_until='networkidle')
                        page.wait_for_timeout(3000)
                        
                        # 检查是否遇到验证码
                        content = page.evaluate("() => document.body.innerText")
                        if self._is_captcha_page(content):
                            # 遇到验证码，弹出浏览器让用户处理
                            result = self._handle_captcha(p, url, query)
                            return result
                        
                        result = self._extract_ai_answer(page)
                        result.query = query
                        return result
                    finally:
                        context.close()
                else:
                    browser = p.chromium.launch(
                        executable_path=self._browser_path,
                        headless=self.headless,
                        args=launch_args
                    )
                    
                    try:
                        context = browser.new_context(
                            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
                            viewport={'width': 1920, 'height': 1080},
                            locale=language,
                        )
                        
                        page = context.new_page()
                        page.goto(url, timeout=self.timeout * 1000, wait_until='networkidle')
                        page.wait_for_timeout(3000)
                        
                        # 检查是否遇到验证码
                        content = page.evaluate("() => document.body.innerText")
                        if self._is_captcha_page(content):
                            browser.close()
                            # 遇到验证码，弹出浏览器让用户处理
                            result = self._handle_captcha(p, url, query)
                            return result
                        
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
    
    @staticmethod
    def clean_ai_answer(text: str) -> str:
        """清理 AI 回答文本，移除导航文本和提示信息
        
        Args:
            text: 原始文本
            
        Returns:
            清理后的文本
        """
        import re
        
        # 需要移除的导航文本
        patterns = [
            r'^AI 模式\s*',
            r'全部\s*图片\s*视频\s*新闻\s*更多',
            r'登录',
            r'AI 的回答未必正确无误，请注意核查',
            r'\d+ 个网站',
            r'全部显示',
            r'查看相关链接',
            r'关于这条结果',
            r'搜索结果',
        ]
        
        result = text
        for pattern in patterns:
            result = re.sub(pattern, '', result)
        
        return result.strip()
    
    @staticmethod
    def filter_sources(sources: List[dict], max_count: int = 10) -> List[dict]:
        """过滤和去重来源链接
        
        Args:
            sources: 原始来源列表
            max_count: 最大返回数量
            
        Returns:
            过滤后的来源列表
        """
        seen_urls = set()
        filtered = []
        
        for source in sources:
            url = source.get('url', '')
            
            # 过滤 Google 链接
            if 'google.com' in url or 'accounts.google' in url:
                continue
            
            # 去重
            if url in seen_urls:
                continue
            
            seen_urls.add(url)
            filtered.append(source)
            
            # 限制数量
            if len(filtered) >= max_count:
                break
        
        return filtered
