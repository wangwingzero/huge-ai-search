"""
Google AI Search - 核心搜索逻辑

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果。
"""

import os
import logging
import socket
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List
from urllib.parse import quote_plus

# 配置日志
def setup_logger():
    """配置日志器，输出到文件和 stderr，支持自动轮转清理"""
    logger = logging.getLogger("google_ai_search")
    
    if logger.handlers:  # 避免重复添加
        return logger
    
    logger.setLevel(logging.DEBUG)
    
    # 日志格式
    formatter = logging.Formatter(
        '%(asctime)s | %(levelname)-7s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # 日志目录
    log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "logs")
    os.makedirs(log_dir, exist_ok=True)
    
    # 清理旧日志（保留最近 7 天）
    _cleanup_old_logs(log_dir, max_days=7)
    
    log_file = os.path.join(log_dir, f"google_ai_search_{datetime.now().strftime('%Y%m%d')}.log")
    
    # 使用 RotatingFileHandler 限制单文件大小（最大 5MB，保留 3 个备份）
    from logging.handlers import RotatingFileHandler
    file_handler = RotatingFileHandler(
        log_file, 
        maxBytes=5*1024*1024,  # 5MB
        backupCount=3,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    
    # stderr 日志（MCP 服务器可以看到）
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.INFO)
    stderr_handler.setFormatter(formatter)
    logger.addHandler(stderr_handler)
    
    return logger


def _cleanup_old_logs(log_dir: str, max_days: int = 7):
    """清理超过指定天数的旧日志文件
    
    Args:
        log_dir: 日志目录
        max_days: 保留天数
    """
    try:
        import glob
        from datetime import timedelta
        
        cutoff = datetime.now() - timedelta(days=max_days)
        pattern = os.path.join(log_dir, "google_ai_search_*.log*")
        
        for log_file in glob.glob(pattern):
            try:
                # 从文件名提取日期
                basename = os.path.basename(log_file)
                # 格式: google_ai_search_YYYYMMDD.log 或 .log.1 等
                date_str = basename.replace("google_ai_search_", "").split(".")[0]
                if len(date_str) == 8 and date_str.isdigit():
                    file_date = datetime.strptime(date_str, "%Y%m%d")
                    if file_date < cutoff:
                        os.remove(log_file)
            except (ValueError, OSError):
                continue
    except Exception:
        pass  # 清理失败不影响主功能

logger = setup_logger()


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
    支持多轮对话：保持浏览器会话，在同一页面追问。
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
    
    # 追问输入框选择器（按优先级排序）
    FOLLOW_UP_SELECTORS = [
        'textarea[placeholder*="follow"]',
        'textarea[placeholder*="追问"]',
        'textarea[placeholder*="提问"]',
        'textarea[placeholder*="Ask"]',
        'textarea[aria-label*="follow"]',
        'textarea[aria-label*="追问"]',
        'input[placeholder*="follow"]',
        'input[placeholder*="追问"]',
        'div[contenteditable="true"][aria-label*="follow"]',
        'div[contenteditable="true"][aria-label*="追问"]',
        # 通用选择器（最后尝试）
        'textarea:not([name="q"])',
        'div[contenteditable="true"]',
    ]
    
    # 会话超时时间（秒）- 超过此时间未使用则关闭会话
    SESSION_TIMEOUT = 300  # 5 分钟
    
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
        
        # 持久化浏览器会话（用于多轮对话）
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None
        self._session_active = False
        self._last_activity_time: float = 0
        
        # 多轮对话增量提取：记录上一次的 AI 回答内容
        self._last_ai_answer: str = ""
        
        logger.info(f"GoogleAISearcher 初始化: timeout={timeout}s, headless={headless}, use_user_data={use_user_data}")
        logger.info(f"浏览器路径: {self._browser_path}")
        logger.info(f"用户数据目录: {self._user_data_dir}")
    
    def _find_browser(self) -> Optional[str]:
        """查找可用的浏览器
        
        优先检测 Chrome（用于持久化会话，避免与日常使用的 Edge 冲突），然后检测 Edge。
        
        Returns:
            浏览器可执行文件路径，未找到返回 None
        """
        # 优先 Chrome（用于持久化会话，不与日常 Edge 冲突）
        for path in self.CHROME_PATHS:
            if os.path.exists(path):
                return path
        # 备用 Edge
        for path in self.EDGE_PATHS:
            if os.path.exists(path):
                return path
        return None
    
    def _get_user_data_dir(self) -> Optional[str]:
        """获取用户数据目录
        
        使用专用的 Chrome 数据目录，避免与 Edge 冲突
        """
        # 使用专用的 Chrome 数据目录
        chrome_data = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 
            "chrome_browser_data"
        )
        # 确保目录存在
        os.makedirs(chrome_data, exist_ok=True)
        return chrome_data
    
    def has_active_session(self) -> bool:
        """检查是否有活跃的浏览器会话
        
        Returns:
            是否有活跃会话（且未超时）
        """
        if not self._session_active or not self._page:
            return False
        
        # 检查会话是否超时
        if self._last_activity_time > 0:
            elapsed = time.time() - self._last_activity_time
            if elapsed > self.SESSION_TIMEOUT:
                logger.info(f"会话已超时（{elapsed:.0f}秒），将关闭")
                self.close_session()
                return False
        
        return True
    
    def close_session(self):
        """关闭浏览器会话
        
        清理持久化的浏览器资源。
        """
        logger.info("关闭浏览器会话...")
        self._session_active = False
        self._last_ai_answer = ""
        
        if self._page:
            try:
                self._page.close()
            except Exception as e:
                logger.debug(f"关闭页面时出错: {e}")
            self._page = None
        
        if self._context:
            try:
                self._context.close()
            except Exception as e:
                logger.debug(f"关闭上下文时出错: {e}")
            self._context = None
        
        if hasattr(self, '_browser') and self._browser:
            try:
                self._browser.close()
            except Exception as e:
                logger.debug(f"关闭浏览器时出错: {e}")
            self._browser = None
        
        if self._playwright:
            try:
                self._playwright.stop()
            except Exception as e:
                logger.debug(f"停止 Playwright 时出错: {e}")
            self._playwright = None
        
        # 等待浏览器进程完全退出
        time.sleep(0.5)
        logger.info("浏览器会话已关闭")
    
    def _ensure_session(self, language: str = "zh-CN") -> bool:
        """确保浏览器会话已启动
        
        Args:
            language: 语言代码
            
        Returns:
            是否成功启动会话
        """
        if self._session_active and self._page:
            return True
        
        logger.info("启动新的浏览器会话...")
        
        try:
            # 优先使用 Patchright（防检测）
            try:
                from patchright.sync_api import sync_playwright
                logger.info("使用 Patchright (防检测模式)")
            except ImportError:
                from playwright.sync_api import sync_playwright
                logger.warning("Patchright 不可用，回退到 Playwright")
            
            self._playwright = sync_playwright().start()
            
            # 构建启动参数
            launch_args = [
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
            ]
            
            # 检测系统代理设置
            proxy_server = self._detect_proxy()
            if proxy_server:
                logger.info(f"检测到系统代理: {proxy_server}")
            
            # 使用持久化上下文（Chrome，不与日常 Edge 冲突）
            launch_options = {
                "user_data_dir": self._user_data_dir,
                "executable_path": self._browser_path,
                "headless": self.headless,
                "args": launch_args,
                "viewport": {'width': 1920, 'height': 1080},
            }
            
            if proxy_server:
                launch_options["proxy"] = {"server": proxy_server}
            
            self._context = self._playwright.chromium.launch_persistent_context(**launch_options)
            self._page = self._context.new_page()
            self._session_active = True
            self._last_activity_time = time.time()
            
            logger.info("浏览器会话启动成功")
            return True
            
        except Exception as e:
            logger.error(f"启动浏览器会话失败: {e}")
            self.close_session()
            return False
    
    def _wait_for_streaming_complete(self, page, max_wait_seconds: int = 30) -> bool:
        """等待 AI 流式输出完成
        
        通过监测页面内容长度变化来判断流式输出是否结束。
        当内容长度连续 2 秒不再变化时，认为输出完成。
        
        Args:
            page: Playwright Page 对象
            max_wait_seconds: 最大等待时间（秒）
            
        Returns:
            是否成功等待完成
        """
        logger.info("等待 AI 流式输出完成...")
        
        last_content_length = 0
        stable_count = 0
        stable_threshold = 2  # 连续 2 次检测内容不变则认为完成
        check_interval = 1000  # 每秒检测一次
        
        for i in range(max_wait_seconds):
            try:
                current_length = page.evaluate("() => document.body.innerText.length")
                
                if current_length == last_content_length:
                    stable_count += 1
                    logger.debug(f"内容稳定检测: {stable_count}/{stable_threshold}")
                    if stable_count >= stable_threshold:
                        logger.info(f"AI 输出完成，内容长度: {current_length}")
                        return True
                else:
                    stable_count = 0
                    logger.debug(f"内容仍在加载: {last_content_length} -> {current_length}")
                
                last_content_length = current_length
                page.wait_for_timeout(check_interval)
                
            except Exception as e:
                logger.warning(f"等待流式输出时出错: {e}")
                break
        
        logger.warning(f"等待流式输出超时（{max_wait_seconds}秒）")
        return False
    
    def _remove_user_query_from_content(self, content: str, query: str) -> str:
        """从内容中移除用户问题
        
        Google AI 多轮对话页面结构: [上次回答][用户问题][新回答]
        增量提取后，新内容开头可能包含用户的问题，需要移除。
        
        Args:
            content: 提取的新内容
            query: 用户的问题
            
        Returns:
            移除用户问题后的内容
        """
        if not content or not query:
            return content
        
        # 尝试精确匹配：问题在开头
        if content.startswith(query):
            result = content[len(query):].strip()
            logger.info(f"移除用户问题（精确匹配）: '{query[:30]}...'")
            return result
        
        # 尝试模糊匹配：问题可能有轻微变化
        query_normalized = query.strip()
        content_start = content[:len(query_normalized) + 50]
        
        pos = content_start.find(query_normalized)
        if pos != -1 and pos < 20:
            result = content[pos + len(query_normalized):].strip()
            logger.info(f"移除用户问题（模糊匹配）: '{query[:30]}...'")
            return result
        
        logger.debug(f"未在内容开头找到用户问题: '{query[:30]}...'")
        return content
    
    def _find_follow_up_input(self):
        """查找追问输入框
        
        Returns:
            输入框元素，未找到返回 None
        """
        if not self._page:
            return None
        
        for selector in self.FOLLOW_UP_SELECTORS:
            try:
                element = self._page.query_selector(selector)
                if element and element.is_visible():
                    logger.debug(f"找到追问输入框: {selector}")
                    return element
            except Exception:
                continue
        
        logger.warning("未找到追问输入框")
        return None
    
    def _has_follow_up_input_via_js(self) -> bool:
        """使用 JavaScript 检查是否有追问输入框"""
        if not self._page:
            return False
        
        js_find_input = """
        () => {
            const textareas = document.querySelectorAll('textarea');
            for (const ta of textareas) {
                if (ta.name === 'q') continue;
                if (ta.offsetParent !== null) return true;
            }
            const editables = document.querySelectorAll('[contenteditable="true"]');
            for (const el of editables) {
                if (el.offsetParent !== null) return true;
            }
            return false;
        }
        """
        try:
            return self._page.evaluate(js_find_input)
        except Exception:
            return False
    
    def _submit_follow_up_via_js(self, query: str) -> bool:
        """使用 JavaScript 提交追问"""
        if not self._page:
            return False
        
        js_fill_and_submit = """
        (query) => {
            const textareas = document.querySelectorAll('textarea');
            for (const ta of textareas) {
                if (ta.name === 'q') continue;
                if (ta.offsetParent !== null) {
                    ta.value = query;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    const form = ta.closest('form');
                    if (form) {
                        const submitBtn = form.querySelector('button[type="submit"], button:not([type])');
                        if (submitBtn) {
                            submitBtn.click();
                            return true;
                        }
                    }
                    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                    return true;
                }
            }
            return false;
        }
        """
        try:
            return self._page.evaluate(js_fill_and_submit, query)
        except Exception as e:
            logger.warning(f"JavaScript 提交失败: {e}")
            return False

    def _detect_proxy(self) -> Optional[str]:
        """检测系统代理设置
        
        支持环境变量和常见代理端口检测（v2ray、clash 等）
        
        Returns:
            代理服务器地址，如 "http://127.0.0.1:10809"，未检测到返回 None
        """
        # 1. 检查环境变量
        for env_var in ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']:
            proxy = os.environ.get(env_var)
            if proxy:
                logger.debug(f"从环境变量 {env_var} 检测到代理: {proxy}")
                return proxy
        
        # 2. 检测常见代理端口（v2ray、clash 等）
        # 优先使用 HTTP 代理，比 SOCKS5 更稳定
        common_ports = [
            (10809, "http://127.0.0.1:10809"),  # v2ray 默认 HTTP 代理（优先）
            (7890, "http://127.0.0.1:7890"),   # clash 默认 HTTP 代理
            (10808, "socks5://127.0.0.1:10808"),  # v2ray 默认 SOCKS5 代理
            (7891, "socks5://127.0.0.1:7891"),  # clash 默认 SOCKS5 代理
            (1080, "socks5://127.0.0.1:1080"),  # 通用 SOCKS5 端口
        ]
        
        for port, proxy_url in common_ports:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.5)
                result = sock.connect_ex(('127.0.0.1', port))
                sock.close()
                if result == 0:
                    logger.debug(f"检测到本地代理端口 {port} 开放")
                    return proxy_url
            except Exception:
                pass
        
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
    
    # AI 模式选择器和关键词常量
    AI_SELECTORS = [
        'div[data-attrid="wa:/m/0"]',  # 旧版选择器
        '[data-async-type="editableDirectAnswer"]',  # AI 回答区域
        '.wDYxhc',  # AI 概述容器
        '[data-md="50"]',  # AI 模式标记
    ]
    AI_KEYWORDS = ['AI 模式', 'AI Mode', 'AI モード']
    
    def _handle_cookie_consent(self, page: "Page") -> bool:
        """处理 Google Cookie 同意对话框
        
        Args:
            page: Playwright Page 对象
            
        Returns:
            是否成功处理（或不需要处理）
        """
        # Cookie 同意对话框的可能选择器
        consent_selectors = [
            'button:has-text("全部接受")',
            'button:has-text("Accept all")',
            'button:has-text("すべて同意")',
            'button:has-text("모두 수락")',
            'button:has-text("Alle akzeptieren")',
            'button:has-text("Tout accepter")',
            '[aria-label="全部接受"]',
            '[aria-label="Accept all"]',
        ]
        
        for selector in consent_selectors:
            try:
                button = page.query_selector(selector)
                if button and button.is_visible():
                    logger.info(f"检测到 Cookie 同意对话框，点击: {selector}")
                    button.click()
                    page.wait_for_timeout(1000)  # 等待对话框关闭
                    return True
            except Exception as e:
                logger.debug(f"尝试选择器 {selector} 失败: {e}")
                continue
        
        # 备用方案：使用 JavaScript 查找并点击
        js_click_consent = """
        () => {
            // 查找包含"全部接受"或"Accept all"的按钮
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const text = btn.textContent || '';
                if (text.includes('全部接受') || text.includes('Accept all') || 
                    text.includes('すべて同意') || text.includes('모두 수락') ||
                    text.includes('Alle akzeptieren') || text.includes('Tout accepter')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }
        """
        try:
            clicked = page.evaluate(js_click_consent)
            if clicked:
                logger.info("通过 JavaScript 点击了 Cookie 同意按钮")
                page.wait_for_timeout(1000)
                return True
        except Exception as e:
            logger.debug(f"JavaScript 点击 Cookie 同意按钮失败: {e}")
        
        return False
    
    def _wait_for_ai_content(self, page: "Page", timeout_per_selector: int = 3000) -> bool:
        """等待 AI 内容加载
        
        Args:
            page: Playwright Page 对象
            timeout_per_selector: 每个选择器的超时时间（毫秒）
            
        Returns:
            是否检测到 AI 内容
        """
        # 首先处理可能的 Cookie 同意对话框
        self._handle_cookie_consent(page)
        
        # 尝试多个选择器
        for selector in self.AI_SELECTORS:
            try:
                page.wait_for_selector(selector, timeout=timeout_per_selector)
                logger.info(f"检测到 AI 回答区域: {selector}")
                return True
            except Exception:
                continue
        
        # 备用策略：检查页面关键词
        logger.debug("未找到特定 AI 选择器，检查页面内容...")
        for _ in range(5):  # 最多等待 5 秒
            content = page.evaluate("() => document.body.innerText")
            if any(kw in content for kw in self.AI_KEYWORDS):
                logger.info("通过关键词检测到 AI 内容")
                return True
            page.wait_for_timeout(1000)
        
        return False
    
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
        """处理验证码 - 弹出浏览器窗口让用户完成验证（已废弃，使用 _handle_user_intervention）"""
        return self._handle_user_intervention(playwright, url, query, "检测到验证码")
    
    def _handle_user_intervention(self, playwright, url: str, query: str, reason: str = "") -> SearchResult:
        """弹出浏览器窗口让用户手动处理问题
        
        Args:
            playwright: Playwright 实例
            url: 搜索 URL
            query: 搜索查询
            reason: 需要用户介入的原因
            
        Returns:
            SearchResult
        """
        logger.info(f"需要用户介入: {reason}")
        print("\n" + "="*60)
        print("[!] 需要用户操作！")
        print(f"原因: {reason}")
        print("正在打开浏览器窗口，请手动完成操作...")
        print("="*60 + "\n")
        
        context = None
        try:
            # 等待一下让之前的浏览器完全释放资源
            time.sleep(1)
            
            # 检测代理
            proxy_server = self._detect_proxy()
            
            # 使用持久化上下文（Chrome，不与日常 Edge 冲突）
            launch_options = {
                "user_data_dir": self._user_data_dir,
                "executable_path": self._browser_path,
                "headless": False,  # 必须显示窗口让用户操作
                "args": [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--no-sandbox',
                ],
                "viewport": {'width': 1280, 'height': 800},
            }
            
            # 添加代理配置（与主搜索保持一致）
            if proxy_server:
                logger.info(f"用户介入模式使用代理: {proxy_server}")
                launch_options["proxy"] = {"server": proxy_server}
            
            # 使用持久化上下文打开非无头浏览器
            context = playwright.chromium.launch_persistent_context(**launch_options)
            
            page = context.pages[0] if context.pages else context.new_page()
            
            try:
                page.goto(url, wait_until='domcontentloaded', timeout=120000)  # 给用户更多时间
            except Exception as nav_error:
                logger.warning(f"用户介入模式导航失败: {nav_error}")
                # 即使导航失败也继续，让用户手动处理
                page.wait_for_timeout(2000)
            
            print("请在浏览器中完成操作（验证码、登录等）...")
            print("操作完成后，搜索结果会自动获取。")
            print("最长等待时间: 5 分钟")
            
            # 等待用户操作完成（最多等待 5 分钟）
            max_wait = 300  # 秒
            check_interval = 2  # 秒
            waited = 0
            
            while waited < max_wait:
                page.wait_for_timeout(check_interval * 1000)
                waited += check_interval
                
                # 检查页面是否已经有搜索结果（用户完成了操作）
                content = page.evaluate("() => document.body.innerText")
                current_url = page.url
                
                # 判断是否离开了问题页面（验证码页面、错误页面等）
                is_problem_page = self._is_captcha_page(content) or 'sorry' in current_url.lower()
                has_search_result = 'AI 模式' in content or 'AI Mode' in content or len(content) > 1000
                
                if not is_problem_page and has_search_result:
                    print("\n[OK] 操作完成！正在获取搜索结果...")
                    logger.info("用户操作完成，提取搜索结果")
                    page.wait_for_timeout(2000)
                    result = self._extract_ai_answer(page)
                    result.query = query
                    return result
            
            # 超时
            return SearchResult(
                success=False,
                query=query,
                error="用户操作超时（5分钟），请重试"
            )
            
        except Exception as e:
            logger.error(f"用户介入处理出错: {e}")
            return SearchResult(
                success=False,
                query=query,
                error=f"用户操作过程出错: {e}"
            )
        finally:
            if context:
                try:
                    context.close()
                except Exception:
                    pass

    def search(self, query: str, language: str = "zh-CN") -> SearchResult:
        """执行 Google AI 搜索
        
        Args:
            query: 搜索关键词
            language: 语言代码（zh-CN, en-US 等）
            
        Returns:
            SearchResult 包含 AI 回答和来源
        """
        logger.info(f"="*60)
        logger.info(f"开始搜索: query='{query}', language={language}")
        
        # 更新活动时间
        self._last_activity_time = time.time()
        
        if not self._browser_path:
            logger.error("未找到可用的浏览器")
            return SearchResult(
                success=False,
                query=query,
                error="未找到可用的浏览器（Chrome 或 Edge）"
            )
        
        # 构造 Google AI 模式 URL
        url = self._build_url(query, language)
        logger.info(f"目标 URL: {url}")
        
        try:
            # 尝试使用持久化会话
            if self.use_user_data:
                return self._search_with_persistent_session(query, language, url)
            else:
                return self._search_with_new_session(query, language, url)
                
        except Exception as e:
            logger.error(f"搜索异常: {type(e).__name__}: {e}")
            import traceback
            logger.error(f"堆栈跟踪:\n{traceback.format_exc()}")
            return SearchResult(
                success=False,
                query=query,
                error=str(e)
            )
    
    def _search_with_persistent_session(self, query: str, language: str, url: str) -> SearchResult:
        """使用持久化会话执行搜索"""
        logger.info("使用持久化会话模式")
        
        # 确保会话已启动
        if not self._ensure_session(language):
            return SearchResult(
                success=False,
                query=query,
                error="无法启动浏览器会话"
            )
        
        try:
            # 导航到搜索页面
            logger.info(f"导航到 URL (timeout={self.timeout}s)...")
            start_time = time.time()
            
            try:
                self._page.goto(url, timeout=self.timeout * 1000, wait_until='domcontentloaded')
            except Exception as goto_error:
                logger.warning(f"页面导航异常: {goto_error}")
                # 优先使用 Patchright
                try:
                    from patchright.sync_api import sync_playwright
                except ImportError:
                    from playwright.sync_api import sync_playwright
                
                self.close_session()
                with sync_playwright() as p:
                    return self._handle_user_intervention(p, url, query, str(goto_error))
            
            elapsed = time.time() - start_time
            logger.info(f"DOM 加载完成，耗时: {elapsed:.2f}s")
            
            # 等待 AI 内容加载
            self._wait_for_ai_content(self._page)
            
            # 等待流式输出完成
            self._wait_for_streaming_complete(self._page, max_wait_seconds=30)
            
            # 检查是否遇到验证码
            content = self._page.evaluate("() => document.body.innerText")
            if self._is_captcha_page(content):
                logger.warning("检测到验证码页面！")
                try:
                    from patchright.sync_api import sync_playwright
                except ImportError:
                    from playwright.sync_api import sync_playwright
                
                self.close_session()
                with sync_playwright() as p:
                    return self._handle_captcha(p, url, query)
            
            # 提取 AI 回答
            result = self._extract_ai_answer(self._page)
            result.query = query
            
            # 保存回答用于增量提取
            self._last_ai_answer = result.ai_answer
            self._last_activity_time = time.time()
            
            logger.info(f"搜索完成: success={result.success}, ai_answer长度={len(result.ai_answer)}")
            return result
            
        except Exception as e:
            logger.error(f"持久化会话搜索失败: {e}")
            self.close_session()
            return SearchResult(
                success=False,
                query=query,
                error=str(e)
            )
    
    def continue_conversation(self, query: str) -> SearchResult:
        """在当前会话中继续对话（追问）
        
        在同一页面的追问输入框中输入新问题，保持对话上下文。
        如果找不到追问输入框，会导航到新搜索 URL。
        
        Args:
            query: 追问内容
            
        Returns:
            SearchResult 包含 AI 回答和来源（仅新增内容）
        """
        logger.info(f"继续对话: query='{query}'")
        
        # 更新活动时间
        self._last_activity_time = time.time()
        
        if not self.has_active_session():
            logger.warning("没有活跃会话，回退到新搜索")
            return self.search(query)
        
        try:
            # 查找追问输入框
            input_element = self._find_follow_up_input()
            
            if input_element:
                # 使用找到的输入框
                input_element.click()
                self._page.wait_for_timeout(300)
                input_element.fill(query)
                self._page.wait_for_timeout(300)
                input_element.press("Enter")
            else:
                # 尝试使用 JavaScript
                logger.info("尝试使用 JavaScript 查找输入框...")
                if not self._has_follow_up_input_via_js():
                    logger.warning("页面上没有追问输入框，导航到新搜索")
                    return self._navigate_to_new_search(query)
                
                if not self._submit_follow_up_via_js(query):
                    logger.warning("无法提交追问，导航到新搜索")
                    return self._navigate_to_new_search(query)
            
            # 等待 AI 回答加载
            self._page.wait_for_timeout(1000)
            self._wait_for_ai_content(self._page)
            
            # 等待流式输出完成
            self._wait_for_streaming_complete(self._page, max_wait_seconds=30)
            
            # 检查是否遇到验证码
            content = self._page.evaluate("() => document.body.innerText")
            if self._is_captcha_page(content):
                logger.warning("追问时检测到验证码！")
                self.close_session()
                return SearchResult(
                    success=False,
                    query=query,
                    error="需要验证，请重新搜索"
                )
            
            # 提取 AI 回答
            result = self._extract_ai_answer(self._page)
            result.query = query
            
            # 保存完整的页面回答内容
            full_page_answer = result.ai_answer
            
            # 增量提取：只返回新增内容
            if result.success and self._last_ai_answer:
                if self._last_ai_answer in full_page_answer:
                    last_end_pos = full_page_answer.find(self._last_ai_answer) + len(self._last_ai_answer)
                    new_content = full_page_answer[last_end_pos:].strip()
                    if new_content:
                        new_content = self._remove_user_query_from_content(new_content, query)
                        result.ai_answer = new_content
                        logger.info(f"增量提取: 原始长度={len(full_page_answer)}, 新增长度={len(new_content)}")
                    else:
                        logger.warning("增量提取未找到新内容，保留完整回答")
                else:
                    logger.warning("增量提取: 未找到上一次回答，保留完整内容")
            
            # 更新记录
            self._last_ai_answer = full_page_answer
            self._last_activity_time = time.time()
            
            logger.info(f"追问完成: success={result.success}")
            return result
            
        except Exception as e:
            logger.error(f"继续对话失败: {e}")
            import traceback
            logger.error(f"堆栈跟踪:\n{traceback.format_exc()}")
            
            # 尝试导航到新搜索
            try:
                return self._navigate_to_new_search(query)
            except Exception:
                self.close_session()
                return SearchResult(
                    success=False,
                    query=query,
                    error=f"追问失败: {e}"
                )
    
    def _navigate_to_new_search(self, query: str, language: str = "zh-CN") -> SearchResult:
        """在当前会话中导航到新搜索 URL"""
        logger.info(f"在当前会话中导航到新搜索: query='{query}'")
        
        if not self._session_active or not self._page:
            logger.warning("没有活跃会话，启动新会话")
            return self.search(query, language)
        
        try:
            url = self._build_url(query, language)
            logger.info(f"导航到: {url}")
            
            self._page.goto(url, timeout=self.timeout * 1000, wait_until='domcontentloaded')
            
            self._wait_for_ai_content(self._page)
            self._wait_for_streaming_complete(self._page, max_wait_seconds=30)
            
            content = self._page.evaluate("() => document.body.innerText")
            if self._is_captcha_page(content):
                logger.warning("新搜索时检测到验证码！")
                self.close_session()
                return SearchResult(
                    success=False,
                    query=query,
                    error="需要验证，请重新搜索"
                )
            
            result = self._extract_ai_answer(self._page)
            result.query = query
            
            # 重置增量提取状态（新搜索开始新对话）
            self._last_ai_answer = result.ai_answer
            self._last_activity_time = time.time()
            
            logger.info(f"新搜索完成: success={result.success}")
            return result
            
        except Exception as e:
            logger.error(f"导航到新搜索失败: {e}")
            self.close_session()
            return SearchResult(
                success=False,
                query=query,
                error=f"搜索失败: {e}"
            )
    
    def _search_with_new_session(self, query: str, language: str, url: str) -> SearchResult:
        """使用新会话执行搜索（原有逻辑）"""
        logger.info("使用非持久化模式")
        
        # 优先使用 Patchright（防检测）
        try:
            from patchright.sync_api import sync_playwright
            logger.info("使用 Patchright (防检测模式)")
        except ImportError:
            from playwright.sync_api import sync_playwright
            logger.warning("Patchright 不可用，回退到 Playwright")
        
        try:
            with sync_playwright() as p:
                launch_args = [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ]
                
                proxy_server = self._detect_proxy()
                if proxy_server:
                    logger.info(f"检测到系统代理: {proxy_server}")
                
                browser = p.chromium.launch(
                    executable_path=self._browser_path,
                    headless=self.headless,
                    args=launch_args
                )
                logger.info("浏览器启动成功")
                
                try:
                    context = browser.new_context(
                        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
                        viewport={'width': 1920, 'height': 1080},
                        locale=language,
                    )
                    
                    page = context.new_page()
                    logger.info(f"开始导航到 URL (timeout={self.timeout}s)...")
                    start_time = time.time()
                    
                    try:
                        page.goto(url, timeout=self.timeout * 1000, wait_until='domcontentloaded')
                    except Exception as goto_error:
                        logger.warning(f"页面导航异常: {goto_error}")
                        browser.close()
                        browser = None
                        return self._handle_user_intervention(p, url, query, str(goto_error))
                    
                    elapsed = time.time() - start_time
                    logger.info(f"DOM 加载完成，耗时: {elapsed:.2f}s")
                    
                    self._wait_for_ai_content(page)
                    
                    content = page.evaluate("() => document.body.innerText")
                    if self._is_captcha_page(content):
                        logger.warning("检测到验证码页面！")
                        browser.close()
                        browser = None
                        return self._handle_captcha(p, url, query)
                    
                    result = self._extract_ai_answer(page)
                    result.query = query
                    logger.info(f"搜索完成: success={result.success}")
                    return result
                    
                finally:
                    if browser:
                        browser.close()
                        
        except Exception as e:
            logger.error(f"搜索异常: {type(e).__name__}: {e}")
            import traceback
            logger.error(f"堆栈跟踪:\n{traceback.format_exc()}")
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
            
            // 多语言支持：AI 模式标签
            const aiModeLabels = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA'];
            // 多语言支持：搜索结果标签
            const searchResultLabels = ['搜索结果', 'Search Results', '検索結果', '검색결과', 'Suchergebnisse', 'Résultats de recherche'];
            // 多语言支持：需要清理的导航文本
            const navPatterns = [
                // 中文
                /^AI 模式\\s*/g,
                /全部\\s*图片\\s*视频\\s*新闻\\s*更多/g,
                /登录/g,
                /AI 的回答未必正确无误，请注意核查/g,
                /AI 回答可能包含错误。\\s*了解详情/g,
                /请谨慎使用此类代码。?/g,
                /Use code with caution\\.?/gi,
                /\\d+ 个网站/g,
                /全部显示/g,
                /查看相关链接/g,
                /关于这条结果/g,
                // 英文
                /^AI Mode\\s*/g,
                /All\\s*Images\\s*Videos\\s*News\\s*More/gi,
                /Sign in/gi,
                /AI responses may include mistakes\\.?\\s*Learn more/gi,
                /AI overview\\s*/gi,
                /\\d+ sites?/gi,
                /Show all/gi,
                /View related links/gi,
                /About this result/gi,
                /Accessibility links/gi,
                /Skip to main content/gi,
                /Accessibility help/gi,
                /Accessibility feedback/gi,
                /Filters and topics/gi,
                /AI Mode response is ready/gi,
                // 日语
                /^AI モード\\s*/g,
                /すべて\\s*画像\\s*動画\\s*ニュース\\s*もっと見る/g,
                /ログイン/g,
                /AI の回答には間違いが含まれている場合があります。?\\s*詳細/g,
                /\\d+ 件のサイト/g,
                /すべて表示/g,
                /ユーザー補助のリンク/g,
                /メイン コンテンツにスキップ/g,
                /ユーザー補助ヘルプ/g,
                /ユーザー補助に関するフィードバック/g,
                /フィルタとトピック/g,
                /AI モードの回答が作成されました/g,
                // 韩语
                /^AI 모드\\s*/g,
                /전체\\s*이미지\\s*동영상\\s*뉴스\\s*더보기/g,
                /로그인/g,
                // 德语
                /^KI-Modus\\s*/g,
                /Alle\\s*Bilder\\s*Videos\\s*News\\s*Mehr/gi,
                /Anmelden/gi,
                // 法语
                /^Mode IA\\s*/g,
                /Tous\\s*Images\\s*Vidéos\\s*Actualités\\s*Plus/gi,
                /Connexion/gi,
            ];
            
            // 查找 AI 回答区域的起始位置
            let aiModeIndex = -1;
            for (const label of aiModeLabels) {
                const idx = mainContent.indexOf(label);
                if (idx !== -1) {
                    aiModeIndex = idx;
                    break;
                }
            }
            
            // 查找搜索结果区域的起始位置
            let searchResultIndex = -1;
            for (const label of searchResultLabels) {
                const idx = mainContent.indexOf(label);
                if (idx !== -1 && (searchResultIndex === -1 || idx < searchResultIndex)) {
                    // 确保搜索结果在 AI 模式之后
                    if (aiModeIndex === -1 || idx > aiModeIndex) {
                        searchResultIndex = idx;
                    }
                }
            }
            
            if (aiModeIndex !== -1 && searchResultIndex !== -1) {
                let answer = mainContent.substring(aiModeIndex, searchResultIndex);
                
                // 清理不需要的内容
                for (const pattern of navPatterns) {
                    answer = answer.replace(pattern, '');
                }
                answer = answer.trim();
                
                result.aiAnswer = answer;
            } else if (aiModeIndex !== -1) {
                // 只找到 AI 模式标签，取后面的内容
                let answer = mainContent.substring(aiModeIndex, Math.min(aiModeIndex + 8000, mainContent.length));
                
                // 清理不需要的内容
                for (const pattern of navPatterns) {
                    answer = answer.replace(pattern, '');
                }
                answer = answer.trim();
                
                result.aiAnswer = answer;
            } else {
                // 备用方案：直接获取主要文本，但清理导航元素
                let answer = mainContent.substring(0, 5000);
                
                // 清理不需要的内容
                for (const pattern of navPatterns) {
                    answer = answer.replace(pattern, '');
                }
                answer = answer.trim();
                
                result.aiAnswer = answer;
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
