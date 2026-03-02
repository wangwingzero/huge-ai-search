#!/usr/bin/env node
/**
 * 设置浏览器 - 登录并保存认证状态
 * 
 * 运行: npx huge-ai-search-setup
 */

import { AISearcher } from "./searcher.js";

async function main() {
  const browseMode = process.argv.includes("--browse");

  if (browseMode) {
    console.log("🌐 Huge AI Search - 浏览器查看\n");
    console.log("将打开浏览器窗口，您可以自由浏览和操作。");
    console.log("关闭浏览器窗口后将自动保存当前账户状态。\n");
  } else {
    console.log("🚀 Huge AI Search - 浏览器设置工具\n");
    console.log("此工具将打开浏览器窗口，请完成以下操作：");
    console.log("  1. 如果出现验证码，请完成验证");
    console.log("  2. 如果需要登录 Google，请登录你的账户");
    console.log("  3. 如果出现服务条款/隐私协议页面，请点击同意");
    console.log("  4. 完成后，关闭浏览器窗口即可\n");
  }

  const searcher = new AISearcher(60, false, "setup");

  try {
    const result = browseMode
      ? await searcher.openBrowser()
      : await searcher.setupLogin();

    if (result.success) {
      console.log("\n✅ " + result.message);
      if (!browseMode) {
        console.log("\n现在可以正常使用 huge-ai-search 了！");
      }
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
