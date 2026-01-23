"""登录后测试 Google AI 搜索"""

import sys
sys.path.insert(0, 'src')

def test_search():
    print("使用 Patchright 测试搜索...")
    
    from patchright.sync_api import sync_playwright
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
            ]
        )
        
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
            viewport={'width': 1920, 'height': 1080},
        )
        
        page = context.new_page()
        
        print("访问 Google AI 搜索...")
        page.goto("https://www.google.com/search?q=什么是MCP协议&udm=50&hl=zh-CN", wait_until='networkidle')
        page.wait_for_timeout(5000)
        
        content = page.evaluate("() => document.body.innerText")
        
        if "异常流量" in content or "验证" in content:
            print("\n⚠️ 被验证码拦截")
            print(content[:500])
        else:
            print("\n✅ 搜索成功！")
            print(f"\n内容预览:\n{content[:1000]}...")
        
        browser.close()

if __name__ == "__main__":
    test_search()
