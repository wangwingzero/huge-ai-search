/**
 * 设置浏览器 - 使用 nodriver 登录并保存认证状态
 * 
 * 运行: npx ts-node setup-browser.ts
 * 或: node dist/setup-browser.js
 */

import { AISearcher } from "./src/searcher.js";

async function setup() {
  console.log("启动 nodriver 登录流程...");
  const searcher = new AISearcher(60, false, "setup");
  const result = await searcher.setupLogin();
  if (!result.success) {
    throw new Error(result.message);
  }
  console.log(`\n✅ ${result.message}`);
  console.log("现在可以使用 huge-ai-search 了！");
}

setup().catch(console.error);
