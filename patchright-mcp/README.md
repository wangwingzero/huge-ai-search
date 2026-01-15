# Patchright MCP Server

防检测浏览器自动化 MCP 服务器，使用 [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python)（Playwright 防检测分支）。

## 适用场景

- **替代 fetch**: 当普通 HTTP 请求被 Cloudflare/DataDome 等反爬虫系统阻止时
- **替代 playwright MCP**: 当标准 Playwright 被检测为机器人时
- **动态内容抓取**: 需要 JavaScript 渲染的页面

## 功能

| 工具 | 描述 |
|------|------|
| `patchright_fetch` | 抓取网页内容，支持 text/markdown/html 格式 |
| `patchright_screenshot` | 截取网页截图 |
| `patchright_click` | 点击页面元素 |
| `patchright_fill_form` | 填写并提交表单 |
| `patchright_execute_js` | 执行 JavaScript 代码 |

## 安装

```bash
# 克隆项目
cd patchright-mcp

# 安装依赖
pip install -e .

# 安装浏览器（首次使用）
patchright install chrome
```

## MCP 配置

### Kiro (`~/.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "patchright": {
      "command": "python",
      "args": ["-m", "patchright_mcp"],
      "cwd": "<project-path>/src"
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "patchright": {
      "command": "python",
      "args": ["-m", "patchright_mcp"],
      "cwd": "<project-path>/src"
    }
  }
}
```

## 使用示例

### 抓取被保护的网页

```
使用 patchright_fetch 抓取 https://example.com
```

### 截图

```
使用 patchright_screenshot 截取 https://example.com 的全页截图
```

### 点击加载更多

```
使用 patchright_click 在 https://example.com 点击 ".load-more" 按钮
```

### 填写搜索表单

```
使用 patchright_fill_form 在 https://example.com 填写 {"#search": "关键词"} 并点击 "#submit"
```

## 防检测原理

Patchright 通过以下方式绕过机器人检测：

1. **修补 `navigator.webdriver`**: 设置为 `false` 或 `undefined`
2. **避免 CDP Runtime.enable**: 在隔离上下文中执行 JavaScript
3. **移除自动化标志**: 删除 `--enable-automation` 等命令行参数
4. **禁用 Console API**: 关闭常见的监控向量

## 与其他工具对比

| 特性 | Patchright MCP | 标准 Playwright MCP | fetch |
|------|---------------|-------------------|-------|
| 反爬虫绕过 | ✅ 强 | ❌ 易被检测 | ❌ 无 |
| JavaScript 渲染 | ✅ | ✅ | ❌ |
| 动态内容 | ✅ | ✅ | ❌ |
| 速度 | 中等 | 中等 | 快 |
| 资源占用 | 高 | 高 | 低 |

## 许可证

MIT
