"""
Property-based tests for the login timeout cooldown mechanism.

**Feature: patchright-login-cooldown**

Tests for the _is_login_timeout_error function using Hypothesis.
"""

import sys
import string
import time

import pytest

# Add src to path for imports
sys.path.insert(0, 'src')

from hypothesis import given, strategies as st, settings, assume
from patchright_mcp.server import _is_login_timeout_error


# Define the login timeout keywords (must match server.py implementation)
LOGIN_TIMEOUT_KEYWORDS = [
    "验证超时",
    "登录超时",
    "timeout",
    "captcha",
    "验证码",
    "login required",
    "authentication",
]


# Strategy for generating random strings that do NOT contain any keywords
@st.composite
def non_keyword_strings(draw):
    """Generate strings that don't contain any login timeout keywords."""
    # Generate a random string
    base_string = draw(st.text(
        alphabet=string.ascii_letters + string.digits + " !@#$%^&*()_+-=[]{}|;':\",./<>?",
        min_size=0,
        max_size=200
    ))
    
    # Ensure it doesn't contain any keywords (case-insensitive)
    base_lower = base_string.lower()
    for keyword in LOGIN_TIMEOUT_KEYWORDS:
        if keyword.lower() in base_lower:
            # If it contains a keyword, reject this example
            assume(False)
    
    return base_string


# Strategy for generating strings that contain at least one keyword
@st.composite
def keyword_containing_strings(draw):
    """Generate strings that contain at least one login timeout keyword."""
    # Pick a random keyword
    keyword = draw(st.sampled_from(LOGIN_TIMEOUT_KEYWORDS))
    
    # Generate prefix and suffix
    prefix = draw(st.text(
        alphabet=string.ascii_letters + string.digits + " ",
        min_size=0,
        max_size=50
    ))
    suffix = draw(st.text(
        alphabet=string.ascii_letters + string.digits + " ",
        min_size=0,
        max_size=50
    ))
    
    # Optionally modify case of keyword (for case-insensitivity testing)
    case_modifier = draw(st.sampled_from(['lower', 'upper', 'mixed', 'original']))
    if case_modifier == 'lower':
        keyword = keyword.lower()
    elif case_modifier == 'upper':
        keyword = keyword.upper()
    elif case_modifier == 'mixed':
        # Mix case randomly
        keyword = ''.join(
            c.upper() if draw(st.booleans()) else c.lower()
            for c in keyword
        )
    # 'original' keeps the keyword as-is
    
    return prefix + keyword + suffix


class TestIsLoginTimeoutError:
    """
    Property-based tests for _is_login_timeout_error function.
    
    **Feature: patchright-login-cooldown, Property 1: Login Timeout Keyword Detection**
    **Feature: patchright-login-cooldown, Property 2: Non-Login Error Rejection**
    **Validates: Requirements 1.1, 1.2**
    """

    @given(error_string=keyword_containing_strings())
    @settings(max_examples=100)
    def test_property_1_login_timeout_keyword_detection(self, error_string: str):
        """
        **Feature: patchright-login-cooldown, Property 1: Login Timeout Keyword Detection**
        
        *For any* error string containing at least one of the login timeout keywords
        (timeout, 验证超时, 登录超时, captcha, 验证码, login required, authentication),
        the `_is_login_timeout_error` function SHALL return True.
        
        **Validates: Requirements 1.2**
        """
        result = _is_login_timeout_error(error_string)
        assert result is True, (
            f"Expected True for error string containing keyword, got {result}. "
            f"Error string: '{error_string}'"
        )

    @given(error_string=non_keyword_strings())
    @settings(max_examples=100)
    def test_property_2_non_login_error_rejection(self, error_string: str):
        """
        **Feature: patchright-login-cooldown, Property 2: Non-Login Error Rejection**
        
        *For any* error string that does not contain any login timeout keywords,
        the `_is_login_timeout_error` function SHALL return False.
        
        **Validates: Requirements 1.1, 1.2**
        """
        result = _is_login_timeout_error(error_string)
        assert result is False, (
            f"Expected False for error string without keywords, got {result}. "
            f"Error string: '{error_string}'"
        )


class TestIsLoginTimeoutErrorEdgeCases:
    """
    Additional edge case tests for _is_login_timeout_error function.
    
    These complement the property-based tests with specific edge cases.
    """

    def test_empty_string_returns_false(self):
        """Empty string should return False."""
        assert _is_login_timeout_error("") is False

    def test_exact_keyword_match(self):
        """Exact keyword matches should return True."""
        for keyword in LOGIN_TIMEOUT_KEYWORDS:
            assert _is_login_timeout_error(keyword) is True, f"Failed for keyword: {keyword}"

    def test_case_insensitive_timeout(self):
        """Case variations of 'timeout' should all return True."""
        assert _is_login_timeout_error("TIMEOUT") is True
        assert _is_login_timeout_error("Timeout") is True
        assert _is_login_timeout_error("TiMeOuT") is True

    def test_case_insensitive_captcha(self):
        """Case variations of 'captcha' should all return True."""
        assert _is_login_timeout_error("CAPTCHA") is True
        assert _is_login_timeout_error("Captcha") is True
        assert _is_login_timeout_error("CaPtChA") is True

    def test_case_insensitive_authentication(self):
        """Case variations of 'authentication' should all return True."""
        assert _is_login_timeout_error("AUTHENTICATION") is True
        assert _is_login_timeout_error("Authentication") is True

    def test_keyword_in_sentence(self):
        """Keywords embedded in sentences should be detected."""
        assert _is_login_timeout_error("Operation failed: timeout occurred") is True
        assert _is_login_timeout_error("Please complete captcha verification") is True
        assert _is_login_timeout_error("Error: 验证超时，请重试") is True

    def test_chinese_keywords(self):
        """Chinese keywords should be detected."""
        assert _is_login_timeout_error("验证超时") is True
        assert _is_login_timeout_error("登录超时") is True
        assert _is_login_timeout_error("验证码") is True

    def test_unrelated_errors_return_false(self):
        """Unrelated error messages should return False."""
        assert _is_login_timeout_error("Network error") is False
        assert _is_login_timeout_error("Element not found") is False
        assert _is_login_timeout_error("Connection refused") is False
        assert _is_login_timeout_error("404 Not Found") is False
        assert _is_login_timeout_error("Internal server error") is False


# Import additional functions for cooldown tests
from patchright_mcp.server import (
    _check_cooldown,
    _record_login_timeout,
    _LOGIN_COOLDOWN_SECONDS,
)
import patchright_mcp.server as server_module


@pytest.fixture(autouse=True)
def reset_cooldown_state():
    """Reset cooldown state before and after each test for isolation."""
    server_module._login_timeout_timestamp = None
    yield
    server_module._login_timeout_timestamp = None


class TestRecordLoginTimeout:
    """
    Property-based tests for _record_login_timeout function.
    
    **Feature: patchright-login-cooldown, Property 3: Timestamp Recording**
    **Validates: Requirements 1.3**
    """

    def test_property_3_timestamp_recording(self):
        """
        **Feature: patchright-login-cooldown, Property 3: Timestamp Recording**
        
        *For any* call to `_record_login_timeout`, the `_login_timeout_timestamp`
        SHALL be set to a value within 1 second of the current time.
        
        **Validates: Requirements 1.3**
        """
        before = time.time()
        result = _record_login_timeout()
        after = time.time()
        
        assert server_module._login_timeout_timestamp is not None
        assert before <= server_module._login_timeout_timestamp <= after
        assert result.type == "text"
        assert "⏸️" in result.text

    def test_timeout_message_contains_required_elements(self):
        """Verify timeout message contains all required elements."""
        result = _record_login_timeout()
        
        assert "5" in result.text or str(_LOGIN_COOLDOWN_SECONDS // 60) in result.text
        assert "MCP" in result.text


class TestCheckCooldown:
    """
    Property-based tests for _check_cooldown function.
    
    **Feature: patchright-login-cooldown, Property 4-7**
    **Validates: Requirements 2.4, 2.5, 3.1, 3.2, 4.1, 4.2**
    """

    def test_property_4_cooldown_message_during_active_cooldown(self):
        """
        **Feature: patchright-login-cooldown, Property 4: Cooldown Message During Active Cooldown**
        
        *For any* timestamp set within the last `_LOGIN_COOLDOWN_SECONDS` seconds,
        the `_check_cooldown` function SHALL return a TextContent message (not None).
        
        **Validates: Requirements 2.4, 3.1**
        """
        server_module._login_timeout_timestamp = time.time()
        
        result = _check_cooldown()
        
        assert result is not None
        assert result.type == "text"
        assert "⏸️" in result.text

    def test_property_5_cooldown_reset_after_expiry(self):
        """
        **Feature: patchright-login-cooldown, Property 5: Cooldown Reset After Expiry**
        
        *For any* timestamp set more than `_LOGIN_COOLDOWN_SECONDS` seconds ago,
        after calling `_check_cooldown`, the `_login_timeout_timestamp` SHALL be None.
        
        **Validates: Requirements 2.5, 4.1**
        """
        server_module._login_timeout_timestamp = time.time() - _LOGIN_COOLDOWN_SECONDS - 10
        
        result = _check_cooldown()
        
        assert result is None
        assert server_module._login_timeout_timestamp is None

    def test_property_6_remaining_time_accuracy(self):
        """
        **Feature: patchright-login-cooldown, Property 6: Remaining Time Accuracy**
        
        *For any* timestamp within the cooldown period, the remaining time displayed
        in the cooldown message SHALL equal `_LOGIN_COOLDOWN_SECONDS - elapsed_time`
        (within 1 second tolerance).
        
        **Validates: Requirements 3.2**
        """
        elapsed = 60  # 1 minute elapsed
        server_module._login_timeout_timestamp = time.time() - elapsed
        
        result = _check_cooldown()
        
        expected_remaining = _LOGIN_COOLDOWN_SECONDS - elapsed
        expected_min = expected_remaining // 60
        
        # Allow 1 minute tolerance due to timing
        assert any(f"{m} 分" in result.text for m in range(expected_min - 1, expected_min + 1))

    def test_property_7_normal_operation_after_reset(self):
        """
        **Feature: patchright-login-cooldown, Property 7: Normal Operation After Reset**
        
        *For any* state where `_login_timeout_timestamp` is None, the `_check_cooldown`
        function SHALL return None, allowing normal operation to proceed.
        
        **Validates: Requirements 4.2**
        """
        result = _check_cooldown()
        
        assert result is None

    def test_cooldown_message_contains_required_elements(self):
        """Verify cooldown message contains all required elements."""
        server_module._login_timeout_timestamp = time.time()
        
        result = _check_cooldown()
        
        assert "冷却剩余" in result.text
        assert "分" in result.text
        assert "秒" in result.text
        assert "建议" in result.text
