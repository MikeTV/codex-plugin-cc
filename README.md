# Codex plugin for Claude Code

**[中文文档](README.zh-CN.md)**

Use Codex from inside Claude Code for code reviews or to delegate tasks to Codex.

This plugin is for Claude Code users who want an easy way to start using Codex from the workflow
they already have.

<video src="./docs/plugin-demo.webm" controls muted playsinline autoplay></video>

## What You Get

- `/codex:review` for a normal read-only Codex review
- `/codex:adversarial-review` for a steerable challenge review
- `/codex:rescue`, `/codex:status`, `/codex:result`, and `/codex:cancel` to delegate work and manage background jobs
- `/codex:observe` for real-time live observation of running Codex tasks with ANSI color output

## Requirements

- **ChatGPT subscription (incl. Free) or OpenAI API key.**
  - Usage will contribute to your Codex usage limits. [Learn more](https://developers.openai.com/codex/pricing).
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add dragon84867/codex-plugin-cc
```

Install the plugin:

```bash
/plugin install codex@dragon-cc-codex
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/codex:setup
```

`/codex:setup` will tell you whether Codex is ready. If Codex is missing and npm is available, it can offer to install Codex for you.

If you prefer to install Codex yourself, use:

```bash
npm install -g @openai/codex
```

If Codex is installed but not logged in yet, run:

```bash
!codex login
```

After install, you should see:

- the slash commands listed below
- the `codex:codex-rescue` subagent in `/agents`

One simple first run is:

```bash
/codex:review --background
/codex:status
/codex:result
```

## Usage

### `/codex:review`

Runs a normal Codex review on your current work. It gives you the same quality of code review as running `/review` inside Codex directly.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/codex:adversarial-review`](#codexadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/codex:review
/codex:review --base main
/codex:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/codex:status`](#codexstatus) to check on the progress and [`/codex:cancel`](#codexcancel) to cancel the ongoing task.

### `/codex:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/codex:review`, including `--base <ref>` for branch review.
It also supports `--wait` and `--background`. Unlike `/codex:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/codex:adversarial-review
/codex:adversarial-review --base main challenge whether this was the right caching and retry design
/codex:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/codex:rescue`

Hands a task to Codex through the `codex:codex-rescue` subagent.

Use it when you want Codex to:

- investigate a bug
- try a fix
- continue a previous Codex task
- take a faster or cheaper pass with a smaller model

> [!NOTE]
> Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, `--worktree`, `--resume`, and `--fresh`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest rescue thread for this repo.

**Sandbox mode.** Task mode reads `sandbox_mode` from your Codex config (`~/.codex/config.toml` or `.codex/config.toml`). If not configured, it falls back to `workspace-write` (when `--write` is set) or `read-only`.

Examples:

```bash
/codex:rescue investigate why the tests started failing
/codex:rescue fix the failing test with the smallest safe patch
/codex:rescue --resume apply the top fix from the last run
/codex:rescue --model gpt-5.4-mini --effort medium investigate the flaky integration test
/codex:rescue --model spark fix the issue quickly
/codex:rescue --background investigate the regression
/codex:rescue --worktree investigate and fix the failing integration test
```

You can also just ask for a task to be delegated to Codex:

```text
Ask Codex to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model` or `--effort`, Codex chooses its own defaults.
- if you say `spark`, the plugin maps that to `gpt-5.3-codex-spark`
- follow-up rescue requests can continue the latest Codex task in the repo
- `--worktree` creates an isolated git worktree under `.claude/worktrees/<jobId>/` on a dedicated branch so Codex can work without touching your main working directory. `--worktree` and `--resume` are mutually exclusive.

> [!WARNING]
> **Thread exclusivity**: While a Codex task is running, do not manually run `codex resume` on the same thread from a terminal. The Codex backend enforces single-turn exclusivity per thread, and attempting to resume an active thread will block or pause your CLI session. Wait for the task to complete (check `/codex:status`), or use `/codex:cancel` to stop the task first. If you need to run Codex in parallel, start a fresh thread with `codex` (without `--resume`).

### `/codex:status`

Shows running and recent Codex jobs for the current repository.

Examples:

```bash
/codex:status
/codex:status task-abc123
/codex:status --all
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

`--all` widens the listing to include jobs created in other Claude Code sessions and in legacy state directories (e.g., earlier plugin slugs, `$TMPDIR/codex-companion/`). Use it to recover the id of a task you started in an earlier session — by id, every other slash command (`/codex:result`, `/codex:cancel`, `/codex:observe`) already works across sessions and roots.

### `/codex:result`

Shows the final stored Codex output for a finished job.
When available, it also includes the Codex session ID so you can reopen that run directly in Codex with `codex resume <session-id>`.

Examples:

```bash
/codex:result
/codex:result task-abc123
```

### `/codex:cancel`

Cancels an active background Codex job.

Examples:

```bash
/codex:cancel
/codex:cancel task-abc123
```

### `/codex:observe`

Opens a real-time live observer for a running Codex job. Shows tool calls, file changes, commands, messages, and reasoning with ANSI color output.

The observer is **read-only** and does not affect the running Codex task. Press `Ctrl+C` to detach — the Codex task continues running.

**Auto-spawn (1.3.0+):** when invoked from inside a supported terminal, `/codex:observe` opens the observer in a new pane / window automatically — no copy-paste required. Detection precedence is `tmux > Ghostty > iTerm2 > none`:

- **Inside tmux** — `tmux split-window -h -c <workspace>` opens a vertical split running the observer.
- **Inside Ghostty on macOS** (1.4.0+) — opens a new Ghostty window via AppleScript and feeds the observer command into it. Always opens a new window because Ghostty 1.3's terminal object exposes no `tty` property to target the calling session reliably.
- **Inside iTerm2 on macOS** (1.4.0+) — discovers the calling shell's tty by walking the process ancestry and splits *that* session vertically (`split vertically with default profile`). When no matching session is found (different window, sandboxed shell, etc.), opens a new iTerm2 window instead of splitting an unrelated front window.
- **First run on macOS** triggers the standard Automation permission prompt (System Settings → Privacy & Security → Automation). The plugin recognises the permission-denied error and prints a one-line "grant access and retry" hint instead of the generic copy-paste fallback.
- **Outside any supported terminal** — the slash command prints the exact `node /path/to/companion.mjs observe …` invocation for you to paste into a separate terminal yourself.

Examples:

```bash
/codex:observe
/codex:observe task-abc123
/codex:observe --cwd /path/to/project
```

**Color legend:**

| Color | Event Type |
|-------|-----------|
| Cyan | Tool calls (`→ Read src/foo.ts`) |
| Blue | Commands (`$ npm test`) |
| Green | Success (`exit 0`, `● completed`) |
| Red | Failure (`exit 1`) |
| Yellow | File changes (`✎ src/auth.ts (modify)`) |
| Dim | Messages and reasoning |

If the target job is already completed, the observer renders the full event history and exits immediately.

### `/codex:setup`

Checks whether Codex is installed and authenticated.
If Codex is missing and npm is available, it can offer to install Codex for you.

You can also use `/codex:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/codex:setup --enable-review-gate
/codex:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Codex review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Codex loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/codex:review
```

### Hand A Problem To Codex

```bash
/codex:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/codex:adversarial-review --background
/codex:rescue --background investigate the flaky test
```

### Watch Codex Work in Real-Time

In a separate terminal:

```bash
/codex:observe
```

This gives you a live, color-coded view of what Codex is doing — tool calls, file edits, test runs, and its final answer — without blocking your Claude Code session.

### Isolated Work With `--worktree`

```bash
/codex:rescue --worktree fix the broken auth middleware
```

Codex works in `.claude/worktrees/<jobId>/` on a separate branch, leaving your main working directory untouched. This is useful when you want Codex to make changes without affecting your current branch.

Then check in with:

```bash
/codex:status
/codex:result
```

## Codex Integration

The Codex plugin wraps the [Codex app server](https://developers.openai.com/codex/app-server). It uses the global `codex` binary installed in your environment and [applies the same configuration](https://developers.openai.com/codex/config-basic).

### Common Configurations

If you want to change the default reasoning effort or the default model that gets used by the plugin, you can define that inside your user-level or project-level `config.toml`. For example to always use `gpt-5.4-mini` on `high` for a specific project you can add the following to a `.codex/config.toml` file at the root of the directory you started Claude in:

```toml
model = "gpt-5.4-mini"
model_reasoning_effort = "high"
```

Your configuration will be picked up based on:

- user-level config in `~/.codex/config.toml`
- project-level overrides in `.codex/config.toml`
- project-level overrides only load when the [project is trusted](https://developers.openai.com/codex/config-advanced#project-config-files-codexconfigtoml)

Check out the Codex docs for more [configuration options](https://developers.openai.com/codex/config-reference).

### Moving The Work Over To Codex

Delegated tasks and any [stop gate](#what-does-the-review-gate-do) run can also be directly resumed inside Codex by running `codex resume` either with the specific session ID you received from running `/codex:result` or `/codex:status` or by selecting it from the list.

This way you can review the Codex work or continue the work there.

## Development

### Pre-push Hook

Install the git pre-push hook to validate releases before pushing:

```bash
npm run setup-hooks
```

The hook checks every push for:
- **Version bump required** — blocks if plugin source files changed without a version bump
- **CHANGELOG entry required** — blocks if version was bumped but CHANGELOG.md has no matching entry
- **README update warning** — warns if version was bumped without updating README.md
- **Bump type validation** — warns if the actual bump (major/minor/patch) doesn't match what the changes suggest

Bypass with `git push --no-verify` if needed.

### Version Bumping

```bash
node scripts/bump-version.mjs <version>
```

Updates all version manifests: `package.json`, `package-lock.json`, `plugin.json`, and `marketplace.json`.

## FAQ

### Do I need a separate Codex account for this plugin?

If you are already signed into Codex on this machine, that account should work immediately here too. This plugin uses your local Codex CLI authentication.

If you only use Claude Code today and have not used Codex yet, you will also need to sign in to Codex with either a ChatGPT account or an API key. [Codex is available with your ChatGPT subscription](https://developers.openai.com/codex/pricing/), and [`codex login`](https://developers.openai.com/codex/cli/reference/#codex-login) supports both ChatGPT and API key sign-in. Run `/codex:setup` to check whether Codex is ready, and use `!codex login` if it is not.

### Does the plugin use a separate Codex runtime?

No. This plugin delegates through your local [Codex CLI](https://developers.openai.com/codex/cli/) and [Codex app server](https://developers.openai.com/codex/app-server/) on the same machine.

That means:

- it uses the same Codex install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Will it use the same Codex config I already have?

Yes. If you already use Codex, the plugin picks up the same [configuration](#common-configurations).

### Can I keep using my current API key or base URL setup?

Yes. Because the plugin uses your local Codex CLI, your existing sign-in method and config still apply.

If you need to point the built-in OpenAI provider at a different endpoint, set `openai_base_url` in your [Codex config](https://developers.openai.com/codex/config-advanced/#config-and-state-locations).

### Where is my job state stored?

Job records, logs, and event streams live under a per-workspace state directory. The plugin picks the root in this order:

1. `$CLAUDE_PLUGIN_DATA/state/` — set by Claude Code when the slash command runs through the plugin host. Honored when present.
2. `~/.codex-companion/state/` — stable HOME-anchored fallback. Used when the env var is not set (e.g., running `node codex-companion.mjs` directly from a shell).

Inside that root, each workspace gets `<basename>-<sha256(realpath)[:16]>/` (slug + hash of the canonical workspace path), with `state.json`, per-job `<job>.json`, `<job>.log`, and `<job>.events.jsonl` files.

When you look up a job by id (`/codex:status <id>`, `/codex:result <id>`, `/codex:cancel <id>`, `/codex:observe <id>`), the plugin also scans legacy locations — `$TMPDIR/codex-companion/` (older fallback) and every `~/.claude/plugins/data/codex-*/state/` directory (handles marketplace plugin renames) — so jobs created before an upgrade remain findable. `/codex:status --all` extends the same multi-root view to the no-arg listing and bypasses the per-Claude-session filter, which is the recommended way to recover the id of a task started in an earlier session. The advanced env knob `CODEX_COMPANION_LEGACY_ROOTS` (path-separated) lets you replace the legacy scan list explicitly; an empty value disables legacy scanning entirely. Real users should not need to touch it.
