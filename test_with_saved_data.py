"""使用保存的用户数据测试搜索"""

import os
import sys
sys.path.insert(0, 'src')

USER_DATA_DIR = os.path.join(os.path.dirname(__file__), "browser_data")

def test():
    print(f"使用用户数据目录: {USER_DATA_DIR}")
    
    from patchright.sync_api import sync_playwright
    
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
            ],
            viewport={'width': 1920, 'height': 1080},
        )
        
        page = context.pages[0] if context.pages else context.new_page()
        
        print("执行 Google AI 搜索: 什么是MCP协议")
        page.goto("https://www.google.com/search?q=什么是MCP协议&udm=50&hl=zh-CN", wait_until='networkidle')
        page.wait_for_timeout(5000)
        
        content = page.evaluate("() => document.body.innerText")
        
        if "异常流量" in content or "我们的系统检测到" in content:
            print("\n⚠️ 仍被验证码拦截")
            print(content[:500])
        else:
            print("\n✅ 搜索成功！")
            print(f"\n内容预览:\n{content[:1500]}...")
        
        context.close()

if __name__ == "__main__":
    test()
