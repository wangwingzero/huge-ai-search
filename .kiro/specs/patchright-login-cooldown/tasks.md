# Implementation Plan: Patchright Login Cooldown

## Overview

This plan implements a login timeout cooldown mechanism for the Patchright MCP server, following the pattern established in the google-ai-search MCP server. The implementation adds module-level state tracking and cooldown logic to prevent repeated operations when user verification times out.

## Tasks

- [x] 1. Add cooldown state variables and helper functions
  - [x] 1.1 Add module-level imports and state variables to server.py
    - Add `time` import and `Optional` from typing
    - Add `_login_timeout_timestamp: Optional[float] = None`
    - Add `_LOGIN_COOLDOWN_SECONDS = 300`
    - _Requirements: 2.1, 2.2_
  
  - [x] 1.2 Implement `_is_login_timeout_error` function
    - Create function to detect login/verification timeout errors
    - Include keywords: timeout, 验证超时, 登录超时, captcha, 验证码, login required, authentication
    - Return True if any keyword found in error string (case-insensitive)
    - _Requirements: 1.1, 1.2_
  
  - [x] 1.3 Write property tests for `_is_login_timeout_error`
    - **Property 1: Login Timeout Keyword Detection**
    - **Property 2: Non-Login Error Rejection**
    - **Validates: Requirements 1.1, 1.2**

- [ ] 2. Implement cooldown check and recording functions
  - [-] 2.1 Implement `_check_cooldown` function
    - Check if `_login_timeout_timestamp` is set
    - Calculate elapsed time since timeout
    - Return cooldown message if within cooldown period
    - Reset timestamp and return None if cooldown expired
    - Include remaining time in minutes and seconds in message
    - _Requirements: 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [~] 2.2 Implement `_record_login_timeout` function
    - Set `_login_timeout_timestamp` to current time
    - Return TextContent with timeout notification message
    - Include cooldown duration and MCP limitation explanation
    - _Requirements: 1.3, 6.1, 6.2, 6.3, 6.4_
  
  - [~] 2.3 Write property tests for cooldown functions
    - **Property 3: Timestamp Recording**
    - **Property 4: Cooldown Message During Active Cooldown**
    - **Property 5: Cooldown Reset After Expiry**
    - **Property 6: Remaining Time Accuracy**
    - **Property 7: Normal Operation After Reset**
    - **Validates: Requirements 1.3, 2.4, 2.5, 3.2, 4.1, 4.2**

- [ ] 3. Integrate cooldown into call_tool function
  - [~] 3.1 Add cooldown check at start of call_tool
    - Call `_check_cooldown()` before any tool dispatch
    - Return cooldown message immediately if in cooldown
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [~] 3.2 Add login timeout detection after each tool operation
    - Check `result.success` and call `_is_login_timeout_error(result.error)`
    - Call `_record_login_timeout()` and return its message if timeout detected
    - Apply to all 5 tools: patchright_fetch, patchright_screenshot, patchright_click, patchright_fill_form, patchright_execute_js
    - _Requirements: 1.3, 5.1_

- [~] 4. Checkpoint - Verify implementation
  - Ensure all tests pass, ask the user if questions arise.
  - Manually test cooldown behavior by simulating timeout errors

- [ ] 5. Write integration tests
  - [~] 5.1 Write unit tests for message content
    - Verify cooldown message contains required elements
    - Verify timeout message contains required elements
    - _Requirements: 3.3, 3.4, 3.5, 6.1, 6.2, 6.3, 6.4_

## Notes

- All tasks are required for comprehensive testing
- Implementation follows the existing pattern in `src/google_ai_search/server.py` (lines 27-35, 77-100)
- All 5 patchright tools share the same cooldown state
- Property tests use Hypothesis library with minimum 100 iterations
