# Implementation Plan: nodriver Migration

## Overview

This implementation plan migrates the Google AI Search MCP server from Patchright (Playwright fork) to nodriver browser automation library. The migration follows an incremental approach, ensuring each step builds on the previous and maintains working functionality.

## Tasks

- [x] 1. Update project dependencies
  - [x] 1.1 Update pyproject.toml to replace patchright with nodriver
    - Replace `patchright>=1.0.0` with `nodriver>=0.38`
    - Remove `nest-asyncio>=1.5.0` (no longer needed)
    - _Requirements: 2.1_

- [x] 2. Implement async browser session management
  - [x] 2.1 Create new async searcher class structure
    - Create `AsyncGoogleAISearcher` class with async methods
    - Implement `__init__` with timeout, headless, use_user_data parameters
    - Implement browser path detection (Edge preferred, Chrome fallback)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [x] 2.2 Write property test for browser detection priority
    - **Property 10: Browser Detection Priority**
    - **Validates: Requirements 1.1**
  
  - [x] 2.3 Implement async session lifecycle methods
    - Implement `async _start_browser()` using `nodriver.start()`
    - Implement `async close_session()` for cleanup
    - Implement `has_active_session()` for session state check
    - Implement session timeout tracking (5 minutes)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [x] 2.4 Write property test for session activity tracking
    - **Property 11: Session Activity Tracking**
    - **Validates: Requirements 2.2**

- [x] 3. Checkpoint - Verify browser session management
  - Ensure browser can start and close properly
  - Ensure all tests pass, ask the user if questions arise

- [x] 4. Implement URL construction and proxy detection
  - [x] 4.1 Migrate URL construction to async searcher
    - Implement `_build_url()` method with udm=50 and hl parameters
    - Ensure proper URL encoding for special characters
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [x] 4.2 Write property test for URL construction
    - **Property 1: URL Construction Correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  
  - [x] 4.3 Migrate proxy detection logic
    - Implement `_detect_proxy()` with environment variable check
    - Implement local port detection (v2ray, clash)
    - Ensure HTTP proxy preference over SOCKS5
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [x] 4.4 Write property test for proxy preference
    - **Property 7: Proxy Preference Order**
    - **Validates: Requirements 9.4**

- [x] 5. Implement page navigation and content waiting
  - [x] 5.1 Implement async page navigation
    - Implement `async _navigate_to_url()` using `tab.get()`
    - Handle navigation timeout errors
    - _Requirements: 4.1, 4.4_
  
  - [x] 5.2 Implement content waiting strategies
    - Implement `async _wait_for_ai_content()` using `tab.wait_for()` and JS evaluation
    - Implement `async _wait_for_streaming_complete()` with content stability detection
    - Handle loading indicators and follow-up input detection
    - _Requirements: 4.2, 4.3, 4.5_
  
  - [x] 5.3 Implement resource blocking
    - Implement `async _setup_resource_blocking()` using CDP
    - Block images, fonts, media, ads, and tracking domains
    - _Requirements: 10.1, 10.2_

- [x] 6. Implement content extraction
  - [x] 6.1 Migrate JavaScript extraction logic
    - Implement `async _extract_ai_answer()` using `tab.evaluate()`
    - Extract AI answer text and source links
    - Handle multi-language AI mode labels
    - _Requirements: 5.1, 5.2, 5.3, 6.3_
  
  - [x] 6.2 Implement content cleaning
    - Implement `clean_ai_answer()` for navigation text removal
    - Handle multi-language navigation patterns
    - _Requirements: 5.4, 6.4_
  
  - [x] 6.3 Write property test for navigation text cleaning
    - **Property 3: Navigation Text Cleaning**
    - **Validates: Requirements 5.4**
  
  - [x] 6.4 Write property test for multi-language support
    - **Property 4: Multi-Language Label Recognition**
    - **Validates: Requirements 6.2, 6.3, 6.4**

- [x] 7. Checkpoint - Verify content extraction
  - Ensure AI content can be extracted correctly
  - Ensure all tests pass, ask the user if questions arise

- [x] 8. Implement main search method
  - [x] 8.1 Implement async search method
    - Implement `async search()` orchestrating session, navigation, and extraction
    - Handle CAPTCHA detection and user intervention
    - Return SearchResult with proper error handling
    - _Requirements: 1.1, 4.1, 5.2, 8.1, 8.5, 12.2_
  
  - [x] 8.2 Write property test for CAPTCHA detection
    - **Property 6: CAPTCHA Detection**
    - **Validates: Requirements 8.5**
  
  - [x] 8.3 Write property test for error result format
    - **Property 9: Error Result Format**
    - **Validates: Requirements 12.2**

- [x] 9. Implement follow-up conversation
  - [x] 9.1 Implement follow-up input detection and submission
    - Implement `async _find_follow_up_input()` using nodriver selectors
    - Implement `async _submit_follow_up()` with input filling and submission
    - _Requirements: 7.1, 7.2_
  
  - [x] 9.2 Implement incremental content extraction
    - Implement logic to extract only new content
    - Implement user query removal from new content
    - _Requirements: 7.3, 7.5_
  
  - [x] 9.3 Write property test for incremental extraction
    - **Property 5: Incremental Content Extraction**
    - **Validates: Requirements 7.3, 7.5**
  
  - [x] 9.4 Implement continue_conversation method
    - Implement `async continue_conversation()` orchestrating follow-up flow
    - Handle fallback to new search when follow-up input not found
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 10. Implement CAPTCHA and user intervention handling
  - [x] 10.1 Implement user intervention flow
    - Implement `async _handle_user_intervention()` opening visible browser
    - Implement 5-minute timeout for user verification
    - Handle verification completion and timeout
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 11. Checkpoint - Verify search and follow-up functionality
  - Ensure search returns valid results
  - Ensure follow-up works correctly
  - Ensure all tests pass, ask the user if questions arise

- [x] 12. Update MCP server integration
  - [x] 12.1 Simplify server.py for async searcher
    - Remove nest_asyncio import and apply()
    - Remove ThreadPoolExecutor and run_in_executor calls
    - Update searcher instantiation to AsyncGoogleAISearcher
    - _Requirements: 11.1_
  
  - [x] 12.2 Update call_tool handler for direct async calls
    - Call `await searcher.search()` directly
    - Call `await searcher.continue_conversation()` for follow-ups
    - Maintain semaphore for concurrency control (max 2)
    - _Requirements: 11.1, 11.2, 11.3_
  
  - [x] 12.3 Write property test for Markdown formatting
    - **Property 8: Markdown Formatting Correctness**
    - **Validates: Requirements 11.4, 11.5**

- [x] 13. Update data models and utilities
  - [x] 13.1 Ensure SearchResult and SearchSource compatibility
    - Verify dataclass definitions work with new async code
    - Ensure JSON serialization works correctly
    - _Requirements: 5.5_
  
  - [x] 13.2 Write property test for SearchResult round-trip
    - **Property 2: SearchResult Serialization Round-Trip**
    - **Validates: Requirements 5.5**

- [x] 14. Update logging and error handling
  - [x] 14.1 Ensure logging works with async code
    - Verify rotating log files work correctly
    - Ensure stderr output for MCP visibility
    - _Requirements: 12.1, 12.3, 12.4_

- [x] 15. Final checkpoint - Full integration testing
  - Run all property tests
  - Verify MCP server starts correctly
  - Test search functionality end-to-end
  - Ensure all tests pass, ask the user if questions arise

- [x] 16. Update package exports and documentation
  - [x] 16.1 Update __init__.py exports
    - Export AsyncGoogleAISearcher instead of GoogleAISearcher
    - Maintain backward compatibility if needed
    - _Requirements: 11.1_
  
  - [x] 16.2 Update README.md
    - Document nodriver dependency
    - Update any usage examples
    - Note async API changes

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (100+ iterations with Hypothesis)
- Unit tests validate specific examples and edge cases
- The migration maintains all existing functionality while switching the underlying browser automation library
