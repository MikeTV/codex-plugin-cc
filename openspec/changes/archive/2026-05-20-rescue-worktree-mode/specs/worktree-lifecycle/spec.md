## ADDED Requirements

### Requirement: Worktree 路径生成
系统必须（SHALL）根据 jobId 生成唯一的 worktree 路径，格式为 `<repo>/.claude/worktrees/<jobId>/`。

#### Scenario: 生成 worktree 路径
- **WHEN** 系统需要为 jobId 为 `task-abc123` 的任务创建 worktree
- **THEN** 生成的路径为 `<repo>/.claude/worktrees/task-abc123/`

### Requirement: Worktree 分支命名
系统必须（SHALL）生成唯一的分支名，格式为 `codex-rescue/<jobId>-<short-prompt>`，其中 `<short-prompt>` 取 prompt 前 32 字符（去特殊字符，转 kebab-case）。

#### Scenario: 生成带 prompt 的分支名
- **WHEN** jobId 为 `task-abc123`，prompt 为 `Fix the authentication bug in login handler`
- **THEN** 分支名为 `codex-rescue/task-abc123-fix-the-authentication-bu`

#### Scenario: 生成无 prompt 的分支名
- **WHEN** jobId 为 `task-abc123`，prompt 为空
- **THEN** 分支名为 `codex-rescue/task-abc123`

### Requirement: Worktree 创建
系统必须（SHALL）使用 `git worktree add <path> -b <branch>` 创建 worktree，基于源 repo 的当前 HEAD。

#### Scenario: 成功创建 worktree
- **WHEN** 系统在 `/repo` 目录下为 jobId `task-abc123` 创建 worktree
- **THEN** 执行 `git worktree add /repo/.claude/worktrees/task-abc123/ -b codex-rescue/task-abc123-...`
- **THEN** worktree 目录存在且包含完整工作树
- **THEN** 分支 `codex-rescue/task-abc123-...` 存在于本地分支列表

#### Scenario: Worktree 路径已存在且属于当前 job
- **WHEN** worktree 路径已存在，且 job record 中的 worktreePath 匹配该路径
- **THEN** 复用现有 worktree，不重新创建

#### Scenario: Worktree 路径已存在但不属于当前 job
- **WHEN** worktree 路径已存在，但 job record 中的 worktreePath 不匹配
- **THEN** 抛出错误，提示用户手动清理或选择其他 jobId

### Requirement: Worktree 基础分支记录
系统必须（SHALL）在 job record 中记录创建 worktree 时的基础分支（baseBranch），用于后续 diff 展示。

#### Scenario: 记录基础分支
- **WHEN** 系统从 `main` 分支创建 worktree
- **THEN** job record 的 `worktreeBaseBranch` 字段为 `main`
