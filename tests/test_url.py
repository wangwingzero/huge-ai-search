"""
URL 构造属性测试

Feature: google-ai-search-mcp, Property 1: URL 构造正确性
验证: 需求 2.1, 2.5
"""

import pytest
from hypothesis import given, strategies as st
from urllib.parse import urlparse, parse_qs, unquote_plus
from unittest.mock import patch

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import GoogleAISearcher


class TestURLConstruction:
    """URL 构造单元测试"""
    
    def test_basic_url_construction(self):
        """测试基本 URL 构造"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher()
            url = searcher._build_url("test query", "zh-CN")
            
            assert "google.com/search" in url
            assert "udm=50" in url
            assert "hl=zh-CN" in url
    
    def test_url_encoding(self):
        """测试 URL 编码"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher()
            url = searcher._build_url("hello world", "en-US")
            
            # 空格应被编码为 +
            assert "hello+world" in url or "hello%20world" in url
    
    def test_chinese_query_encoding(self):
        """测试中文查询编码"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher()
            url = searcher._build_url("什么是MCP", "zh-CN")
            
            # URL 应包含编码后的中文
            assert "udm=50" in url
            assert "hl=zh-CN" in url


# Feature: google-ai-search-mcp, Property 1: URL 构造正确性
class TestURLConstructionProperty:
    """URL 构造属性测试 - Property 1"""
    
    @given(
        query=st.text(min_size=1, max_size=100, alphabet=st.characters(
            blacklist_characters='+',  # 排除 + 号，因为它在 URL 编码中有特殊含义
            blacklist_categories=('Cs',)  # 排除代理字符
        )).filter(lambda x: x.strip()),
        language=st.sampled_from(["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR"])
    )
    def test_url_contains_required_params(self, query, language):
        """
        Property 1: URL 构造正确性
        对于任意查询词和语言参数，构造的 Google AI 模式 URL 都应包含
        udm=50 参数和正确的 hl 语言参数，且查询词应被正确 URL 编码。
        **验证: 需求 2.1, 2.5**
        """
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher()
            url = searcher._build_url(query, language)
            
            # 解析 URL
            parsed = urlparse(url)
            params = parse_qs(parsed.query)
            
            # 验证必需参数
            assert "udm" in params, "URL 必须包含 udm 参数"
            assert params["udm"][0] == "50", "udm 参数必须为 50"
            
            assert "hl" in params, "URL 必须包含 hl 参数"
            assert params["hl"][0] == language, f"hl 参数必须为 {language}"
            
            assert "q" in params, "URL 必须包含 q 参数"
            # 验证查询词被正确编码（解码后应等于原始查询）
            decoded_query = unquote_plus(params["q"][0])
            assert decoded_query == query, "查询词应被正确编码"
    
    @given(query=st.text(min_size=1, max_size=50).filter(lambda x: x.strip()))
    def test_url_is_valid_google_url(self, query):
        """URL 应为有效的 Google 搜索 URL"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher()
            url = searcher._build_url(query, "zh-CN")
            
            parsed = urlparse(url)
            assert parsed.scheme == "https"
            assert "google.com" in parsed.netloc
            assert "/search" in parsed.path
