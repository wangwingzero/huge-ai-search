# Requirements Document

## Introduction

This document specifies the requirements for migrating the Google AI Search MCP server from Patchright (Playwright fork) to nodriver browser automation library. The migration aims to improve anti-detection capabilities while maintaining all existing functionality including Google AI Mode search, multi-language support, persistent sessions, and CAPTCHA handling.

## Glossary

- **Searcher**: The core component responsible for browser automation and content extraction from Google AI Mode
- **MCP_Server**: The Model Context Protocol server that exposes the search tool to AI assistants
- **Browser_Session**: A persistent browser instance that maintains login state and cookies across searches
- **AI_Answer**: The AI-generated summary content extracted from Google AI Mode search results
- **Source_Link**: A reference URL extracted from search results with title and snippet
- **Follow_Up**: A continuation query in an existing browser session to maintain conversation context
- **User_Data_Dir**: A persistent directory storing browser profile data including cookies and login state
- **nodriver**: An async Python library for browser automation with built-in anti-detection features

## Requirements

### Requirement 1: Browser Initialization

**User Story:** As a developer, I want the searcher to initialize a nodriver browser instance, so that I can perform automated searches with anti-detection capabilities.

#### Acceptance Criteria

1. WHEN the Searcher initializes, THE Searcher SHALL detect available browsers (Edge preferred, Chrome fallback)
2. WHEN a browser path is found, THE Searcher SHALL store it for later use
3. WHEN no browser is found, THE Searcher SHALL return an appropriate error message
4. WHEN initializing with user_data_dir option, THE Searcher SHALL use the specified directory for persistent session data
5. IF the user_data_dir is already in use by another instance, THEN THE Searcher SHALL handle the conflict gracefully

### Requirement 2: Async Browser Session Management

**User Story:** As a developer, I want the searcher to manage async browser sessions, so that I can perform searches without blocking the MCP server.

#### Acceptance Criteria

1. WHEN starting a browser session, THE Searcher SHALL use `await nodriver.start()` with appropriate configuration
2. WHEN a session is active, THE Searcher SHALL track the last activity time for timeout management
3. WHEN a session exceeds the timeout period (5 minutes), THE Searcher SHALL close the session automatically
4. WHEN closing a session, THE Searcher SHALL properly cleanup browser resources
5. THE Searcher SHALL support headless mode configuration (though nodriver recommends headed mode)

### Requirement 3: URL Construction

**User Story:** As a developer, I want to construct Google AI Mode URLs, so that I can access AI-summarized search results.

#### Acceptance Criteria

1. WHEN constructing a search URL, THE Searcher SHALL include the `udm=50` parameter for AI Mode
2. WHEN a language is specified, THE Searcher SHALL include the `hl` parameter with the language code
3. WHEN a query contains special characters, THE Searcher SHALL properly URL-encode the query string
4. FOR ALL valid queries and languages, constructing then parsing the URL SHALL preserve the original query (round-trip property)

### Requirement 4: Page Navigation and Content Loading

**User Story:** As a developer, I want to navigate to search pages and wait for content, so that I can extract complete AI answers.

#### Acceptance Criteria

1. WHEN navigating to a URL, THE Searcher SHALL use `await tab.get(url)` for page loading
2. WHEN waiting for content, THE Searcher SHALL use `await tab.wait_for(selector)` or JavaScript evaluation
3. WHEN AI content is streaming, THE Searcher SHALL wait for streaming to complete before extraction
4. WHEN a page load times out, THE Searcher SHALL return an appropriate error
5. WHEN detecting loading indicators, THE Searcher SHALL continue waiting until content stabilizes

### Requirement 5: AI Answer Extraction

**User Story:** As a developer, I want to extract AI answers from search results, so that I can return structured content to users.

#### Acceptance Criteria

1. WHEN extracting content, THE Searcher SHALL use `await tab.evaluate(js_code)` to run JavaScript
2. WHEN AI content is found, THE Searcher SHALL extract the main answer text
3. WHEN source links are present, THE Searcher SHALL extract title, URL, and snippet for each source
4. WHEN navigation text is present, THE Searcher SHALL clean it from the extracted content
5. FOR ALL extracted SearchResult objects, serializing then deserializing SHALL produce an equivalent object (round-trip property)

### Requirement 6: Multi-Language Support

**User Story:** As a user, I want to search in different languages, so that I can get results in my preferred language.

#### Acceptance Criteria

1. WHEN a language code is provided, THE Searcher SHALL set the browser locale accordingly
2. THE Searcher SHALL support at minimum: zh-CN, en-US, ja-JP, ko-KR, de-DE, fr-FR
3. WHEN extracting content, THE Searcher SHALL handle multi-language AI mode labels
4. WHEN cleaning content, THE Searcher SHALL handle multi-language navigation patterns

### Requirement 7: Follow-Up Conversation

**User Story:** As a user, I want to ask follow-up questions, so that I can have a continuous conversation with AI.

#### Acceptance Criteria

1. WHEN a follow-up is requested with an active session, THE Searcher SHALL find the follow-up input element
2. WHEN submitting a follow-up, THE Searcher SHALL fill the input and trigger submission
3. WHEN extracting follow-up results, THE Searcher SHALL return only the new content (incremental extraction)
4. IF no follow-up input is found, THEN THE Searcher SHALL navigate to a new search URL
5. WHEN performing incremental extraction, THE Searcher SHALL remove the user's query from the new content

### Requirement 8: CAPTCHA and User Intervention Handling

**User Story:** As a user, I want the system to handle CAPTCHAs, so that I can complete verification when needed.

#### Acceptance Criteria

1. WHEN a CAPTCHA page is detected, THE Searcher SHALL open a visible browser window for user verification
2. WHEN user intervention is needed, THE Searcher SHALL wait up to 5 minutes for completion
3. WHEN the user completes verification, THE Searcher SHALL continue with the search
4. IF verification times out, THEN THE Searcher SHALL return an appropriate error message
5. WHEN detecting CAPTCHA, THE Searcher SHALL check for known CAPTCHA keywords in page content

### Requirement 9: Proxy Detection and Configuration

**User Story:** As a developer, I want the searcher to detect and use system proxies, so that searches work in network-restricted environments.

#### Acceptance Criteria

1. WHEN starting a browser, THE Searcher SHALL check environment variables for proxy settings
2. WHEN no environment proxy is found, THE Searcher SHALL detect common local proxy ports (v2ray, clash)
3. WHEN a proxy is detected, THE Searcher SHALL configure the browser to use it
4. THE Searcher SHALL prefer HTTP proxies over SOCKS5 for better stability

### Requirement 10: Resource Optimization

**User Story:** As a developer, I want to optimize resource usage, so that searches are fast and memory-efficient.

#### Acceptance Criteria

1. WHEN loading pages, THE Searcher SHALL block unnecessary resources (images, fonts, media)
2. WHEN blocking resources, THE Searcher SHALL also block known ad and tracking domains
3. THE Searcher SHALL use efficient waiting strategies to minimize unnecessary delays

### Requirement 11: MCP Server Integration

**User Story:** As a developer, I want the MCP server to work with the async searcher, so that AI assistants can use the search tool.

#### Acceptance Criteria

1. WHEN the MCP server receives a search request, THE MCP_Server SHALL call the async searcher
2. WHEN multiple requests arrive concurrently, THE MCP_Server SHALL limit concurrent searches (max 2)
3. WHEN a search times out (120 seconds), THE MCP_Server SHALL return an appropriate error
4. WHEN formatting results, THE MCP_Server SHALL produce valid Markdown output
5. FOR ALL SearchResult objects, formatting then parsing the Markdown SHALL preserve essential information

### Requirement 12: Error Handling and Logging

**User Story:** As a developer, I want comprehensive error handling and logging, so that I can diagnose issues.

#### Acceptance Criteria

1. WHEN an error occurs, THE Searcher SHALL log detailed error information including stack traces
2. WHEN a search fails, THE Searcher SHALL return a SearchResult with success=False and error message
3. THE Searcher SHALL use rotating log files with automatic cleanup (7 days retention)
4. WHEN logging, THE Searcher SHALL output to both file and stderr for MCP visibility
