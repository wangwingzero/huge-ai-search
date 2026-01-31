# Project Structure

```
huge-ai-search/
├── src/
│   └── google_ai_search/       # Main package (name kept for import compatibility)
│       ├── __init__.py         # Package exports (AsyncGoogleAISearcher, SearchResult, SearchSource)
│       ├── server.py           # MCP server implementation
│       └── searcher.py         # Core search logic and data models
├── tests/                      # Test suite
│   ├── test_url.py             # URL construction tests (Property 1)
│   ├── test_extraction.py      # Content extraction tests (Property 2, 3)
│   ├── test_models.py          # Data model tests (Property 5)
│   └── test_server.py          # Server output format tests (Property 4)
├── chrome_browser_data/        # Chrome browser session data (gitignored content)
├── edge_browser_data/          # Edge browser session data (backup)
├── pyproject.toml              # Project configuration
└── README.md                   # Documentation (Chinese)
```

## Key Components

### `searcher.py`
- `SearchSource` - Dataclass for source links (title, url, snippet)
- `SearchResult` - Dataclass for search results (success, query, ai_answer, sources, error)
- `AsyncGoogleAISearcher` - Main async class handling browser automation and content extraction

### `server.py`
- MCP server setup using `mcp.server.Server`
- `list_tools()` - Exposes `huge_ai_search` tool
- `call_tool()` - Handles tool invocation
- `format_search_result()` - Formats results as Markdown

## Testing Conventions
- Tests use property-based testing with Hypothesis
- Each test file maps to specific correctness properties
- Tests include `**验证: 需求 X.X**` comments linking to requirements
- Use `sys.path.insert(0, 'src')` for imports in tests
