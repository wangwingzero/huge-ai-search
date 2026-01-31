/**
 * 设置浏览器 - 登录并保存认证状态 (npm 版本)
 * 
 * 运行: npx ts-node setup-browser.ts
 * 或: node dist/setup-browser.js
 */

import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Chrome 路径
const CHROME_PATHS: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
  ],
};

function findChrome(): string | undefined {
  const platform = process.platform;
  const paths = CHROME_PATHS[platform] || [];
  
  for (const chromePath of paths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  return undefined;
}

async function setup() {
  const browserDataDir = path.join(process.cwd(), "browser_data");
  const storageStatePath = path.join(browserDataDir, "storage_state.json");
  
  if (!fs.existsSync(browserDataDir)) {
    fs.mkdirSync(browserDataDir, { recursive: true });
  }
  
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("❌ 未找到 Chrome，请先安装 Chrome 浏览器");
    return;
  }
  
  console.log(`Chrome 路径: ${chromePath}`);
  console.log(`状态文件: ${storageStatePath}`);
  console.log("\n启动浏览器...");
  
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-sandbox",
    ],
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  
  const page = await context.newPage();
  
  console.log("打开 Google AI 搜索...");
  await page.goto("https://www.google.com/search?q=hello&udm=50");
  
  console.log("\n" + "=".repeat(60));
  console.log("浏览器已打开！");
  console.log("1. 如果出现验证码，请完成验证");
  console.log("2. 如果需要登录 Google，请登录");
  console.log("3. 完成后关闭浏览器窗口即可");
  console.log("=".repeat(60) + "\n");
  
  // 等待用户关闭浏览器
  try {
    await page.waitForTimeout(300000); // 等待 5 分钟
  } catch {
    // 用户关闭了浏览器
  }
  
  // 保存认证状态
  console.log("保存认证状态...");
  await context.storageState({ path: storageStatePath });
  
  await context.close();
  await browser.close();
  
  console.log(`\n✅ 认证状态已保存到: ${storageStatePath}`);
  console.log("现在可以使用 npm 版本的搜索工具了！");
}

setup().catch(console.error);
