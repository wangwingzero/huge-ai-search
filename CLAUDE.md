# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

### MCP Server (root)
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode (tsc --watch)
npm start            # Run the MCP server (node dist/index.js)
```

### VS Code Extension (extensions/huge-ai-chat)
```bash
cd extensions/huge-ai-chat
npm install
npm run compile       # esbuild bundle (CJS, minified)
npm run watch         # esbuild watch mode
npm test              # check:release + tsc (type-check) + node --test
npm run package:vsix  # Build .vsix for distribution
```

Extension uses esbuild for bundling (CJS format for VS Code), not tsc. The `tsc -p .` step only runs during `npm test` for type-checking.

Tests use Node's built-in `node:test` runner. Test files live in `extensions/huge-ai-chat/tests/`. Run a single test file with `node --test extensions/huge-ai-chat/tests/<file>.test.js` (after `tsc -p .` in the extension directory).

The root project has no test suite or linter configured.

## Architecture

This is an MCP (Model Context Protocol) server that provides AI-powered web search by automating Google AI Mode through Microsoft Edge via Playwright. It exposes a single `search` tool over stdio transport.

### Core Components (src/)

- **index.ts** — MCP server entry point. Registers the `search` tool, manages session lifecycle (max 5 concurrent sessions, 10-min idle timeout), enforces concurrency limits (max 3 per-process), applies strict grounding/hallucination checks for technical queries, and formats results as Markdown.
- **searcher.ts** — Playwright browser automation. Handles Edge launch, Google AI Mode navigation, result extraction, CAPTCHA detection, follow-up conversations, image upload (Google Lens), proxy auto-detection, and anti-detection measures. Each session gets an isolated browser context with persistent data under `~/.huge-ai-search/browser_data/{sessionId}/`.
- **coordinator.ts** — Cross-process concurrency control using file-system locks in `~/.huge-ai-search/coordinator/`. Slot-based (max 4 global slots) with heartbeat/lease mechanism and stale-lock cleanup.
- **logger.ts** — File-based logging to `~/.huge-ai-search/logs/search_YYYY-MM-DD.log`. Configurable via `HUGE_AI_SEARCH_LOG_DIR` and `HUGE_AI_SEARCH_LOG_RETENTION_DAYS` (default 14).
- **setup.ts** — CLI tool (`huge-ai-search-setup`) that launches a headed Edge browser for Google account login.

### Request Flow

1. MCP client sends `search` tool call → `index.ts` handler
2. Check login cooldown and CAPTCHA state
3. Acquire local concurrency slot (max 3), then global slot via `coordinator.ts` (max 4)
4. Get or create a session (browser context in `searcher.ts`)
5. Execute search (new query) or `continueConversation` (follow-up with `follow_up: true`)
6. Apply grounding validation for technical/definition queries
7. Return formatted Markdown with answer, sources, session_id, and debug markers
8. Release concurrency slots

### VS Code Extension (extensions/huge-ai-chat)

A sidebar webview chat UI that spawns the MCP server as a child process.

- **extension.ts** — VS Code entry, registers commands and sidebar webview provider
- **ChatController.ts** — Orchestrates MCP tool calls with timeout handling
- **McpClientManager.ts** — Manages the MCP server subprocess lifecycle
- **ThreadStore.ts** — Persists conversation threads locally
- **responseFormatter.ts** — Parses search tool output into structured answer/sources
- **media/** — Webview HTML/CSS/JS for the chat panel

## Coding Conventions

- TypeScript with strict mode, 2-space indentation, semicolons, double quotes
- ESM imports (`import ... from "..."`) targeting ES2022
- Root uses `NodeNext` module resolution; extension uses `Node16`
- No formatter or linter is configured — follow existing patterns
- Commit messages use Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)

## Key Constraints

- **Edge only** — Playwright is configured exclusively for Microsoft Edge (Chromium channel), not Chrome or Firefox.
- **Timeouts** — Single search: 42s execution timeout, 55s total budget (to stay under 60s MCP client deadline).
- **Proxy detection** — Auto-detects `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` env vars, then probes common local ports (7890, 10809, 10808, 7891, 1080).
- **Runtime data** — All persistent state lives under `~/.huge-ai-search/` (browser data, logs, coordinator locks). Never committed to git.
