# HUGE

在 VS Code 里直接和 HUGE AI 对话，不用切网页。  
适合代码问答、技术检索、资料核对和基于上下文持续追问。

## 为什么用 HUGE

- 就在编辑器侧边栏聊天，专注不被打断
- 支持连续对话，问题可以越问越深
- 回答附带来源链接，方便核实
- 选中代码可一键发送，减少复制粘贴
- 支持截图粘贴，图文一起问更高效

## 3 分钟快速版（最短必做路径）

1. 安装 Node.js 18+（LTS）和 VS Code
2. 终端确认命令可用：`node -v`、`npm -v`、`npx -v`
3. 在扩展市场安装 **HUGE**（`hudawang.huge-ai-search`）
4. 打开聊天入口（见下方“如何打开 `HUGE: Open Chat`”）
5. 首次按提示登录；也可点击聊天面板右上角 `浏览器查看` 进入浏览器完成登录
6. 若登录流程未正常拉起，再执行 `HUGE: Run Login Setup`
7. 发送一条测试消息，能收到回复即安装成功

## 从零安装（全新电脑）

按下面顺序做，默认以 Windows 为例（macOS/Linux 同理）。

### 第 1 步：安装基础环境

1. 安装 **VS Code**
2. 安装 **Node.js 18+**（建议安装 LTS 版本）
3. 确认 **Microsoft Edge** 可正常打开

### 第 2 步：验证 Node 环境可用

打开终端（PowerShell / CMD）执行：

```bash
node -v
npm -v
npx -v
```

期望结果：三个命令都能输出版本号，且不报错。  
如果任一命令失败，先修复 Node.js 安装，再继续后续步骤。

### 第 3 步：安装插件

1. 打开 VS Code 扩展市场
2. 搜索并安装 **HUGE**（`hudawang.huge-ai-search`）
3. 安装后建议重启一次 VS Code

### 第 4 步：首次启动与登录

1. 打开聊天入口（见下方“如何打开 `HUGE: Open Chat`”）
2. 首次使用按提示完成登录
3. 也可点击聊天面板右上角 `浏览器查看`，在浏览器中完成登录/验证
4. 若登录窗口仍未正常拉起，执行 `HUGE: Run Login Setup`

### 第 5 步：验证“已可用”

在聊天框发送一句测试问题（如“hello”或技术问题）。  
满足以下任意一项即可判定可用：

1. 正常收到回答
2. 回答里出现可点击的来源链接
3. 可以连续追问且保留上下文

### 第 6 步：开始日常使用

1. 直接提问
2. 或先选中代码，再使用 `发送到 Huge`

## 如何打开 `HUGE: Open Chat`

### 方式 A（推荐）：命令面板

1. 按 `Ctrl+Shift+P`（macOS: `Cmd+Shift+P`）
2. 输入 `HUGE`
3. 点击 `HUGE: Open Chat`

### 方式 B（备用）：活动栏图标

1. 看 VS Code 左侧活动栏
2. 点击 **HUGE** 图标（插件安装后会出现）
3. 打开后即可进入聊天面板

### 方式 C（备用）：编辑器标题按钮

1. 打开任意代码文件
2. 在编辑器右上角工具区找到 HUGE 图标/入口
3. 点击进入聊天

## 核心体验

- 历史会话自动保存，可随时搜索和切换
- 发送前可编辑内容，避免误发
- 登录状态异常时可一键重新 Setup
- 多张截图会自动合并后发送，减少上传失败

## 主要命令

- `HUGE: Open Chat`
- `HUGE: New Thread`
- `HUGE: Run Login Setup`
- `HUGE: Clear History`
- `发送到 Huge`

## 常用设置

- `hugeAiChat.defaultLanguage`：默认语言
- `hugeAiChat.maxThreads`：本地保留会话数量

## 常见问题排查

### 1) 命令不可用 / 搜索服务启动失败

常见提示：`command not found`、`not recognized as an internal or external command`、`ENOENT`

排查步骤：

1. 终端检查版本：`node -v`、`npm -v`、`npx -v`
2. 如未安装 Node.js，请先安装后重启 VS Code
3. Windows 建议执行一次全局安装：`npm i -g huge-ai-search`
4. 重新执行 `HUGE: Open Chat` 或 `HUGE: Run Login Setup`

### 2) 登录流程打不开 / 卡住

排查步骤：

1. 先点击聊天面板右上角 `浏览器查看`，尝试在浏览器中完成登录
2. 若仍不行，执行 `HUGE: Run Login Setup`
3. 确认本机可启动 Microsoft Edge
4. 关闭代理或切换网络后重试（公司网络/防火墙可能拦截）
5. 如仍失败，重启 VS Code 后再次执行 Setup

### 3) 一直提示网络错误 / 超时

排查步骤：

1. 确认可以访问 Google 相关站点
2. 检查系统代理与环境变量（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`）
3. 关闭冲突代理工具后重试
4. 重试前先执行 `HUGE: New Thread`

### 4) 来源链接为空或返回“无可验证记录”

这通常是检索侧暂时没有可验证来源，并非插件崩溃。  
可尝试：

1. 把问题改得更具体（加关键词、时间、对象）
2. 先问“请给可验证来源再回答”
3. 换一轮新会话后再问

### 5) 需要重置本地状态

1. 执行 `HUGE: Clear History`
2. 再执行 `HUGE: Run Login Setup`
3. 重启 VS Code 后重新进入 `HUGE: Open Chat`

## 隐私与说明

- 会话历史保存在 VS Code 本地存储中
- 回答中的来源链接可直接打开进行二次核验
- 当检索不到可验证来源时，模型可能返回“无可验证记录”

---

如果这个插件帮到了你，欢迎评分与反馈，帮助我们持续改进体验。
