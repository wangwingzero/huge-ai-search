# Product Overview

Google AI Search MCP Server - An MCP (Model Context Protocol) server that scrapes Google AI Mode search results using Patchright (anti-detection Playwright fork).

## Core Functionality

- Access Google AI Mode (`udm=50`) to get AI-summarized search results
- Bypass anti-bot detection using Patchright
- Support multi-language searches
- Return AI answers with source links
- Handle CAPTCHA by opening browser window for user verification

## Target Users

- AI assistants (Claude Desktop, Kiro) that need real-time Google AI search capabilities
- Developers building applications that require Google AI search integration

## Key Features

- Single MCP tool: `google_ai_search`
- Parameters: `query` (required), `language` (optional, default: zh-CN)
- Returns: Markdown-formatted AI answer with up to 5 source links
- Uses persistent browser data to maintain login state
