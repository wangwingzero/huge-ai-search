"""测试 Google AI 搜索功能"""

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import GoogleAISearcher

def test_search():
    print("初始化搜索器（使用用户浏览器数据）...")
    # 使用用户数据目录，可以复用已登录的 Google 账号
    searcher = GoogleAISearcher(headless=False, timeout=45, use_user_data=True)
    
    print(f"浏览器路径: {searcher._browser_path}")
    print(f"用户数据目录: {searcher._user_data_dir}")
    
    if not searcher._browser_path:
        print("错误: 未找到可用的浏览器")
        return
    
    print("\n执行搜索: 什么是MCP协议")
    result = searcher.search("什么是MCP协议", "zh-CN")
    
    print(f"\n成功: {result.success}")
    print(f"查询: {result.query}")
    
    if result.success:
        # 检查是否被验证码拦截
        if "异常流量" in result.ai_answer or "验证" in result.ai_answer:
            print("\n⚠️ 被 Google 验证码拦截，建议：")
            print("1. 手动在浏览器中访问 Google 完成验证")
            print("2. 使用 use_user_data=True 复用已登录的浏览器配置")
        else:
            print(f"\nAI 回答 (前500字):\n{result.ai_answer[:500]}...")
            print(f"\n来源数量: {len(result.sources)}")
            for i, s in enumerate(result.sources[:3], 1):
                print(f"  {i}. {s.title[:50]} - {s.url}")
    else:
        print(f"错误: {result.error}")

if __name__ == "__main__":
    test_search()
