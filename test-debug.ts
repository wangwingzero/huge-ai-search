/**
 * 调试测试脚本 - 有头模式
 */
import { AISearcher } from "./dist/searcher.js";

async function test() {
  console.log("开始测试（有头模式）...");
  console.log("cwd:", process.cwd());
  
  // 第二个参数 false = 有头模式
  const searcher = new AISearcher(60, false);
  
  try {
    const result = await searcher.search("什么是人工智能", "zh-CN");
    console.log("结果:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("错误:", error);
  } finally {
    await searcher.close();
  }
}

test();
