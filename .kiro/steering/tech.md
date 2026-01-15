# Tech Stack

## Language & Runtime
- Python 3.10+
- Async/await patterns for MCP server

## Build System
- Hatchling (PEP 517 build backend)
- `pyproject.toml` for project configuration

## Core Dependencies
- `mcp>=1.0.0` - Model Context Protocol SDK
- `patchright>=1.0.0` - Anti-detection Playwright fork (falls back to playwright if unavailable)

## Dev Dependencies
- `pytest>=7.0.0` - Testing framework
- `pytest-asyncio>=0.21.0` - Async test support
- `hypothesis>=6.0.0` - Property-based testing

## Browser Support
- Microsoft Edge (preferred, Windows pre-installed)
- Google Chrome (fallback)
- Uses persistent user data directory for session persistence

## Common Commands

```bash
# Install package in development mode
pip install -e .

# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/ -v

# Run specific test file
pytest tests/test_url.py -v

# Run MCP server directly
python -m google_ai_search.server
```

## MCP Configuration

Kiro (`~/.kiro/settings/mcp.json`):
```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "python",
      "args": ["-m", "google_ai_search.server"],
      "cwd": "<project-path>/src"
    }
  }
}
```
