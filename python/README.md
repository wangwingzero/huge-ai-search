# Huge AI Search MCP Server (Python)

🔍 AI 搜索聚合 MCP 服务器的 Python 版本。

## 安装

```bash
cd python
pip install -e .
```

## MCP 配置

```json
{
  "mcpServers": {
    "huge-ai-search": {
      "command": "python",
      "args": ["-m", "huge_ai_search.server"],
      "cwd": "<项目路径>/python/src"
    }
  }
}
```

## 首次使用

```bash
python setup_browser.py
```

## 依赖

- Python 3.10+
- patchright (或 playwright)
- mcp >= 1.0.0

## License

MIT
