/**
 * 调试测试脚本 - 检查页面内容
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
  
  // 等待页面加载
  await page.waitForTimeout(10000);
  
  // 获取页面内容
  const content = await page.evaluate("document.body.innerText") as string;
  console.log("页面内容长度:", content.length);
  console.log("\n=== 完整页面内容 ===\n");
  console.log(content);
  
  await page.waitForTimeout(30000); // 保持浏览器打开让你看
  
  await context.close();
  await browser.close();
}

test().catch(console.error);
