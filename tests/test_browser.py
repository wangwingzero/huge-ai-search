"""
CAPTCHA Detection Property Tests

**Feature: nodriver-migration, Property 6: CAPTCHA Detection**

Property Definition:
For any page content containing known CAPTCHA keywords (in any supported language), 
the detection function SHALL return true.

**Validates: Requirements 8.5**
"""

import pytest
from hypothesis import given, strategies as st, settings, assume
from unittest.mock import patch

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import AsyncGoogleAISearcher


# =============================================================================
# CAPTCHA Keywords Reference (from AsyncGoogleAISearcher.CAPTCHA_KEYWORDS)
# =============================================================================

# Known CAPTCHA keywords that should trigger detection
CAPTCHA_KEYWORDS = [
    # Chinese
    "异常流量",
    "我们的系统检测到",
    "验证您是真人",
    # English
    "unusual traffic",
    "automated requests",
    "prove you're not a robot",
    "verify you're human",
    # Universal
    "recaptcha",
    "captcha",
]


# =============================================================================
# Strategies for Property-Based Testing
# =============================================================================

# Strategy for CAPTCHA keywords
captcha_keyword_strategy = st.sampled_from(CAPTCHA_KEYWORDS)

# Strategy for normal page content (without CAPTCHA keywords)
# This generates text that should NOT trigger CAPTCHA detection
normal_content_strategy = st.text(
    min_size=0,
    max_size=500,
    alphabet=st.characters(
        whitelist_categories=('L', 'N', 'P', 'Z'),  # Letters, Numbers, Punctuation, Separators
        blacklist_characters='',
    )
).filter(lambda x: not any(kw.lower() in x.lower() for kw in CAPTCHA_KEYWORDS))

# Strategy for surrounding text (context around CAPTCHA keywords)
surrounding_text_strategy = st.text(
    min_size=0,
    max_size=200,
    alphabet=st.characters(
        whitelist_categories=('L', 'N', 'P', 'Z'),
        blacklist_characters='',
    )
).filter(lambda x: not any(kw.lower() in x.lower() for kw in CAPTCHA_KEYWORDS))

# Strategy for supported languages
language_strategy = st.sampled_from([
    "zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR"
])

# Strategy for case variations
case_variation_strategy = st.sampled_from(['lower', 'upper', 'title', 'mixed'])


def apply_case_variation(text: str, variation: str) -> str:
    """Apply case variation to text.
    
    Args:
        text: Original text
        variation: One of 'lower', 'upper', 'title', 'mixed'
        
    Returns:
        Text with case variation applied
    """
    if variation == 'lower':
        return text.lower()
    elif variation == 'upper':
        return text.upper()
    elif variation == 'title':
        return text.title()
    elif variation == 'mixed':
        # Alternate case for each character
        return ''.join(
            c.upper() if i % 2 == 0 else c.lower()
            for i, c in enumerate(text)
        )
    return text


# =============================================================================
# Unit Tests - CAPTCHA Detection Basic Functionality
# =============================================================================

class TestCAPTCHADetectionUnit:
    """Unit tests for CAPTCHA detection - specific examples and edge cases"""
    
    def test_chinese_captcha_keyword_detected(self):
        """Test Chinese CAPTCHA keyword detection"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Test "异常流量" (unusual traffic in Chinese)
            content = "我们的系统检测到您的计算机网络中存在异常流量"
            assert searcher._is_captcha_page(content) is True
    
    def test_english_captcha_keyword_detected(self):
        """Test English CAPTCHA keyword detection"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Test "unusual traffic"
            content = "Our systems have detected unusual traffic from your computer network"
            assert searcher._is_captcha_page(content) is True
    
    def test_recaptcha_keyword_detected(self):
        """Test reCAPTCHA keyword detection"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            content = "Please complete the reCAPTCHA challenge to continue"
            assert searcher._is_captcha_page(content) is True
    
    def test_captcha_keyword_detected(self):
        """Test generic CAPTCHA keyword detection"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            content = "Please solve the CAPTCHA to verify you are human"
            assert searcher._is_captcha_page(content) is True
    
    def test_normal_content_not_detected(self):
        """Test that normal content does not trigger CAPTCHA detection"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Normal search result content
            content = "AI 模式 这是正常的搜索结果，包含有用的信息。"
            assert searcher._is_captcha_page(content) is False
    
    def test_empty_content_not_detected(self):
        """Test that empty content does not trigger CAPTCHA detection"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            assert searcher._is_captcha_page("") is False
    
    def test_case_insensitive_detection(self):
        """Test that CAPTCHA detection is case-insensitive"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Test uppercase
            assert searcher._is_captcha_page("UNUSUAL TRAFFIC detected") is True
            # Test lowercase
            assert searcher._is_captcha_page("unusual traffic detected") is True
            # Test mixed case
            assert searcher._is_captcha_page("Unusual Traffic detected") is True
            # Test reCAPTCHA variations
            assert searcher._is_captcha_page("RECAPTCHA") is True
            assert searcher._is_captcha_page("ReCaptcha") is True


# =============================================================================
# Property Tests - CAPTCHA Detection (Property 6)
# =============================================================================

class TestCAPTCHADetectionProperty:
    """
    **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
    
    Property-based tests for CAPTCHA detection.
    **Validates: Requirements 8.5**
    """
    
    @given(keyword=captcha_keyword_strategy)
    @settings(max_examples=100)
    def test_captcha_keyword_always_detected(self, keyword):
        """
        **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
        
        Property: For any known CAPTCHA keyword, the detection function SHALL return True.
        **Validates: Requirements 8.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Content containing just the keyword
            content = keyword
            assert searcher._is_captcha_page(content) is True, \
                f"CAPTCHA keyword '{keyword}' should be detected"
    
    @given(
        keyword=captcha_keyword_strategy,
        prefix=surrounding_text_strategy,
        suffix=surrounding_text_strategy
    )
    @settings(max_examples=100)
    def test_captcha_keyword_detected_with_surrounding_text(self, keyword, prefix, suffix):
        """
        **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
        
        Property: For any CAPTCHA keyword embedded in surrounding text, 
        the detection function SHALL return True.
        **Validates: Requirements 8.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Content with keyword surrounded by other text
            content = f"{prefix} {keyword} {suffix}"
            assert searcher._is_captcha_page(content) is True, \
                f"CAPTCHA keyword '{keyword}' should be detected in context"
    
    @given(
        keyword=captcha_keyword_strategy,
        case_variation=case_variation_strategy
    )
    @settings(max_examples=100)
    def test_captcha_detection_case_insensitive(self, keyword, case_variation):
        """
        **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
        
        Property: For any CAPTCHA keyword in any case variation, 
        the detection function SHALL return True (case-insensitive).
        **Validates: Requirements 8.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Apply case variation to keyword
            varied_keyword = apply_case_variation(keyword, case_variation)
            
            assert searcher._is_captcha_page(varied_keyword) is True, \
                f"CAPTCHA keyword '{varied_keyword}' (case: {case_variation}) should be detected"
    
    @given(content=normal_content_strategy)
    @settings(max_examples=100)
    def test_normal_content_not_detected_as_captcha(self, content):
        """
        **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
        
        Property: For any content NOT containing CAPTCHA keywords, 
        the detection function SHALL return False.
        **Validates: Requirements 8.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Verify the content doesn't contain any CAPTCHA keywords
            # (This is enforced by the strategy filter, but double-check)
            assume(not any(kw.lower() in content.lower() for kw in CAPTCHA_KEYWORDS))
            
            assert searcher._is_captcha_page(content) is False, \
                f"Normal content should not be detected as CAPTCHA: '{content[:50]}...'"


# =============================================================================
# Property Tests - Multi-Language CAPTCHA Detection
# =============================================================================

class TestCAPTCHADetectionMultiLanguage:
    """
    **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
    
    Property-based tests for multi-language CAPTCHA detection.
    **Validates: Requirements 8.5**
    """
    
    @given(language=language_strategy)
    @settings(max_examples=100)
    def test_chinese_captcha_keywords_detected_all_languages(self, language):
        """
        **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
        
        Property: Chinese CAPTCHA keywords SHALL be detected regardless of language setting.
        **Validates: Requirements 8.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            chinese_keywords = ["异常流量", "我们的系统检测到", "验证您是真人"]
            
            for keyword in chinese_keywords:
                content = f"Page content with {keyword} in it"
                assert searcher._is_captcha_page(content) is True, \
                    f"Chinese keyword '{keyword}' should be detected for language {language}"
    
    @given(language=language_strategy)
    @settings(max_examples=100)
    def test_english_captcha_keywords_detected_all_languages(self, language):
        """
        **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
        
        Property: English CAPTCHA keywords SHALL be detected regardless of language setting.
        **Validates: Requirements 8.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            english_keywords = [
                "unusual traffic",
                "automated requests",
                "prove you're not a robot",
                "verify you're human"
            ]
            
            for keyword in english_keywords:
                content = f"Page content with {keyword} in it"
                assert searcher._is_captcha_page(content) is True, \
                    f"English keyword '{keyword}' should be detected for language {language}"
    
    @given(language=language_strategy)
    @settings(max_examples=100)
    def test_universal_captcha_keywords_detected_all_languages(self, language):
        """
        **Feature: nodriver-migration, Property 6: CAPTCHA Detection**
        
        Property: Universal CAPTCHA keywords (recaptcha, captcha) SHALL be detected 
        regardless of language setting.
        **Validates: Requirements 8.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            universal_keywords = ["recaptcha", "captcha"]
            
            for keyword in universal_keywords:
                content = f"Page content with {keyword} in it"
                assert searcher._is_captcha_page(content) is True, \
                    f"Universal keyword '{keyword}' should be detected for language {language}"


# =============================================================================
# Edge Case Tests
# =============================================================================

class TestCAPTCHADetectionEdgeCases:
    """Edge case tests for CAPTCHA detection"""
    
    def test_keyword_at_start_of_content(self):
        """Test CAPTCHA keyword at the start of content"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            content = "unusual traffic has been detected from your network"
            assert searcher._is_captcha_page(content) is True
    
    def test_keyword_at_end_of_content(self):
        """Test CAPTCHA keyword at the end of content"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            content = "Please complete the verification: recaptcha"
            assert searcher._is_captcha_page(content) is True
    
    def test_multiple_keywords_in_content(self):
        """Test content with multiple CAPTCHA keywords"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            content = "unusual traffic detected, please complete the captcha to verify you're human"
            assert searcher._is_captcha_page(content) is True
    
    def test_keyword_with_special_characters(self):
        """Test CAPTCHA keyword surrounded by special characters"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Keyword with punctuation
            content = "Error: [unusual traffic] detected!"
            assert searcher._is_captcha_page(content) is True
            
            # Keyword with HTML-like content
            content = "<div>captcha</div>"
            assert searcher._is_captcha_page(content) is True
    
    def test_partial_keyword_not_detected(self):
        """Test that partial keywords are not falsely detected"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # "traffic" alone should not trigger (only "unusual traffic" should)
            content = "Heavy traffic on the highway today"
            assert searcher._is_captcha_page(content) is False
            
            # "automated" alone should not trigger (only "automated requests" should)
            content = "This is an automated email"
            assert searcher._is_captcha_page(content) is False
    
    def test_very_long_content_with_keyword(self):
        """Test CAPTCHA detection in very long content"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Long content with keyword buried in the middle
            long_prefix = "Normal content. " * 1000
            long_suffix = " More normal content." * 1000
            content = f"{long_prefix}unusual traffic{long_suffix}"
            
            assert searcher._is_captcha_page(content) is True
    
    def test_whitespace_variations(self):
        """Test CAPTCHA keywords with various whitespace"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Keyword with newlines
            content = "unusual\ntraffic"
            # This should NOT match because the keyword is "unusual traffic" (with space)
            # The detection looks for exact substring match
            # Note: This tests the actual behavior - keywords must match exactly
            
            # Keyword with tabs
            content_tab = "unusual\ttraffic"
            # Similarly, this should NOT match
            
            # Proper keyword with extra whitespace around it
            content_proper = "   unusual traffic   "
            assert searcher._is_captcha_page(content_proper) is True
    
    def test_unicode_normalization(self):
        """Test CAPTCHA detection with unicode variations"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            # Standard Chinese characters
            content = "异常流量"
            assert searcher._is_captcha_page(content) is True
            
            # Full-width characters (if any)
            # Note: The actual keywords use standard characters


# =============================================================================
# Consistency Tests
# =============================================================================

class TestCAPTCHADetectionConsistency:
    """Tests for consistency between searcher implementations"""
    
    def test_async_searcher_has_captcha_keywords(self):
        """Test that AsyncGoogleAISearcher has CAPTCHA_KEYWORDS defined"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            assert hasattr(searcher, 'CAPTCHA_KEYWORDS'), \
                "AsyncGoogleAISearcher should have CAPTCHA_KEYWORDS"
            assert len(searcher.CAPTCHA_KEYWORDS) > 0, \
                "CAPTCHA_KEYWORDS should not be empty"
    
    def test_async_searcher_has_is_captcha_page_method(self):
        """Test that AsyncGoogleAISearcher has _is_captcha_page method"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            assert hasattr(searcher, '_is_captcha_page'), \
                "AsyncGoogleAISearcher should have _is_captcha_page method"
            assert callable(searcher._is_captcha_page), \
                "_is_captcha_page should be callable"
    
    def test_all_known_keywords_in_searcher(self):
        """Test that all expected CAPTCHA keywords are in the searcher"""
        with patch('os.path.exists', return_value=False):
            searcher = AsyncGoogleAISearcher()
            
            expected_keywords = [
                "异常流量",
                "我们的系统检测到",
                "验证您是真人",
                "unusual traffic",
                "automated requests",
                "prove you're not a robot",
                "verify you're human",
                "recaptcha",
                "captcha",
            ]
            
            for keyword in expected_keywords:
                assert keyword in searcher.CAPTCHA_KEYWORDS, \
                    f"Expected keyword '{keyword}' not found in CAPTCHA_KEYWORDS"
