#!/usr/bin/env node
/**
 * Huge AI Search MCP Server
 *
 * AI 搜索聚合工具 - 获取 AI 总结的搜索结果
 * 完整移植自 Python 版本 google-ai-search-mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AISearcher, SearchResult } from "./searcher.js";
import * as fs from "fs";
import * as path from "path";

// 工具描述
const TOOL_DESCRIPTION = `使用 AI 模式搜索，获取 AI 总结的搜索结果。

🌟🌟🌟 **全能通用搜索工具 - 有任何不确定的事情都可以搜！** 🌟🌟🌟

这是你的**首选搜索工具**，适用于几乎所有需要获取外部信息的场景。
不要犹豫，不要等待明确指令 —— 遇到任何不确定的问题，先搜一下确认！

🎯 核心原则：用自然语言提问，不要用关键词堆砌！
这是对话式 AI 搜索，像和人说话一样提问效果最好。

🚨🚨🚨 **最高优先级规则：Bug/问题排查必须先搜索！** 🚨🚨🚨

当用户报告 bug、问题、错误、异常行为时：
1. **第一步**：使用此工具搜索问题的常见原因和解决方案
2. **第二步**：阅读搜索结果，了解业界已知的解决方案
3. **第三步**：再开始读代码、加日志、修改代码

**禁止行为**：直接开始读代码调试，跳过搜索步骤！

🔥 **强烈建议主动使用的场景**:
- **用户报告 bug/问题/错误** → 必须先搜索常见原因和解决方案！
- 任何你不100%确定的技术问题 → 搜一下确认
- 任何可能有更新的信息 → 搜一下获取最新
- 任何最佳实践/推荐做法 → 搜一下看业界标准
- 写代码前不确定的 API 用法 → 搜一下确认
- 做技术选型 → 搜一下对比各方案
- **实现某个功能前** → 搜一下看有没有现成的最佳实践

⭐⭐⭐ **追问功能（核心价值）** ⭐⭐⭐

**「搜而不追，等于白搜」** —— 初次搜索只是开门，追问才能解决真正的问题！

🔴 **必须追问的场景**：
- 技术选型：先搜概况，再追问「我的场景是 XXX，选哪个？」
- 架构设计：先搜模式，再追问「考虑到 XXX 约束，推荐哪种？」
- Bug 排查：先搜原因，再追问「我的环境是 XXX，最可能是哪个？」
- 最佳实践：先搜方法，再追问「有什么坑要避免？」

📝 **追问示例**：
\`\`\`
# 初次搜索
query: "React 状态管理方案有哪些？"
follow_up: false

# 追问 1：场景化（必追！）
query: "如果是中小型项目，团队 3 人，应该选哪个？"
follow_up: true

# 追问 2：深入细节
query: "Zustand 具体怎么用？有什么最佳实践？"
follow_up: true

# 追问 3：避坑（必追！）
query: "使用 Zustand 有哪些常见的坑要避免？"
follow_up: true
\`\`\`

🎯 **追问策略**：
- **场景化追问**：「如果我的场景是 {具体场景}，应该怎么做？」
- **细节追问**：「刚才提到的 {某个点}，能详细说说吗？」
- **对比追问**：「{方案A} 和 {方案B} 在我的场景下哪个更好？」
- **避坑追问**：「这个方案有什么潜在的坑需要注意？」

🔄 **何时追问 vs 新搜索**：

✅ **使用 follow_up: true（追问）**:
- 对上一个搜索结果需要更多细节或解释
- 想从不同角度深入探讨**同一话题**
- 需要针对具体场景获取建议
- 用户说「继续」「详细说说」「还有呢」等追问意图

❌ **使用 follow_up: false（新对话）**:
- 完全不同的话题
- 用户开始了新的任务或问题
- 不确定时，默认 false 更安全

💡 **追问原则**：宁可多追一次，不可少追一次！追问成本低，错误代价高。`;

// 格式化搜索结果为 Markdown
function formatSearchResult(
  result: SearchResult,
  isFollowUp: boolean = false,
  sessionId?: string
): string {
  if (!result.success) {
    return `## 搜索失败\n\n**错误**: ${result.error}`;
  }

  let output = isFollowUp
    ? `## AI 追问结果\n\n`
    : `## AI 搜索结果\n\n`;

  output += `**查询**: ${result.query}\n\n`;
  output += `### AI 回答\n\n${result.aiAnswer}\n\n`;

  if (result.sources.length > 0) {
    output += `### 来源 (${result.sources.length} 个)\n\n`;
    for (let i = 0; i < Math.min(result.sources.length, 5); i++) {
      const source = result.sources[i];
      output += `${i + 1}. [${source.title}](${source.url})\n`;
    }
  }

  // 添加会话信息和追问提示
  output += `\n---\n`;
  if (sessionId) {
    output += `🔑 **会话 ID**: \`${sessionId}\`\n\n`;
  }
  output += `💡 **提示**: 如需深入了解，可以设置 \`follow_up: true\`${sessionId ? ` 并传入 \`session_id: "${sessionId}"\`` : ''} 进行追问，AI 会在当前对话上下文中继续回答。\n`;

  return output;
}

// ============================================
// 多会话管理器
// ============================================

interface Session {
  searcher: AISearcher;
  lastAccess: number;
  searchCount: number;
}

// 会话存储：sessionId -> Session
const sessions = new Map<string, Session>();

// 并发控制
const MAX_CONCURRENT_SEARCHES = 3;
const MAX_SESSIONS = 5; // 最大会话数
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟超时
const SESSION_MAX_SEARCHES = 50; // 单会话最大搜索次数（超过后重建）
const CLEANUP_INTERVAL_MS = 60 * 1000; // 每分钟清理一次

let currentSearches = 0;

// 登录超时冷却机制
let loginTimeoutTimestamp: number | null = null;
const LOGIN_COOLDOWN_SECONDS = 300; // 5 分钟

// 搜索超时时间（秒）
const SEARCH_TIMEOUT_SECONDS = 120;

/**
 * 生成会话 ID
 * 基于时间戳和随机数，确保唯一性
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 获取或创建会话
 */
async function getOrCreateSession(sessionId?: string): Promise<{ sessionId: string; session: Session }> {
  // 如果提供了 sessionId 且存在，返回现有会话
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastAccess = Date.now();
    console.error(`复用会话: ${sessionId}`);
    return { sessionId, session };
  }

  // 检查是否达到最大会话数
  if (sessions.size >= MAX_SESSIONS) {
    // 清理最旧的会话
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastAccess < oldestTime) {
        oldestTime = s.lastAccess;
        oldestId = id;
      }
    }
    if (oldestId) {
      console.error(`达到最大会话数，清理最旧会话: ${oldestId}`);
      await closeSession(oldestId);
    }
  }

  // 创建新会话
  const newSessionId = sessionId || generateSessionId();
  const newSession: Session = {
    searcher: new AISearcher(60, true, newSessionId),
    lastAccess: Date.now(),
    searchCount: 0,
  };
  sessions.set(newSessionId, newSession);
  console.error(`创建新会话: ${newSessionId}，当前会话数: ${sessions.size}`);
  return { sessionId: newSessionId, session: newSession };
}

/**
 * 关闭并清理会话
 */
async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (session) {
    try {
      await session.searcher.close();
    } catch (error) {
      console.error(`关闭会话 ${sessionId} 时出错: ${error}`);
    }
    sessions.delete(sessionId);
    
    // 清理会话数据目录，防止磁盘空间泄漏
    const sessionDataDir = path.join(process.cwd(), "browser_data", sessionId);
    try {
      if (fs.existsSync(sessionDataDir)) {
        fs.rmSync(sessionDataDir, { recursive: true, force: true });
        console.error(`已清理会话数据目录: ${sessionDataDir}`);
      }
    } catch (cleanupError) {
      console.error(`清理会话数据目录失败: ${cleanupError}`);
    }
    
    console.error(`会话已关闭: ${sessionId}，剩余会话数: ${sessions.size}`);
  }
}

/**
 * 定期清理超时会话
 */
async function cleanupSessions(): Promise<void> {
  const now = Date.now();
  const toClose: string[] = [];

  for (const [id, session] of sessions) {
    // 检查超时
    if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
      console.error(`会话超时: ${id}`);
      toClose.push(id);
      continue;
    }
    // 检查搜索次数（防止内存泄漏）
    if (session.searchCount >= SESSION_MAX_SEARCHES) {
      console.error(`会话搜索次数过多: ${id} (${session.searchCount}次)`);
      toClose.push(id);
    }
  }

  for (const id of toClose) {
    await closeSession(id);
  }

  if (toClose.length > 0) {
    console.error(`清理了 ${toClose.length} 个会话，剩余: ${sessions.size}`);
  }
}

// 启动定期清理
setInterval(() => {
  cleanupSessions().catch((err) => console.error(`清理会话失败: ${err}`));
}, CLEANUP_INTERVAL_MS);

/**
 * 获取当前会话状态（用于调试）
 */
function getSessionStats(): string {
  const stats = [];
  for (const [id, session] of sessions) {
    const age = Math.floor((Date.now() - session.lastAccess) / 1000);
    stats.push(`${id.substring(0, 20)}... (${session.searchCount}次, ${age}秒前)`);
  }
  return `会话数: ${sessions.size}/${MAX_SESSIONS}\n${stats.join('\n')}`;
}

// 检查是否为登录超时错误
function isLoginTimeoutError(error: string): boolean {
  const timeoutKeywords = [
    "验证超时",
    "登录超时",
    "timeout",
    "5分钟",
    "captcha",
    "验证码",
  ];
  const errorLower = error.toLowerCase();
  return timeoutKeywords.some((kw) => errorLower.includes(kw.toLowerCase()));
}

// 创建 MCP 服务器
const server = new McpServer({
  name: "huge-ai-search",
  version: "1.1.0",
});

// 注册工具
server.tool(
  "huge_ai_search",
  TOOL_DESCRIPTION,
  {
    query: z.string().describe("搜索问题（使用自然语言提问）"),
    language: z
      .enum(["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR"])
      .default("zh-CN")
      .describe("搜索结果语言"),
    follow_up: z
      .boolean()
      .default(false)
      .describe("是否在当前对话上下文中追问"),
    session_id: z
      .string()
      .optional()
      .describe("会话 ID（用于多窗口独立追问，首次搜索会自动生成并返回）"),
  },
  async (args) => {
    const { query, language, follow_up, session_id } = args;

    console.error(
      `收到工具调用: query='${query}', language=${language}, follow_up=${follow_up}, session_id=${session_id || '(新会话)'}`
    );

    if (!query) {
      return {
        content: [{ type: "text" as const, text: "错误: 请提供搜索关键词" }],
      };
    }

    // 检查是否在登录超时冷却期内
    if (loginTimeoutTimestamp !== null) {
      const elapsed = (Date.now() - loginTimeoutTimestamp) / 1000;
      if (elapsed < LOGIN_COOLDOWN_SECONDS) {
        const remaining = Math.floor(LOGIN_COOLDOWN_SECONDS - elapsed);
        const remainingMin = Math.floor(remaining / 60);
        console.error(`处于冷却期，剩余 ${remainingMin}分${remaining % 60}秒`);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `⏸️ Google AI 搜索暂时不可用\n\n` +
                `上次搜索需要用户登录验证但超时未完成（可能用户不在电脑前）。\n` +
                `冷却剩余: ${remainingMin} 分 ${remaining % 60} 秒\n\n` +
                `**建议**: 如果这是新的对话，用户可能已经回来了，可以告知用户手动触发重试。\n` +
                `或者使用其他搜索工具（如 exa_web_search）作为替代。`,
            },
          ],
        };
      } else {
        // 冷却期已过，重置状态
        console.error("冷却期已过，重置状态");
        loginTimeoutTimestamp = null;
      }
    }

    // 并发控制
    if (currentSearches >= MAX_CONCURRENT_SEARCHES) {
      console.error(
        `并发搜索数已达上限 (${MAX_CONCURRENT_SEARCHES})，等待中...`
      );
      return {
        content: [
          {
            type: "text" as const,
            text: "搜索繁忙，请稍后重试",
          },
        ],
      };
    }

    currentSearches++;
    console.error(
      `获取到搜索槽位，当前并发: ${currentSearches}/${MAX_CONCURRENT_SEARCHES}`
    );

    // 获取或创建会话
    const { sessionId: activeSessionId, session } = await getOrCreateSession(
      follow_up ? session_id : undefined // 追问时复用会话，新搜索创建新会话
    );

    try {
      const searcherInstance = session.searcher;
      session.searchCount++;

      // 设置超时
      const timeoutPromise = new Promise<SearchResult>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`搜索超时（${SEARCH_TIMEOUT_SECONDS}秒）`));
        }, SEARCH_TIMEOUT_SECONDS * 1000);
      });

      let searchPromise: Promise<SearchResult>;

      if (follow_up && searcherInstance.hasActiveSession()) {
        console.error(`使用追问模式（会话: ${activeSessionId}）`);
        searchPromise = searcherInstance.continueConversation(query);
      } else {
        if (follow_up && !searcherInstance.hasActiveSession()) {
          console.error("请求追问但没有活跃会话，使用新搜索");
        }
        console.error(`执行新搜索（会话: ${activeSessionId}）`);
        searchPromise = searcherInstance.search(query, language);
      }

      const result = await Promise.race([searchPromise, timeoutPromise]);

      // 更新会话访问时间
      session.lastAccess = Date.now();

      console.error(
        `搜索结果: success=${result.success}, error=${result.success ? "N/A" : result.error}`
      );

      // 检查是否是登录/验证超时错误
      if (!result.success && isLoginTimeoutError(result.error)) {
        console.error("检测到登录超时错误，启动冷却机制");
        loginTimeoutTimestamp = Date.now();
        // 获取 MCP 服务器的安装目录（dist/index.js 的父目录的父目录）
        const serverDir = process.cwd();
        return {
          content: [
            {
              type: "text" as const,
              text:
                `## ⏸️ 搜索需要用户验证但超时\n\n` +
                `**原因**: ${result.error}\n\n` +
                `该工具将暂停 ${Math.floor(LOGIN_COOLDOWN_SECONDS / 60)} 分钟，避免重复打扰不在场的用户。\n\n` +
                `### 🔧 解决方案\n\n` +
                `请帮助用户在终端执行以下命令完成登录：\n\n` +
                `\`\`\`bash\n` +
                `cd ${serverDir}\n` +
                `npx ts-node setup-browser.ts\n` +
                `\`\`\`\n\n` +
                `执行后会弹出浏览器窗口，用户需要：\n` +
                `1. 完成 Google 登录或验证码验证\n` +
                `2. 关闭浏览器窗口（认证状态会自动保存）\n` +
                `3. 之后搜索就能正常工作了`,
            },
          ],
        };
      }

      // 搜索失败时返回详细的错误信息和解决方案
      if (!result.success) {
        const errorMsg = result.error || "未知错误";
        console.error(`搜索失败: ${errorMsg}`);
        
        // 判断错误类型，给出针对性的解决方案
        const isLoginRequired = 
          errorMsg.includes("登录") || 
          errorMsg.includes("验证") ||
          errorMsg.includes("captcha") ||
          errorMsg.includes("未能提取");
        
        // 获取 MCP 服务器的安装目录
        const serverDir = process.cwd();
        
        let solution = "";
        if (isLoginRequired) {
          solution = 
            `### 🔧 解决方案\n\n` +
            `这个错误通常是因为需要登录 Google 账户或完成验证码验证。\n\n` +
            `**请帮助用户在终端执行以下命令：**\n\n` +
            `\`\`\`bash\n` +
            `cd ${serverDir}\n` +
            `npx ts-node setup-browser.ts\n` +
            `\`\`\`\n\n` +
            `执行后会弹出浏览器窗口，用户需要：\n` +
            `1. 完成 Google 登录或验证码验证\n` +
            `2. 关闭浏览器窗口（认证状态会自动保存）\n` +
            `3. 之后搜索就能正常工作了`;
        } else {
          solution = 
            `### 🔧 可能的解决方案\n\n` +
            `- 检查网络连接是否正常\n` +
            `- 稍后重试\n` +
            `- 如果问题持续，请帮助用户在终端运行 \`cd ${serverDir} && npx ts-node setup-browser.ts\` 重新登录`;
        }
        
        return {
          content: [
            {
              type: "text" as const,
              text: `## ❌ 搜索失败\n\n**原因**: ${errorMsg}\n\n${solution}`,
            },
          ],
        };
      }

      const output = formatSearchResult(result, follow_up, activeSessionId);
      console.error(`搜索成功，返回结果长度: ${output.length}`);

      return {
        content: [{ type: "text" as const, text: output }],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`搜索执行异常: ${errorMessage}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `搜索执行异常: ${errorMessage}`,
          },
        ],
      };
    } finally {
      currentSearches--;
      console.error(`释放搜索槽位，当前并发: ${currentSearches}/${MAX_CONCURRENT_SEARCHES}`);
    }
  }
);

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Huge AI Search MCP Server 已启动");
}

main().catch((error) => {
  console.error("服务器启动失败:", error);
  process.exit(1);
});
