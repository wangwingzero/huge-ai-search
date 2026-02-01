/**
 * 简单测试 - 检查 JavaScript 执行
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
  
  // 简单测试
  const content = await page.evaluate("document.body.innerText") as string;
  console.log("页面内容长度:", content.length);
  
  // 测试查找 AI 模式
  const aiModeIndex = content.indexOf("AI 模式");
  console.log("AI 模式位置:", aiModeIndex);
  
  // 测试查找搜索结果
  const searchResultIndex = content.indexOf("搜索结果");
  console.log("搜索结果位置:", searchResultIndex);
  
  if (aiModeIndex !== -1 && searchResultIndex !== -1) {
    const aiAnswer = content.substring(aiModeIndex, searchResultIndex);
    console.log("\n提取的 AI 回答长度:", aiAnswer.length);
    console.log("\n提取的 AI 回答:\n", aiAnswer);
  } else {
    console.log("\n未找到标记，显示前 1000 字符:");
    console.log(content.substring(0, 1000));
  }
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
