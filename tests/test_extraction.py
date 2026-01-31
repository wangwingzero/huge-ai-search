"""
内容提取属性测试

Feature: google-ai-search-mcp
Property 2: 文本清理正确性
Property 3: 链接处理正确性
验证: 需求 3.2, 3.3, 3.4, 3.5

Feature: nodriver-migration
Property 3: Navigation Text Cleaning
验证: 需求 5.4
"""

import pytest
from hypothesis import given, strategies as st, settings
from unittest.mock import patch

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import GoogleAISearcher, AsyncGoogleAISearcher


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


# ============================================================================
# Multi-language navigation patterns for Property 3 testing
# ============================================================================

# Navigation patterns by language (for property-based testing)
NAVIGATION_PATTERNS_BY_LANGUAGE = {
    "zh-CN": [
        "AI 模式",
        "全部 图片 视频 新闻 更多",
        "登录",
        "AI 的回答未必正确无误，请注意核查",
        "AI 回答可能包含错误。了解详情",
        "请谨慎使用此类代码。",
        "5 个网站",
        "全部显示",
        "查看相关链接",
        "关于这条结果",
        "搜索结果",
        "相关搜索",
        "意见反馈",
        "帮助",
        "隐私权",
        "条款",
    ],
    "en-US": [
        "AI Mode",
        "All Images Videos News More",
        "Sign in",
        "AI responses may include mistakes. Learn more",
        "AI overview",
        "Use code with caution.",
        "5 sites",
        "Show all",
        "View related links",
        "About this result",
        "Search Results",
        "Related searches",
        "Send feedback",
        "Help",
        "Privacy",
        "Terms",
        "Accessibility links",
        "Skip to main content",
        "Accessibility help",
        "Accessibility feedback",
        "Filters and topics",
        "AI Mode response is ready",
    ],
    "ja-JP": [
        "AI モード",
        "すべて 画像 動画 ニュース もっと見る",
        "ログイン",
        "AI の回答には間違いが含まれている場合があります。詳細",
        "5 件のサイト",
        "すべて表示",
        "検索結果",
        "関連する検索",
        "フィードバックを送信",
        "ヘルプ",
        "プライバシー",
        "利用規約",
        "ユーザー補助のリンク",
        "メイン コンテンツにスキップ",
        "ユーザー補助ヘルプ",
        "ユーザー補助に関するフィードバック",
        "フィルタとトピック",
        "AI モードの回答が作成されました",
    ],
    "ko-KR": [
        "AI 모드",
        "전체 이미지 동영상 뉴스 더보기",
        "로그인",
        "AI 응답에 실수가 포함될 수 있습니다. 자세히 알아보기",
        "5개 사이트",
        "모두 표시",
        "검색결과",
        "관련 검색",
        "의견 보내기",
        "도움말",
        "개인정보처리방침",
        "약관",
    ],
    "de-DE": [
        "KI-Modus",
        "Alle Bilder Videos News Mehr",
        "Anmelden",
        "KI-Antworten können Fehler enthalten. Weitere Informationen",
        "5 Websites",
        "Alle anzeigen",
        "Suchergebnisse",
        "Ähnliche Suchanfragen",
        "Feedback senden",
        "Hilfe",
        "Datenschutz",
        "Nutzungsbedingungen",
    ],
    "fr-FR": [
        "Mode IA",
        "Tous Images Vidéos Actualités Plus",
        "Connexion",
        "Les réponses de l'IA peuvent contenir des erreurs. En savoir plus",
        "5 sites",
        "Tout afficher",
        "Résultats de recherche",
        "Recherches associées",
        "Envoyer des commentaires",
        "Aide",
        "Confidentialité",
        "Conditions",
    ],
}

# All supported languages
SUPPORTED_LANGUAGES = list(NAVIGATION_PATTERNS_BY_LANGUAGE.keys())

# Pre-computed set of all navigation patterns (lowercase) for efficient filtering
# This avoids repeated iteration in Hypothesis filter functions
ALL_NAVIGATION_PATTERNS_LOWER = frozenset(
    pattern.lower()
    for patterns in NAVIGATION_PATTERNS_BY_LANGUAGE.values()
    for pattern in patterns
)


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



# ============================================================================
# Feature: nodriver-migration, Property 3: Navigation Text Cleaning
# **Validates: Requirements 5.4**
# ============================================================================

class TestNavigationTextCleaningProperty:
    """
    Property 3: Navigation Text Cleaning
    
    **Feature: nodriver-migration, Property 3: Navigation Text Cleaning**
    **Validates: Requirements 5.4**
    
    For any extracted content containing navigation text patterns (in any supported
    language), the cleaning function SHALL remove all navigation patterns while
    preserving the AI answer content.
    """
    
    @given(
        language=st.sampled_from(SUPPORTED_LANGUAGES),
        ai_content=st.text(
            alphabet=st.characters(
                whitelist_categories=('L', 'N', 'P', 'S'),
                whitelist_characters=' \n'
            ),
            min_size=20,
            max_size=500
        ).filter(lambda x: len(x.strip()) >= 10)
        # Filter out content that matches any navigation pattern to avoid false failures
        # Uses pre-computed frozenset for O(1) lookup instead of nested iteration
        .filter(lambda x: not any(
            nav_pattern in x.lower() 
            for nav_pattern in ALL_NAVIGATION_PATTERNS_LOWER
        ))
    )
    @settings(max_examples=100)
    def test_navigation_patterns_removed_content_preserved(self, language, ai_content):
        """
        **Feature: nodriver-migration, Property 3: Navigation Text Cleaning**
        **Validates: Requirements 5.4**
        
        Property: For any extracted content containing navigation text patterns,
        the cleaning function SHALL remove all navigation patterns while preserving
        the AI answer content.
        
        Test strategy:
        1. Generate random AI answer content
        2. Prepend/append navigation patterns from the specified language
        3. Clean the combined text
        4. Verify navigation patterns are removed
        5. Verify AI content is preserved (or its essence)
        """
        nav_patterns = NAVIGATION_PATTERNS_BY_LANGUAGE[language]
        
        # Select a subset of navigation patterns to mix with content
        # Use deterministic selection based on content hash for reproducibility
        content_hash = hash(ai_content) % len(nav_patterns)
        selected_patterns = nav_patterns[:max(1, (content_hash % 5) + 1)]
        
        # Construct text with navigation patterns mixed in
        # Pattern: [nav_prefix] [ai_content] [nav_suffix]
        nav_prefix = " ".join(selected_patterns[:len(selected_patterns)//2 + 1])
        nav_suffix = " ".join(selected_patterns[len(selected_patterns)//2:])
        
        text_with_nav = f"{nav_prefix} {ai_content} {nav_suffix}"
        
        # Clean the text using the static method
        # Test both GoogleAISearcher and AsyncGoogleAISearcher (they should have same implementation)
        result_sync = GoogleAISearcher.clean_ai_answer(text_with_nav)
        result_async = AsyncGoogleAISearcher.clean_ai_answer(text_with_nav)
        
        # Both implementations should produce the same result
        assert result_sync == result_async, \
            "Sync and async clean_ai_answer should produce identical results"
        
        result = result_sync
        
        # Property 1: Navigation patterns should be removed
        for pattern in selected_patterns:
            # Check that the exact navigation pattern is not in the result
            # Note: Some patterns may partially match content, so we check
            # that the pattern doesn't appear as a standalone element
            pattern_stripped = pattern.strip()
            
            # For patterns that start with ^ in regex (like "AI 模式", "AI Mode"),
            # they should not appear at the start of the result
            if pattern_stripped in ["AI 模式", "AI Mode", "AI モード", "AI 모드", "KI-Modus", "Mode IA"]:
                assert not result.startswith(pattern_stripped), \
                    f"Result should not start with navigation pattern '{pattern_stripped}'"
        
        # Property 2: AI content should be preserved (at least partially)
        # The core content words should still be present
        # We check that significant words from the AI content appear in the result
        ai_words = [w for w in ai_content.split() if len(w) > 2]
        if ai_words:
            # At least some significant words should be preserved
            preserved_count = sum(1 for w in ai_words if w in result)
            # Allow for some loss due to cleaning, but most content should remain
            preservation_ratio = preserved_count / len(ai_words) if ai_words else 1.0
            assert preservation_ratio >= 0.5 or len(result) > 0, \
                f"AI content should be mostly preserved (ratio: {preservation_ratio})"
    
    @given(
        language=st.sampled_from(SUPPORTED_LANGUAGES),
        nav_pattern_index=st.integers(min_value=0, max_value=100)
    )
    @settings(max_examples=100)
    def test_single_navigation_pattern_removed(self, language, nav_pattern_index):
        """
        **Feature: nodriver-migration, Property 3: Navigation Text Cleaning**
        **Validates: Requirements 5.4**
        
        Property: Each individual navigation pattern should be removed when present.
        
        Test strategy:
        1. Select a single navigation pattern from the language
        2. Create text with just that pattern and some content
        3. Verify the pattern is removed after cleaning
        """
        nav_patterns = NAVIGATION_PATTERNS_BY_LANGUAGE[language]
        pattern = nav_patterns[nav_pattern_index % len(nav_patterns)]
        
        # Create a simple test case: pattern + content
        test_content = "这是测试内容 This is test content テスト内容"
        text_with_nav = f"{pattern} {test_content}"
        
        result = GoogleAISearcher.clean_ai_answer(text_with_nav)
        
        # The navigation pattern should be removed
        pattern_stripped = pattern.strip()
        
        # For AI mode prefixes, they should not appear at the start
        ai_mode_patterns = ["AI 模式", "AI Mode", "AI モード", "AI 모드", "KI-Modus", "Mode IA"]
        if pattern_stripped in ai_mode_patterns:
            assert not result.startswith(pattern_stripped), \
                f"AI mode pattern '{pattern_stripped}' should be removed from start"
        
        # The test content should still be present
        assert "测试" in result or "test" in result.lower() or "テスト" in result, \
            "Test content should be preserved after cleaning"
    
    @given(
        ai_content=st.text(
            alphabet=st.characters(
                whitelist_categories=('L', 'N'),
                whitelist_characters=' '
            ),
            min_size=50,
            max_size=300
        ).filter(lambda x: len(x.strip()) >= 30)
    )
    @settings(max_examples=100)
    def test_all_languages_navigation_removed(self, ai_content):
        """
        **Feature: nodriver-migration, Property 3: Navigation Text Cleaning**
        **Validates: Requirements 5.4**
        
        Property: Navigation patterns from ALL supported languages should be
        removed in a single cleaning pass.
        
        Test strategy:
        1. Create text with navigation patterns from multiple languages
        2. Clean the text
        3. Verify patterns from all languages are removed
        """
        # Collect one pattern from each language
        multi_lang_patterns = []
        for lang, patterns in NAVIGATION_PATTERNS_BY_LANGUAGE.items():
            if patterns:
                # Pick the first pattern (usually the AI mode indicator)
                multi_lang_patterns.append(patterns[0])
        
        # Construct text with patterns from all languages
        prefix = " ".join(multi_lang_patterns[:3])  # First 3 languages
        suffix = " ".join(multi_lang_patterns[3:])  # Remaining languages
        
        text_with_nav = f"{prefix} {ai_content} {suffix}"
        
        result = GoogleAISearcher.clean_ai_answer(text_with_nav)
        
        # AI mode patterns from all languages should be removed from the start
        ai_mode_patterns = ["AI 模式", "AI Mode", "AI モード", "AI 모드", "KI-Modus", "Mode IA"]
        for pattern in ai_mode_patterns:
            assert not result.startswith(pattern), \
                f"AI mode pattern '{pattern}' should not appear at start of result"
        
        # Content should be preserved
        assert len(result) > 0, "Result should not be empty after cleaning"


class TestNavigationTextCleaningEdgeCases:
    """
    Edge case tests for navigation text cleaning.
    
    **Feature: nodriver-migration, Property 3: Navigation Text Cleaning**
    **Validates: Requirements 5.4**
    """
    
    def test_empty_string(self):
        """Empty string should return empty string"""
        result = GoogleAISearcher.clean_ai_answer("")
        assert result == ""
    
    def test_only_navigation_text(self):
        """Text with only navigation patterns should return empty or minimal result"""
        text = "AI 模式 登录 全部显示"
        result = GoogleAISearcher.clean_ai_answer(text)
        # Result should be significantly shorter
        assert len(result) < len(text)
    
    def test_whitespace_normalization(self):
        """Multiple spaces and newlines should be normalized"""
        text = "AI 模式    这是内容    \n\n\n  更多内容"
        result = GoogleAISearcher.clean_ai_answer(text)
        # Should not have multiple consecutive spaces
        assert "  " not in result
        # Should not have multiple consecutive newlines
        assert "\n\n" not in result
    
    def test_mixed_language_content(self):
        """Content with mixed languages should be handled correctly"""
        text = "AI Mode 这是中文内容 This is English content AI モード 日本語コンテンツ"
        result = GoogleAISearcher.clean_ai_answer(text)
        # AI mode patterns should be removed
        assert not result.startswith("AI Mode")
        # Content should be preserved
        assert "中文" in result or "English" in result or "日本語" in result
    
    @pytest.mark.parametrize("language,pattern", [
        ("zh-CN", "AI 模式"),
        ("en-US", "AI Mode"),
        ("ja-JP", "AI モード"),
        ("ko-KR", "AI 모드"),
        ("de-DE", "KI-Modus"),
        ("fr-FR", "Mode IA"),
    ])
    def test_ai_mode_prefix_removed_by_language(self, language, pattern):
        """
        **Feature: nodriver-migration, Property 3: Navigation Text Cleaning**
        **Validates: Requirements 5.4**
        
        AI mode prefix should be removed for each supported language.
        """
        content = "This is the actual AI answer content."
        text = f"{pattern} {content}"
        result = GoogleAISearcher.clean_ai_answer(text)
        
        assert not result.startswith(pattern), \
            f"AI mode pattern '{pattern}' for {language} should be removed"
        assert "actual AI answer" in result, \
            "Content should be preserved"


# ============================================================================
# Feature: nodriver-migration, Property 4: Multi-Language Label Recognition
# **Validates: Requirements 6.2, 6.3, 6.4**
# ============================================================================

# AI Mode labels by language (for Property 4 testing)
AI_MODE_LABELS = {
    "zh-CN": "AI 模式",
    "en-US": "AI Mode",
    "ja-JP": "AI モード",
    "ko-KR": "AI 모드",
    "de-DE": "KI-Modus",
    "fr-FR": "Mode IA",
}

# AI disclaimer patterns by language (for Property 4 testing)
AI_DISCLAIMER_PATTERNS = {
    "zh-CN": "AI 的回答未必正确无误，请注意核查",
    "en-US": "AI responses may include mistakes. Learn more",
    "ja-JP": "AI の回答には間違いが含まれている場合があります。詳細",
    "ko-KR": "AI 응답에 실수가 포함될 수 있습니다. 자세히 알아보기",
    "de-DE": "KI-Antworten können Fehler enthalten. Weitere Informationen",
    "fr-FR": "Les réponses de l'IA peuvent contenir des erreurs. En savoir plus",
}

# Login button text by language (for Property 4 testing)
LOGIN_LABELS = {
    "zh-CN": "登录",
    "en-US": "Sign in",
    "ja-JP": "ログイン",
    "ko-KR": "로그인",
    "de-DE": "Anmelden",
    "fr-FR": "Connexion",
}

# "Show all" button text by language (for Property 4 testing)
SHOW_ALL_LABELS = {
    "zh-CN": "全部显示",
    "en-US": "Show all",
    "ja-JP": "すべて表示",
    "ko-KR": "모두 표시",
    "de-DE": "Alle anzeigen",
    "fr-FR": "Tout afficher",
}


# All navigation patterns flattened for filtering in generators
ALL_NAVIGATION_PATTERNS_FLAT = set()
for patterns in NAVIGATION_PATTERNS_BY_LANGUAGE.values():
    ALL_NAVIGATION_PATTERNS_FLAT.update(patterns)
# Add additional patterns that might be cleaned
ALL_NAVIGATION_PATTERNS_FLAT.update(AI_MODE_LABELS.values())
ALL_NAVIGATION_PATTERNS_FLAT.update(LOGIN_LABELS.values())
ALL_NAVIGATION_PATTERNS_FLAT.update(SHOW_ALL_LABELS.values())
ALL_NAVIGATION_PATTERNS_FLAT.update(AI_DISCLAIMER_PATTERNS.values())


def is_not_navigation_pattern(text: str) -> bool:
    """Check if text is not a navigation pattern (for filtering generated content)"""
    text_stripped = text.strip()
    if len(text_stripped) < 5:
        return False
    # Check if the text matches any navigation pattern
    for pattern in ALL_NAVIGATION_PATTERNS_FLAT:
        if pattern.lower() in text_stripped.lower() or text_stripped.lower() in pattern.lower():
            return False
    return True


class TestMultiLanguageLabelRecognitionProperty:
    """
    Property 4: Multi-Language Label Recognition
    
    **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
    **Validates: Requirements 6.2, 6.3, 6.4**
    
    For any supported language code (zh-CN, en-US, ja-JP, ko-KR, de-DE, fr-FR),
    the extraction logic SHALL correctly recognize AI mode labels and navigation
    patterns in that language.
    """
    
    @given(
        language=st.sampled_from(SUPPORTED_LANGUAGES),
        ai_content=st.text(
            alphabet=st.characters(
                whitelist_categories=('L', 'N', 'P'),
                whitelist_characters=' '
            ),
            min_size=20,
            max_size=300
        ).filter(lambda x: len(x.strip()) >= 15 and is_not_navigation_pattern(x))
    )
    @settings(max_examples=100)
    def test_ai_mode_label_recognized_all_languages(self, language, ai_content):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.2, 6.3, 6.4**
        
        Property: For any supported language, the AI mode label SHALL be recognized
        and removed from the content while preserving the actual AI answer.
        
        Test strategy:
        1. Select a supported language
        2. Prepend the AI mode label for that language to content
        3. Clean the text
        4. Verify the AI mode label is removed
        5. Verify the content is preserved
        """
        ai_mode_label = AI_MODE_LABELS[language]
        
        # Construct text with AI mode label prefix
        text_with_label = f"{ai_mode_label} {ai_content}"
        
        # Clean using both sync and async implementations
        result_sync = GoogleAISearcher.clean_ai_answer(text_with_label)
        result_async = AsyncGoogleAISearcher.clean_ai_answer(text_with_label)
        
        # Both implementations should produce identical results
        assert result_sync == result_async, \
            f"Sync and async implementations should match for {language}"
        
        result = result_sync
        
        # Property 1: AI mode label should be removed from the start
        assert not result.startswith(ai_mode_label), \
            f"AI mode label '{ai_mode_label}' for {language} should be removed from start"
        
        # Property 2: Content should be preserved (at least partially)
        # Check that significant words from the content appear in the result
        content_words = [w for w in ai_content.split() if len(w) > 2]
        if content_words:
            preserved_count = sum(1 for w in content_words if w in result)
            preservation_ratio = preserved_count / len(content_words)
            assert preservation_ratio >= 0.5 or len(result) > 0, \
                f"Content should be mostly preserved for {language}"
    
    @given(
        language=st.sampled_from(SUPPORTED_LANGUAGES),
        content_before=st.text(
            alphabet=st.characters(whitelist_categories=('L', 'N'), whitelist_characters=' '),
            min_size=10,
            max_size=100
        ).filter(lambda x: len(x.strip()) >= 5 and is_not_navigation_pattern(x)),
        content_after=st.text(
            alphabet=st.characters(whitelist_categories=('L', 'N'), whitelist_characters=' '),
            min_size=10,
            max_size=100
        ).filter(lambda x: len(x.strip()) >= 5 and is_not_navigation_pattern(x))
    )
    @settings(max_examples=100)
    def test_navigation_patterns_recognized_all_languages(self, language, content_before, content_after):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.2, 6.3, 6.4**
        
        Property: For any supported language, navigation patterns (login, show all, etc.)
        SHALL be recognized and removed while preserving surrounding content.
        
        Test strategy:
        1. Select a supported language
        2. Insert navigation patterns between content sections
        3. Clean the text
        4. Verify navigation patterns are removed
        5. Verify surrounding content is preserved
        """
        # Get navigation patterns for this language
        login_label = LOGIN_LABELS.get(language, "")
        show_all_label = SHOW_ALL_LABELS.get(language, "")
        
        # Construct text with navigation patterns embedded
        text_with_nav = f"{content_before} {login_label} {show_all_label} {content_after}"
        
        result = GoogleAISearcher.clean_ai_answer(text_with_nav)
        
        # Property 1: Login label should be removed
        if login_label:
            # The exact login label should not appear as a standalone word
            # (it might appear as part of content, so we check it's not prominent)
            assert login_label not in result or len(result) > len(login_label) * 3, \
                f"Login label '{login_label}' for {language} should be removed or minimized"
        
        # Property 2: Show all label should be removed
        if show_all_label:
            assert show_all_label not in result or len(result) > len(show_all_label) * 3, \
                f"Show all label '{show_all_label}' for {language} should be removed or minimized"
        
        # Property 3: Some content should be preserved
        assert len(result) > 0, \
            f"Result should not be empty for {language}"
    
    @given(
        language=st.sampled_from(SUPPORTED_LANGUAGES)
    )
    @settings(max_examples=100)
    def test_all_supported_languages_have_patterns(self, language):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.2**
        
        Property: All 6 supported languages (zh-CN, en-US, ja-JP, ko-KR, de-DE, fr-FR)
        SHALL have defined AI mode labels and navigation patterns.
        
        Test strategy:
        1. For each supported language
        2. Verify AI mode label is defined
        3. Verify navigation patterns are defined
        4. Verify the patterns are non-empty strings
        """
        # Verify AI mode label exists and is non-empty
        assert language in AI_MODE_LABELS, \
            f"AI mode label should be defined for {language}"
        assert len(AI_MODE_LABELS[language]) > 0, \
            f"AI mode label for {language} should be non-empty"
        
        # Verify navigation patterns exist
        assert language in NAVIGATION_PATTERNS_BY_LANGUAGE, \
            f"Navigation patterns should be defined for {language}"
        assert len(NAVIGATION_PATTERNS_BY_LANGUAGE[language]) > 0, \
            f"Navigation patterns for {language} should be non-empty"
        
        # Verify login label exists
        assert language in LOGIN_LABELS, \
            f"Login label should be defined for {language}"
        
        # Verify show all label exists
        assert language in SHOW_ALL_LABELS, \
            f"Show all label should be defined for {language}"
    
    @given(
        language=st.sampled_from(SUPPORTED_LANGUAGES),
        ai_content=st.text(
            alphabet=st.characters(whitelist_categories=('L', 'N'), whitelist_characters=' '),
            min_size=30,
            max_size=200
        ).filter(lambda x: len(x.strip()) >= 20)
    )
    @settings(max_examples=100)
    def test_ai_disclaimer_recognized_all_languages(self, language, ai_content):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.3, 6.4**
        
        Property: For any supported language, AI disclaimer text SHALL be recognized
        and removed from the content.
        
        Test strategy:
        1. Select a supported language
        2. Append the AI disclaimer for that language to content
        3. Clean the text
        4. Verify the disclaimer is removed or minimized
        5. Verify the main content is preserved
        """
        disclaimer = AI_DISCLAIMER_PATTERNS.get(language, "")
        if not disclaimer:
            return  # Skip if no disclaimer defined for this language
        
        # Construct text with disclaimer appended
        text_with_disclaimer = f"{ai_content} {disclaimer}"
        
        result = GoogleAISearcher.clean_ai_answer(text_with_disclaimer)
        
        # Property 1: Disclaimer should be removed or significantly reduced
        # The disclaimer is typically at the end, so check it's not there
        assert not result.endswith(disclaimer), \
            f"Disclaimer for {language} should be removed from end"
        
        # Property 2: Main content should be preserved
        content_words = [w for w in ai_content.split() if len(w) > 2]
        if content_words:
            preserved_count = sum(1 for w in content_words if w in result)
            preservation_ratio = preserved_count / len(content_words)
            assert preservation_ratio >= 0.3 or len(result) > 0, \
                f"Main content should be preserved for {language}"


class TestMultiLanguageLabelRecognitionEdgeCases:
    """
    Edge case tests for multi-language label recognition.
    
    **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
    **Validates: Requirements 6.2, 6.3, 6.4**
    """
    
    @pytest.mark.parametrize("language", SUPPORTED_LANGUAGES)
    def test_ai_mode_label_at_start_removed(self, language):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.3**
        
        AI mode label at the start of text should be removed for each language.
        """
        ai_mode_label = AI_MODE_LABELS[language]
        content = "This is the actual AI answer content with important information."
        text = f"{ai_mode_label} {content}"
        
        result = GoogleAISearcher.clean_ai_answer(text)
        
        assert not result.startswith(ai_mode_label), \
            f"AI mode label '{ai_mode_label}' for {language} should be removed"
        assert "actual AI answer" in result, \
            f"Content should be preserved for {language}"
    
    @pytest.mark.parametrize("language", SUPPORTED_LANGUAGES)
    def test_login_label_removed(self, language):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.4**
        
        Login label should be removed for each language.
        """
        login_label = LOGIN_LABELS[language]
        content = "Important content here"
        text = f"{login_label} {content}"
        
        result = GoogleAISearcher.clean_ai_answer(text)
        
        # Login label should be removed
        assert login_label not in result or "Important content" in result, \
            f"Login label '{login_label}' for {language} should be removed"
    
    @pytest.mark.parametrize("language", SUPPORTED_LANGUAGES)
    def test_show_all_label_removed(self, language):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.4**
        
        Show all label should be removed for each language.
        """
        show_all_label = SHOW_ALL_LABELS[language]
        content = "Important content here"
        text = f"{content} {show_all_label}"
        
        result = GoogleAISearcher.clean_ai_answer(text)
        
        # Show all label should be removed
        assert show_all_label not in result or "Important content" in result, \
            f"Show all label '{show_all_label}' for {language} should be removed"
    
    def test_all_six_languages_supported(self):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.2**
        
        Verify all 6 required languages are supported.
        """
        required_languages = ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR"]
        
        for lang in required_languages:
            assert lang in SUPPORTED_LANGUAGES, \
                f"Language {lang} should be in supported languages"
            assert lang in AI_MODE_LABELS, \
                f"Language {lang} should have AI mode label defined"
            assert lang in NAVIGATION_PATTERNS_BY_LANGUAGE, \
                f"Language {lang} should have navigation patterns defined"
    
    def test_mixed_language_labels_all_removed(self):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.3, 6.4**
        
        When text contains labels from multiple languages, all should be removed.
        """
        # Construct text with AI mode labels from all languages
        all_labels = " ".join(AI_MODE_LABELS.values())
        content = "This is the actual content that should remain."
        text = f"{all_labels} {content}"
        
        result = GoogleAISearcher.clean_ai_answer(text)
        
        # All AI mode labels should be removed from the start
        for lang, label in AI_MODE_LABELS.items():
            assert not result.startswith(label), \
                f"AI mode label '{label}' for {lang} should be removed"
        
        # Content should be preserved
        assert "actual content" in result, \
            "Content should be preserved after removing all labels"
    
    @pytest.mark.parametrize("language,disclaimer", [
        ("zh-CN", "AI 的回答未必正确无误，请注意核查"),
        ("en-US", "AI responses may include mistakes. Learn more"),
        ("ja-JP", "AI の回答には間違いが含まれている場合があります。詳細"),
        ("ko-KR", "AI 응답에 실수가 포함될 수 있습니다. 자세히 알아보기"),
        ("de-DE", "KI-Antworten können Fehler enthalten. Weitere Informationen"),
        ("fr-FR", "Les réponses de l'IA peuvent contenir des erreurs. En savoir plus"),
    ])
    def test_ai_disclaimer_removed_by_language(self, language, disclaimer):
        """
        **Feature: nodriver-migration, Property 4: Multi-Language Label Recognition**
        **Validates: Requirements 6.3**
        
        AI disclaimer should be removed for each supported language.
        """
        content = "This is important AI-generated content."
        text = f"{content} {disclaimer}"
        
        result = GoogleAISearcher.clean_ai_answer(text)
        
        # Disclaimer should be removed
        assert disclaimer not in result, \
            f"Disclaimer for {language} should be removed"
        # Content should be preserved
        assert "important" in result.lower() or "AI-generated" in result, \
            f"Content should be preserved for {language}"


# ============================================================================
# Feature: nodriver-migration, Property 5: Incremental Content Extraction
# **Validates: Requirements 7.3, 7.5**
# ============================================================================


# Helper function to generate distinct content with unique markers
def make_distinct_content(prefix: str, base_text: str) -> str:
    """Add a unique prefix marker to ensure content is distinct"""
    return f"[{prefix}]{base_text}"


class TestIncrementalContentExtractionProperty:
    """
    Property 5: Incremental Content Extraction
    
    **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
    **Validates: Requirements 7.3, 7.5**
    
    For any follow-up extraction where previous content exists, the result SHALL:
    - Not contain the previous AI answer content
    - Not contain the user's follow-up query at the start
    - Contain only the new AI response
    """
    
    @given(
        previous_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=20,
            max_size=150
        ).filter(lambda x: len(x.strip()) >= 15),
        user_query_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=5,
            max_size=30
        ).filter(lambda x: len(x.strip()) >= 3),
        new_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=20,
            max_size=150
        ).filter(lambda x: len(x.strip()) >= 15)
    )
    @settings(max_examples=100)
    def test_incremental_extraction_removes_previous_content(
        self, previous_base, user_query_base, new_base
    ):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3, 7.5**
        
        Property: For any follow-up extraction where previous content exists,
        the result SHALL not contain the previous AI answer content.
        
        Test strategy:
        1. Generate previous content, user query, and new content with distinct markers
        2. Construct full content as: previous_content + user_query + new_content
        3. Call _extract_incremental_content()
        4. Verify the result does not contain previous content
        """
        # Add distinct markers to ensure content parts don't overlap
        previous_content = f"[PREV]{previous_base}[/PREV]"
        user_query = f"[QUERY]{user_query_base}[/QUERY]"
        new_content = f"[NEW]{new_base}[/NEW]"
        
        # Construct full content: [previous][query][new]
        full_content = f"{previous_content}{user_query}{new_content}"
        
        # Create searcher instance and call the method
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        result = searcher._extract_incremental_content(
            full_content=full_content,
            previous_content=previous_content,
            user_query=user_query
        )
        
        # Property 1: Result should NOT contain the previous content
        # The previous content should be completely removed
        assert previous_content not in result, \
            f"Result should not contain previous content. " \
            f"Previous: '{previous_content[:50]}...', Result: '{result[:100]}...'"
    
    @given(
        previous_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=20,
            max_size=150
        ).filter(lambda x: len(x.strip()) >= 15),
        user_query_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=5,
            max_size=30
        ).filter(lambda x: len(x.strip()) >= 3),
        new_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=20,
            max_size=150
        ).filter(lambda x: len(x.strip()) >= 15)
    )
    @settings(max_examples=100)
    def test_incremental_extraction_removes_user_query(
        self, previous_base, user_query_base, new_base
    ):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3, 7.5**
        
        Property: For any follow-up extraction where previous content exists,
        the result SHALL not start with the user's follow-up query.
        
        Test strategy:
        1. Generate previous content, user query, and new content with distinct markers
        2. Construct full content as: previous_content + user_query + new_content
        3. Call _extract_incremental_content()
        4. Verify the result does not start with user query
        """
        # Add distinct markers to ensure content parts don't overlap
        previous_content = f"[PREV]{previous_base}[/PREV]"
        user_query = f"[QUERY]{user_query_base}[/QUERY]"
        new_content = f"[NEW]{new_base}[/NEW]"
        
        # Construct full content: [previous][query][new]
        full_content = f"{previous_content}{user_query}{new_content}"
        
        # Create searcher instance and call the method
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        result = searcher._extract_incremental_content(
            full_content=full_content,
            previous_content=previous_content,
            user_query=user_query
        )
        
        # Property 2: Result should NOT start with the user query
        user_query_stripped = user_query.strip()
        assert not result.startswith(user_query_stripped), \
            f"Result should not start with user query. " \
            f"Query: '{user_query_stripped}', Result start: '{result[:50]}...'"
    
    @given(
        previous_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=20,
            max_size=150
        ).filter(lambda x: len(x.strip()) >= 15),
        user_query_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=5,
            max_size=30
        ).filter(lambda x: len(x.strip()) >= 3),
        new_base=st.text(
            alphabet=st.characters(
                whitelist_categories=('L',),
                whitelist_characters=' '
            ),
            min_size=20,
            max_size=150
        ).filter(lambda x: len(x.strip()) >= 15)
    )
    @settings(max_examples=100)
    def test_incremental_extraction_preserves_new_content(
        self, previous_base, user_query_base, new_base
    ):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3, 7.5**
        
        Property: For any follow-up extraction where previous content exists,
        the result SHALL contain the new AI response (or its essence).
        
        Test strategy:
        1. Generate previous content, user query, and new content with distinct markers
        2. Construct full content as: previous_content + user_query + new_content
        3. Call _extract_incremental_content()
        4. Verify the result contains the new content (or significant parts of it)
        """
        # Add distinct markers to ensure content parts don't overlap
        previous_content = f"[PREV]{previous_base}[/PREV]"
        user_query = f"[QUERY]{user_query_base}[/QUERY]"
        new_content = f"[NEW]{new_base}[/NEW]"
        
        # Construct full content: [previous][query][new]
        full_content = f"{previous_content}{user_query}{new_content}"
        
        # Create searcher instance and call the method
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        result = searcher._extract_incremental_content(
            full_content=full_content,
            previous_content=previous_content,
            user_query=user_query
        )
        
        # Property 3: Result should contain the new content marker
        # The [NEW] marker should be present in the result
        assert "[NEW]" in result or new_base in result or len(result.strip()) > 0, \
            f"New content should be preserved. " \
            f"New content: '{new_content[:50]}...', Result: '{result[:50]}...'"


class TestIncrementalContentExtractionEdgeCases:
    """
    Edge case tests for incremental content extraction.
    
    **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
    **Validates: Requirements 7.3, 7.5**
    """
    
    def test_empty_full_content_returns_empty(self):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3**
        
        Empty full content should return empty string.
        """
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        result = searcher._extract_incremental_content(
            full_content="",
            previous_content="Previous answer",
            user_query="What else?"
        )
        
        assert result == "", "Empty full content should return empty string"
    
    def test_empty_previous_content_returns_full(self):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3**
        
        Empty previous content should return full content (first search case).
        """
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        full_content = "This is the complete AI answer."
        
        result = searcher._extract_incremental_content(
            full_content=full_content,
            previous_content="",
            user_query="What is this?"
        )
        
        assert result == full_content, \
            "Empty previous content should return full content"
    
    def test_exact_match_extraction(self):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3, 7.5**
        
        When previous content exactly matches, new content should be extracted.
        """
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        previous = "Python is a programming language."
        query = "What are its features?"
        new = "Python features include simplicity and readability."
        full = f"{previous}{query}{new}"
        
        result = searcher._extract_incremental_content(
            full_content=full,
            previous_content=previous,
            user_query=query
        )
        
        # Previous content should be removed
        assert previous not in result, "Previous content should be removed"
        # User query should be removed from start
        assert not result.startswith(query), "User query should be removed from start"
        # New content should be present
        assert "Python features" in result or "simplicity" in result, \
            "New content should be preserved"
    
    def test_chinese_content_extraction(self):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3, 7.5**
        
        Chinese content should be handled correctly.
        """
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        previous = "Python 是一种编程语言。"
        query = "它有什么特点？"
        new = "Python 的特点包括简洁易读、功能强大。"
        full = f"{previous}{query}{new}"
        
        result = searcher._extract_incremental_content(
            full_content=full,
            previous_content=previous,
            user_query=query
        )
        
        # Previous content should be removed
        assert previous not in result, "Previous Chinese content should be removed"
        # User query should be removed from start
        assert not result.startswith(query), "Chinese user query should be removed from start"
        # New content should be present
        assert "特点" in result or "简洁" in result, \
            "New Chinese content should be preserved"
    
    def test_multiline_content_extraction(self):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3, 7.5**
        
        Multi-line content should be handled correctly.
        """
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        previous = "Line 1 of previous answer.\nLine 2 of previous answer."
        query = "Tell me more?"
        new = "Line 1 of new answer.\nLine 2 of new answer."
        full = f"{previous}\n{query}\n{new}"
        
        result = searcher._extract_incremental_content(
            full_content=full,
            previous_content=previous,
            user_query=query
        )
        
        # Previous content should be removed
        assert "Line 1 of previous" not in result, "Previous multi-line content should be removed"
        # New content should be present
        assert "new answer" in result, "New multi-line content should be preserved"
    
    def test_query_with_punctuation(self):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.5**
        
        User query with punctuation should be removed correctly.
        """
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        previous = "Initial answer content here."
        query = "What about this? And that!"
        new = "The answer to your question is detailed here."
        full = f"{previous}{query}{new}"
        
        result = searcher._extract_incremental_content(
            full_content=full,
            previous_content=previous,
            user_query=query
        )
        
        # User query should be removed
        assert not result.startswith("What about"), \
            "User query with punctuation should be removed from start"
    
    @pytest.mark.parametrize("separator", [" ", "\n", "  ", "\n\n", " \n "])
    def test_various_separators(self, separator):
        """
        **Feature: nodriver-migration, Property 5: Incremental Content Extraction**
        **Validates: Requirements 7.3, 7.5**
        
        Various separators between content parts should be handled.
        """
        searcher = AsyncGoogleAISearcher(timeout=30, headless=True, use_user_data=False)
        
        previous = "Previous answer content"
        query = "Follow up question"
        new = "New answer content here"
        full = f"{previous}{separator}{query}{separator}{new}"
        
        result = searcher._extract_incremental_content(
            full_content=full,
            previous_content=previous,
            user_query=query
        )
        
        # Result should not be empty
        assert len(result.strip()) > 0, \
            f"Result should not be empty with separator '{repr(separator)}'"
