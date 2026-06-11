## ADDED Requirements

### Requirement: Status 输出展示 worktree 信息
`/codex:status` 的输出必须（SHALL）在 job 包含 worktree 信息时展示 worktree 路径和分支名。

#### Scenario: Status 展示进行中的 worktree 任务
- **WHEN** 用户执行 `/codex:status`，当前有一个进行中的 worktree 任务
- **THEN** 输出包含：
  ```
  Worktree:
    Path:   /repo/.claude/worktrees/task-abc123/
    Branch: codex-rescue/task-abc123-fix-bug
  ```

#### Scenario: Status 展示非 worktree 任务
- **WHEN** 用户执行 `/codex:status`，当前任务未使用 worktree
- **THEN** 输出不包含 worktree 相关字段（现有行为不变）

### Requirement: Result 输出展示 worktree 操作指引
`/codex:result` 的输出必须（SHALL）在 job 包含 worktree 信息时展示后续操作指引，包括 diff、merge、remove 命令示例。

#### Scenario: Result 展示完成后的 worktree 任务
- **WHEN** 用户执行 `/codex:result`，最近完成的 job 使用了 worktree
- **THEN** 输出末尾包含：
  ```
  Worktree:
    Path:   /repo/.claude/worktrees/task-abc123/
    Branch: codex-rescue/task-abc123-fix-bug

  Next steps:
    Diff:   git diff main...codex-rescue/task-abc123-fix-bug
    Merge:  git merge codex-rescue/task-abc123-fix-bug
    Remove: git worktree remove /repo/.claude/worktrees/task-abc123/
  ```

#### Scenario: Result 展示非 worktree 任务
- **WHEN** 用户执行 `/codex:result`，最近完成的 job 未使用 worktree
- **THEN** 输出不包含 worktree 相关字段（现有行为不变）

### Requirement: JSON 输出包含 worktree 字段
当使用 `--json` 标志时，status 和 result 的 JSON 输出必须（SHALL）包含 worktree 相关字段。

#### Scenario: JSON status 包含 worktree
- **WHEN** 用户执行 `/codex:status --json`，当前有 worktree 任务
- **THEN** JSON 输出包含 `worktreePath`、`worktreeBranch`、`worktreeBaseBranch` 字段

#### Scenario: JSON result 包含 worktree
- **WHEN** 用户执行 `/codex:result --json`，最近完成的 job 使用了 worktree
- **THEN** JSON 输出包含 `worktreePath`、`worktreeBranch`、`worktreeBaseBranch` 字段

### Requirement: 任务完成时输出 worktree 摘要
task 任务完成后，系统必须（SHALL）在输出末尾追加 worktree 摘要块。

#### Scenario: 前台任务完成后输出摘要
- **WHEN** 前台 worktree 任务执行完成
- **THEN** 输出末尾包含 worktree 路径、分支名和后续操作指引（同 Result 输出格式）

#### Scenario: 后台任务启动时输出 worktree 路径
- **WHEN** 后台 worktree 任务启动
- **THEN** 输出包含：
  ```
  Codex task started in worktree (background).
    Path:   /repo/.claude/worktrees/task-abc123/
    Branch: codex-rescue/task-abc123-fix-bug
  Check /codex:status for progress.
  ```
