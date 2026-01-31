"""设置浏览器 - 登录并保存认证状态"""

import os
import sys
sys.path.insert(0, 'src')

# Chrome 数据目录和状态文件
CHROME_DATA_DIR = os.path.join(os.path.dirname(__file__), "chrome_browser_data")
STORAGE_STATE_PATH = os.path.join(CHROME_DATA_DIR, "storage_state.json")

# Chrome 路径
CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
]

def find_chrome():
    for path in CHROME_PATHS:
        if os.path.exists(path):
            return path
    return None

def setup():
    os.makedirs(CHROME_DATA_DIR, exist_ok=True)
    
    chrome_path = find_chrome()
    if not chrome_path:
        print("❌ 未找到 Chrome，请先安装 Chrome 浏览器")
        return
    
    print(f"Chrome 路径: {chrome_path}")
    print(f"状态文件: {STORAGE_STATE_PATH}")
    
    try:
        from patchright.sync_api import sync_playwright
        print("使用 Patchright (防检测模式)")
    except ImportError:
        from playwright.sync_api import sync_playwright
        print("使用 Playwright")
    
    with sync_playwright() as p:
        print("启动浏览器...")
        
        browser = p.chromium.launch(
            executable_path=chrome_path,
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
            ],
        )
        
        context = browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        )
        
        page = context.new_page()
        
        print("打开 Google AI 搜索...")
        page.goto("https://www.google.com/search?q=hello&udm=50")
        
        print("\n" + "="*60)
        print("浏览器已打开！")
        print("1. 如果出现验证码，请完成验证")
        print("2. 如果需要登录 Google，请登录")
        print("3. 完成后关闭浏览器窗口即可")
        print("="*60 + "\n")
        
        # 等待用户关闭浏览器
        try:
            page.wait_for_timeout(300000)  # 等待 5 分钟
        except:
            pass
        
        # 保存认证状态
        print("保存认证状态...")
        context.storage_state(path=STORAGE_STATE_PATH)
        
        context.close()
        browser.close()
        
        print(f"\n✅ 认证状态已保存到: {STORAGE_STATE_PATH}")
        print("现在可以使用 MCP 搜索工具了！")

if __name__ == "__main__":
    setup()
