/**
 * AI 搜索器 - 核心搜索逻辑
 *
 * 使用 Playwright 抓取 AI 模式搜索结果
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

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

// AI 模式选择器
const AI_SELECTORS = [
  'div[data-subtree="aimc"]',
  'div[data-attrid="wa:/m/0"]',
  '[data-async-type="editableDirectAnswer"]',
  ".wDYxhc",
  '[data-md="50"]',
];

// 验证码关键词
const CAPTCHA_KEYWORDS = [
  "异常流量",
  "unusual traffic",
  "验证您是真人",
  "prove you're not a robot",
  "recaptcha",
];

// AI 加载中关键词
const AI_LOADING_KEYWORDS = ["正在思考", "正在生成", "Thinking", "Generating"];

export class AISearcher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastAiAnswer: string = "";
  private browserDataDir: string;

  // Chrome 可能的安装路径
  private static readonly CHROME_PATHS: Record<string, string[]> = {
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(os.homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ],
  };

  constructor() {
    // 浏览器数据目录
    this.browserDataDir = path.join(process.cwd(), "browser_data");
    if (!fs.existsSync(this.browserDataDir)) {
      fs.mkdirSync(this.browserDataDir, { recursive: true });
    }
  }

  /**
   * 查找系统已安装的 Chrome
   */
  private findChrome(): string | undefined {
    const platform = process.platform;
    const paths = AISearcher.CHROME_PATHS[platform] || [];
    
    for (const chromePath of paths) {
      if (fs.existsSync(chromePath)) {
        console.error(`找到 Chrome: ${chromePath}`);
        return chromePath;
      }
    }
    
    console.error("未找到系统 Chrome，将使用 Playwright 内置浏览器");
    return undefined;
  }

  /**
   * 构建搜索 URL
   */
  private buildUrl(query: string, language: string): string {
    const encodedQuery = encodeURIComponent(query);
    return `https://www.google.com/search?q=${encodedQuery}&udm=50&hl=${language}`;
  }

  /**
   * 确保浏览器会话已启动
   */
  private async ensureSession(): Promise<boolean> {
    if (this.browser && this.page) {
      return true;
    }

    console.error("启动浏览器会话...");

    try {
      // 查找系统 Chrome
      const executablePath = this.findChrome();

      this.browser = await chromium.launch({
        headless: true,
        executablePath,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--no-sandbox",
        ],
      });

      // 尝试加载存储状态
      const storageStatePath = path.join(
        this.browserDataDir,
        "storage_state.json"
      );
      const contextOptions: Parameters<Browser["newContext"]>[0] = {
        viewport: { width: 1920, height: 1080 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      };

      if (fs.existsSync(storageStatePath)) {
        contextOptions.storageState = storageStatePath;
        console.error("已加载存储状态");
      }

      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();

      // 拦截无用资源
      await this.page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (["image", "font", "media"].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      console.error("浏览器会话已启动");
      return true;
    } catch (error) {
      console.error("启动浏览器失败:", error);
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
      const storageStatePath = path.join(
        this.browserDataDir,
        "storage_state.json"
      );
      await this.context.storageState({ path: storageStatePath });
      console.error("已保存存储状态");
    } catch (error) {
      console.error("保存存储状态失败:", error);
    }
  }

  /**
   * 检测验证码
   */
  private isCaptchaPage(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return CAPTCHA_KEYWORDS.some((kw) => lowerContent.includes(kw.toLowerCase()));
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
   * 处理验证码 - 弹出有界面的浏览器让用户完成验证
   * 等待用户完成验证后继续搜索，最长等待 5 分钟
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
      const executablePath = this.findChrome();

      // 启动有界面的浏览器
      const browser = await chromium.launch({
        headless: false, // 必须显示窗口让用户操作
        executablePath,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--no-sandbox",
        ],
      });

      // 加载存储状态
      const storageStatePath = path.join(
        this.browserDataDir,
        "storage_state.json"
      );
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

      // 导航到搜索页面
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // 等待用户完成验证（最长 5 分钟）
      const maxWaitMs = 5 * 60 * 1000;
      const checkInterval = 2000;
      const startTime = Date.now();

      console.error("\n" + "=".repeat(60));
      console.error("浏览器窗口已打开！");
      console.error("请完成验证码验证，验证成功后会自动继续搜索");
      console.error("=".repeat(60) + "\n");

      while (Date.now() - startTime < maxWaitMs) {
        try {
          const content = await page.evaluate("document.body.innerText") as string;
          const currentUrl = page.url();

          // 检查是否在验证码/问题页面
          const isProblemPage =
            this.isCaptchaPage(content) || currentUrl.toLowerCase().includes("sorry");
          
          // 检查是否有真正的 AI 搜索结果（更严格的判断）
          const hasAiModeIndicator = content.includes("AI 模式") || content.includes("AI Mode");
          const hasSubstantialContent = content.length > 2000;
          const isNotLoading = !content.includes("正在思考") && !content.includes("Thinking");
          const hasSearchResult = hasAiModeIndicator && hasSubstantialContent && isNotLoading;

          if (!isProblemPage && hasSearchResult) {
            console.error("验证成功！正在获取搜索结果...");

            // 等待 AI 输出完成
            let lastLength = 0;
            let stableCount = 0;
            for (let i = 0; i < 60; i++) {
              const newContent = await page.evaluate("document.body.innerText") as string;
              if (newContent.length === lastLength) {
                stableCount++;
                if (stableCount >= 3) break;
              } else {
                stableCount = 0;
              }
              lastLength = newContent.length;
              await page.waitForTimeout(500);
            }

            // 提取结果
            for (const selector of AI_SELECTORS) {
              try {
                const element = await page.$(selector);
                if (element) {
                  const text = await element.innerText();
                  if (text && text.length > 100) {
                    result.aiAnswer = text.trim();
                    break;
                  }
                }
              } catch {
                continue;
              }
            }

            if (!result.aiAnswer) {
              const bodyText = await page.evaluate("document.body.innerText") as string;
              result.aiAnswer = bodyText.substring(0, 5000);
            }

            result.success = result.aiAnswer.length > 0;

            // 保存状态
            await context.storageState({ path: storageStatePath });
            console.error("已保存认证状态");

            break;
          }

          await page.waitForTimeout(checkInterval);
        } catch (error) {
          // 页面可能被用户关闭
          console.error("等待验证时出错:", error);
          break;
        }
      }

      if (!result.success) {
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
   * 等待 AI 流式输出完成
   */
  private async waitForStreamingComplete(maxWaitSeconds = 30): Promise<boolean> {
    if (!this.page) return false;

    console.error("等待 AI 输出完成...");

    let lastContentLength = 0;
    let stableCount = 0;
    const stableThreshold = 3;
    const checkInterval = 500;
    const minContentLength = 500;

    for (let i = 0; i < maxWaitSeconds * 2; i++) {
      try {
        const content = await this.page.evaluate(
          "document.body.innerText"
        ) as string;
        const currentLength = content.length;

        // 检查是否仍在加载
        const isLoading = AI_LOADING_KEYWORDS.some((kw) =>
          content.includes(kw)
        );

        if (isLoading) {
          stableCount = 0;
        } else if (currentLength === lastContentLength) {
          if (currentLength >= minContentLength) {
            stableCount++;
            if (stableCount >= stableThreshold) {
              console.error(`AI 输出完成，内容长度: ${currentLength}`);
              return true;
            }
          }
        } else {
          stableCount = 0;
        }

        lastContentLength = currentLength;
        await this.page.waitForTimeout(checkInterval);
      } catch (error) {
        console.error("等待输出时出错:", error);
        break;
      }
    }

    console.error("等待超时");
    return false;
  }

  /**
   * 提取 AI 回答
   */
  private async extractAiAnswer(): Promise<string> {
    if (!this.page) return "";

    for (const selector of AI_SELECTORS) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          const text = await element.innerText();
          if (text && text.length > 100) {
            return text.trim();
          }
        }
      } catch {
        continue;
      }
    }

    // 回退：提取整个页面文本
    try {
      const bodyText = await this.page.evaluate("document.body.innerText") as string;
      return bodyText.substring(0, 5000);
    } catch {
      return "";
    }
  }

  /**
   * 提取来源链接
   */
  private async extractSources(): Promise<SearchSource[]> {
    if (!this.page) return [];

    const sources: SearchSource[] = [];

    try {
      // 使用 $$() 获取多个链接元素
      const links = await this.page.$$("a[href]");

      for (const link of links.slice(0, 10)) {
        try {
          const href = await link.getAttribute("href");
          const text = await link.innerText();

          if (
            href &&
            text &&
            href.startsWith("http") &&
            !href.includes("google.com") &&
            text.length > 5
          ) {
            sources.push({
              title: text.substring(0, 100),
              url: href,
              snippet: "",
            });

            if (sources.length >= 5) break;
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      console.error("提取来源失败:", error);
    }

    return sources;
  }

  /**
   * 执行搜索
   */
  async search(
    query: string,
    language: string = "zh-CN",
    followUp: boolean = false
  ): Promise<SearchResult> {
    const result: SearchResult = {
      success: false,
      query,
      aiAnswer: "",
      sources: [],
      error: "",
    };

    try {
      // 确保会话
      if (!(await this.ensureSession())) {
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

      await this.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // 检测验证码
      if (await this.detectCaptcha()) {
        // 弹出浏览器窗口让用户完成验证
        return await this.handleCaptcha(url, query);
      }

      // 等待 AI 输出完成
      await this.waitForStreamingComplete();

      // 提取内容
      let aiAnswer = await this.extractAiAnswer();

      // 增量提取（追问模式）
      if (followUp && this.lastAiAnswer && aiAnswer.includes(this.lastAiAnswer)) {
        aiAnswer = aiAnswer.replace(this.lastAiAnswer, "").trim();
      }

      this.lastAiAnswer = aiAnswer;

      result.aiAnswer = aiAnswer;
      result.sources = await this.extractSources();
      result.success = aiAnswer.length > 0;

      // 保存状态
      await this.saveStorageState();

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error("搜索失败:", result.error);
      return result;
    }
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    console.error("关闭浏览器...");

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

    this.lastAiAnswer = "";
    console.error("浏览器已关闭");
  }
}
