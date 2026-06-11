## ADDED Requirements

### Requirement: Observe subcommand registration
The `observe` subcommand SHALL be registered in `codex-companion.mjs` alongside existing subcommands (`task`, `review`, `status`, etc.).

#### Scenario: Subcommand invocation
- **WHEN** user runs `node codex-companion.mjs observe`
- **THEN** the observe handler SHALL be invoked
- **THEN** it SHALL target the latest running job in the current workspace

#### Scenario: Observe specific job
- **WHEN** user runs `node codex-companion.mjs observe <jobId>`
- **THEN** the observe handler SHALL target the specified job

#### Scenario: Observe with workspace flag
- **WHEN** user runs `node codex-companion.mjs observe --cwd <path>`
- **THEN** the state directory SHALL be resolved from the specified workspace path

### Requirement: Job resolution and validation
The observer SHALL validate that the target job exists before entering tail mode.

#### Scenario: Job not found
- **WHEN** the target job ID does not exist in `state.json`
- **THEN** the observer SHALL print an error message to stderr
- **THEN** the observer SHALL exit with a non-zero exit code

#### Scenario: No running jobs
- **WHEN** no job ID is specified and no running jobs exist
- **THEN** the observer SHALL print "No running Codex jobs found" to stderr
- **THEN** the observer SHALL exit with a non-zero exit code

#### Scenario: Completed job
- **WHEN** the target job has status `completed` or `failed`
- **THEN** the observer SHALL render the full event history from the event stream file
- **THEN** the observer SHALL exit after rendering (no tail mode)

### Requirement: Live event tailing
The observer SHALL tail the event stream file in real-time, rendering new events as they appear.

#### Scenario: File watching with fs.watch
- **WHEN** the event stream file exists and `fs.watch` is available
- **THEN** the observer SHALL use `fs.watch` to detect file changes
- **THEN** new events SHALL be rendered within 100ms of being written

#### Scenario: Polling fallback
- **WHEN** `fs.watch` fails or is unavailable
- **THEN** the observer SHALL fall back to polling the file every 500ms
- **THEN** new events SHALL be rendered within 500ms of being written

#### Scenario: Byte-offset tracking
- **WHEN** the observer reads the event stream file
- **THEN** it SHALL track the last-read byte offset
- **THEN** on subsequent reads, it SHALL only parse and render content after the last offset

#### Scenario: Empty or missing event file
- **WHEN** the event stream file does not exist or is empty
- **THEN** the observer SHALL display "Waiting for events..." and continue watching
- **THEN** the observer SHALL begin rendering when the first event arrives

### Requirement: Terminal rendering
The observer SHALL render events as colored ANSI terminal output with phase indicators.

#### Scenario: Phase indicator rendering
- **WHEN** a phase transition event is received
- **THEN** the observer SHALL display a spinner character and phase name in the appropriate color (cyan for starting, yellow for investigating, green for finalizing)

#### Scenario: Tool call rendering
- **WHEN** a tool_call event is received
- **THEN** the observer SHALL display "→ <toolName> <path>" in cyan
- **WHEN** the corresponding tool_done event is received
- **THEN** the observer SHALL display "  ✓ completed" in dim text

#### Scenario: Command rendering
- **WHEN** a command event is received
- **THEN** the observer SHALL display "$ <command>" in blue
- **WHEN** the corresponding command_done event is received with exit code 0
- **THEN** the observer SHALL display "  exit 0" in green
- **WHEN** the corresponding command_done event is received with non-zero exit code
- **THEN** the observer SHALL display "  exit <code>" in red

#### Scenario: File change rendering
- **WHEN** a file_change event is received
- **THEN** the observer SHALL display "✎ <path> (<action>)" in yellow

#### Scenario: Message rendering
- **WHEN** a message event is received
- **THEN** the observer SHALL display the full message text as a white block with a left border

#### Scenario: Completion rendering
- **WHEN** a completed event is received
- **THEN** the observer SHALL display "● completed at <timestamp>" in green (for success) or red (for failure)
- **THEN** the observer SHALL exit after rendering

### Requirement: Read-only isolation
The observer process SHALL have no reference to or control over the Codex process. Observer exit SHALL NOT affect the running Codex task.

#### Scenario: Ctrl+C exits observer only
- **WHEN** the user presses Ctrl+C (SIGINT) while the observer is running
- **THEN** the observer SHALL print "Observer detached. Codex task continues." in dim text
- **THEN** the observer SHALL exit with code 0
- **THEN** the Codex task SHALL continue running unaffected

#### Scenario: Observer crash does not affect Codex
- **WHEN** the observer encounters an unhandled error
- **THEN** the observer SHALL print the error to stderr and exit
- **THEN** the Codex task SHALL continue running unaffected

#### Scenario: Multiple concurrent observers
- **WHEN** two observer processes target the same job
- **THEN** both observers SHALL render events independently
- **THEN** neither observer SHALL interfere with the other or with the Codex task

### Requirement: Usage output
The observer SHALL be listed in the usage help output of `codex-companion.mjs`.

#### Scenario: Help includes observe
- **WHEN** user runs `node codex-companion.mjs --help` or `node codex-companion.mjs` with no arguments
- **THEN** the usage output SHALL include a line for `observe [jobId] [--cwd <path>]`
