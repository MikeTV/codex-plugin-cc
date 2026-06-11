## Context

当前 `/codex:rescue` 的 task 模式通过 `runAppServerTurn(workspaceRoot, ...)` 将 Codex app-server 的工作目录设为用户的源 repo。Codex 的改动直接作用于工作区，用户无法在隔离环境中 review 或大胆尝试。

git worktree 是 git 原生支持的隔离工作目录机制，创建一个 worktree 只需 `git worktree add <path> -b <branch>`，工作目录包含完整的工作树快照，共享 `.git` 对象库。

Codex app-server 的 `thread/start` 接受 `cwd` 参数，传入 worktree 路径即可让 Codex 在隔离目录中工作，Codex 侧无需任何改动。

## Goals / Non-Goals

**Goals:**

- 用户通过 `--worktree` 标志让 Codex 在隔离的 git worktree 中执行任务
- 改动自动落在独立分支上，用户可通过 `git diff` / `git merge` 管理
- 支持 `--background` 后台模式
- `/codex:status` 和 `/codex:result` 展示 worktree 路径和操作指引

**Non-Goals:**

- 不做自动清理（用户决定何时 merge 或 remove）
- 不做 worktree 与 `--resume-last` 的兼容（worktree 是全新隔离环境）
- 不做 review 命令的 worktree 支持（review 是只读操作，不需要隔离）
- 不做跨多个 worktree 的并行任务管理

## Decisions

### 1. worktree 路径选择

**决策**: 使用 `<repo>/.claude/worktrees/<jobId>/` 作为 worktree 路径。

**理由**:
- 项目 `tests/git.test.mjs` 中已有 `.claude/worktrees/agent-test` 的约定，保持一致
- 路径与 repo 关联，容易找到
- 可通过 `.gitignore` 排除（如果用户需要）

**备选方案**:
- `/tmp/codex-wt-<jobId>/` — 临时目录可能被系统清理，不够可靠
- `../codex-wt-<jobId>/` — 不一定有写权限

### 2. 分支命名策略

**决策**: 分支名格式为 `codex-rescue/<jobId>-<short-prompt>`，其中 `<short-prompt>` 取 prompt 前 32 字符（去特殊字符）。

**理由**:
- 带 jobId 保证唯一性
- 带 prompt 摘要方便识别任务目的
- `codex-rescue/` 前缀表明来源，便于批量清理

**备选方案**:
- 纯 jobId（如 `codex-rescue-task-abc123`）— 缺少上下文
- 纯时间戳（如 `codex-rescue-20260520-1430`）— 不够直观

### 3. workspaceRoot 与 codexCwd 分离

**决策**: task request 中新增 `worktreePath` 字段。`executeTaskRun` 中：
- `workspaceRoot = resolveWorkspaceRoot(request.cwd)` — 源 repo，用于 state/config
- `codexCwd = request.worktreePath ?? workspaceRoot` — 传给 Codex 的工作目录

**理由**:
- state 目录（job record、log file）必须存在源 repo，否则 `/codex:status` 找不到 job
- sandbox_mode 配置从源 repo 读取（worktree 里可能没有 `.codex/config.toml`）
- Codex 在 worktree 里工作，改动隔离

### 4. 后台模式（--background）兼容性

**决策**: worktree 在 `handleTask` 中创建（前台），然后将 `worktreePath` 写入 job record 的 request。`task-worker` 子进程从 job record 读取 `worktreePath`，直接使用。

**理由**:
- worktree 创建必须在主进程完成（需要 git 操作）
- 后台 worker 直接使用已创建的路径，避免重复创建

### 5. 输出格式

**决策**: 完成后的输出增加 worktree 信息块：

```
Codex task completed in worktree.
  Path:   /path/to/.claude/worktrees/task-abc123/
  Branch: codex-rescue/task-abc123-fix-auth-bug

Next steps:
  Diff:   git diff main...codex-rescue/task-abc123-fix-auth-bug
  Merge:  git merge codex-rescue/task-abc123-fix-auth-bug
  Remove: git worktree remove /path/to/.claude/worktrees/task-abc123/
```

**理由**:
- 用户需要明确知道 worktree 在哪、怎么操作
- 提供常用命令示例，降低使用门槛

## Risks / Trade-offs

**[Risk] worktree 创建失败** → 回退到非 worktree 模式，输出错误信息并询问用户是否继续

**[Risk] worktree 路径已存在** → 检查是否属于当前 job，如果是则复用，否则报错

**[Risk] 用户忘记清理 worktree** → 不自动清理，但在 `/codex:status` 中展示未清理的 worktree 列表（后续可扩展 `/codex:cleanup` 命令）

**[Trade-off] worktree 占用磁盘空间** → 接受此代价，因为用户需要时间 review 改动。可通过 `.claude/worktrees/` 目录大小提醒用户

**[Trade-off] `--worktree` 与 `--resume-last` 互斥** → 简化实现，避免复杂的线程迁移逻辑。用户如果需要继续上次的工作，应该在源 repo 中 resume，而不是在新 worktree 中
