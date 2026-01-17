# Google AI Search MCP - 多进程卡死问题排查文档

## 问题概述

MCP 服务器在执行搜索时完全卡死，子进程无法返回结果。

## 当前状态

- **问题**: `_search_in_new_process()` 函数启动子进程后，子进程永远不返回结果
- **表现**: 日志显示 "使用新进程执行搜索" 后无任何输出，2分钟后超时
- **影响**: MCP 完全不可用

## 关键文件

```
D:/google-ai-search-mcp/
├── src/google_ai_search/
│   ├── server.py      # MCP 服务器，包含卡死的 _search_in_new_process()
│   └── searcher.py    # 搜索器，包含浏览器操作逻辑
├── logs/              # 日志目录
└── edge_browser_data/ # 浏览器用户数据（已登录 Google）
```

## 问题根因分析

### 1. 多进程 + Patchright/Playwright 冲突

子进程中使用 `sync_playwright()` 可能与 Windows 的进程模型冲突：

```python
# server.py 中的问题代码
def _run_search_in_process(result_queue, query, language, ...):
    # 这个函数在子进程中运行
    local_searcher = GoogleAISearcher(...)  # 创建新实例
    result = local_searcher.search(query, language)  # 卡在这里
    result_queue.put((True, result))  # 永远执行不到
```

### 2. 可能的原因

1. **Playwright 在子进程中初始化失败** - `sync_playwright().start()` 可能在子进程中无法正常工作
2. **浏览器用户数据目录锁定** - 多个进程尝试访问同一个 `edge_browser_data` 目录
3. **Windows multiprocessing 需要 `if __name__ == '__main__'` 保护**
4. **asyncio 事件循环在子进程中的状态问题**

### 3. 日志证据

```
00:07:11 | INFO | 使用新进程执行搜索
# 然后完全没有任何日志，直到 2 分钟后超时
00:09:12 | INFO | 搜索结果: success=False, error=搜索超时（进程未响应）
```

子进程内部的日志（如 "开始搜索"、"启动浏览器会话"）完全没有出现，说明子进程可能：
- 根本没有启动
- 启动后立即卡死在 Playwright 初始化

## 建议的修复方案

### 方案 A: 放弃多进程，使用 nest-asyncio（推荐）

回退到原来的 `ThreadPoolExecutor` 方案，用 `nest-asyncio` 解决事件循环冲突：

```python
# server.py 顶部添加
import nest_asyncio
nest_asyncio.apply()  # 允许嵌套事件循环

_executor = ThreadPoolExecutor(max_workers=1)

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    loop = asyncio.get_running_loop()
    # 直接在线程池中运行，不用子进程
    result = await loop.run_in_executor(_executor, searcher.search, query, language)
    return result
```

需要安装: `pip install nest-asyncio`

### 方案 B: 使用 subprocess 调用独立脚本

创建一个独立的搜索脚本，通过 subprocess 调用：

```python
# 新建 search_worker.py (独立脚本)
import sys
import json
from searcher import GoogleAISearcher

if __name__ == '__main__':
    query = sys.argv[1]
    language = sys.argv[2]
    searcher = GoogleAISearcher(headless=True, use_user_data=True, timeout=60)
    result = searcher.search(query, language)
    # 输出 JSON 结果
    output = {
        'success': result.success,
        'query': result.query,
        'ai_answer': result.ai_answer,
        'error': result.error,
        'sources': [{'title': s.title, 'url': s.url, 'snippet': s.snippet} for s in result.sources]
    }
    print(json.dumps(output, ensure_ascii=False))

# server.py 中调用
import subprocess
import json

def _search_via_subprocess(query: str, language: str) -> SearchResult:
    try:
        result = subprocess.run(
            ['python', 'search_worker.py', query, language],
            capture_output=True,
            text=True,
            timeout=120,
            cwd='D:/google-ai-search-mcp/src/google_ai_search'
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            return SearchResult(
                success=data['success'],
                query=data['query'],
                ai_answer=data['ai_answer'],
                error=data['error'],
                sources=[SearchSource(**s) for s in data['sources']]
            )
        else:
            return SearchResult(success=False, query=query, error=result.stderr)
    except subprocess.TimeoutExpired:
        return SearchResult(success=False, query=query, error="搜索超时")
    except Exception as e:
        return SearchResult(success=False, query=query, error=str(e))
```

### 方案 C: 使用 spawn 方法

```python
# server.py 顶部，在所有 import 之前
import multiprocessing
if __name__ == '__main__':
    multiprocessing.set_start_method('spawn')
```

## 临时解决方案

在修复完成前，最简单的方案是直接删除多进程逻辑，回退到线程池：

```python
# server.py 中的 call_tool 函数，删除多进程分支
@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    # ... 参数处理 ...
    
    loop = asyncio.get_running_loop()
    
    # 直接使用线程池，不用子进程
    result = await loop.run_in_executor(_executor, searcher.search, query, language)
    
    # ... 结果处理 ...
```

这可能会有 asyncio 警告，但至少能工作。

## 测试验证

修复后需要验证：

1. 单次搜索正常返回
2. 连续多次搜索正常
3. 多个 Kiro 窗口同时搜索不冲突
4. 登录状态正确共享

## 相关背景

### 为什么要用多进程？

原因是 Patchright 的 `sync_playwright()` 内部会创建自己的事件循环，与 MCP 服务器的 asyncio 事件循环冲突。

### 为什么多进程不工作？

Windows 上的 multiprocessing 默认使用 `spawn` 方法，子进程需要重新 import 所有模块。Playwright/Patchright 在这个过程中可能有问题。

## 日志位置

`D:/google-ai-search-mcp/logs/google_ai_search_*.log`
