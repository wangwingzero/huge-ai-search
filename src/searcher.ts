/**
 * AI 搜索器 - 核心搜索逻辑
 *
 * 使用 Playwright 抓取 AI 模式搜索结果
 * 完整移植自 Python 版本 google-ai-search-mcp
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as net from "net";

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResult {
  success: boolean;
  query: string;
  aiAnswer: string;
  sources: SearchSource[];
  error: string;
}

// AI 模式选择器（2026 年最新）
const AI_SELECTORS = [
  'div[data-subtree="aimc"]', // Google AI Mode 核心容器（最新）
  'div[data-attrid="wa:/m/0"]', // 旧版选择器
  '[data-async-type="editableDirectAnswer"]', // AI 回答区域
  ".wDYxhc", // AI 概述容器
  '[data-md="50"]', // AI 模式标记
];

// AI 模式关键词（多语言）
const AI_KEYWORDS = ["AI 模式", "AI Mode", "AI モード"];

// 验证码检测关键词
const CAPTCHA_KEYWORDS = [
  "异常流量",
  "我们的系统检测到",
  "unusual traffic",
  "automated requests",
  "验证您是真人",
  "prove you're not a robot",
  "recaptcha",
];

// AI 加载中关键词
const AI_LOADING_KEYWORDS = [
  "正在思考",
  "正在生成",
  "Thinking",
  "Generating",
  "Loading",
];

// AI 加载指示器选择器
const AI_LOADING_SELECTORS = [
  ".typing-cursor",
  '[data-loading="true"]',
  '.stop-button:not([hidden])',
];

// 追问输入框选择器（按优先级排序）
const FOLLOW_UP_SELECTORS = [
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
  'textarea:not([name="q"])',
  'div[contenteditable="true"]',
];

// 需要拦截的资源类型
const BLOCKED_RESOURCE_TYPES = ["image", "font", "media"];

// 需要拦截的 URL 模式（广告、追踪等）
const BLOCKED_URL_PATTERNS = [
  "googleadservices.com",
  "googlesyndication.com",
  "doubleclick.net",
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.com/tr",
  "connect.facebook.net",
];

// 会话超时时间（秒）
const SESSION_TIMEOUT = 300; // 5 分钟

export class AISearcher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionActive: boolean = false;
  private lastActivityTime: number = 0;
  private lastAiAnswer: string = "";
  private browserDataDir: string;
  private timeout: number;
  private headless: boolean;

  // Edge 浏览器安装路径（仅支持 Edge）
  private static readonly EDGE_PATHS: Record<string, string[]> = {
    win32: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
    darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    linux: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
  };

  private sessionId: string;

  constructor(timeout: number = 30, headless: boolean = true, sessionId?: string) {
    this.timeout = timeout;
    this.headless = headless;
    // 每个会话使用独立的数据目录，避免 Chrome 的用户数据目录锁冲突
    this.sessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.browserDataDir = path.join(process.cwd(), "browser_data", this.sessionId);
    if (!fs.existsSync(this.browserDataDir)) {
      fs.mkdirSync(this.browserDataDir, { recursive: true });
    }
    console.error(`AISearcher 初始化: timeout=${timeout}s, headless=${headless}, sessionId=${this.sessionId}`);
    console.error(`浏览器数据目录: ${this.browserDataDir}`);
  }

  /**
   * 查找系统已安装的 Edge 浏览器
   * 注意：仅支持 Edge 浏览器，Chrome 的 Playwright 代理配置有问题
   * @throws Error 如果未找到 Edge 浏览器
   */
  private findBrowser(): string {
    const platform = process.platform;

    // 仅支持 Edge 浏览器
    const edgePaths = AISearcher.EDGE_PATHS[platform] || [];
    for (const edgePath of edgePaths) {
      if (fs.existsSync(edgePath)) {
        console.error(`找到 Edge: ${edgePath}`);
        return edgePath;
      }
    }

    // 未找到 Edge，抛出错误
    const downloadUrl = "https://www.microsoft.com/edge";
    const platformName = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
    throw new Error(
      `未找到 Microsoft Edge 浏览器！\n` +
      `本工具仅支持 Edge 浏览器（Chrome 代理配置有问题）。\n` +
      `请从 ${downloadUrl} 下载安装 Edge for ${platformName}。`
    );
  }

  /**
   * 检测系统代理设置
   * 支持环境变量和常见代理端口检测（v2ray、clash 等）
   */
  private async detectProxy(): Promise<string | undefined> {
    console.error("开始检测代理...");
    
    // 1. 检查环境变量
    const envVars = [
      "HTTP_PROXY",
      "http_proxy",
      "HTTPS_PROXY",
      "https_proxy",
      "ALL_PROXY",
      "all_proxy",
    ];
    for (const envVar of envVars) {
      const proxy = process.env[envVar];
      if (proxy) {
        console.error(`从环境变量 ${envVar} 检测到代理: ${proxy}`);
        return proxy;
      }
    }
    console.error("环境变量中未找到代理配置");

    // 2. 检测常见代理端口（v2ray、clash 等）
    const commonPorts: [number, string][] = [
      [10809, "http://127.0.0.1:10809"], // v2ray 默认 HTTP 代理
      [7890, "http://127.0.0.1:7890"], // clash 默认 HTTP 代理
      [10808, "socks5://127.0.0.1:10808"], // v2ray 默认 SOCKS5 代理
      [7891, "socks5://127.0.0.1:7891"], // clash 默认 SOCKS5 代理
      [1080, "socks5://127.0.0.1:1080"], // 通用 SOCKS5 端口
    ];

    for (const [port, proxyUrl] of commonPorts) {
      console.error(`检测端口 ${port}...`);
      const isOpen = await this.checkPort(port);
      console.error(`端口 ${port} 状态: ${isOpen ? '开放' : '关闭'}`);
      if (isOpen) {
        console.error(`检测到本地代理端口 ${port} 开放，使用代理: ${proxyUrl}`);
        return proxyUrl;
      }
    }

    console.error("未检测到任何代理");
    return undefined;
  }

  /**
   * 检查端口是否开放
   */
  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, "127.0.0.1");
    });
  }

  /**
   * 构建搜索 URL
   */
  private buildUrl(query: string, language: string): string {
    const encodedQuery = encodeURIComponent(query);
    return `https://www.google.com/search?q=${encodedQuery}&udm=50&hl=${language}`;
  }

  /**
   * 获取存储状态文件路径
   */
  private getStorageStatePath(): string {
    return path.join(this.browserDataDir, "storage_state.json");
  }

  /**
   * 获取共享的存储状态文件路径（登录脚本保存的位置）
   */
  private getSharedStorageStatePath(): string {
    return path.join(process.cwd(), "browser_data", "storage_state.json");
  }

  /**
   * 加载存储状态（如果存在）
   * 优先使用会话目录下的状态，如果没有则从共享目录复制
   */
  private loadStorageState(): string | undefined {
    const sessionStatePath = this.getStorageStatePath();
    const sharedStatePath = this.getSharedStorageStatePath();

    // 1. 优先检查会话目录下的认证状态
    if (fs.existsSync(sessionStatePath)) {
      console.error(`加载会话认证状态: ${sessionStatePath}`);
      return sessionStatePath;
    }

    // 2. 如果会话目录没有，尝试从共享目录复制
    if (fs.existsSync(sharedStatePath)) {
      try {
        fs.copyFileSync(sharedStatePath, sessionStatePath);
        console.error(`从共享目录复制认证状态: ${sharedStatePath} -> ${sessionStatePath}`);
        return sessionStatePath;
      } catch (error) {
        console.error(`复制共享认证状态失败: ${error}`);
        // 复制失败时，直接使用共享状态（只读）
        console.error(`回退到直接使用共享认证状态: ${sharedStatePath}`);
        return sharedStatePath;
      }
    }

    console.error("未找到任何认证状态文件");
    return undefined;
  }

  /**
   * 检查是否有活跃的浏览器会话
   */
  hasActiveSession(): boolean {
    if (!this.sessionActive || !this.page) {
      return false;
    }

    // 检查会话是否超时
    if (this.lastActivityTime > 0) {
      const elapsed = (Date.now() - this.lastActivityTime) / 1000;
      if (elapsed > SESSION_TIMEOUT) {
        console.error(`会话已超时（${elapsed.toFixed(0)}秒），将关闭`);
        this.close();
        return false;
      }
    }

    return true;
  }

  /**
   * 设置资源拦截，加速页面加载
   */
  private async setupResourceInterception(page: Page): Promise<void> {
    try {
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        const url = route.request().url();

        // 拦截无用资源类型
        if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
          route.abort();
          return;
        }

        // 拦截广告和追踪脚本
        for (const pattern of BLOCKED_URL_PATTERNS) {
          if (url.includes(pattern)) {
            route.abort();
            return;
          }
        }

        route.continue();
      });
      console.error("已设置资源拦截（图片、字体、广告）");
    } catch (error) {
      console.error(`设置资源拦截失败: ${error}`);
    }
  }

  /**
   * 确保浏览器会话已启动
   */
  private async ensureSession(language: string = "zh-CN"): Promise<boolean> {
    if (this.sessionActive && this.page) {
      return true;
    }

    console.error("启动新的浏览器会话...");

    try {
      const executablePath = this.findBrowser();
      const proxy = await this.detectProxy();

      const launchArgs = [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ];

      const launchOptions: Parameters<typeof chromium.launch>[0] = {
        headless: this.headless,
        executablePath,
        args: launchArgs,
      };

      if (proxy) {
        console.error(`使用代理: ${proxy}`);
        launchOptions.proxy = { server: proxy };
      }

      this.browser = await chromium.launch(launchOptions);

      // 创建上下文时加载共享的 storage_state
      const contextOptions: Parameters<Browser["newContext"]>[0] = {
        viewport: { width: 1920, height: 1080 },
        locale: language,
      };

      // 尝试加载共享的认证状态
      const storageStatePath = this.loadStorageState();
      if (storageStatePath) {
        contextOptions.storageState = storageStatePath;
        console.error(`已加载共享认证状态: ${storageStatePath}`);
      } else {
        console.error("无共享认证状态，使用新会话");
      }

      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();

      // 禁用资源拦截（会影响来源链接的提取）
      // await this.setupResourceInterception(this.page);

      this.sessionActive = true;
      this.lastActivityTime = Date.now();

      console.error("浏览器会话启动成功");
      return true;
    } catch (error) {
      console.error(`启动浏览器会话失败: ${error}`);
      await this.close();
      return false;
    }
  }

  /**
   * 保存存储状态
   */
  private async saveStorageState(): Promise<void> {
    if (!this.context) return;

    try {
      const storageStatePath = this.getStorageStatePath();
      await this.context.storageState({ path: storageStatePath });
      console.error("已保存存储状态");
    } catch (error) {
      console.error(`保存存储状态失败: ${error}`);
    }
  }

  /**
   * 检测验证码页面
   */
  private isCaptchaPage(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return CAPTCHA_KEYWORDS.some((kw) =>
      lowerContent.includes(kw.toLowerCase())
    );
  }

  /**
   * 检测当前页面是否有验证码
   */
  private async detectCaptcha(): Promise<boolean> {
    if (!this.page) return false;
    const content = await this.page.content();
    return this.isCaptchaPage(content);
  }

  /**
   * 处理 Cookie 同意对话框
   */
  private async handleCookieConsent(page: Page): Promise<boolean> {
    const consentSelectors = [
      'button:has-text("全部接受")',
      'button:has-text("Accept all")',
      'button:has-text("すべて同意")',
      'button:has-text("모두 수락")',
      '[aria-label="全部接受"]',
      '[aria-label="Accept all"]',
    ];

    for (const selector of consentSelectors) {
      try {
        const button = await page.$(selector);
        if (button && (await button.isVisible())) {
          console.error(`检测到 Cookie 同意对话框，点击: ${selector}`);
          await button.click();
          await page.waitForTimeout(1000);
          return true;
        }
      } catch {
        continue;
      }
    }

    // 备用方案：使用 JavaScript
    try {
      const jsClickConsent = `
      (() => {
        const buttons = document.querySelectorAll("button");
        for (const btn of buttons) {
          const text = btn.textContent || "";
          if (
            text.includes("全部接受") ||
            text.includes("Accept all") ||
            text.includes("すべて同意")
          ) {
            btn.click();
            return true;
          }
        }
        return false;
      })()
      `;
      const clicked = await page.evaluate(jsClickConsent) as boolean;
      if (clicked) {
        console.error("通过 JavaScript 点击了 Cookie 同意按钮");
        await page.waitForTimeout(1000);
        return true;
      }
    } catch {
      // ignore
    }

    return false;
  }

  /**
   * 等待 AI 内容加载
   */
  private async waitForAiContent(page: Page): Promise<boolean> {
    // 首先处理可能的 Cookie 同意对话框
    await this.handleCookieConsent(page);

    // 优先策略：快速检查页面关键词
    try {
      const content = (await page.evaluate(
        "document.body.innerText"
      )) as string;
      if (AI_KEYWORDS.some((kw) => content.includes(kw))) {
        console.error("通过关键词快速检测到 AI 内容");
        return true;
      }
    } catch {
      // ignore
    }

    // 备用策略：尝试选择器
    for (const selector of AI_SELECTORS) {
      try {
        await page.waitForSelector(selector, { timeout: 1500 });
        console.error(`检测到 AI 回答区域: ${selector}`);
        return true;
      } catch {
        continue;
      }
    }

    // 最后策略：等待关键词出现
    console.error("未找到 AI 内容，等待页面加载...");
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1000);
      try {
        const content = (await page.evaluate(
          "document.body.innerText"
        )) as string;
        if (AI_KEYWORDS.some((kw) => content.includes(kw))) {
          console.error("通过关键词检测到 AI 内容");
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * 检查页面上是否存在加载指示器
   */
  private async checkLoadingIndicators(page: Page): Promise<boolean> {
    for (const selector of AI_LOADING_SELECTORS) {
      try {
        const element = await page.$(selector);
        if (element && (await element.isVisible())) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * 检查页面上是否出现追问建议（表示 AI 生成完成）
   */
  private async checkFollowUpSuggestions(page: Page): Promise<boolean> {
    const followUpSelectors = [
      'div[data-subtree="aimc"] textarea',
      'div[data-subtree="aimc"] input[type="text"]',
      '[aria-label*="follow"]',
      '[aria-label*="追问"]',
      '[placeholder*="follow"]',
      '[placeholder*="追问"]',
    ];

    for (const selector of followUpSelectors) {
      try {
        const element = await page.$(selector);
        if (element && (await element.isVisible())) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * 等待 AI 流式输出完成
   */
  private async waitForStreamingComplete(
    page: Page,
    maxWaitSeconds: number = 30
  ): Promise<boolean> {
    console.error("等待 AI 流式输出完成...");

    let lastContentLength = 0;
    let stableCount = 0;
    const stableThreshold = 3;
    const checkInterval = 500;
    const minContentLength = 500;

    for (let i = 0; i < maxWaitSeconds * 2; i++) {
      try {
        const content = (await page.evaluate(
          "document.body.innerText"
        )) as string;
        const currentLength = content.length;

        // 策略1：检查加载指示器
        const hasLoadingIndicator = await this.checkLoadingIndicators(page);

        // 策略2：检查是否仍在加载状态（关键词检测）
        const isLoading = AI_LOADING_KEYWORDS.some((kw) =>
          content.includes(kw)
        );

        // 策略3：检查追问建议是否出现
        const hasFollowUp = await this.checkFollowUpSuggestions(page);

        // 策略4：检查来源链接数量（确保来源已加载）
        const sourceCount = await page.evaluate(`
          (() => {
            const aiContainer = document.querySelector('div[data-subtree="aimc"]');
            if (!aiContainer) return 0;
            const links = aiContainer.querySelectorAll('a[href^="http"]');
            let count = 0;
            links.forEach(link => {
              const href = link.href;
              if (!href.includes('google.') && !href.includes('gstatic.com') && !href.includes('googleapis.com')) {
                count++;
              }
            });
            return count;
          })()
        `) as number;

        if (hasFollowUp && currentLength >= minContentLength && sourceCount >= 3) {
          console.error(
            `检测到追问建议，AI 输出完成，内容长度: ${currentLength}，来源数: ${sourceCount}`
          );
          return true;
        }

        if (hasLoadingIndicator || isLoading) {
          stableCount = 0;
        } else if (currentLength === lastContentLength) {
          if (currentLength >= minContentLength) {
            stableCount++;
            if (stableCount >= stableThreshold) {
              // 即使内容稳定，也要检查来源链接
              if (sourceCount >= 3) {
                console.error(`AI 输出完成，内容长度: ${currentLength}，来源数: ${sourceCount}`);
                return true;
              } else {
                // 来源链接还没加载完，继续等待（只在首次提示）
                if (stableCount === stableThreshold) {
                  console.error(`内容稳定但来源链接不足 (${sourceCount})，继续等待...`);
                }
                stableCount = 0; // 重置稳定计数，继续等待
              }
            }
          }
        } else {
          stableCount = 0;
        }

        lastContentLength = currentLength;
        await page.waitForTimeout(checkInterval);
      } catch (error) {
        console.error(`等待输出时出错: ${error}`);
        break;
      }
    }

    console.error(`等待超时（${maxWaitSeconds}秒）`);
    return false;
  }


  /**
   * 提取 AI 回答
   */
  private async extractAiAnswer(page: Page): Promise<SearchResult> {
    // 注意：在模板字符串中传递给 page.evaluate 的正则表达式需要双重转义
    // \\s 在 TypeScript 中变成 \s，但传给浏览器时需要 \\\\s 才能变成 \s
    const jsCode = `
    (() => {
      const result = {
        aiAnswer: '',
        sources: []
      };
      
      const mainContent = document.body.innerText;
      
      // 多语言支持：AI 模式标签
      const aiModeLabels = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA'];
      // 多语言支持：搜索结果标签
      const searchResultLabels = ['搜索结果', 'Search Results', '検索結果', '검색결과', 'Suchergebnisse', 'Résultats de recherche'];
      // 多语言支持：内容结束标记
      const endMarkers = [
        '相关搜索', 'Related searches', '関連する検索', '관련 검색',
        '意见反馈', 'Send feedback', 'フィードバックを送信',
        '帮助', 'Help', 'ヘルプ',
        '隐私权', 'Privacy', 'プライバシー',
        '条款', 'Terms', '利用規約',
      ];
      
      // 需要清理的导航文本（使用字符串替换，避免正则转义问题）
      const navStrings = [
        'AI 模式',
        '全部图片视频新闻更多',
        '全部 图片 视频 新闻 更多',
        '登录',
        'AI 的回答未必正确无误，请注意核查',
        'AI 回答可能包含错误。 了解详情',
        'AI 回答可能包含错误。了解详情',
        '请谨慎使用此类代码。',
        '请谨慎使用此类代码',
        'Use code with caution.',
        'Use code with caution',
        '全部显示',
        '查看相关链接',
        '关于这条结果',
        'AI Mode',
        'All Images Videos News More',
        'Sign in',
        'AI responses may include mistakes. Learn more',
        'AI responses may include mistakes.Learn more',
        'AI overview',
        'Show all',
        'View related links',
        'About this result',
        'Accessibility links',
        'Skip to main content',
        'Accessibility help',
        'Accessibility feedback',
        'Filters and topics',
        'AI Mode response is ready',
        'AI モード',
        'すべて 画像 動画 ニュース もっと見る',
        'ログイン',
        'AI の回答には間違いが含まれている場合があります。 詳細',
        'すべて表示',
        'ユーザー補助のリンク',
        'メイン コンテンツにスキップ',
        'ユーザー補助ヘルプ',
        'ユーザー補助に関するフィードバック',
        'フィルタとトピック',
        'AI モードの回答が作成されました',
        '无障碍功能链接',
        '跳到主要内容',
        '无障碍功能帮助',
        '无障碍功能反馈',
        '过滤条件和主题',
      ];
      
      // 需要清理的正则模式（数字+网站）
      const numSitesPatterns = [
        /\\d+\\s*个网站/g,
        /\\d+\\s*sites?/gi,
        /\\d+\\s*件のサイト/g,
      ];
      
      const MAX_CONTENT_LENGTH = 50000;
      
      function findEndIndex(startPos) {
        let endIdx = Math.min(mainContent.length, startPos + MAX_CONTENT_LENGTH);
        for (const marker of endMarkers) {
          const idx = mainContent.indexOf(marker, startPos);
          if (idx !== -1 && idx < endIdx) {
            endIdx = idx;
          }
        }
        return endIdx;
      }
      
      function cleanAnswer(text) {
        let cleaned = text;
        // 字符串替换
        for (const str of navStrings) {
          cleaned = cleaned.split(str).join('');
        }
        // 正则替换（数字+网站）
        for (const pattern of numSitesPatterns) {
          cleaned = cleaned.replace(pattern, '');
        }
        // 清理多余空行
        cleaned = cleaned.replace(/\\n{3,}/g, '\\n\\n');
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
          if (aiModeIndex === -1 || idx > aiModeIndex) {
            searchResultIndex = idx;
          }
        }
      }
      
      if (aiModeIndex !== -1 && searchResultIndex !== -1) {
        result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, searchResultIndex));
      } else if (aiModeIndex !== -1) {
        const endIndex = findEndIndex(aiModeIndex + 100);
        result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, endIndex));
      } else {
        const endIndex = findEndIndex(100);
        result.aiAnswer = cleanAnswer(mainContent.substring(0, endIndex));
      }
      
      // 提取来源链接（从 AI 模式容器中提取）
      const aiContainer = document.querySelector('div[data-subtree="aimc"]');
      const linkContainer = aiContainer || document;
      const links = linkContainer.querySelectorAll('a[href^="http"]');
      const seenUrls = new Set();
      
      links.forEach(link => {
        const href = link.href;
        
        // 过滤 Google 自身的链接（包括所有 google 域名）
        if (href.includes('google.') || 
            href.includes('accounts.google') ||
            href.includes('support.google') ||
            href.includes('gstatic.com') ||
            href.includes('googleapis.com') ||
            seenUrls.has(href)) {
          return;
        }
        
        // 获取链接文本（尝试多种方式）
        let text = link.textContent?.trim() || '';
        
        // 如果链接文本为空，尝试从父元素获取
        if (text.length < 5) {
          const parent = link.parentElement;
          if (parent) {
            text = parent.textContent?.trim() || '';
          }
        }
        
        // 如果还是太短，尝试从 aria-label 或 title 属性获取
        if (text.length < 5) {
          text = link.getAttribute('aria-label') || link.getAttribute('title') || '';
        }
        
        // 从 URL 提取域名作为备用标题
        if (text.length < 5) {
          try {
            const url = new URL(href);
            text = url.hostname.replace('www.', '');
          } catch {
            text = href.substring(0, 50);
          }
        }
        
        seenUrls.add(href);
        
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
    `;

    try {
      const data = (await page.evaluate(jsCode)) as {
        aiAnswer: string;
        sources: { title: string; url: string; snippet: string }[];
      } | undefined;

      if (!data) {
        return {
          success: false,
          query: "",
          aiAnswer: "",
          sources: [],
          error: "页面内容提取失败，可能需要登录 Google 账户",
        };
      }

      const sources: SearchSource[] = (data.sources || []).map((s) => ({
        title: s.title || "",
        url: s.url || "",
        snippet: s.snippet || "",
      }));

      return {
        success: true,
        query: "",
        aiAnswer: data.aiAnswer || "",
        sources,
        error: "",
      };
    } catch (error) {
      return {
        success: false,
        query: "",
        aiAnswer: "",
        sources: [],
        error: `提取内容失败: ${error}`,
      };
    }
  }

  /**
   * 处理验证码 - 弹出有界面的浏览器让用户完成验证
   */
  private async handleCaptcha(
    url: string,
    query: string
  ): Promise<SearchResult> {
    const result: SearchResult = {
      success: false,
      query,
      aiAnswer: "",
      sources: [],
      error: "",
    };

    console.error("检测到验证码，正在打开浏览器窗口...");
    console.error("请在浏览器中完成验证码验证");
    console.error("最长等待时间: 5 分钟");

    // 关闭当前的 headless 浏览器
    await this.close();

    try {
      const executablePath = this.findBrowser();
      const proxy = await this.detectProxy();

      const launchOptions: Parameters<typeof chromium.launch>[0] = {
        headless: false, // 必须显示窗口让用户操作
        executablePath,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--no-sandbox",
        ],
      };

      if (proxy) {
        launchOptions.proxy = { server: proxy };
      }

      const browser = await chromium.launch(launchOptions);

      const storageStatePath = this.getStorageStatePath();
      const contextOptions: Parameters<Browser["newContext"]>[0] = {
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      };

      if (fs.existsSync(storageStatePath)) {
        contextOptions.storageState = storageStatePath;
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      const maxWaitMs = 5 * 60 * 1000;
      const checkInterval = 2000;
      const startTime = Date.now();
      let lastSaveTime = 0;
      const saveInterval = 2000; // 每 2 秒保存一次状态

      console.error("\n" + "=".repeat(60));
      console.error("浏览器窗口已打开！");
      console.error("请完成验证码验证，验证成功后会自动继续搜索");
      console.error("=".repeat(60) + "\n");

      while (Date.now() - startTime < maxWaitMs) {
        try {
          // 定期保存状态（每 2 秒），确保用户关闭浏览器前状态已保存
          if (Date.now() - lastSaveTime > saveInterval) {
            try {
              await context.storageState({ path: storageStatePath });
              lastSaveTime = Date.now();
              console.error("已自动保存认证状态");
            } catch {
              // 保存失败，可能浏览器正在关闭
            }
          }

          const content = (await page.evaluate(
            "document.body.innerText"
          )) as string;
          const currentUrl = page.url();

          const isProblemPage =
            this.isCaptchaPage(content) ||
            currentUrl.toLowerCase().includes("sorry");

          const hasAiModeIndicator =
            content.includes("AI 模式") || content.includes("AI Mode");
          const hasSubstantialContent = content.length > 2000;
          const isNotLoading =
            !content.includes("正在思考") && !content.includes("Thinking");
          const hasSearchResult =
            hasAiModeIndicator && hasSubstantialContent && isNotLoading;

          if (!isProblemPage && hasSearchResult) {
            console.error("验证成功！正在获取搜索结果...");

            // 等待 AI 输出完成
            await this.waitForStreamingComplete(page, 30);

            // 提取结果
            const extractedResult = await this.extractAiAnswer(page);
            result.aiAnswer = extractedResult.aiAnswer;
            result.sources = extractedResult.sources;
            result.success = result.aiAnswer.length > 0;

            // 保存状态
            await context.storageState({ path: storageStatePath });
            console.error("已保存认证状态");

            break;
          }

          await page.waitForTimeout(checkInterval);
        } catch (error) {
          console.error(`等待验证时出错: ${error}`);
          break;
        }
      }

      if (!result.success && !result.error) {
        result.error = "验证超时或用户关闭了浏览器";
      }

      try {
        await context.close();
      } catch {
        // ignore
      }
      try {
        await browser.close();
      } catch {
        // ignore
      }
    } catch (error) {
      result.error = `验证码处理失败: ${error instanceof Error ? error.message : String(error)}`;
      console.error(result.error);
    }

    return result;
  }

  /**
   * 查找追问输入框
   */
  private async findFollowUpInput(): Promise<any | null> {
    if (!this.page) return null;

    for (const selector of FOLLOW_UP_SELECTORS) {
      try {
        const element = await this.page.$(selector);
        if (element && (await element.isVisible())) {
          console.error(`找到追问输入框: ${selector}`);
          return element;
        }
      } catch {
        continue;
      }
    }

    console.error("未找到追问输入框");
    return null;
  }

  /**
   * 使用 JavaScript 检查是否有追问输入框
   */
  private async hasFollowUpInputViaJs(): Promise<boolean> {
    if (!this.page) return false;

    const jsFindInput = `
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
    `;
    try {
      return (await this.page.evaluate(jsFindInput)) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * 使用 JavaScript 提交追问
   */
  private async submitFollowUpViaJs(query: string): Promise<boolean> {
    if (!this.page) return false;

    const jsFillAndSubmit = `
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
    `;
    try {
      return (await this.page.evaluate(jsFillAndSubmit, query)) as boolean;
    } catch (error) {
      console.error(`JavaScript 提交失败: ${error}`);
      return false;
    }
  }

  /**
   * 从内容中移除用户问题
   */
  private removeUserQueryFromContent(content: string, query: string): string {
    if (!content || !query) return content;

    // 尝试精确匹配：问题在开头
    if (content.startsWith(query)) {
      const result = content.slice(query.length).trim();
      console.error(`移除用户问题（精确匹配）: '${query.slice(0, 30)}...'`);
      return result;
    }

    // 尝试模糊匹配
    const queryNormalized = query.trim();
    const contentStart = content.slice(0, queryNormalized.length + 50);

    const pos = contentStart.indexOf(queryNormalized);
    if (pos !== -1 && pos < 20) {
      const result = content.slice(pos + queryNormalized.length).trim();
      console.error(`移除用户问题（模糊匹配）: '${query.slice(0, 30)}...'`);
      return result;
    }

    return content;
  }

  /**
   * 执行搜索
   */
  async search(
    query: string,
    language: string = "zh-CN"
  ): Promise<SearchResult> {
    console.error("=".repeat(60));
    console.error(`开始搜索: query='${query}', language=${language}`);

    this.lastActivityTime = Date.now();

    const result: SearchResult = {
      success: false,
      query,
      aiAnswer: "",
      sources: [],
      error: "",
    };

    try {
      // 确保会话
      if (!(await this.ensureSession(language))) {
        result.error = "无法启动浏览器";
        return result;
      }

      if (!this.page) {
        result.error = "页面未初始化";
        return result;
      }

      // 导航到搜索页面
      const url = this.buildUrl(query, language);
      console.error(`导航到: ${url}`);

      try {
        await this.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.timeout * 1000,
        });
      } catch (gotoError) {
        console.error(`页面导航异常: ${gotoError}`);
        return await this.handleCaptcha(url, query);
      }

      // 等待 AI 内容加载
      await this.waitForAiContent(this.page);

      // 检测验证码
      const content = (await this.page.evaluate(
        "document.body.innerText"
      )) as string;
      if (this.isCaptchaPage(content)) {
        console.error("检测到验证码页面！");
        return await this.handleCaptcha(url, query);
      }

      // 等待 AI 输出完成
      await this.waitForStreamingComplete(this.page);

      // 等待来源链接渲染（来源链接在 AI 回答完成后才会完全加载）
      console.error("等待来源链接渲染...");
      
      // 先等待一段时间让页面稳定
      await this.page.waitForTimeout(3000);
      
      // 尝试等待非 Google 链接出现
      try {
        await this.page.waitForFunction(
          `(() => {
            const aiContainer = document.querySelector('div[data-subtree="aimc"]');
            if (!aiContainer) return false;
            const links = aiContainer.querySelectorAll('a[href^="http"]');
            let nonGoogleCount = 0;
            links.forEach(link => {
              const href = link.href;
              if (!href.includes('google.') && !href.includes('gstatic.com')) {
                nonGoogleCount++;
              }
            });
            return nonGoogleCount >= 3;
          })()`,
          { timeout: 10000 }
        );
        console.error("检测到足够的来源链接");
      } catch {
        console.error("等待来源链接超时，继续提取");
      }

      // 提取内容
      const extractedResult = await this.extractAiAnswer(this.page);
      result.aiAnswer = extractedResult.aiAnswer;
      result.sources = extractedResult.sources;
      result.success = result.aiAnswer.length > 0;

      // 如果没有提取到内容，设置错误信息
      if (!result.success) {
        result.error = extractedResult.error || "未能提取到 AI 回答内容，可能需要登录 Google 账户";
      }

      // 保存回答用于增量提取
      this.lastAiAnswer = result.aiAnswer;
      this.lastActivityTime = Date.now();

      // 保存状态
      await this.saveStorageState();

      console.error(
        `搜索完成: success=${result.success}, ai_answer长度=${result.aiAnswer.length}`
      );
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error(`搜索失败: ${result.error}`);
      return result;
    }
  }

  /**
   * 在当前会话中继续对话（追问）
   */
  async continueConversation(query: string): Promise<SearchResult> {
    console.error(`继续对话: query='${query}'`);

    this.lastActivityTime = Date.now();

    if (!this.hasActiveSession()) {
      console.error("没有活跃会话，回退到新搜索");
      return this.search(query);
    }

    const result: SearchResult = {
      success: false,
      query,
      aiAnswer: "",
      sources: [],
      error: "",
    };

    try {
      if (!this.page) {
        result.error = "页面未初始化";
        return result;
      }

      // 查找追问输入框
      const inputElement = await this.findFollowUpInput();

      if (inputElement) {
        await inputElement.click();
        await this.page.waitForTimeout(300);
        await inputElement.fill(query);
        await this.page.waitForTimeout(300);
        await inputElement.press("Enter");
      } else {
        // 尝试使用 JavaScript
        console.error("尝试使用 JavaScript 查找输入框...");
        if (!(await this.hasFollowUpInputViaJs())) {
          console.error("页面上没有追问输入框，导航到新搜索");
          return this.search(query);
        }

        if (!(await this.submitFollowUpViaJs(query))) {
          console.error("无法提交追问，导航到新搜索");
          return this.search(query);
        }
      }

      // 等待 AI 回答加载
      await this.page.waitForTimeout(1000);
      await this.waitForAiContent(this.page);
      await this.waitForStreamingComplete(this.page, 30);

      // 检查验证码
      const content = (await this.page.evaluate(
        "document.body.innerText"
      )) as string;
      if (this.isCaptchaPage(content)) {
        console.error("追问时检测到验证码！");
        await this.close();
        result.error = "需要验证，请重新搜索";
        return result;
      }

      // 提取 AI 回答
      const extractedResult = await this.extractAiAnswer(this.page);
      result.sources = extractedResult.sources;

      // 保存完整的页面回答内容
      const fullPageAnswer = extractedResult.aiAnswer;

      // 增量提取：只返回新增内容
      if (extractedResult.success && this.lastAiAnswer) {
        if (fullPageAnswer.includes(this.lastAiAnswer)) {
          const lastEndPos =
            fullPageAnswer.indexOf(this.lastAiAnswer) + this.lastAiAnswer.length;
          let newContent = fullPageAnswer.slice(lastEndPos).trim();
          if (newContent) {
            newContent = this.removeUserQueryFromContent(newContent, query);
            result.aiAnswer = newContent;
            console.error(
              `增量提取: 原始长度=${fullPageAnswer.length}, 新增长度=${newContent.length}`
            );
          } else {
            console.error("增量提取未找到新内容，保留完整回答");
            result.aiAnswer = fullPageAnswer;
          }
        } else {
          console.error("增量提取: 未找到上一次回答，保留完整内容");
          result.aiAnswer = fullPageAnswer;
        }
      } else {
        result.aiAnswer = fullPageAnswer;
      }

      result.success = result.aiAnswer.length > 0;

      // 更新记录
      this.lastAiAnswer = fullPageAnswer;
      this.lastActivityTime = Date.now();

      console.error(`追问完成: success=${result.success}`);
      return result;
    } catch (error) {
      console.error(`继续对话失败: ${error}`);

      // 尝试导航到新搜索
      try {
        return this.search(query);
      } catch {
        await this.close();
        result.error = `追问失败: ${error}`;
        return result;
      }
    }
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    console.error("关闭浏览器...");

    this.sessionActive = false;
    this.lastAiAnswer = "";

    if (this.page) {
      try {
        await this.page.close();
      } catch {
        // ignore
      }
      this.page = null;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
      this.context = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore
      }
      this.browser = null;
    }

    console.error("浏览器已关闭");
  }

  /**
   * 打开浏览器让用户登录 Google 账户
   * 用户完成登录后关闭浏览器，认证状态会被保存
   */
  async setupLogin(): Promise<{ success: boolean; message: string }> {
    console.error("启动登录流程...");

    // 关闭现有会话
    await this.close();

    try {
      const executablePath = this.findBrowser();
      const proxy = await this.detectProxy();

      const launchOptions: Parameters<typeof chromium.launch>[0] = {
        headless: false, // 必须显示窗口让用户操作
        executablePath,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--no-sandbox",
          "--start-maximized",
        ],
      };

      if (proxy) {
        console.error(`使用代理: ${proxy}`);
        launchOptions.proxy = { server: proxy };
      }

      const browser = await chromium.launch(launchOptions);

      const storageStatePath = this.getStorageStatePath();
      const contextOptions: Parameters<Browser["newContext"]>[0] = {
        viewport: { width: 1280, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      };

      // 如果有旧的认证状态，加载它
      if (fs.existsSync(storageStatePath)) {
        contextOptions.storageState = storageStatePath;
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      // 打开 Google AI 搜索页面
      console.error("打开 Google AI 搜索页面...");
      await page.goto("https://www.google.com/search?q=hello&udm=50", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      console.error("\n" + "=".repeat(60));
      console.error("🌐 浏览器窗口已打开！");
      console.error("");
      console.error("请在浏览器中完成以下操作：");
      console.error("  1. 如果出现验证码，请完成验证");
      console.error("  2. 如果需要登录 Google，请登录你的账户");
      console.error("  3. 完成后，关闭浏览器窗口即可");
      console.error("");
      console.error("⏱️  最长等待时间: 5 分钟");
      console.error("=".repeat(60) + "\n");

      // 等待用户操作（最多 5 分钟）
      const maxWaitMs = 5 * 60 * 1000;
      const startTime = Date.now();
      let lastSaveTime = 0;
      const saveInterval = 2000; // 每 2 秒保存一次状态

      // 监听浏览器关闭事件
      let browserClosed = false;
      browser.on("disconnected", () => {
        browserClosed = true;
      });

      while (!browserClosed && Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        // 定期保存状态（每 5 秒），确保用户关闭浏览器前状态已保存
        if (!browserClosed && Date.now() - lastSaveTime > saveInterval) {
          try {
            await context.storageState({ path: storageStatePath });
            lastSaveTime = Date.now();
            console.error("已自动保存认证状态");
          } catch {
            // 保存失败，可能浏览器正在关闭
          }
        }
      }

      // 最终保存
      if (!browserClosed) {
        try {
          console.error("保存最终认证状态...");
          await context.storageState({ path: storageStatePath });
          await context.close();
          await browser.close();
        } catch {
          // ignore
        }
      }

      // 检查状态文件是否存在
      if (fs.existsSync(storageStatePath)) {
        console.error(`\n✅ 登录流程完成！认证状态已保存到: ${storageStatePath}`);
        return {
          success: true,
          message: "登录完成！认证状态已保存，现在可以正常使用搜索功能了。",
        };
      } else {
        return {
          success: false,
          message: "登录流程完成，但认证状态保存失败。请重试。",
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`登录流程失败: ${errorMsg}`);
      return {
        success: false,
        message: `登录流程失败: ${errorMsg}`,
      };
    }
  }
}
