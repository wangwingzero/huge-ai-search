# Huge AI Search CLI reference

## Commands

```text
huge-ai-search                         # MCP stdio server
huge-ai-search search [options]        # one-shot search
huge-ai-search skill-install           # copy this skill to agent dirs
huge-ai-search schema search           # JSON parameter schema
huge-ai-search --version
huge-ai-search --help
```

## search flags

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Natural-language question |
| `--language`, `-l` | `zh-CN` `en-US` `ja-JP` `ko-KR` `de-DE` `fr-FR` |
| `--follow-up` | Continue previous session (pass `--session-id`) |
| `--session-id` | Value from the previous result |
| `--image` | Absolute local image path |
| `--create-image` | Google AI Mode image creation |
| `--format json\|markdown` | stdout format |
| `--json` | Shortcut for `--format json` |

## JSON envelope

```json
{
  "ok": true,
  "command": "search",
  "data": {
    "query": "...",
    "answer_markdown": "...",
    "session_id": "session_..."
  },
  "error": null,
  "meta": { "cli": "huge-ai-search", "version": "..." }
}
```

Failure: `ok=false`, `data=null`, `error.message` has the reason, `error.retryable` says whether to retry immediately.

Exit codes: `0` success, `1` search failed, `2` bad usage.

## skill-install targets

Copies `skills/huge-ai-search` to:

- `~/.cursor/skills/huge-ai-search`
- `~/.claude/skills/huge-ai-search`
- `~/.codex/skills/huge-ai-search`
- `~/.agents/skills/huge-ai-search`
