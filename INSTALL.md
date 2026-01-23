# 一键安装指南

## 给 AI 的安装提示词

把下面这段话复制粘贴给你的 AI 助手（Kiro、Claude、Cursor 等），它会自动帮你完成所有配置：

---

**复制以下内容：**

```
请帮我安装配置 google-ai-search-mcp 项目。

项目已经 clone 到本地，请执行以下步骤：

1. 进入项目目录，创建虚拟环境并激活：
   - Windows: python -m venv .venv && .venv\Scripts\activate
   - Mac/Linux: python -m venv .venv && source .venv/bin/activate

2. 安装项目依赖：pip install -e .

3. 安装浏览器驱动：patchright install msedge

4. 获取当前项目的绝对路径，然后配置 MCP：
   - 找到我的 MCP 配置文件（Kiro: ~/.kiro/settings/mcp.json，Claude: %APPDATA%\Claude\claude_desktop_config.json）
   - 添加 google-ai-search 服务器配置，command 使用虚拟环境的 python 绝对路径，cwd 使用项目的 src 目录绝对路径

5. 完成后告诉我重启 AI 工具即可使用
```

---

## 手动安装（如果 AI 搞不定）

```bash
# 1. 进入项目目录
cd google-ai-search-mcp

# 2. 创建虚拟环境
python -m venv .venv

# 3. 激活虚拟环境
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# 4. 安装依赖
pip install -e .

# 5. 安装浏览器
patchright install msedge
```

然后手动编辑 MCP 配置文件，参考 README.md。
![1769162230096](image/INSTALL/1769162230096.png)