## 1. Worktree 生命周期管理

- [x] 1.1 在 `plugins/codex/scripts/lib/workspace.mjs` 中新增 `createWorktree(sourceRoot, jobId, prompt)` 函数，执行 `git worktree add <path> -b <branch>`，返回 `{ worktreePath, worktreeBranch, worktreeBaseBranch }`
- [x] 1.2 新增 `generateWorktreeBranch(jobId, prompt)` 辅助函数，生成 `codex-rescue/<jobId>-<short-prompt>` 格式的分支名
- [x] 1.3 新增 `resolveWorktreePath(sourceRoot, jobId)` 辅助函数，返回 `<sourceRoot>/.claude/worktrees/<jobId>/`
- [x] 1.4 编写 worktree 生命周期单元测试，覆盖路径生成、分支命名、创建成功/失败场景

## 2. Task 命令集成

- [x] 2.1 在 `plugins/codex/scripts/codex-companion.mjs` 的 `handleTask` 函数中解析 `--worktree` 布尔标志
- [x] 2.2 在 `handleTask` 中增加 `--worktree` 与 `--resume-last`/`--resume` 的互斥校验
- [x] 2.3 在 `buildTaskRequest` 中新增 `worktreePath` 参数
- [x] 2.4 在 `buildTaskJob` 中新增 worktree 相关字段（worktreePath、worktreeBranch、worktreeBaseBranch）
- [x] 2.5 在 `handleTask` 的 background 分支中，先创建 worktree 再写入 job record

## 3. 执行流程分离

- [x] 3.1 修改 `executeTaskRun`，在 `request.worktreePath` 存在时将其作为 `runAppServerTurn` 的 cwd 参数
- [x] 3.2 确保 `resolveCodexSandboxMode` 从源 repo（workspaceRoot）读取配置，而非 worktree 路径
- [x] 3.3 修改 `handleTaskWorker`，从 job record 的 request 中读取 `worktreePath` 并传递给 `executeTaskRun`
- [ ] 3.4 编写 task 执行流程集成测试，覆盖前台/后台模式下的 worktree 任务

## 4. Job Record 扩展

- [x] 4.1 在 `plugins/codex/scripts/lib/state.mjs` 的 `createJobRecord` 或 `createCompanionJob` 中支持 worktreePath、worktreeBranch、worktreeBaseBranch 字段
- [x] 4.2 确保 job record 的 JSON 序列化包含 worktree 字段

## 5. 输出展示

- [x] 5.1 在 `plugins/codex/scripts/lib/render.mjs` 中新增 `renderWorktreesBlock(meta)` 函数
- [x] 5.2 修改 `renderTaskResult`，在 job 包含 worktree 信息时追加 worktree 摘要块（含 diff/merge/remove 命令示例）
- [x] 5.3 修改 `renderQueuedTaskLaunch`，在后台 worktree 任务启动时输出 worktree 路径和分支名
- [x] 5.4 修改 `renderJobStatusReport`（/codex:status），在 job 包含 worktree 信息时展示 worktree 路径和分支名
- [x] 5.5 修改 `renderStoredJobResult`（/codex:result），在 job 包含 worktree 信息时展示后续操作指引
- [x] 5.6 确保 `--json` 输出包含 worktree 字段
- [x] 5.7 编写输出格式测试，覆盖 worktree 信息块的渲染

## 6. 命令文档更新

- [x] 6.1 更新 `plugins/codex/commands/rescue.md`，在 argument-hint 和描述中增加 `--worktree` 参数说明
- [x] 6.2 更新 `plugins/codex/agents/codex-rescue.md`，增加 `--worktree` 标志的识别和透传规则
