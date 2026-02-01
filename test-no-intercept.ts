/**
 * 测试不拦截资源时的来源提取
 */
import { chromium } from "playwright";
import * as path from "path";

async function test() {
  console.log("开始测试（不拦截资源）...");
  
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
  
  // 不设置资源拦截
  
  await page.goto("https://www.google.com/search?q=什么是人工智能&udm=50&hl=zh-CN", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  
  await page.waitForTimeout(10000);
  
  // 提取来源
  const result = await page.evaluate(`
    (() => {
      const aiContainer = document.querySelector('div[data-subtree="aimc"]');
      const linkContainer = aiContainer || document;
      const links = linkContainer.querySelectorAll('a[href^="http"]');
      const sources = [];
      const seenUrls = new Set();
      
      links.forEach(link => {
        const href = link.href;
        
        if (href.includes('google.') || 
            href.includes('gstatic.com') ||
            href.includes('googleapis.com') ||
            seenUrls.has(href)) {
          return;
        }
        
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
        if (sources.length < 10) {
          sources.push({ title: text.substring(0, 80), url: href });
        }
      });
      
      return {
        containerFound: !!aiContainer,
        totalLinks: links.length,
        sources
      };
    })()
  `) as any;
  
  console.log("\n=== 提取结果 ===");
  console.log("AI 容器找到:", result.containerFound);
  console.log("总链接数:", result.totalLinks);
  console.log("来源数量:", result.sources.length);
  
  if (result.sources.length > 0) {
    console.log("\n来源链接:");
    result.sources.forEach((s: any, i: number) => {
      console.log(`  ${i + 1}. ${s.title}`);
      console.log(`     ${s.url}`);
    });
  }
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
