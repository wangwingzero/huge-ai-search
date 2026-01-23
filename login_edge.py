"""
Edge 浏览器登录脚本

打开 Edge 浏览器让用户登录 Google 账号，登录状态会保存到 edge_browser_data 目录。
之后 MCP 服务器就可以复用这个登录状态（静默模式）。
"""

import os
import sys

# 添加 src 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

def main():
    print("=" * 60)
    print("Google AI Search MCP - Edge 浏览器登录")
    print("=" * 60)
    print()
    print("这个脚本会打开 Edge 浏览器，让你登录 Google 账号。")
    print("登录状态会保存到 edge_browser_data 目录（独立目录，不影响日常 Edge）。")
    print()
    
    # 检查 Edge 是否存在
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    
    edge_path = None
    for path in edge_paths:
        if os.path.exists(path):
            edge_path = path
            break
    
    if not edge_path:
        print("[错误] 未找到 Edge 浏览器！")
        print("Edge 应该是 Windows 预装的，请检查安装。")
        return
    
    print(f"[OK] 找到 Edge: {edge_path}")
    
    # 用户数据目录（独立目录，不影响日常 Edge）
    user_data_dir = os.path.join(os.path.dirname(__file__), "edge_browser_data")
    os.makedirs(user_data_dir, exist_ok=True)
    print(f"[OK] 用户数据目录: {user_data_dir}")
    print()
    
    # 使用 Patchright 打开浏览器
    try:
        from patchright.sync_api import sync_playwright
        print("[OK] 使用 Patchright (防检测模式)")
    except ImportError:
        from playwright.sync_api import sync_playwright
        print("[!] Patchright 不可用，使用 Playwright")
    
    print()
    print("正在启动浏览器...")
    print()
    
    with sync_playwright() as p:
        # 启动持久化上下文
        context = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            executable_path=edge_path,
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
            ],
            viewport={'width': 1280, 'height': 800},
        )
        
        page = context.pages[0] if context.pages else context.new_page()
        
        # 导航到 Google 登录页面
        print("正在打开 Google 登录页面...")
        page.goto("https://accounts.google.com/")
        
        print()
        print("=" * 60)
        print("请在浏览器中完成以下操作：")
        print("1. 登录你的 Google 账号")
        print("2. 完成后，关闭浏览器窗口")
        print("=" * 60)
        print()
        print("等待浏览器关闭...")
        
        # 等待用户关闭浏览器
        try:
            while len(context.pages) > 0:
                page.wait_for_timeout(1000)
        except Exception:
            pass
        
        # 关闭上下文
        try:
            context.close()
        except Exception:
            pass
    
    print()
    print("=" * 60)
    print("[OK] 登录完成！")
    print(f"用户数据已保存到: {user_data_dir}")
    print()
    print("现在可以重启 MCP 服务器，使用静默模式搜索了。")
    print("=" * 60)


if __name__ == "__main__":
    main()
