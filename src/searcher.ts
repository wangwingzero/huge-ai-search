/**
 * AI 搜索器 - 核心搜索逻辑
 *
 * 使用 Playwright 抓取 AI 模式搜索结果
 * 完整移植自 Python 版本 google-ai-search-mcp
 */

import {
  chromium,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as net from "net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { initializeLogger, writeLog } from "./logger.js";

initializeLogger();

/**
 * 写入日志文件
 */
function log(level: "INFO" | "ERROR" | "DEBUG" | "CAPTCHA", message: string): void {
  writeLog(level, message, "Searcher");
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResult {
  success: boolean;
  query: string;
  aiAnswer: string;
  sources: SearchSource[];
  error: string;
}

interface FileInputSnapshot {
  total: number;
  imageAcceptInputs: number;
  inputsWithFiles: number;
}

type ImageDriverMode = "playwright" | "nodriver" | "nodriver-only";

interface ImageUploadWaitProfile {
  attachmentReadyMs: number;
  uploadProgressMs: number;
  postUploadSettleMs: number;
  fileSizeMb: number;
  multiplier: number;
}

interface NodriverBridgeResult {
  success: boolean;
  stateSaved: boolean;
  message: string;
}

interface NodriverImageSearchResult {
  success: boolean;
  aiAnswer: string;
  sources: SearchSource[];
  error: string;
  message: string;
}

interface ProcessExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

// AI 模式选择器（2026 年最新）
const AI_SELECTORS = [
  'div[data-subtree="aimc"]', // HUGE AI Mode 核心容器（最新）
  'div[data-attrid="wa:/m/0"]', // 旧版选择器
  '[data-async-type="editableDirectAnswer"]', // AI 回答区域
  ".wDYxhc", // AI 概述容器
  '[data-md="50"]', // AI 模式标记
];

// AI 模式关键词（多语言）
const AI_KEYWORDS = ["AI 模式", "AI Mode", "AI モード"];

// 验证码检测关键词
const CAPTCHA_KEYWORDS = [
  "异常流量",
  "我们的系统检测到",
  "unusual traffic",
  "automated requests",
  "验证您是真人",
  "prove you're not a robot",
  "recaptcha",
];

// AI 加载中关键词
const AI_LOADING_KEYWORDS = [
  "正在思考",
  "正在生成",
  "正在查找",
  "Searching",
  "Thinking",
  "Generating",
  "Loading",
];

// AI 加载指示器选择器
const AI_LOADING_SELECTORS = [
  ".typing-cursor",
  '[data-loading="true"]',
  '.stop-button:not([hidden])',
];

// 追问输入框选择器（按优先级排序）
const FOLLOW_UP_SELECTORS = [
  'div[data-subtree="aimc"] textarea',
  'div[data-subtree="aimc"] input[type="text"]',
  'div[data-subtree="aimc"] [contenteditable="true"]',
  'textarea[placeholder*="follow"]',
  'textarea[placeholder*="追问"]',
  'textarea[placeholder*="提问"]',
  'textarea[placeholder*="Ask"]',
  'textarea[placeholder*="问"]',
  'textarea[placeholder*="anything"]',
  'textarea[aria-label*="follow"]',
  'textarea[aria-label*="追问"]',
  'textarea[aria-label*="问"]',
  'input[placeholder*="follow"]',
  'input[placeholder*="追问"]',
  'input[placeholder*="问"]',
  'input[placeholder*="anything"]',
  'div[contenteditable="true"][aria-label*="follow"]',
  'div[contenteditable="true"][aria-label*="追问"]',
  'div[contenteditable="true"][aria-label*="问"]',
  'textarea[name="q"]',
  'textarea:not([name="q"])',
  'div[contenteditable="true"]',
];

const PROMPT_INPUT_SELECTORS = [
  'div[data-subtree="aimc"] textarea',
  'div[data-subtree="aimc"] input[name="q"]',
  'div[data-subtree="aimc"] input[type="text"]',
  'div[data-subtree="aimc"] [role="textbox"]',
  'div[data-subtree="aimc"] [contenteditable="true"]',
  'div[data-subtree="aimc"] [contenteditable]:not([contenteditable="false"])',
  'textarea[name="q"]',
  'textarea[aria-label*="Search"]',
  'textarea[aria-label*="搜索"]',
  'textarea[aria-label*="Ask"]',
  'textarea[aria-label*="问"]',
  'textarea[placeholder*="Ask"]',
  'textarea[placeholder*="搜索"]',
  'textarea[placeholder*="提问"]',
  'textarea[placeholder*="问"]',
  'textarea[placeholder*="anything"]',
  'input[name="q"]',
  'input[aria-label*="Search"]',
  'input[aria-label*="搜索"]',
  'input[aria-label*="问"]',
  'input[placeholder*="问"]',
  '[role="textbox"]',
  '[contenteditable]:not([contenteditable="false"])',
  'textarea',
  'input[type="text"]',
];

const PROMPT_SUBMIT_BUTTON_SELECTORS = [
  'button[aria-label*="发送"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="submit"]',
  'button[aria-label*="提交"]',
  '[role="button"][aria-label*="发送"]',
  '[role="button"][aria-label*="Send"]',
  '[role="button"][aria-label*="submit"]',
  '[role="button"][aria-label*="提交"]',
  'button:has-text("发送")',
  'button:has-text("Send")',
  '[role="button"]:has-text("发送")',
  '[role="button"]:has-text("Send")',
  'button[type="submit"]',
];

const IMAGE_PROMPT_SEND_BUTTON_SELECTORS = [
  'button[aria-label*="发送"]',
  '[role="button"][aria-label*="发送"]',
  'button[aria-label*="Send"]',
  '[role="button"][aria-label*="Send"]',
  'button[aria-label*="submit"]',
  '[role="button"][aria-label*="submit"]',
  'button[aria-label*="提交"]',
  '[role="button"][aria-label*="提交"]',
  'button:has-text("发送")',
  '[role="button"]:has-text("发送")',
  'button:has-text("Send")',
  '[role="button"]:has-text("Send")',
];

const IMAGE_UPLOAD_MENU_TRIGGER_SELECTORS = [
  'button[aria-label*="更多输入项"]',
  'button[aria-label*="更多输入"]',
  'button[aria-label*="More input"]',
  'button[aria-label*="input options"]',
  '[role="button"][aria-label*="更多输入项"]',
  '[role="button"][aria-label*="More input"]',
];

const IMAGE_UPLOAD_OPTION_SELECTORS = [
  'button[aria-label*="上传图片"]',
  '[role="button"][aria-label*="上传图片"]',
  'button[aria-label*="上传"]',
  '[role="button"][aria-label*="上传"]',
  'button[aria-label*="图片"]',
  '[role="button"][aria-label*="图片"]',
  'button[aria-label*="图像"]',
  '[role="button"][aria-label*="图像"]',
  'button[aria-label*="image"]',
  '[role="button"][aria-label*="image"]',
  'button[aria-label*="Image"]',
  '[role="button"][aria-label*="Image"]',
  'button[aria-label*="photo"]',
  'button[aria-label*="Photo"]',
  'button[aria-label*="Lens"]',
  '[role="button"][aria-label*="Lens"]',
  '[role="menu"] button[aria-label*="上传"]',
  '[role="menu"] button[aria-label*="image"]',
  '[role="menu"] [role="button"][aria-label*="上传"]',
];

const IMAGE_FILE_INPUT_SELECTORS = [
  'div[data-subtree="aimc"] input[type="file"][accept*="image"]',
  'div[data-subtree="aimc"] input[type="file"]',
  'input[type="file"][accept*="image"]',
  'input[type="file"][accept*="png"]',
  'input[type="file"]',
];

const IMAGE_ATTACHMENT_READY_SELECTORS = [
  'div[data-subtree="aimc"] img[src^="blob:"]',
  'div[data-subtree="aimc"] button[aria-label*="移除"]',
  'div[data-subtree="aimc"] button[aria-label*="删除"]',
  'div[data-subtree="aimc"] button[aria-label*="Remove"]',
  'div[data-subtree="aimc"] [role="button"][aria-label*="移除"]',
  'div[data-subtree="aimc"] [role="button"][aria-label*="Remove"]',
];

const SUBMIT_BUTTON_HINTS = [
  "send",
  "submit",
  "发送",
  "提交",
  "ask",
  "提问",
  "询问",
  "follow",
];

const SUBMIT_BUTTON_EXCLUDE_HINTS = [
  "开始新的搜索",
  "new search",
  "重新搜索",
  "clear",
  "重置",
  "删除",
  "移除",
  "关闭",
  "上传",
  "更多输入",
];

const IMAGE_ONLY_PROMPT_BY_LANGUAGE: Record<string, string> = {
  "zh-CN": "请识别并总结这张截图中的关键信息。",
  "en-US": "Please identify and summarize the key information in this screenshot.",
  "ja-JP": "このスクリーンショットの重要な情報を要約してください。",
  "ko-KR": "이 스크린샷의 핵심 정보를 식별하고 요약해 주세요.",
  "de-DE": "Bitte identifiziere und fasse die wichtigsten Informationen in diesem Screenshot zusammen.",
  "fr-FR": "Veuillez identifier et résumer les informations clés de cette capture d'écran.",
};

const DEFAULT_AI_GREETING_PATTERNS = [
  "想聊点什么",
  "您好！想聊点什么",
  "您好!想聊点什么",
  "what would you like to talk about",
  "what can i help with",
  "how can i help",
  "what's on your mind",
];

// 需要拦截的资源类型
const BLOCKED_RESOURCE_TYPES = ["image", "font", "media"];

// 需要拦截的 URL 模式（广告、追踪等）
const BLOCKED_URL_PATTERNS = [
  "googleadservices.com",
  "googlesyndication.com",
  "doubleclick.net",
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.com/tr",
  "connect.facebook.net",
];

// 会话超时时间（秒）
const SESSION_TIMEOUT = 300; // 5 分钟
const NODRIVER_DEFAULT_WAIT_SECONDS = 300;
const NODRIVER_SCRIPT_FILE_NAME = "nodriver_auth_bridge.py";
const NODRIVER_LOGIN_URL = "https://www.google.com/search?q=hello&udm=50";
const NODRIVER_IMAGE_SEARCH_SCRIPT_FILE_NAME = "nodriver_image_search_bridge_v2.py";
const NODRIVER_IMAGE_SEARCH_TIMEOUT_SECONDS = 70;
const NODRIVER_IMAGE_SEARCH_HEADLESS_DEFAULT = true;
const NODRIVER_IMAGE_FAST_ATTEMPT_TIMEOUT_SECONDS = 28;
const IMAGE_UPLOAD_ATTACHMENT_READY_BASE_MS = 8000;
const IMAGE_UPLOAD_PROGRESS_BASE_MS = 12000;
const IMAGE_UPLOAD_SETTLE_BASE_MS = 1800;
const IMAGE_UPLOAD_MAX_ATTACHMENT_READY_MS = 30000;
const IMAGE_UPLOAD_MAX_PROGRESS_MS = 50000;
const IMAGE_UPLOAD_MAX_SETTLE_MS = 6000;

const NODRIVER_IMAGE_SEARCH_BRIDGE_SCRIPT = String.raw`#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

CAPTCHA_KEYWORDS = [
    "unusual traffic",
    "automated requests",
    "sorry/index",
    "recaptcha",
    "验证您是真人",
    "我们的系统检测到",
]

PLACEHOLDER_PATTERNS = [
    "想聊点什么",
    "what would you like to talk about",
    "what can i help with",
    "how can i help",
]

FILE_INPUT_SELECTORS = [
    'div[data-subtree="aimc"] input[type="file"][accept*="image"]',
    'div[data-subtree="aimc"] input[type="file"]',
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*="png"]',
    'input[type="file"]',
]

UPLOAD_MENU_SELECTORS = [
    'button[aria-label*="更多输入项"]',
    'button[aria-label*="更多输入"]',
    'button[aria-label*="More input"]',
    '[role="button"][aria-label*="更多输入项"]',
    '[role="button"][aria-label*="More input"]',
]

PROMPT_SELECTORS = [
    'div[data-subtree="aimc"] textarea',
    'div[data-subtree="aimc"] input[name="q"]',
    'div[data-subtree="aimc"] input[type="text"]',
    'div[data-subtree="aimc"] [role="textbox"]',
    'div[data-subtree="aimc"] [contenteditable="true"]',
    'div[data-subtree="aimc"] [contenteditable]:not([contenteditable="false"])',
    'textarea[name="q"]',
    'textarea[aria-label*="Search"]',
    'textarea[aria-label*="Ask"]',
    'textarea[aria-label*="问"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="提问"]',
    'textarea[placeholder*="问"]',
    'input[name="q"]',
    'input[type="text"]',
    '[role="textbox"]',
    '[contenteditable]:not([contenteditable="false"])',
    'textarea',
]

SEND_BUTTON_SELECTORS = [
    'button[aria-label*="发送"]',
    '[role="button"][aria-label*="发送"]',
    'button[aria-label*="Send"]',
    '[role="button"][aria-label*="Send"]',
    'button[aria-label*="submit"]',
    '[role="button"][aria-label*="submit"]',
    'button[aria-label*="提交"]',
    '[role="button"][aria-label*="提交"]',
    'button:has-text("发送")',
    '[role="button"]:has-text("发送")',
    'button:has-text("Send")',
    '[role="button"]:has-text("Send")',
]

EXTRACT_JS = """
(() => {
  function isGoogleHost(hostname) {
    const host = (hostname || "").toLowerCase();
    return host.includes("google.") || host.includes("gstatic.com") || host.includes("googleapis.com");
  }

  function normalizeLink(rawHref) {
    if (!rawHref) return "";
    try {
      const parsed = new URL(rawHref);
      if (!["http:", "https:"].includes(parsed.protocol)) return "";

      if (isGoogleHost(parsed.hostname)) {
        const redirected = parsed.searchParams.get("url") || parsed.searchParams.get("q") || "";
        if (!redirected) return "";
        const target = new URL(redirected);
        if (!["http:", "https:"].includes(target.protocol)) return "";
        if (isGoogleHost(target.hostname)) return "";
        return target.href;
      }
      return parsed.href;
    } catch {
      return "";
    }
  }

  const candidates = [
    document.querySelector("div[data-subtree='aimc']"),
    document.querySelector("div[data-attrid='wa:/m/0']"),
    document.querySelector("[data-async-type='editableDirectAnswer']"),
    document.querySelector(".wDYxhc"),
  ].filter(Boolean);

  let container = candidates.length ? candidates[0] : null;
  let answer = "";
  for (const node of candidates) {
    const text = ((node && (node.innerText || node.textContent)) || "").trim();
    if (text.length > answer.length) {
      answer = text;
      container = node;
    }
  }

  if (!answer) {
    answer = ((document.body && document.body.innerText) || "").trim();
  }

  const seen = new Set();
  const sources = [];
  if (container) {
    const anchors = container.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      const normalized = normalizeLink(anchor.href);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      let title = (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || "").trim();
      if (!title) title = normalized;
      const card = anchor.closest("div,li,article,section");
      const snippetRaw = (card && (card.innerText || card.textContent)) || "";
      const snippet = snippetRaw.trim().slice(0, 220);
      sources.push({ title, url: normalized, snippet });
      if (sources.length >= 8) break;
    }
  }

  const bodyLower = ((document.body && document.body.innerText) || "").toLowerCase();
  const blocked =
    (location.href || "").toLowerCase().includes("sorry/index") ||
    bodyLower.includes("unusual traffic") ||
    bodyLower.includes("automated requests") ||
    bodyLower.includes("验证您是真人") ||
    bodyLower.includes("我们的系统检测到") ||
    bodyLower.includes("recaptcha");

  return {
    answer,
    sources,
    blocked,
    url: location.href || "",
  };
})()
"""

cdp_input = None


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def should_ignore_answer(answer: str, baseline: str) -> bool:
    text = (answer or "").strip()
    if not text:
        return True
    if baseline and text == baseline.strip():
        return True
    lower = text.lower()
    if len(text) <= 64 and any(pattern in lower for pattern in PLACEHOLDER_PATTERNS):
        return True
    return False


def normalize_sources(raw_sources):
    normalized = []
    seen = set()
    for source in raw_sources or []:
        if not isinstance(source, dict):
            continue
        url = str(source.get("url") or "").strip()
        if not url:
            continue
        parsed = None
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                continue
        except Exception:
            continue

        host = (parsed.hostname or "").lower()
        if host.endswith("google.com") or host.endswith("googleusercontent.com"):
            q = parse_qs(parsed.query)
            redirected = (q.get("url") or q.get("q") or [""])[0]
            if redirected:
                try:
                    redirect_parsed = urlparse(redirected)
                    if redirect_parsed.scheme in ("http", "https"):
                        url = redirected
                        host = (redirect_parsed.hostname or "").lower()
                except Exception:
                    pass

        if not url or url in seen:
            continue
        seen.add(url)
        title = str(source.get("title") or "").strip() or url
        snippet = str(source.get("snippet") or "").strip()
        normalized.append({"title": title, "url": url, "snippet": snippet})
        if len(normalized) >= 8:
            break
    return normalized


async def evaluate_extract(tab):
    try:
        result = await tab.evaluate(EXTRACT_JS, return_by_value=True)
    except TypeError:
        result = await tab.evaluate(EXTRACT_JS)
    except Exception:
        return {"answer": "", "sources": [], "blocked": False, "url": ""}

    if isinstance(result, tuple):
        remote = result[0] if result else None
        if isinstance(remote, dict):
            result = remote
        else:
            return {"answer": "", "sources": [], "blocked": False, "url": ""}

    if not isinstance(result, dict):
        return {"answer": "", "sources": [], "blocked": False, "url": ""}

    return {
        "answer": str(result.get("answer") or "").strip(),
        "sources": normalize_sources(result.get("sources") or []),
        "blocked": bool(result.get("blocked")),
        "url": str(result.get("url") or ""),
    }


async def find_first(tab, selectors, timeout=1.4):
    for selector in selectors:
        try:
            element = await tab.select(selector, timeout=timeout)
            if element:
                return element
        except Exception:
            continue
    return None


async def click_first(tab, selectors, timeout=1.0):
    element = await find_first(tab, selectors, timeout=timeout)
    if not element:
        return False
    for method_name in ("mouse_click", "click", "click_mouse"):
        method = getattr(element, method_name, None)
        if method is None:
            continue
        try:
            await method()
            return True
        except Exception:
            continue
    return False


async def click_upload_menu_button(tab, timeout=1.2):
    if await click_first(tab, UPLOAD_MENU_SELECTORS, timeout=timeout):
        return True

    expression = """
(() => {
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }
  function labelOf(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      ""
    ).trim().toLowerCase();
  }

  const includeHints = ["上传", "image", "photo", "upload", "file", "attach", "附件", "图片", "添加", "add", "plus"];
  const excludeHints = ["send", "submit", "发送", "提交", "voice", "mic", "语音", "remove", "删除", "移除", "close", "关闭"];

  const root = document.querySelector("div[data-subtree='aimc']") || document;
  const scopes = root === document ? [document] : [root, document];
  const buttons = [];
  for (const scope of scopes) {
    for (const btn of Array.from(scope.querySelectorAll("button, [role='button']"))) {
      if (btn && !buttons.includes(btn)) {
        buttons.push(btn);
      }
    }
  }
  const clickable = buttons.filter((btn) => isVisible(btn) && isEnabled(btn));

  let target = clickable.find((btn) => {
    const label = labelOf(btn);
    if (!label) return false;
    if (excludeHints.some((hint) => label.includes(hint))) return false;
    return includeHints.some((hint) => label.includes(hint));
  });

  if (!target) {
    const iconButtons = clickable.filter((btn) => {
      const label = labelOf(btn);
      if (excludeHints.some((hint) => label.includes(hint))) return false;
      const hasSvg = !!btn.querySelector("svg");
      const hasText = (btn.innerText || "").trim().length > 0;
      return hasSvg && !hasText;
    });
    if (iconButtons.length) {
      iconButtons.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const sa = ra.bottom * 3 - ra.left;
        const sb = rb.bottom * 3 - rb.left;
        return sb - sa;
      });
      target = iconButtons[0];
    }
  }

  if (!target) return false;
  try {
    target.click();
    return true;
  } catch (_) {
    return false;
  }
})()
"""

    try:
        clicked = await tab.evaluate(expression, return_by_value=True)
    except TypeError:
        clicked = await tab.evaluate(expression)
    except Exception:
        return False
    if isinstance(clicked, tuple):
        clicked = clicked[0] if clicked else False
    return bool(clicked)


async def try_send_file(tab, file_path: str):
    for selector in FILE_INPUT_SELECTORS:
        try:
            elements = await tab.select_all(selector, timeout=0.9)
        except Exception:
            continue
        for element in elements or []:
            try:
                await element.send_file(file_path)
                await asyncio.sleep(0.8)
                return True
            except Exception:
                continue
    return False


async def verify_image_attached(tab, max_wait: float = 8.0) -> bool:
    """验证图片是否真正附加成功（检测 blob 预览或移除按钮）"""
    expression = """
(() => {
  const root = document.querySelector("div[data-subtree='aimc']") || document;
  const blobImg = root.querySelector("img[src^='blob:']");
  if (blobImg) return "blob";
  const removeBtn = root.querySelector("button[aria-label*='移除'], button[aria-label*='Remove'], button[aria-label*='remove']");
  if (removeBtn) return "remove";
  const fileInputs = root.querySelectorAll("input[type='file']");
  for (const input of fileInputs) {
    if (input.files && input.files.length > 0) return "files";
  }
  return "";
})()
"""
    deadline = time.monotonic() + max_wait
    while time.monotonic() < deadline:
        try:
            result = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            result = await tab.evaluate(expression)
        except Exception:
            result = ""
        if isinstance(result, tuple):
            result = result[0] if result else ""
        if result:
            return True
        await asyncio.sleep(0.5)
    return False


async def upload_image(tab, image_path: str):
    for attempt in range(4):
        if await try_send_file(tab, image_path):
            if await verify_image_attached(tab, max_wait=10.0):
                return True
            # 文件发送了但未附加成功，等一下再重试
            print(f"attempt {attempt+1}: send_file ok but attachment not verified, retrying", file=sys.stderr)

        await click_upload_menu_button(tab, timeout=1.5)
        await asyncio.sleep(0.4)

        if await try_send_file(tab, image_path):
            if await verify_image_attached(tab, max_wait=10.0):
                return True
            print(f"attempt {attempt+1}: send_file after menu ok but attachment not verified, retrying", file=sys.stderr)

        # 重试间隔递增，给网络恢复时间
        if attempt < 3:
            await asyncio.sleep(0.5 + attempt * 0.5)

    return False


async def submit_prompt(tab, prompt: str):
    async def collect_submit_diagnostics():
        expression = """
(() => {
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }
  function shortText(el) {
    if (!el) return "";
    const text = (
      el.getAttribute?.("aria-label") ||
      el.getAttribute?.("placeholder") ||
      el.getAttribute?.("title") ||
      el.innerText ||
      el.textContent ||
      ""
    ).trim();
    return text.slice(0, 60);
  }

  const root = document.querySelector("div[data-subtree='aimc']");
  const scopes = root ? [root, document] : [document];
  const inputSelectors = [
    "textarea",
    "input[type='text']",
    "input[name='q']",
    "[contenteditable]",
    "[role='textbox']",
  ];
  const buttonSelectors = [
    "button[aria-label*='发送']",
    "button[aria-label*='Send']",
    "button[aria-label*='提交']",
    "button, [role='button']",
  ];

  const inputStats = inputSelectors.map((selector) => {
    const all = [];
    for (const scope of scopes) {
      for (const node of Array.from(scope.querySelectorAll(selector))) {
        if (node && !all.includes(node)) all.push(node);
      }
    }
    const visible = all.filter((el) => isVisible(el));
    const enabled = visible.filter((el) => isEnabled(el));
    return {
      selector,
      total: all.length,
      visible: visible.length,
      enabled: enabled.length,
      sample: enabled.slice(0, 2).map((el) => shortText(el)),
    };
  });

  const buttonStats = buttonSelectors.map((selector) => {
    const all = [];
    for (const scope of scopes) {
      for (const node of Array.from(scope.querySelectorAll(selector))) {
        if (node && !all.includes(node)) all.push(node);
      }
    }
    const visible = all.filter((el) => isVisible(el));
    const enabled = visible.filter((el) => isEnabled(el));
    return {
      selector,
      total: all.length,
      visible: visible.length,
      enabled: enabled.length,
      sample: enabled.slice(0, 3).map((el) => shortText(el)),
    };
  });

  return JSON.stringify({
    url: location.href || "",
    rootFound: !!root,
    inputStats,
    buttonStats,
  });
})()
"""
        try:
            diag = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            diag = await tab.evaluate(expression)
        except Exception:
            return {"error": "collect_diag_eval_failed"}
        if isinstance(diag, tuple):
            diag = diag[0] if diag else None
        if isinstance(diag, str):
            try:
                parsed = json.loads(diag)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return {"raw": diag[:300]}
        if isinstance(diag, dict):
            return diag
        return {"error": "collect_diag_invalid_result"}

    async def is_prompt_still_pending() -> bool:
        escaped_prompt = json.dumps((prompt or "").strip())
        expression = f"""
(() => {{
  const prompt = {escaped_prompt};
  if (!prompt) return false;
  function isVisible(el) {{
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }}
  function textOf(el) {{
    if (!el) return "";
    if (el.isContentEditable) {{
      return (el.innerText || el.textContent || "").trim();
    }}
    return (el.value || el.textContent || "").trim();
  }}

  const root = document.querySelector("div[data-subtree='aimc']") || document;
  const scopes = root === document ? [document] : [root, document];
  const inputs = [];
  for (const scope of scopes) {{
    const found = Array.from(
      scope.querySelectorAll(
        "textarea, input[type='text'], input[name='q'], [contenteditable], [role='textbox']"
      )
    );
    for (const item of found) {{
      if (item && !inputs.includes(item)) {{
        inputs.push(item);
      }}
    }}
  }}
  const visibleInputs = inputs.filter((input) => isVisible(input));
  if (!visibleInputs.length) return "__UNKNOWN__";

  return visibleInputs.some((input) => {{
    const value = textOf(input);
    return value.includes(prompt);
  }});
}})()
"""
        try:
            pending = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            pending = await tab.evaluate(expression)
        except Exception:
            return True
        if isinstance(pending, tuple):
            pending = pending[0] if pending else False
        if isinstance(pending, str) and pending == "__UNKNOWN__":
            return True
        return bool(pending)

    async def is_prompt_reflected_in_url() -> bool:
        escaped_prompt = json.dumps((prompt or "").strip())
        expression = f"""
(() => {{
  const prompt = {escaped_prompt};
  if (!prompt) return false;
  const href = location.href || "";
  if (!href) return false;
  try {{
    const parsed = new URL(href);
    const q = (parsed.searchParams.get("q") || "").trim();
    if (q && (q.includes(prompt) || prompt.includes(q))) {{
      return true;
    }}
  }} catch (_){{
    // ignore
  }}
  try {{
    return decodeURIComponent(href).includes(prompt);
  }} catch (_){{
    return href.includes(prompt);
  }}
}})()
"""
        try:
            reflected = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            reflected = await tab.evaluate(expression)
        except Exception:
            return False
        if isinstance(reflected, tuple):
            reflected = reflected[0] if reflected else False
        return bool(reflected)

    async def is_send_button_ready() -> bool:
        expression = """
(() => {
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }
  function labelOf(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      ""
    ).trim().toLowerCase();
  }
  const includeHints = ["send", "submit", "发送", "提交", "ask", "提问", "询问"];
  const excludeHints = ["上传", "image", "photo", "mic", "voice", "语音", "更多输入", "add", "plus", "remove", "删除", "移除"];
  const root = document.querySelector("div[data-subtree='aimc']") || document;
  const buttons = Array.from(root.querySelectorAll("button, [role='button']"))
    .filter((el) => isVisible(el) && isEnabled(el));
  if (!buttons.length) return false;
  const labeled = buttons.find((btn) => {
    const label = labelOf(btn);
    if (!label) return false;
    if (excludeHints.some((hint) => label.includes(hint))) return false;
    return includeHints.some((hint) => label.includes(hint));
  });
  if (labeled) return true;
  const iconButtons = buttons.filter((btn) => {
    const label = labelOf(btn);
    if (excludeHints.some((hint) => label.includes(hint))) return false;
    const hasSvg = !!btn.querySelector("svg");
    const hasText = (btn.innerText || "").trim().length > 0;
    return hasSvg && !hasText;
  });
  return iconButtons.length > 0;
})()
"""
        try:
            ready = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            ready = await tab.evaluate(expression)
        except Exception:
            return False
        if isinstance(ready, tuple):
            ready = ready[0] if ready else False
        return bool(ready)

    async def has_submission_signal() -> bool:
        if await is_prompt_still_pending():
            return False
        if await is_send_button_ready():
            return False
        return True

    async def is_upload_busy() -> bool:
        expression = """
(() => {
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  const root = document.querySelector("div[data-subtree='aimc']") || document;
  const busySelectors = [
    "[aria-busy='true']",
    "[role='progressbar']",
    "progress",
    ".progress",
    ".loading",
    ".spinner",
  ];
  for (const selector of busySelectors) {
    const nodes = Array.from(root.querySelectorAll(selector)).filter((el) => isVisible(el));
    if (nodes.length > 0) return true;
  }

  const textNodes = Array.from(root.querySelectorAll("div,span,p,small"))
    .filter((el) => isVisible(el))
    .slice(0, 240);
  const busyHints = [
    "正在上传",
    "上传中",
    "uploading",
    "upload in progress",
    "processing image",
    "analyzing image",
    "正在分析",
    "处理中",
  ];
  for (const node of textNodes) {
    const text = (node.innerText || node.textContent || "").trim().toLowerCase();
    if (!text || text.length > 120) continue;
    if (busyHints.some((hint) => text.includes(hint))) {
      return true;
    }
  }
  return false;
})()
"""
        try:
            busy = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            busy = await tab.evaluate(expression)
        except Exception:
            return False
        if isinstance(busy, tuple):
            busy = busy[0] if busy else False
        return bool(busy)

    async def wait_until_upload_ready(max_wait_seconds: float = 18.0) -> bool:
        deadline = time.monotonic() + max(2.0, max_wait_seconds)
        clear_rounds = 0
        while time.monotonic() < deadline:
            if await is_upload_busy():
                clear_rounds = 0
            else:
                clear_rounds += 1
                if clear_rounds >= 2:
                    return True
            await asyncio.sleep(0.35)
        return False

    async def click_send_button() -> bool:
        if await click_first(tab, SEND_BUTTON_SELECTORS, timeout=0.9):
            return True

        expression = """
(() => {
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    return false;
  }
  function buttonLabel(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      ""
    ).trim().toLowerCase();
  }

  const root = document.querySelector("div[data-subtree='aimc']") || document;
  const buttons = Array.from(root.querySelectorAll("button, [role='button']"))
    .filter((el) => isVisible(el) && !isDisabled(el));
  if (!buttons.length) return false;

  const includeHints = ["send", "submit", "发送", "提交", "ask", "提问", "询问"];
  const excludeHints = ["上传", "image", "photo", "mic", "voice", "语音", "更多输入", "add", "plus", "remove", "删除", "移除"];

  let target = buttons.find((btn) => {
    const label = buttonLabel(btn);
    if (!label) return false;
    if (excludeHints.some((hint) => label.includes(hint))) return false;
    return includeHints.some((hint) => label.includes(hint));
  });

  if (!target) {
    function scoreIconButton(btn) {
      const rect = btn.getBoundingClientRect();
      const bg = window.getComputedStyle(btn).backgroundColor || "";
      const isTransparent = bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
      return rect.right + rect.bottom + (isTransparent ? 0 : 5000);
    }
    const iconButtons = buttons.filter((btn) => {
      const label = buttonLabel(btn);
      if (excludeHints.some((hint) => label.includes(hint))) return false;
      const hasSvg = !!btn.querySelector("svg");
      const hasText = (btn.innerText || "").trim().length > 0;
      return hasSvg && !hasText;
    });
    if (iconButtons.length) {
      iconButtons.sort((a, b) => {
        return scoreIconButton(b) - scoreIconButton(a);
      });
      target = iconButtons[0];
    }
  }

  if (!target) return false;
  try {
    const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of eventTypes) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    target.click();
  } catch (_) {
    try {
      target.click();
    } catch (__){}
  }
  return true;
})()
"""
        try:
            clicked = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            clicked = await tab.evaluate(expression)
        except Exception:
            return False
        if isinstance(clicked, tuple):
            clicked = clicked[0] if clicked else False
        return bool(clicked)

    async def press_enter_via_cdp() -> bool:
        if cdp_input is None:
            return False
        try:
            await tab.send(
                cdp_input.dispatch_key_event(
                    "rawKeyDown",
                    key="Enter",
                    code="Enter",
                    windows_virtual_key_code=13,
                    native_virtual_key_code=13,
                )
            )
            await tab.send(
                cdp_input.dispatch_key_event(
                    "keyDown",
                    key="Enter",
                    code="Enter",
                    text="\\r",
                    unmodified_text="\\r",
                    windows_virtual_key_code=13,
                    native_virtual_key_code=13,
                )
            )
            await tab.send(
                cdp_input.dispatch_key_event(
                    "keyUp",
                    key="Enter",
                    code="Enter",
                    windows_virtual_key_code=13,
                    native_virtual_key_code=13,
                )
            )
            return True
        except Exception:
            return False

    async def run_submit_retries(max_wait_seconds: float = 14.0) -> bool:
        deadline = time.monotonic() + max(3.0, max_wait_seconds)
        while time.monotonic() < deadline:
            if await has_submission_signal():
                return True
            if await is_upload_busy():
                await asyncio.sleep(0.35)
                continue
            await press_enter_via_cdp()
            await click_send_button()
            await asyncio.sleep(0.45)
            if await has_submission_signal():
                return True
        return False

    async def submit_prompt_via_js() -> bool:
        escaped_prompt = json.dumps((prompt or "").strip())
        expression = f"""
(() => {{
  const prompt = {escaped_prompt};
  if (!prompt) return false;

  function isVisible(el) {{
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }}
  function isEnabled(el) {{
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }}
  function textOf(el) {{
    if (!el) return "";
    if (el.isContentEditable) {{
      return (el.innerText || el.textContent || "").trim();
    }}
    return (el.value || el.textContent || "").trim();
  }}
  function setText(el, value) {{
    if (!el) return;
    if (el.isContentEditable) {{
      el.innerText = value;
      el.dispatchEvent(new InputEvent("input", {{ bubbles: true, data: value, inputType: "insertText" }}));
      return;
    }}
    if ("value" in el) {{
      el.value = value;
      el.dispatchEvent(new Event("input", {{ bubbles: true }}));
      el.dispatchEvent(new Event("change", {{ bubbles: true }}));
      return;
    }}
    el.textContent = value;
    el.dispatchEvent(new Event("input", {{ bubbles: true }}));
  }}
  function pickSendButton(root) {{
    const includeHints = ["send", "submit", "发送", "提交", "ask", "提问", "询问"];
    const excludeHints = ["上传", "image", "photo", "mic", "voice", "语音", "更多输入", "add", "plus", "remove", "删除", "移除"];

    function labelOf(el) {{
      return (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.innerText ||
        el.textContent ||
        ""
      ).trim().toLowerCase();
    }}

    const scopes = root === document ? [document] : [root, document];
    const allButtons = [];
    for (const scope of scopes) {{
      const found = Array.from(scope.querySelectorAll("button, [role='button']"));
      for (const btn of found) {{
        if (btn && !allButtons.includes(btn)) {{
          allButtons.push(btn);
        }}
      }}
    }}
    const buttons = allButtons.filter((el) => isVisible(el) && isEnabled(el));
    if (!buttons.length) return null;

    let target = buttons.find((btn) => {{
      const label = labelOf(btn);
      if (!label) return false;
      if (excludeHints.some((hint) => label.includes(hint))) return false;
      return includeHints.some((hint) => label.includes(hint));
    }});
    if (target) return target;

    const iconButtons = buttons.filter((btn) => {{
      const label = labelOf(btn);
      if (excludeHints.some((hint) => label.includes(hint))) return false;
      const hasSvg = !!btn.querySelector("svg");
      const hasText = (btn.innerText || "").trim().length > 0;
      return hasSvg && !hasText;
    }});
    if (!iconButtons.length) return null;

    iconButtons.sort((a, b) => {{
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const bga = window.getComputedStyle(a).backgroundColor || "";
      const bgb = window.getComputedStyle(b).backgroundColor || "";
      const oa = (bga === "rgba(0, 0, 0, 0)" || bga === "transparent") ? 0 : 5000;
      const ob = (bgb === "rgba(0, 0, 0, 0)" || bgb === "transparent") ? 0 : 5000;
      return (ob + rb.right + rb.bottom) - (oa + ra.right + ra.bottom);
    }});
    return iconButtons[0];
  }}

  const root = document.querySelector("div[data-subtree='aimc']") || document;
  const scopes = root === document ? [document] : [root, document];
  const allInputs = [];
  for (const scope of scopes) {{
    const found = Array.from(
      scope.querySelectorAll(
        "textarea, input[type='text'], input[name='q'], [contenteditable], [role='textbox']"
      )
    );
    for (const item of found) {{
      if (item && !allInputs.includes(item)) {{
        allInputs.push(item);
      }}
    }}
  }}
  const inputs = allInputs.filter((el) => isVisible(el) && isEnabled(el));
  if (!inputs.length) return false;

    inputs.sort((a, b) => {{
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const aInAi = a.closest("div[data-subtree='aimc']") ? 10000 : 0;
      const bInAi = b.closest("div[data-subtree='aimc']") ? 10000 : 0;
      return (bInAi + rb.top) - (aInAi + ra.top);
  }});

  const input = inputs[0];
  input.focus();
  setText(input, prompt);
  if (!textOf(input).includes(prompt)) return false;

  const evt = {{ key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }};
  input.dispatchEvent(new KeyboardEvent("keydown", evt));
  input.dispatchEvent(new KeyboardEvent("keypress", evt));
  input.dispatchEvent(new KeyboardEvent("keyup", evt));

  let clickedButton = false;
  const sendButton = pickSendButton(root);
  if (sendButton) {{
    try {{
      const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
      for (const type of eventTypes) {{
        sendButton.dispatchEvent(new MouseEvent(type, {{ bubbles: true, cancelable: true, view: window }}));
      }}
      sendButton.click();
    }} catch (_) {{
      try {{
        sendButton.click();
      }} catch (__){{}}
    }}
    clickedButton = true;
  }}

  return clickedButton || !textOf(input).includes(prompt);
}})()
"""
        try:
            submitted = await tab.evaluate(expression, return_by_value=True)
        except TypeError:
            submitted = await tab.evaluate(expression)
        except Exception:
            return False

        if isinstance(submitted, tuple):
            submitted = submitted[0] if submitted else False
        return bool(submitted)

    await wait_until_upload_ready(max_wait_seconds=20.0)
    if await submit_prompt_via_js():
        await asyncio.sleep(0.45)
        if await run_submit_retries(max_wait_seconds=12.0):
            return True, {}

    for selector in PROMPT_SELECTORS:
        try:
            element = await tab.select(selector, timeout=1.3)
        except Exception:
            continue
        if not element:
            continue
        try:
            try:
                await element.click()
            except Exception:
                pass
            await asyncio.sleep(0.15)
            try:
                await element.clear_input()
            except Exception:
                pass
            await element.send_keys(prompt)
            await asyncio.sleep(0.2)
            await element.send_keys("\n")
            await asyncio.sleep(0.25)
            await wait_until_upload_ready(max_wait_seconds=16.0)
            if await run_submit_retries(max_wait_seconds=16.0):
                return True, {}

            # 同一输入框再做一次 JS 强制发送兜底，避免因为键盘事件未触发而卡住
            if await submit_prompt_via_js():
                await asyncio.sleep(0.45)
                if await run_submit_retries(max_wait_seconds=12.0):
                    return True, {}

            # 仍然停留在输入框，尝试下一个候选输入控件
            continue
        except Exception:
            continue

    # CSS 选择器找不到可用输入框时，使用 JS 直接填充并触发发送
    await wait_until_upload_ready(max_wait_seconds=16.0)
    if await submit_prompt_via_js():
        await asyncio.sleep(0.45)
        if await run_submit_retries(max_wait_seconds=16.0):
            return True, {}

    return False, await collect_submit_diagnostics()


async def wait_for_answer(tab, baseline: str, timeout_seconds: int):
    deadline = time.monotonic() + timeout_seconds
    latest = {"answer": "", "sources": [], "blocked": False, "url": ""}

    while time.monotonic() < deadline:
        current = await evaluate_extract(tab)
        if current:
            latest = current

        answer = str(latest.get("answer") or "").strip()
        if answer and not should_ignore_answer(answer, baseline):
            return True, latest
        await asyncio.sleep(1.2)

    return False, latest


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--language", default="zh-CN")
    parser.add_argument("--image-path", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=85)
    parser.add_argument("--proxy", default="")
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args()

    image_path = str(Path(args.image_path).resolve())
    if not os.path.exists(image_path):
        emit(
            {
                "success": False,
                "ai_answer": "",
                "sources": [],
                "error": f"图片文件不存在: {image_path}",
                "message": "image file missing",
            }
        )
        return 1

    try:
        import nodriver as uc
    except Exception as exc:
        emit(
            {
                "success": False,
                "ai_answer": "",
                "sources": [],
                "error": f"nodriver import failed: {exc}",
                "message": "nodriver import failed",
            }
        )
        return 2
    global cdp_input
    try:
        import nodriver.cdp.input_ as cdp_input  # type: ignore
    except Exception:
        cdp_input = None

    user_data_dir = Path.home() / ".huge-ai-search" / "nodriver_profile"
    user_data_dir.mkdir(parents=True, exist_ok=True)
    is_ci = bool(os.environ.get("CI")) or bool(os.environ.get("GITHUB_ACTIONS"))
    is_root = bool(hasattr(os, "geteuid") and os.geteuid() == 0)
    is_windows = os.name == "nt"
    use_sandbox = not (is_ci or is_root or is_windows)

    browser_args = [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
        "--disable-popup-blocking",
        "--window-size=1920,1080",
        "--start-maximized",
        "--no-first-run",
        "--no-service-autorun",
        "--password-store=basic",
    ]
    if args.proxy:
        browser_args.append(f"--proxy-server={args.proxy}")

    browser = None
    try:
        config = uc.Config(
            headless=bool(args.headless),
            sandbox=use_sandbox,
            browser_args=browser_args,
            user_data_dir=str(user_data_dir),
        )

        browser = await uc.start(config=config)
        tab = await browser.get(args.url)
        await asyncio.sleep(1.0)

        initial = await evaluate_extract(tab)
        baseline = str(initial.get("answer") or "").strip()
        if initial.get("blocked"):
            await asyncio.sleep(1.0)

        uploaded = await upload_image(tab, image_path)
        if not uploaded:
            emit(
                {
                    "success": False,
                    "ai_answer": "",
                    "sources": [],
                    "error": "未找到可用的图片上传入口（nodriver）",
                    "message": "image upload failed",
                }
            )
            return 1

        submitted, submit_diag = await submit_prompt(tab, args.query)
        if not submitted:
            diag_text = ""
            if submit_diag:
                try:
                    diag_text = json.dumps(submit_diag, ensure_ascii=False)
                except Exception:
                    diag_text = str(submit_diag)
            if diag_text:
                print(f"NODRIVER_SUBMIT_DIAG: {diag_text}", file=sys.stderr)
                diag_text = diag_text[:500]
            emit(
                {
                    "success": False,
                    "ai_answer": "",
                    "sources": [],
                    "error": (
                        "图片已上传，但未找到可用输入框提交问题（nodriver）"
                        + (f"；诊断: {diag_text}" if diag_text else "")
                    ),
                    "message": "prompt submit failed",
                }
            )
            return 1

        ok, extracted = await wait_for_answer(
            tab,
            baseline=baseline,
            timeout_seconds=max(25, int(args.timeout_seconds)),
        )
        answer = str(extracted.get("answer") or "").strip()
        sources = normalize_sources(extracted.get("sources") or [])

        if not ok and should_ignore_answer(answer, baseline):
            blocked_suffix = ""
            if extracted.get("blocked"):
                blocked_suffix = "（页面仍处于验证/拦截状态）"
            emit(
                {
                    "success": False,
                    "ai_answer": answer,
                    "sources": sources,
                    "error": f"等待图片分析结果超时{blocked_suffix}",
                    "message": "timed out waiting ai answer",
                }
            )
            return 1

        emit(
            {
                "success": True,
                "ai_answer": answer,
                "sources": sources,
                "error": "",
                "message": "nodriver image search succeeded",
            }
        )
        return 0
    except Exception as exc:
        emit(
            {
                "success": False,
                "ai_answer": "",
                "sources": [],
                "error": f"nodriver image search failed: {exc}",
                "message": "unexpected exception",
            }
        )
        return 1
    finally:
        if browser is not None:
            try:
                stop_ret = browser.stop()
                if asyncio.iscoroutine(stop_ret):
                    await asyncio.wait_for(stop_ret, timeout=8)
            except Exception:
                pass
            await asyncio.sleep(0.1)


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        emit(
            {
                "success": False,
                "ai_answer": "",
                "sources": [],
                "error": "interrupted by user",
                "message": "interrupted",
            }
        )
        raise SystemExit(1)
`;

const NODRIVER_AUTH_BRIDGE_SCRIPT = String.raw`#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

CAPTCHA_KEYWORDS = [
    "unusual traffic",
    "automated requests",
    "sorry/index",
    "recaptcha",
    "验证您是真人",
    "我们的系统检测到",
]

PASS_COOKIE_NAMES = {
    "SID",
    "HSID",
    "SSID",
    "SAPISID",
    "__Secure-1PSID",
    "__Secure-3PSID",
}


def emit(success: bool, state_saved: bool, message: str) -> None:
    print(
        json.dumps(
            {
                "success": bool(success),
                "state_saved": bool(state_saved),
                "message": message,
            },
            ensure_ascii=False,
        )
    )


def normalize_same_site(value) -> str:
    if value is None:
        return "Lax"
    normalized = str(value).strip().lower()
    if normalized == "strict":
        return "Strict"
    if normalized == "none":
        return "None"
    return "Lax"


def cookie_to_playwright(cookie):
    name = getattr(cookie, "name", None) or (cookie.get("name") if isinstance(cookie, dict) else None)
    value = getattr(cookie, "value", None) or (cookie.get("value") if isinstance(cookie, dict) else None)
    domain = getattr(cookie, "domain", None) or (cookie.get("domain") if isinstance(cookie, dict) else None)
    path = getattr(cookie, "path", None) or (cookie.get("path") if isinstance(cookie, dict) else "/")
    expires = getattr(cookie, "expires", None) if not isinstance(cookie, dict) else cookie.get("expires")
    http_only = getattr(cookie, "http_only", None) if not isinstance(cookie, dict) else cookie.get("httpOnly")
    secure = getattr(cookie, "secure", None) if not isinstance(cookie, dict) else cookie.get("secure")
    same_site = getattr(cookie, "same_site", None) if not isinstance(cookie, dict) else cookie.get("sameSite")

    if not name or value is None or not domain:
        return None

    try:
        expires_value = float(expires) if expires is not None else -1
    except Exception:
        expires_value = -1
    if expires_value > 1e12:
        expires_value = expires_value / 1000.0
    if expires_value <= 0:
        expires_value = -1

    return {
        "name": str(name),
        "value": str(value),
        "domain": str(domain),
        "path": str(path or "/"),
        "expires": expires_value,
        "httpOnly": bool(http_only),
        "secure": bool(secure),
        "sameSite": normalize_same_site(same_site),
    }


def is_blocked_page(content: str, current_url: str) -> bool:
    text = (content or "").lower()
    target = (current_url or "").lower()
    if "sorry/index" in target:
        return True
    return any(keyword in text for keyword in CAPTCHA_KEYWORDS)


def has_pass_cookie(raw_cookies) -> bool:
    for cookie in raw_cookies or []:
        if isinstance(cookie, dict):
            name = str(cookie.get("name", ""))
        else:
            name = str(getattr(cookie, "name", ""))
        if name in PASS_COOKIE_NAMES:
            return True
    return False


async def fetch_raw_cookies(tab, browser):
    try:
        import nodriver.cdp.network as cdp_network

        return await tab.send(cdp_network.get_all_cookies()) or []
    except Exception:
        try:
            return await browser.cookies.get_all()
        except Exception:
            return []


def save_storage_state(raw_cookies, state_path: str) -> bool:
    cookies = []
    for raw_cookie in raw_cookies or []:
        converted = cookie_to_playwright(raw_cookie)
        if converted:
            cookies.append(converted)
    if not cookies:
        return False
    payload = {"cookies": cookies, "origins": []}
    Path(state_path).parent.mkdir(parents=True, exist_ok=True)
    Path(state_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return True


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--state-path", required=True)
    parser.add_argument("--wait-seconds", type=int, default=300)
    parser.add_argument("--proxy", default="")
    args = parser.parse_args()

    try:
        import nodriver as uc
    except Exception as exc:
        emit(False, False, f"nodriver import failed: {exc}")
        return 2

    user_data_dir = Path.home() / ".huge-ai-search" / "nodriver_profile"
    user_data_dir.mkdir(parents=True, exist_ok=True)

    is_ci = bool(os.environ.get("CI")) or bool(os.environ.get("GITHUB_ACTIONS"))
    is_root = bool(hasattr(os, "geteuid") and os.geteuid() == 0)
    is_windows = os.name == "nt"
    use_sandbox = not (is_ci or is_root or is_windows)

    browser_args = [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
        "--disable-popup-blocking",
        "--window-size=1920,1080",
        "--start-maximized",
        "--no-first-run",
        "--no-service-autorun",
        "--password-store=basic",
    ]
    if args.proxy:
        browser_args.append(f"--proxy-server={args.proxy}")

    browser = None
    try:
        config = uc.Config(
            headless=False,
            sandbox=use_sandbox,
            browser_args=browser_args,
            user_data_dir=str(user_data_dir),
        )
        browser = await uc.start(config=config)
        tab = await browser.get(args.url)
        await asyncio.sleep(1.5)

        deadline = time.monotonic() + max(10, int(args.wait_seconds))
        timeout_reason = "verification not completed"

        while time.monotonic() < deadline:
            content = ""
            current_url = ""
            try:
                content = await tab.get_content()
            except Exception:
                content = ""
            try:
                current_url = str(getattr(tab.target, "url", "") or "")
            except Exception:
                current_url = ""

            raw_cookies = await fetch_raw_cookies(tab, browser)
            blocked = is_blocked_page(content, current_url)
            passed = has_pass_cookie(raw_cookies)

            if passed and not blocked:
                if save_storage_state(raw_cookies, args.state_path):
                    emit(True, True, "verification passed and storage state saved")
                    return 0
                timeout_reason = "pass cookies detected but serialization failed"
            else:
                if blocked:
                    timeout_reason = "still blocked by captcha/suspicious traffic page"
                else:
                    timeout_reason = "login cookies not ready"

            await asyncio.sleep(2)

        raw_cookies = await fetch_raw_cookies(tab, browser)
        if save_storage_state(raw_cookies, args.state_path):
            emit(True, True, "timeout reached; current cookies saved")
            return 0

        emit(False, False, f"verification timeout: {timeout_reason}")
        return 1
    except Exception as exc:
        emit(False, False, f"nodriver auth flow failed: {exc}")
        return 1
    finally:
        if browser is not None:
            try:
                stop_ret = browser.stop()
                if asyncio.iscoroutine(stop_ret):
                    await asyncio.wait_for(stop_ret, timeout=8)
            except Exception:
                pass
            await asyncio.sleep(0.1)


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        emit(False, False, "interrupted by user")
        raise SystemExit(1)
`;

// ============================================
// 全局 CAPTCHA 处理锁
// 防止多个请求同时打开多个浏览器窗口
// ============================================
let captchaLock = false;
let captchaLockPromise: Promise<void> | null = null;
let captchaLockResolve: (() => void) | null = null;

/**
 * 尝试获取 CAPTCHA 锁（原子操作）
 * @returns "acquired" 如果成功获取锁
 *          "wait" 如果需要等待其他请求完成
 *          "timeout" 如果等待超时
 */
async function tryAcquireCaptchaLock(timeoutMs: number = 5 * 60 * 1000): Promise<"acquired" | "wait" | "timeout"> {
  // 原子检查和设置
  if (!captchaLock) {
    captchaLock = true;
    captchaLockPromise = new Promise((resolve) => {
      captchaLockResolve = resolve;
    });
    log("CAPTCHA", "获取锁成功，开始处理 CAPTCHA");
    return "acquired";
  }

  // 锁已被持有，等待释放
  log("CAPTCHA", "锁已被持有，等待其他请求完成...");
  if (captchaLockPromise) {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("等待超时")), timeoutMs);
    });

    try {
      await Promise.race([captchaLockPromise, timeoutPromise]);
      log("CAPTCHA", "其他请求已完成 CAPTCHA 处理");
      return "wait";
    } catch {
      log("CAPTCHA", "等待超时");
      return "timeout";
    }
  }

  return "wait";
}

/**
 * 释放 CAPTCHA 锁
 */
function releaseCaptchaLock(): void {
  if (captchaLock) {
    log("CAPTCHA", "释放锁");
    captchaLock = false;
    if (captchaLockResolve) {
      captchaLockResolve();
      captchaLockResolve = null;
    }
    captchaLockPromise = null;
  }
}

export class AISearcher {
  private static readonly BASE_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];

  private static readonly HEADED_EXTRA_LAUNCH_ARGS = [
    "--start-maximized",
    "--disable-popup-blocking",
  ];

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionActive: boolean = false;
  private lastActivityTime: number = 0;
  private lastAiAnswer: string = "";
  private browserDataDir: string;
  private timeout: number;
  private headless: boolean;

  // Edge 浏览器安装路径（仅支持 Edge）
  private static readonly EDGE_PATHS: Record<string, string[]> = {
    win32: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
    darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    linux: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
  };

  private sessionId: string;

  // 浏览器数据根目录（固定在用户目录，避免权限问题）
  private static readonly BROWSER_DATA_ROOT = path.join(os.homedir(), ".huge-ai-search", "browser_data");

  constructor(timeout: number = 30, headless: boolean = true, sessionId?: string) {
    this.timeout = timeout;
    this.headless = headless;
    // 每个会话使用独立的数据目录，避免 Chrome 的用户数据目录锁冲突
    this.sessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.browserDataDir = path.join(AISearcher.BROWSER_DATA_ROOT, this.sessionId);
    if (!fs.existsSync(this.browserDataDir)) {
      fs.mkdirSync(this.browserDataDir, { recursive: true });
    }
    console.error(`AISearcher 初始化: timeout=${timeout}s, headless=${headless}, sessionId=${this.sessionId}`);
    console.error(`浏览器数据目录: ${this.browserDataDir}`);
  }

  /**
   * 查找系统已安装的 Edge 浏览器
   * 注意：仅支持 Edge 浏览器，Chrome 的 Playwright 代理配置有问题
   * @throws Error 如果未找到 Edge 浏览器
   */
  private findBrowser(): string {
    const platform = process.platform;

    // 仅支持 Edge 浏览器
    const edgePaths = AISearcher.EDGE_PATHS[platform] || [];
    for (const edgePath of edgePaths) {
      if (fs.existsSync(edgePath)) {
        console.error(`找到 Edge: ${edgePath}`);
        return edgePath;
      }
    }

    // 未找到 Edge，抛出错误
    const downloadUrl = "https://www.microsoft.com/edge";
    const platformName = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
    throw new Error(
      `未找到 Microsoft Edge 浏览器！\n` +
      `本工具仅支持 Edge 浏览器（Chrome 代理配置有问题）。\n` +
      `请从 ${downloadUrl} 下载安装 Edge for ${platformName}。`
    );
  }

  private isTruthyEnv(value?: string): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }

  private isFalsyEnv(value?: string): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off";
  }

  /**
   * 检测代理设置
   * 默认启用系统代理继承与本地端口自动探测。
   * 设置 HUGE_AI_SEARCH_USE_SYSTEM_PROXY=0 可关闭系统代理继承。
   * 设置 HUGE_AI_SEARCH_AUTO_DETECT_PROXY=0 可关闭本地端口自动探测。
   */
  private async detectProxy(): Promise<string | undefined> {
    console.error("开始检测代理...");

    // 1. 应用级显式代理（最高优先级）
    const explicitProxy = (process.env.HUGE_AI_SEARCH_PROXY || "").trim();
    if (explicitProxy) {
      console.error(`使用显式代理 HUGE_AI_SEARCH_PROXY: ${explicitProxy}`);
      return explicitProxy;
    }

    // 2. 继承系统代理环境变量（默认开启，设置 HUGE_AI_SEARCH_USE_SYSTEM_PROXY=0 可关闭）
    const disableSystemProxy = this.isFalsyEnv(process.env.HUGE_AI_SEARCH_USE_SYSTEM_PROXY);
    if (!disableSystemProxy) {
      const envVars = [
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
      ];
      for (const envVar of envVars) {
        const proxy = (process.env[envVar] || "").trim();
        if (proxy) {
          console.error(`从环境变量 ${envVar} 检测到代理: ${proxy}`);
          return proxy;
        }
      }
      console.error("系统代理继承已启用，但环境变量中未找到代理配置");
    } else {
      console.error("已关闭系统代理继承（HUGE_AI_SEARCH_USE_SYSTEM_PROXY=0）");
    }

    // 3. 检测常见代理端口（默认开启，设置 HUGE_AI_SEARCH_AUTO_DETECT_PROXY=0 可关闭）
    const disableAutoDetect = this.isFalsyEnv(process.env.HUGE_AI_SEARCH_AUTO_DETECT_PROXY);
    if (disableAutoDetect) {
      console.error("已关闭自动代理端口探测（HUGE_AI_SEARCH_AUTO_DETECT_PROXY=0）");
      return undefined;
    }

    console.error("开始检测本地常见代理端口...");

    type PortCandidate = {
      port: number;
      proxyUrl?: string;
      note: string;
      risky?: boolean;
    };
    const commonPorts: PortCandidate[] = [
      // 高置信度：常见本地代理入站端口
      { port: 7890, proxyUrl: "http://127.0.0.1:7890", note: "Clash Mixed/HTTP 端口" },
      { port: 10809, proxyUrl: "http://127.0.0.1:10809", note: "v2rayN HTTP 端口" },
      { port: 10808, proxyUrl: "socks5://127.0.0.1:10808", note: "v2rayN SOCKS5 端口" },
      { port: 7891, proxyUrl: "socks5://127.0.0.1:7891", note: "Clash SOCKS5 端口" },
      { port: 7897, proxyUrl: "http://127.0.0.1:7897", note: "常见自定义 HTTP/Mixed 端口" },
      { port: 1080, proxyUrl: "socks5://127.0.0.1:1080", note: "通用 SOCKS5 端口（V2Ray/SS/Trojan）" },
      { port: 20171, proxyUrl: "http://127.0.0.1:20171", note: "v2rayA HTTP 端口" },
      { port: 20170, proxyUrl: "socks5://127.0.0.1:20170", note: "v2rayA SOCKS5 端口" },
      { port: 20172, proxyUrl: "http://127.0.0.1:20172", note: "v2rayA 分流 HTTP 端口" },
      { port: 2080, proxyUrl: "http://127.0.0.1:2080", note: "Sing-Box 常见 HTTP 端口" },
      { port: 2081, proxyUrl: "socks5://127.0.0.1:2081", note: "Sing-Box 常见 SOCKS5 端口" },
      { port: 2088, proxyUrl: "http://127.0.0.1:2088", note: "Sing-Box 常见 Mixed 端口" },
      { port: 6152, proxyUrl: "http://127.0.0.1:6152", note: "Surge HTTP 端口" },
      { port: 6153, proxyUrl: "socks5://127.0.0.1:6153", note: "Surge SOCKS5 端口" },

      // 低置信度：可能是代理，也可能是普通 Web/服务端口
      { port: 2053, proxyUrl: "http://127.0.0.1:2053", note: "常见备用代理/Web 端口", risky: true },
      { port: 2083, proxyUrl: "http://127.0.0.1:2083", note: "常见备用代理/Web 端口", risky: true },
      { port: 2087, proxyUrl: "http://127.0.0.1:2087", note: "常见备用代理/Web 端口", risky: true },
      { port: 8080, proxyUrl: "http://127.0.0.1:8080", note: "常见 HTTP 代理/Web 端口", risky: true },
      { port: 8443, proxyUrl: "http://127.0.0.1:8443", note: "常见 HTTPS 代理/Web 端口", risky: true },
      { port: 80, proxyUrl: "http://127.0.0.1:80", note: "HTTP 端口（易与本地 Web 服务冲突）", risky: true },
      { port: 443, proxyUrl: "http://127.0.0.1:443", note: "HTTPS 端口（易与本地 Web 服务冲突）", risky: true },

      // 可检测但默认不作为浏览器代理使用的端口
      { port: 7892, note: "Clash Redir 透明代理端口（非浏览器代理）" },
      { port: 9090, note: "Clash 外部控制/Dashboard 端口（非浏览器代理）" },
      { port: 53, note: "DNS 监听端口（非浏览器代理）" },
      { port: 54321, note: "X-UI/3X-UI 面板端口（非浏览器代理）" },
    ];

    for (const { port, proxyUrl, note, risky } of commonPorts) {
      console.error(`检测端口 ${port}（${note}）...`);
      const isOpen = await this.checkPort(port);
      console.error(`端口 ${port} 状态: ${isOpen ? '开放' : '关闭'}`);
      if (!isOpen) {
        continue;
      }

      if (!proxyUrl) {
        console.error(`端口 ${port} 已开放，但该端口通常不能作为浏览器代理，跳过自动使用`);
        continue;
      }

      if (risky) {
        console.error(`警告: 端口 ${port} 属于低置信度端口，可能是普通 Web 服务。若后续失败，请优先使用环境变量显式指定代理`);
      }

      console.error(`检测到本地代理端口 ${port} 开放，使用代理: ${proxyUrl}`);
      return proxyUrl;
    }

    console.error("自动探测未检测到可用代理");
    return undefined;
  }

  /**
   * 检查端口是否开放
   */
  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, "127.0.0.1");
    });
  }

  /**
   * 构建搜索 URL
   */
  private buildUrl(query: string, language: string): string {
    const encodedQuery = encodeURIComponent(query);
    return `https://www.google.com/search?q=${encodedQuery}&udm=50&hl=${language}`;
  }

  private buildAiModeUrl(language: string): string {
    return `https://www.google.com/search?udm=50&hl=${language}`;
  }

  /**
   * 获取存储状态文件路径
   */
  private getStorageStatePath(): string {
    return path.join(this.browserDataDir, "storage_state.json");
  }

  /**
   * 获取共享的存储状态文件路径（登录脚本保存的位置）
   */
  private getSharedStorageStatePath(): string {
    return path.join(AISearcher.BROWSER_DATA_ROOT, "storage_state.json");
  }

  /**
   * 加载存储状态（如果存在）
   * 优先使用会话目录下的状态，如果没有则从共享目录复制
   */
  private loadStorageState(): string | undefined {
    const sessionStatePath = this.getStorageStatePath();
    const sharedStatePath = this.getSharedStorageStatePath();
    const hasSessionState = fs.existsSync(sessionStatePath);
    const hasSharedState = fs.existsSync(sharedStatePath);

    // 0. 如果共享状态更新，优先覆盖会话状态，避免使用陈旧认证信息
    if (hasSessionState && hasSharedState) {
      try {
        const sessionMtime = fs.statSync(sessionStatePath).mtimeMs;
        const sharedMtime = fs.statSync(sharedStatePath).mtimeMs;
        if (sharedMtime > sessionMtime + 1) {
          fs.copyFileSync(sharedStatePath, sessionStatePath);
          console.error(
            `检测到共享认证状态更新，覆盖会话状态: ${sharedStatePath} -> ${sessionStatePath}`
          );
        }
      } catch (error) {
        console.error(`同步共享认证状态失败: ${error}`);
      }
    }

    // 1. 优先检查会话目录下的认证状态
    if (fs.existsSync(sessionStatePath)) {
      console.error(`加载会话认证状态: ${sessionStatePath}`);
      return sessionStatePath;
    }

    // 2. 如果会话目录没有，尝试从共享目录复制
    if (hasSharedState) {
      try {
        fs.copyFileSync(sharedStatePath, sessionStatePath);
        console.error(`从共享目录复制认证状态: ${sharedStatePath} -> ${sessionStatePath}`);
        return sessionStatePath;
      } catch (error) {
        console.error(`复制共享认证状态失败: ${error}`);
        // 复制失败时，直接使用共享状态（只读）
        console.error(`回退到直接使用共享认证状态: ${sharedStatePath}`);
        return sharedStatePath;
      }
    }

    console.error("未找到任何认证状态文件");
    return undefined;
  }

  private shouldUseNodriverAuth(): boolean {
    const driver = (process.env.HUGE_AI_SEARCH_AUTH_DRIVER || "nodriver").trim().toLowerCase();
    return driver === "nodriver";
  }

  private getNodriverWaitSeconds(): number {
    const configured = Number(process.env.HUGE_AI_SEARCH_NODRIVER_WAIT_SECONDS || "");
    if (Number.isFinite(configured) && configured >= 30 && configured <= 900) {
      return Math.floor(configured);
    }
    return NODRIVER_DEFAULT_WAIT_SECONDS;
  }

  private ensureNodriverBridgeScript(): string {
    const runtimeDir = path.join(os.tmpdir(), ".huge-ai-search");
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true });
    }
    const scriptPath = path.join(runtimeDir, NODRIVER_SCRIPT_FILE_NAME);
    try {
      const existing = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
      if (existing !== NODRIVER_AUTH_BRIDGE_SCRIPT) {
        fs.writeFileSync(scriptPath, NODRIVER_AUTH_BRIDGE_SCRIPT, "utf8");
      }
    } catch (error) {
      throw new Error(`准备 nodriver 桥接脚本失败: ${error}`);
    }
    return scriptPath;
  }

  private resolvePythonCandidates(): Array<{ command: string; argsPrefix: string[] }> {
    const configured = (process.env.HUGE_AI_SEARCH_NODRIVER_PYTHON || "").trim();
    const candidates: Array<{ command: string; argsPrefix: string[] }> = [];

    if (configured) {
      candidates.push({ command: configured, argsPrefix: [] });
      return candidates;
    }

    if (process.platform === "win32") {
      candidates.push({ command: "python", argsPrefix: [] });
      candidates.push({ command: "py", argsPrefix: ["-3"] });
      candidates.push({ command: "py", argsPrefix: [] });
      return candidates;
    }

    candidates.push({ command: "python3", argsPrefix: [] });
    candidates.push({ command: "python", argsPrefix: [] });
    return candidates;
  }

  private runProcess(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<ProcessExecResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      let child;
      try {
        child = spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
          },
        });
      } catch (error) {
        resolve({
          exitCode: null,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
          timedOut: false,
        });
        return;
      }

      const finish = (payload: ProcessExecResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 1200);
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });

      child.on("error", (error) => {
        finish({
          exitCode: null,
          stdout,
          stderr,
          error: error instanceof Error ? error.message : String(error),
          timedOut,
        });
      });

      child.on("close", (exitCode) => {
        finish({
          exitCode,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }

  private isCommandUnavailableError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("enoent") ||
      lower.includes("is not recognized as an internal or external command") ||
      lower.includes("command not found") ||
      lower.includes("no such file or directory")
    );
  }

  private isNodriverImportFailure(message: string): boolean {
    return message.toLowerCase().includes("nodriver import failed");
  }

  private parseNodriverBridgeResult(stdout: string, stderr: string): NodriverBridgeResult {
    const combinedLines = `${stdout || ""}\n${stderr || ""}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = combinedLines.length - 1; i >= 0; i--) {
      const line = combinedLines[i];
      if (!(line.startsWith("{") && line.endsWith("}"))) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as Partial<NodriverBridgeResult> & {
          state_saved?: boolean;
          stateSaved?: boolean;
        };
        return {
          success: Boolean(parsed.success),
          stateSaved: Boolean(parsed.stateSaved ?? parsed.state_saved),
          message:
            typeof parsed.message === "string" && parsed.message.trim()
              ? parsed.message.trim()
              : "nodriver 桥接返回空消息",
        };
      } catch {
        continue;
      }
    }

    const fallback = (stderr || stdout || "").trim();
    return {
      success: false,
      stateSaved: false,
      message: fallback ? fallback.slice(0, 500) : "nodriver 桥接未返回可解析结果",
    };
  }

  private async runNodriverAuthFlow(targetUrl: string): Promise<NodriverBridgeResult> {
    if (!this.shouldUseNodriverAuth()) {
      return {
        success: false,
        stateSaved: false,
        message: "nodriver 认证流程已禁用（HUGE_AI_SEARCH_AUTH_DRIVER != nodriver）",
      };
    }

    const storageStatePath = this.getSharedStorageStatePath();
    const sharedDir = path.dirname(storageStatePath);
    if (!fs.existsSync(sharedDir)) {
      fs.mkdirSync(sharedDir, { recursive: true });
    }

    const scriptPath = this.ensureNodriverBridgeScript();
    const waitSeconds = this.getNodriverWaitSeconds();
    const timeoutMs = Math.max((waitSeconds + 45) * 1000, 90_000);
    const proxy = await this.detectProxy();

    const baseArgs = [
      scriptPath,
      "--url",
      targetUrl,
      "--state-path",
      storageStatePath,
      "--wait-seconds",
      `${waitSeconds}`,
    ];
    if (proxy) {
      baseArgs.push("--proxy", proxy);
    }

    let lastErrorMessage = "未执行 nodriver 认证流程";
    for (const candidate of this.resolvePythonCandidates()) {
      const fullArgs = [...candidate.argsPrefix, ...baseArgs];
      log(
        "CAPTCHA",
        `尝试 nodriver 认证: ${candidate.command} ${fullArgs
          .map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))
          .join(" ")}`
      );

      const execResult = await this.runProcess(candidate.command, fullArgs, timeoutMs);
      const parsed = this.parseNodriverBridgeResult(execResult.stdout, execResult.stderr);
      const shouldTryNextInterpreter =
        (execResult.error ? this.isCommandUnavailableError(execResult.error) : false) ||
        this.isNodriverImportFailure(parsed.message || "");

      if (execResult.timedOut) {
        lastErrorMessage = `nodriver 认证超时 (${waitSeconds}s)`;
      } else if (execResult.error) {
        lastErrorMessage = `启动失败: ${execResult.error}`;
      } else if (execResult.exitCode !== 0) {
        lastErrorMessage = parsed.message || `退出码 ${execResult.exitCode}`;
      } else if (parsed.success && parsed.stateSaved && fs.existsSync(storageStatePath)) {
        log("CAPTCHA", `nodriver 认证成功，状态已保存: ${storageStatePath}`);
        return parsed;
      } else {
        lastErrorMessage = parsed.message || "nodriver 执行完成但未保存认证状态";
      }

      log(
        "CAPTCHA",
        `nodriver 认证失败（${candidate.command}）: ${lastErrorMessage}`
      );

      if (!shouldTryNextInterpreter) {
        break;
      }
    }

    return {
      success: false,
      stateSaved: false,
      message: lastErrorMessage,
    };
  }

  private getImageDriverMode(): ImageDriverMode {
    const driver = (process.env.HUGE_AI_SEARCH_IMAGE_DRIVER || "playwright")
      .trim()
      .toLowerCase();
    if (driver === "nodriver-only") {
      return "nodriver-only";
    }
    if (driver === "nodriver") {
      return "nodriver";
    }
    return "playwright";
  }

  private getNodriverImageSearchTimeoutSeconds(): number {
    const configured = Number(
      process.env.HUGE_AI_SEARCH_NODRIVER_IMAGE_TIMEOUT_SECONDS || ""
    );
    if (Number.isFinite(configured) && configured >= 25 && configured <= 300) {
      return Math.floor(configured);
    }
    return NODRIVER_IMAGE_SEARCH_TIMEOUT_SECONDS;
  }

  private getNodriverImageFastAttemptTimeoutSeconds(): number {
    const configured = Number(
      process.env.HUGE_AI_SEARCH_NODRIVER_IMAGE_FAST_ATTEMPT_SECONDS || ""
    );
    if (Number.isFinite(configured) && configured >= 12 && configured <= 120) {
      return Math.floor(configured);
    }
    return NODRIVER_IMAGE_FAST_ATTEMPT_TIMEOUT_SECONDS;
  }

  private getNodriverImageAttemptTimeoutSeconds(mode: ImageDriverMode): number {
    const fullTimeout = this.getNodriverImageSearchTimeoutSeconds();
    if (mode === "nodriver-only") {
      return fullTimeout;
    }
    return Math.min(fullTimeout, this.getNodriverImageFastAttemptTimeoutSeconds());
  }

  private useNodriverImageSearchHeadless(): boolean {
    if (process.env.HUGE_AI_SEARCH_NODRIVER_HEADLESS === undefined) {
      return NODRIVER_IMAGE_SEARCH_HEADLESS_DEFAULT;
    }
    return this.isTruthyEnv(process.env.HUGE_AI_SEARCH_NODRIVER_HEADLESS);
  }

  private ensureNodriverImageSearchScript(): string {
    const runtimeDir = path.join(os.tmpdir(), ".huge-ai-search");
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true });
    }
    const scriptNameExt = path.extname(NODRIVER_IMAGE_SEARCH_SCRIPT_FILE_NAME) || ".py";
    const scriptNameBase = path.basename(
      NODRIVER_IMAGE_SEARCH_SCRIPT_FILE_NAME,
      scriptNameExt
    );
    const scriptHash = createHash("sha1")
      .update(NODRIVER_IMAGE_SEARCH_BRIDGE_SCRIPT)
      .digest("hex")
      .slice(0, 12);
    const scriptPath = path.join(runtimeDir, `${scriptNameBase}_${scriptHash}${scriptNameExt}`);
    try {
      const existing = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
      if (existing !== NODRIVER_IMAGE_SEARCH_BRIDGE_SCRIPT) {
        fs.writeFileSync(scriptPath, NODRIVER_IMAGE_SEARCH_BRIDGE_SCRIPT, "utf8");
      }
    } catch (error) {
      throw new Error(`准备 nodriver 图片桥接脚本失败: ${error}`);
    }
    return scriptPath;
  }

  private parseNodriverImageSearchResult(
    stdout: string,
    stderr: string
  ): NodriverImageSearchResult {
    const combinedLines = `${stdout || ""}\n${stderr || ""}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const fallbackError = (stderr || stdout || "").trim();

    for (let i = combinedLines.length - 1; i >= 0; i--) {
      const line = combinedLines[i];
      if (!(line.startsWith("{") && line.endsWith("}"))) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as {
          success?: boolean;
          aiAnswer?: string;
          ai_answer?: string;
          sources?: Array<{ title?: string; url?: string; snippet?: string }>;
          error?: string;
          message?: string;
        };

        const sources = Array.isArray(parsed.sources)
          ? parsed.sources
              .filter((source) => source && typeof source === "object")
              .map((source) => ({
                title: typeof source.title === "string" ? source.title : "",
                url: typeof source.url === "string" ? source.url : "",
                snippet: typeof source.snippet === "string" ? source.snippet : "",
              }))
              .filter((source) => Boolean(source.url))
          : [];

        const aiAnswer =
          typeof parsed.aiAnswer === "string"
            ? parsed.aiAnswer
            : typeof parsed.ai_answer === "string"
              ? parsed.ai_answer
              : "";

        return {
          success: Boolean(parsed.success),
          aiAnswer: aiAnswer.trim(),
          sources,
          error: typeof parsed.error === "string" ? parsed.error : "",
          message: typeof parsed.message === "string" ? parsed.message : "",
        };
      } catch {
        continue;
      }
    }

    return {
      success: false,
      aiAnswer: "",
      sources: [],
      error: fallbackError || "nodriver 图片桥接未返回可解析结果",
      message: "",
    };
  }

  private async runNodriverImageSearch(
    query: string,
    language: string,
    imagePath: string,
    timeoutSecondsOverride?: number
  ): Promise<SearchResult> {
    const result: SearchResult = {
      success: false,
      query,
      aiAnswer: "",
      sources: [],
      error: "",
    };

    const scriptPath = this.ensureNodriverImageSearchScript();
    const timeoutSeconds = timeoutSecondsOverride ?? this.getNodriverImageSearchTimeoutSeconds();
    const timeoutMs = Math.max((timeoutSeconds + 12) * 1000, 25_000);
    const absoluteImagePath = path.resolve(imagePath);
    const proxy = await this.detectProxy();

    const baseArgs = [
      scriptPath,
      "--url",
      this.buildAiModeUrl(language),
      "--query",
      query,
      "--language",
      language,
      "--image-path",
      absoluteImagePath,
      "--timeout-seconds",
      `${timeoutSeconds}`,
    ];
    if (proxy) {
      baseArgs.push("--proxy", proxy);
    }
    if (this.useNodriverImageSearchHeadless()) {
      baseArgs.push("--headless");
    }

    let lastError = "未执行 nodriver 图片搜索";

    for (const candidate of this.resolvePythonCandidates()) {
      const args = [...candidate.argsPrefix, ...baseArgs];
      log(
        "INFO",
        `尝试 nodriver 图片搜索: ${candidate.command} ${args
          .map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))
          .join(" ")}`
      );

      const execResult = await this.runProcess(candidate.command, args, timeoutMs);
      const parsed = this.parseNodriverImageSearchResult(
        execResult.stdout,
        execResult.stderr
      );

      const parsedFailureText = `${parsed.error || ""} ${parsed.message || ""}`.trim();
      const shouldTryNextInterpreter =
        (execResult.error ? this.isCommandUnavailableError(execResult.error) : false) ||
        this.isNodriverImportFailure(parsedFailureText);

      if (execResult.timedOut) {
        lastError = `nodriver 图片搜索超时 (${timeoutSeconds}s)`;
      } else if (execResult.error) {
        lastError = `nodriver 启动失败: ${execResult.error}`;
      } else if (execResult.exitCode !== 0) {
        lastError = parsed.error || parsed.message || `退出码 ${execResult.exitCode}`;
      } else if (parsed.success && parsed.aiAnswer.trim()) {
        result.success = true;
        result.aiAnswer = parsed.aiAnswer.trim();
        result.sources = parsed.sources;
        result.error = "";
        log(
          "INFO",
          `nodriver 图片搜索成功: answerLen=${result.aiAnswer.length}, sources=${result.sources.length}`
        );
        return result;
      } else {
        lastError = parsed.error || parsed.message || "nodriver 图片搜索返回空回答";
      }

      log(
        "ERROR",
        `nodriver 图片搜索失败（${candidate.command}）: ${lastError}`
      );

      if (!shouldTryNextInterpreter) {
        break;
      }
    }

    result.error = lastError;
    return result;
  }

  private buildLaunchOptions(
    executablePath: string,
    headless: boolean,
    proxy?: string
  ): Parameters<typeof chromium.launch>[0] {
    const args = [...AISearcher.BASE_LAUNCH_ARGS];
    if (!headless) {
      args.push(...AISearcher.HEADED_EXTRA_LAUNCH_ARGS);
    }

    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless,
      executablePath,
      args,
      ignoreDefaultArgs: ["--enable-automation"],
    };

    if (proxy) {
      launchOptions.proxy = { server: proxy };
    }

    return launchOptions;
  }

  private buildHeadedContextOptions(
    storageStatePath?: string
  ): BrowserContextOptions {
    const contextOptions: BrowserContextOptions = {
      viewport: null,
    };

    if (storageStatePath && fs.existsSync(storageStatePath)) {
      contextOptions.storageState = storageStatePath;
    }

    return contextOptions;
  }

  /**
   * 检查是否有活跃的浏览器会话
   */
  hasActiveSession(): boolean {
    if (!this.sessionActive || !this.page) {
      return false;
    }

    // 检查会话是否超时
    if (this.lastActivityTime > 0) {
      const elapsed = (Date.now() - this.lastActivityTime) / 1000;
      if (elapsed > SESSION_TIMEOUT) {
        console.error(`会话已超时（${elapsed.toFixed(0)}秒），将关闭`);
        this.close();
        return false;
      }
    }

    return true;
  }

  /**
   * 设置资源拦截，加速页面加载
   */
  private async setupResourceInterception(page: Page): Promise<void> {
    try {
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        const url = route.request().url();

        // 拦截无用资源类型
        if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
          route.abort();
          return;
        }

        // 拦截广告和追踪脚本
        for (const pattern of BLOCKED_URL_PATTERNS) {
          if (url.includes(pattern)) {
            route.abort();
            return;
          }
        }

        route.continue();
      });
      console.error("已设置资源拦截（图片、字体、广告）");
    } catch (error) {
      console.error(`设置资源拦截失败: ${error}`);
    }
  }

  /**
   * 确保浏览器会话已启动
   */
  private async ensureSession(language: string = "zh-CN"): Promise<boolean> {
    if (this.sessionActive && this.page) {
      return true;
    }

    console.error("启动新的浏览器会话...");

    try {
      const executablePath = this.findBrowser();
      const proxy = await this.detectProxy();
      const launchOptions = this.buildLaunchOptions(executablePath, this.headless, proxy);

      if (proxy) {
        console.error(`使用代理: ${proxy}`);
      }

      this.browser = await chromium.launch(launchOptions);

      // 创建上下文时加载共享的 storage_state
      const contextOptions: Parameters<Browser["newContext"]>[0] = {
        viewport: this.headless ? { width: 1920, height: 1080 } : null,
        locale: language,
      };

      // 尝试加载共享的认证状态
      const storageStatePath = this.loadStorageState();
      if (storageStatePath) {
        contextOptions.storageState = storageStatePath;
        console.error(`已加载共享认证状态: ${storageStatePath}`);
      } else {
        console.error("无共享认证状态，使用新会话");
      }

      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();

      // 禁用资源拦截（会影响来源链接的提取）
      // await this.setupResourceInterception(this.page);

      this.sessionActive = true;
      this.lastActivityTime = Date.now();

      console.error("浏览器会话启动成功");
      return true;
    } catch (error) {
      console.error(`启动浏览器会话失败: ${error}`);
      await this.close();
      return false;
    }
  }

  /**
   * 保存存储状态
   */
  private async saveStorageState(): Promise<void> {
    if (!this.context) return;

    const storageStatePath = this.getStorageStatePath();
    try {
      await this.context.storageState({ path: storageStatePath });
      console.error("已保存存储状态");
    } catch (error) {
      console.error(`保存存储状态失败: ${error}`);
      return;
    }

    const sharedStatePath = this.getSharedStorageStatePath();
    try {
      fs.copyFileSync(storageStatePath, sharedStatePath);
      console.error(`已同步共享存储状态: ${sharedStatePath}`);
    } catch (error) {
      console.error(`同步共享存储状态失败: ${error}`);
    }
  }

  /**
   * 检测验证码页面
   */
  private isCaptchaPage(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return CAPTCHA_KEYWORDS.some((kw) =>
      lowerContent.includes(kw.toLowerCase())
    );
  }

  /**
   * 检测当前页面是否有验证码
   */
  private async detectCaptcha(): Promise<boolean> {
    if (!this.page) return false;
    const content = await this.page.content();
    return this.isCaptchaPage(content);
  }

  /**
   * 处理 Cookie 同意对话框
   */
  private async handleCookieConsent(page: Page): Promise<boolean> {
    const consentSelectors = [
      'button:has-text("全部接受")',
      'button:has-text("Accept all")',
      'button:has-text("すべて同意")',
      'button:has-text("모두 수락")',
      '[aria-label="全部接受"]',
      '[aria-label="Accept all"]',
    ];

    for (const selector of consentSelectors) {
      try {
        const button = await page.$(selector);
        if (button && (await button.isVisible())) {
          console.error(`检测到 Cookie 同意对话框，点击: ${selector}`);
          await button.click();
          await page.waitForTimeout(1000);
          return true;
        }
      } catch {
        continue;
      }
    }

    // 备用方案：使用 JavaScript
    try {
      const jsClickConsent = `
      (() => {
        const buttons = document.querySelectorAll("button");
        for (const btn of buttons) {
          const text = btn.textContent || "";
          if (
            text.includes("全部接受") ||
            text.includes("Accept all") ||
            text.includes("すべて同意")
          ) {
            btn.click();
            return true;
          }
        }
        return false;
      })()
      `;
      const clicked = await page.evaluate(jsClickConsent) as boolean;
      if (clicked) {
        console.error("通过 JavaScript 点击了 Cookie 同意按钮");
        await page.waitForTimeout(1000);
        return true;
      }
    } catch {
      // ignore
    }

    return false;
  }

  /**
   * 等待 AI 内容加载
   */
  private async waitForAiContent(page: Page): Promise<boolean> {
    // 首先处理可能的 Cookie 同意对话框
    await this.handleCookieConsent(page);

    // 优先策略：快速检查页面关键词
    try {
      const content = (await page.evaluate(
        "document.body.innerText"
      )) as string;
      if (AI_KEYWORDS.some((kw) => content.includes(kw))) {
        console.error("通过关键词快速检测到 AI 内容");
        return true;
      }
    } catch {
      // ignore
    }

    // 备用策略：尝试选择器
    for (const selector of AI_SELECTORS) {
      try {
        await page.waitForSelector(selector, { timeout: 1500 });
        console.error(`检测到 AI 回答区域: ${selector}`);
        return true;
      } catch {
        continue;
      }
    }

    // 最后策略：等待关键词出现
    console.error("未找到 AI 内容，等待页面加载...");
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1000);
      try {
        const content = (await page.evaluate(
          "document.body.innerText"
        )) as string;
        if (AI_KEYWORDS.some((kw) => content.includes(kw))) {
          console.error("通过关键词检测到 AI 内容");
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * 检查页面上是否存在加载指示器
   */
  private async checkLoadingIndicators(page: Page): Promise<boolean> {
    for (const selector of AI_LOADING_SELECTORS) {
      try {
        const element = await page.$(selector);
        if (element && (await element.isVisible())) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * 检查页面上是否出现追问建议（表示 AI 生成完成）
   */
  private async checkFollowUpSuggestions(page: Page): Promise<boolean> {
    const followUpSelectors = [
      'div[data-subtree="aimc"] textarea',
      'div[data-subtree="aimc"] input[type="text"]',
      '[aria-label*="follow"]',
      '[aria-label*="追问"]',
      '[placeholder*="follow"]',
      '[placeholder*="追问"]',
    ];

    for (const selector of followUpSelectors) {
      try {
        const element = await page.$(selector);
        if (element && (await element.isVisible())) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * 等待 AI 流式输出完成
   */
  private async waitForStreamingComplete(
    page: Page,
    maxWaitSeconds: number = 18
  ): Promise<boolean> {
    console.error("等待 AI 流式输出完成...");

    let lastContentLength = 0;
    let stableCount = 0;
    const stableThreshold = 2;
    const checkInterval = 500;
    const minContentLength = maxWaitSeconds >= 20 ? 120 : 60;

    for (let i = 0; i < maxWaitSeconds * 2; i++) {
      try {
        const content = (await page.evaluate(
          "document.body.innerText"
        )) as string;
        const currentLength = content.length;

        // 策略1：检查加载指示器
        const hasLoadingIndicator = await this.checkLoadingIndicators(page);

        // 策略2：检查是否仍在加载状态（关键词检测）
        const isLoading = AI_LOADING_KEYWORDS.some((kw) =>
          content.includes(kw)
        );

        // 策略3：检查追问建议是否出现
        const hasFollowUp = await this.checkFollowUpSuggestions(page);

        // 策略4：检查来源链接数量（确保来源已加载）
        const sourceCount = await page.evaluate(`
          (() => {
            function isGoogleHost(hostname) {
              const host = (hostname || "").toLowerCase();
              return host.includes('google.') || host.includes('gstatic.com') || host.includes('googleapis.com');
            }

            function normalizeLink(rawHref) {
              if (!rawHref) return '';
              try {
                const parsed = new URL(rawHref);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                  return '';
                }

                if (isGoogleHost(parsed.hostname)) {
                  const redirect = parsed.searchParams.get('url') || parsed.searchParams.get('q') || '';
                  if (!redirect) return '';
                  const target = new URL(redirect);
                  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
                    return '';
                  }
                  if (isGoogleHost(target.hostname)) {
                    return '';
                  }
                  return target.href;
                }

                return parsed.href;
              } catch {
                return '';
              }
            }

            const aiContainer = document.querySelector('div[data-subtree="aimc"]');
            if (!aiContainer) return 0;
            const links = aiContainer.querySelectorAll('a[href^="http"]');
            const seen = new Set();
            let count = 0;
            links.forEach(link => {
              const href = normalizeLink(link.href);
              if (href && !seen.has(href)) {
                seen.add(href);
                count++;
              }
            });
            return count;
          })()
        `) as number;

        if (hasFollowUp && currentLength >= minContentLength) {
          if (sourceCount >= 1) {
            console.error(
              `检测到追问建议，AI 输出完成，内容长度: ${currentLength}，来源数: ${sourceCount}`
            );
          } else {
            console.error(
              `检测到追问建议，内容长度: ${currentLength}，来源数: ${sourceCount}，按降级策略提前返回`
            );
          }
          return true;
        }

        if (hasLoadingIndicator || isLoading) {
          stableCount = 0;
        } else if (currentLength === lastContentLength) {
          if (currentLength >= minContentLength) {
            stableCount++;
            if (stableCount >= stableThreshold) {
              if (sourceCount >= 1) {
                console.error(`AI 输出完成，内容长度: ${currentLength}，来源数: ${sourceCount}`);
                return true;
              } else {
                console.error(
                  `内容已稳定但来源链接不足 (${sourceCount})，按降级策略返回以避免超时`
                );
                return true;
              }
            }
          }
        } else {
          stableCount = 0;
        }

        lastContentLength = currentLength;
        await page.waitForTimeout(checkInterval);
      } catch (error) {
        console.error(`等待输出时出错: ${error}`);
        break;
      }
    }

    console.error(`等待超时（${maxWaitSeconds}秒）`);
    return false;
  }


  /**
   * 提取 AI 回答
   */
  private async extractAiAnswer(page: Page): Promise<SearchResult> {
    // 注意：在模板字符串中传递给 page.evaluate 的正则表达式需要双重转义
    // \\s 在 TypeScript 中变成 \s，但传给浏览器时需要 \\\\s 才能变成 \s
    const jsCode = `
    (() => {
      const result = {
        aiAnswer: '',
        sources: []
      };
      
      const mainContent = document.body.innerText;
      
      // 多语言支持：AI 模式标签
      const aiModeLabels = ['AI 模式', 'AI Mode', 'AI モード', 'AI 모드', 'KI-Modus', 'Mode IA'];
      // 多语言支持：搜索结果标签
      const searchResultLabels = ['搜索结果', 'Search Results', '検索結果', '검색결과', 'Suchergebnisse', 'Résultats de recherche'];
      // 多语言支持：内容结束标记
      const endMarkers = [
        '相关搜索', 'Related searches', '関連する検索', '관련 검색',
        '意见反馈', 'Send feedback', 'フィードバックを送信',
        '帮助', 'Help', 'ヘルプ',
        '隐私权', 'Privacy', 'プライバシー',
        '条款', 'Terms', '利用規約',
      ];
      
      // 需要清理的导航文本（使用字符串替换，避免正则转义问题）
      const navStrings = [
        'AI 模式',
        '全部图片视频新闻更多',
        '全部 图片 视频 新闻 更多',
        '全部\\n图片\\n视频\\n新闻\\n更多',
        '登录',
        'AI 的回答未必正确无误，请注意核查',
        'AI 回答可能包含错误。 了解详情',
        'AI 回答可能包含错误。了解详情',
        '请谨慎使用此类代码。',
        '请谨慎使用此类代码',
        'Use code with caution.',
        'Use code with caution',
        '全部显示',
        '查看相关链接',
        '关于这条结果',
        'AI Mode',
        'All Images Videos News More',
        'All\\nImages\\nVideos\\nNews\\nMore',
        'Sign in',
        'AI responses may include mistakes. Learn more',
        'AI responses may include mistakes.Learn more',
        'AI overview',
        'Show all',
        'View related links',
        'About this result',
        'Accessibility links',
        'Skip to main content',
        'Accessibility help',
        'Accessibility feedback',
        'Filters and topics',
        'AI Mode response is ready',
        'AI モード',
        'すべて 画像 動画 ニュース もっと見る',
        'すべて\\n画像\\n動画\\nニュース\\nもっと見る',
        'ログイン',
        'AI の回答には間違いが含まれている場合があります。 詳細',
        'すべて表示',
        'ユーザー補助のリンク',
        'メイン コンテンツにスキップ',
        'ユーザー補助ヘルプ',
        'ユーザー補助に関するフィードバック',
        'フィルタとトピック',
        'AI モードの回答が作成されました',
        '无障碍功能链接',
        '跳到主要内容',
        '无障碍功能帮助',
        '无障碍功能反馈',
        '过滤条件和主题',
      ];
      
      // 需要单独清理的单词（每行一个的情况）
      const singleNavWords = [
        '全部', '图片', '视频', '新闻', '更多',
        'All', 'Images', 'Videos', 'News', 'More',
        'すべて', '画像', '動画', 'ニュース', 'もっと見る',
      ];
      
      // 需要清理的正则模式（数字+网站）
      const numSitesPatterns = [
        /\\d+\\s*个网站/g,
        /\\d+\\s*sites?/gi,
        /\\d+\\s*件のサイト/g,
      ];
      
      const MAX_CONTENT_LENGTH = 50000;
      
      function findEndIndex(startPos) {
        let endIdx = Math.min(mainContent.length, startPos + MAX_CONTENT_LENGTH);
        for (const marker of endMarkers) {
          const idx = mainContent.indexOf(marker, startPos);
          if (idx !== -1 && idx < endIdx) {
            endIdx = idx;
          }
        }
        return endIdx;
      }
      
      function cleanAnswer(text) {
        let cleaned = text;
        // 字符串替换
        for (const str of navStrings) {
          cleaned = cleaned.split(str).join('');
        }
        
        // 清理开头的单独导航词（每行一个的情况）
        // 只清理文本开头连续出现的导航词
        const lines = cleaned.split('\\n');
        let startIndex = 0;
        for (let i = 0; i < Math.min(lines.length, 10); i++) {
          const line = lines[i].trim();
          if (singleNavWords.includes(line) || line === '') {
            startIndex = i + 1;
          } else {
            break;
          }
        }
        if (startIndex > 0) {
          cleaned = lines.slice(startIndex).join('\\n');
        }
        
        // 正则替换（数字+网站）
        for (const pattern of numSitesPatterns) {
          cleaned = cleaned.replace(pattern, '');
        }
        // 清理多余空行
        cleaned = cleaned.replace(/\\n{3,}/g, '\\n\\n');
        return cleaned.trim();
      }
      
      // 优先从 AI 容器提取，避免只截到页面顶部欢迎语
      const candidateSelectors = [
        'div[data-subtree="aimc"]',
        'div[data-attrid="wa:/m/0"]',
        '[data-async-type="editableDirectAnswer"]',
        '.wDYxhc',
      ];
      let containerAnswer = '';
      for (const selector of candidateSelectors) {
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
          const raw = (node && ((node.innerText || node.textContent || ''))) || '';
          if (!raw || raw.trim().length === 0) continue;
          const cleaned = cleanAnswer(raw);
          if (cleaned.length > containerAnswer.length) {
            containerAnswer = cleaned;
          }
        }
      }

      // 查找 AI 回答区域的起始位置
      let aiModeIndex = -1;
      for (const label of aiModeLabels) {
        const idx = mainContent.indexOf(label);
        if (idx !== -1) {
          aiModeIndex = idx;
          break;
        }
      }
      
      // 查找搜索结果区域的起始位置
      let searchResultIndex = -1;
      for (const label of searchResultLabels) {
        const idx = mainContent.indexOf(label);
        if (idx !== -1 && (searchResultIndex === -1 || idx < searchResultIndex)) {
          if (aiModeIndex === -1 || idx > aiModeIndex) {
            searchResultIndex = idx;
          }
        }
      }

      let fallbackAnswer = '';
      if (aiModeIndex !== -1 && searchResultIndex !== -1) {
        fallbackAnswer = cleanAnswer(mainContent.substring(aiModeIndex, searchResultIndex));
      } else if (aiModeIndex !== -1) {
        const endIndex = findEndIndex(aiModeIndex + 100);
        fallbackAnswer = cleanAnswer(mainContent.substring(aiModeIndex, endIndex));
      } else {
        const endIndex = findEndIndex(100);
        fallbackAnswer = cleanAnswer(mainContent.substring(0, endIndex));
      }

      result.aiAnswer =
        containerAnswer.length >= 40
          ? containerAnswer
          : (containerAnswer.length > fallbackAnswer.length ? containerAnswer : fallbackAnswer);
      
      // 提取来源链接（从 AI 模式容器中提取）
      const aiContainer = document.querySelector('div[data-subtree="aimc"]');
      const linkContainer = aiContainer || document;
      const links = linkContainer.querySelectorAll('a[href^="http"]');
      const seenUrls = new Set();

      function isGoogleHost(hostname) {
        const host = (hostname || '').toLowerCase();
        return (
          host.includes('google.') ||
          host.includes('gstatic.com') ||
          host.includes('googleapis.com')
        );
      }

      function resolveSourceHref(rawHref) {
        if (!rawHref) return '';
        try {
          const parsed = new URL(rawHref);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return '';
          }

          if (isGoogleHost(parsed.hostname)) {
            const redirect = parsed.searchParams.get('url') || parsed.searchParams.get('q') || '';
            if (!redirect) return '';

            const target = new URL(redirect);
            if (target.protocol !== 'http:' && target.protocol !== 'https:') {
              return '';
            }
            if (isGoogleHost(target.hostname)) {
              return '';
            }
            return target.href;
          }

          return parsed.href;
        } catch {
          return '';
        }
      }
      
      links.forEach(link => {
        const href = resolveSourceHref(link.href);
        if (!href) {
          return;
        }
        
        if (seenUrls.has(href)) {
          return;
        }
        
        // 获取链接文本（尝试多种方式）
        let text = link.textContent?.trim() || '';
        
        // 如果链接文本为空，尝试从父元素获取
        if (text.length < 5) {
          const parent = link.parentElement;
          if (parent) {
            text = parent.textContent?.trim() || '';
          }
        }
        
        // 如果还是太短，尝试从 aria-label 或 title 属性获取
        if (text.length < 5) {
          text = link.getAttribute('aria-label') || link.getAttribute('title') || '';
        }
        
        // 从 URL 提取域名作为备用标题
        if (text.length < 5) {
          try {
            const url = new URL(href);
            text = url.hostname.replace('www.', '');
          } catch {
            text = href.substring(0, 50);
          }
        }
        
        seenUrls.add(href);
        
        if (result.sources.length < 10) {
          result.sources.push({
            title: text.substring(0, 200),
            url: href,
            snippet: ''
          });
        }
      });
      
      return result;
    })()
    `;

    try {
      const data = (await page.evaluate(jsCode)) as {
        aiAnswer: string;
        sources: { title: string; url: string; snippet: string }[];
      } | undefined;

      if (!data) {
        return {
          success: false,
          query: "",
          aiAnswer: "",
          sources: [],
          error: "页面内容提取失败，可能需要登录 Google 账户",
        };
      }

      const sources: SearchSource[] = (data.sources || []).map((s) => ({
        title: s.title || "",
        url: s.url || "",
        snippet: s.snippet || "",
      }));

      return {
        success: true,
        query: "",
        aiAnswer: data.aiAnswer || "",
        sources,
        error: "",
      };
    } catch (error) {
      return {
        success: false,
        query: "",
        aiAnswer: "",
        sources: [],
        error: `提取内容失败: ${error}`,
      };
    }
  }

  /**
   * 处理验证码 - 弹出有界面的浏览器让用户完成验证
   * 使用全局锁防止多个请求同时打开多个浏览器窗口
   */
  private async handleCaptcha(
    url: string,
    query: string
  ): Promise<SearchResult> {
    const result: SearchResult = {
      success: false,
      query,
      aiAnswer: "",
      sources: [],
      error: "",
    };

    // 尝试获取 CAPTCHA 锁（原子操作）
    const lockResult = await tryAcquireCaptchaLock();
    
    if (lockResult === "wait") {
      // 其他请求已完成 CAPTCHA 处理，重新尝试搜索
      log("CAPTCHA", "CAPTCHA 已被其他请求处理，通知调用者重试");
      await this.close();
      result.error = "CAPTCHA_HANDLED_BY_OTHER_REQUEST";
      return result;
    }
    
    if (lockResult === "timeout") {
      log("CAPTCHA", "等待 CAPTCHA 处理超时");
      result.error = "等待验证超时，请稍后重试";
      return result;
    }

    // lockResult === "acquired"，继续处理 CAPTCHA
    log("CAPTCHA", "检测到验证码，正在打开浏览器窗口...");
    log("CAPTCHA", "请在浏览器中完成验证码验证，最长等待 5 分钟");

    // 关闭当前的 headless 浏览器
    await this.close();

    if (this.shouldUseNodriverAuth()) {
      log("CAPTCHA", "优先使用 nodriver 执行人工验证流程...");
      try {
        const nodriverResult = await this.runNodriverAuthFlow(url);
        if (nodriverResult.success && nodriverResult.stateSaved) {
          result.error = "验证已完成，请重新搜索";
          log("CAPTCHA", `nodriver 验证成功: ${nodriverResult.message}`);
          releaseCaptchaLock();
          return result;
        }
        log(
          "CAPTCHA",
          `nodriver 验证失败，将回退 Playwright 验证窗口: ${nodriverResult.message}`
        );
      } catch (error) {
        log("CAPTCHA", `nodriver 验证流程异常，将回退 Playwright: ${error}`);
      }
    }

    try {
      const executablePath = this.findBrowser();
      log("CAPTCHA", `使用浏览器: ${executablePath}`);
      const proxy = await this.detectProxy();
      const launchOptions = this.buildLaunchOptions(executablePath, false, proxy);

      if (proxy) {
        log("CAPTCHA", `使用代理: ${proxy}`);
      }

      const browser = await chromium.launch(launchOptions);
      log("CAPTCHA", "浏览器已启动");

      const storageStatePath = this.getStorageStatePath();
      const contextOptions = this.buildHeadedContextOptions(storageStatePath);
      if (contextOptions.storageState) {
        log("CAPTCHA", `加载已有认证状态: ${storageStatePath}`);
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      log("CAPTCHA", `导航到: ${url}`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      const maxWaitMs = 5 * 60 * 1000;
      const checkInterval = 1500; // 缩短检查间隔，更快响应验证成功
      const startTime = Date.now();
      let captchaPassedTime = 0; // 记录验证码通过的时间
      const postCaptchaWaitMs = 15000; // 验证通过后额外等待 15 秒让页面加载

      log("CAPTCHA", "浏览器窗口已打开，等待用户完成验证...");

      while (Date.now() - startTime < maxWaitMs) {
        try {
          // 不再频繁保存状态，避免弹窗问题

          let content: string;
          let currentUrl: string;
          try {
            content = (await page.evaluate("document.body.innerText")) as string;
            currentUrl = page.url();
          } catch (evalError) {
            // 页面可能正在导航，等待后重试
            await page.waitForTimeout(1000);
            continue;
          }

          const isProblemPage =
            this.isCaptchaPage(content) ||
            currentUrl.toLowerCase().includes("sorry");

          // 检测验证码是否已通过（不再是问题页面）
          if (!isProblemPage && captchaPassedTime === 0) {
            captchaPassedTime = Date.now();
            log("CAPTCHA", "✅ 检测到验证码已通过！等待页面加载搜索结果...");
          }

          const hasAiModeIndicator =
            content.includes("AI 模式") || content.includes("AI Mode");
          const hasSubstantialContent = content.length > 2000;
          const isNotLoading =
            !content.includes("正在思考") && !content.includes("Thinking");
          const hasSearchResult =
            hasAiModeIndicator && hasSubstantialContent && isNotLoading;

          // 验证通过后，等待搜索结果
          if (!isProblemPage && hasSearchResult) {
            log("CAPTCHA", "验证成功！正在获取搜索结果...");

            // 等待 AI 输出完成
            await this.waitForStreamingComplete(page, 16);

            // 提取结果
            const extractedResult = await this.extractAiAnswer(page);
            result.aiAnswer = extractedResult.aiAnswer;
            result.sources = extractedResult.sources;
            result.success = result.aiAnswer.length > 0;

            // 只在成功时保存一次状态
            try {
              await context.storageState({ path: storageStatePath });
              log("CAPTCHA", `验证完成，已保存认证状态: ${storageStatePath}`);
            } catch {
              log("CAPTCHA", "保存认证状态失败");
            }

            break;
          }

          // 如果验证已通过但还没有搜索结果，检查是否需要刷新页面
          if (captchaPassedTime > 0 && !hasSearchResult) {
            const timeSinceCaptchaPassed = Date.now() - captchaPassedTime;
            
            // 验证通过后 5 秒还没有结果，尝试刷新页面
            if (timeSinceCaptchaPassed > 5000 && timeSinceCaptchaPassed < 6000) {
              log("CAPTCHA", "验证通过但未检测到搜索结果，尝试刷新页面...");
              try {
                await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
              } catch {
                log("CAPTCHA", "刷新页面超时，继续等待...");
              }
            }
            
            // 验证通过后超过 15 秒还没有结果，保存状态并退出
            if (timeSinceCaptchaPassed > postCaptchaWaitMs) {
              log("CAPTCHA", "验证已通过，但未能获取搜索结果。保存认证状态...");
              try {
                await context.storageState({ path: storageStatePath });
              } catch {
                // ignore
              }
              result.success = false;
              result.error = "验证已通过，请重新搜索";
              break;
            }
          }

          await page.waitForTimeout(checkInterval);
        } catch (error) {
          log("ERROR", `等待验证时出错: ${error}`);
          // 不要立即退出，可能只是页面导航中的临时错误
          await page.waitForTimeout(1000);
        }
      }

      if (!result.success && !result.error) {
        // 检查是否验证已通过但超时
        if (captchaPassedTime > 0) {
          log("CAPTCHA", "验证已通过，但获取搜索结果超时");
          result.error = "验证已通过，但获取搜索结果超时。认证状态已保存，请重新搜索。";
        } else {
          log("CAPTCHA", "验证超时或用户关闭了浏览器");
          result.error = "验证超时或用户关闭了浏览器";
        }
      }

      try {
        await context.close();
      } catch {
        // ignore
      }
      try {
        await browser.close();
      } catch {
        // ignore
      }
    } catch (error) {
      result.error = `验证码处理失败: ${error instanceof Error ? error.message : String(error)}`;
      log("ERROR", result.error);
      console.error(result.error);
    } finally {
      // 无论成功失败，都要释放 CAPTCHA 锁
      releaseCaptchaLock();
    }

    return result;
  }

  /**
   * 查找追问输入框
   */
  private async findFollowUpInput(): Promise<any | null> {
    const input = await this.pickBestVisibleInput(FOLLOW_UP_SELECTORS);
    if (input) {
      console.error("找到追问输入框");
      return input;
    }
    console.error("未找到追问输入框");
    return null;
  }

  private async pickBestVisibleInput(selectors: string[]): Promise<any | null> {
    if (!this.page) return null;

    let best: { element: any; score: number } | null = null;
    for (const selector of selectors) {
      try {
        const elements = await this.page.$$(selector);
        for (const element of elements) {
          if (!(await element.isVisible())) {
            continue;
          }
          const score = (await element.evaluate(`
            (el) => {
              const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0 };
              const inAiContainer = Boolean(el.closest && el.closest('div[data-subtree="aimc"]'));
              const tag = String(el.tagName || "").toLowerCase();
              const name = typeof el.name === "string" ? el.name : "";
              const isEditable = Boolean(el.isContentEditable);
              const editableBonus = isEditable ? 240 : tag === "textarea" ? 180 : 120;
              const lowerHalfBonus = rect.top > window.innerHeight * 0.45 ? 200 : 0;
              const inAiBonus = inAiContainer ? 1200 : 0;
              const nonQBonus = name === "q" ? 0 : 40;
              return inAiBonus + lowerHalfBonus + editableBonus + nonQBonus + Math.max(0, rect.top || 0);
            }
          `)) as number;
          if (!best || score > best.score) {
            best = { element, score };
          }
        }
      } catch {
        continue;
      }
    }
    return best?.element ?? null;
  }

  /**
   * 使用 JavaScript 检查是否有追问输入框
   */
  private async hasFollowUpInputViaJs(): Promise<boolean> {
    if (!this.page) return false;

    const jsFindInput = `
    () => {
      function isVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      const root = document.querySelector('div[data-subtree="aimc"]') || document;
      const candidates = root.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
      for (const candidate of candidates) {
        if (isVisible(candidate)) return true;
      }
      return false;
    }
    `;
    try {
      return (await this.page.evaluate(jsFindInput)) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * 使用 JavaScript 提交追问
   */
  private async submitFollowUpViaJs(query: string): Promise<boolean> {
    if (!this.page) return false;

    const jsFillAndSubmit = `
    (query) => {
      function isVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function isEnabled(element) {
        if (!element) return false;
        if ('disabled' in element && element.disabled) return false;
        if (element.getAttribute && element.getAttribute('aria-disabled') === 'true') return false;
        return true;
      }

      function rankInput(element) {
        const rect = element.getBoundingClientRect();
        const inAi = Boolean(element.closest('div[data-subtree="aimc"]'));
        const name = element.name || '';
        const lowerHalf = rect.top > window.innerHeight * 0.45 ? 200 : 0;
        return (inAi ? 10000 : 0) + lowerHalf + rect.top + (name === 'q' ? 0 : 30);
      }

      function collectInputs(root) {
        const selectors = 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]';
        const inputs = Array.from((root || document).querySelectorAll(selectors));
        return inputs.filter((input) => isVisible(input) && isEnabled(input));
      }

      function tryClickSendButton(scope) {
        const hints = ["send", "submit", "发送", "提交", "ask", "提问", "询问", "follow"];
        const excludeHints = [
          "开始新的搜索",
          "new search",
          "重新搜索",
          "clear",
          "重置",
          "删除",
          "移除",
          "关闭",
          "上传",
          "更多输入",
        ];

        function isDangerousAction(element) {
          const parts = [
            element.getAttribute("aria-label") || "",
            element.getAttribute("title") || "",
            element.textContent || "",
          ].join(" ").toLowerCase();
          return excludeHints.some((hint) => parts.includes(hint));
        }

        function isLikelySubmit(element) {
          const parts = [
            element.getAttribute("aria-label") || "",
            element.getAttribute("title") || "",
            element.getAttribute("name") || "",
            element.getAttribute("data-testid") || "",
            element.textContent || "",
          ].join(" ").toLowerCase();
          return hints.some((hint) => parts.includes(hint));
        }

        const selectors = [
          'button[aria-label*="发送"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="submit"]',
          'button[aria-label*="提交"]',
          '[role="button"][aria-label*="提交"]',
          '[role="button"][aria-label*="发送"]',
          '[role="button"][aria-label*="Send"]',
          '[role="button"][aria-label*="submit"]',
          'button[type="submit"]',
        ];
        for (const selector of selectors) {
          const candidates = Array.from((scope || document).querySelectorAll(selector));
          for (const btn of candidates) {
            if (!isVisible(btn)) continue;
            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
            if (isDangerousAction(btn)) continue;
            btn.click();
            return true;
          }
        }

        const looseCandidates = Array.from((scope || document).querySelectorAll('button, [role="button"]'));
        const visibleEnabled = looseCandidates.filter(
          (btn) => isVisible(btn) && isEnabled(btn) && isLikelySubmit(btn) && !isDangerousAction(btn)
        );
        if (visibleEnabled.length > 0) {
          visibleEnabled.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return (rectB.right + rectB.top) - (rectA.right + rectA.top);
          });
          visibleEnabled[0].click();
          return true;
        }
        return false;
      }

      function setTextareaValue(target, value) {
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(target, value);
        } else {
          target.value = value;
        }
      }

      const aiRoot = document.querySelector('div[data-subtree="aimc"]') || document;
      let candidates = collectInputs(aiRoot);
      if (!candidates.length) {
        candidates = collectInputs(document);
      }
      candidates.sort((a, b) => rankInput(b) - rankInput(a));

      for (const target of candidates) {
        target.focus();
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
          setTextareaValue(target, query);
        } else {
          target.textContent = query;
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));

        const localScope = target.closest('form') || target.closest('div[data-subtree="aimc"]') || aiRoot;
        if (tryClickSendButton(localScope) || tryClickSendButton(aiRoot) || tryClickSendButton(document)) {
          return true;
        }
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        if (tryClickSendButton(localScope) || tryClickSendButton(document)) {
          return true;
        }
        return true;
      }

      return false;
    }
    `;
    try {
      return (await this.page.evaluate(jsFillAndSubmit, query)) as boolean;
    } catch (error) {
      console.error(`JavaScript 提交失败: ${error}`);
      return false;
    }
  }

  private async findPromptInput(): Promise<any | null> {
    return this.pickBestVisibleInput(PROMPT_INPUT_SELECTORS);
  }

  private async clickPromptSubmitButton(scopeInput?: any): Promise<boolean> {
    if (!this.page) return false;

    // 优先在当前输入框附近点击，避免误点到页面工具栏按钮。
    if (scopeInput) {
      try {
        const clicked = (await scopeInput.evaluate(
          `
          (input, payload) => {
            const selectors = Array.isArray(payload?.selectors) ? payload.selectors : [];
            const hints = Array.isArray(payload?.hints) ? payload.hints : [];
            const excludeHints = Array.isArray(payload?.excludeHints)
              ? payload.excludeHints
              : [];
            function isVisible(element) {
              const style = window.getComputedStyle(element);
              if (style.visibility === "hidden" || style.display === "none") return false;
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }
            function isEnabled(element) {
              if (!element) return false;
              if (element.getAttribute("aria-disabled") === "true") return false;
              if ("disabled" in element && element.disabled) return false;
              return true;
            }
            function isLikelySubmit(element) {
              const parts = [
                element.getAttribute("aria-label") || "",
                element.getAttribute("title") || "",
                element.getAttribute("name") || "",
                element.getAttribute("data-testid") || "",
                element.textContent || "",
              ].join(" ").toLowerCase();
              return hints.some((hint) => parts.includes(hint));
            }
            function isDangerousAction(element) {
              const parts = [
                element.getAttribute("aria-label") || "",
                element.getAttribute("title") || "",
                element.textContent || "",
              ].join(" ").toLowerCase();
              return excludeHints.some((hint) => parts.includes(hint));
            }

            const localScope =
              input.closest("form") ||
              input.closest("div[data-subtree='aimc']") ||
              document.querySelector("div[data-subtree='aimc']") ||
              document;

            for (const selector of selectors) {
              let buttons = [];
              try {
                buttons = Array.from(localScope.querySelectorAll(selector));
              } catch {
                continue;
              }
              for (const button of buttons) {
                if (!isVisible(button) || !isEnabled(button)) continue;
                if (isDangerousAction(button)) continue;
                button.click();
                return true;
              }
            }

            const looseButtons = Array.from(
              localScope.querySelectorAll("button, [role='button']")
            ).filter(
              (button) =>
                isVisible(button) &&
                isEnabled(button) &&
                isLikelySubmit(button) &&
                !isDangerousAction(button)
            );

            if (!looseButtons.length) {
              const iconButtons = Array.from(
                localScope.querySelectorAll("button, [role='button']")
              ).filter((button) => {
                if (!isVisible(button) || !isEnabled(button)) return false;
                if (isDangerousAction(button)) return false;
                const inputText = (
                  input.value ||
                  input.textContent ||
                  input.innerText ||
                  ""
                ).trim();
                if (!inputText) return false;
                const label = [
                  button.getAttribute("aria-label") || "",
                  button.getAttribute("title") || "",
                  button.textContent || "",
                ].join(" ").trim();
                const hasSvg = Boolean(button.querySelector("svg"));
                return hasSvg && label.length === 0;
              });
              if (!iconButtons.length) {
                return false;
              }
              iconButtons.sort((a, b) => {
                const rectA = a.getBoundingClientRect();
                const rectB = b.getBoundingClientRect();
                const bgA = window.getComputedStyle(a).backgroundColor || "";
                const bgB = window.getComputedStyle(b).backgroundColor || "";
                const scoreA =
                  rectA.right +
                  rectA.bottom +
                  ((bgA === "rgba(0, 0, 0, 0)" || bgA === "transparent") ? 0 : 5000);
                const scoreB =
                  rectB.right +
                  rectB.bottom +
                  ((bgB === "rgba(0, 0, 0, 0)" || bgB === "transparent") ? 0 : 5000);
                return scoreB - scoreA;
              });
              iconButtons[0].click();
              return true;
            }

            looseButtons.sort((a, b) => {
              const rectA = a.getBoundingClientRect();
              const rectB = b.getBoundingClientRect();
              return rectB.right + rectB.bottom - (rectA.right + rectA.bottom);
            });
            looseButtons[0].click();
            return true;
          }
          `,
          {
            selectors: PROMPT_SUBMIT_BUTTON_SELECTORS,
            hints: SUBMIT_BUTTON_HINTS,
            excludeHints: SUBMIT_BUTTON_EXCLUDE_HINTS,
          }
        )) as boolean;
        if (clicked) {
          return true;
        }
      } catch {
        // ignore
      }
    }

    for (const selector of PROMPT_SUBMIT_BUTTON_SELECTORS) {
      try {
        const buttons = await this.page.$$(selector);
        for (const button of buttons) {
          if (!(await button.isVisible())) {
            continue;
          }
          if ((await button.getAttribute("aria-disabled")) === "true") {
            continue;
          }
          const buttonMeta = `${(await button.getAttribute("aria-label")) || ""} ${(await button.getAttribute("title")) || ""} ${(await button.textContent()) || ""}`.toLowerCase();
          if (SUBMIT_BUTTON_EXCLUDE_HINTS.some((hint) => buttonMeta.includes(hint))) {
            continue;
          }
          await button.click({ timeout: 1500 });
          return true;
        }
      } catch {
        continue;
      }
    }

    try {
      const clicked = (await this.page.evaluate(
        `
        (hints) => {
          const excludeHints = [
            "开始新的搜索",
            "new search",
            "重新搜索",
            "clear",
            "重置",
            "删除",
            "移除",
            "关闭",
            "上传",
            "更多输入",
          ];
          function isVisible(element) {
            const style = window.getComputedStyle(element);
            if (style.visibility === "hidden" || style.display === "none") return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          function isEnabled(element) {
            if (element.getAttribute("aria-disabled") === "true") return false;
            if ("disabled" in element && element.disabled) return false;
            return true;
          }
          function isLikelySubmit(element) {
            const parts = [
              element.getAttribute("aria-label") || "",
              element.getAttribute("title") || "",
              element.getAttribute("name") || "",
              element.getAttribute("data-testid") || "",
              element.textContent || "",
            ].join(" ").toLowerCase();
            return hints.some((hint) => parts.includes(hint));
          }
          function isDangerousAction(element) {
            const parts = [
              element.getAttribute("aria-label") || "",
              element.getAttribute("title") || "",
              element.textContent || "",
            ].join(" ").toLowerCase();
            return excludeHints.some((hint) => parts.includes(hint));
          }

          const aiRoot = document.querySelector("div[data-subtree='aimc']") || document;
          const candidates = Array.from(
            aiRoot.querySelectorAll("button, [role='button']")
          ).filter(
            (button) =>
              isVisible(button) &&
              isEnabled(button) &&
              isLikelySubmit(button) &&
              !isDangerousAction(button)
          );

          if (!candidates.length) {
            const iconButtons = Array.from(
              aiRoot.querySelectorAll("button, [role='button']")
            ).filter((button) => {
              if (!isVisible(button) || !isEnabled(button)) return false;
              if (isDangerousAction(button)) return false;
              const label = [
                button.getAttribute("aria-label") || "",
                button.getAttribute("title") || "",
                button.textContent || "",
              ].join(" ").trim();
              const hasSvg = Boolean(button.querySelector("svg"));
              return hasSvg && label.length === 0;
            });
            if (!iconButtons.length) {
              return false;
            }
            iconButtons.sort((a, b) => {
              const rectA = a.getBoundingClientRect();
              const rectB = b.getBoundingClientRect();
              const bgA = window.getComputedStyle(a).backgroundColor || "";
              const bgB = window.getComputedStyle(b).backgroundColor || "";
              const scoreA =
                rectA.right +
                rectA.bottom +
                ((bgA === "rgba(0, 0, 0, 0)" || bgA === "transparent") ? 0 : 5000);
              const scoreB =
                rectB.right +
                rectB.bottom +
                ((bgB === "rgba(0, 0, 0, 0)" || bgB === "transparent") ? 0 : 5000);
              return scoreB - scoreA;
            });
            iconButtons[0].click();
            return true;
          }

          candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectB.right + rectB.bottom - (rectA.right + rectA.bottom);
          });
          candidates[0].click();
          return true;
        }
        `,
        SUBMIT_BUTTON_HINTS
      )) as boolean;
      return Boolean(clicked);
    } catch {
      return false;
    }
  }

  private async hasVisiblePromptSendButton(): Promise<boolean> {
    if (!this.page) return false;
    for (const selector of IMAGE_PROMPT_SEND_BUTTON_SELECTORS) {
      try {
        const buttons = await this.page.$$(selector);
        for (const button of buttons) {
          if (!(await button.isVisible())) {
            continue;
          }
          if ((await button.getAttribute("aria-disabled")) === "true") {
            continue;
          }
          const meta = `${(await button.getAttribute("aria-label")) || ""} ${(await button.textContent()) || ""}`.toLowerCase();
          if (SUBMIT_BUTTON_EXCLUDE_HINTS.some((hint) => meta.includes(hint))) {
            continue;
          }
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async hasAnyPromptSendButton(): Promise<boolean> {
    if (!this.page) return false;
    for (const selector of IMAGE_PROMPT_SEND_BUTTON_SELECTORS) {
      try {
        const buttons = await this.page.$$(selector);
        for (const button of buttons) {
          if (!(await button.isVisible())) {
            continue;
          }
          const meta = `${(await button.getAttribute("aria-label")) || ""} ${(await button.textContent()) || ""}`.toLowerCase();
          if (SUBMIT_BUTTON_EXCLUDE_HINTS.some((hint) => meta.includes(hint))) {
            continue;
          }
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async submitPrompt(query: string): Promise<boolean> {
    if (!this.page) return false;
    const trimmed = query.trim();
    if (!trimmed) return false;

    const input = await this.findPromptInput();
    if (input) {
      try {
        await input.click({ timeout: 1500 });
        await this.page.waitForTimeout(180);
        try {
          await input.fill(trimmed, { timeout: 2500 });
        } catch {
          await input.evaluate(
            `
            (el, text) => {
              if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
                el.value = text;
              } else if (el.isContentEditable) {
                el.textContent = text;
              }
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            `,
            trimmed
          );
        }
        await this.page.waitForTimeout(180);
        let submittedByButton = false;
        let submittedByKeyboard = false;
        try {
          await input.press("Enter", { timeout: 1000 });
          submittedByKeyboard = true;
        } catch {
          // ignore
        }
        for (let i = 0; i < 5; i++) {
          const clicked = await this.clickPromptSubmitButton(input);
          submittedByButton = clicked || submittedByButton;
          if (clicked) {
            break;
          }
          await this.page.waitForTimeout(220);
        }
        try {
          if (typeof input.inputValue === "function") {
            const remaining = (await input.inputValue()) as string;
            if (remaining.trim().length > 0) {
              for (let i = 0; i < 5; i++) {
                const clicked = await this.clickPromptSubmitButton(input);
                submittedByButton = clicked || submittedByButton;
                if (clicked) {
                  break;
                }
                await this.page.waitForTimeout(220);
              }
            }
          }
        } catch {
          // ignore
        }
        return submittedByKeyboard || submittedByButton;
      } catch {
        // Try JS fallback.
      }
    }

    try {
      const jsSubmitPrompt = `
      (text) => {
        function isVisible(element) {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        const aiRoot = document.querySelector('div[data-subtree="aimc"]') || document;
        const candidates = Array.from(aiRoot.querySelectorAll("textarea, input[type='text'], [contenteditable='true'], [role='textbox']"));
        for (const element of candidates) {
          if (!isVisible(element)) continue;
          element.focus();
          if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
            element.value = text;
          } else {
            element.textContent = text;
          }
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true }));
          return true;
        }
        return false;
      }
      `;
      const submitted = (await this.page.evaluate(jsSubmitPrompt, trimmed)) as boolean;
      if (submitted) {
        await this.page.waitForTimeout(150);
        const hasSendButton = await this.hasVisiblePromptSendButton();
        const hasAnySendButton = hasSendButton || (await this.hasAnyPromptSendButton());
        if (!hasAnySendButton) {
          return true;
        }
        if (!hasSendButton) {
          return false;
        }
        const clicked = await this.clickPromptSubmitButton();
        return Boolean(clicked);
      }
      return this.clickPromptSubmitButton();
    } catch {
      return this.clickPromptSubmitButton();
    }
  }

  private async debugPromptControls(reason: string): Promise<void> {
    if (!this.page) return;
    try {
      const snapshot = (await this.page.evaluate(`
        () => {
          function isVisible(element) {
            if (!element || !element.getBoundingClientRect) return false;
            const style = window.getComputedStyle(element);
            if (style.visibility === "hidden" || style.display === "none") return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }

          const inputs = Array.from(
            document.querySelectorAll("textarea, input[type='text'], input:not([type]), [contenteditable='true'], [role='textbox']")
          )
            .filter((el) => isVisible(el))
            .slice(0, 6)
            .map((el) => ({
              tag: el.tagName,
              aria: el.getAttribute("aria-label") || "",
              placeholder: el.getAttribute("placeholder") || "",
              name: el.getAttribute("name") || "",
              type: el.getAttribute("type") || "",
              top: Math.round(el.getBoundingClientRect().top || 0),
            }));

          const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
            .filter((el) => isVisible(el))
            .map((el) => ({
              aria: el.getAttribute("aria-label") || "",
              text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 36),
              top: Math.round(el.getBoundingClientRect().top || 0),
            }))
            .filter((el) =>
              /发送|send|submit|提交|开始|ask|提问|问/.test((el.aria || "") + (el.text || ""))
            )
            .slice(0, 8);

          return {
            url: location.href,
            inputCount: inputs.length,
            buttonCount: buttons.length,
            inputs,
            buttons,
          };
        }
      `)) as {
        url: string;
        inputCount: number;
        buttonCount: number;
        inputs: Array<Record<string, string | number>>;
        buttons: Array<Record<string, string | number>>;
      };
      console.error(
        `提交诊断(${reason}): url=${snapshot.url}, inputs=${snapshot.inputCount}, buttons=${snapshot.buttonCount}, inputsDetail=${JSON.stringify(snapshot.inputs)}, buttonsDetail=${JSON.stringify(snapshot.buttons)}`
      );
    } catch (error) {
      console.error(`提交诊断失败(${reason}): ${error}`);
    }
  }

  private async submitImagePromptDirect(query: string): Promise<boolean> {
    if (!this.page) return false;
    const trimmed = query.trim();
    if (!trimmed) return false;

    const directInputSelectors = [
      'textarea[aria-label*="提问"]',
      'textarea[placeholder*="提问"]',
      'textarea[aria-label*="问"]',
      'textarea[placeholder*="问"]',
      '[role="textbox"][aria-label*="提问"]',
      '[role="textbox"][aria-label*="问"]',
      "textarea",
    ];

    for (const selector of directInputSelectors) {
      if (!this.page) return false;
      let inputs: any[] = [];
      try {
        inputs = await this.page.$$(selector);
      } catch {
        continue;
      }

      for (const input of inputs) {
        if (!this.page) return false;
        try {
          if (!(await input.isVisible())) {
            continue;
          }
          await this.safeClickElement(input, 1500);
          await this.page.waitForTimeout(120);

          try {
            await input.fill("", { timeout: 1200 });
          } catch {
            // ignore
          }

          try {
            await input.fill(trimmed, { timeout: 2000 });
          } catch {
            await input.evaluate(
              `
              (el, text) => {
                if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
                  el.value = text;
                } else {
                  el.textContent = text;
                }
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              }
              `,
              trimmed
            );
          }

          await this.page.waitForTimeout(180);
          let hasAnySendCandidate = false;

          for (const sendSelector of IMAGE_PROMPT_SEND_BUTTON_SELECTORS) {
            if (!this.page) return false;
            try {
              const buttons = await this.page.$$(sendSelector);
              for (const button of buttons) {
                if (!(await button.isVisible())) {
                  continue;
                }
                const meta = `${(await button.getAttribute("aria-label")) || ""} ${(await button.textContent()) || ""}`.toLowerCase();
                if (SUBMIT_BUTTON_EXCLUDE_HINTS.some((hint) => meta.includes(hint))) {
                  continue;
                }
                hasAnySendCandidate = true;
                if ((await button.getAttribute("aria-disabled")) === "true") {
                  continue;
                }
                if (await this.safeClickElement(button, 1200)) {
                  return true;
                }
              }
            } catch {
              continue;
            }
          }

          if (hasAnySendCandidate) {
            // 发送按钮已出现但仍禁用，说明上传/上下文尚未就绪。
            return false;
          }

          try {
            await input.press("Enter", { timeout: 1000 });
            return true;
          } catch {
            // ignore
          }
        } catch {
          continue;
        }
      }
    }

    return false;
  }

  private getImageUploadFlowBudgetMs(): number {
    const configured = Number(process.env.HUGE_AI_SEARCH_IMAGE_UPLOAD_FLOW_BUDGET_MS || "");
    if (Number.isFinite(configured) && configured >= 15000 && configured <= 120000) {
      return Math.floor(configured);
    }
    return 42000;
  }

  private getImageUploadWaitProfile(imagePath: string): ImageUploadWaitProfile {
    let fileSizeMb = 0;
    try {
      const stats = fs.statSync(imagePath);
      fileSizeMb = Math.max(0, stats.size / (1024 * 1024));
    } catch {
      fileSizeMb = 0;
    }

    let sizeMultiplier = 1;
    if (fileSizeMb >= 12) {
      sizeMultiplier = 2.5;
    } else if (fileSizeMb >= 8) {
      sizeMultiplier = 2.2;
    } else if (fileSizeMb >= 4) {
      sizeMultiplier = 1.7;
    } else if (fileSizeMb >= 2) {
      sizeMultiplier = 1.35;
    }

    const slowNetworkBoost = this.isTruthyEnv(process.env.HUGE_AI_SEARCH_SLOW_NETWORK)
      ? 1.45
      : 1;
    const configuredMultiplier = Number(
      process.env.HUGE_AI_SEARCH_IMAGE_UPLOAD_TIMEOUT_MULTIPLIER || ""
    );
    const userMultiplier =
      Number.isFinite(configuredMultiplier) &&
      configuredMultiplier >= 0.8 &&
      configuredMultiplier <= 3
        ? configuredMultiplier
        : 1;
    const multiplier = sizeMultiplier * slowNetworkBoost * userMultiplier;

    return {
      attachmentReadyMs: clampNumber(
        Math.round(IMAGE_UPLOAD_ATTACHMENT_READY_BASE_MS * multiplier),
        IMAGE_UPLOAD_ATTACHMENT_READY_BASE_MS,
        IMAGE_UPLOAD_MAX_ATTACHMENT_READY_MS
      ),
      uploadProgressMs: clampNumber(
        Math.round(IMAGE_UPLOAD_PROGRESS_BASE_MS * multiplier),
        IMAGE_UPLOAD_PROGRESS_BASE_MS,
        IMAGE_UPLOAD_MAX_PROGRESS_MS
      ),
      postUploadSettleMs: clampNumber(
        Math.round(IMAGE_UPLOAD_SETTLE_BASE_MS * multiplier),
        IMAGE_UPLOAD_SETTLE_BASE_MS,
        IMAGE_UPLOAD_MAX_SETTLE_MS
      ),
      fileSizeMb,
      multiplier,
    };
  }

  private async trySetImageInputFiles(
    imagePath: string,
    waitProfile: ImageUploadWaitProfile
  ): Promise<boolean> {
    if (!this.page) return false;

    for (const selector of IMAGE_FILE_INPUT_SELECTORS) {
      try {
        const inputs = await this.page.$$(selector);
        for (const input of inputs) {
          try {
            const beforeSnapshot = await this.snapshotFileInputs();
            await input.setInputFiles(imagePath, { timeout: 4000 });
            const accept = await input.getAttribute("accept") || "(无)";
            console.error(`setInputFiles 成功: selector='${selector}', accept='${accept}'`);
            if (
              (await this.waitForImageAttachmentReady(imagePath, waitProfile.attachmentReadyMs)) &&
              (await this.waitForUploadProgressDone(waitProfile.uploadProgressMs))
            ) {
              console.error("检测到附件就绪且上传进度已完成");
              return true;
            }
            if (await this.waitForFileInputMutation(beforeSnapshot, 2500)) {
              if (await this.waitForUploadProgressDone(waitProfile.uploadProgressMs)) {
                console.error(
                  `setInputFiles 后检测到输入结构变化且上传进度完成，按上传成功处理: selector='${selector}'`
                );
                return true;
              }
              console.error(
                `setInputFiles 后虽然检测到输入结构变化，但上传进度未完成: selector='${selector}'`
              );
            }
            console.error(`setInputFiles 后未检测到附件就绪: selector='${selector}'`);
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private async snapshotFileInputs(): Promise<FileInputSnapshot> {
    if (!this.page) {
      return {
        total: 0,
        imageAcceptInputs: 0,
        inputsWithFiles: 0,
      };
    }

    try {
      return (await this.page.evaluate(`
        (() => {
          const inputs = Array.from(document.querySelectorAll("input[type='file']"));
          let imageAcceptInputs = 0;
          let inputsWithFiles = 0;

          for (const input of inputs) {
            const accept = (input.getAttribute("accept") || "").toLowerCase();
            if (
              accept.includes("image") ||
              accept.includes(".png") ||
              accept.includes(".jpg") ||
              accept.includes(".jpeg") ||
              accept.includes(".webp")
            ) {
              imageAcceptInputs++;
            }
            const files = input.files ? Array.from(input.files) : [];
            if (files.length > 0) {
              inputsWithFiles++;
            }
          }

          return {
            total: inputs.length,
            imageAcceptInputs,
            inputsWithFiles,
          };
        })()
      `)) as FileInputSnapshot;
    } catch {
      return {
        total: 0,
        imageAcceptInputs: 0,
        inputsWithFiles: 0,
      };
    }
  }

  private async waitForFileInputMutation(
    baseline: FileInputSnapshot,
    maxWaitMs: number = 2500
  ): Promise<boolean> {
    if (!this.page) return false;

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!this.page) return false;
      const current = await this.snapshotFileInputs();

      if (current.inputsWithFiles > 0) {
        return true;
      }

      if (baseline.total > 0 && current.total === 0) {
        return true;
      }

      if (
        baseline.imageAcceptInputs > 0 &&
        current.imageAcceptInputs < baseline.imageAcceptInputs
      ) {
        return true;
      }

      await this.page.waitForTimeout(200);
    }

    return false;
  }

  private async safeClickElement(element: any, timeout: number = 1800): Promise<boolean> {
    try {
      await element.click({ timeout });
      return true;
    } catch {
      try {
        await element.evaluate((node: any) => node.click());
        return true;
      } catch {
        return false;
      }
    }
  }

  private async waitForUploadOptionsVisible(maxWaitMs: number = 1800): Promise<boolean> {
    if (!this.page) return false;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!this.page) return false;
      for (const selector of IMAGE_UPLOAD_OPTION_SELECTORS) {
        try {
          const options = await this.page.$$(selector);
          for (const option of options) {
            if (await option.isVisible()) {
              return true;
            }
          }
        } catch {
          continue;
        }
      }

      const snapshot = await this.snapshotFileInputs();
      if (snapshot.total > 0) {
        return true;
      }

      await this.page.waitForTimeout(120);
    }
    return false;
  }

  private async waitForImageAttachmentReady(
    imagePath: string,
    maxWaitMs: number = 7000
  ): Promise<boolean> {
    if (!this.page) return false;

    const expectedFileName = path.basename(imagePath).toLowerCase();
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (!this.page) return false;
      try {
        const ready = (await this.page.evaluate(
          `
          ({ expectedFileName, readySelectors }) => {
            function hasExpectedFile(input) {
              if (!input || input.tagName !== "INPUT") return false;
              if (input.type !== "file") return false;
              const files = input.files ? Array.from(input.files) : [];
              if (!files.length) return false;
              if (!expectedFileName) return true;
              return files.some((file) => {
                const name = (file?.name || "").toLowerCase();
                return name === expectedFileName || name.endsWith(expectedFileName);
              });
            }

            const aiRoot = document.querySelector("div[data-subtree='aimc']");
            if (aiRoot) {
              const scopedInputs = Array.from(aiRoot.querySelectorAll("input[type='file']"));
              if (scopedInputs.some((input) => hasExpectedFile(input))) {
                return true;
              }
            }

            const allInputs = Array.from(document.querySelectorAll("input[type='file']"));
            if (allInputs.some((input) => hasExpectedFile(input))) {
              return true;
            }

            for (const selector of readySelectors) {
              if (document.querySelector(selector)) {
                return true;
              }
            }

            if (expectedFileName) {
              const bodyText = (document.body?.innerText || "").toLowerCase();
              if (bodyText.includes(expectedFileName)) {
                return true;
              }
            }

            return false;
          }
          `,
          {
            expectedFileName,
            readySelectors: IMAGE_ATTACHMENT_READY_SELECTORS,
          }
        )) as boolean;
        if (ready) {
          return true;
        }
      } catch {
        // ignore
      }

      await this.page.waitForTimeout(250);
    }

    return false;
  }

  private async waitForUploadProgressDone(maxWaitMs: number = 12000): Promise<boolean> {
    if (!this.page) return false;

    const start = Date.now();
    let stableIdleMs = 0;
    while (Date.now() - start < maxWaitMs) {
      if (!this.page) return false;
      try {
        const uploading = (await this.page.evaluate(`
          (() => {
            function isVisible(element) {
              if (!element || !element.getBoundingClientRect) return false;
              const style = window.getComputedStyle(element);
              if (style.visibility === "hidden" || style.display === "none") return false;
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }

            const progressBars = Array.from(
              document.querySelectorAll("[role='progressbar']")
            );
            for (const bar of progressBars) {
              if (!isVisible(bar)) continue;
              const aria = (bar.getAttribute("aria-label") || "").toLowerCase();
              if (
                aria.includes("上传") ||
                aria.includes("uploading") ||
                aria.includes("upload")
              ) {
                return true;
              }
            }

            const text = (document.body?.innerText || "").toLowerCase();
            return (
              text.includes("正在上传文件") ||
              text.includes("正在上传") ||
              text.includes("uploading file")
            );
          })()
        `)) as boolean;

        if (!uploading) {
          stableIdleMs += 250;
          if (stableIdleMs >= 1200) {
            return true;
          }
        } else {
          stableIdleMs = 0;
        }
      } catch {
        // ignore
      }

      await this.page.waitForTimeout(250);
    }

    return false;
  }

  private async tryUploadViaFileChooser(
    trigger: any,
    imagePath: string,
    waitProfile: ImageUploadWaitProfile
  ): Promise<boolean> {
    if (!this.page) return false;

    try {
      const beforeSnapshot = await this.snapshotFileInputs();
      const fileChooserPromise = this.page
        .waitForEvent("filechooser", { timeout: 1800 })
        .catch(() => null);

      const clicked = await this.safeClickElement(trigger, 1800);
      if (!clicked) {
        return false;
      }
      const chooser = await fileChooserPromise;
      if (!chooser) {
        return false;
      }

      await chooser.setFiles(imagePath);
      console.error("通过 filechooser 上传图片");
      await this.page.waitForTimeout(Math.max(800, Math.floor(waitProfile.postUploadSettleMs / 2)));
      if (
        (await this.waitForImageAttachmentReady(imagePath, waitProfile.attachmentReadyMs)) &&
        (await this.waitForUploadProgressDone(waitProfile.uploadProgressMs))
      ) {
        console.error("filechooser 检测到附件就绪且上传进度已完成");
        return true;
      }
      if (await this.waitForFileInputMutation(beforeSnapshot, 2500)) {
        if (await this.waitForUploadProgressDone(waitProfile.uploadProgressMs)) {
          console.error("filechooser 上传后检测到输入结构变化且上传进度完成，按上传成功处理");
          return true;
        }
        console.error("filechooser 上传后输入结构变化，但上传进度未完成");
      }
      return false;
    } catch {
      return false;
    }
  }

  private async tryUploadViaVisibleOptions(
    imagePath: string,
    waitProfile: ImageUploadWaitProfile
  ): Promise<boolean> {
    if (!this.page) return false;

    for (const selector of IMAGE_UPLOAD_OPTION_SELECTORS) {
      if (!this.page) return false;
      try {
        const options = await this.page.$$(selector);
        for (const option of options) {
          if (!(await option.isVisible())) {
            continue;
          }
          console.error(`点击图片上传选项: ${selector}`);
          if (await this.tryUploadViaFileChooser(option, imagePath, waitProfile)) {
            return true;
          }
          if (!this.page) return false;
          await this.page.waitForTimeout(300);
          if (await this.trySetImageInputFiles(imagePath, waitProfile)) {
            console.error("通过上传选项点击后直接文件输入上传图片");
            if (this.page) await this.page.waitForTimeout(waitProfile.postUploadSettleMs);
            return true;
          }
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private async tryUploadViaMoreInputMenu(
    imagePath: string,
    waitProfile: ImageUploadWaitProfile
  ): Promise<boolean> {
    if (!this.page) return false;

    for (const selector of IMAGE_UPLOAD_MENU_TRIGGER_SELECTORS) {
      if (!this.page) return false;
      try {
        const triggers = await this.page.$$(selector);
        for (const trigger of triggers) {
          if (!(await trigger.isVisible())) {
            continue;
          }
          console.error(`点击图片上传菜单触发器: ${selector}`);
          const clicked = await this.safeClickElement(trigger, 1800);
          if (!clicked) {
            console.error(`点击图片上传菜单触发器失败: ${selector}`);
            continue;
          }
          if (!this.page) return false;
          await this.waitForUploadOptionsVisible(1800);

          if (await this.tryUploadViaVisibleOptions(imagePath, waitProfile)) {
            return true;
          }

          if (await this.trySetImageInputFiles(imagePath, waitProfile)) {
            console.error("通过打开上传菜单后直接文件输入上传图片");
            if (this.page) await this.page.waitForTimeout(waitProfile.postUploadSettleMs);
            return true;
          }
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private async uploadImageAttachment(imagePath: string): Promise<boolean> {
    if (!this.page) return false;

    const waitProfile = this.getImageUploadWaitProfile(imagePath);
    const flowBudgetMs = this.getImageUploadFlowBudgetMs();
    const startMs = Date.now();
    console.error(
      `图片上传等待策略: fileSize=${waitProfile.fileSizeMb.toFixed(2)}MB, multiplier=${waitProfile.multiplier.toFixed(2)}, ready=${waitProfile.attachmentReadyMs}ms, progress=${waitProfile.uploadProgressMs}ms, settle=${waitProfile.postUploadSettleMs}ms, flowBudget=${flowBudgetMs}ms`
    );

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (!this.page) return false;
      if (Date.now() - startMs >= flowBudgetMs) {
        console.error(`图片上传超出流程预算（${flowBudgetMs}ms），提前结束重试`);
        return false;
      }
      if (attempt > 0) {
        await this.page.waitForTimeout(500);
      }

      if (await this.trySetImageInputFiles(imagePath, waitProfile)) {
        console.error("通过直接文件输入上传图片");
        // 等待 Google 处理上传的图片
        if (this.page) await this.page.waitForTimeout(waitProfile.postUploadSettleMs);
        return true;
      }

      if (await this.tryUploadViaMoreInputMenu(imagePath, waitProfile)) {
        return true;
      }

      if (await this.tryUploadViaVisibleOptions(imagePath, waitProfile)) {
        return true;
      }
    }

    return false;
  }

  private normalizeAnswerText(text: string): string {
    return text.replace(/\s+/g, "").trim().toLowerCase();
  }

  private isDefaultGreetingAnswer(answer: string): boolean {
    const normalized = this.normalizeAnswerText(answer);
    if (!normalized) return true;
    return DEFAULT_AI_GREETING_PATTERNS.some((pattern) =>
      normalized.includes(this.normalizeAnswerText(pattern))
    );
  }

  private isPlaceholderImageAnswer(answer: string, baselineAnswer: string): boolean {
    const trimmed = answer.trim();
    if (!trimmed) return true;

    const normalized = this.normalizeAnswerText(trimmed);
    if (baselineAnswer && normalized === this.normalizeAnswerText(baselineAnswer)) {
      return true;
    }

    if (trimmed.length <= 80 && this.isDefaultGreetingAnswer(trimmed)) {
      return true;
    }

    return false;
  }

  private async waitForImageGenerationStart(
    page: Page,
    baselineAnswer: string,
    maxWaitSeconds: number = 6
  ): Promise<boolean> {
    for (let i = 0; i < maxWaitSeconds; i++) {
      if (!this.page) return false;
      try {
        await page.waitForTimeout(1000);
      } catch {
        return false;
      }
      const extracted = await this.extractAiAnswer(page);
      if (
        extracted.success &&
        !this.isPlaceholderImageAnswer(extracted.aiAnswer, baselineAnswer)
      ) {
        console.error(`检测到图片回答开始生成（第 ${i + 1} 秒）`);
        return true;
      }

      if (await this.checkLoadingIndicators(page)) {
        console.error(`检测到图片回答加载指示器（第 ${i + 1} 秒）`);
        return true;
      }

      try {
        const content = (await page.evaluate("document.body.innerText")) as string;
        if (AI_LOADING_KEYWORDS.some((kw) => content.includes(kw))) {
          console.error(`检测到图片回答加载关键词（第 ${i + 1} 秒）`);
          return true;
        }
      } catch {
        return false;
      }
    }

    return false;
  }

  private async waitForPromptInputReady(maxWaitMs: number = 5000): Promise<boolean> {
    if (!this.page) return false;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!this.page) return false;
      const input = await this.findPromptInput();
      if (input) {
        return true;
      }
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  private async submitImagePromptWithFallback(
    prompt: string,
    baselineAnswer: string
  ): Promise<boolean> {
    if (!this.page) return false;

    await this.waitForPromptInputReady(5000);
    let hasSubmitted = false;

    let submitted = await this.submitImagePromptDirect(prompt);
    if (!submitted) {
      console.error("直连提问框提交失败，尝试使用通用主输入框提交图片提示词");
      submitted = await this.submitPrompt(prompt);
      if (!submitted) {
        await this.debugPromptControls("首次提交失败");
        return false;
      }
    }
    hasSubmitted = true;

    if (!this.page) return false;
    if (await this.waitForImageGenerationStart(this.page, baselineAnswer, 6)) {
      return true;
    }

    if (!this.page) return false;
    console.error("首次提交后未检测到生成迹象，尝试二次主输入提交...");
    if (!(await this.submitImagePromptDirect(prompt))) {
      console.error("二次直连提问框提交失败，尝试主输入框再次提交...");
      if (!(await this.submitPrompt(prompt))) {
        await this.debugPromptControls("二次提交失败");
        if (hasSubmitted) {
          console.error("提示词已提交，但未检测到二次提交入口，继续后续提取流程");
          return true;
        }
        return false;
      }
    }
    hasSubmitted = true;

    if (!this.page) return false;
    await this.page.waitForTimeout(600);
    if (!this.page) return false;
    await this.waitForAiContent(this.page);
    if (!this.page) return false;
    if (await this.waitForImageGenerationStart(this.page, baselineAnswer, 5)) {
      return true;
    }

    if (hasSubmitted) {
      console.error("提示词已提交，但短时间内未检测到生成迹象，继续后续提取流程");
      return true;
    }
    return false;
  }

  private async waitForMeaningfulImageAnswer(
    page: Page,
    baselineAnswer: string,
    maxWaitSeconds: number = 12
  ): Promise<SearchResult | null> {
    for (let i = 0; i < maxWaitSeconds; i++) {
      if (!this.page) return null;
      try {
        await page.waitForTimeout(1000);
      } catch {
        return null;
      }
      const extracted = await this.extractAiAnswer(page);
      if (
        extracted.success &&
        !this.isPlaceholderImageAnswer(extracted.aiAnswer, baselineAnswer)
      ) {
        console.error(
          `检测到有效图片回答（第 ${i + 1} 秒），长度: ${extracted.aiAnswer.length}`
        );
        return extracted;
      }
    }

    return null;
  }

  /**
   * 从内容中移除用户问题
   */
  private removeUserQueryFromContent(content: string, query: string): string {
    if (!content || !query) return content;

    // 尝试精确匹配：问题在开头
    if (content.startsWith(query)) {
      const result = content.slice(query.length).trim();
      console.error(`移除用户问题（精确匹配）: '${query.slice(0, 30)}...'`);
      return result;
    }

    // 尝试模糊匹配
    const queryNormalized = query.trim();
    const contentStart = content.slice(0, queryNormalized.length + 50);

    const pos = contentStart.indexOf(queryNormalized);
    if (pos !== -1 && pos < 20) {
      const result = content.slice(pos + queryNormalized.length).trim();
      console.error(`移除用户问题（模糊匹配）: '${query.slice(0, 30)}...'`);
      return result;
    }

    return content;
  }

  /**
   * 执行搜索
   */
  async search(
    query: string,
    language: string = "zh-CN",
    imagePath?: string
  ): Promise<SearchResult> {
    const normalizedQuery = query.trim();
    // 确保 imagePath 是字符串类型，否则使用 undefined
    const normalizedImagePath = typeof imagePath === "string" ? imagePath.trim() : undefined;
    const hasImageInput = Boolean(normalizedImagePath);
    const imageDriverMode: ImageDriverMode = hasImageInput
      ? this.getImageDriverMode()
      : "playwright";
    const effectivePrompt = normalizedQuery;
    let absoluteImagePath: string | undefined;

    console.error("=".repeat(60));
    console.error(
      `开始搜索: query='${normalizedQuery}', language=${language}, image=${hasImageInput ? normalizedImagePath : "none"}`
    );
    if (hasImageInput) {
      console.error(`图片搜索驱动模式: ${imageDriverMode}`);
    }

    this.lastActivityTime = Date.now();

    const result: SearchResult = {
      success: false,
      query: normalizedQuery,
      aiAnswer: "",
      sources: [],
      error: "",
    };
    if (!normalizedQuery && !normalizedImagePath) {
      result.error = "缺少查询内容，请至少提供文本问题或图片路径";
      return result;
    }

    if (hasImageInput && !normalizedQuery) {
      result.error = "图片搜索必须同时提供文本问题（仅上传图片无法触发有效回复）";
      return result;
    }

    if (normalizedImagePath && !fs.existsSync(normalizedImagePath)) {
      result.error = `图片文件不存在: ${normalizedImagePath}`;
      return result;
    }

    if (
      hasImageInput &&
      normalizedImagePath &&
      (imageDriverMode === "nodriver" || imageDriverMode === "nodriver-only")
    ) {
      try {
        const nodriverAttemptTimeout = this.getNodriverImageAttemptTimeoutSeconds(imageDriverMode);
        const nodriverResult = await this.runNodriverImageSearch(
          effectivePrompt,
          language,
          normalizedImagePath,
          nodriverAttemptTimeout
        );
        if (nodriverResult.success) {
          this.lastAiAnswer = nodriverResult.aiAnswer;
          this.lastActivityTime = Date.now();
          return nodriverResult;
        }
        if (imageDriverMode === "nodriver-only") {
          return nodriverResult;
        }
        console.error(
          `nodriver 图片搜索失败（快速回退到 Playwright）: ${nodriverResult.error}`
        );
      } catch (error) {
        if (imageDriverMode === "nodriver-only") {
          result.error = `nodriver 图片搜索异常: ${error}`;
          return result;
        }
        console.error(`nodriver 图片搜索异常，快速回退 Playwright: ${error}`);
      }
    }

    try {
      // 确保会话
      if (!(await this.ensureSession(language))) {
        result.error = "无法启动浏览器";
        return result;
      }

      if (!this.page) {
        result.error = "页面未初始化";
        return result;
      }

      // 导航到搜索页面
      const url = hasImageInput
        ? this.buildAiModeUrl(language)
        : this.buildUrl(normalizedQuery, language);
      console.error(`导航到: ${url}`);

      try {
        await this.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.timeout * 1000,
        });
      } catch (gotoError) {
        console.error(`页面导航异常: ${gotoError}`);
        if (hasImageInput) {
          result.error = "图片搜索前页面加载失败，请检查网络后重试。";
          return result;
        }
        return await this.handleCaptcha(url, effectivePrompt);
      }

      // 等待 AI 内容加载
      await this.waitForAiContent(this.page);

      // 检测验证码
      const content = (await this.page.evaluate(
        "document.body.innerText"
      )) as string;
      if (this.isCaptchaPage(content)) {
        console.error("检测到验证码页面！");
        if (hasImageInput) {
          const captchaResult = await this.handleCaptcha(url, effectivePrompt);
          if (captchaResult.success) {
            result.error = "验证已完成，请重试当前图片搜索。";
            return result;
          }
          return captchaResult;
        }
        return await this.handleCaptcha(url, effectivePrompt);
      }

      let baselineAiAnswer = "";
      if (hasImageInput) {
        const baselineResult = await this.extractAiAnswer(this.page);
        baselineAiAnswer = baselineResult.aiAnswer || "";
        if (baselineAiAnswer) {
          console.error(`图片模式基线回答长度: ${baselineAiAnswer.length}`);
        }
      }

      if (normalizedImagePath) {
        absoluteImagePath = path.resolve(normalizedImagePath);
        const uploaded = await this.uploadImageAttachment(absoluteImagePath);
        if (!uploaded) {
          result.error = "未找到可用的图片上传入口（可能是页面未就绪或 Google 页面结构变更）。";
          return result;
        }
        console.error(`图片上传成功: ${absoluteImagePath}`);

        // 上传后记录页面状态用于调试
        if (this.page) {
          const postUploadUrl = this.page.url();
          console.error(`图片上传后页面 URL: ${postUploadUrl}`);
          if (postUploadUrl !== url) {
            console.error("检测到图片上传后页面 URL 变化，等待新页面加载...");
            try {
              await this.page.waitForLoadState("domcontentloaded", { timeout: 5000 });
            } catch {
              // ignore
            }
            await this.waitForAiContent(this.page);
          }
        }

        if (!this.page) {
          result.error = "图片搜索过程中页面已关闭（可能超时）。";
          return result;
        }

        const submitted = await this.submitImagePromptWithFallback(
          effectivePrompt,
          baselineAiAnswer
        );
        if (!submitted) {
          if (!this.page) {
            result.error = "图片搜索过程中页面已关闭（可能超时）。";
          } else {
            result.error =
              "图片已上传，但未能提交提示词（输入框或发送按钮不可用，可能是页面结构变化）。";
          }
          return result;
        } else {
          console.error(`已提交图片提示词: ${effectivePrompt}`);
          result.query = effectivePrompt;
        }

        if (!this.page) {
          result.error = "图片搜索过程中页面已关闭（可能超时）。";
          return result;
        }
        await this.page.waitForTimeout(1000);
        if (this.page) {
          await this.waitForAiContent(this.page);
        }
      }

      // 等待 AI 输出完成（优先保证在调用方 deadline 内返回）
      if (!this.page) {
        result.error = "搜索过程中页面已关闭（可能超时）。";
        return result;
      }
      const streamWaitSeconds = hasImageInput ? 22 : 10;
      await this.waitForStreamingComplete(this.page, streamWaitSeconds);

      // 短暂等待来源链接渲染（最佳努力，不阻塞过久）
      if (!this.page) {
        result.error = "搜索过程中页面已关闭（可能超时）。";
        return result;
      }
      console.error("短暂等待来源链接渲染（最多2秒）...");
      try {
        await this.page.waitForFunction(
          `(() => {
            function isGoogleHost(hostname) {
              const host = (hostname || "").toLowerCase();
              return host.includes('google.') || host.includes('gstatic.com') || host.includes('googleapis.com');
            }
            function normalizeLink(rawHref) {
              if (!rawHref) return '';
              try {
                const parsed = new URL(rawHref);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                  return '';
                }
                if (isGoogleHost(parsed.hostname)) {
                  const redirect = parsed.searchParams.get('url') || parsed.searchParams.get('q') || '';
                  if (!redirect) return '';
                  const target = new URL(redirect);
                  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
                    return '';
                  }
                  if (isGoogleHost(target.hostname)) {
                    return '';
                  }
                  return target.href;
                }
                return parsed.href;
              } catch {
                return '';
              }
            }
            const aiContainer = document.querySelector('div[data-subtree="aimc"]');
            if (!aiContainer) return false;
            const links = aiContainer.querySelectorAll('a[href^="http"]');
            const seen = new Set();
            let nonGoogleCount = 0;
            links.forEach(link => {
              const href = normalizeLink(link.href);
              if (href && !seen.has(href)) {
                seen.add(href);
                nonGoogleCount++;
              }
            });
            return nonGoogleCount >= 1;
          })()`,
          undefined,
          { timeout: 1000 }
        );
        console.error("检测到来源链接");
      } catch {
        console.error("来源链接未及时渲染，继续提取 AI 回答");
      }

      // 提取内容
      if (!this.page) {
        result.error = "搜索过程中页面已关闭（可能超时）。";
        return result;
      }
      let extractedResult = await this.extractAiAnswer(this.page);
      if (
        hasImageInput &&
        this.isPlaceholderImageAnswer(extractedResult.aiAnswer, baselineAiAnswer)
      ) {
        console.error("检测到图片模式仍为欢迎语/占位内容，继续等待真实回答...");
        const meaningfulResult = await this.waitForMeaningfulImageAnswer(
          this.page,
          baselineAiAnswer,
          16
        );
        if (meaningfulResult) {
          extractedResult = meaningfulResult;
        }
      }
      if (hasImageInput) {
        const placeholderNow = this.isPlaceholderImageAnswer(
          extractedResult.aiAnswer,
          baselineAiAnswer
        );
        console.error(
          `图片占位重试检查: absoluteImagePath=${absoluteImagePath || "(none)"}, placeholder=${placeholderNow}, baselineLen=${baselineAiAnswer.length}, extractedLen=${extractedResult.aiAnswer.length}`
        );
      }

      if (
        hasImageInput &&
        absoluteImagePath &&
        this.isPlaceholderImageAnswer(extractedResult.aiAnswer, baselineAiAnswer)
      ) {
        console.error("图片结果仍为占位内容，执行一次自动重试（重新上传并提交）...");
        try {
          const retryUrl = this.buildAiModeUrl(language);
          await this.page.goto(retryUrl, {
            waitUntil: "domcontentloaded",
            timeout: this.timeout * 1000,
          });
          await this.waitForAiContent(this.page);

          const retryBaselineResult = await this.extractAiAnswer(this.page);
          const retryBaselineAnswer = retryBaselineResult.aiAnswer || "";

          const retryUploaded = await this.uploadImageAttachment(absoluteImagePath);
          if (retryUploaded) {
            console.error("图片自动重试上传成功");
            const retrySubmitted = await this.submitImagePromptWithFallback(
              effectivePrompt,
              retryBaselineAnswer
            );
            if (retrySubmitted) {
              if (this.page) {
                await this.page.waitForTimeout(1000);
                await this.waitForAiContent(this.page);
                await this.waitForStreamingComplete(this.page, 26);
                const retryExtracted = await this.extractAiAnswer(this.page);
                if (
                  retryExtracted.success &&
                  !this.isPlaceholderImageAnswer(retryExtracted.aiAnswer, retryBaselineAnswer)
                ) {
                  extractedResult = retryExtracted;
                  console.error(
                    `图片自动重试成功，回答长度: ${retryExtracted.aiAnswer.length}`
                  );
                } else {
                  console.error("图片自动重试后仍为占位内容");
                }
              }
            } else {
              console.error("图片自动重试未能提交提示词");
            }
          } else {
            console.error("图片自动重试上传失败");
          }
        } catch (retryError) {
          console.error(`图片自动重试失败: ${retryError}`);
        }
      }

      result.aiAnswer = extractedResult.aiAnswer;
      result.sources = extractedResult.sources;
      result.success = result.aiAnswer.length > 0;

      if (
        hasImageInput &&
        this.isPlaceholderImageAnswer(result.aiAnswer, baselineAiAnswer)
      ) {
        result.success = false;
        result.error = "未获取到图片分析结果（页面仍停留在欢迎语），请重试。";
      }

      // 如果没有提取到内容，设置错误信息
      if (!result.success) {
        result.error =
          result.error ||
          extractedResult.error ||
          "未能提取到 AI 回答内容，可能需要登录 Google 账户";
      }

      // 保存回答用于增量提取
      this.lastAiAnswer = result.aiAnswer;
      this.lastActivityTime = Date.now();

      // 保存状态
      await this.saveStorageState();

      console.error(
        `搜索完成: success=${result.success}, ai_answer长度=${result.aiAnswer.length}`
      );
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error(`搜索失败: ${result.error}`);
      return result;
    }
  }

  /**
   * 在当前会话中继续对话（追问）
   */
  async continueConversation(query: string): Promise<SearchResult> {
    console.error(`继续对话: query='${query}'`);

    this.lastActivityTime = Date.now();

    if (!this.hasActiveSession()) {
      console.error("没有活跃会话，回退到新搜索");
      return this.search(query);
    }

    const result: SearchResult = {
      success: false,
      query,
      aiAnswer: "",
      sources: [],
      error: "",
    };

    try {
      if (!this.page) {
        result.error = "页面未初始化";
        return result;
      }

      // 查找追问输入框
      const inputElement = await this.findFollowUpInput();

      if (inputElement) {
        await inputElement.click();
        await this.page.waitForTimeout(300);
        await inputElement.fill(query);
        await this.page.waitForTimeout(300);
        await inputElement.press("Enter");
      } else {
        // 尝试使用 JavaScript
        console.error("尝试使用 JavaScript 查找输入框...");
        if (!(await this.hasFollowUpInputViaJs())) {
          console.error("页面上没有追问输入框，导航到新搜索");
          return this.search(query);
        }

        if (!(await this.submitFollowUpViaJs(query))) {
          console.error("无法提交追问，导航到新搜索");
          return this.search(query);
        }
      }

      // 等待 AI 回答加载
      await this.page.waitForTimeout(1000);
      await this.waitForAiContent(this.page);
      await this.waitForStreamingComplete(this.page, 10);

      // 检查验证码
      const content = (await this.page.evaluate(
        "document.body.innerText"
      )) as string;
      if (this.isCaptchaPage(content)) {
        console.error("追问时检测到验证码！");
        await this.close();
        result.error = "需要验证，请重新搜索";
        return result;
      }

      // 提取 AI 回答
      const extractedResult = await this.extractAiAnswer(this.page);
      result.sources = extractedResult.sources;

      // 保存完整的页面回答内容
      const fullPageAnswer = extractedResult.aiAnswer;

      // 增量提取：只返回新增内容
      if (extractedResult.success && this.lastAiAnswer) {
        if (fullPageAnswer.includes(this.lastAiAnswer)) {
          const lastEndPos =
            fullPageAnswer.indexOf(this.lastAiAnswer) + this.lastAiAnswer.length;
          let newContent = fullPageAnswer.slice(lastEndPos).trim();
          if (newContent) {
            newContent = this.removeUserQueryFromContent(newContent, query);
            result.aiAnswer = newContent;
            console.error(
              `增量提取: 原始长度=${fullPageAnswer.length}, 新增长度=${newContent.length}`
            );
          } else {
            console.error("增量提取未找到新内容，保留完整回答");
            result.aiAnswer = fullPageAnswer;
          }
        } else {
          console.error("增量提取: 未找到上一次回答，保留完整内容");
          result.aiAnswer = fullPageAnswer;
        }
      } else {
        result.aiAnswer = fullPageAnswer;
      }

      result.success = result.aiAnswer.length > 0;

      // 更新记录
      this.lastAiAnswer = fullPageAnswer;
      this.lastActivityTime = Date.now();

      console.error(`追问完成: success=${result.success}`);
      return result;
    } catch (error) {
      console.error(`继续对话失败: ${error}`);

      // 尝试导航到新搜索
      try {
        return this.search(query);
      } catch {
        await this.close();
        result.error = `追问失败: ${error}`;
        return result;
      }
    }
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    console.error("关闭浏览器...");

    this.sessionActive = false;
    this.lastAiAnswer = "";

    if (this.page) {
      try {
        await this.page.close();
      } catch {
        // ignore
      }
      this.page = null;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
      this.context = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore
      }
      this.browser = null;
    }

    console.error("浏览器已关闭");
  }

  /**
   * 打开浏览器让用户登录 Google 账户
   * 用户完成登录后关闭浏览器，认证状态会被保存
   */
  async setupLogin(): Promise<{ success: boolean; message: string }> {
    console.error("启动登录流程...");

    // 关闭现有会话
    await this.close();

    if (this.shouldUseNodriverAuth()) {
      console.error("优先使用 nodriver 执行登录流程...");
      try {
        const nodriverResult = await this.runNodriverAuthFlow(NODRIVER_LOGIN_URL);
        if (nodriverResult.success && nodriverResult.stateSaved) {
          return {
            success: true,
            message: "登录完成（nodriver）！认证状态已保存，现在可以正常使用搜索功能了。",
          };
        }
        console.error(`nodriver 登录流程未成功，回退 Playwright: ${nodriverResult.message}`);
      } catch (error) {
        console.error(`nodriver 登录流程异常，回退 Playwright: ${error}`);
      }
    }

    try {
      const executablePath = this.findBrowser();
      const proxy = await this.detectProxy();
      const launchOptions = this.buildLaunchOptions(executablePath, false, proxy);

      if (proxy) {
        console.error(`使用代理: ${proxy}`);
      }

      const browser = await chromium.launch(launchOptions);

      // 重要：setup 工具必须保存到共享路径，而不是会话路径
      // 这样 MCP 服务器才能读取到认证状态
      const storageStatePath = this.getSharedStorageStatePath();
      
      // 确保共享目录存在
      const sharedDir = path.dirname(storageStatePath);
      if (!fs.existsSync(sharedDir)) {
        fs.mkdirSync(sharedDir, { recursive: true });
        console.error(`创建共享目录: ${sharedDir}`);
      }
      
      const contextOptions = this.buildHeadedContextOptions(storageStatePath);

      // 如果有旧的认证状态，加载它
      if (contextOptions.storageState) {
        console.error(`加载已有认证状态: ${storageStatePath}`);
      }

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      // 打开 HUGE AI 搜索页面
      console.error("打开 HUGE AI 搜索页面...");
      await page.goto("https://www.google.com/search?q=hello&udm=50", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      console.error("\n" + "=".repeat(60));
      console.error("🌐 浏览器窗口已打开！");
      console.error("");
      console.error("请在浏览器中完成以下操作：");
      console.error("  1. 如果出现验证码，请完成验证");
      console.error("  2. 如果需要登录 Google，请登录你的账户");
      console.error("  3. 完成后，关闭浏览器窗口即可");
      console.error("");
      console.error("⏱️  最长等待时间: 5 分钟");
      console.error("=".repeat(60) + "\n");

      // 等待用户操作（最多 5 分钟）
      const maxWaitMs = 5 * 60 * 1000;
      const startTime = Date.now();

      // 监听浏览器关闭事件，在关闭前保存状态
      let browserClosed = false;
      let stateSaved = false;
      
      // 在页面关闭前保存状态
      page.on("close", async () => {
        if (!stateSaved) {
          try {
            console.error("页面即将关闭，保存认证状态...");
            await context.storageState({ path: storageStatePath });
            stateSaved = true;
            console.error(`✅ 认证状态已保存到: ${storageStatePath}`);
          } catch (e) {
            console.error(`保存状态失败: ${e}`);
          }
        }
      });
      
      browser.on("disconnected", () => {
        browserClosed = true;
        console.error("检测到浏览器已关闭");
      });

      // 简单等待，不做频繁保存操作（避免弹窗）
      while (!browserClosed && Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // 如果是超时而不是用户关闭，保存状态
      if (!browserClosed && !stateSaved) {
        try {
          console.error("等待超时，保存认证状态并关闭浏览器...");
          await context.storageState({ path: storageStatePath });
          stateSaved = true;
          await context.close();
          await browser.close();
        } catch {
          // ignore
        }
      }

      // 等待一下确保状态保存完成
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 检查状态文件是否存在
      if (fs.existsSync(storageStatePath)) {
        console.error(`\n✅ 登录流程完成！认证状态已保存到: ${storageStatePath}`);
        return {
          success: true,
          message: "登录完成！认证状态已保存，现在可以正常使用搜索功能了。",
        };
      } else {
        return {
          success: true,
          message: "登录流程完成。如果仍有问题，请重新运行此命令。",
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`登录流程失败: ${errorMsg}`);
      return {
        success: false,
        message: `登录流程失败: ${errorMsg}`,
      };
    }
  }
}
