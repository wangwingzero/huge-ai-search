/**
 * 测试正则表达式问题
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
  
  // 测试简化版本（不用正则）
  const jsCodeSimple = `
    (() => {
      const result = {
        aiAnswer: '',
        sources: []
      };
      
      const mainContent = document.body.innerText;
      
      const aiModeLabels = ['AI 模式', 'AI Mode'];
      const searchResultLabels = ['搜索结果', 'Search Results'];
      
      let aiModeIndex = -1;
      for (const label of aiModeLabels) {
        const idx = mainContent.indexOf(label);
        if (idx !== -1) {
          aiModeIndex = idx;
          break;
        }
      }
      
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
        result.aiAnswer = mainContent.substring(aiModeIndex, searchResultIndex).trim();
      } else if (aiModeIndex !== -1) {
        result.aiAnswer = mainContent.substring(aiModeIndex, Math.min(mainContent.length, aiModeIndex + 5000)).trim();
      }
      
      return result;
    })()
  `;
  
  const data = await page.evaluate(jsCodeSimple) as any;
  console.log("\n=== 简化版提取结果 ===");
  console.log("aiAnswer 长度:", data?.aiAnswer?.length);
  console.log("aiAnswer 内容:\n", data?.aiAnswer?.substring(0, 500));
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
