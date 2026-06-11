## ADDED Requirements

### Requirement: Task 命令接受 --worktree 标志
`/codex:rescue` 命令必须（SHALL）接受 `--worktree` 布尔标志，启用后在 git worktree 中执行任务。

#### Scenario: 使用 --worktree 标志
- **WHEN** 用户执行 `/codex:rescue --worktree fix the bug`
- **THEN** 系统创建 git worktree 并在其中执行 Codex 任务

#### Scenario: 不使用 --worktree 标志
- **WHEN** 用户执行 `/codex:rescue fix the bug`
- **THEN** 系统在源 repo 的工作目录中直接执行（现有行为不变）

### Requirement: --worktree 与 --resume-last 互斥
当同时指定 `--worktree` 和 `--resume-last`（或 `--resume`）时，系统必须（SHALL）拒绝执行并报错。

#### Scenario: 同时指定 --worktree 和 --resume-last
- **WHEN** 用户执行 `/codex:rescue --worktree --resume-last`
- **THEN** 系统输出错误信息 `--worktree and --resume-last are mutually exclusive`
- **THEN** 任务不执行

#### Scenario: 同时指定 --worktree 和 --resume
- **WHEN** 用户执行 `/codex:rescue --worktree --resume`
- **THEN** 系统输出错误信息 `--worktree and --resume are mutually exclusive`
- **THEN** 任务不执行

### Requirement: workspaceRoot 与 codexCwd 分离
当启用 `--worktree` 时，系统必须（SHALL）将 workspaceRoot（源 repo）与 codexCwd（worktree 路径）分离。

#### Scenario: Worktree 模式下分离路径
- **WHEN** 启用 `--worktree`，worktree 路径为 `/repo/.claude/worktrees/task-abc123/`
- **THEN** workspaceRoot 为源 repo 路径（用于 state 存储和 config 读取）
- **THEN** codexCwd 为 worktree 路径（传给 Codex 作为工作目录）
- **THEN** job record 存储在源 repo 的 state 目录中
- **THEN** sandbox_mode 从源 repo 的 `.codex/config.toml` 或 `~/.codex/config.toml` 读取

#### Scenario: 非 Worktree 模式下路径一致
- **WHEN** 未启用 `--worktree`
- **THEN** workspaceRoot 和 codexCwd 均为源 repo 路径（现有行为不变）

### Requirement: Worktree 信息存入 job record
系统必须（SHALL）在 job record 中记录 `worktreePath`、`worktreeBranch` 和 `worktreeBaseBranch` 字段。

#### Scenario: 记录 worktree 信息
- **WHEN** 系统在 `/repo/.claude/worktrees/task-abc123/` 创建 worktree，分支为 `codex-rescue/task-abc123-fix-bug`，基础分支为 `main`
- **THEN** job record 包含：
  - `worktreePath: "/repo/.claude/worktrees/task-abc123/"`
  - `worktreeBranch: "codex-rescue/task-abc123-fix-bug"`
  - `worktreeBaseBranch: "main"`

### Requirement: 后台模式支持 --worktree
系统必须（SHALL）支持 `--worktree --background` 组合，worktree 在前台创建，后台 worker 使用已创建的路径。

#### Scenario: 后台模式 + worktree
- **WHEN** 用户执行 `/codex:rescue --worktree --background fix the bug`
- **THEN** 系统在前台创建 worktree
- **THEN** 将 worktreePath 写入 job record 的 request 字段
- **THEN** 启动后台 worker 进程
- **THEN** worker 从 job record 读取 worktreePath，直接在该路径下执行 Codex 任务

### Requirement: Task request 传递 worktreePath
`buildTaskRequest` 函数必须（SHALL）接受 `worktreePath` 参数并写入 request 对象。

#### Scenario: Request 包含 worktreePath
- **WHEN** 调用 `buildTaskRequest({ cwd, model, effort, prompt, write, resumeLast, jobId, worktreePath: "/path/to/wt" })`
- **THEN** 返回的 request 对象包含 `worktreePath: "/path/to/wt"`

### Requirement: executeTaskRun 使用 worktreePath
`executeTaskRun` 函数必须（SHALL）在 `request.worktreePath` 存在时，将其作为 Codex 的工作目录。

#### Scenario: 使用 worktreePath 作为 Codex 工作目录
- **WHEN** `request.worktreePath` 为 `/repo/.claude/worktrees/task-abc123/`
- **THEN** `runAppServerTurn` 的第一个参数为 `/repo/.claude/worktrees/task-abc123/`
- **THEN** Codex 在该 worktree 中执行任务
