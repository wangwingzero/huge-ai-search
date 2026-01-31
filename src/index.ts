#!/usr/bin/env node
/**
 * Huge AI Search MCP Server
 *
 * AI 搜索聚合工具 - 获取 AI 总结的搜索结果
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AISearcher, SearchResult } from "./searcher.js";

// 搜索参数 schema
const SearchArgsSchema = z.object({
  query: z.string().describe("搜索问题（使用自然语言提问）"),
  language: z
    .string()
    .default("zh-CN")
    .describe("搜索结果语言"),
  follow_up: z
    .boolean()
    .default(false)
    .describe("是否在当前对话上下文中追问"),
});

// 格式化搜索结果为 Markdown
function formatSearchResult(result: SearchResult): string {
  if (!result.success) {
    return `## 搜索失败\n\n**错误**: ${result.error}`;
  }

  let output = `## AI 搜索结果\n\n**查询**: ${result.query}\n\n### AI 回答\n\n${result.aiAnswer}`;

  if (result.sources.length > 0) {
    output += "\n\n### 来源\n";
    for (const source of result.sources) {
      output += `\n- [${source.title}](${source.url})`;
      if (source.snippet) {
        output += `\n  ${source.snippet}`;
      }
    }
  }

  output +=
    '\n\n---\n💡 **提示**: 如需深入了解，可以设置 `follow_up: true` 进行追问。';

  return output;
}

// 创建 MCP 服务器
const server = new Server(
  {
    name: "huge-ai-search",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 搜索器实例
let searcher: AISearcher | null = null;

// 获取或创建搜索器
function getSearcher(): AISearcher {
  if (!searcher) {
    searcher = new AISearcher();
  }
  return searcher;
}

// 列出可用工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "huge_ai_search",
        description:
          "AI 搜索聚合工具 - 获取 AI 总结的搜索结果。\n\n" +
          "✅ 正确的提问方式（自然语言）:\n" +
          "- 「React 和 Vue 在 2025 年哪个更适合新项目？」\n" +
          "- 「Python 异步编程有哪些常见的坑？」\n\n" +
          "❌ 避免的提问方式（关键词堆砌）:\n" +
          "- 「React Vue 对比 2025」\n" +
          "- 「Python async 问题」",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索问题（使用自然语言提问）",
            },
            language: {
              type: "string",
              default: "zh-CN",
              description: "搜索结果语言",
              enum: ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR"],
            },
            follow_up: {
              type: "boolean",
              default: false,
              description: "是否在当前对话上下文中追问",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "huge_ai_search") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = SearchArgsSchema.parse(request.params.arguments);
  const searcherInstance = getSearcher();

  console.error(`执行搜索: ${args.query}`);

  const result = await searcherInstance.search(
    args.query,
    args.language,
    args.follow_up
  );

  return {
    content: [
      {
        type: "text",
        text: formatSearchResult(result),
      },
    ],
  };
});

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
