const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSearchToolText,
  isAuthRelatedError,
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
  assert.match(parsed.renderedMarkdown, /:::huge_ai_chat_debug_start:::/);
  assert.doesNotMatch(parsed.renderedMarkdown, /<details>/);
});

test("parseSearchToolText should classify auth error", () => {
  const parsed = parseSearchToolText("需要登录 Google 后继续使用 huge-ai-search-setup");
  assert.equal(parsed.isError, true);
  assert.equal(parsed.isAuthError, true);
});

test("isAuthRelatedError should detect captcha keyword", () => {
  assert.equal(isAuthRelatedError("CAPTCHA 验证超时"), true);
  assert.equal(isAuthRelatedError("普通错误"), false);
});
