/**
 * 测试页面结构
 */
import { chromium } from "playwright";
import * as path from "path";

async function test() {
  console.log("开始测试...");
  
  const browser = await chromium.launch({
    headless: false,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--disable-blink-features=AutomationControlled"],
    proxy: { server: "http://127.0.0.1:10809" }
  });
  
  const storageStatePath = path.join(process.cwd(), "browser_data", "storage_state.json");
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    storageState: storageStatePath,
    locale: "zh-CN"
  });
  
  const page = await context.newPage();
  
  await page.goto("https://www.google.com/search?q=什么是人工智能&udm=50&hl=zh-CN", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  
  await page.waitForTimeout(8000);
  
  // 查找 AI 模式容器内的链接
  const aiModeLinks = await page.evaluate(`
    (() => {
      // 尝试找到 AI 模式容器
      const aiContainer = document.querySelector('div[data-subtree="aimc"]');
      if (!aiContainer) {
        return { error: '未找到 AI 模式容器', allLinks: [] };
      }
      
      const links = aiContainer.querySelectorAll('a[href^="http"]');
      const result = [];
      const seenUrls = new Set();
      
      links.forEach(link => {
        const href = link.href;
        if (href.includes('google.') || seenUrls.has(href)) return;
        
        let text = link.textContent?.trim() || '';
        if (text.length < 5) {
          const parent = link.parentElement;
          if (parent) text = parent.textContent?.trim() || '';
        }
        if (text.length < 5) {
          try {
            const url = new URL(href);
            text = url.hostname.replace('www.', '');
          } catch {
            text = href;
          }
        }
        
        seenUrls.add(href);
        result.push({ title: text.substring(0, 100), url: href });
      });
      
      return { containerFound: true, links: result };
    })()
  `) as any;
  
  console.log("\n=== AI 模式容器内的链接 ===");
  console.log(JSON.stringify(aiModeLinks, null, 2));
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
