"""
Google AI Search - 核心搜索逻辑

使用 Patchright（Playwright 防检测分支）抓取 Google AI 模式搜索结果。
"""

import asyncio
import os
import logging
import socket
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional, List
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
    """搜索来源
    
    Attributes:
        title: 来源标题
        url: 来源 URL
        snippet: 来源摘要（可选）
    """
    title: str
    url: str
    snippet: str = ""
    
    def to_dict(self) -> dict:
        """序列化为字典
        
        Returns:
            包含所有字段的字典
            
        **Validates: Requirements 5.5**
        """
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "SearchSource":
        """从字典反序列化
        
        Args:
            data: 包含 title, url, snippet 字段的字典
            
        Returns:
            SearchSource 实例
            
        **Validates: Requirements 5.5**
        """
        return cls(
            title=data.get("title", ""),
            url=data.get("url", ""),
            snippet=data.get("snippet", "")
        )


@dataclass
class SearchResult:
    """搜索结果
    
    Attributes:
        success: 搜索是否成功
        query: 搜索查询
        ai_answer: AI 回答内容
        sources: 来源列表
        error: 错误信息（失败时）
    """
    success: bool
    query: str
    ai_answer: str = ""
    sources: List[SearchSource] = field(default_factory=list)
    error: str = ""
    
    def to_dict(self) -> dict:
        """序列化为字典
        
        Returns:
            包含所有字段的字典，sources 字段为字典列表
            
        **Validates: Requirements 5.5**
        """
        return {
            "success": self.success,
            "query": self.query,
            "ai_answer": self.ai_answer,
            "sources": [s.to_dict() for s in self.sources],
            "error": self.error
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "SearchResult":
        """从字典反序列化
        
        Args:
            data: 包含 success, query, ai_answer, sources, error 字段的字典
            
        Returns:
            SearchResult 实例
            
        **Validates: Requirements 5.5**
        """
        sources_data = data.get("sources", [])
        sources = [SearchSource.from_dict(s) for s in sources_data]
        
        return cls(
            success=data.get("success", False),
            query=data.get("query", ""),
            ai_answer=data.get("ai_answer", ""),
            sources=sources,
            error=data.get("error", "")
        )


class GoogleAISearcher:
    """Google AI 搜索器
    
    使用 Patchright 访问 Google AI 模式（udm=50）获取 AI 总结的搜索结果。
    支持多轮对话：保持浏览器会话，在同一页面追问。
    """
    
    # Chrome 可能的安装路径（跨平台）
    CHROME_PATHS = [
        # Windows
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
        # macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        # Linux
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ]
    
    # Edge 可能的安装路径（跨平台）- 优先级更高
    EDGE_PATHS = [
        # Windows
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        # macOS
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        # Linux
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
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
    
    def __init__(self, timeout: int = 30, headless: bool | str = True, use_user_data: bool = False):
        """初始化
        
        Args:
            timeout: 页面加载超时时间（秒）
            headless: 无头模式设置。True=传统headless, False=有头, "new"=新版headless（更好的Cookie支持）
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
        
        优先检测 Chrome，然后检测 Edge 作为备用。
        
        Returns:
            浏览器可执行文件路径，未找到返回 None
        """
        # 优先 Chrome
        for path in self.CHROME_PATHS:
            if os.path.exists(path):
                return path
        # 备用 Edge
        for path in self.EDGE_PATHS:
            if os.path.exists(path):
                return path
        return None
    
    def _get_user_data_dir(self, unique: bool = False) -> Optional[str]:
        """获取用户数据目录
        
        Args:
            unique: 是否使用唯一目录（用于多进程场景）
        
        使用专用的 Edge 数据目录（edge_browser_data），不影响用户日常使用的 Edge。
        当 unique=True 时，创建带 PID 后缀的临时目录，避免多进程冲突。
        """
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        
        if unique:
            # 多进程模式：使用带 PID 的临时目录
            temp_dir = os.path.join(base_dir, "edge_browser_temp")
            os.makedirs(temp_dir, exist_ok=True)
            
            # 清理旧的临时目录（超过 1 小时的）
            self._cleanup_old_temp_dirs(temp_dir, max_age_hours=1)
            
            # 使用 PID 确保每个进程有独立目录
            unique_dir = os.path.join(temp_dir, f"session_{os.getpid()}")
            os.makedirs(unique_dir, exist_ok=True)
            return unique_dir
        else:
            # 单进程模式：使用共享目录（保持登录状态）
            edge_data = os.path.join(base_dir, "edge_browser_data")
            os.makedirs(edge_data, exist_ok=True)
            return edge_data
    
    def _cleanup_old_temp_dirs(self, temp_dir: str, max_age_hours: int = 1) -> None:
        """清理旧的临时目录
        
        Args:
            temp_dir: 临时目录父路径
            max_age_hours: 最大保留时间（小时）
        """
        try:
            import shutil
            cutoff = time.time() - (max_age_hours * 3600)
            
            for item in os.listdir(temp_dir):
                if not item.startswith("session_"):
                    continue
                
                item_path = os.path.join(temp_dir, item)
                if not os.path.isdir(item_path):
                    continue
                
                try:
                    # 检查目录修改时间
                    mtime = os.path.getmtime(item_path)
                    if mtime < cutoff:
                        # 检查进程是否还在运行
                        pid_str = item.replace("session_", "")
                        if pid_str.isdigit():
                            pid = int(pid_str)
                            if not self._is_process_running(pid):
                                logger.debug(f"清理旧临时目录: {item}")
                                shutil.rmtree(item_path, ignore_errors=True)
                except Exception as e:
                    logger.debug(f"清理目录 {item} 失败: {e}")
        except Exception as e:
            logger.debug(f"清理临时目录失败: {e}")
    
    def _is_process_running(self, pid: int) -> bool:
        """检查进程是否还在运行（跨平台）
        
        Args:
            pid: 进程 ID
            
        Returns:
            进程是否运行中
        """
        import sys
        
        try:
            if sys.platform == "win32":
                # Windows: 使用 ctypes
                import ctypes
                kernel32 = ctypes.windll.kernel32
                PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
                handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
                if handle:
                    kernel32.CloseHandle(handle)
                    return True
                return False
            else:
                # macOS/Linux: 使用 os.kill(pid, 0) 检测
                import os
                os.kill(pid, 0)
                return True
        except (OSError, ProcessLookupError):
            return False
        except Exception:
            # 如果无法检查，假设进程不在运行
            return False
    
    def _get_storage_state_path(self) -> str:
        """获取认证状态文件路径
        
        使用 storageState 文件在多进程间共享登录状态。
        """
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        return os.path.join(base_dir, "edge_browser_data", "storage_state.json")
    
    def _save_storage_state(self, context) -> bool:
        """保存认证状态到文件
        
        使用临时文件 + 原子重命名避免多进程写入冲突。
        
        Args:
            context: Playwright BrowserContext
            
        Returns:
            是否保存成功
        """
        try:
            state_path = self._get_storage_state_path()
            os.makedirs(os.path.dirname(state_path), exist_ok=True)
            
            # 使用临时文件 + 原子重命名，避免多进程写入冲突
            temp_path = f"{state_path}.{os.getpid()}.tmp"
            context.storage_state(path=temp_path)
            
            # 原子重命名（Windows 上需要先删除目标文件）
            try:
                os.replace(temp_path, state_path)
            except OSError:
                # Windows 兼容：如果 replace 失败，尝试删除后重命名
                if os.path.exists(state_path):
                    os.remove(state_path)
                os.rename(temp_path, state_path)
            
            logger.info(f"已保存认证状态到: {state_path}")
            return True
        except Exception as e:
            logger.warning(f"保存认证状态失败: {e}")
            # 清理临时文件
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except Exception:
                pass
            return False
    
    def _load_storage_state(self) -> Optional[str]:
        """加载认证状态文件路径（如果存在）
        
        Returns:
            状态文件路径，不存在返回 None
        """
        state_path = self._get_storage_state_path()
        if os.path.exists(state_path):
            # 检查文件是否过期（超过 24 小时）
            try:
                mtime = os.path.getmtime(state_path)
                age_hours = (time.time() - mtime) / 3600
                if age_hours > 24:
                    logger.info(f"认证状态文件已过期（{age_hours:.1f}小时），将重新登录")
                    return None
                logger.info(f"加载认证状态文件: {state_path}")
                return state_path
            except Exception as e:
                logger.warning(f"检查认证状态文件失败: {e}")
                return None
        return None
    
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
        
        # 关闭浏览器实例（多进程模式下使用）
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
            
            # 使用普通浏览器 + storage_state 共享登录状态
            # 这样多个 Kiro 窗口可以同时使用（不会锁定用户数据目录）
            logger.info("使用独立浏览器实例 + 共享 storage_state（支持多窗口并发）")
            
            launch_options = {
                "executable_path": self._browser_path,
                "headless": self.headless,
                "args": launch_args,
            }
            
            if proxy_server:
                launch_options["proxy"] = {"server": proxy_server}
            
            self._browser = self._playwright.chromium.launch(**launch_options)
            
            # 创建上下文时加载共享的 storage_state
            context_options = {
                "viewport": {'width': 1920, 'height': 1080},
                "user_agent": 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
                "locale": language,
            }
            
            # 尝试加载共享的认证状态
            storage_state_path = self._load_storage_state()
            if storage_state_path:
                context_options["storage_state"] = storage_state_path
                logger.info(f"已加载共享认证状态: {storage_state_path}")
            else:
                logger.info("无共享认证状态，使用新会话")
            
            self._context = self._browser.new_context(**context_options)
            
            self._page = self._context.new_page()
            
            # 最佳实践：拦截无用资源（图片、字体、CSS）加速页面加载、降低内存
            self._setup_resource_interception(self._page)
            
            self._session_active = True
            self._last_activity_time = time.time()
            
            logger.info("浏览器会话启动成功")
            return True
            
        except Exception as e:
            logger.error(f"启动浏览器会话失败: {e}")
            self.close_session()
            return False
    
    # AI 正在加载/思考的关键词（检测到这些时需要继续等待）
    AI_LOADING_KEYWORDS = [
        "正在思考",
        "正在生成",
        "Thinking",
        "Generating",
        "Loading",
    ]
    
    # 需要拦截的资源类型（最佳实践：降低内存和带宽消耗）
    BLOCKED_RESOURCE_TYPES = {'image', 'font', 'media'}
    # 需要拦截的 URL 模式（广告、追踪等）
    BLOCKED_URL_PATTERNS = [
        'googleadservices.com',
        'googlesyndication.com',
        'doubleclick.net',
        'google-analytics.com',
        'googletagmanager.com',
        'facebook.com/tr',
        'connect.facebook.net',
    ]
    
    def _setup_resource_interception(self, page: "Page") -> None:
        """设置资源拦截，加速页面加载
        
        最佳实践：拦截图片、字体、广告等无用资源，降低内存和带宽消耗。
        
        Args:
            page: Playwright Page 对象
        """
        def handle_route(route):
            try:
                request = route.request
                resource_type = request.resource_type
                url = request.url
                
                # 拦截无用资源类型
                if resource_type in self.BLOCKED_RESOURCE_TYPES:
                    route.abort()
                    return
                
                # 拦截广告和追踪脚本
                for pattern in self.BLOCKED_URL_PATTERNS:
                    if pattern in url:
                        route.abort()
                        return
                
                # 放行其他请求
                route.continue_()
            except Exception:
                # 忽略路由处理中的异常（页面可能已关闭）
                pass
        
        try:
            # 拦截所有请求
            page.route('**/*', handle_route)
            logger.debug("已设置资源拦截（图片、字体、广告）")
        except Exception as e:
            logger.warning(f"设置资源拦截失败: {e}")
    
    def _wait_for_streaming_complete(self, page, max_wait_seconds: int = 30) -> bool:
        """等待 AI 流式输出完成
        
        基于 2026 年最佳实践的优化策略：
        1. 优先检测加载指示器（光标、停止按钮）消失
        2. 检测追问建议出现（表示生成完成）
        3. 监控内容增长，连续稳定则认为完成
        4. 检测"正在思考"等加载状态关键词
        
        Args:
            page: Playwright Page 对象
            max_wait_seconds: 最大等待时间（秒）
            
        Returns:
            是否成功等待完成
        """
        logger.info("等待 AI 流式输出完成...")
        
        last_content_length = 0
        stable_count = 0
        stable_threshold = 3  # 连续 3 次检测内容不变则认为完成（增加到 3 次更可靠）
        check_interval = 500  # 500ms 采样间隔
        min_content_length = 500  # 最小内容长度，避免在"正在思考"时就结束（增加到 500）
        
        for i in range(max_wait_seconds * 2):  # 因为间隔减半，循环次数加倍
            try:
                content = page.evaluate("() => document.body.innerText")
                current_length = len(content)
                
                # 策略1：检查加载指示器是否存在（最快的检测方式）
                has_loading_indicator = self._check_loading_indicators(page)
                
                # 策略2：检查是否仍在加载状态（关键词检测）
                is_loading = any(kw in content for kw in self.AI_LOADING_KEYWORDS)
                
                # 策略3：检查追问建议是否出现（表示生成完成）
                has_follow_up = self._check_follow_up_suggestions(page)
                
                if has_follow_up and current_length >= min_content_length:
                    # 追问建议出现，说明生成完成
                    logger.info(f"检测到追问建议，AI 输出完成，内容长度: {current_length}")
                    return True
                
                if has_loading_indicator or is_loading:
                    # 仍在加载，重置稳定计数
                    stable_count = 0
                    if has_loading_indicator:
                        logger.debug("检测到加载指示器，继续等待...")
                    else:
                        logger.debug("AI 正在思考/生成中，继续等待...")
                elif current_length == last_content_length:
                    # 内容稳定且不在加载状态
                    if current_length >= min_content_length:
                        stable_count += 1
                        logger.debug(f"内容稳定检测: {stable_count}/{stable_threshold}")
                        if stable_count >= stable_threshold:
                            logger.info(f"AI 输出完成，内容长度: {current_length}")
                            return True
                    else:
                        # 内容太短，可能还没开始输出
                        logger.debug(f"内容太短 ({current_length} < {min_content_length})，继续等待")
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
    
    def _check_follow_up_suggestions(self, page: "Page") -> bool:
        """检查页面上是否出现追问建议（表示 AI 生成完成）
        
        Args:
            page: Playwright Page 对象
            
        Returns:
            是否出现追问建议
        """
        # 追问建议的选择器
        follow_up_selectors = [
            'div[data-subtree="aimc"] textarea',  # 追问输入框
            'div[data-subtree="aimc"] input[type="text"]',  # 追问输入框（备用）
            '[aria-label*="follow"]',  # 追问相关元素
            '[aria-label*="追问"]',  # 中文追问
            '[placeholder*="follow"]',  # 追问输入框
            '[placeholder*="追问"]',  # 中文追问输入框
        ]
        
        for selector in follow_up_selectors:
            try:
                element = page.query_selector(selector)
                if element and element.is_visible():
                    return True
            except Exception:
                continue
        return False
    
    def _check_loading_indicators(self, page) -> bool:
        """检查页面上是否存在加载指示器
        
        Args:
            page: Playwright Page 对象
            
        Returns:
            是否存在加载指示器
        """
        for selector in self.AI_LOADING_SELECTORS:
            try:
                element = page.query_selector(selector)
                if element and element.is_visible():
                    return True
            except Exception:
                continue
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
        'div[data-subtree="aimc"]',  # 2026 年 Google AI Mode 核心容器（最新）
        'div[data-attrid="wa:/m/0"]',  # 旧版选择器
        '[data-async-type="editableDirectAnswer"]',  # AI 回答区域
        '.wDYxhc',  # AI 概述容器
        '[data-md="50"]',  # AI 模式标记
    ]
    AI_KEYWORDS = ['AI 模式', 'AI Mode', 'AI モード']
    
    # AI 正在生成的指示器选择器（检测到这些元素存在时需要继续等待）
    AI_LOADING_SELECTORS = [
        '.typing-cursor',  # 打字光标
        '[data-loading="true"]',  # 加载状态标记
        '.stop-button:not([hidden])',  # 停止按钮可见
    ]
    
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
    
    def _wait_for_ai_content(self, page: "Page", timeout_per_selector: int = 1500) -> bool:
        """等待 AI 内容加载
        
        优化策略：先快速检查关键词（毫秒级），再尝试选择器（秒级）
        
        Args:
            page: Playwright Page 对象
            timeout_per_selector: 每个选择器的超时时间（毫秒）
            
        Returns:
            是否检测到 AI 内容
        """
        # 首先处理可能的 Cookie 同意对话框
        self._handle_cookie_consent(page)
        
        # 优先策略：快速检查页面关键词（最快，毫秒级）
        try:
            content = page.evaluate("() => document.body.innerText")
            if any(kw in content for kw in self.AI_KEYWORDS):
                logger.info("通过关键词快速检测到 AI 内容")
                return True
        except Exception:
            pass
        
        # 备用策略：尝试选择器（较慢，但更精确）
        for selector in self.AI_SELECTORS:
            try:
                page.wait_for_selector(selector, timeout=timeout_per_selector)
                logger.info(f"检测到 AI 回答区域: {selector}")
                return True
            except Exception:
                continue
        
        # 最后策略：等待关键词出现（页面可能还在加载）
        logger.debug("未找到 AI 内容，等待页面加载...")
        for _ in range(3):  # 最多等待 3 秒
            page.wait_for_timeout(1000)
            try:
                content = page.evaluate("() => document.body.innerText")
                if any(kw in content for kw in self.AI_KEYWORDS):
                    logger.info("通过关键词检测到 AI 内容")
                    return True
            except Exception:
                continue
        
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
            
            # 搜索成功后保存认证状态（供其他 Kiro 窗口使用）
            if result.success and self._context:
                self._save_storage_state(self._context)
            
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
            // 多语言支持：内容结束标记（页脚、相关搜索、反馈区域等）
            const endMarkers = [
                '相关搜索', 'Related searches', '関連する検索', '관련 검색',
                '意见反馈', 'Send feedback', 'フィードバックを送信',
                '帮助', 'Help', 'ヘルプ',
                '隐私权', 'Privacy', 'プライバシー',
                '条款', 'Terms', '利用規約',
            ];
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
            
            // 硬编码上限：防止异常情况下提取过多内容（50KB，约 2.5 万汉字）
            const MAX_CONTENT_LENGTH = 50000;
            
            // 辅助函数：查找最近的结束标记位置（带硬编码上限）
            function findEndIndex(startPos) {
                // 硬编码上限作为最后防线
                let endIdx = Math.min(mainContent.length, startPos + MAX_CONTENT_LENGTH);
                for (const marker of endMarkers) {
                    const idx = mainContent.indexOf(marker, startPos);
                    if (idx !== -1 && idx < endIdx) {
                        endIdx = idx;
                    }
                }
                return endIdx;
            }
            
            // 辅助函数：清理导航文本
            function cleanAnswer(text) {
                let cleaned = text;
                for (const pattern of navPatterns) {
                    cleaned = cleaned.replace(pattern, '');
                }
                return cleaned.trim();
            }
            
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
                // 找到 AI 模式和搜索结果标签，取中间内容
                result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, searchResultIndex));
            } else if (aiModeIndex !== -1) {
                // 只找到 AI 模式标签，取到结束标记
                const endIndex = findEndIndex(aiModeIndex + 100);
                result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, endIndex));
            } else {
                // 备用方案：取到结束标记
                const endIndex = findEndIndex(100);
                result.aiAnswer = cleanAnswer(mainContent.substring(0, endIndex));
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
        
        支持多语言导航文本清理：中文、英文、日语、韩语、德语、法语。
        
        Args:
            text: 原始文本
            
        Returns:
            清理后的文本
            
        **Validates: Requirements 5.4, 6.4**
        """
        import re
        
        # 多语言导航文本模式
        # 按语言分组，便于维护和扩展
        patterns = [
            # === 中文 (zh-CN) ===
            r'^AI 模式\s*',
            r'全部\s*图片\s*视频\s*新闻\s*更多',
            r'登录',
            r'AI 的回答未必正确无误，请注意核查',
            r'AI 回答可能包含错误。?\s*了解详情',
            r'请谨慎使用此类代码。?',
            r'\d+ 个网站',
            r'全部显示',
            r'查看相关链接',
            r'关于这条结果',
            r'搜索结果',
            r'相关搜索',
            r'意见反馈',
            r'帮助',
            r'隐私权',
            r'条款',
            
            # === 英文 (en-US) ===
            r'^AI Mode\s*',
            r'All\s*Images\s*Videos\s*News\s*More',
            r'Sign in',
            r'AI responses may include mistakes\.?\s*Learn more',
            r'AI overview\s*',
            r'Use code with caution\.?',
            r'\d+ sites?',
            r'Show all',
            r'View related links',
            r'About this result',
            r'Search Results',
            r'Related searches',
            r'Send feedback',
            r'Help',
            r'Privacy',
            r'Terms',
            r'Accessibility links',
            r'Skip to main content',
            r'Accessibility help',
            r'Accessibility feedback',
            r'Filters and topics',
            r'AI Mode response is ready',
            
            # === 日语 (ja-JP) ===
            r'^AI モード\s*',
            r'すべて\s*画像\s*動画\s*ニュース\s*もっと見る',
            r'ログイン',
            r'AI の回答には間違いが含まれている場合があります。?\s*詳細',
            r'\d+ 件のサイト',
            r'すべて表示',
            r'検索結果',
            r'関連する検索',
            r'フィードバックを送信',
            r'ヘルプ',
            r'プライバシー',
            r'利用規約',
            r'ユーザー補助のリンク',
            r'メイン コンテンツにスキップ',
            r'ユーザー補助ヘルプ',
            r'ユーザー補助に関するフィードバック',
            r'フィルタとトピック',
            r'AI モードの回答が作成されました',
            
            # === 韩语 (ko-KR) ===
            r'^AI 모드\s*',
            r'전체\s*이미지\s*동영상\s*뉴스\s*더보기',
            r'로그인',
            r'AI 응답에 실수가 포함될 수 있습니다\.?\s*자세히 알아보기',
            r'\d+개 사이트',
            r'모두 표시',
            r'검색결과',
            r'관련 검색',
            r'의견 보내기',
            r'도움말',
            r'개인정보처리방침',
            r'약관',
            
            # === 德语 (de-DE) ===
            r'^KI-Modus\s*',
            r'Alle\s*Bilder\s*Videos\s*News\s*Mehr',
            r'Anmelden',
            r'KI-Antworten können Fehler enthalten\.?\s*Weitere Informationen',
            r'\d+ Websites?',
            r'Alle anzeigen',
            r'Suchergebnisse',
            r'Ähnliche Suchanfragen',
            r'Feedback senden',
            r'Hilfe',
            r'Datenschutz',
            r'Nutzungsbedingungen',
            
            # === 法语 (fr-FR) ===
            r'^Mode IA\s*',
            r'Tous\s*Images\s*Vidéos\s*Actualités\s*Plus',
            r'Connexion',
            r'Les réponses de l\'IA peuvent contenir des erreurs\.?\s*En savoir plus',
            r'\d+ sites?',
            r'Tout afficher',
            r'Résultats de recherche',
            r'Recherches associées',
            r'Envoyer des commentaires',
            r'Aide',
            r'Confidentialité',
            r'Conditions',
        ]
        
        result = text
        for pattern in patterns:
            # 使用 IGNORECASE 标志处理大小写不敏感的模式（主要针对英文）
            result = re.sub(pattern, '', result, flags=re.IGNORECASE)
        
        # 清理多余的空白字符
        # 1. 将多个连续空格替换为单个空格
        result = re.sub(r' +', ' ', result)
        # 2. 将多个连续换行替换为单个换行
        result = re.sub(r'\n+', '\n', result)
        # 3. 去除首尾空白
        result = result.strip()
        
        return result
    
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


class AsyncGoogleAISearcher:
    """Async Google AI Searcher using nodriver
    
    使用 nodriver 访问 Google AI 模式（udm=50）获取 AI 总结的搜索结果。
    支持多轮对话：保持浏览器会话，在同一页面追问。
    
    Attributes:
        timeout: Page load timeout in seconds
        headless: Whether to run in headless mode (not recommended for nodriver)
        use_user_data: Whether to use persistent user data directory
    """
    
    # Edge 可能的安装路径（跨平台）- 优先级更高
    EDGE_PATHS = [
        # Windows
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        # macOS
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        # Linux
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
    ]
    
    # Chrome 可能的安装路径（跨平台）
    CHROME_PATHS = [
        # Windows
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
        # macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        # Linux
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ]
    
    # 会话超时时间（秒）- 超过此时间未使用则关闭会话
    SESSION_TIMEOUT = 300  # 5 分钟
    
    # AI 模式选择器和关键词常量
    AI_SELECTORS = [
        'div[data-subtree="aimc"]',  # Google AI Mode 核心容器（最新）
        'div[data-attrid="wa:/m/0"]',  # 旧版选择器
        '[data-async-type="editableDirectAnswer"]',  # AI 回答区域
        '.wDYxhc',  # AI 概述容器
        '[data-md="50"]',  # AI 模式标记
    ]
    
    # 多语言 AI 模式关键词
    AI_KEYWORDS = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA']
    
    # AI 正在生成的指示器选择器（检测到这些元素存在时需要继续等待）
    # 注意：这些选择器需要非常精确，避免误匹配页面上的其他元素
    # 如果不确定，宁可不检测加载指示器，依赖内容稳定性检测
    AI_LOADING_SELECTORS = [
        # Google AI 模式特定的加载指示器（2026年更新）
        '[data-loading="true"]',  # 加载状态标记
        '[aria-busy="true"]',  # ARIA 忙碌状态
        '.ai-loading-indicator',  # AI 加载指示器类
        '[data-generating="true"]',  # 生成中状态
    ]
    
    # AI 正在加载/思考的关键词（检测到这些时需要继续等待）
    # 注意：这些关键词必须是 AI 生成过程中的临时文本，不能是最终内容的一部分
    AI_LOADING_KEYWORDS = [
        "正在思考",
        "正在生成",
        "Thinking...",  # 添加省略号避免误匹配
        "Generating...",  # 添加省略号避免误匹配
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
    
    # 验证码检测关键词（多语言支持）
    # 检测到这些关键词时，需要打开可见窗口让用户手动完成验证
    CAPTCHA_KEYWORDS = [
        # 中文
        "异常流量",
        "我们的系统检测到",
        "验证您是真人",
        # 英文
        "unusual traffic",
        "automated requests",
        "prove you're not a robot",
        "verify you're human",
        # 通用
        "recaptcha",
        "captcha",
    ]
    
    # 用户介入等待超时时间（秒）
    USER_INTERVENTION_TIMEOUT = 300  # 5 分钟
    
    def __init__(
        self,
        timeout: int = 30,
        headless: bool = True,  # 默认后台运行，只有验证码时才弹出窗口
        use_user_data: bool = True
    ) -> None:
        """初始化 AsyncGoogleAISearcher
        
        Args:
            timeout: 页面加载超时时间（秒）
            headless: 无头模式设置。True=后台运行，False=显示窗口
            use_user_data: 是否使用用户浏览器数据（可复用登录状态）
        """
        self.timeout = timeout
        self.headless = headless
        self.use_user_data = use_user_data
        
        # 检测并存储浏览器路径
        self._browser_path: Optional[str] = self._find_browser()
        
        # 获取用户数据目录
        self._user_data_dir: Optional[str] = self._get_user_data_dir() if use_user_data else None
        
        # 浏览器会话状态（将在后续任务中实现）
        self._browser = None
        self._tab = None
        self._session_active = False
        self._last_activity_time: float = 0
        
        # 代理服务器地址（在 _start_browser 中设置）
        self._proxy_server: Optional[str] = None
        
        # 多轮对话增量提取：记录上一次的 AI 回答内容
        self._last_ai_answer: str = ""
        
        # 记录浏览器检测结果
        if self._browser_path:
            logger.info(f"AsyncGoogleAISearcher 初始化: timeout={timeout}s, headless={headless}, use_user_data={use_user_data}")
            logger.info(f"浏览器路径: {self._browser_path}")
            if self._user_data_dir:
                logger.info(f"用户数据目录: {self._user_data_dir}")
        else:
            logger.warning("AsyncGoogleAISearcher 初始化: 未找到可用的浏览器（Edge 或 Chrome）")
    
    def _find_browser(self) -> Optional[str]:
        """查找可用的浏览器
        
        优先检测 Chrome，然后检测 Edge 作为备用。
        
        Returns:
            浏览器可执行文件路径，未找到返回 None
            
        **Validates: Requirements 1.1, 1.2**
        """
        # 优先 Chrome
        for path in self.CHROME_PATHS:
            if os.path.exists(path):
                logger.debug(f"检测到 Chrome 浏览器: {path}")
                return path
        
        # 备用 Edge
        for path in self.EDGE_PATHS:
            if os.path.exists(path):
                logger.debug(f"检测到 Edge 浏览器: {path}")
                return path
        
        logger.warning("未找到可用的浏览器（Chrome 或 Edge）")
        return None
    
    def _get_user_data_dir(self) -> Optional[str]:
        """获取用户数据目录
        
        使用专用的浏览器数据目录（browser_data），不影响用户日常使用的浏览器。
        
        Returns:
            用户数据目录路径
            
        **Validates: Requirements 1.4**
        """
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        browser_data = os.path.join(base_dir, "browser_data")
        os.makedirs(browser_data, exist_ok=True)
        return browser_data
    
    def get_browser_path(self) -> Optional[str]:
        """获取检测到的浏览器路径
        
        Returns:
            浏览器可执行文件路径，未找到返回 None
            
        **Validates: Requirements 1.2**
        """
        return self._browser_path
    
    def get_browser_error(self) -> Optional[str]:
        """获取浏览器检测错误信息
        
        Returns:
            错误信息，如果浏览器已找到则返回 None
            
        **Validates: Requirements 1.3**
        """
        if self._browser_path is None:
            return "未找到可用的浏览器（Chrome 或 Edge）。请安装 Microsoft Edge 或 Google Chrome。"
        return None
    
    def has_active_session(self) -> bool:
        """检查是否有活跃的浏览器会话
        
        检查浏览器实例是否存在且会话未超时。
        
        Returns:
            是否有活跃会话（且未超时）
            
        **Validates: Requirements 2.2, 2.3**
        """
        if not self._session_active or self._browser is None:
            return False
        
        # 检查会话是否超时（5 分钟）
        if self._last_activity_time > 0:
            elapsed = time.time() - self._last_activity_time
            if elapsed > self.SESSION_TIMEOUT:
                logger.info(f"会话已超时（{elapsed:.0f}秒），需要关闭")
                return False
        
        return True
    
    async def _start_browser(self, language: str = "zh-CN") -> bool:
        """Start nodriver browser with configuration
        
        使用 nodriver.start() 启动浏览器，配置用户数据目录、浏览器路径等。
        代理配置使用 create_context() 方式，在 headless 模式下更可靠。
        
        反检测措施：
        - 使用 --disable-blink-features=AutomationControlled 禁用自动化标记
        - 设置合适的窗口大小避免被检测为无头浏览器
        - 使用 nodriver 内置的反检测能力
        
        Args:
            language: 语言代码（如 zh-CN, en-US）
            
        Returns:
            是否成功启动浏览器
            
        **Validates: Requirements 2.1, 2.5**
        """
        import nodriver as uc
        
        # 检查浏览器路径
        if self._browser_path is None:
            logger.error("无法启动浏览器：未找到可用的浏览器")
            return False
        
        try:
            # 检测系统代理
            self._proxy_server = self._detect_proxy()
            if self._proxy_server:
                logger.info(f"检测到系统代理: {self._proxy_server}")
            
            logger.info(f"启动 nodriver 浏览器: headless={self.headless}, language={language}")
            
            # 反检测浏览器参数
            # 这些参数帮助绕过 Google 等网站的机器人检测
            browser_args = [
                '--disable-blink-features=AutomationControlled',  # 关键：禁用自动化控制标记
                '--disable-dev-shm-usage',  # 避免共享内存问题
                '--no-first-run',  # 跳过首次运行向导
                '--no-default-browser-check',  # 跳过默认浏览器检查
                '--disable-infobars',  # 禁用信息栏
                '--window-size=1920,1080',  # 设置合理的窗口大小
                '--start-maximized',  # 最大化窗口
                '--no-sandbox',  # 禁用沙箱（某些环境需要）
            ]
            
            # 配置浏览器选项并启动
            # nodriver.start() 参数说明：
            # - user_data_dir: 用户数据目录，用于持久化会话
            #   注意：headless=True 时不能使用已有的 user_data_dir，会导致启动失败
            #   因此无头模式下使用临时目录（nodriver 自动创建）
            # - browser_executable_path: 浏览器可执行文件路径
            # - headless: 无头模式
            # - locale: 浏览器语言设置
            # - browser_args: 额外的浏览器启动参数（反检测）
            # 注意：代理不再通过 browser_args 配置，而是通过 create_context() 配置
            # 这样在 headless 模式下代理才能正常工作
            
            # 无头模式下不使用 user_data_dir（会导致启动失败）
            # 有头模式下可以使用 user_data_dir 保持登录状态
            use_data_dir = None if self.headless else (self._user_data_dir if self.use_user_data else None)
            
            self._browser = await uc.start(
                user_data_dir=use_data_dir,
                browser_executable_path=self._browser_path,
                headless=self.headless,
                locale=language,
                browser_args=browser_args,
                no_sandbox=True,  # 禁用沙箱，某些环境需要
            )
            
            # 如果有代理，使用 create_context 创建带代理的标签页
            # 这是 nodriver 推荐的代理配置方式，在 headless 模式下更可靠
            if self._proxy_server:
                logger.info(f"使用 create_context 配置代理: {self._proxy_server}")
                try:
                    # create_context 返回一个新的标签页，该标签页使用指定的代理
                    self._tab = await self._browser.create_context(
                        proxy_server=self._proxy_server,
                    )
                    logger.info("代理标签页创建成功")
                except Exception as e:
                    logger.warning(f"create_context 代理配置失败: {e}，回退到主标签页")
                    self._tab = self._browser.main_tab
            else:
                # 无代理时使用主标签页
                self._tab = self._browser.main_tab
            
            # 更新会话状态
            self._session_active = True
            self._last_activity_time = time.time()
            
            logger.info("nodriver 浏览器启动成功")
            return True
            
        except Exception as e:
            logger.error(f"启动 nodriver 浏览器失败: {e}")
            import traceback
            logger.error(f"堆栈跟踪:\n{traceback.format_exc()}")
            
            # 清理状态
            self._browser = None
            self._tab = None
            self._session_active = False
            return False
    
    async def close_session(self) -> None:
        """Close browser session and cleanup resources
        
        关闭浏览器会话，清理所有资源。使用 browser.stop() 进行清理。
        
        **Validates: Requirements 2.4**
        """
        logger.info("关闭浏览器会话...")
        
        # 重置会话状态
        self._session_active = False
        self._last_ai_answer = ""
        self._last_activity_time = 0
        
        # 关闭浏览器
        if self._browser is not None:
            try:
                # nodriver 使用 stop() 方法关闭浏览器
                self._browser.stop()
                logger.debug("浏览器已停止")
            except Exception as e:
                logger.debug(f"关闭浏览器时出错: {e}")
            finally:
                self._browser = None
        
        # 清理标签页引用
        self._tab = None
        
        logger.info("浏览器会话已关闭")
    
    def _update_activity_time(self) -> None:
        """更新最后活动时间
        
        在每次搜索或追问操作时调用，用于会话超时管理。
        
        **Validates: Requirements 2.2**
        """
        self._last_activity_time = time.time()
        logger.debug(f"更新活动时间: {self._last_activity_time}")
    
    def _build_url(self, query: str, language: str = "zh-CN") -> str:
        """构建 Google AI 模式搜索 URL
        
        构造包含 AI 模式参数（udm=50）和语言参数（hl）的 Google 搜索 URL。
        使用 urllib.parse.urlencode 确保查询字符串正确编码，包括特殊字符和 Unicode。
        
        Args:
            query: 搜索查询字符串
            language: 语言代码（如 zh-CN, en-US, ja-JP 等）
            
        Returns:
            完整的 Google AI 模式搜索 URL
            
        **Validates: Requirements 3.1, 3.2, 3.3**
        
        Examples:
            >>> searcher._build_url("Python 教程", "zh-CN")
            'https://www.google.com/search?q=Python+%E6%95%99%E7%A8%8B&udm=50&hl=zh-CN'
            >>> searcher._build_url("hello world", "en-US")
            'https://www.google.com/search?q=hello+world&udm=50&hl=en-US'
        """
        from urllib.parse import urlencode
        
        # 构建查询参数
        # - q: 搜索查询（urlencode 会自动处理特殊字符和 Unicode）
        # - udm: 50 表示 AI 模式
        # - hl: 语言代码
        params = {
            'q': query,
            'udm': '50',  # AI Mode
            'hl': language,
        }
        
        base_url = "https://www.google.com/search"
        return f"{base_url}?{urlencode(params)}"
    
    async def _ensure_session(self, language: str = "zh-CN") -> bool:
        """确保浏览器会话已启动
        
        如果会话已超时或不存在，则启动新会话。
        
        Args:
            language: 语言代码
            
        Returns:
            是否成功确保会话可用
            
        **Validates: Requirements 2.2, 2.3**
        """
        # 检查现有会话是否有效
        if self.has_active_session():
            # 更新活动时间
            self._update_activity_time()
            return True
        
        # 如果会话已超时，先关闭
        if self._browser is not None:
            logger.info("会话已超时，关闭旧会话...")
            await self.close_session()
        
        # 启动新会话
        logger.info("启动新的浏览器会话...")
        return await self._start_browser(language)
    
    def _detect_proxy(self) -> Optional[str]:
        """检测系统代理设置
        
        检测顺序：
        1. 检查环境变量（HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy）
        2. 检测常见本地代理端口（v2ray, clash 等）
        
        代理优先级：HTTP 代理优先于 SOCKS5（更稳定）
        
        Returns:
            代理服务器地址，如 "http://127.0.0.1:10808"，未检测到返回 None
            
        **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
        """
        # 1. 检查环境变量（优先级最高）
        # 按优先级顺序检查：HTTP_PROXY > HTTPS_PROXY（大小写都检查）
        env_vars = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']
        for env_var in env_vars:
            proxy = os.environ.get(env_var)
            if proxy:
                logger.debug(f"从环境变量 {env_var} 检测到代理: {proxy}")
                return proxy
        
        # 2. 检测常见本地代理端口（v2ray, clash 等）
        # Chrome 对 SOCKS5 代理支持更好，优先使用 SOCKS5
        # 端口列表按优先级排序
        # 注意：v2ray 默认配置是 10809=HTTP, 10808=SOCKS5
        common_ports = [
            # v2ray SOCKS5 代理（优先）- 默认端口 10808，Chrome 支持更好
            (10808, "socks5://127.0.0.1:10808"),
            # v2ray HTTP 代理 - 默认端口 10809
            (10809, "http://127.0.0.1:10809"),
            # clash 混合代理（HTTP/SOCKS5 都支持）
            (7890, "http://127.0.0.1:7890"),
            # clash SOCKS5 代理
            (7891, "socks5://127.0.0.1:7891"),
            # 通用 SOCKS5 端口
            (1080, "socks5://127.0.0.1:1080"),
        ]
        
        for port, proxy_url in common_ports:
            if self._is_port_open(port):
                logger.debug(f"检测到本地代理端口 {port} 开放，使用代理: {proxy_url}")
                return proxy_url
        
        logger.debug("未检测到可用的代理")
        return None
    
    def _is_port_open(self, port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
        """检测指定端口是否开放
        
        使用 socket 连接测试端口是否可用。
        
        Args:
            port: 端口号
            host: 主机地址，默认为本地
            timeout: 连接超时时间（秒）
            
        Returns:
            端口是否开放
        """
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            sock.close()
            return result == 0
        except Exception:
            return False
    
    async def _navigate_to_url(self, url: str) -> tuple[bool, Optional[str]]:
        """Navigate to a URL using nodriver's tab.get()
        
        使用 nodriver 的 tab.get() 方法导航到指定 URL。
        处理导航超时错误并返回适当的错误信息。
        
        Args:
            url: 要导航到的 URL
            
        Returns:
            tuple[bool, Optional[str]]: (是否成功, 错误信息)
            - 成功时返回 (True, None)
            - 失败时返回 (False, 错误信息)
            
        **Validates: Requirements 4.1, 4.4**
        
        Examples:
            >>> success, error = await searcher._navigate_to_url("https://www.google.com/search?q=test&udm=50")
            >>> if success:
            ...     print("导航成功")
            ... else:
            ...     print(f"导航失败: {error}")
        """
        # 检查标签页是否可用
        if self._tab is None:
            error_msg = "浏览器标签页不可用，请先启动浏览器会话"
            logger.error(error_msg)
            return False, error_msg
        
        logger.info(f"导航到 URL: {url}")
        
        try:
            # 使用 nodriver 的 tab.get() 进行页面导航
            # nodriver API: await tab.get(url) 替代 Playwright 的 page.goto(url)
            await self._tab.get(url)
            
            # 更新活动时间
            self._update_activity_time()
            
            logger.info("页面导航成功")
            return True, None
            
        except asyncio.TimeoutError:
            # 处理导航超时错误
            error_msg = f"页面加载超时（{self.timeout}秒）: {url}"
            logger.error(error_msg)
            return False, error_msg
            
        except Exception as e:
            # 处理其他导航错误
            error_msg = f"页面导航失败: {str(e)}"
            logger.error(error_msg)
            import traceback
            logger.debug(f"堆栈跟踪:\n{traceback.format_exc()}")
            return False, error_msg
    
    async def _wait_for_ai_content(self, timeout_per_selector: float = 2.0) -> bool:
        """Wait for AI content to appear on page
        
        使用多种策略等待 AI 内容加载：
        1. 优先使用 JavaScript 快速检查页面关键词（毫秒级）
        2. 使用 nodriver 的 tab.wait_for() 等待选择器（秒级）
        3. 轮询检查页面内容直到找到 AI 关键词
        
        Args:
            timeout_per_selector: 每个选择器的超时时间（秒）
            
        Returns:
            是否检测到 AI 内容
            
        **Validates: Requirements 4.2**
        
        Examples:
            >>> found = await searcher._wait_for_ai_content()
            >>> if found:
            ...     print("AI 内容已加载")
        """
        if self._tab is None:
            logger.error("浏览器标签页不可用")
            return False
        
        logger.info("等待 AI 内容加载...")
        
        # 策略1：快速检查页面关键词（最快，毫秒级）
        # 使用 JavaScript 评估获取页面文本内容
        try:
            content = await self._tab.evaluate("document.body.innerText", return_by_value=True)
            if content and any(kw in content for kw in self.AI_KEYWORDS):
                logger.info("通过关键词快速检测到 AI 内容")
                return True
        except Exception as e:
            logger.debug(f"JavaScript 评估失败: {e}")
        
        # 策略2：尝试使用 nodriver 的 wait_for 等待选择器（较慢，但更精确）
        # nodriver API: await tab.wait_for(selector, timeout) 返回元素或 None
        for selector in self.AI_SELECTORS:
            try:
                # nodriver 的 wait_for 返回元素，超时返回 None
                element = await self._tab.wait_for(selector, timeout=timeout_per_selector)
                if element:
                    logger.info(f"检测到 AI 回答区域: {selector}")
                    return True
            except Exception as e:
                logger.debug(f"等待选择器 {selector} 失败: {e}")
                continue
        
        # 策略3：轮询检查页面内容（最后手段）
        logger.debug("未找到 AI 内容，轮询等待页面加载...")
        for i in range(3):  # 最多等待 3 秒
            await asyncio.sleep(1.0)
            try:
                content = await self._tab.evaluate("document.body.innerText", return_by_value=True)
                if content and any(kw in content for kw in self.AI_KEYWORDS):
                    logger.info("通过关键词检测到 AI 内容")
                    return True
            except Exception as e:
                logger.debug(f"轮询检查失败: {e}")
                continue
        
        logger.warning("未检测到 AI 内容")
        return False
    
    async def _wait_for_streaming_complete(self, max_wait_seconds: int = 30) -> bool:
        """Wait for AI streaming output to complete
        
        使用多种策略检测 AI 流式输出是否完成：
        1. 优先检测追问输入框出现（最可靠的完成信号）
        2. 监控内容长度稳定性（连续多次检测内容不变）
        3. 检测"正在思考"等加载状态关键词（辅助判断）
        4. 加载指示器检测（仅作为辅助，不阻塞）
        
        Args:
            max_wait_seconds: 最大等待时间（秒）
            
        Returns:
            是否成功等待完成（True 表示内容已稳定，False 表示超时）
            
        **Validates: Requirements 4.3, 4.5**
        
        Examples:
            >>> completed = await searcher._wait_for_streaming_complete(max_wait_seconds=30)
            >>> if completed:
            ...     print("AI 输出完成")
            ... else:
            ...     print("等待超时")
        """
        if self._tab is None:
            logger.error("浏览器标签页不可用")
            return False
        
        logger.info("等待 AI 流式输出完成...")
        
        last_content_length = 0
        stable_count = 0
        stable_threshold = 3  # 连续 3 次检测内容不变则认为完成
        check_interval = 0.5  # 500ms 采样间隔
        min_content_length = 200  # 降低最小内容长度，避免等待过久
        
        # 计算最大检查次数
        max_checks = int(max_wait_seconds / check_interval)
        
        for i in range(max_checks):
            try:
                # 获取页面内容
                content = await self._tab.evaluate("document.body.innerText", return_by_value=True)
                current_length = len(content) if content else 0
                
                # 策略1（最优先）：检查追问输入框是否出现（表示生成完成）
                has_follow_up = await self._check_follow_up_input()
                if has_follow_up and current_length >= min_content_length:
                    logger.info(f"检测到追问输入框，AI 输出完成，内容长度: {current_length}")
                    return True
                
                # 策略2：检查是否仍在加载状态（关键词检测）
                is_loading_by_keyword = content and any(kw in content for kw in self.AI_LOADING_KEYWORDS)
                
                # 策略3：内容稳定性检测（主要依赖）
                if current_length == last_content_length and current_length >= min_content_length:
                    if not is_loading_by_keyword:
                        stable_count += 1
                        logger.debug(f"内容稳定检测: {stable_count}/{stable_threshold}")
                        if stable_count >= stable_threshold:
                            logger.info(f"AI 输出完成（内容稳定），内容长度: {current_length}")
                            return True
                    else:
                        # 有加载关键词，重置计数
                        stable_count = 0
                        logger.debug("检测到加载关键词，继续等待...")
                elif current_length != last_content_length:
                    # 内容仍在变化
                    stable_count = 0
                    logger.debug(f"内容仍在加载: {last_content_length} -> {current_length}")
                else:
                    # 内容太短
                    logger.debug(f"内容太短 ({current_length} < {min_content_length})，继续等待")
                
                last_content_length = current_length
                await asyncio.sleep(check_interval)
                
            except Exception as e:
                logger.warning(f"等待流式输出时出错: {e}")
                # 出错时继续等待，不立即退出
                await asyncio.sleep(check_interval)
        
        logger.warning(f"等待流式输出超时（{max_wait_seconds}秒）")
        return False
    
    async def _check_loading_indicators(self) -> bool:
        """检查页面上是否存在加载指示器
        
        使用 JavaScript 评估检查加载指示器选择器是否存在且可见。
        
        Returns:
            是否存在加载指示器
            
        **Validates: Requirements 4.5**
        """
        if self._tab is None:
            return False
        
        # 使用 JavaScript 检查加载指示器
        # 这比逐个查询选择器更高效
        js_check_loading = """
        (() => {
            const selectors = %s;
            for (const selector of selectors) {
                try {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        return true;
                    }
                } catch (e) {
                    continue;
                }
            }
            return false;
        })()
        """ % str(self.AI_LOADING_SELECTORS).replace("'", '"')
        
        try:
            result = await self._tab.evaluate(js_check_loading, return_by_value=True)
            return bool(result)
        except Exception as e:
            logger.debug(f"检查加载指示器失败: {e}")
            return False
    
    async def _check_follow_up_input(self) -> bool:
        """检查页面上是否出现追问输入框（表示 AI 生成完成）
        
        使用 JavaScript 评估检查追问输入框选择器是否存在且可见。
        
        Returns:
            是否出现追问输入框
            
        **Validates: Requirements 4.3**
        """
        if self._tab is None:
            return False
        
        # 使用 JavaScript 检查追问输入框
        js_check_follow_up = """
        (() => {
            const selectors = %s;
            for (const selector of selectors) {
                try {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        return true;
                    }
                } catch (e) {
                    continue;
                }
            }
            return false;
        })()
        """ % str(self.FOLLOW_UP_SELECTORS).replace("'", '"')
        
        try:
            result = await self._tab.evaluate(js_check_follow_up, return_by_value=True)
            return bool(result)
        except Exception as e:
            logger.debug(f"检查追问输入框失败: {e}")
            return False
    
    async def _find_follow_up_input(self):
        """Find the follow-up input element on the page
        
        使用 nodriver 的 query_selector 方法查找追问输入框元素。
        按照 FOLLOW_UP_SELECTORS 中定义的优先级顺序尝试各个选择器。
        
        Returns:
            找到的输入框元素，未找到返回 None
            
        **Validates: Requirements 7.1**
        
        Examples:
            >>> element = await searcher._find_follow_up_input()
            >>> if element:
            ...     print("找到追问输入框")
            ... else:
            ...     print("未找到追问输入框")
        """
        if self._tab is None:
            logger.warning("浏览器标签页不可用，无法查找追问输入框")
            return None
        
        logger.debug("查找追问输入框...")
        
        # 按优先级顺序尝试各个选择器
        for selector in self.FOLLOW_UP_SELECTORS:
            try:
                # 使用 nodriver 的 query_selector 方法查找元素
                # nodriver API: await tab.query_selector(selector) 返回元素或 None
                element = await self._tab.query_selector(selector)
                
                if element:
                    # 检查元素是否可见（使用 JavaScript 检查 offsetParent）
                    # offsetParent 为 null 表示元素不可见
                    try:
                        is_visible = await self._tab.evaluate(
                            f"document.querySelector('{selector}')?.offsetParent !== null",
                            return_by_value=True
                        )
                        if is_visible:
                            logger.debug(f"找到追问输入框: {selector}")
                            return element
                    except Exception:
                        # 如果可见性检查失败，假设元素可见
                        logger.debug(f"找到追问输入框（跳过可见性检查）: {selector}")
                        return element
                        
            except Exception as e:
                logger.debug(f"查找选择器 {selector} 失败: {e}")
                continue
        
        logger.warning("未找到追问输入框")
        return None
    
    async def _submit_follow_up(self, query: str) -> bool:
        """Submit follow-up query by filling input and triggering submission
        
        查找追问输入框，填入查询内容并提交。使用以下策略：
        1. 使用 nodriver 的 query_selector 查找输入框
        2. 点击输入框获取焦点（最佳实践：发送按键前先聚焦）
        3. 使用 send_keys 输入查询内容
        4. 使用 send_keys("\\n") 提交（模拟 Enter 键）
        5. 如果标准方法失败，使用 JavaScript 回退方案
        
        Args:
            query: 追问查询字符串
            
        Returns:
            是否成功提交追问
            
        **Validates: Requirements 7.1, 7.2**
        
        Examples:
            >>> success = await searcher._submit_follow_up("请详细解释第一点")
            >>> if success:
            ...     print("追问已提交")
            ... else:
            ...     print("追问提交失败")
        """
        if self._tab is None:
            logger.warning("浏览器标签页不可用，无法提交追问")
            return False
        
        logger.info(f"提交追问: '{query[:50]}...' " if len(query) > 50 else f"提交追问: '{query}'")
        
        # 策略1：使用 nodriver 原生方法
        for selector in self.FOLLOW_UP_SELECTORS:
            try:
                element = await self._tab.query_selector(selector)
                if element:
                    # 最佳实践：先点击获取焦点，再发送按键
                    logger.debug(f"尝试使用选择器: {selector}")
                    
                    # 点击元素获取焦点
                    await element.click()
                    
                    # 短暂等待确保焦点已设置
                    await asyncio.sleep(0.1)
                    
                    # 发送查询内容
                    await element.send_keys(query)
                    
                    # 短暂等待确保内容已输入
                    await asyncio.sleep(0.1)
                    
                    # 发送 Enter 键提交
                    await element.send_keys("\n")
                    
                    logger.info("追问已通过 nodriver 原生方法提交")
                    return True
                    
            except Exception as e:
                logger.debug(f"使用选择器 {selector} 提交失败: {e}")
                continue
        
        # 策略2：JavaScript 回退方案
        # 当 nodriver 原生方法失败时，使用 JavaScript 直接操作 DOM
        logger.debug("nodriver 原生方法失败，尝试 JavaScript 回退方案...")
        
        js_submit_follow_up = """
        (query) => {
            const selectors = %s;
            
            for (const selector of selectors) {
                try {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        // 聚焦元素
                        element.focus();
                        
                        // 根据元素类型设置值
                        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                            // 标准输入框：设置 value 并触发 input 事件
                            element.value = query;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                        } else if (element.contentEditable === 'true') {
                            // contenteditable 元素：设置 innerText
                            element.innerText = query;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        
                        // 尝试提交：先找表单的提交按钮，再模拟 Enter 键
                        const form = element.closest('form');
                        if (form) {
                            const submitBtn = form.querySelector('button[type="submit"], button:not([type])');
                            if (submitBtn) {
                                submitBtn.click();
                                return true;
                            }
                        }
                        
                        // 模拟 Enter 键
                        element.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true
                        }));
                        element.dispatchEvent(new KeyboardEvent('keypress', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true
                        }));
                        element.dispatchEvent(new KeyboardEvent('keyup', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true
                        }));
                        
                        return true;
                    }
                } catch (e) {
                    continue;
                }
            }
            return false;
        }
        """ % str(self.FOLLOW_UP_SELECTORS).replace("'", '"')
        
        try:
            result = await self._tab.evaluate(js_submit_follow_up, query, return_by_value=True)
            if result:
                logger.info("追问已通过 JavaScript 回退方案提交")
                return True
        except Exception as e:
            logger.warning(f"JavaScript 回退方案失败: {e}")
        
        logger.warning("追问提交失败：未找到可用的输入框")
        return False
    
    # 需要拦截的资源 URL 模式（用于 CDP Network.setBlockedURLs）
    # 包括：图片、字体、媒体文件、广告和追踪域名
    BLOCKED_URL_PATTERNS = [
        # 广告和追踪域名（Requirements 10.2）
        "*googleadservices.com*",
        "*googlesyndication.com*",
        "*doubleclick.net*",
        "*google-analytics.com*",
        "*googletagmanager.com*",
        "*facebook.com/tr*",
        "*connect.facebook.net*",
        # 图片文件（Requirements 10.1）
        "*.png",
        "*.jpg",
        "*.jpeg",
        "*.gif",
        "*.webp",
        "*.svg",
        "*.ico",
        "*.bmp",
        # 字体文件（Requirements 10.1）
        "*.woff",
        "*.woff2",
        "*.ttf",
        "*.otf",
        "*.eot",
        # 媒体文件（Requirements 10.1）
        "*.mp4",
        "*.webm",
        "*.mp3",
        "*.wav",
        "*.ogg",
        "*.avi",
        "*.mov",
    ]
    
    async def _setup_resource_blocking(self) -> bool:
        """Block unnecessary resources using CDP
        
        使用 Chrome DevTools Protocol (CDP) 的 Network.setBlockedURLs 命令
        阻止不必要的资源加载，包括：
        - 图片文件（png, jpg, gif, webp 等）
        - 字体文件（woff, woff2, ttf 等）
        - 媒体文件（mp4, webm, mp3 等）
        - 广告和追踪域名（googleadservices, doubleclick, google-analytics 等）
        
        这可以显著提高页面加载速度并减少内存消耗。
        
        注意：必须先调用 Network.enable() 开启网络域，然后再设置拦截规则。
        拦截规则是针对 Tab（标签页）级别的。
        
        Returns:
            是否成功设置资源拦截
            
        **Validates: Requirements 10.1, 10.2**
        
        Examples:
            >>> success = await searcher._setup_resource_blocking()
            >>> if success:
            ...     print("资源拦截已设置")
        """
        if self._tab is None:
            logger.error("浏览器标签页不可用，无法设置资源拦截")
            return False
        
        logger.info("设置资源拦截（图片、字体、媒体、广告）...")
        
        try:
            # 导入 nodriver 的 CDP 模块
            from nodriver import cdp
            
            # 1. 首先开启 Network 域（必须！否则拦截规则不会生效）
            await self._tab.send(cdp.network.enable())
            logger.debug("CDP Network 域已开启")
            
            # 2. 设置要拦截的 URL 模式（支持通配符 *）
            # 注意：nodriver 使用 set_blocked_ur_ls（带下划线）而非 set_blocked_urls
            await self._tab.send(cdp.network.set_blocked_ur_ls(
                urls=self.BLOCKED_URL_PATTERNS
            ))
            
            logger.info(f"资源拦截已设置，拦截 {len(self.BLOCKED_URL_PATTERNS)} 种 URL 模式")
            return True
            
        except Exception as e:
            # 资源拦截失败不应阻止搜索继续
            # 只记录警告，不返回错误
            logger.warning(f"设置资源拦截失败: {e}")
            import traceback
            logger.debug(f"堆栈跟踪:\n{traceback.format_exc()}")
            return False
    
    async def _extract_ai_answer(self, tab=None) -> SearchResult:
        """Extract AI answer and sources from page using JavaScript
        
        使用 JavaScript 评估从页面提取 AI 回答和来源链接。
        支持多语言 AI 模式标签（中文、英文、日文、韩文、德文、法文）。
        
        Args:
            tab: nodriver Tab 对象，如果为 None 则使用 self._tab
            
        Returns:
            SearchResult 包含 AI 回答和来源链接
            - success=True: 成功提取内容
            - success=False: 提取失败，error 字段包含错误信息
            
        **Validates: Requirements 5.1, 5.2, 5.3, 6.3**
        
        Examples:
            >>> result = await searcher._extract_ai_answer()
            >>> if result.success:
            ...     print(f"AI 回答: {result.ai_answer[:100]}...")
            ...     print(f"来源数量: {len(result.sources)}")
        """
        # 使用传入的 tab 或默认的 self._tab
        target_tab = tab if tab is not None else self._tab
        
        if target_tab is None:
            logger.error("浏览器标签页不可用，无法提取内容")
            return SearchResult(
                success=False,
                query='',
                error="浏览器标签页不可用"
            )
        
        logger.info("开始提取 AI 回答...")
        
        # JavaScript 提取代码
        # 与同步版本保持一致，支持多语言 AI 模式标签
        js_code = """
        (() => {
            const result = {
                aiAnswer: '',
                sources: []
            };
            
            // 提取 AI 回答主体
            const mainContent = document.body.innerText;
            
            // 多语言支持：AI 模式标签（Requirements 6.3）
            const aiModeLabels = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA'];
            // 多语言支持：搜索结果标签
            const searchResultLabels = ['搜索结果', 'Search Results', '検索結果', '검색결과', 'Suchergebnisse', 'Résultats de recherche'];
            // 多语言支持：内容结束标记（页脚、相关搜索、反馈区域等）
            const endMarkers = [
                '相关搜索', 'Related searches', '関連する検索', '관련 검색',
                '意见反馈', 'Send feedback', 'フィードバックを送信',
                '帮助', 'Help', 'ヘルプ',
                '隐私权', 'Privacy', 'プライバシー',
                '条款', 'Terms', '利用規約',
            ];
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
            
            // 硬编码上限：防止异常情况下提取过多内容（50KB，约 2.5 万汉字）
            const MAX_CONTENT_LENGTH = 50000;
            
            // 辅助函数：查找最近的结束标记位置（带硬编码上限）
            function findEndIndex(startPos) {
                // 硬编码上限作为最后防线
                let endIdx = Math.min(mainContent.length, startPos + MAX_CONTENT_LENGTH);
                for (const marker of endMarkers) {
                    const idx = mainContent.indexOf(marker, startPos);
                    if (idx !== -1 && idx < endIdx) {
                        endIdx = idx;
                    }
                }
                return endIdx;
            }
            
            // 辅助函数：清理导航文本
            function cleanAnswer(text) {
                let cleaned = text;
                for (const pattern of navPatterns) {
                    cleaned = cleaned.replace(pattern, '');
                }
                return cleaned.trim();
            }
            
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
                // 找到 AI 模式和搜索结果标签，取中间内容
                result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, searchResultIndex));
            } else if (aiModeIndex !== -1) {
                // 只找到 AI 模式标签，取到结束标记
                const endIndex = findEndIndex(aiModeIndex + 100);
                result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, endIndex));
            } else {
                // 备用方案：取到结束标记
                const endIndex = findEndIndex(100);
                result.aiAnswer = cleanAnswer(mainContent.substring(0, endIndex));
            }
            
            // 提取来源链接（Requirements 5.3）
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
        })()
        """
        
        try:
            # 使用 nodriver 的 tab.evaluate() 执行 JavaScript（Requirements 5.1）
            # 注意：nodriver 需要 return_by_value=True 才能返回 JavaScript 对象
            remote_obj = await target_tab.evaluate(js_code, return_by_value=True)
            
            # 调试：记录原始返回值
            logger.debug(f"evaluate 返回类型: {type(remote_obj).__name__}")
            
            # 解析 nodriver 返回的 RemoteObject
            data = self._parse_remote_object(remote_obj)
            
            # 调试：记录解析结果
            logger.debug(f"解析后数据类型: {type(data).__name__ if data else None}")
            
            # 解析返回的数据
            if data is None:
                logger.warning("JavaScript 评估返回 None")
                # 尝试备用方案：直接从页面提取文本
                return await self._extract_ai_answer_fallback(target_tab)
            
            # 确保 data 是字典类型
            if not isinstance(data, dict):
                logger.warning(f"解析结果不是字典: {type(data)}")
                return await self._extract_ai_answer_fallback(target_tab)
            
            # 构建来源列表
            sources = []
            sources_data = data.get('sources', [])
            if isinstance(sources_data, list):
                for s in sources_data:
                    if isinstance(s, dict):
                        sources.append(SearchSource(
                            title=s.get('title', ''),
                            url=s.get('url', ''),
                            snippet=s.get('snippet', '')
                        ))
            
            ai_answer = data.get('aiAnswer', '')
            if not isinstance(ai_answer, str):
                ai_answer = str(ai_answer) if ai_answer else ''
            
            logger.info(f"提取完成: AI 回答长度={len(ai_answer)}, 来源数量={len(sources)}")
            
            return SearchResult(
                success=True,
                query='',  # query 将由调用者设置
                ai_answer=ai_answer,
                sources=sources
            )
            
        except Exception as e:
            logger.error(f"提取 AI 回答失败: {e}")
            import traceback
            logger.debug(f"堆栈跟踪:\n{traceback.format_exc()}")
            # 尝试备用方案
            try:
                return await self._extract_ai_answer_fallback(target_tab)
            except Exception as fallback_error:
                logger.error(f"备用提取方案也失败: {fallback_error}")
                return SearchResult(
                    success=False,
                    query='',
                    error=f"提取内容失败: {e}"
                )
    
    def _parse_remote_object(self, remote_obj) -> Any:
        """解析 nodriver 返回的 RemoteObject 为 Python 原生类型
        
        nodriver 的 evaluate() 返回 RemoteObject，需要从 deep_serialized_value 中提取实际值。
        
        Args:
            remote_obj: nodriver 返回的 RemoteObject 或原生类型
            
        Returns:
            解析后的 Python 原生类型（dict, list, str, int, etc.）
        """
        # 如果已经是原生类型，直接返回
        if remote_obj is None:
            return None
        if isinstance(remote_obj, (dict, list, str, int, float, bool)):
            return remote_obj
        
        # 调试：记录 RemoteObject 的结构
        logger.debug(f"解析 RemoteObject: type={type(remote_obj).__name__}")
        if hasattr(remote_obj, '__dict__'):
            logger.debug(f"RemoteObject 属性: {list(remote_obj.__dict__.keys())}")
        
        # 检查是否是 RemoteObject，尝试多种解析方式
        # 方式1：deep_serialized_value（nodriver 推荐方式）
        if hasattr(remote_obj, 'deep_serialized_value') and remote_obj.deep_serialized_value:
            dsv = remote_obj.deep_serialized_value
            logger.debug(f"使用 deep_serialized_value 解析: type={type(dsv).__name__}")
            return self._parse_deep_serialized_value(dsv)
        
        # 方式2：直接获取 value 属性
        if hasattr(remote_obj, 'value') and remote_obj.value is not None:
            value = remote_obj.value
            logger.debug(f"使用 value 属性: type={type(value).__name__}")
            # 如果 value 本身也是 RemoteObject 或类似结构，递归解析
            if isinstance(value, (dict, list, str, int, float, bool)):
                return value
            return self._parse_remote_object(value)
        
        # 方式3：尝试 result 属性（某些版本的 nodriver）
        if hasattr(remote_obj, 'result') and remote_obj.result is not None:
            result = remote_obj.result
            logger.debug(f"使用 result 属性: type={type(result).__name__}")
            return self._parse_remote_object(result)
        
        # 方式4：尝试将对象转换为字典（如果有 to_dict 方法）
        if hasattr(remote_obj, 'to_dict'):
            try:
                return remote_obj.to_dict()
            except Exception as e:
                logger.debug(f"to_dict 转换失败: {e}")
        
        # 方式5：尝试直接访问 __dict__
        if hasattr(remote_obj, '__dict__'):
            obj_dict = remote_obj.__dict__
            # 检查是否有 value 或 data 键
            for key in ['value', 'data', 'result']:
                if key in obj_dict and obj_dict[key] is not None:
                    logger.debug(f"从 __dict__['{key}'] 获取值")
                    return self._parse_remote_object(obj_dict[key])
        
        logger.warning(f"无法解析 RemoteObject: {type(remote_obj)}, 属性: {dir(remote_obj)}")
        return None
    
    def _parse_deep_serialized_value(self, dsv) -> Any:
        """递归解析 DeepSerializedValue
        
        Args:
            dsv: DeepSerializedValue 对象
            
        Returns:
            解析后的 Python 原生类型
        """
        if dsv is None:
            return None
        
        # 如果已经是原生类型，直接返回
        if isinstance(dsv, (dict, list, str, int, float, bool)):
            # 如果是字典，检查是否是 {type, value} 格式
            if isinstance(dsv, dict) and 'type' in dsv:
                return self._parse_value_dict(dsv)
            return dsv
        
        # 获取 type_ 和 value 属性
        type_ = getattr(dsv, 'type_', None) or getattr(dsv, 'type', None)
        value = getattr(dsv, 'value', None)
        
        logger.debug(f"解析 DeepSerializedValue: type_={type_}, value_type={type(value).__name__ if value else None}")
        
        if type_ == 'object':
            # value 是 [[key, {type, value}], ...] 格式的列表
            if isinstance(value, list):
                result = {}
                for item in value:
                    if isinstance(item, (list, tuple)) and len(item) == 2:
                        key, val_obj = item
                        # val_obj 可能是 dict、DeepSerializedValue 或其他类型
                        if isinstance(val_obj, dict):
                            result[key] = self._parse_value_dict(val_obj)
                        elif hasattr(val_obj, 'type_') or hasattr(val_obj, 'type'):
                            result[key] = self._parse_deep_serialized_value(val_obj)
                        else:
                            result[key] = val_obj
                logger.debug(f"解析 object 完成: keys={list(result.keys())}")
                return result
            return {}
        elif type_ == 'array':
            if isinstance(value, list):
                result = []
                for v in value:
                    if isinstance(v, dict):
                        result.append(self._parse_value_dict(v))
                    elif hasattr(v, 'type_') or hasattr(v, 'type'):
                        result.append(self._parse_deep_serialized_value(v))
                    else:
                        result.append(v)
                return result
            return []
        elif type_ in ('string', 'number', 'boolean'):
            return value
        elif type_ == 'undefined' or type_ == 'null':
            return None
        else:
            # 未知类型，尝试返回 value
            logger.debug(f"未知 DeepSerializedValue 类型: {type_}")
            return value
    
    def _parse_value_dict(self, val_dict: dict) -> Any:
        """解析值字典 {type: ..., value: ...}
        
        Args:
            val_dict: 包含 type 和 value 的字典
            
        Returns:
            解析后的值
        """
        if not isinstance(val_dict, dict):
            return val_dict
        
        type_ = val_dict.get('type')
        value = val_dict.get('value')
        
        if type_ == 'object':
            if isinstance(value, list):
                result = {}
                for item in value:
                    if isinstance(item, (list, tuple)) and len(item) == 2:
                        key, nested_val = item
                        result[key] = self._parse_value_dict(nested_val) if isinstance(nested_val, dict) else nested_val
                return result
            return {}
        elif type_ == 'array':
            if isinstance(value, list):
                return [self._parse_value_dict(v) if isinstance(v, dict) else v for v in value]
            return []
        elif type_ in ('string', 'number', 'boolean'):
            return value
        elif type_ == 'undefined' or type_ == 'null':
            return None
        else:
            return value
    
    async def _extract_ai_answer_fallback(self, tab) -> SearchResult:
        """备用方案：使用简单的文本提取方式获取 AI 回答
        
        当 JavaScript 对象解析失败时，使用此方法直接提取页面文本。
        
        Args:
            tab: nodriver Tab 对象
            
        Returns:
            SearchResult 包含提取的内容
        """
        logger.info("使用备用方案提取 AI 回答...")
        
        try:
            # 直接获取页面文本内容
            content = await tab.evaluate("document.body.innerText", return_by_value=True)
            
            # 处理 RemoteObject 返回值
            if hasattr(content, 'value'):
                content = content.value
            if not isinstance(content, str):
                content = str(content) if content else ""
            
            if not content:
                return SearchResult(
                    success=False,
                    query='',
                    error="备用方案：无法获取页面内容"
                )
            
            # 简单的内容清理
            # 多语言 AI 模式标签
            ai_mode_labels = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA']
            # 结束标记
            end_markers = ['相关搜索', 'Related searches', '関連する検索', '意见反馈', 'Send feedback']
            
            # 查找 AI 回答区域
            ai_start = 0
            for label in ai_mode_labels:
                idx = content.find(label)
                if idx != -1:
                    ai_start = idx
                    break
            
            # 查找结束位置
            ai_end = len(content)
            for marker in end_markers:
                idx = content.find(marker, ai_start + 100)
                if idx != -1 and idx < ai_end:
                    ai_end = idx
            
            # 提取 AI 回答
            ai_answer = content[ai_start:ai_end].strip()
            
            # 限制长度
            if len(ai_answer) > 50000:
                ai_answer = ai_answer[:50000]
            
            logger.info(f"备用方案提取完成: AI 回答长度={len(ai_answer)}")
            
            return SearchResult(
                success=True,
                query='',
                ai_answer=ai_answer,
                sources=[]  # 备用方案不提取来源
            )
            
        except Exception as e:
            logger.error(f"备用方案提取失败: {e}")
            return SearchResult(
                success=False,
                query='',
                error=f"备用方案提取失败: {e}"
            )
    
    def _is_captcha_page(self, content: str) -> bool:
        """检测页面是否为验证码页面
        
        通过检查页面内容是否包含已知的验证码关键词来判断。
        支持多语言关键词检测（中文、英文等）。
        
        Args:
            content: 页面文本内容
            
        Returns:
            是否为验证码页面
            
        **Validates: Requirements 8.5**
        
        Examples:
            >>> searcher._is_captcha_page("我们的系统检测到异常流量")
            True
            >>> searcher._is_captcha_page("AI 模式 这是正常的搜索结果")
            False
        """
        if not content:
            return False
        
        content_lower = content.lower()
        for keyword in self.CAPTCHA_KEYWORDS:
            if keyword.lower() in content_lower:
                logger.debug(f"检测到验证码关键词: {keyword}")
                return True
        return False
    
    async def _handle_user_intervention(self, url: str, query: str, reason: str = "") -> SearchResult:
        """打开可见浏览器窗口让用户手动处理问题（如验证码）
        
        当检测到 CAPTCHA 或其他需要用户介入的情况时，此方法会：
        1. 关闭当前无头会话
        2. 启动一个新的可见浏览器窗口
        3. 导航到目标 URL
        4. 等待用户完成操作（最多 5 分钟）
        5. 提取搜索结果并返回
        
        Args:
            url: 搜索 URL
            query: 搜索查询
            reason: 需要用户介入的原因（用于日志和提示）
            
        Returns:
            SearchResult 包含 AI 回答和来源，或错误信息
            
        **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
        
        Examples:
            >>> result = await searcher._handle_user_intervention(
            ...     "https://www.google.com/search?q=test&udm=50",
            ...     "test",
            ...     "检测到验证码"
            ... )
        """
        import nodriver as uc
        
        logger.info(f"需要用户介入: {reason}")
        print("\n" + "="*60)
        print("[!] 需要用户操作！")
        print(f"原因: {reason}")
        print("正在打开浏览器窗口，请手动完成操作...")
        print("="*60 + "\n")
        
        # 关闭当前会话（如果存在）
        if self._browser is not None:
            await self.close_session()
            # 等待浏览器完全释放资源
            await asyncio.sleep(1)
        
        browser = None
        try:
            # 检测系统代理
            proxy_server = self._detect_proxy()
            browser_args = []
            if proxy_server:
                browser_args.append(f"--proxy-server={proxy_server}")
                logger.info(f"用户介入模式已配置代理: {proxy_server}")
            
            # 启动可见浏览器（headless=False）
            logger.info("启动可见浏览器窗口...")
            browser = await uc.start(
                user_data_dir=self._user_data_dir if self.use_user_data else None,
                browser_executable_path=self._browser_path,
                headless=False,  # 必须显示窗口让用户操作
                browser_args=browser_args if browser_args else None,
                no_sandbox=True,  # 避免沙箱权限问题
            )
            
            tab = browser.main_tab
            
            # 导航到目标 URL
            logger.info(f"导航到: {url}")
            try:
                await tab.get(url)
            except Exception as nav_error:
                logger.warning(f"用户介入模式导航失败: {nav_error}")
                # 即使导航失败也继续，让用户手动处理
                await asyncio.sleep(2)
            
            print("请在浏览器中完成操作（验证码、登录等）...")
            print("操作完成后，搜索结果会自动获取。")
            print(f"最长等待时间: {self.USER_INTERVENTION_TIMEOUT // 60} 分钟")
            
            # 等待用户操作完成（最多等待 5 分钟）
            check_interval = 2  # 秒
            max_checks = self.USER_INTERVENTION_TIMEOUT // check_interval
            
            for i in range(max_checks):
                await asyncio.sleep(check_interval)
                
                try:
                    # 检查页面是否已经有搜索结果（用户完成了操作）
                    content = await tab.evaluate("document.body.innerText", return_by_value=True)
                    current_url = tab.url if hasattr(tab, 'url') else ""
                    
                    # 判断是否离开了问题页面（验证码页面、错误页面等）
                    is_problem_page = self._is_captcha_page(content) or 'sorry' in current_url.lower()
                    has_search_result = any(kw in content for kw in self.AI_KEYWORDS) or len(content) > 1000
                    
                    if not is_problem_page and has_search_result:
                        print("\n[OK] 操作完成！正在获取搜索结果...")
                        logger.info("用户操作完成，提取搜索结果")
                        
                        # 等待内容稳定
                        await asyncio.sleep(2)
                        
                        # 提取搜索结果
                        result = await self._extract_ai_answer(tab)
                        result.query = query
                        
                        return result
                        
                except Exception as e:
                    logger.debug(f"检查页面状态时出错: {e}")
                    continue
            
            # 超时
            logger.warning("用户操作超时")
            return SearchResult(
                success=False,
                query=query,
                error=f"用户操作超时（{self.USER_INTERVENTION_TIMEOUT // 60}分钟），请重试"
            )
            
        except Exception as e:
            logger.error(f"用户介入处理出错: {e}")
            import traceback
            logger.debug(f"堆栈跟踪:\n{traceback.format_exc()}")
            return SearchResult(
                success=False,
                query=query,
                error=f"用户操作过程出错: {e}"
            )
        finally:
            # 清理浏览器
            if browser is not None:
                try:
                    browser.stop()
                except Exception:
                    pass
    
    async def search(self, query: str, language: str = "zh-CN") -> SearchResult:
        """Execute a Google AI Mode search
        
        执行 Google AI 模式搜索的主方法。此方法协调以下步骤：
        1. 检查浏览器是否可用
        2. 启动浏览器会话（如果未启动）
        3. 构建搜索 URL
        4. 设置资源拦截（优化性能）
        5. 导航到搜索页面
        6. 等待 AI 内容加载
        7. 等待流式输出完成
        8. 检测 CAPTCHA 并处理用户介入
        9. 提取 AI 回答和来源
        10. 返回 SearchResult
        
        Args:
            query: 搜索查询字符串
            language: 语言代码（zh-CN, en-US, ja-JP, ko-KR, de-DE, fr-FR 等）
            
        Returns:
            SearchResult 包含：
            - success: 是否成功
            - query: 原始查询
            - ai_answer: AI 回答内容
            - sources: 来源链接列表
            - error: 错误信息（如果失败）
            
        **Validates: Requirements 1.1, 4.1, 5.2, 8.1, 8.5, 12.2**
        
        Examples:
            >>> searcher = AsyncGoogleAISearcher()
            >>> result = await searcher.search("Python 异步编程最佳实践", "zh-CN")
            >>> if result.success:
            ...     print(f"AI 回答: {result.ai_answer[:100]}...")
            ... else:
            ...     print(f"搜索失败: {result.error}")
        """
        logger.info("="*60)
        logger.info(f"开始搜索: query='{query}', language={language}")
        
        # 1. 检查浏览器是否可用（Requirements 1.1, 1.3）
        if self._browser_path is None:
            error_msg = self.get_browser_error() or "未找到可用的浏览器（Chrome 或 Edge）"
            logger.error(error_msg)
            return SearchResult(
                success=False,
                query=query,
                error=error_msg
            )
        
        # 2. 构建搜索 URL
        url = self._build_url(query, language)
        logger.info(f"目标 URL: {url}")
        
        try:
            # 3. 确保浏览器会话已启动
            if not await self._ensure_session(language):
                return SearchResult(
                    success=False,
                    query=query,
                    error="无法启动浏览器会话"
                )
            
            # 4. 设置资源拦截（优化性能，Requirements 10.1, 10.2）
            await self._setup_resource_blocking()
            
            # 5. 导航到搜索页面（Requirements 4.1）
            logger.info(f"导航到 URL (timeout={self.timeout}s)...")
            start_time = time.time()
            
            success, error = await self._navigate_to_url(url)
            if not success:
                logger.warning(f"页面导航失败: {error}")
                # 导航失败时，尝试用户介入
                return await self._handle_user_intervention(url, query, error or "页面导航失败")
            
            elapsed = time.time() - start_time
            logger.info(f"页面导航完成，耗时: {elapsed:.2f}s")
            
            # 6. 等待 AI 内容加载（Requirements 4.2）
            ai_content_found = await self._wait_for_ai_content()
            if not ai_content_found:
                logger.warning("未检测到 AI 内容，继续尝试提取...")
            
            # 7. 等待流式输出完成（Requirements 4.3, 4.5）
            streaming_complete = await self._wait_for_streaming_complete(max_wait_seconds=30)
            if not streaming_complete:
                logger.warning("等待流式输出超时，尝试提取当前内容...")
            
            # 8. 检测 CAPTCHA（Requirements 8.1, 8.5）
            if self._tab is not None:
                try:
                    content = await self._tab.evaluate("document.body.innerText", return_by_value=True)
                    if self._is_captcha_page(content):
                        logger.warning("检测到验证码页面！")
                        # 关闭当前会话，打开可见窗口让用户处理
                        return await self._handle_user_intervention(url, query, "检测到验证码，需要人工验证")
                except Exception as e:
                    logger.debug(f"检查验证码时出错: {e}")
            
            # 9. 提取 AI 回答（Requirements 5.1, 5.2）
            result = await self._extract_ai_answer()
            result.query = query
            
            # 10. 保存回答用于增量提取（多轮对话）
            self._last_ai_answer = result.ai_answer
            self._update_activity_time()
            
            logger.info(f"搜索完成: success={result.success}, ai_answer长度={len(result.ai_answer)}, 来源数量={len(result.sources)}")
            return result
            
        except Exception as e:
            # 错误处理（Requirements 12.2）
            logger.error(f"搜索异常: {type(e).__name__}: {e}")
            import traceback
            logger.error(f"堆栈跟踪:\n{traceback.format_exc()}")
            
            # 尝试关闭会话以释放资源
            try:
                await self.close_session()
            except Exception:
                pass
            
            return SearchResult(
                success=False,
                query=query,
                error=str(e)
            )
    
    def _extract_incremental_content(
        self, 
        full_content: str, 
        previous_content: str, 
        user_query: str
    ) -> str:
        """Extract only new content from follow-up response
        
        从追问响应中提取增量内容。Google AI 多轮对话页面结构为：
        [上次回答][用户问题][新回答]
        
        此方法执行以下步骤：
        1. 从完整内容中移除上次回答部分
        2. 从新内容开头移除用户的追问问题
        3. 返回清理后的纯新增内容
        
        Args:
            full_content: 当前页面的完整 AI 回答内容
            previous_content: 上一次的 AI 回答内容（用于定位新内容起始位置）
            user_query: 用户的追问问题（需要从新内容开头移除）
            
        Returns:
            仅包含新增内容的字符串，已移除上次回答和用户问题
            
        **Validates: Requirements 7.3, 7.5**
        
        Examples:
            >>> previous = "Python 是一种编程语言。"
            >>> full = "Python 是一种编程语言。它有什么特点？Python 的特点包括简洁易读..."
            >>> query = "它有什么特点？"
            >>> searcher._extract_incremental_content(full, previous, query)
            'Python 的特点包括简洁易读...'
        """
        # 边界情况处理
        if not full_content:
            logger.debug("完整内容为空，返回空字符串")
            return ""
        
        if not previous_content:
            # 没有上次回答，直接返回完整内容（可能是首次搜索）
            logger.debug("没有上次回答，返回完整内容")
            return full_content
        
        # 步骤1：从完整内容中移除上次回答，提取新增部分
        new_content = self._remove_previous_content(full_content, previous_content)
        
        # 步骤2：从新内容开头移除用户的追问问题
        if new_content and user_query:
            new_content = self._remove_user_query_from_content(new_content, user_query)
        
        logger.info(f"增量提取完成: 原始长度={len(full_content)}, 新增长度={len(new_content)}")
        return new_content
    
    def _remove_previous_content(self, full_content: str, previous_content: str) -> str:
        """从完整内容中移除上次回答部分
        
        使用多种策略尝试定位并移除上次回答：
        1. 精确匹配：上次回答完整出现在完整内容中
        2. 前缀匹配：上次回答的前 N 个字符出现在完整内容开头
        3. 子串匹配：上次回答的核心部分出现在完整内容中
        
        Args:
            full_content: 当前页面的完整内容
            previous_content: 上一次的回答内容
            
        Returns:
            移除上次回答后的新增内容
            
        **Validates: Requirements 7.3**
        """
        if not previous_content:
            return full_content
        
        # 策略1：精确匹配 - 上次回答完整出现在完整内容中
        if previous_content in full_content:
            # 找到上次回答的结束位置
            end_pos = full_content.find(previous_content) + len(previous_content)
            new_content = full_content[end_pos:].strip()
            
            if new_content:
                logger.debug(f"精确匹配成功，提取新内容（长度={len(new_content)}）")
                return new_content
            else:
                logger.debug("精确匹配成功，但没有新内容")
                return ""
        
        # 策略2：前缀匹配 - 检查完整内容是否以上次回答开头
        # 使用前 200 个字符进行匹配（避免因微小差异导致匹配失败）
        prefix_length = min(200, len(previous_content))
        previous_prefix = previous_content[:prefix_length].strip()
        
        if full_content.startswith(previous_prefix):
            # 尝试找到上次回答的结束位置
            # 使用上次回答的长度作为估计
            estimated_end = len(previous_content)
            
            # 在估计位置附近搜索合适的分割点
            # 查找可能的分隔符（换行、句号等）
            search_start = max(0, estimated_end - 50)
            search_end = min(len(full_content), estimated_end + 50)
            search_region = full_content[search_start:search_end]
            
            # 优先在换行符处分割
            newline_pos = search_region.rfind('\n')
            if newline_pos != -1:
                split_pos = search_start + newline_pos + 1
                new_content = full_content[split_pos:].strip()
                logger.debug(f"前缀匹配成功（换行分割），提取新内容（长度={len(new_content)}）")
                return new_content
            
            # 否则使用估计位置
            new_content = full_content[estimated_end:].strip()
            logger.debug(f"前缀匹配成功（估计位置），提取新内容（长度={len(new_content)}）")
            return new_content
        
        # 策略3：子串匹配 - 查找上次回答的核心部分
        # 使用上次回答的中间部分进行匹配（避免开头/结尾的变化）
        if len(previous_content) > 100:
            # 取中间 100 个字符作为特征
            mid_start = len(previous_content) // 2 - 50
            mid_end = mid_start + 100
            core_content = previous_content[mid_start:mid_end]
            
            core_pos = full_content.find(core_content)
            if core_pos != -1:
                # 估计上次回答的结束位置
                estimated_end = core_pos + (len(previous_content) - mid_start)
                estimated_end = min(estimated_end, len(full_content))
                
                new_content = full_content[estimated_end:].strip()
                if new_content:
                    logger.debug(f"子串匹配成功，提取新内容（长度={len(new_content)}）")
                    return new_content
        
        # 所有策略都失败，返回完整内容并记录警告
        logger.warning("增量提取: 未能定位上次回答，返回完整内容")
        return full_content
    
    def _remove_user_query_from_content(self, content: str, query: str) -> str:
        """从内容开头移除用户的追问问题
        
        Google AI 多轮对话页面结构: [上次回答][用户问题][新回答]
        增量提取后，新内容开头可能包含用户的问题，需要移除。
        
        使用多种策略尝试移除用户问题：
        1. 精确匹配：问题完整出现在内容开头
        2. 模糊匹配：问题可能有轻微变化（空格、标点等）
        3. 规范化匹配：忽略空格和标点进行匹配
        
        Args:
            content: 提取的新内容
            query: 用户的追问问题
            
        Returns:
            移除用户问题后的内容
            
        **Validates: Requirements 7.5**
        
        Examples:
            >>> searcher._remove_user_query_from_content("它有什么特点？Python 的特点是...", "它有什么特点？")
            'Python 的特点是...'
        """
        if not content or not query:
            return content
        
        # 策略1：精确匹配 - 问题完整出现在内容开头
        if content.startswith(query):
            result = content[len(query):].strip()
            logger.debug(f"移除用户问题（精确匹配）: '{query[:30]}...' " if len(query) > 30 else f"移除用户问题（精确匹配）: '{query}'")
            return result
        
        # 策略2：模糊匹配 - 问题可能在内容开头附近（允许前面有少量字符）
        query_normalized = query.strip()
        # 在内容开头的前 50 个字符范围内搜索
        search_range = min(len(query_normalized) + 50, len(content))
        content_start = content[:search_range]
        
        pos = content_start.find(query_normalized)
        if pos != -1 and pos < 20:  # 问题出现在前 20 个字符内
            result = content[pos + len(query_normalized):].strip()
            logger.debug(f"移除用户问题（模糊匹配，位置={pos}）: '{query[:30]}...' " if len(query) > 30 else f"移除用户问题（模糊匹配）: '{query}'")
            return result
        
        # 策略3：规范化匹配 - 忽略空格和常见标点进行匹配
        import re
        # 移除空格和常见标点，只保留核心文字
        def normalize(text: str) -> str:
            return re.sub(r'[\s\?\？\!\！\.\。\,\，]+', '', text)
        
        query_norm = normalize(query_normalized)
        if len(query_norm) >= 5:  # 至少 5 个字符才进行规范化匹配
            # 在内容开头查找规范化后的问题
            for i in range(min(50, len(content))):
                # 检查从位置 i 开始的内容是否匹配
                content_slice = content[i:i + len(query_normalized) + 20]
                content_slice_norm = normalize(content_slice)
                
                if content_slice_norm.startswith(query_norm):
                    # 找到匹配，计算实际结束位置
                    # 向后扫描找到问题的实际结束位置
                    match_end = i
                    chars_matched = 0
                    for j in range(i, min(i + len(query_normalized) + 30, len(content))):
                        if normalize(content[i:j+1]) == query_norm[:len(normalize(content[i:j+1]))]:
                            if len(normalize(content[i:j+1])) >= len(query_norm):
                                match_end = j + 1
                                break
                    
                    if match_end > i:
                        result = content[match_end:].strip()
                        logger.debug(f"移除用户问题（规范化匹配）: '{query[:30]}...' " if len(query) > 30 else f"移除用户问题（规范化匹配）: '{query}'")
                        return result
        
        # 所有策略都失败，返回原内容
        logger.debug(f"未在内容开头找到用户问题: '{query[:30]}...' " if len(query) > 30 else f"未在内容开头找到用户问题: '{query}'")
        return content
    
    async def continue_conversation(self, query: str) -> SearchResult:
        """Continue conversation in existing session (follow-up)
        
        在现有浏览器会话中继续对话（追问）。此方法协调以下步骤：
        1. 检查是否有活跃会话
        2. 保存上一次的 AI 回答用于增量提取
        3. 查找并提交追问（使用 _submit_follow_up）
        4. 如果未找到追问输入框，回退到新搜索
        5. 等待流式输出完成
        6. 提取内容并执行增量提取
        7. 返回仅包含新内容的 SearchResult
        
        Args:
            query: 追问查询字符串
            
        Returns:
            SearchResult 包含增量 AI 回答（仅新内容）
            
        **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
        
        Examples:
            >>> # 首次搜索
            >>> result1 = await searcher.search("Python 是什么？")
            >>> # 追问
            >>> result2 = await searcher.continue_conversation("它有什么特点？")
            >>> # result2.ai_answer 仅包含新回答，不包含首次搜索的内容
        """
        logger.info("="*60)
        logger.info(f"继续对话（追问）: query='{query}'")
        
        # 步骤1：检查是否有活跃会话（Requirements 7.1）
        if not self.has_active_session():
            logger.warning("没有活跃会话，回退到新搜索")
            # 回退到新搜索（Requirements 7.4）
            return await self.search(query)
        
        # 步骤2：保存上一次的 AI 回答用于增量提取（Requirements 7.3）
        previous_ai_answer = self._last_ai_answer
        logger.debug(f"上次 AI 回答长度: {len(previous_ai_answer)}")
        
        try:
            # 步骤3：查找追问输入框（Requirements 7.1）
            follow_up_input = await self._find_follow_up_input()
            
            if follow_up_input is None:
                # 未找到追问输入框，回退到新搜索（Requirements 7.4）
                logger.warning("未找到追问输入框，回退到新搜索")
                return await self.search(query)
            
            # 步骤4：提交追问（Requirements 7.2）
            submit_success = await self._submit_follow_up(query)
            
            if not submit_success:
                # 提交失败，回退到新搜索（Requirements 7.4）
                logger.warning("追问提交失败，回退到新搜索")
                return await self.search(query)
            
            logger.info("追问已提交，等待 AI 响应...")
            
            # 步骤5：等待流式输出完成（Requirements 4.3, 4.5）
            # 追问响应通常比首次搜索更快，但仍需等待
            streaming_complete = await self._wait_for_streaming_complete(max_wait_seconds=30)
            if not streaming_complete:
                logger.warning("等待追问响应超时，尝试提取当前内容...")
            
            # 步骤6：提取完整内容
            result = await self._extract_ai_answer()
            result.query = query
            
            # 步骤7：执行增量提取（Requirements 7.3, 7.5）
            # 从完整内容中提取仅新增的部分
            if result.success and result.ai_answer and previous_ai_answer:
                incremental_content = self._extract_incremental_content(
                    full_content=result.ai_answer,
                    previous_content=previous_ai_answer,
                    user_query=query
                )
                
                # 更新结果为增量内容
                if incremental_content:
                    logger.info(f"增量提取成功: 原始长度={len(result.ai_answer)}, 增量长度={len(incremental_content)}")
                    result.ai_answer = incremental_content
                else:
                    # 增量提取返回空，可能是内容完全相同（无新回答）
                    logger.warning("增量提取返回空内容，保留完整回答")
            
            # 步骤8：更新会话状态
            # 保存当前完整回答用于下次增量提取
            # 注意：这里保存的是提取后的完整内容，而非增量内容
            # 因为下次追问时需要知道页面上的完整内容
            if result.success:
                # 重新提取完整内容用于保存（不使用增量结果）
                full_result = await self._extract_ai_answer()
                self._last_ai_answer = full_result.ai_answer
            
            self._update_activity_time()
            
            logger.info(f"追问完成: success={result.success}, ai_answer长度={len(result.ai_answer)}, 来源数量={len(result.sources)}")
            return result
            
        except Exception as e:
            # 错误处理（Requirements 12.2）
            logger.error(f"追问异常: {type(e).__name__}: {e}")
            import traceback
            logger.error(f"堆栈跟踪:\n{traceback.format_exc()}")
            
            # 尝试回退到新搜索
            logger.info("尝试回退到新搜索...")
            try:
                return await self.search(query)
            except Exception as fallback_error:
                logger.error(f"回退搜索也失败: {fallback_error}")
                return SearchResult(
                    success=False,
                    query=query,
                    error=f"追问失败: {str(e)}"
                )
    
    @staticmethod
    def clean_ai_answer(text: str) -> str:
        """清理 AI 回答文本，移除导航文本和提示信息
        
        支持多语言导航文本清理：中文、英文、日语、韩语、德语、法语。
        这是一个 Python 端的清理函数，可用于额外清理或作为独立工具使用。
        
        Args:
            text: 原始文本
            
        Returns:
            清理后的文本
            
        **Validates: Requirements 5.4, 6.4**
        
        Examples:
            >>> AsyncGoogleAISearcher.clean_ai_answer("AI 模式 这是AI回答内容")
            '这是AI回答内容'
            >>> AsyncGoogleAISearcher.clean_ai_answer("AI Mode This is the answer")
            'This is the answer'
        """
        import re
        
        # 多语言导航文本模式
        # 按语言分组，便于维护和扩展
        patterns = [
            # === 中文 (zh-CN) ===
            r'^AI 模式\s*',
            r'全部\s*图片\s*视频\s*新闻\s*更多',
            r'登录',
            r'AI 的回答未必正确无误，请注意核查',
            r'AI 回答可能包含错误。?\s*了解详情',
            r'请谨慎使用此类代码。?',
            r'\d+ 个网站',
            r'全部显示',
            r'查看相关链接',
            r'关于这条结果',
            r'搜索结果',
            r'相关搜索',
            r'意见反馈',
            r'帮助',
            r'隐私权',
            r'条款',
            
            # === 英文 (en-US) ===
            r'^AI Mode\s*',
            r'All\s*Images\s*Videos\s*News\s*More',
            r'Sign in',
            r'AI responses may include mistakes\.?\s*Learn more',
            r'AI overview\s*',
            r'Use code with caution\.?',
            r'\d+ sites?',
            r'Show all',
            r'View related links',
            r'About this result',
            r'Search Results',
            r'Related searches',
            r'Send feedback',
            r'Help',
            r'Privacy',
            r'Terms',
            r'Accessibility links',
            r'Skip to main content',
            r'Accessibility help',
            r'Accessibility feedback',
            r'Filters and topics',
            r'AI Mode response is ready',
            
            # === 日语 (ja-JP) ===
            r'^AI モード\s*',
            r'すべて\s*画像\s*動画\s*ニュース\s*もっと見る',
            r'ログイン',
            r'AI の回答には間違いが含まれている場合があります。?\s*詳細',
            r'\d+ 件のサイト',
            r'すべて表示',
            r'検索結果',
            r'関連する検索',
            r'フィードバックを送信',
            r'ヘルプ',
            r'プライバシー',
            r'利用規約',
            r'ユーザー補助のリンク',
            r'メイン コンテンツにスキップ',
            r'ユーザー補助ヘルプ',
            r'ユーザー補助に関するフィードバック',
            r'フィルタとトピック',
            r'AI モードの回答が作成されました',
            
            # === 韩语 (ko-KR) ===
            r'^AI 모드\s*',
            r'전체\s*이미지\s*동영상\s*뉴스\s*더보기',
            r'로그인',
            r'AI 응답에 실수가 포함될 수 있습니다\.?\s*자세히 알아보기',
            r'\d+개 사이트',
            r'모두 표시',
            r'검색결과',
            r'관련 검색',
            r'의견 보내기',
            r'도움말',
            r'개인정보처리방침',
            r'약관',
            
            # === 德语 (de-DE) ===
            r'^KI-Modus\s*',
            r'Alle\s*Bilder\s*Videos\s*News\s*Mehr',
            r'Anmelden',
            r'KI-Antworten können Fehler enthalten\.?\s*Weitere Informationen',
            r'\d+ Websites?',
            r'Alle anzeigen',
            r'Suchergebnisse',
            r'Ähnliche Suchanfragen',
            r'Feedback senden',
            r'Hilfe',
            r'Datenschutz',
            r'Nutzungsbedingungen',
            
            # === 法语 (fr-FR) ===
            r'^Mode IA\s*',
            r'Tous\s*Images\s*Vidéos\s*Actualités\s*Plus',
            r'Connexion',
            r'Les réponses de l\'IA peuvent contenir des erreurs\.?\s*En savoir plus',
            r'\d+ sites?',
            r'Tout afficher',
            r'Résultats de recherche',
            r'Recherches associées',
            r'Envoyer des commentaires',
            r'Aide',
            r'Confidentialité',
            r'Conditions',
        ]
        
        result = text
        for pattern in patterns:
            # 使用 IGNORECASE 标志处理大小写不敏感的模式（主要针对英文）
            result = re.sub(pattern, '', result, flags=re.IGNORECASE)
        
        # 清理多余的空白字符
        # 1. 将多个连续空格替换为单个空格
        result = re.sub(r' +', ' ', result)
        # 2. 将多个连续换行替换为单个换行
        result = re.sub(r'\n+', '\n', result)
        # 3. 去除首尾空白
        result = result.strip()
        
        return result
