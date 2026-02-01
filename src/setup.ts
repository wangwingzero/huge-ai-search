#!/usr/bin/env node
/**
 * 设置浏览器 - 登录并保存认证状态
 * 
 * 运行: npx huge-ai-search-setup
 */

import { AISearcher } from "./searcher.js";

async function main() {
  console.log("🚀 Huge AI Search - 浏览器设置工具\n");
  console.log("此工具将打开浏览器窗口，请完成以下操作：");
  console.log("  1. 如果出现验证码，请完成验证");
  console.log("  2. 如果需要登录 Google，请登录你的账户");
  console.log("  3. 完成后，关闭浏览器窗口即可\n");

  const searcher = new AISearcher(60, false, "setup");
  
  try {
    const result = await searcher.setupLogin();
    
    if (result.success) {
      console.log("\n✅ " + result.message);
      console.log("\n现在可以正常使用 huge-ai-search 了！");
    } else {
      console.error("\n❌ " + result.message);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ 设置失败:", error);
    process.exit(1);
  }
}

main();
