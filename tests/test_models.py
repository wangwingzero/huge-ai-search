"""
数据模型测试

Feature: google-ai-search-mcp, Property 5: SearchResult 默认初始化
验证: 需求 5.3
"""

import pytest
from hypothesis import given, settings, strategies as st

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import SearchSource, SearchResult


class TestSearchSource:
    """SearchSource 数据模型测试"""
    
    def test_search_source_fields(self):
        """测试 SearchSource 字段完整性"""
        source = SearchSource(title="Test Title", url="https://example.com", snippet="Test snippet")
        assert source.title == "Test Title"
        assert source.url == "https://example.com"
        assert source.snippet == "Test snippet"
    
    def test_search_source_default_snippet(self):
        """测试 SearchSource snippet 默认值"""
        source = SearchSource(title="Test", url="https://example.com")
        assert source.snippet == ""


class TestSearchResult:
    """SearchResult 数据模型测试"""
    
    def test_search_result_fields(self):
        """测试 SearchResult 字段完整性"""
        result = SearchResult(
            success=True,
            query="test query",
            ai_answer="AI answer",
            sources=[SearchSource(title="T", url="https://example.com")],
            error=""
        )
        assert result.success is True
        assert result.query == "test query"
        assert result.ai_answer == "AI answer"
        assert len(result.sources) == 1
        assert result.error == ""
    
    def test_search_result_default_sources(self):
        """测试 SearchResult sources 默认为空列表"""
        result = SearchResult(success=True, query="test")
        assert result.sources == []
        assert isinstance(result.sources, list)
    
    def test_search_result_default_ai_answer(self):
        """测试 SearchResult ai_answer 默认值"""
        result = SearchResult(success=False, query="test")
        assert result.ai_answer == ""
    
    def test_search_result_default_error(self):
        """测试 SearchResult error 默认值"""
        result = SearchResult(success=True, query="test")
        assert result.error == ""


# Feature: google-ai-search-mcp, Property 5: SearchResult 默认初始化
class TestSearchResultProperty:
    """SearchResult 属性测试 - Property 5"""
    
    @given(
        success=st.booleans(),
        query=st.text(min_size=0, max_size=100),
        ai_answer=st.text(min_size=0, max_size=500),
        error=st.text(min_size=0, max_size=200)
    )
    def test_sources_always_list(self, success, query, ai_answer, error):
        """
        Property 5: SearchResult 默认初始化
        对于任意不提供 sources 参数的 SearchResult 初始化，
        sources 字段应为空列表而非 None。
        **验证: 需求 5.3**
        """
        result = SearchResult(
            success=success,
            query=query,
            ai_answer=ai_answer,
            error=error
        )
        assert result.sources is not None
        assert isinstance(result.sources, list)
    
    @given(success=st.booleans(), query=st.text(min_size=1))
    def test_minimal_init_sources_is_list(self, success, query):
        """最小初始化时 sources 应为列表"""
        result = SearchResult(success=success, query=query)
        assert isinstance(result.sources, list)
        assert result.sources == []


# **Feature: nodriver-migration, Property 9: Error Result Format**
# **Validates: Requirements 12.2**
class TestErrorResultFormat:
    """
    Property 9: Error Result Format
    
    For any failed search operation, the returned SearchResult SHALL have 
    success=False and a non-empty error message describing the failure.
    
    **Feature: nodriver-migration, Property 9: Error Result Format**
    **Validates: Requirements 12.2**
    """
    
    # Common error scenarios that can occur during search operations
    ERROR_SCENARIOS = [
        # Browser errors
        "未找到可用的浏览器（Chrome 或 Edge）",
        "Browser not found",
        "浏览器启动失败",
        "Browser startup failed",
        "user_data_dir locked",
        
        # Navigation errors
        "页面加载超时",
        "Page load timeout",
        "Network error",
        "网络错误",
        "Navigation timeout",
        
        # CAPTCHA errors
        "检测到验证码，请手动验证",
        "CAPTCHA detected",
        "用户验证超时",
        "User verification timeout",
        
        # Extraction errors
        "JavaScript evaluation error",
        "JavaScript 评估返回 None",
        "内容提取失败",
        "Content extraction failed",
        "浏览器标签页不可用",
        
        # Session errors
        "会话已超时",
        "Session timeout",
        "Browser crash",
        "浏览器崩溃",
        "启动浏览器会话失败",
        
        # General errors
        "搜索超时",
        "Search timeout",
        "Unknown error",
        "未知错误",
    ]
    
    @given(
        query=st.text(min_size=1, max_size=200),
        error_message=st.sampled_from(ERROR_SCENARIOS)
    )
    @settings(max_examples=100)
    def test_error_result_has_success_false(self, query, error_message):
        """
        Property 9.1: Error results must have success=False
        
        For any failed search operation, the SearchResult SHALL have success=False.
        
        **Feature: nodriver-migration, Property 9: Error Result Format**
        **Validates: Requirements 12.2**
        """
        result = SearchResult(
            success=False,
            query=query,
            error=error_message
        )
        assert result.success is False, "Error result must have success=False"
    
    @given(
        query=st.text(min_size=1, max_size=200),
        error_message=st.sampled_from(ERROR_SCENARIOS)
    )
    def test_error_result_has_non_empty_error_message(self, query, error_message):
        """
        Property 9.2: Error results must have non-empty error message
        
        For any failed search operation, the SearchResult SHALL have a non-empty 
        error message describing the failure.
        
        **Feature: nodriver-migration, Property 9: Error Result Format**
        **Validates: Requirements 12.2**
        """
        result = SearchResult(
            success=False,
            query=query,
            error=error_message
        )
        assert result.error, "Error result must have non-empty error message"
        assert len(result.error) > 0, "Error message must not be empty"
        assert isinstance(result.error, str), "Error message must be a string"
    
    @given(
        query=st.text(min_size=1, max_size=200),
        error_message=st.text(min_size=1, max_size=500).filter(lambda x: x.strip())
    )
    @settings(max_examples=100)
    def test_error_result_format_with_arbitrary_errors(self, query, error_message):
        """
        Property 9.3: Error results with arbitrary error messages
        
        For any non-empty error message string, creating an error SearchResult
        SHALL preserve the error message and have success=False.
        
        **Feature: nodriver-migration, Property 9: Error Result Format**
        **Validates: Requirements 12.2**
        """
        result = SearchResult(
            success=False,
            query=query,
            error=error_message
        )
        assert result.success is False
        assert result.error == error_message
        assert result.query == query
    
    @given(
        query=st.text(min_size=1, max_size=200),
        error_message=st.sampled_from(ERROR_SCENARIOS),
        ai_answer=st.text(min_size=0, max_size=100)
    )
    def test_error_result_ai_answer_can_be_empty(self, query, error_message, ai_answer):
        """
        Property 9.4: Error results may have empty ai_answer
        
        For failed search operations, the ai_answer field is typically empty
        but the error message must still be present.
        
        **Feature: nodriver-migration, Property 9: Error Result Format**
        **Validates: Requirements 12.2**
        """
        result = SearchResult(
            success=False,
            query=query,
            ai_answer=ai_answer,
            error=error_message
        )
        assert result.success is False
        assert result.error == error_message
        # ai_answer can be empty or have content, but error must be present
        assert len(result.error) > 0
    
    @given(
        query=st.text(min_size=1, max_size=200),
        error_message=st.sampled_from(ERROR_SCENARIOS)
    )
    def test_error_result_sources_empty(self, query, error_message):
        """
        Property 9.5: Error results typically have empty sources
        
        For failed search operations, the sources list is typically empty
        since no content was successfully extracted.
        
        **Feature: nodriver-migration, Property 9: Error Result Format**
        **Validates: Requirements 12.2**
        """
        result = SearchResult(
            success=False,
            query=query,
            error=error_message
        )
        assert result.success is False
        assert result.error == error_message
        assert result.sources == []  # Default empty list for error results


class TestErrorResultFormatEdgeCases:
    """
    Edge case tests for Property 9: Error Result Format
    
    **Feature: nodriver-migration, Property 9: Error Result Format**
    **Validates: Requirements 12.2**
    """
    
    def test_browser_not_found_error(self):
        """Test browser not found error scenario"""
        result = SearchResult(
            success=False,
            query="test query",
            error="未找到可用的浏览器（Chrome 或 Edge）"
        )
        assert result.success is False
        assert "浏览器" in result.error or "browser" in result.error.lower()
    
    def test_timeout_error(self):
        """Test timeout error scenario"""
        result = SearchResult(
            success=False,
            query="test query",
            error="页面加载超时"
        )
        assert result.success is False
        assert "超时" in result.error or "timeout" in result.error.lower()
    
    def test_captcha_error(self):
        """Test CAPTCHA detection error scenario"""
        result = SearchResult(
            success=False,
            query="test query",
            error="检测到验证码，请手动验证"
        )
        assert result.success is False
        assert "验证码" in result.error or "captcha" in result.error.lower()
    
    def test_extraction_failure_error(self):
        """Test content extraction failure error scenario"""
        result = SearchResult(
            success=False,
            query="test query",
            error="JavaScript 评估返回 None"
        )
        assert result.success is False
        assert len(result.error) > 0
    
    def test_session_startup_failure_error(self):
        """Test session startup failure error scenario"""
        result = SearchResult(
            success=False,
            query="test query",
            error="启动浏览器会话失败"
        )
        assert result.success is False
        assert "会话" in result.error or "session" in result.error.lower()
    
    @given(
        error_type=st.sampled_from([
            "browser_not_found",
            "timeout",
            "captcha",
            "extraction_failure",
            "session_error"
        ])
    )
    def test_all_error_types_have_valid_format(self, error_type):
        """
        Test that all error types produce valid error results
        
        **Feature: nodriver-migration, Property 9: Error Result Format**
        **Validates: Requirements 12.2**
        """
        error_messages = {
            "browser_not_found": "未找到可用的浏览器（Chrome 或 Edge）",
            "timeout": "页面加载超时",
            "captcha": "检测到验证码，请手动验证",
            "extraction_failure": "内容提取失败",
            "session_error": "启动浏览器会话失败"
        }
        
        result = SearchResult(
            success=False,
            query="test query",
            error=error_messages[error_type]
        )
        
        # All error results must satisfy Property 9
        assert result.success is False, f"Error type {error_type} must have success=False"
        assert result.error, f"Error type {error_type} must have non-empty error"
        assert len(result.error) > 0, f"Error type {error_type} error message must not be empty"


# **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
# **Validates: Requirements 5.5**
class TestSearchResultRoundTrip:
    """
    Property 2: SearchResult Serialization Round-Trip
    
    For any valid SearchResult object, serializing to JSON then deserializing 
    SHALL produce an equivalent object with identical success, query, ai_answer, 
    sources, and error fields.
    
    **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
    **Validates: Requirements 5.5**
    """
    
    # Strategy for generating valid SearchSource objects
    @st.composite
    def search_source_strategy(draw):
        """Generate valid SearchSource objects"""
        title = draw(st.text(min_size=0, max_size=200))
        url = draw(st.text(min_size=0, max_size=500))
        snippet = draw(st.text(min_size=0, max_size=500))
        return SearchSource(title=title, url=url, snippet=snippet)
    
    # Strategy for generating valid SearchResult objects
    @st.composite
    def search_result_strategy(draw):
        """Generate valid SearchResult objects with various configurations"""
        success = draw(st.booleans())
        query = draw(st.text(min_size=0, max_size=500))
        ai_answer = draw(st.text(min_size=0, max_size=2000))
        # Generate 0-10 sources
        sources = draw(st.lists(
            TestSearchResultRoundTrip.search_source_strategy(),
            min_size=0,
            max_size=10
        ))
        error = draw(st.text(min_size=0, max_size=500))
        return SearchResult(
            success=success,
            query=query,
            ai_answer=ai_answer,
            sources=sources,
            error=error
        )
    
    @given(result=search_result_strategy())
    @settings(max_examples=100)
    def test_search_result_round_trip(self, result: SearchResult):
        """
        Property 2: SearchResult Serialization Round-Trip
        
        For any valid SearchResult object, serializing to dict using to_dict() 
        then deserializing using from_dict() SHALL produce an equivalent object 
        with identical success, query, ai_answer, sources, and error fields.
        
        **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
        **Validates: Requirements 5.5**
        """
        # Serialize to dict
        serialized = result.to_dict()
        
        # Deserialize back
        deserialized = SearchResult.from_dict(serialized)
        
        # Verify all fields are identical
        assert deserialized.success == result.success, \
            f"success mismatch: {deserialized.success} != {result.success}"
        assert deserialized.query == result.query, \
            f"query mismatch: {deserialized.query} != {result.query}"
        assert deserialized.ai_answer == result.ai_answer, \
            f"ai_answer mismatch: {deserialized.ai_answer} != {result.ai_answer}"
        assert deserialized.error == result.error, \
            f"error mismatch: {deserialized.error} != {result.error}"
        
        # Verify sources list length
        assert len(deserialized.sources) == len(result.sources), \
            f"sources length mismatch: {len(deserialized.sources)} != {len(result.sources)}"
        
        # Verify each source
        for i, (orig_source, deser_source) in enumerate(zip(result.sources, deserialized.sources)):
            assert deser_source.title == orig_source.title, \
                f"source[{i}].title mismatch: {deser_source.title} != {orig_source.title}"
            assert deser_source.url == orig_source.url, \
                f"source[{i}].url mismatch: {deser_source.url} != {orig_source.url}"
            assert deser_source.snippet == orig_source.snippet, \
                f"source[{i}].snippet mismatch: {deser_source.snippet} != {orig_source.snippet}"
    
    @given(
        success=st.booleans(),
        query=st.text(min_size=1, max_size=200),
        ai_answer=st.text(min_size=0, max_size=1000),
        error=st.text(min_size=0, max_size=200)
    )
    @settings(max_examples=100)
    def test_search_result_round_trip_no_sources(self, success, query, ai_answer, error):
        """
        Property 2.1: SearchResult round-trip with no sources
        
        For SearchResult objects with empty sources list, round-trip 
        serialization SHALL preserve all fields.
        
        **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
        **Validates: Requirements 5.5**
        """
        original = SearchResult(
            success=success,
            query=query,
            ai_answer=ai_answer,
            sources=[],
            error=error
        )
        
        # Round-trip
        serialized = original.to_dict()
        deserialized = SearchResult.from_dict(serialized)
        
        # Verify all fields
        assert deserialized.success == original.success
        assert deserialized.query == original.query
        assert deserialized.ai_answer == original.ai_answer
        assert deserialized.sources == []
        assert deserialized.error == original.error
    
    @given(
        num_sources=st.integers(min_value=1, max_value=10),
        success=st.booleans(),
        query=st.text(min_size=1, max_size=100)
    )
    @settings(max_examples=100)
    def test_search_result_round_trip_with_sources(self, num_sources, success, query):
        """
        Property 2.2: SearchResult round-trip with multiple sources
        
        For SearchResult objects with multiple sources, round-trip 
        serialization SHALL preserve all sources with their fields.
        
        **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
        **Validates: Requirements 5.5**
        """
        # Create sources
        sources = [
            SearchSource(
                title=f"Title {i}",
                url=f"https://example{i}.com",
                snippet=f"Snippet {i}"
            )
            for i in range(num_sources)
        ]
        
        original = SearchResult(
            success=success,
            query=query,
            ai_answer="Test AI answer",
            sources=sources,
            error=""
        )
        
        # Round-trip
        serialized = original.to_dict()
        deserialized = SearchResult.from_dict(serialized)
        
        # Verify sources count
        assert len(deserialized.sources) == num_sources
        
        # Verify each source
        for i in range(num_sources):
            assert deserialized.sources[i].title == f"Title {i}"
            assert deserialized.sources[i].url == f"https://example{i}.com"
            assert deserialized.sources[i].snippet == f"Snippet {i}"


class TestSearchSourceRoundTrip:
    """
    SearchSource Serialization Round-Trip Tests
    
    Supporting tests for Property 2 - verifying SearchSource round-trip works correctly.
    
    **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
    **Validates: Requirements 5.5**
    """
    
    @given(
        title=st.text(min_size=0, max_size=200),
        url=st.text(min_size=0, max_size=500),
        snippet=st.text(min_size=0, max_size=500)
    )
    @settings(max_examples=100)
    def test_search_source_round_trip(self, title, url, snippet):
        """
        SearchSource round-trip serialization
        
        For any valid SearchSource object, serializing to dict then deserializing
        SHALL produce an equivalent object with identical title, url, and snippet.
        
        **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
        **Validates: Requirements 5.5**
        """
        original = SearchSource(title=title, url=url, snippet=snippet)
        
        # Round-trip
        serialized = original.to_dict()
        deserialized = SearchSource.from_dict(serialized)
        
        # Verify all fields
        assert deserialized.title == original.title
        assert deserialized.url == original.url
        assert deserialized.snippet == original.snippet
    
    @given(
        title=st.text(min_size=1, max_size=100),
        url=st.text(min_size=1, max_size=200)
    )
    def test_search_source_round_trip_default_snippet(self, title, url):
        """
        SearchSource round-trip with default snippet
        
        For SearchSource objects with default empty snippet, round-trip
        serialization SHALL preserve the empty snippet.
        
        **Feature: nodriver-migration, Property 2: SearchResult Serialization Round-Trip**
        **Validates: Requirements 5.5**
        """
        original = SearchSource(title=title, url=url)  # snippet defaults to ""
        
        # Round-trip
        serialized = original.to_dict()
        deserialized = SearchSource.from_dict(serialized)
        
        # Verify all fields including default snippet
        assert deserialized.title == original.title
        assert deserialized.url == original.url
        assert deserialized.snippet == ""
