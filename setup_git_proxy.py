"""
自动检测本地代理并配置 Git 使用代理

支持 v2ray、clash 等常见代理工具
"""

import socket
import subprocess
import sys


def detect_proxy() -> tuple[str | None, str | None]:
    """检测本地代理端口
    
    Returns:
        (http_proxy, socks_proxy) 元组
    """
    http_proxy = None
    socks_proxy = None
    
    # 常见代理端口配置
    proxy_ports = [
        (10809, "http", "http://127.0.0.1:10809"),   # v2ray HTTP
        (7890, "http", "http://127.0.0.1:7890"),     # clash HTTP
        (10808, "socks5", "socks5://127.0.0.1:10808"),  # v2ray SOCKS5
        (7891, "socks5", "socks5://127.0.0.1:7891"),    # clash SOCKS5
        (1080, "socks5", "socks5://127.0.0.1:1080"),    # 通用 SOCKS5
    ]
    
    for port, proxy_type, proxy_url in proxy_ports:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            result = sock.connect_ex(('127.0.0.1', port))
            sock.close()
            if result == 0:
                print(f"[OK] 检测到 {proxy_type.upper()} 代理: {proxy_url}")
                if proxy_type == "http" and not http_proxy:
                    http_proxy = proxy_url
                elif proxy_type == "socks5" and not socks_proxy:
                    socks_proxy = proxy_url
        except Exception:
            pass
    
    return http_proxy, socks_proxy


def configure_git_proxy(http_proxy: str | None, socks_proxy: str | None):
    """配置 Git 代理
    
    Args:
        http_proxy: HTTP 代理地址
        socks_proxy: SOCKS5 代理地址
    """
    # 优先使用 HTTP 代理，因为 Git 对 HTTP 代理支持更好
    proxy = http_proxy or socks_proxy
    
    if not proxy:
        print("[!] 未检测到可用代理")
        return False
    
    print(f"\n正在配置 Git 代理: {proxy}")
    
    try:
        # 配置 HTTP 代理（用于 https:// 仓库）
        subprocess.run(
            ["git", "config", "--global", "http.proxy", proxy],
            check=True, capture_output=True
        )
        print(f"[OK] git config --global http.proxy {proxy}")
        
        # 配置 HTTPS 代理
        subprocess.run(
            ["git", "config", "--global", "https.proxy", proxy],
            check=True, capture_output=True
        )
        print(f"[OK] git config --global https.proxy {proxy}")
        
        # 针对 GitHub 单独配置（可选，更精确）
        subprocess.run(
            ["git", "config", "--global", "http.https://github.com.proxy", proxy],
            check=True, capture_output=True
        )
        print(f"[OK] git config --global http.https://github.com.proxy {proxy}")
        
        print("\n[SUCCESS] Git 代理配置完成！")
        print("现在可以正常使用 git push/pull 了")
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] 配置失败: {e}")
        return False


def remove_git_proxy():
    """移除 Git 代理配置"""
    print("正在移除 Git 代理配置...")
    
    commands = [
        ["git", "config", "--global", "--unset", "http.proxy"],
        ["git", "config", "--global", "--unset", "https.proxy"],
        ["git", "config", "--global", "--unset", "http.https://github.com.proxy"],
    ]
    
    for cmd in commands:
        try:
            subprocess.run(cmd, capture_output=True)
        except Exception:
            pass
    
    print("[OK] Git 代理配置已移除")


def show_current_config():
    """显示当前 Git 代理配置"""
    print("\n当前 Git 代理配置:")
    print("-" * 40)
    
    configs = ["http.proxy", "https.proxy", "http.https://github.com.proxy"]
    
    for config in configs:
        try:
            result = subprocess.run(
                ["git", "config", "--global", "--get", config],
                capture_output=True, text=True
            )
            value = result.stdout.strip() or "(未设置)"
            print(f"  {config}: {value}")
        except Exception:
            print(f"  {config}: (未设置)")


def main():
    print("=" * 50)
    print("Git 代理自动配置工具")
    print("=" * 50)
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--remove":
            remove_git_proxy()
            show_current_config()
            return
        elif sys.argv[1] == "--show":
            show_current_config()
            return
        elif sys.argv[1] == "--help":
            print("用法:")
            print("  python setup_git_proxy.py          # 自动检测并配置代理")
            print("  python setup_git_proxy.py --remove # 移除代理配置")
            print("  python setup_git_proxy.py --show   # 显示当前配置")
            return
    
    print("\n[1] 检测本地代理...")
    http_proxy, socks_proxy = detect_proxy()
    
    if not http_proxy and not socks_proxy:
        print("\n[!] 未检测到运行中的代理软件")
        print("请确保 v2ray、clash 或其他代理软件正在运行")
        return
    
    print("\n[2] 配置 Git 代理...")
    configure_git_proxy(http_proxy, socks_proxy)
    
    show_current_config()


if __name__ == "__main__":
    main()