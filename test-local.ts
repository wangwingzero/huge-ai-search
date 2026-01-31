/**
 * 本地测试脚本 - 直接测试搜索功能
 * 
 * 运行: npx ts-node test-local.ts
 * 或: node dist/test-local.js (需要先编译)
 */

import { AISearcher } from "./src/searcher.js";

async function main() {
  const query = process.argv[2] || "什么是 MCP Model Context Protocol";
  const language = process.argv[3] || "zh-CN";

  console.log(`\n🔍 测试搜索: "${query}"`);
  console.log(`📍 语言: ${language}\n`);

  const searcher = new AISearcher();

  try {
    const result = await searcher.search(query, language, false);

    if (result.success) {
      console.log("✅ 搜索成功!\n");
      console.log("=".repeat(60));
      console.log("AI 回答:");
      console.log("=".repeat(60));
      console.log(result.aiAnswer.substring(0, 2000));
      if (result.aiAnswer.length > 2000) {
        console.log("\n... (内容已截断)");
      }
      console.log("\n" + "=".repeat(60));
      console.log(`来源链接 (${result.sources.length} 个):`);
      console.log("=".repeat(60));
      for (const source of result.sources) {
        console.log(`- ${source.title}`);
        console.log(`  ${source.url}\n`);
      }
    } else {
      console.log("❌ 搜索失败:", result.error);
    }
  } catch (error) {
    console.error("❌ 错误:", error);
  } finally {
    await searcher.close();
    console.log("\n🔚 测试完成");
  }
}

main();
