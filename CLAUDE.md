# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `@openai/codex-plugin-cc` — a Claude Code plugin that wraps the [Codex app server](https://developers.openai.com/codex/app-server) and Codex CLI, exposing slash commands (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup`) and a `codex:codex-rescue` subagent. The plugin lives in `plugins/codex/`.

## Commands

```bash
# Generate app-server TypeScript types (requires `codex` binary on PATH)
npm run prebuild

# Type-check (no emit, checkJs over .mjs sources)
npm run build

# Run all tests (Node.js built-in test runner, no framework)
npm test

# Run a single test file
node --test tests/<file>.test.mjs

# Version bump
node scripts/bump-version.mjs [--check]
```

There is no bundler, no runtime transpiler, and no lint step. Tests run the `.mjs` sources directly with `node --test`.

## Architecture

The runtime is a single CLI entry point, `plugins/codex/scripts/codex-companion.mjs`, dispatched by subcommand (`setup`, `review`, `adversarial-review`, `task`, `status`, `result`, `cancel`). Slash commands in `plugins/codex/commands/*.md` shell out to this script via `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" <subcommand> "$ARGUMENTS"`.

Key modules under `plugins/codex/scripts/lib/`:

- `codex.mjs` — high-level Codex operations: auth/availability checks, `runAppServerTurn`, `runAppServerReview`, structured output parsing, session runtime status
- `app-server.mjs` — low-level Codex app server stdio protocol client
- `app-server-protocol.d.ts` + `.generated/app-server-types/` — generated types consumed by the build
- `broker-endpoint.mjs` / `broker-lifecycle.mjs` — manage a persistent app-server broker process shared across commands
- `job-control.mjs` / `tracked-jobs.mjs` — background job records, progress updates, cancellation
- `state.mjs` — per-workspace state dir (hashed slug under `CLAUDE_PLUGIN_DATA` or `$TMPDIR/codex-companion`), `state.json` + `jobs/` directory, capped at 50 jobs
- `git.mjs` — review target resolution (`auto` / `working-tree` / `branch`), context collection
- `render.mjs` — all user-facing output formatting
- `args.mjs` — argument parsing; flags like `--wait`, `--background`, `--resume-last`, `--model`, `--effort` are routing controls stripped before the task text is forwarded
- `prompts.mjs` — loads templates from `plugins/codex/prompts/` and interpolates them
- `codex-config.mjs` — reads `sandbox_mode` from user's Codex config (`~/.codex/config.toml` / `.codex/config.toml`)
- `process.mjs` — process tree termination, binary availability checks
- `workspace.mjs` — resolves the workspace root (honoring `CLAUDE_WORKSPACE_ROOT`)

The `codex:codex-rescue` subagent (`plugins/codex/agents/codex-rescue.md`) is a thin forwarding wrapper: it does exactly one `Bash` call to `codex-companion.mjs task ...` and returns stdout verbatim. It must not read the repo, reason about the problem, or do any independent work.

Hooks are declared in `plugins/codex/hooks/hooks.json`:
- `SessionStart` / `SessionEnd` → `session-lifecycle-hook.mjs` (bookkeeping)
- `Stop` → `stop-review-gate-hook.mjs` (optional review gate; opt-in via `/codex:setup --enable-review-gate`)

Skills in `plugins/codex/skills/` (`codex-cli-runtime`, `codex-result-handling`, `gpt-5-4-prompting`) are loaded by the subagent, not by the main Claude thread.

## Conventions

- ESM only (`"type": "module"` in `package.json`). All sources are `.mjs` except the generated `.ts` types and the `.d.ts` protocol file.
- TypeScript is used purely for type-checking via `checkJs` + `noEmit`; `strict` is off. Don't add `.ts` source files.
- Node.js ≥ 18.18. Use only Node built-ins; there are no runtime npm dependencies (devDeps are `typescript` and `@types/node` only).
- The plugin picks up the user's existing `codex` binary, auth state, and `~/.codex/config.toml` / `.codex/config.toml`. Don't hardcode models or endpoints; `MODEL_ALIASES` in `codex-companion.mjs` is the only alias map (`spark` → `gpt-5.3-codex-spark`).
- Task mode (`/codex:rescue`) reads `sandbox_mode` from the user's Codex config via `codex-config.mjs`. If not configured, falls back to `workspace-write` (when `--write` is set) or `read-only`. Review commands always use `read-only` regardless of config.
- Tests use temp git repos (`tests/helpers.mjs` → `initGitRepo`) and a fake codex fixture (`tests/fake-codex-fixture.mjs`) to drive the companion script without a real Codex install.
- `CLAUDE_PLUGIN_ROOT` is set by Claude Code at hook/command invocation time and points at `plugins/codex/`. Scripts resolve paths relative to `import.meta.url`, not `process.cwd()`.

## Version

Plugin version is declared in both `package.json` and `plugins/codex/.claude-plugin/plugin.json` and must stay in sync. `npm run check-version` enforces this (run in CI). `scripts/bump-version.mjs` updates both.
