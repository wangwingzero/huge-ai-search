# Requirements Document

## Introduction

This feature adds a login timeout cooldown mechanism to the Patchright MCP server. When a browser operation requires user login/verification and the user doesn't complete it within the timeout period (likely because they are away from the computer), the MCP server will enter a cooldown state. During this cooldown period, subsequent requests will return a helpful message instead of repeatedly attempting operations that require user interaction.

This mechanism addresses the MCP protocol limitation where servers cannot detect "conversation end" events, using a time-based approach to determine when to retry.

## Glossary

- **Patchright_MCP_Server**: The MCP server that provides anti-detection browser automation capabilities
- **Login_Timeout**: A situation where a browser operation requires user login/verification but the user doesn't complete it within the configured timeout period
- **Cooldown_Period**: A 5-minute period after a login timeout during which the server will not attempt new operations
- **Cooldown_State**: The server state indicating it is in a cooldown period and should not attempt operations requiring user interaction
- **BrowserResult**: A dataclass containing the result of a browser operation including success status, content, and error information

## Requirements

### Requirement 1: Login Timeout Detection

**User Story:** As a system operator, I want the server to detect when a login/verification timeout occurs, so that it can respond appropriately to user absence.

#### Acceptance Criteria

1. WHEN a browser operation fails with a timeout error, THE Patchright_MCP_Server SHALL check if the error indicates a login/verification timeout
2. WHEN the error message contains login-related keywords (timeout, 验证超时, 登录超时, captcha, 验证码), THE Patchright_MCP_Server SHALL classify it as a Login_Timeout
3. WHEN a Login_Timeout is detected, THE Patchright_MCP_Server SHALL record the current timestamp as the cooldown start time

### Requirement 2: Cooldown State Management

**User Story:** As a system operator, I want the server to manage a cooldown state after login timeout, so that it doesn't repeatedly disturb an absent user.

#### Acceptance Criteria

1. THE Patchright_MCP_Server SHALL maintain a module-level variable to track the login timeout timestamp
2. THE Patchright_MCP_Server SHALL use a configurable cooldown duration (default: 300 seconds / 5 minutes)
3. WHEN a tool is called and a cooldown timestamp exists, THE Patchright_MCP_Server SHALL calculate the elapsed time since the timeout
4. IF the elapsed time is less than the Cooldown_Period, THEN THE Patchright_MCP_Server SHALL return a cooldown message without attempting the operation
5. IF the elapsed time exceeds the Cooldown_Period, THEN THE Patchright_MCP_Server SHALL reset the cooldown state and proceed with the operation

### Requirement 3: Cooldown Message Response

**User Story:** As an AI assistant user, I want to receive a helpful message during cooldown, so that I understand why the tool is temporarily unavailable and what alternatives exist.

#### Acceptance Criteria

1. WHEN the server is in Cooldown_State, THE Patchright_MCP_Server SHALL return a message indicating the tool is temporarily unavailable
2. THE cooldown message SHALL include the remaining cooldown time in minutes and seconds
3. THE cooldown message SHALL explain that the previous operation required user verification but timed out
4. THE cooldown message SHALL suggest that the user may have been away and might be back now
5. THE cooldown message SHALL recommend alternative tools (such as fetch MCP) as fallback options

### Requirement 4: Cooldown Reset

**User Story:** As a system operator, I want the cooldown to automatically reset after the period expires, so that the tool becomes available again without manual intervention.

#### Acceptance Criteria

1. WHEN a tool is called after the Cooldown_Period has expired, THE Patchright_MCP_Server SHALL reset the cooldown timestamp to None
2. WHEN the cooldown is reset, THE Patchright_MCP_Server SHALL proceed with the requested operation normally
3. THE Patchright_MCP_Server SHALL NOT require any external trigger to reset the cooldown state

### Requirement 5: Multi-Tool Cooldown Application

**User Story:** As a system operator, I want the cooldown to apply to all browser tools, so that no tool attempts operations during user absence.

#### Acceptance Criteria

1. WHEN the server enters Cooldown_State, THE Patchright_MCP_Server SHALL apply the cooldown to all browser tools (patchright_fetch, patchright_screenshot, patchright_click, patchright_fill_form, patchright_execute_js)
2. THE Patchright_MCP_Server SHALL check the cooldown state at the beginning of every tool call
3. THE Patchright_MCP_Server SHALL use a single shared cooldown state across all tools

### Requirement 6: Initial Timeout Error Notification

**User Story:** As an AI assistant user, I want to be notified when a login timeout first occurs, so that I understand why the operation failed and what will happen next.

#### Acceptance Criteria

1. WHEN a Login_Timeout is first detected, THE Patchright_MCP_Server SHALL return a message explaining the timeout occurred
2. THE initial timeout message SHALL indicate that the tool will be paused for the Cooldown_Period
3. THE initial timeout message SHALL explain the MCP protocol limitation regarding conversation boundary detection
4. THE initial timeout message SHALL suggest using alternative tools or waiting for the cooldown to expire
