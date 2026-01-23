"""设置浏览器 - 创建持久化用户数据目录并登录"""

import os
import sys
sys.path.insert(0, 'src')

USER_DATA_DIR = os.path.join(os.path.dirname(__file__), "browser_data")

def setup():
    print(f"用户数据目录: {USER_DATA_DIR}")
    
    from patchright.sync_api import sync_playwright
    
    with sync_playwright() as p:
        print("启动持久化浏览器上下文...")
        
        # 使用持久化上下文，Cookie 会保存到 USER_DATA_DIR
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
            ],
            viewport={'width': 1280, 'height': 800},
        )
        
        page = context.pages[0] if context.pages else context.new_page()
        
        print("打开 Google...")
        page.goto("https://www.google.com")
        
        print("\n" + "="*60)
        print("浏览器已打开！")
        print("1. 如果需要登录 Google，请登录")
        print("2. 如果出现验证码，请完成验证")
        print("3. 完成后关闭浏览器窗口即可")
        print("="*60 + "\n")
        
        # 等待用户关闭浏览器
        try:
            page.wait_for_timeout(300000)  # 等待 5 分钟
        except:
            pass
        
        context.close()
        print("浏览器已关闭，用户数据已保存。")

if __name__ == "__main__":
    setup()
