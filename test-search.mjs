import { AISearcher } from './dist/searcher.js';

async function test() {
  const searcher = new AISearcher(30, true);
  try {
    console.log('开始测试搜索...');
    const result = await searcher.search('什么是 TypeScript', 'zh-CN');
    console.log('搜索结果:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('测试出错:', error);
  } finally {
    await searcher.close();
  }
}

test();
