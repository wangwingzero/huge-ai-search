# 需求文档

## 简介

Google AI Search MCP Server 是一个基于 Patchright（Playwright 防检测分支）实现的 MCP 服务器，用于访问 Google AI 模式（udm=50 参数）获取 AI 总结的搜索结果。该工具通过 MCP 协议暴露 `google_ai_search` 工具，支持多语言搜索，返回 AI 回答和来源链接。

## 术语表

- **MCP_Server**: Model Context Protocol 服务器，提供工具供 AI 助手调用
- **Patchright**: Playwright 的防检测分支，用于绕过网站的自动化检测
- **Google_AI_Mode**: Google 搜索的 AI 模式，通过 udm=50 参数访问，返回 AI 总结的搜索结果
- **Searcher**: 核心搜索逻辑模块，负责控制浏览器访问 Google 并提取结果
- **SearchResult**: 搜索结果数据结构，包含 AI 回答和来源链接
- **SearchSource**: 来源链接数据结构，包含标题、URL 和摘要

## 需求

### 需求 1：浏览器管理

**用户故事：** 作为开发者，我希望系统能自动检测并使用系统已安装的浏览器，以便无需额外安装浏览器驱动。

#### 验收标准

1. WHEN Searcher 初始化时，THE Searcher SHALL 按优先级检测系统已安装的 Edge 和 Chrome 浏览器
2. WHEN 检测到可用浏览器时，THE Searcher SHALL 记录浏览器可执行文件路径供后续使用
3. IF 未检测到任何可用浏览器，THEN THE Searcher SHALL 返回包含明确错误信息的 SearchResult
4. THE Searcher SHALL 支持配置无头模式（headless）和有头模式运行浏览器
5. THE Searcher SHALL 支持配置页面加载超时时间

### 需求 2：Google AI 搜索执行

**用户故事：** 作为用户，我希望能够通过工具执行 Google AI 模式搜索，获取 AI 总结的搜索结果。

#### 验收标准

1. WHEN 用户提供搜索关键词时，THE Searcher SHALL 构造包含 udm=50 参数的 Google AI 模式 URL
2. WHEN 执行搜索时，THE Searcher SHALL 使用 Patchright 或 Playwright 控制浏览器访问目标 URL
3. WHEN 浏览器启动时，THE Searcher SHALL 配置防检测参数以绕过自动化检测
4. WHEN 页面加载完成后，THE Searcher SHALL 等待 AI 回答内容加载完毕
5. THE Searcher SHALL 支持通过 language 参数指定搜索语言（如 zh-CN、en-US）
6. IF 搜索过程中发生异常，THEN THE Searcher SHALL 返回包含错误信息的 SearchResult

### 需求 3：搜索结果提取

**用户故事：** 作为用户，我希望获取结构化的搜索结果，包含 AI 回答和来源链接。

#### 验收标准

1. WHEN 页面加载完成后，THE Searcher SHALL 从页面中提取 AI 回答文本
2. WHEN 提取 AI 回答时，THE Searcher SHALL 清理不需要的导航文本和提示信息
3. WHEN 提取来源链接时，THE Searcher SHALL 过滤掉 Google 自身的链接
4. WHEN 提取来源链接时，THE Searcher SHALL 去除重复的 URL
5. THE Searcher SHALL 最多返回 10 个来源链接
6. THE SearchResult SHALL 包含 success 状态、query 查询词、ai_answer AI 回答、sources 来源列表和 error 错误信息字段

### 需求 4：MCP Server 集成

**用户故事：** 作为 AI 助手用户，我希望通过 MCP 协议调用 Google AI 搜索工具。

#### 验收标准

1. THE MCP_Server SHALL 注册名为 google_ai_search 的工具
2. THE google_ai_search 工具 SHALL 接受 query（必需）和 language（可选，默认 zh-CN）参数
3. WHEN 工具被调用时，THE MCP_Server SHALL 调用 Searcher 执行搜索并返回格式化结果
4. WHEN 搜索成功时，THE MCP_Server SHALL 返回包含查询词、AI 回答和来源链接的 Markdown 格式文本
5. IF 搜索失败，THEN THE MCP_Server SHALL 返回包含错误信息的文本
6. IF query 参数为空，THEN THE MCP_Server SHALL 返回参数错误提示

### 需求 5：数据模型

**用户故事：** 作为开发者，我希望有清晰的数据模型来表示搜索结果。

#### 验收标准

1. THE SearchSource SHALL 包含 title（标题）、url（链接）和 snippet（摘要）字段
2. THE SearchResult SHALL 包含 success（是否成功）、query（查询词）、ai_answer（AI 回答）、sources（来源列表）和 error（错误信息）字段
3. WHEN SearchResult 初始化时，THE SearchResult SHALL 将 sources 默认初始化为空列表
