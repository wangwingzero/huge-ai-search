"""
MCP Server 测试

Feature: google-ai-search-mcp, Property 4: 输出格式正确性
验证: 需求 4.4
"""

import pytest
from hypothesis import given, strategies as st

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import SearchResult, SearchSource
from google_ai_search.server import format_search_result


class TestFormatSearchResult:
    """输出格式单元测试"""
    
    def test_format_basic_result(self):
        """测试基本结果格式化"""
        result = SearchResult(
            success=True,
            query="test query",
            ai_answer="This is the AI answer.",
            sources=[
                SearchSource(title="Source 1", url="https://example1.com"),
                SearchSource(title="Source 2", url="https://example2.com"),
            ]
        )
        
        output = format_search_result(result)
        
        assert "## Google AI 搜索结果" in output
        assert "**查询**: test query" in output
        assert "### AI 回答" in output
        assert "This is the AI answer." in output
        assert "### 来源 (2 个)" in output
        assert "[Source 1](https://example1.com)" in output
        assert "[Source 2](https://example2.com)" in output
    
    def test_format_result_without_sources(self):
        """测试无来源的结果格式化"""
        result = SearchResult(
            success=True,
            query="test",
            ai_answer="Answer without sources."
        )
        
        output = format_search_result(result)
        
        assert "## Google AI 搜索结果" in output
        assert "Answer without sources." in output
        assert "### 来源" not in output
    
    def test_format_limits_sources_to_5(self):
        """测试来源限制为 5 个"""
        sources = [
            SearchSource(title=f"Source {i}", url=f"https://example{i}.com")
            for i in range(10)
        ]
        result = SearchResult(
            success=True,
            query="test",
            ai_answer="Answer",
            sources=sources
        )
        
        output = format_search_result(result)
        
        # 应该只显示前 5 个
        assert "[Source 0]" in output
        assert "[Source 4]" in output
        assert "[Source 5]" not in output


# Feature: google-ai-search-mcp, Property 4: 输出格式正确性
class TestOutputFormatProperty:
    """输出格式属性测试 - Property 4"""
    
    @given(
        query=st.text(min_size=1, max_size=100).filter(lambda x: x.strip()),
        ai_answer=st.text(min_size=1, max_size=500).filter(lambda x: x.strip()),
        num_sources=st.integers(min_value=0, max_value=10)
    )
    def test_output_contains_required_content(self, query, ai_answer, num_sources):
        """
        Property 4: 输出格式正确性
        对于任意成功的 SearchResult，MCP Server 返回的格式化文本应包含
        查询词、AI 回答内容，以及所有来源链接的标题和 URL。
        **验证: 需求 4.4**
        """
        sources = [
            SearchSource(
                title=f"Title_{i}",
                url=f"https://example{i}.com"
            )
            for i in range(num_sources)
        ]
        
        result = SearchResult(
            success=True,
            query=query,
            ai_answer=ai_answer,
            sources=sources
        )
        
        output = format_search_result(result)
        
        # 验证包含查询词
        assert query in output, "输出应包含查询词"
        
        # 验证包含 AI 回答
        assert ai_answer in output, "输出应包含 AI 回答"
        
        # 验证包含来源（最多 5 个）
        displayed_sources = min(num_sources, 5)
        for i in range(displayed_sources):
            assert f"Title_{i}" in output, f"输出应包含来源标题 Title_{i}"
            assert f"https://example{i}.com" in output, f"输出应包含来源 URL"
    
    @given(
        query=st.text(min_size=1, max_size=50).filter(lambda x: x.strip()),
        ai_answer=st.text(min_size=1, max_size=200).filter(lambda x: x.strip())
    )
    def test_output_is_valid_markdown(self, query, ai_answer):
        """输出应为有效的 Markdown 格式"""
        result = SearchResult(
            success=True,
            query=query,
            ai_answer=ai_answer,
            sources=[SearchSource(title="Test", url="https://test.com")]
        )
        
        output = format_search_result(result)
        
        # 验证 Markdown 标题格式
        assert output.startswith("## "), "输出应以 ## 开头"
        assert "### AI 回答" in output, "输出应包含 AI 回答标题"
