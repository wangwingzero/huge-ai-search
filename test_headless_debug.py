"""调试无头模式启动问题"""
import asyncio
import nodriver as uc

async def test_minimal():
    """最小化测试 - 不使用 user_data_dir"""
    print("测试1: 最小化启动（无 user_data_dir）")
    try:
        browser = await uc.start(
            headless=True,
            no_sandbox=True,
            browser_args=['--disable-blink-features=AutomationControlled'],
        )
        print("✅ 启动成功！")
        tab = browser.main_tab
        await tab.get("https://www.google.com")
        print(f"✅ 导航成功，URL: {tab.url}")
        browser.stop()
        return True
    except Exception as e:
        print(f"❌ 失败: {e}")
        return False

async def test_with_user_data():
    """测试带 user_data_dir"""
    print("\n测试2: 带 user_data_dir")
    try:
        browser = await uc.start(
            headless=True,
            no_sandbox=True,
            user_data_dir="D:/huge-ai-search/browser_data",
            browser_args=['--disable-blink-features=AutomationControlled'],
        )
        print("✅ 启动成功！")
        tab = browser.main_tab
        await tab.get("https://www.google.com")
        print(f"✅ 导航成功，URL: {tab.url}")
        browser.stop()
        return True
    except Exception as e:
        print(f"❌ 失败: {e}")
        return False

async def test_headless_false():
    """测试有头模式作为对照"""
    print("\n测试3: 有头模式（对照）")
    try:
        browser = await uc.start(
            headless=False,
            no_sandbox=True,
            browser_args=['--disable-blink-features=AutomationControlled'],
        )
        print("✅ 启动成功！")
        await asyncio.sleep(2)
        browser.stop()
        return True
    except Exception as e:
        print(f"❌ 失败: {e}")
        return False

async def main():
    print("=" * 60)
    print("nodriver 无头模式调试")
    print("=" * 60)
    
    await test_minimal()
    await test_with_user_data()
    # await test_headless_false()  # 跳过有头模式测试
    
    print("\n" + "=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
