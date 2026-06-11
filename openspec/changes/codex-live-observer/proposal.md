## Why

When Codex runs as a background subagent (via `/codex:rescue --background`), the only way to observe its progress is through `/codex:status` snapshots or reading a plain-text log file after the fact. There is no way to get a live, terminal-based view of what Codex is doing in real-time without blocking the main Claude thread. Users need a read-only observer window that shows the full output stream — tool calls, file changes, commands, messages — like watching a CLI session live.

## What Changes

- Add a JSONL event stream file (`.events.jsonl`) written alongside each job's existing log file, capturing structured events (tool calls, file changes, commands, messages, reasoning, phase transitions) in real-time
- Add a new `observe` subcommand to `codex-companion.mjs` that tails the event stream and renders it as a live terminal UI
- Wire the event stream into the existing `createProgressReporter` pipeline so all progress events are also written as structured JSONL
- Observer is read-only: Ctrl+C exits the observer without affecting the running Codex task
- Observer supports targeting the latest running job or a specific job ID

## Capabilities

### New Capabilities
- `event-stream`: Structured JSONL event stream writer that captures all Codex progress events in append-only format, integrated with the existing progress reporter pipeline
- `observe-command`: The `observe` subcommand for `codex-companion.mjs` that tails the event stream file, renders events as a live terminal UI with phase indicators and colored output, and exits cleanly without affecting the Codex task

### Modified Capabilities

## Impact

- **New files**: `plugins/codex/scripts/lib/event-stream.mjs`, `plugins/codex/scripts/lib/observe.mjs`
- **Modified files**: `plugins/codex/scripts/codex-companion.mjs` (register subcommand), `plugins/codex/scripts/lib/tracked-jobs.mjs` (wire event stream into progress reporter)
- **Storage**: Each job gains a `.events.jsonl` file (~10-100 KB), cleaned up with existing job pruning
- **Dependencies**: None (uses Node.js built-ins only: `fs`, `readline`, `path`)
- **Breaking changes**: None
