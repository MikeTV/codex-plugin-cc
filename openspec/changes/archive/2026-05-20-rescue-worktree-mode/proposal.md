## Why

当前 `/codex:rescue` (task 模式) 在用户的当前工作目录里直接运行 Codex，所有改动直接作用于工作区。当 Codex 需要修复 bug 或重构代码时，用户无法隔离地 review 改动，也无法在不影响主分支的情况下让 Codex 大胆尝试。增加 `--worktree` 模式，让 Codex 在隔离的 git worktree 中工作，改动落在独立分支上，用户 review 后再决定是否 merge。

## What Changes

- task 子命令新增 `--worktree` 标志，启用后在临时目录创建 git worktree 并建立独立分支
- 插件自动创建 worktree（`git worktree add <path> -b <branch>`），将 worktree 路径作为 Codex 的工作目录
- job record 新增 `worktreePath` 和 `worktreeBranch` 字段，追踪 worktree 的生命周期
- `/codex:status` 和 `/codex:result` 输出中展示 worktree 路径、分支名和后续操作指引
- 完成后不自动清理 worktree，由用户决定 merge 或 remove
- `--worktree` 与 `--resume-last` 互斥（worktree 是全新隔离环境，不支持 resume 旧线程）

## Capabilities

### New Capabilities

- `worktree-lifecycle`: 覆盖 worktree 的创建、路径解析、分支管理、状态追踪。包括在 temp 目录创建 worktree、生成唯一分支名、记录到 job record。
- `worktree-task-dispatch`: 覆盖 task 模式下 worktree 的执行流程。将 workspaceRoot（源 repo）与 codexCwd（worktree 路径）分离，确保 state/config 从源 repo 读取，Codex 在 worktree 中工作。
- `worktree-output`: 覆盖 worktree 相关信息的展示。包括 `/codex:status`、`/codex:result` 中的 worktree 路径和分支信息，以及完成后的操作指引（diff、merge、remove 命令示例）。

### Modified Capabilities

（无现有 spec 需要修改）

## Impact

- `plugins/codex/scripts/codex-companion.mjs`: task 子命令解析 `--worktree` 参数，调用 worktree 创建逻辑，分离 workspaceRoot 和 codexCwd
- `plugins/codex/scripts/lib/workspace.mjs`: 新增 worktree 创建和管理函数
- `plugins/codex/scripts/lib/codex.mjs`: `runAppServerTurn` 接收 codexCwd 参数（与 workspaceRoot 分离）
- `plugins/codex/scripts/lib/state.mjs`: job record 结构新增 worktreePath 和 worktreeBranch 字段
- `plugins/codex/scripts/lib/render.mjs`: status/result 输出增加 worktree 信息
- `plugins/codex/commands/rescue.md`: 命令文档增加 `--worktree` 参数说明
- `plugins/codex/agents/codex-rescue.md`: subagent 指令增加 `--worktree` 标志的识别和透传
- 依赖: 需要 git 支持 worktree 命令（git >= 2.5）
