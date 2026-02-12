# CI 自动修复上线检查清单

## A. 文件就位

1. 已存在 `.github/workflows/ci-auto-fix.yml`
2. 已存在 `.github/scripts/auto_fix.py`

## B. 密钥与权限

1. 已配置 `CODEX_API_KEY` 或 `OPENAI_API_KEY`
2. 如有中转，已配置 `CODEX_API_ENDPOINT`
3. Actions 权限已设置为 `Read and write permissions`
4. 已允许 Actions 创建 PR

## C. 参数审查

1. `AUTO_FIX_COMMAND` 已改成项目真实校验命令
2. `AUTO_FIX_ALLOWED_REGEX` 已限制在安全范围
3. `AUTO_FIX_MAX_ATTEMPTS` <= 3
4. `AUTO_FIX_MAX_FILES` 与 `AUTO_FIX_MAX_CHANGED_LINES` 已设置

## D. 演练验证

1. 手动触发 `workflow_dispatch` 能跑通
2. 人工制造一个小错误，验证自动修复流程
3. 修复成功时会自动建 PR
4. 修复失败时不会写入主分支

## E. 团队约定

1. 自动修复 PR 必须走人工审核
2. 禁止自动修复直接合并主分支
3. 每月审查一次白名单与预算配置
