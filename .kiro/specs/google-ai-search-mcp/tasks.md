# 实现计划: Google AI Search MCP Server

## 概述

基于设计文档，将 Google AI Search MCP Server 分解为可执行的编码任务。采用增量开发方式，先实现核心数据模型，再实现搜索逻辑，最后集成 MCP Server。

## 任务

- [ ] 1. 项目结构和数据模型
  - [x] 1.1 创建项目目录结构和 pyproject.toml
    - 创建 `src/google_ai_search/` 目录
    - 配置 pyproject.toml 包含依赖（mcp, patchright）和入口点
    - _需求: 4.1_
  
  - [x] 1.2 实现数据模型（SearchSource 和 SearchResult）
    - 在 `src/google_ai_search/searcher.py` 中定义 dataclass
    - SearchSource 包含 title, url, snippet 字段
    - SearchResult 包含 success, query, ai_answer, sources, error 字段
    - 实现 `__post_init__` 确保 sources 默认为空列表
    - _需求: 5.1, 5.2, 5.3_
  
  - [x] 1.3 编写数据模型属性测试
    - **Property 5: SearchResult 默认初始化**
    - **验证: 需求 5.3**

- [ ] 2. 浏览器管理功能
  - [x] 2.1 实现浏览器检测逻辑
    - 定义 EDGE_PATHS 和 CHROME_PATHS 常量
    - 实现 `_find_browser()` 方法，优先检测 Edge
    - _需求: 1.1, 1.2_
  
  - [x] 2.2 实现 GoogleAISearcher 初始化
    - 接受 timeout 和 headless 参数
    - 调用 `_find_browser()` 初始化浏览器路径
    - _需求: 1.4, 1.5_
  
  - [x] 2.3 编写浏览器检测单元测试
    - 测试 Edge 优先于 Chrome 的检测顺序
    - 测试无浏览器时返回 None
    - _需求: 1.1, 1.3_

- [x] 3. 检查点 - 确保数据模型和浏览器管理测试通过
  - 确保所有测试通过，如有问题请询问用户

- [ ] 4. URL 构造和搜索执行
  - [x] 4.1 实现 URL 构造逻辑
    - 使用 `urllib.parse.quote_plus` 编码查询词
    - 构造包含 `udm=50` 和 `hl={language}` 参数的 URL
    - _需求: 2.1, 2.5_
  
  - [x] 4.2 编写 URL 构造属性测试
    - **Property 1: URL 构造正确性**
    - **验证: 需求 2.1, 2.5**
  
  - [x] 4.3 实现 search() 方法主体
    - 检查浏览器可用性，不可用时返回错误
    - 使用 Patchright/Playwright 启动浏览器
    - 配置防检测参数和 user-agent
    - 访问 URL 并等待页面加载
    - 调用 `_extract_ai_answer()` 提取结果
    - 捕获异常并返回错误 SearchResult
    - _需求: 1.3, 2.2, 2.3, 2.4, 2.6_

- [ ] 5. 内容提取逻辑
  - [x] 5.1 实现 `_extract_ai_answer()` 方法
    - 使用 JavaScript 在页面中提取 AI 回答文本
    - 清理导航文本和提示信息
    - 提取来源链接，过滤 Google 链接
    - 去除重复 URL，限制最多 10 个来源
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [x] 5.2 编写文本清理属性测试
    - **Property 2: 文本清理正确性**
    - **验证: 需求 3.2**
  
  - [x] 5.3 编写链接处理属性测试
    - **Property 3: 链接处理正确性**
    - **验证: 需求 3.3, 3.4, 3.5**

- [x] 6. 检查点 - 确保搜索逻辑测试通过
  - 确保所有测试通过，如有问题请询问用户

- [ ] 7. MCP Server 集成
  - [x] 7.1 实现 MCP Server 入口
    - 在 `src/google_ai_search/server.py` 中创建 Server 实例
    - 实现 `list_tools()` 注册 google_ai_search 工具
    - 定义工具的 inputSchema
    - _需求: 4.1, 4.2_
  
  - [x] 7.2 实现工具调用处理
    - 实现 `call_tool()` 处理工具调用
    - 验证 query 参数非空
    - 调用 Searcher 执行搜索
    - 格式化成功结果为 Markdown
    - 处理失败情况返回错误信息
    - _需求: 4.3, 4.4, 4.5, 4.6_
  
  - [x] 7.3 编写输出格式属性测试
    - **Property 4: 输出格式正确性**
    - **验证: 需求 4.4**
  
  - [x] 7.4 实现 main() 入口函数
    - 使用 stdio_server 启动 MCP 服务
    - _需求: 4.1_

- [ ] 8. 模块导出和文档
  - [x] 8.1 创建 `__init__.py` 导出公共接口
    - 导出 GoogleAISearcher, SearchResult, SearchSource
    - 定义 `__version__` 和 `__all__`
    - _需求: 5.1, 5.2_
  
  - [x] 8.2 创建 README.md 文档
    - 包含安装说明、MCP 配置示例、使用方法
    - _需求: 4.1_

- [x] 9. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户

## 备注

- 所有任务均为必需任务
- 每个任务引用具体的需求编号以保证可追溯性
- 属性测试验证普遍正确性属性
- 单元测试验证具体示例和边界情况
