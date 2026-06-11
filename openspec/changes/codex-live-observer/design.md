## Context

The Codex plugin runs Codex tasks via `codex-companion.mjs task`, which spawns a `codex app-server` process and communicates over a JSON-RPC stdio protocol. Progress events (tool calls, file changes, commands, messages, reasoning, phase transitions) are processed by `codex.mjs` and emitted through `createProgressReporter`, which writes to stderr and a plain-text log file.

Currently, the only ways to observe a running task are:
- **Foreground mode**: stderr output visible in the same Claude Code session
- **`/codex:status`**: snapshot of job state (running/completed/failed)
- **`/codex:result`**: final output after completion
- **Log file**: plain-text append-only log, readable but not structured

None of these provide a real-time, terminal-based live view from a separate terminal window. The existing `onProgress` callback in `tracked-jobs.mjs` already captures all the necessary events — the gap is in persisting them in a machine-readable format and providing a consumer that renders them live.

## Goals / Non-Goals

**Goals:**
- Provide a read-only, live terminal view of any running or completed Codex job
- Events appear in real-time as they happen, with phase indicators and colored output
- Observer can be started in any terminal, independent of the Claude Code session running Codex
- Observer exit (Ctrl+C) never affects the running Codex task
- Event stream is structured (JSONL) for future programmatic consumption

**Non-Goals:**
- Two-way interaction: observer cannot send input, cancel, or steer the Codex task
- Web UI or remote streaming (terminal-only for now)
- Event replay across sessions (observer targets a single job's event file)
- Real-time WebSocket push (file-based polling is sufficient and simpler)
- Modifying Codex execution behavior in any way

## Decisions

### 1. Event stream format: JSONL (JSON Lines)

**Decision**: Each event is a single-line JSON object appended to `<jobsDir>/<jobId>.events.jsonl`.

**Rationale**: JSONL is append-only, stream-parseable, and human-readable. Each line is independently parseable, so partial reads are safe. Alternatives considered:
- **Plain text log**: Already exists (`logFile`), not machine-parseable. Event stream complements it.
- **SQLite**: Overkill for append-only event log, adds dependency complexity.
- **Binary format**: Harder to debug, no benefit for this use case.

### 2. Event stream integration point: `createProgressReporter`

**Decision**: Add an `eventStream` parameter to `createProgressReporter` alongside existing `stderr` and `logFile` options.

**Rationale**: The progress reporter is already the single funnel for all Codex events. Adding event stream output here means zero changes to the event processing pipeline in `codex.mjs`. The `onEvent` callback in `createProgressReporter` already supports custom event handlers — the event stream writer plugs in as another handler.

### 3. File watching: `fs.watch` with polling fallback

**Decision**: Use `fs.watch` for file change notifications, with a 500ms polling fallback if `fs.watch` fails or is unavailable.

**Rationale**: `fs.watch` is efficient (kernel-level notifications on macOS/Linux) but can be unreliable on some filesystems (network mounts, Docker volumes). Polling fallback ensures cross-platform reliability. The 500ms interval is acceptable latency for a human observer.

### 4. Byte-offset tracking for incremental reads

**Decision**: Observer tracks the last-read byte offset in the event file and only reads new content.

**Rationale**: Avoids re-parsing the entire file on each change. For a 100KB event file with 500 events, reading only the new 200 bytes is far more efficient than re-reading and re-rendering everything.

### 5. Observer rendering: inline ANSI output

**Decision**: Render events as colored ANSI terminal output with phase spinners, similar to CLI tools like `npm` or `cargo`.

**Rationale**: No external TUI framework needed. The event types are simple enough for inline rendering. ANSI escape codes are universally supported in modern terminals. This keeps the implementation lightweight (~150 lines of render code) and avoids dependencies.

### 6. Observer lifecycle: detached, read-only

**Decision**: Observer process has no reference to the Codex process. It only reads the event file. SIGINT exits the observer cleanly.

**Rationale**: Complete isolation ensures observer crashes or exits cannot affect Codex. The event file is the only shared state, and it's append-only, so concurrent reads are safe.

### 7. Subcommand registration: `observe` in `codex-companion.mjs`

**Decision**: Add `observe` as a new subcommand alongside `task`, `review`, `status`, etc.

**Rationale**: Consistent with existing CLI pattern. Users invoke it as `node codex-companion.mjs observe [jobId] [--cwd <path>]`. Can later be exposed as a slash command (`/codex:observe`) if desired.

## Risks / Trade-offs

**[Event file grows unbounded during long tasks]** → Mitigation: Event files are small (~10-100 KB per job). They share the same lifecycle as job records and are pruned by the existing 50-job cap in `state.mjs`. A multi-hour task might produce ~500 KB, which is negligible.

**[fs.watch unreliable on some platforms]** → Mitigation: Polling fallback at 500ms interval. The observer detects `fs.watch` failure and transparently switches to polling. Both modes produce identical output.

**[Observer started before any events exist]** → Mitigation: Observer handles missing/empty event file gracefully, shows "Waiting for events..." message, and begins rendering when the first event arrives.

**[Job not found or already completed]** → Mitigation: Observer checks `state.json` for job existence and status. For completed jobs, it renders the full event history and exits (no tail mode needed).

**[Concurrent observers reading same file]** → Mitigation: Append-only writes + read-only observers = no conflict. Multiple observers can tail the same event file simultaneously.
