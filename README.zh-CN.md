# Claude Code 的 Codex 插件

**[English](README.md)**

在 Claude Code 中使用 Codex 进行代码审查或将任务委派给 Codex。

本插件面向 Claude Code 用户，提供一种便捷方式，让你在现有工作流中轻松使用 Codex。

<video src="./docs/plugin-demo.webm" controls muted playsinline autoplay></video>

## 功能一览

- `/codex:review` — 常规只读 Codex 代码审查
- `/codex:adversarial-review` — 可引导的对抗性审查
- `/codex:rescue`、`/codex:status`、`/codex:result`、`/codex:cancel` — 委派任务和管理后台作业
- `/codex:observe` — 实时观察运行中的 Codex 任务，支持 ANSI 彩色输出

## 环境要求

- **ChatGPT 订阅（含免费版）或 OpenAI API Key。**
  - 使用量将计入你的 Codex 用量配额。[了解更多](https://developers.openai.com/codex/pricing)。
- **Node.js 18.18 或更高版本**

## 安装

在 Claude Code 中添加插件市场：

```bash
/plugin marketplace add dragon84867/codex-plugin-cc
```

安装插件：

```bash
/plugin install codex@dragon-cc-codex
```

重新加载插件：

```bash
/reload-plugins
```

然后运行：

```bash
/codex:setup
```

`/codex:setup` 会检测 Codex 是否就绪。如果 Codex 未安装且 npm 可用，它会提示你自动安装。

如果你想手动安装 Codex：

```bash
npm install -g @openai/codex
```

如果 Codex 已安装但尚未登录，运行：

```bash
!codex login
```

安装完成后，你应该能看到：

- 下方列出的斜杠命令
- `/agents` 中的 `codex:codex-rescue` 子代理

最简单的首次运行方式：

```bash
/codex:review --background
/codex:status
/codex:result
```

## 用法

### `/codex:review`

对当前代码运行常规的 Codex 审查。审查质量与直接在 Codex 中运行 `/review` 相同。

> [!NOTE]
> 多文件变更的代码审查可能耗时较长，通常建议在后台运行。

适用场景：

- 审查当前未提交的变更
- 审查当前分支与基础分支（如 `main`）的差异

使用 `--base <ref>` 进行分支对比审查。支持 `--wait` 和 `--background`。该命令不可引导，不接受自定义关注文本。如需针对特定决策或风险区域进行挑战，请使用 [`/codex:adversarial-review`](#codexadversarial-review)。

示例：

```bash
/codex:review
/codex:review --base main
/codex:review --background
```

该命令为只读，不会执行任何修改。在后台运行时，可使用 [`/codex:status`](#codexstatus) 查看进度，使用 [`/codex:cancel`](#codexcancel) 取消正在进行的任务。

### `/codex:adversarial-review`

运行**可引导的**对抗性审查，质疑所选实现和设计。

可用于压力测试假设、权衡取舍、故障模式，以及是否有更安全或更简单的替代方案。

使用与 `/codex:review` 相同的审查目标选择方式，包括 `--base <ref>` 进行分支审查。支持 `--wait` 和 `--background`。与 `/codex:review` 不同，它可以在标志后附加额外的关注文本。

适用场景：

- 发布前审查，挑战方向而不仅仅是代码细节
- 聚焦于设计选择、权衡、隐含假设和替代方案的审查
- 针对特定风险区域的压力测试，如认证、数据丢失、回滚、竞态条件或可靠性

示例：

```bash
/codex:adversarial-review
/codex:adversarial-review --base main challenge whether this was the right caching and retry design
/codex:adversarial-review --background look for race conditions and question the chosen approach
```

该命令为只读，不会修复代码。

### `/codex:rescue`

通过 `codex:codex-rescue` 子代理将任务交给 Codex。

适用场景：

- 调查 bug
- 尝试修复
- 继续之前的 Codex 任务
- 使用更小的模型进行更快或更经济的处理

> [!NOTE]
> 根据任务和所选模型的不同，这些任务可能耗时较长，通常建议在后台运行或将代理移至后台。

支持 `--background`、`--wait`、`--worktree`、`--resume` 和 `--fresh`。如果省略 `--resume` 和 `--fresh`，插件会提示是否继续该仓库最近的 rescue 线程。

**沙箱模式。** 任务模式会从你的 Codex 配置文件（`~/.codex/config.toml` 或 `.codex/config.toml`）中读取 `sandbox_mode`。如果未配置，则回退到 `workspace-write`（当设置了 `--write` 时）或 `read-only`。

示例：

```bash
/codex:rescue investigate why the tests started failing
/codex:rescue fix the failing test with the smallest safe patch
/codex:rescue --resume apply the top fix from the last run
/codex:rescue --model gpt-5.4-mini --effort medium investigate the flaky integration test
/codex:rescue --model spark fix the issue quickly
/codex:rescue --background investigate the regression
/codex:rescue --worktree investigate and fix the failing integration test
```

你也可以直接用自然语言将任务委派给 Codex：

```text
Ask Codex to redesign the database connection to be more resilient.
```

**说明：**

- 如果不传 `--model` 或 `--effort`，Codex 会自行选择默认值。
- 如果使用 `spark`，插件会映射到 `gpt-5.3-codex-spark`。
- 后续 rescue 请求可以继续该仓库中最近的 Codex 任务。
- `--worktree` 会在 `.claude/worktrees/<jobId>/` 下创建一个隔离的 git worktree，使用独立分支，让 Codex 在不影响你主工作目录的情况下工作。`--worktree` 和 `--resume` 互斥。

> [!WARNING]
> **线程独占性**：Codex 任务运行期间，不要在终端中手动对同一线程执行 `codex resume`。Codex 后端对每个线程强制执行单轮独占，尝试 resume 一个活跃线程会阻塞或暂停你的 CLI 会话。请等待任务完成（通过 `/codex:status` 查看），或先使用 `/codex:cancel` 停止任务。如需并行运行 Codex，请用 `codex`（不带 `--resume`）启动一个新线程。

### `/codex:status`

显示当前仓库中正在运行和近期的 Codex 作业。

示例：

```bash
/codex:status
/codex:status task-abc123
/codex:status --all
```

用途：

- 查看后台任务的进度
- 查看最近完成的作业
- 确认任务是否仍在运行

`--all` 会把列表扩展到其他 Claude Code 会话以及历史 state 目录里的作业（例如旧 plugin slug、`$TMPDIR/codex-companion/`）。如果你在新会话里需要找回旧会话启动的任务 id，用这个；其它带 id 的 slash command（`/codex:result`、`/codex:cancel`、`/codex:observe`）已经默认跨会话、跨 root。

### `/codex:result`

显示已完成作业的最终 Codex 输出。如果可用，还会包含 Codex 会话 ID，你可以通过 `codex resume <session-id>` 直接在 Codex 中重新打开该次运行。

示例：

```bash
/codex:result
/codex:result task-abc123
```

### `/codex:cancel`

取消正在运行的后台 Codex 作业。

示例：

```bash
/codex:cancel
/codex:cancel task-abc123
```

### `/codex:observe`

为运行中的 Codex 任务开启实时观察。以 ANSI 彩色输出显示工具调用、文件变更、命令执行、消息和推理过程。

观察器为**只读**模式，不会影响正在运行的 Codex 任务。按 `Ctrl+C` 可断开观察 — Codex 任务会继续运行。

**建议在单独的终端窗口中使用**，这样你可以在继续 Claude Code 会话的同时观察 Codex 的工作。

示例：

```bash
/codex:observe
/codex:observe task-abc123
/codex:observe --cwd /path/to/project
```

**颜色说明：**

| 颜色 | 事件类型 |
|------|---------|
| 青色 | 工具调用（`→ Read src/foo.ts`） |
| 蓝色 | 命令执行（`$ npm test`） |
| 绿色 | 成功（`exit 0`、`● completed`） |
| 红色 | 失败（`exit 1`） |
| 黄色 | 文件变更（`✎ src/auth.ts (modify)`） |
| 暗色 | 消息和推理 |

如果目标任务已完成，观察器会渲染完整的事件历史后立即退出。

### `/codex:setup`

检查 Codex 是否已安装并完成认证。如果 Codex 未安装且 npm 可用，它会提示你自动安装。

你也可以用 `/codex:setup` 管理可选的审查门控。

#### 启用审查门控

```bash
/codex:setup --enable-review-gate
/codex:setup --disable-review-gate
```

启用审查门控后，插件会使用 `Stop` 钩子对 Claude 的响应运行定向 Codex 审查。如果审查发现问题，停止操作会被阻止，让 Claude 先处理这些问题。

> [!WARNING]
> 审查门控可能会产生长时间运行的 Claude/Codex 循环，并快速消耗用量配额。仅在计划主动监控会话时启用。

## 典型工作流

### 发布前审查

```bash
/codex:review
```

### 将问题交给 Codex

```bash
/codex:rescue investigate why the build is failing in CI
```

### 启动长时间运行的任务

```bash
/codex:adversarial-review --background
/codex:rescue --background investigate the flaky test
```

### 实时观察 Codex 工作

在单独的终端中：

```bash
/codex:observe
```

这会给你一个实时、彩色的视图，显示 Codex 正在做什么 — 工具调用、文件编辑、测试运行和最终答案 — 而不会阻塞你的 Claude Code 会话。

### 使用 `--worktree` 隔离工作

```bash
/codex:rescue --worktree fix the broken auth middleware
```

Codex 在 `.claude/worktrees/<jobId>/` 的独立分支上工作，不会影响你的主工作目录。当你希望 Codex 进行修改但不影响当前分支时非常有用。

然后查看进度：

```bash
/codex:status
/codex:result
```

## Codex 集成

Codex 插件封装了 [Codex app server](https://developers.openai.com/codex/app-server)。它使用你环境中已安装的全局 `codex` 二进制文件，并[应用相同的配置](https://developers.openai.com/codex/config-basic)。

### 常用配置

如果你想修改插件使用的默认推理强度或默认模型，可以在用户级或项目级的 `config.toml` 中定义。例如，要在特定项目中始终使用 `gpt-5.4-mini` 并将强度设为 `high`，可以在你启动 Claude 的目录根下创建 `.codex/config.toml` 文件并添加：

```toml
model = "gpt-5.4-mini"
model_reasoning_effort = "high"
```

配置的加载顺序：

- 用户级配置：`~/.codex/config.toml`
- 项目级覆盖：`.codex/config.toml`
- 项目级覆盖仅在[项目被信任](https://developers.openai.com/codex/config-advanced#project-config-files-codexconfigtoml)时才会加载

更多[配置选项](https://developers.openai.com/codex/config-reference)请查阅 Codex 文档。

### 将工作转移到 Codex

委派的任务和任何[停止门控](#启用审查门控)运行也可以直接在 Codex 中恢复，只需运行 `codex resume`，并指定从 `/codex:result` 或 `/codex:status` 获取的会话 ID，或从列表中选择。

这样你可以审查 Codex 的工作或在那里继续工作。

## 开发

### Pre-push Hook

安装 git pre-push hook，在推送前验证发布质量：

```bash
npm run setup-hooks
```

Hook 在每次推送时检查：
- **版本必须 bump** — 插件源码改了但没 bump 版本则阻止推送
- **CHANGELOG 必须有对应条目** — 版本 bump 了但 CHANGELOG.md 没有匹配条目则阻止推送
- **README 更新提醒** — 版本 bump 了但没更新 README.md 则警告（不阻止）
- **Bump 类型校验** — 实际 bump 类型（major/minor/patch）与变更内容不匹配时警告

需要跳过时可用 `git push --no-verify`。

### 版本 Bump

```bash
node scripts/bump-version.mjs <version>
```

同步更新所有版本清单：`package.json`、`package-lock.json`、`plugin.json` 和 `marketplace.json`。

## 常见问题

### 使用此插件需要单独的 Codex 账号吗？

如果你已经在此机器上登录了 Codex，该账号应该可以直接使用。本插件使用你本地的 Codex CLI 认证状态。

如果你目前只使用 Claude Code 而从未使用过 Codex，你还需要使用 ChatGPT 账号或 API Key 登录 Codex。[Codex 可通过 ChatGPT 订阅使用](https://developers.openai.com/codex/pricing/)，[`codex login`](https://developers.openai.com/codex/cli/reference/#codex-login) 同时支持 ChatGPT 和 API Key 登录。运行 `/codex:setup` 检查 Codex 是否就绪，如果未就绪则使用 `!codex login`。

### 插件是否使用独立的 Codex 运行时？

不是。本插件通过你本地的 [Codex CLI](https://developers.openai.com/codex/cli/) 和同一台机器上的 [Codex app server](https://developers.openai.com/codex/app-server/) 进行委派。

这意味着：

- 使用与你直接使用相同的 Codex 安装
- 使用相同的本地认证状态
- 使用相同的仓库检出和本地机器环境

### 会使用我现有的 Codex 配置吗？

是的。如果你已经在使用 Codex，插件会读取相同的[配置](#常用配置)。

### 可以继续使用我现有的 API Key 或 Base URL 配置吗？

可以。由于插件使用你本地的 Codex CLI，你现有的登录方式和配置都会继续生效。

如果你需要将内置的 OpenAI Provider 指向不同的端点，请在 [Codex 配置](https://developers.openai.com/codex/config-advanced/#config-and-state-locations)中设置 `openai_base_url`。

### 作业的 state 存在哪里？

Job 记录、日志和事件流按 workspace 写入 state 目录。插件按下面顺序选根目录：

1. `$CLAUDE_PLUGIN_DATA/state/` —— Claude Code 通过 plugin host 调起 slash command 时会设置这个 env，存在时优先使用。
2. `~/.codex-companion/state/` —— HOME 锚定的稳定 fallback。env 未设置时（例如直接在 shell 里跑 `node codex-companion.mjs`）走这里。

每个 workspace 会在 root 下生成 `<basename>-<sha256(realpath)[:16]>/`（slug + 规范化路径哈希）目录，存 `state.json`、`<job>.json`、`<job>.log` 和 `<job>.events.jsonl`。

当你用 id 查作业（`/codex:status <id>`、`/codex:result <id>`、`/codex:cancel <id>`、`/codex:observe <id>`），插件还会顺带扫描历史位置：`$TMPDIR/codex-companion/`（更早的 fallback）以及所有 `~/.claude/plugins/data/codex-*/state/` 目录（兼容 marketplace 改名），所以升级前创建的旧 job 仍能找到。`/codex:status --all` 把这个跨 root 的视图扩展到无参数列表，并跳过 per-Claude-session 过滤 —— 这是新会话里捞回旧任务 id 的推荐方式。高级 env 开关 `CODEX_COMPANION_LEGACY_ROOTS`（路径分隔符隔开）可以显式替换历史扫描列表；设为空字符串则完全关闭历史扫描。普通用户不需要碰它。
