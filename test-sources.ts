/**
 * 测试来源链接提取
 */
import { chromium } from "playwright";
import * as path from "path";

async function test() {
  console.log("开始测试来源提取...");
  
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
  
  // 测试来源提取
  const links = await page.evaluate(`
    (() => {
      const links = document.querySelectorAll('a[href^="http"]');
      const result = [];
      const seenUrls = new Set();
      
      links.forEach(link => {
        const href = link.href;
        const text = link.textContent?.trim() || '';
        
        if (href.includes('google.com') || 
            href.includes('accounts.google') ||
            seenUrls.has(href) ||
            text.length < 5) {
          return;
        }
        
        seenUrls.add(href);
        
        if (result.length < 10) {
          result.push({
            title: text.substring(0, 100),
            url: href
          });
        }
      });
      
      return result;
    })()
  `) as any[];
  
  console.log("\n=== 来源链接 ===");
  console.log("数量:", links.length);
  links.forEach((link, i) => {
    console.log(`${i + 1}. ${link.title}`);
    console.log(`   ${link.url}`);
  });
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
