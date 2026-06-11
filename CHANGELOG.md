# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-05-23

### Added

- **`/codex:observe` now auto-spawns the observer inside Ghostty and iTerm2 on macOS** (previously tmux-only, shipped in 1.3.0). The single hardcoded tmux branch in `plugins/codex/scripts/lib/spawner.mjs` was replaced with a small backend strategy table `{ kind, detect, build, cmd, classifyFailure }` driving three backends:
  - `tmux` — unchanged (`split-window -h -c <cwd> <command>`); detection via `$TMUX`.
  - `ghostty-mac` — detection via `process.platform === 'darwin'` AND `process.env.TERM_PROGRAM === 'ghostty'` AND no `$TMUX`. Always opens a new Ghostty window (Ghostty 1.3's terminal object exposes only `id`, `name`, `working directory` — no `tty`, so reliable session targeting is impossible until upstream adds it). Drills `set newWin to new window` → `set newTerm to terminal 1 of selected tab of newWin` → `input text "<cmd>\n" to newTerm`.
  - `iterm2-mac` — detection via `process.platform === 'darwin'` AND `process.env.TERM_PROGRAM === 'iTerm.app'` AND no `$TMUX`. Walks the process ancestry to discover the caller shell's controlling tty, then iterates `windows → tabs of w → sessions of tb` (sessions are nested under tabs in iTerm2's object model, NOT directly under windows) comparing `tty of s` to the caller tty. On match: `split vertically with default profile` in that session. On no match (or tty discovery failure): `create window with default profile` and `current session of newWindow`.
- Detection precedence is `tmux > ghostty-mac > iterm2-mac > none`; users running tmux inside Ghostty/iTerm2 still get the tmux split.
- Two-layer command quoting pipeline for osascript backends: `composeShellInvocation({ cwd, command })` (shell-quotes cwd, leaves the already-shell-quoted argv tokens of `command` untouched) → `rejectControlChars(composed)` (early-returns `unsafe-command` on any byte in `0x00–0x1F` minus tab/space, so embedded newlines / NUL / CR can never reach `input text` / `write text`) → `escapeAppleScriptLiteral(composed)` (doubles `\` and `"`).
- Automation-permission denial classified separately from generic spawn failure: when `osascript` stderr contains `(-1743)` or `not authorized to send Apple events` (case-insensitive), the spawner returns `reason: 'automation-permission-denied'` and `handleObserveSpawn` prints a single dedicated line directing the user to System Settings → Privacy & Security → Automation, instead of the generic copy-paste fallback hint.
- `discoverCallerTty()` walks up the process tree via `ps -o tty=,ppid= -p <pid>` (depth-capped at 10, per-probe timeout 250ms) until it finds an ancestor with a real controlling tty, and resolves to `/dev/ttysNN`. Sandboxed shells / detached daemons that lack `ps` access fall through to the new-window branch with no AppleScript `repeat` loop emitted.

### Fixed

- **Three HIGH-severity AppleScript object-model bugs from the initial 1.4.0 implementation**, surfaced by `/codex:adversarial-review` and confirmed against the published Ghostty 1.3 and iTerm2 dictionaries via Context7:
  - The Ghostty backend used `repeat with t in terminals … if tty of t is targetTty …`, but Ghostty 1.3's terminal has no `tty` property — that branch would have thrown at runtime in real Ghostty. Removed the `repeat` entirely; Ghostty backend always opens a new window.
  - The Ghostty backend treated `new window`'s return value as a terminal and called `input text … to newWin` directly. AppleScript would have refused the cast at runtime. Now drills via `set newTerm to terminal 1 of selected tab of newWin` before `input text`.
  - The iTerm2 backend traversed `repeat with w in windows / repeat with s in sessions of w / …`. That AppleScript-compiles, but `sessions` is NOT a direct element of `window` in iTerm2's object model — at runtime the inner loop iterated an empty collection, so the tty-match branch never fired and every observer fell through to the new-window path. Now correctly nests `repeat with w in windows → repeat with tb in tabs of w → repeat with s in sessions of tb`. A spec scenario locks the source order so the contract cannot regress.
- Tests strengthened with contract-shape assertions (Ghostty: `set newWin to new window`, `set newTerm to terminal 1 of selected tab of newWin`, `input text "…" to newTerm`, plus negative `tty of t` / `repeat with t in terminals`; iTerm2: `repeat with w in windows`, `repeat with tb in tabs of w`, `repeat with s in sessions of tb`, plus source-order assertion). Added a dedicated 8-test `discoverCallerTty` unit suite covering immediate-parent hit, walk-past-`??`-ancestor, `/dev/` prefix preservation, `ppid<=1` termination, runProbe throws, malformed output, depth-10 cap, and invalid `startPid`.

## [1.3.0] - 2026-05-22

### Added

- **`/codex:observe` auto-spawns the observer in a tmux split when invoked from inside a tmux session.** Previously the slash command always printed the observe invocation as a copy-paste hint and required the user to open a new pane manually. The new flow detects `$TMUX` and shells out to `tmux split-window -h -c <workspace> <observer-cmd>`, then prints `✓ Observer launched in tmux pane (job <job-id>)`. Outside tmux the command falls back to the existing copy-paste hint, so non-tmux users see no behavior change.
- New `plugins/codex/scripts/lib/spawner.mjs` module with `detectTerminal`, `buildTmuxSplitArgs`, and `spawnObserverInTerminal({ cwd, command, env, runner })`. The runner is injected, so unit tests pass a fake without invoking real `tmux`.
- New `tests/spawner.test.mjs` covers tmux detection, split-args shape, success / non-zero-exit / runner-throw classification, and the no-tmux pass-through path.

## [1.2.6] - 2026-05-22

### Fixed

- **Cross-session "Job not found" still bit users in 1.2.5** because the per-process `CLAUDE_PLUGIN_DATA` env var fragmented state across multiple roots that no single scan covered. Two real-world triggers exposed it: (a) the marketplace rename `openai-codex → dragon-cc-codex` (commit `e6ef383`) moved Claude Code's plugin data path from `~/.claude/plugins/data/codex-openai-codex/` to `~/.claude/plugins/data/codex-dragon-cc-codex/`, orphaning jobs created before the rename; (b) running `codex-companion.mjs` from a shell without `CLAUDE_PLUGIN_DATA` set silently fell through to `$TMPDIR/codex-companion/`, which is volatile and disjoint from the plugin data dir. `findJobByIdAcrossWorkspaces` introduced in 1.2.5 only scanned `resolveStateRoot()`, so it could not see across these roots. Users worked around the symptom by exporting `CLAUDE_PLUGIN_DATA` manually before each invocation.
  - `plugins/codex/scripts/lib/state.mjs`: default fallback root moved from `$TMPDIR/codex-companion/` (volatile, per-user-launchd) to `~/.codex-companion/state/` (stable, HOME-anchored). `CLAUDE_PLUGIN_DATA` is still honored when the plugin host sets it, so we remain a good plugin citizen.
  - `findJobByIdAcrossWorkspaces` now iterates `collectCandidateStateRoots()`: the current `resolveStateRoot()`, the HOME default, `$TMPDIR/codex-companion/` (legacy), and every `~/.claude/plugins/data/codex-*/state/` directory (handles slug renames). Scan order keeps the current root first so test fixtures are not shadowed by leftover legacy data.
  - New `collectWorkspaceJobsAcrossRoots(workspaceRoot)` reads `state.json` for the workspace's slug-hash across every candidate root and merges jobs by id (newer `updatedAt` wins on conflict).
  - `lib/job-control.mjs` `buildStatusSnapshot`: with `--all`, jobs are now collected across roots **and** the per-Claude-session filter is bypassed, so users in a fresh session can recover the id of a job they created in an earlier session via `/codex:status --all`. The default (no flag) still scopes to the current session in the current root — explicit opt-in to the wider view.
  - Test isolation: cleaned 246 leaked `codex-plugin-test-*` and `broker-test-*` state directories under `~/.claude/plugins/data/codex-dragon-cc-codex/state/` and 167 under `$TMPDIR/codex-companion/` that prior `npm test` runs deposited into the real user plugin data dir. `tests/helpers.mjs` now rewrites `CLAUDE_PLUGIN_DATA` to a per-suite `mkdtemp` path if it points outside `os.tmpdir()`, sets `CODEX_COMPANION_LEGACY_ROOTS=""` so the multi-root scan stays sandboxed for ordinary tests, and strips `CODEX_COMPANION_SESSION_ID` from the test process so fixture jobs without a `sessionId` are not session-filtered out by status/result subprocesses.
  - New env knob `CODEX_COMPANION_LEGACY_ROOTS` (path-separated): empty string disables legacy scanning (test isolation default); non-empty replaces the legacy scan list with the supplied roots so regression tests can exercise the cross-root fallback without polluting real directories.
  - Tests: `tests/state.test.mjs` swaps the old "temp-backed per-workspace directory" assertion for a HOME-anchored fallback test that explicitly unsets `CLAUDE_PLUGIN_DATA`. `tests/job-control.test.mjs` gains a `multi-root state scan` suite that proves `findJobByIdAcrossWorkspaces` falls through to a legacy root and `buildStatusSnapshot({ all: true })` merges jobs from primary + legacy state files for the same workspace slug.

## [1.2.5] - 2026-05-22

### Fixed

- **`/codex:observe`, `/codex:status <id>`, `/codex:result <id>`, `/codex:cancel <id>` returned "Job not found" when invoked from a Claude Code session whose git workspace differed from the one in which the job was created.** State is partitioned per workspace under `$CLAUDE_PLUGIN_DATA/state/<slug>-<hash>/`, and every command resolved the workspace from `process.cwd()` only. So a user who saw a job in `/codex:status` from workspace A and then copied the job id into a slash command running in workspace B hit a hard miss even though the job record was still on disk.
  - Added `findJobByIdAcrossWorkspaces(jobId)` in `plugins/codex/scripts/lib/state.mjs`: scans every `state.json` under the configured state root and returns `{ stateDir, job }` for an exact id match (corrupted state files are skipped, not propagated).
  - `lib/observe.mjs`: when the local workspace does not contain the requested job id, fall back to the cross-workspace lookup. The header prints a one-line note showing which state dir was used so the cross-boundary read is auditable, and the tail continues to use the absolute `eventFile` recorded on the job.
  - `lib/job-control.mjs`: `buildSingleJobSnapshot`, `resolveResultJob`, and `resolveCancelableJob` each fall back to the cross-workspace match when an explicit reference misses locally. The returned `workspaceRoot` is the job's original workspace, so all subsequent `readStoredJob` / `writeJobFile` / `upsertJob` calls land in the correct state dir without further plumbing. Active/finished predicates are still honored across the boundary — e.g., `/codex:result` on a still-running cross-workspace job surfaces a "still running in another workspace" error instead of silently picking it up.
  - `codex-companion.mjs` `handleCancel`: passes the resolved `workspaceRoot` (not the invocation `cwd`) to `interruptAppServerTurn`, so the broker interrupt targets the workspace that actually owns the running Codex turn.
  - Tests: `tests/observe.test.mjs` adds coverage for `findJobByIdAcrossWorkspaces` (stateRoot missing, empty id, hit, miss, corrupted state.json). `tests/job-control.test.mjs` (new file) covers cross-workspace fallback for the three resolvers, including predicate rejection paths.

## [1.2.4] - 2026-05-22

### Fixed

- **`/codex:observe` slash command produced no output in Claude Code** — removed the inline `` !`...` `` shell-exec fallback from `plugins/codex/commands/observe.md`. The fallback invoked the long-running live tail (`handleObserveCommand` waits indefinitely for `COMPLETED` or `SIGINT`), and because Claude Code's slash-exec model buffers stdout until the child process exits, a never-returning process gated the entire slash-command body — including the 36 lines of "open a new terminal" guidance that preceded it. Users typing `/codex:observe` saw nothing at all.
  - The slash command body is now a pure static guidance document: it tells the user to open a new terminal and shows the copy-paste `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" observe …` snippet. It renders immediately regardless of job state.
  - The CLI `observe` subcommand in `codex-companion.mjs` / `lib/observe.mjs` is **unchanged** — running `node codex-companion.mjs observe` in a terminal works exactly as before (live ANSI tail, `Ctrl+C` detach, completes on `COMPLETED` event).
  - Structural rule captured in `openspec/changes/fix-observe-slash-command-hang/specs/observe-slash-command/spec.md`: slash command bodies MUST NOT contain inline shell-exec blocks that invoke processes which do not terminate in bounded time. One-shot subprocesses (`/codex:cancel`, `/codex:result`, `/codex:status`) may continue to use inline exec.

## [1.2.3] - 2026-05-21

### Changed

- **Marketplace renamed `openai-codex` → `dragon-cc-codex`** to disambiguate this fork from the upstream OpenAI marketplace and avoid the name collision that would prevent a user from having both installed side by side.
  - `.claude-plugin/marketplace.json`: `name` field updated.
  - `README.md` / `README.zh-CN.md`: install instructions now point at `dragon84867/codex-plugin-cc` (fork repo) and `codex@dragon-cc-codex` (renamed marketplace).
  - **Migration for existing users**: run `/plugin marketplace remove openai-codex` once, then re-add via `/plugin marketplace add dragon84867/codex-plugin-cc` and `/plugin install codex@dragon-cc-codex`.

## [1.2.2] - 2026-05-21

### Fixed

- **Marketplace install failure** — restored the `plugins/codex/` subdirectory layout so the Claude Code marketplace installer can discover the plugin.
  - Reverts the flatten refactor (af88f38) and its follow-up `source: "./"` patch (cf2917c). The Claude Code marketplace spec requires `source` to point at a subdirectory of the marketplace repo (e.g. `./plugins/codex`); pointing it at the marketplace root itself is unsupported and caused installs to fail with "unsupported source type" / undiscoverable commands.
  - Plugin runtime, commands, hooks, agents, skills, prompts, schemas, and `.claude-plugin/plugin.json` are back under `plugins/codex/`. `marketplace.json` stays at the repo root and now points at `./plugins/codex` again, matching the OpenAI upstream layout.
- **Align with current codex protocol** — restoring the subdirectory layout also restored correct `.d.ts` relative imports for the generated app-server types, which had been silently broken by the flatten refactor (making TypeScript treat the imported types as `any` and skip checking). With type-check re-enabled, two long-standing protocol-drift bugs surfaced and are now fixed:
  - `app-server.mjs`: `DEFAULT_CAPABILITIES` now includes `requestAttestation: false`, matching the required `InitializeCapabilities` shape.
  - `codex.mjs`: removed the obsolete `experimentalRawEvents: false` field from `buildThreadParams`; it is no longer part of `ThreadStartParams` in the current codex protocol.
  - Runtime behavior is unchanged — codex's JSON-RPC tolerated the missing/extra fields, so existing installs continue to work. This change just unblocks `npm run build` / CI type-checking.

## [1.2.0] - 2026-05-20

### Added

- **Pre-push git hook** — validates CHANGELOG, version bump, and README consistency before pushing
  - Blocks push if plugin source changed without version bump
  - Blocks push if version bumped without matching CHANGELOG entry
  - Warns if version bumped without README update
  - Auto-detects suggested bump type (major / minor / patch) from changed files and commit messages
  - Install: `npm run setup-hooks` | Bypass: `git push --no-verify`

### Fixed

- **Broker process leak** — stale broker processes were never killed, accumulating hundreds of orphans
  - `ensureBrokerSession` now defaults `killProcess` to `terminateProcessTree` so stale brokers are actually terminated
  - Broker auto-exits after 5 seconds of idle (no connected clients)
- **marketplace.json version sync** — `.claude-plugin/marketplace.json` was accidentally gitignored, causing version to silently fall behind. Now properly tracked with `.claude-plugin/*` + `!.claude-plugin/marketplace.json` pattern

## [1.1.0] - 2026-05-20

### Added

- **`/codex:observe`** — Real-time live observer for Codex tasks with ANSI color output
  - Watch tool calls, file changes, commands, messages, and reasoning as they happen
  - Color-coded output: cyan (tools), blue (commands), green (success), red (failure), yellow (file changes)
  - Read-only mode — observer never affects the running Codex task
  - `Ctrl+C` to detach without stopping the Codex task
  - Works in a separate terminal window alongside your Claude Code session
  - Automatically renders full history for completed jobs
- **JSONL event stream** — Structured event logging (`.events.jsonl`) for each job
  - Append-only format for safe concurrent reads
  - Integrated with existing progress reporter pipeline
  - Automatic cleanup with job pruning
- **26 unit tests** covering event stream writer and observer functionality

### Changed

- Job records now include `eventFile` field alongside `logFile`
- `createProgressReporter` accepts `eventStream` parameter for structured event emission

### Documentation

- Added `/codex:observe` usage examples and color legend to README
- Added Chinese translation for observer documentation

## [1.0.4] - 2026-05-20

### Added

- **`--worktree` flag** for `/codex:rescue` — Creates isolated git worktree for Codex work
  - Codex works in `.claude/worktrees/<jobId>/` on a separate branch
  - Leaves main working directory untouched
  - Mutually exclusive with `--resume`
- **`sandbox_mode` config** — Reads from `~/.codex/config.toml` or `.codex/config.toml`
  - Falls back to `workspace-write` (with `--write`) or `read-only`

### Fixed

- Thread exclusivity warning — Users cannot manually `codex resume` an active thread
- Signal file + Monitor/PushNotification callback for background tasks
- Route `/codex:rescue` through Agent tool to stop Skill recursion

### Documentation

- Added Chinese README (`README.zh-CN.md`)
- Documented `--worktree` and sandbox_mode configuration

[1.2.3]: https://github.com/dragon84867/codex-plugin-cc/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/dragon84867/codex-plugin-cc/compare/v1.2.0...v1.2.2
[1.2.0]: https://github.com/dragon84867/codex-plugin-cc/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dragon84867/codex-plugin-cc/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/dragon84867/codex-plugin-cc/compare/v1.0.3...v1.0.4
