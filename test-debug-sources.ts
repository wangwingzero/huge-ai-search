/**
 * 调试来源提取
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
  
  await page.waitForTimeout(10000);
  
  // 使用和 searcher.ts 完全相同的 JavaScript 代码
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
        result.aiAnswer = mainContent.substring(aiModeIndex, searchResultIndex).trim();
      } else if (aiModeIndex !== -1) {
        result.aiAnswer = mainContent.substring(aiModeIndex, Math.min(mainContent.length, aiModeIndex + 5000)).trim();
      }
      
      // 提取来源链接（从 AI 模式容器中提取）
      const aiContainer = document.querySelector('div[data-subtree="aimc"]');
      const linkContainer = aiContainer || document;
      const links = linkContainer.querySelectorAll('a[href^="http"]');
      const seenUrls = new Set();
      
      console.log('AI Container found:', !!aiContainer);
      console.log('Total links in container:', links.length);
      
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
  
  const data = await page.evaluate(jsCode) as any;
  
  console.log("\n=== 提取结果 ===");
  console.log("aiAnswer 长度:", data?.aiAnswer?.length);
  console.log("sources 数量:", data?.sources?.length);
  
  if (data?.sources?.length > 0) {
    console.log("\n来源链接:");
    data.sources.forEach((s: any, i: number) => {
      console.log(`  ${i + 1}. ${s.title.substring(0, 50)}`);
      console.log(`     ${s.url}`);
    });
  }
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
