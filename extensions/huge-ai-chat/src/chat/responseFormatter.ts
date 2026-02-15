import { ParsedSearchResponse, SearchSource } from "./types";

const AUTH_KEYWORDS = [
  "登录",
  "验证码",
  "CAPTCHA",
  "captcha",
  "验证超时",
  "huge-ai-search-setup",
];

const ERROR_PATTERNS = [/##\s*(?:❌\s*)?搜索失败/i, /搜索执行异常/i, /搜索失败/i];
const NO_RECORD_PATTERNS = [
  "该词条在当前技术语料库和实时搜索中无记录",
  "该词条在当前技术语料库和实时搜索中无可验证记录",
];

function isSuccessResultEnvelope(text: string): boolean {
  return /^##\s*AI\s*(?:搜索|追问)结果/i.test((text || "").trimStart());
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function extractSessionId(raw: string): string | undefined {
  const match = raw.match(/会话\s*ID\*\*:\s*`([^`]+)`/i) || raw.match(/session[_\s-]?id[:：]\s*`?([^`\s]+)`?/i);
  return match?.[1]?.trim();
}

function extractAnswer(raw: string): string {
  const match = raw.match(/###\s*AI\s*回答\s*\n+([\s\S]*?)(?:\n###\s*(?:来源|相关链接)[^\n]*|\n---\n|$)/i);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  return raw.trim();
}

function extractSources(raw: string): SearchSource[] {
  const sectionMatch = raw.match(/###\s*(?:来源|相关链接)[^\n]*\n+([\s\S]*?)(?:\n---\n|$)/i);
  const target = sectionMatch?.[1] || raw;
  const sources: SearchSource[] = [];

  const regex = /^\s*\d+\.\s+\[(.+?)\]\((https?:\/\/[^\s)]+)\)\s*$/gm;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(target)) !== null) {
    sources.push({
      title: match[1].trim(),
      url: match[2].trim(),
    });
  }
  return sources;
}

function sanitizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function shouldSkipHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.includes("google.") ||
    host.includes("gstatic.com") ||
    host.includes("googleapis.com") ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

function cleanTrailingPunctuation(url: string): string {
  return url.replace(/[)\]}>，。！？；：,.;!?]+$/g, "");
}

function guessTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function extractFallbackSources(raw: string): SearchSource[] {
  const matches = raw.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  const seen = new Set<string>();
  const sources: SearchSource[] = [];

  for (const item of matches) {
    const normalized = sanitizeHttpUrl(cleanTrailingPunctuation(item));
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    try {
      const host = new URL(normalized).hostname;
      if (shouldSkipHost(host)) {
        continue;
      }
    } catch {
      continue;
    }

    sources.push({
      title: guessTitleFromUrl(normalized),
      url: normalized,
    });
  }

  return sources;
}

function mergeSources(primary: SearchSource[], fallback: SearchSource[]): SearchSource[] {
  const merged: SearchSource[] = [];
  const seen = new Set<string>();

  for (const source of [...primary, ...fallback]) {
    const normalized = sanitizeHttpUrl(source.url);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push({
      title: (source.title || "").trim() || guessTitleFromUrl(normalized),
      url: normalized,
    });
  }

  return merged.slice(0, 10);
}

function extractDebugSection(raw: string): string | undefined {
  const divider = "\n---\n";
  const index = raw.indexOf(divider);
  if (index < 0) {
    return undefined;
  }
  const tail = raw.slice(index + divider.length).trim();
  if (!tail) {
    return undefined;
  }
  return tail;
}

function stripTrailingSourceText(text: string): string {
  const byHeading = text.replace(
    /\n{2,}\s*(?:#{1,6}\s*)?(?:来源|相关链接|sources?)\s*\n[\s\S]*$/i,
    ""
  );
  const byNumberedLinks = byHeading.replace(
    /\n{2,}(?:\s*\d+\.\s*\[[^\n]+?\]\(\s*<?https?:\/\/[^\n>]+>?\s*\)\s*\n?)+\s*$/gi,
    ""
  );

  const paragraphs = byNumberedLinks
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (paragraphs.length <= 1) {
    return byNumberedLinks.trim();
  }

  let keepUntil = paragraphs.length;
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    if (isSourceTailParagraph(paragraphs[index])) {
      keepUntil = index;
      continue;
    }
    break;
  }

  if (keepUntil === paragraphs.length) {
    return byNumberedLinks.trim();
  }
  return paragraphs.slice(0, keepUntil).join("\n\n").trim();
}

function isSourceTailParagraph(paragraph: string): boolean {
  const lines = paragraph
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (!lines.length) {
    return false;
  }

  let score = 0;
  if (lines.some((line) => /https?:\/\/|www\./i.test(line))) {
    score += 3;
  }
  if (lines.some((line) => /table_(title|content)\s*:/i.test(line))) {
    score += 2;
  }
  if (lines.some((line) => /^\d{4}年\d{1,2}月\d{1,2}日\s*[—-]/.test(line) || /^\w{3,9}\s+\d{1,2},\s+\d{4}/.test(line))) {
    score += 2;
  }
  if (lines.some((line) => /[A-Za-z][A-Za-z0-9 .,&'/:()\-]{2,}\s-\s[A-Za-z]/.test(line))) {
    score += 2;
  }
  if (lines.some((line) => /^[A-Za-z][A-Za-z0-9 .&'/:()\-]{1,40}$/.test(line))) {
    score += 1;
  }
  if (
    lines.length >= 3 &&
    lines.filter((line) => line.length <= 96).length / lines.length >= 0.7 &&
    lines.some((line) => /[A-Za-z]/.test(line))
  ) {
    score += 1;
  }
  if (lines.every((line) => !/[。！？]$/.test(line))) {
    score += 1;
  }

  return score >= 3;
}

function normalizeErrorBody(raw: string): string {
  const text = raw.trim();
  if (/^##\s*/.test(text)) {
    return text;
  }
  return `## ❌ 搜索失败\n\n${text}`;
}

export function isAuthRelatedError(text: string): boolean {
  const normalized = normalizeLineEndings(text || "");
  if (!normalized) {
    return false;
  }

  // Treat known MCP success envelopes as non-auth failures even if answer/debug text
  // contains words like "登录" or "验证码".
  if (isSuccessResultEnvelope(normalized)) {
    return false;
  }

  const lower = normalized.toLowerCase();
  return AUTH_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function isSearchFailureText(text: string): boolean {
  return ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function isNoRecordResponseText(text: string): boolean {
  const normalized = (text || "").trim();
  if (!normalized) {
    return false;
  }
  return NO_RECORD_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function parseSearchToolText(rawText: string): ParsedSearchResponse {
  const raw = normalizeLineEndings(rawText || "");
  const isAuthError = isAuthRelatedError(raw);
  const isError = isSearchFailureText(raw) || isAuthError;

  if (isError) {
    return {
      raw,
      answer: raw,
      renderedMarkdown: normalizeErrorBody(raw),
      sources: [],
      sessionId: extractSessionId(raw),
      debugText: extractDebugSection(raw),
      isError: true,
      isAuthError,
    };
  }

  const answer = stripTrailingSourceText(extractAnswer(raw));
  const isNoRecord = isNoRecordResponseText(answer) || isNoRecordResponseText(raw);
  const sources = isNoRecord
    ? []
    : mergeSources(extractSources(raw), extractFallbackSources(raw));
  const debugText = extractDebugSection(raw);
  const sessionId = extractSessionId(raw);

  return {
    raw,
    answer,
    renderedMarkdown: answer,
    sources,
    sessionId,
    debugText,
    isError: false,
    isAuthError,
  };
}
