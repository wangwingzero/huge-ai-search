/**
 * 测试 extractAiAnswer 的 JavaScript 代码
 */
import { chromium } from "playwright";
import * as path from "path";

async function test() {
  console.log("开始测试提取逻辑...");
  
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
  
  // 测试提取逻辑
  const jsCode = `
    () => {
      const result = {
        aiAnswer: '',
        sources: [],
        debug: {}
      };
      
      const mainContent = document.body.innerText;
      result.debug.contentLength = mainContent.length;
      result.debug.contentPreview = mainContent.substring(0, 500);
      
      // 多语言支持：AI 模式标签
      const aiModeLabels = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA'];
      // 多语言支持：搜索结果标签
      const searchResultLabels = ['搜索结果', 'Search Results', '検索結果', '검색결과', 'Suchergebnisse', 'Résultats de recherche'];
      
      // 查找 AI 回答区域的起始位置
      let aiModeIndex = -1;
      for (const label of aiModeLabels) {
        const idx = mainContent.indexOf(label);
        if (idx !== -1) {
          aiModeIndex = idx;
          result.debug.foundAiModeLabel = label;
          result.debug.aiModeIndex = idx;
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
            result.debug.foundSearchResultLabel = label;
            result.debug.searchResultIndex = idx;
          }
        }
      }
      
      result.debug.aiModeIndex = aiModeIndex;
      result.debug.searchResultIndex = searchResultIndex;
      
      if (aiModeIndex !== -1 && searchResultIndex !== -1) {
        result.aiAnswer = mainContent.substring(aiModeIndex, searchResultIndex);
        result.debug.extractMethod = 'aiMode to searchResult';
      } else if (aiModeIndex !== -1) {
        result.aiAnswer = mainContent.substring(aiModeIndex, Math.min(mainContent.length, aiModeIndex + 5000));
        result.debug.extractMethod = 'aiMode to end';
      } else {
        result.aiAnswer = mainContent.substring(0, Math.min(mainContent.length, 5000));
        result.debug.extractMethod = 'fallback';
      }
      
      return result;
    }
  `;
  
  const data = await page.evaluate(jsCode) as any;
  console.log("\n=== 提取结果 ===");
  console.log("Debug 信息:", JSON.stringify(data.debug, null, 2));
  console.log("\nAI Answer 长度:", data.aiAnswer.length);
  console.log("\nAI Answer 内容:\n", data.aiAnswer);
  
  await page.waitForTimeout(5000);
  
  await context.close();
  await browser.close();
}

test().catch(console.error);
