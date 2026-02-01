/**
 * 测试 JavaScript evaluate 执行
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
  
  // 测试完整的 extractAiAnswer JavaScript 代码
  const jsCode = `
    () => {
      try {
        const result = {
          aiAnswer: '',
          sources: []
        };
        
        const mainContent = document.body.innerText;
        
        // 多语言支持：AI 模式标签
        const aiModeLabels = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA'];
        // 多语言支持：搜索结果标签
        const searchResultLabels = ['搜索结果', 'Search Results', '検索結果', '검색결과', 'Suchergebnisse', 'Résultats de recherche'];
        // 多语言支持：内容结束标记
        const endMarkers = [
          '相关搜索', 'Related searches', '関連する検索', '관련 검색',
          '意见反馈', 'Send feedback', 'フィードバックを送信',
          '帮助', 'Help', 'ヘルプ',
          '隐私权', 'Privacy', 'プライバシー',
          '条款', 'Terms', '利用規約',
        ];
        
        // 需要清理的导航文本
        const navPatterns = [
          /^AI 模式\\s*/g,
          /全部\\s*图片\\s*视频\\s*新闻\\s*更多/g,
          /登录/g,
          /AI 的回答未必正确无误，请注意核查/g,
          /AI 回答可能包含错误。\\s*了解详情/g,
          /请谨慎使用此类代码。?/g,
          /Use code with caution\\.?/gi,
          /\\d+ 个网站/g,
          /全部显示/g,
          /查看相关链接/g,
          /关于这条结果/g,
          /^AI Mode\\s*/g,
          /All\\s*Images\\s*Videos\\s*News\\s*More/gi,
          /Sign in/gi,
          /AI responses may include mistakes\\.?\\s*Learn more/gi,
          /AI overview\\s*/gi,
          /\\d+ sites?/gi,
          /Show all/gi,
          /View related links/gi,
          /About this result/gi,
          /Accessibility links/gi,
          /Skip to main content/gi,
          /Accessibility help/gi,
          /Accessibility feedback/gi,
          /Filters and topics/gi,
          /AI Mode response is ready/gi,
          /^AI モード\\s*/g,
          /すべて\\s*画像\\s*動画\\s*ニュース\\s*もっと見る/g,
          /ログイン/g,
          /AI の回答には間違いが含まれている場合があります。?\\s*詳細/g,
          /\\d+ 件のサイト/g,
          /すべて表示/g,
          /ユーザー補助のリンク/g,
          /メイン コンテンツにスキップ/g,
          /ユーザー補助ヘルプ/g,
          /ユーザー補助に関するフィードバック/g,
          /フィルタとトピック/g,
          /AI モードの回答が作成されました/g,
        ];
        
        const MAX_CONTENT_LENGTH = 50000;
        
        function findEndIndex(startPos) {
          let endIdx = Math.min(mainContent.length, startPos + MAX_CONTENT_LENGTH);
          for (const marker of endMarkers) {
            const idx = mainContent.indexOf(marker, startPos);
            if (idx !== -1 && idx < endIdx) {
              endIdx = idx;
            }
          }
          return endIdx;
        }
        
        function cleanAnswer(text) {
          let cleaned = text;
          for (const pattern of navPatterns) {
            cleaned = cleaned.replace(pattern, '');
          }
          return cleaned.trim();
        }
        
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
          result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, searchResultIndex));
        } else if (aiModeIndex !== -1) {
          const endIndex = findEndIndex(aiModeIndex + 100);
          result.aiAnswer = cleanAnswer(mainContent.substring(aiModeIndex, endIndex));
        } else {
          const endIndex = findEndIndex(100);
          result.aiAnswer = cleanAnswer(mainContent.substring(0, endIndex));
        }
        
        // 提取来源链接
        const links = document.querySelectorAll('a[href^="http"]');
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
          
          if (result.sources.length < 10) {
            result.sources.push({
              title: text.substring(0, 200),
              url: href,
              snippet: ''
            });
          }
        });
        
        return result;
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    }
  `;
  
  const data = await page.evaluate(jsCode) as any;
  console.log("\n=== 提取结果 ===");
  console.log(JSON.stringify(data, null, 2));
  
  await page.waitForTimeout(3000);
  await context.close();
  await browser.close();
}

test().catch(console.error);
