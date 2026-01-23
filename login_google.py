"""使用 Patchright 打开浏览器让用户登录 Google"""

import sys
sys.path.insert(0, 'src')

def open_for_login():
    print("使用 Patchright 打开浏览器...")
    
    try:
        from patchright.sync_api import sync_playwright
    except ImportError:
        print("Patchright 未安装，尝试安装...")
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "patchright"])
        from patchright.sync_api import sync_playwright
    
    with sync_playwright() as p:
        print("启动 Edge 浏览器（非无头模式）...")
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
            viewport={'width': 1280, 'height': 800},
        )
        
        page = context.new_page()
        
        print("打开 Google 登录页面...")
        page.goto("https://accounts.google.com")
        
        print("\n" + "="*50)
        print("请在浏览器中登录你的 Google 账号")
        print("登录完成后，按 Enter 键继续...")
        print("="*50 + "\n")
        
        input()
        
        print("正在测试 Google AI 搜索...")
        page.goto("https://www.google.com/search?q=什么是MCP协议&udm=50&hl=zh-CN")
        page.wait_for_timeout(5000)
        
        # 获取页面内容
        content = page.evaluate("() => document.body.innerText")
        
        if "异常流量" in content or "验证" in content:
            print("\n⚠️ 仍然被验证码拦截")
        else:
            print("\n✅ 搜索成功！")
            print(f"\n页面内容预览:\n{content[:800]}...")
        
        print("\n按 Enter 键关闭浏览器...")
        input()
        
        browser.close()

if __name__ == "__main__":
    open_for_login()
