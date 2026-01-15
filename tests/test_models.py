"""
数据模型测试

Feature: google-ai-search-mcp, Property 5: SearchResult 默认初始化
验证: 需求 5.3
"""

import pytest
from hypothesis import given, strategies as st

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
