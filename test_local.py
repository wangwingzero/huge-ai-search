"""本地测试脚本"""
import asyncio
import sys
sys.path.insert(0, 'src')
from google_ai_search import AsyncGoogleAISearcher

async def test():
    print("=" * 60)
    print("本地测试 - AsyncGoogleAISearcher（无头模式）")
    print("=" * 60)
    
    # 使用无头模式（headless=True）
    # 通过反检测参数（--disable-blink-features=AutomationControlled）绕过 Google 检测
    searcher = AsyncGoogleAISearcher(timeout=60, headless=True, use_user_data=True)
    result = await searcher.search('Python 是什么编程语言？', language='zh-CN')
    
    print(f"Success: {result.success}")
    print(f"AI Answer length: {len(result.ai_answer)}")
    print(f"Sources count: {len(result.sources)}")
    
    if result.ai_answer:
        preview = result.ai_answer[:300] + "..." if len(result.ai_answer) > 300 else result.ai_answer
        print(f"\nAI Answer preview:\n{preview}")
    
    if result.error:
        print(f"\nError: {result.error}")
    
    if result.sources:
        print(f"\nSources:")
        for i, src in enumerate(result.sources[:3], 1):
            print(f"  {i}. {src.title} - {src.url[:50]}...")
    
    await searcher.close_session()
    print("\n" + "=" * 60)

if __name__ == "__main__":
    asyncio.run(test())
