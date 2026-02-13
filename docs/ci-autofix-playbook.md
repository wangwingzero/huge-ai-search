![1770941478350](image/ci-autofix-playbook/1770941478350.png)# AI 自动修复 CI 通用实战手册

适用目标：任何 GitHub 项目在 CI 失败时，自动尝试修复并创建 PR，减少人工排错时间。

## 1. 标准化落地文件

每个项目统一放这两类文件：

1. `.github/workflows/ci-auto-fix.yml`
2. `.github/scripts/auto_fix.py`

建议把这两个文件作为你的“组织标准模板”，新项目直接复制，再改参数。

## 2. 一次性前置配置（每个仓库都要做）

### 2.1 配置仓库 Secrets

至少配置以下之一：

1. `CODEX_API_KEY`
2. `OPENAI_API_KEY`

可选：

1. `CODEX_API_ENDPOINT`（你有 API 中转时配置）

### 2.2 配置 GitHub Actions 权限

仓库设置里开启：

1. `Settings -> Actions -> General -> Workflow permissions -> Read and write permissions`
2. 勾选 `Allow GitHub Actions to create and approve pull requests`

否则自动 PR 会报权限错误。

## 3. 触发与执行逻辑

当前模板支持：

1. `push` 到 `main`
2. `pull_request` 到 `main`
3. `workflow_dispatch` 手动触发
4. `workflow_call` 作为复用工作流被其他工作流调用

执行顺序：

1. 先跑校验命令（默认 `npm run build`）
2. 失败才进入自动修复循环
3. 每轮：读日志 -> 生成 patch -> `git apply --check/--3way` -> 复测
4. 修复成功且有改动 -> 自动建 PR

## 4. 参数建议（跨项目统一策略）

推荐按风险等级配置：

1. `AUTO_FIX_MAX_ATTEMPTS=2~3`
2. `AUTO_FIX_MAX_FILES=5~10`
3. `AUTO_FIX_MAX_CHANGED_LINES=200~400`
4. `AUTO_FIX_ALLOWED_REGEX` 只允许 `src/`、测试目录和必要配置文件

不要一开始就放开到全仓库写权限。

## 5. 建议的分层上线策略

### 第 1 阶段（建议先这样）

1. 只处理构建/测试失败
2. 仅允许改动源码和依赖配置
3. 只创建 PR，不自动合并

### 第 2 阶段

1. 扩展到 lint/typecheck
2. 引入更严格的路径白名单
3. 增加 diff 预算告警

### 第 3 阶段（谨慎）

1. 扩展到多命令流水线（lint + test + build）
2. 按子项目分治（monorepo 按路径拆 workflow）

## 6. 推荐命令配置方式

### 6.1 Node 项目

1. `install_command`: `npm ci`
2. `validation_command`: `npm test && npm run build`

### 6.2 Python 项目

1. `install_command`: `pip install -r requirements.txt`
2. `validation_command`: `pytest -q`

### 6.3 Monorepo 项目

1. 在 caller workflow 里按路径触发
2. 对不同目录调用 `workflow_call` 并传不同命令

## 7. 常见坑与规避

1. 使用 PAT 直接 push 导致循环触发：优先 `GITHUB_TOKEN`，并保留 `[skip ci]`。
2. 白名单过宽导致改动失控：先小范围，后扩展。
3. 只截取少量日志导致模型误判：保留完整失败上下文或至少足够日志尾部。
4. 没有复测就提交：必须“复测通过才建 PR”。
5. 直接推 main：统一改成“自动 PR + 人工审批”。

## 8. 未来所有项目复用 SOP（建议直接照做）

1. 复制 `.github/workflows/ci-auto-fix.yml`
2. 复制 `.github/scripts/auto_fix.py`
3. 改 `AUTO_FIX_ALLOWED_REGEX` 为项目白名单
4. 改 `AUTO_FIX_COMMAND` 为项目 CI 核心命令
5. 配置仓库 Secrets 与 Actions 权限
6. 手动触发 `workflow_dispatch` 做一次演练
7. 人工制造一个可修复错误验证是否自动建 PR

## 9. workflow_call 复用示例

在另一个 workflow 调用：

```yaml
jobs:
  auto-fix:
    uses: your-org/your-repo/.github/workflows/ci-auto-fix.yml@main
    with:
      install_command: npm ci
      validation_command: npm test && npm run build
      max_attempts: 3
      max_files: 8
      max_changed_lines: 300
      allowed_regex: "^(src/|tests/|package\\.json|package-lock\\.json|tsconfig\\.json)$"
      codex_model: gpt-5-codex
    secrets:
      CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}
      CODEX_API_ENDPOINT: ${{ secrets.CODEX_API_ENDPOINT }}
```

## 10. 经验结论

最有效的策略不是“让 AI 全自动接管”，而是：

1. 用强约束让它只能在低风险范围修
2. 用 CI 复测作为唯一验收标准
3. 用 PR 审核做最终人类把关

这样才能长期稳定地在所有项目复用。
