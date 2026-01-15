"""
浏览器检测单元测试

验证: 需求 1.1, 1.3
"""

import pytest
from unittest.mock import patch
import os

import sys
sys.path.insert(0, 'src')

from google_ai_search.searcher import GoogleAISearcher


class TestBrowserDetection:
    """浏览器检测测试"""
    
    def test_edge_priority_over_chrome(self):
        """测试 Edge 优先于 Chrome 的检测顺序"""
        edge_path = GoogleAISearcher.EDGE_PATHS[0]
        chrome_path = GoogleAISearcher.CHROME_PATHS[0]
        
        def mock_exists(path):
            # 模拟 Edge 和 Chrome 都存在
            return path in [edge_path, chrome_path]
        
        with patch('os.path.exists', side_effect=mock_exists):
            searcher = GoogleAISearcher()
            # 应该选择 Edge
            assert searcher._browser_path == edge_path
    
    def test_chrome_fallback_when_no_edge(self):
        """测试无 Edge 时回退到 Chrome"""
        chrome_path = GoogleAISearcher.CHROME_PATHS[0]
        
        def mock_exists(path):
            # 只有 Chrome 存在
            return path == chrome_path
        
        with patch('os.path.exists', side_effect=mock_exists):
            searcher = GoogleAISearcher()
            assert searcher._browser_path == chrome_path
    
    def test_no_browser_returns_none(self):
        """测试无浏览器时返回 None"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher()
            assert searcher._browser_path is None
    
    def test_timeout_parameter(self):
        """测试 timeout 参数"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher(timeout=60)
            assert searcher.timeout == 60
    
    def test_headless_parameter(self):
        """测试 headless 参数"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher(headless=False)
            assert searcher.headless is False
    
    def test_default_parameters(self):
        """测试默认参数"""
        with patch('os.path.exists', return_value=False):
            searcher = GoogleAISearcher()
            assert searcher.timeout == 30
            assert searcher.headless is True
