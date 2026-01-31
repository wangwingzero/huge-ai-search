# Product Overview

Huge AI Search MCP Server - An MCP (Model Context Protocol) server that scrapes 虎哥 AI Mode search results using nodriver (anti-detection browser automation).

## Core Functionality

- Access 虎哥 AI Mode (`udm=50`) to get AI-summarized search results
- Bypass anti-bot detection using nodriver
- Support multi-language searches
- Return AI answers with source links
- Handle CAPTCHA by opening browser window for user verification

## Target Users

- AI assistants (Claude Desktop, Kiro) that need real-time 虎哥 AI search capabilities
- Developers building applications that require 虎哥 AI search integration

## Key Features

- Single MCP tool: `huge_ai_search`
- Parameters: `query` (required), `language` (optional, default: zh-CN)
- Returns: Markdown-formatted AI answer with up to 5 source links
- Uses persistent browser data to maintain login state
