/**
 * 最终测试 - 使用 AISearcher 类
 */
import { AISearcher } from "./src/searcher";

async function test() {
  console.log("开始测试 AISearcher...");
  
  const searcher = new AISearcher(30, false); // headless=false 方便观察
  
  try {
    const result = await searcher.search("什么是人工智能", "zh-CN");
    
    console.log("\n=== 搜索结果 ===");
    console.log("success:", result.success);
    console.log("error:", result.error);
    console.log("aiAnswer 长度:", result.aiAnswer.length);
    console.log("sources 数量:", result.sources.length);
    console.log("\naiAnswer 内容:\n", result.aiAnswer.substring(0, 500));
    
    if (result.sources.length > 0) {
      console.log("\n来源链接:");
      result.sources.slice(0, 5).forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.title.substring(0, 50)} - ${s.url}`);
      });
    }
  } finally {
    await searcher.close();
  }
}

test().catch(console.error);
