"""
MCP Server 测试

Feature: google-ai-search-mcp, Property 4: 输出格式正确性
验证: 需求 4.4

Feature: nodriver-migration, Property 8: Markdown Formatting Correctness
验证: 需求 11.4, 11.5
"""

import re
import pytest
from hypothesis import given, strategies as st, settings

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
        
        assert "## AI 搜索结果" in output
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
        
        assert "## AI 搜索结果" in output
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


# =============================================================================
# Feature: nodriver-migration, Property 8: Markdown Formatting Correctness
# =============================================================================

# Strategies for generating valid SearchSource objects
def search_source_strategy():
    """Strategy for generating valid SearchSource objects
    
    Generates titles without newlines to ensure valid Markdown link syntax.
    """
    return st.builds(
        SearchSource,
        # Title should not contain newlines (would break Markdown link syntax)
        title=st.text(min_size=1, max_size=100, alphabet=st.characters(
            blacklist_categories=('Cs',),  # Exclude surrogates
            blacklist_characters='\n\r[]()' # Exclude newlines and Markdown link chars
        )).filter(lambda x: x.strip()),
        url=st.from_regex(r'https://[a-z0-9]+\.[a-z]{2,4}(/[a-z0-9]+)*', fullmatch=True),
        snippet=st.text(min_size=0, max_size=200)
    )


# Strategy for generating valid SearchResult objects
def search_result_strategy():
    """Strategy for generating valid SearchResult objects with various configurations
    
    Generates queries without leading/trailing whitespace characters to ensure proper Markdown formatting.
    """
    return st.builds(
        SearchResult,
        success=st.just(True),  # Only test successful results for formatting
        # Query should not contain whitespace that would be stripped
        # Use printable characters to avoid edge cases with control characters
        query=st.text(min_size=1, max_size=200, alphabet=st.characters(
            whitelist_categories=('L', 'N', 'P', 'S', 'Zs'),  # Letters, Numbers, Punctuation, Symbols, Space
            blacklist_characters='\n\r\t\x0b\x0c'  # Exclude all whitespace except regular space
        )).filter(lambda x: x.strip() and x == x.strip()),  # Ensure no leading/trailing whitespace
        ai_answer=st.text(min_size=0, max_size=1000),  # Can be empty
        sources=st.lists(search_source_strategy(), min_size=0, max_size=10),
        error=st.just("")  # No error for successful results
    )


class TestMarkdownFormattingProperty:
    """
    **Feature: nodriver-migration, Property 8: Markdown Formatting Correctness**
    
    Property 8: Markdown Formatting Correctness
    *For any* valid SearchResult object, the formatted Markdown output SHALL:
    - Contain the query text
    - Contain the AI answer (if present)
    - Contain source links with proper Markdown link syntax
    - When parsed, preserve the essential information (query, answer presence, source count)
    
    **Validates: Requirements 11.4, 11.5**
    """
    
    @settings(max_examples=100)
    @given(result=search_result_strategy())
    def test_markdown_contains_query(self, result: SearchResult):
        """
        **Feature: nodriver-migration, Property 8: Markdown Formatting Correctness**
        
        For any valid SearchResult, the formatted Markdown SHALL contain the query text.
        
        **Validates: Requirements 11.4, 11.5**
        """
        output = format_search_result(result)
        
        # The query should appear in the output
        assert result.query in output, \
            f"Markdown output should contain the query text: '{result.query[:50]}...'"
    
    @settings(max_examples=100)
    @given(result=search_result_strategy())
    def test_markdown_contains_ai_answer_if_present(self, result: SearchResult):
        """
        **Feature: nodriver-migration, Property 8: Markdown Formatting Correctness**
        
        For any valid SearchResult with a non-empty AI answer, 
        the formatted Markdown SHALL contain the AI answer.
        
        **Validates: Requirements 11.4, 11.5**
        """
        output = format_search_result(result)
        
        # If AI answer is present, it should appear in the output
        if result.ai_answer:
            assert result.ai_answer in output, \
                f"Markdown output should contain the AI answer when present"
    
    @settings(max_examples=100)
    @given(result=search_result_strategy())
    def test_markdown_source_links_syntax(self, result: SearchResult):
        """
        **Feature: nodriver-migration, Property 8: Markdown Formatting Correctness**
        
        For any valid SearchResult with sources, the formatted Markdown SHALL
        contain source links with proper Markdown link syntax [title](url).
        
        **Validates: Requirements 11.4, 11.5**
        """
        output = format_search_result(result)
        
        # Check that sources use proper Markdown link syntax [title](url)
        # Only first 5 sources are displayed
        displayed_sources = result.sources[:5]
        
        for source in displayed_sources:
            # Verify the Markdown link syntax [title](url) is present
            expected_link = f"[{source.title}]({source.url})"
            assert expected_link in output, \
                f"Source should use proper Markdown link syntax: {expected_link}"
    
    @settings(max_examples=100)
    @given(result=search_result_strategy())
    def test_markdown_preserves_essential_information(self, result: SearchResult):
        """
        **Feature: nodriver-migration, Property 8: Markdown Formatting Correctness**
        
        For any valid SearchResult, formatting then parsing the Markdown SHALL
        preserve essential information (query, answer presence, source count).
        
        This is the round-trip property: we can extract the essential information
        back from the formatted Markdown.
        
        **Validates: Requirements 11.4, 11.5**
        """
        output = format_search_result(result)
        
        # Parse essential information from the Markdown output
        
        # 1. Query should be extractable (appears after "**查询**: ")
        query_pattern = r'\*\*查询\*\*: (.+)'
        query_match = re.search(query_pattern, output)
        assert query_match is not None, "Should be able to extract query from Markdown"
        extracted_query = query_match.group(1).strip()
        assert extracted_query == result.query, \
            f"Extracted query '{extracted_query}' should match original '{result.query}'"
        
        # 2. AI answer presence should be detectable
        has_ai_answer_section = "### AI 回答" in output
        assert has_ai_answer_section, "Markdown should have AI answer section"
        
        # 3. Source count should be extractable (if sources exist)
        # Note: The Markdown shows total source count, but only displays first 5
        total_source_count = len(result.sources)
        displayed_source_count = min(total_source_count, 5)
        
        if total_source_count > 0:
            # Pattern: "### 来源 (N 个)"
            source_count_pattern = r'### 来源 \((\d+) 个\)'
            source_match = re.search(source_count_pattern, output)
            assert source_match is not None, \
                f"Should be able to extract source count from Markdown when sources exist"
            extracted_count = int(source_match.group(1))
            # The count in header shows total sources, not just displayed ones
            assert extracted_count == total_source_count, \
                f"Extracted source count {extracted_count} should match total count {total_source_count}"
            
            # Verify the actual number of displayed links matches min(total, 5)
            link_pattern = r'\d+\. \[.+\]\(.+\)'
            displayed_links = re.findall(link_pattern, output)
            assert len(displayed_links) == displayed_source_count, \
                f"Should display {displayed_source_count} source links, found {len(displayed_links)}"
        else:
            # No sources means no source section
            assert "### 来源" not in output, \
                "Markdown should not have source section when no sources exist"
    
    @settings(max_examples=100)
    @given(result=search_result_strategy())
    def test_markdown_is_valid_format(self, result: SearchResult):
        """
        **Feature: nodriver-migration, Property 8: Markdown Formatting Correctness**
        
        For any valid SearchResult, the formatted output SHALL be valid Markdown
        with proper heading structure.
        
        **Validates: Requirements 11.4, 11.5**
        """
        output = format_search_result(result)
        
        # Verify Markdown structure
        # 1. Should start with a level-2 heading
        assert output.startswith("## "), \
            "Markdown should start with a level-2 heading (## )"
        
        # 2. Should have proper heading hierarchy (## then ###)
        lines = output.split('\n')
        heading_levels = []
        for line in lines:
            if line.startswith('###'):
                heading_levels.append(3)
            elif line.startswith('##'):
                heading_levels.append(2)
        
        # First heading should be level 2
        assert heading_levels[0] == 2, "First heading should be level 2"
        
        # 3. All Markdown links should be properly formatted
        # Pattern: [text](url) - check for balanced brackets
        link_pattern = r'\[([^\]]+)\]\(([^)]+)\)'
        links = re.findall(link_pattern, output)
        
        # Each source should have a corresponding link
        displayed_sources = result.sources[:5]
        assert len(links) >= len(displayed_sources), \
            f"Should have at least {len(displayed_sources)} Markdown links for sources"


class TestMarkdownFormattingEdgeCases:
    """
    Edge case tests for Markdown formatting.
    
    **Feature: nodriver-migration, Property 8: Markdown Formatting Correctness**
    **Validates: Requirements 11.4, 11.5**
    """
    
    def test_empty_ai_answer(self):
        """Test formatting with empty AI answer"""
        result = SearchResult(
            success=True,
            query="test query",
            ai_answer="",
            sources=[]
        )
        
        output = format_search_result(result)
        
        assert "test query" in output
        assert "### AI 回答" in output
    
    def test_special_characters_in_query(self):
        """Test formatting with special characters in query"""
        result = SearchResult(
            success=True,
            query="Python **kwargs & *args 用法",
            ai_answer="这是关于 Python 参数的说明",
            sources=[]
        )
        
        output = format_search_result(result)
        
        # Query with special Markdown characters should still be present
        assert "Python **kwargs & *args 用法" in output
    
    def test_unicode_content(self):
        """Test formatting with Unicode content (Chinese, Japanese, Korean)"""
        result = SearchResult(
            success=True,
            query="日本語のテスト 한국어 테스트",
            ai_answer="这是中文回答 🎉 emoji test",
            sources=[
                SearchSource(title="日本語サイト", url="https://example.jp"),
                SearchSource(title="한국어 사이트", url="https://example.kr"),
            ]
        )
        
        output = format_search_result(result)
        
        assert "日本語のテスト 한국어 테스트" in output
        assert "这是中文回答 🎉 emoji test" in output
        assert "[日本語サイト](https://example.jp)" in output
        assert "[한국어 사이트](https://example.kr)" in output
    
    def test_source_with_special_url_characters(self):
        """Test formatting with special characters in URLs"""
        result = SearchResult(
            success=True,
            query="test",
            ai_answer="answer",
            sources=[
                SearchSource(
                    title="Test Source",
                    url="https://example.com/path?query=value&other=123"
                ),
            ]
        )
        
        output = format_search_result(result)
        
        # URL with query parameters should be properly formatted
        assert "[Test Source](https://example.com/path?query=value&other=123)" in output
    
    def test_follow_up_mode_formatting(self):
        """Test formatting in follow-up mode"""
        result = SearchResult(
            success=True,
            query="追问测试",
            ai_answer="这是追问的回答",
            sources=[]
        )
        
        output = format_search_result(result, is_follow_up=True)
        
        # Follow-up mode should use different heading
        assert "## AI 追问结果" in output
        assert "## AI 搜索结果" not in output
        # Should not have the follow-up tip
        assert "follow_up: true" not in output
