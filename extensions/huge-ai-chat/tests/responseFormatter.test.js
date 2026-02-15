const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSearchToolText,
  isAuthRelatedError,
  isNoRecordResponseText,
} = require("../dist/chat/responseFormatter.js");

test("parseSearchToolText should parse answer/sources/session/debug marker", () => {
  const raw = [
    "## AI 搜索结果",
    "",
    "**查询**: React 19 新特性",
    "",
    "### AI 回答",
    "",
    "React 19 引入了新的 Actions 能力。",
    "",
    "### 来源 (2 个)",
    "",
    "1. [React Blog](https://react.dev/blog)",
    "2. [MDN](https://developer.mozilla.org/)",
    "",
    "---",
    "🔑 **会话 ID**: `session_123`",
    "🧾 **运行日志**: `C:/tmp/a.log`",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.equal(parsed.sessionId, "session_123");
  assert.equal(parsed.sources.length, 2);
  assert.match(parsed.renderedMarkdown, /React 19 引入了新的 Actions 能力/);
  assert.match(parsed.renderedMarkdown, /### 相关链接/);
  assert.match(parsed.renderedMarkdown, /\[React Blog\]\(<https:\/\/react\.dev\/blog>\)/);
  assert.doesNotMatch(parsed.renderedMarkdown, /:::huge_ai_chat_debug_start:::/);
  assert.doesNotMatch(parsed.renderedMarkdown, /<details>/);
});

test("parseSearchToolText should classify auth error", () => {
  const parsed = parseSearchToolText("需要登录 Google 后继续使用 huge-ai-search-setup");
  assert.equal(parsed.isError, true);
  assert.equal(parsed.isAuthError, true);
});

test("parseSearchToolText should not treat successful envelopes with auth keywords as errors", () => {
  const raw = [
    "## AI 搜索结果",
    "",
    "**查询**: 登录 是什么",
    "",
    "### AI 回答",
    "",
    "“登录”是用户完成身份认证后访问系统的过程。",
    "",
    "---",
    "🔑 **会话 ID**: `session_abc`",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.equal(parsed.isAuthError, false);
  assert.equal(parsed.sessionId, "session_abc");
});

test("isAuthRelatedError should detect captcha keyword", () => {
  assert.equal(isAuthRelatedError("CAPTCHA 验证超时"), true);
  assert.equal(isAuthRelatedError("普通错误"), false);
});

test("parseSearchToolText should fallback extract plain urls as sources", () => {
  const raw = [
    "### AI 回答",
    "",
    "你可以参考这两篇资料：",
    "https://example.com/a",
    "https://news.ycombinator.com/item?id=1",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.equal(parsed.sources.length, 2);
  assert.match(parsed.renderedMarkdown, /你可以参考这两篇资料/);
  assert.match(parsed.renderedMarkdown, /### 相关链接/);
  assert.match(parsed.renderedMarkdown, /\[example\.com\]\(<https:\/\/example\.com\/a>\)/);
});

test("parseSearchToolText should keep no-record response and drop extracted sources", () => {
  const raw = [
    "### AI 回答",
    "",
    "该词条在当前技术语料库和实时搜索中无记录",
    "",
    "参考链接：https://example.com/should-not-appear",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.equal(parsed.sources.length, 0);
  assert.doesNotMatch(parsed.renderedMarkdown, /### (来源|相关链接)/);
});

test("isNoRecordResponseText should support old and new phrases", () => {
  assert.equal(isNoRecordResponseText("该词条在当前技术语料库和实时搜索中无记录"), true);
  assert.equal(isNoRecordResponseText("该词条在当前技术语料库和实时搜索中无可验证记录。"), true);
  assert.equal(isNoRecordResponseText("这是普通回答"), false);
});

test("parseSearchToolText should keep clickable link when source title is malformed", () => {
  const raw = [
    "### AI 回答",
    "",
    "如下：",
    "",
    "### 来源 (1 个)",
    "",
    "1. [律师整理：[20-（受害人实际年龄-60）] 示例](https://zhuanlan.zhihu.com/p/350670355#:~:text=demo)",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.equal(parsed.sources.length, 1);
  assert.match(parsed.renderedMarkdown, /### 相关链接/);
  assert.match(parsed.renderedMarkdown, /\(<https:\/\/zhuanlan\.zhihu\.com\/p\/350670355/);
});

test("parseSearchToolText should parse angle-wrapped source urls", () => {
  const raw = [
    "### AI 回答",
    "",
    "这是正文。",
    "",
    "### 相关链接",
    "",
    "1. [Anthropic](<https://www.anthropic.com/news/opus-4-6>)",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].url, "https://www.anthropic.com/news/opus-4-6");
  assert.match(parsed.renderedMarkdown, /\[Anthropic\]\(<https:\/\/www\.anthropic\.com\/news\/opus-4-6>\)/);
});

test("parseSearchToolText should strip plain source tail cards without markdown links", () => {
  const raw = [
    "### AI 回答",
    "",
    "这是正文段落。",
    "您是想了解如何通过 API 调用最新模型，还是想在 Claude.ai 网页端直接体验它的功能？",
    "",
    "Claude Opus 4.6 - Anthropic",
    "2026年2月5日 — Announcements * NEW. Claude Op...",
    "Anthropic",
    "Models overview - Claude API Docs",
    "Table_title: Latest models comparison",
    "Claude Developer Platform",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.match(parsed.renderedMarkdown, /这是正文段落/);
  assert.match(parsed.renderedMarkdown, /Claude\.ai 网页端直接体验/);
  assert.doesNotMatch(parsed.renderedMarkdown, /Claude Opus 4\.6 - Anthropic/);
  assert.doesNotMatch(parsed.renderedMarkdown, /Table_title:/);
});

test("parseSearchToolText should not over-strip normal follow-up answer blocks", () => {
  const raw = [
    "### AI 回答",
    "",
    "你好！下面是基于你上传图片的总结：",
    "界面显示的是 VS Code 中 HUGE 插件对话页面。",
    "",
    "你可以继续问我插件安装或配置问题。",
  ].join("\n");

  const parsed = parseSearchToolText(raw);
  assert.equal(parsed.isError, false);
  assert.match(parsed.renderedMarkdown, /HUGE 插件对话页面/);
  assert.match(parsed.renderedMarkdown, /继续问我插件安装或配置问题/);
  assert.ok(parsed.renderedMarkdown.trim().length > 20);
});
