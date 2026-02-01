/**
 * 测试所有链接
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
  
  // 获取所有链接
  const allLinks = await page.evaluate(`
    (() => {
      const links = document.querySelectorAll('a');
      return Array.from(links).map(link => ({
        href: link.href,
        text: link.textContent?.trim().substring(0, 50) || ''
      }));
    })()
  `) as any[];
  
  console.log("\n=== 所有链接 ===");
  console.log("总数:", allLinks.length);
  
  // 过滤非 google 链接
  const externalLinks = allLinks.filter(l => 
    l.href && 
    l.href.startsWith('http') && 
    !l.href.includes('google.com') &&
    !l.href.includes('accounts.google')
  );
  
  console.log("\n外部链接数:", externalLinks.length);
  externalLinks.slice(0, 10).forEach((link, i) => {
    console.log(`${i + 1}. ${link.text} -> ${link.href}`);
  });
  
  // 显示一些 google 链接看看结构
  console.log("\n\nGoogle 链接示例:");
  allLinks.filter(l => l.href && l.href.includes('google.com')).slice(0, 5).forEach((link, i) => {
    console.log(`${i + 1}. ${link.text} -> ${link.href.substring(0, 80)}`);
  });
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
