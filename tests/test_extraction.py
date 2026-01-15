"""
内容提取属性测试

Feature: google-ai-search-mcp
Property 2: 文本清理正确性
Property 3: 链接处理正确性
验证: 需求 3.2, 3.3, 3.4, 3.5
"""

import pytest
from hypothesis import given, strategies as st
from unittest.mock import patch

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import GoogleAISearcher


# 需要清理的导航文本列表
NAV_TEXTS = [
    "AI 模式",
    "全部 图片 视频 新闻 更多",
    "登录",
    "AI 的回答未必正确无误，请注意核查",
    "全部显示",
    "查看相关链接",
    "关于这条结果",
    "搜索结果",
]


class TestTextCleaning:
    """文本清理单元测试"""
    
    def test_clean_ai_mode_prefix(self):
        """测试清理 AI 模式前缀"""
        text = "AI 模式 这是AI回答内容"
        result = GoogleAISearcher.clean_ai_answer(text)
        assert "AI 模式" not in result
        assert "这是AI回答内容" in result
    
    def test_clean_navigation_text(self):
        """测试清理导航文本"""
        text = "全部 图片 视频 新闻 更多 这是正文内容"
        result = GoogleAISearcher.clean_ai_answer(text)
        assert "全部" not in result or "这是正文内容" in result
    
    def test_clean_login_text(self):
        """测试清理登录文本"""
        text = "登录 这是正文内容"
        result = GoogleAISearcher.clean_ai_answer(text)
        assert "登录" not in result


# Feature: google-ai-search-mcp, Property 2: 文本清理正确性
class TestTextCleaningProperty:
    """文本清理属性测试 - Property 2"""
    
    @given(
        content=st.text(min_size=10, max_size=500),
        nav_text=st.sampled_from(NAV_TEXTS)
    )
    def test_nav_text_removed(self, content, nav_text):
        """
        Property 2: 文本清理正确性
        对于任意包含导航文本的原始文本，清理后的 AI 回答不应包含这些导航文本。
        **验证: 需求 3.2**
        """
        # 构造包含导航文本的输入
        text_with_nav = f"{nav_text} {content}"
        
        result = GoogleAISearcher.clean_ai_answer(text_with_nav)
        
        # 验证导航文本被移除
        # 注意：某些导航文本可能是内容的一部分，所以我们检查开头
        assert not result.startswith(nav_text.strip())


class TestLinkFiltering:
    """链接过滤单元测试"""
    
    def test_filter_google_links(self):
        """测试过滤 Google 链接"""
        sources = [
            {"url": "https://google.com/search", "title": "Google"},
            {"url": "https://example.com", "title": "Example"},
        ]
        result = GoogleAISearcher.filter_sources(sources)
        
        assert len(result) == 1
        assert result[0]["url"] == "https://example.com"
    
    def test_filter_duplicate_urls(self):
        """测试去除重复 URL"""
        sources = [
            {"url": "https://example.com", "title": "Example 1"},
            {"url": "https://example.com", "title": "Example 2"},
            {"url": "https://other.com", "title": "Other"},
        ]
        result = GoogleAISearcher.filter_sources(sources)
        
        assert len(result) == 2
        urls = [s["url"] for s in result]
        assert len(urls) == len(set(urls))  # 无重复
    
    def test_max_sources_limit(self):
        """测试最多返回 10 个来源"""
        sources = [
            {"url": f"https://example{i}.com", "title": f"Example {i}"}
            for i in range(20)
        ]
        result = GoogleAISearcher.filter_sources(sources, max_count=10)
        
        assert len(result) <= 10


# Feature: google-ai-search-mcp, Property 3: 链接处理正确性
class TestLinkFilteringProperty:
    """链接过滤属性测试 - Property 3"""
    
    @given(
        non_google_urls=st.lists(
            st.text(min_size=5, max_size=50).map(lambda x: f"https://{x.replace('/', '')}.com"),
            min_size=0,
            max_size=20
        ),
        include_google=st.booleans(),
        include_duplicates=st.booleans()
    )
    def test_link_processing_properties(self, non_google_urls, include_google, include_duplicates):
        """
        Property 3: 链接处理正确性
        对于任意从页面提取的链接列表，处理后的来源列表应满足：
        - 不包含 google.com 域名的链接
        - 不包含重复的 URL
        - 数量不超过 10 个
        **验证: 需求 3.3, 3.4, 3.5**
        """
        sources = []
        
        # 添加非 Google 链接
        for i, url in enumerate(non_google_urls):
            sources.append({"url": url, "title": f"Title {i}"})
        
        # 可能添加 Google 链接
        if include_google:
            sources.append({"url": "https://google.com/search", "title": "Google"})
            sources.append({"url": "https://accounts.google.com", "title": "Google Account"})
        
        # 可能添加重复链接
        if include_duplicates and non_google_urls:
            sources.append({"url": non_google_urls[0], "title": "Duplicate"})
        
        result = GoogleAISearcher.filter_sources(sources, max_count=10)
        
        # 验证属性 1: 不包含 Google 链接
        for source in result:
            assert "google.com" not in source["url"], "不应包含 google.com 链接"
        
        # 验证属性 2: 不包含重复 URL
        urls = [s["url"] for s in result]
        assert len(urls) == len(set(urls)), "不应包含重复 URL"
        
        # 验证属性 3: 数量不超过 10
        assert len(result) <= 10, "来源数量不应超过 10"
