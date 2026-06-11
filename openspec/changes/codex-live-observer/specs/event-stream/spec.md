## ADDED Requirements

### Requirement: Event stream file creation
The system SHALL create a `.events.jsonl` file in the job's state directory when a tracked job starts, alongside the existing log file.

#### Scenario: New job creates event stream file
- **WHEN** `runTrackedJob` is called with a job that has `eventStream` enabled in the progress reporter
- **THEN** a file named `<jobId>.events.jsonl` SHALL be created in `<stateDir>/jobs/`
- **THEN** the file SHALL be initially empty

#### Scenario: Event stream file path follows job log convention
- **WHEN** the job directory is resolved via `resolveJobsDir`
- **THEN** the event stream file SHALL be at `<jobsDir>/<jobId>.events.jsonl`

### Requirement: Structured event format
Each event written to the event stream SHALL be a single-line JSON object containing at minimum: `t` (ISO 8601 timestamp), `type` (event type string), and `phase` (current phase).

#### Scenario: Phase transition event
- **WHEN** a progress event with `phase` is emitted
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"phase","phase":"<phase>","message":"<text>"}` plus any additional fields from the event

#### Scenario: Tool call event
- **WHEN** a tool call (Read, Write, Bash, etc.) starts or completes
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"tool_call","tool":"<toolName>","phase":"<phase>"}` for started events
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"tool_done","tool":"<toolName>","phase":"<phase>"}` for completed events

#### Scenario: Command execution event
- **WHEN** a shell command is executed by Codex
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"command","cmd":"<command>","phase":"<phase>"}` when started
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"command_done","cmd":"<command>","exit":<code>,"phase":"<phase>"}` when completed

#### Scenario: File change event
- **WHEN** Codex modifies a file
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"file_change","path":"<filePath>","action":"<create|modify|delete>","phase":"<phase>"}`

#### Scenario: Agent message event
- **WHEN** Codex produces a text message (including final answer)
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"message","phase":"<phase>","text":"<fullMessageText>"}`

#### Scenario: Reasoning summary event
- **WHEN** Codex produces reasoning sections
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"reasoning","phase":"<phase>","sections":["<section1>","<section2>",...]}`

#### Scenario: Completion event
- **WHEN** the Codex task completes (success or failure)
- **THEN** the JSONL line SHALL contain `{"t":"<ISO8601>","type":"completed","status":"<success|failure>","phase":"<phase>"}` plus `threadId` and `summary` if available

### Requirement: Append-only writes
The event stream SHALL only use append operations. Existing lines SHALL NOT be modified or deleted during a job's lifetime.

#### Scenario: Multiple events written sequentially
- **WHEN** three events are emitted in sequence
- **THEN** the event file SHALL contain exactly three lines, one per event, in emission order
- **THEN** no existing line SHALL be modified

#### Scenario: Write failure does not affect job execution
- **WHEN** the event stream file cannot be written (disk full, permission error)
- **THEN** the error SHALL be silently ignored
- **THEN** the Codex task SHALL continue unaffected

### Requirement: Integration with progress reporter
The event stream SHALL be wired into `createProgressReporter` as an additional output channel alongside `stderr` and `logFile`.

#### Scenario: Progress reporter emits to event stream
- **WHEN** `createProgressReporter` is called with an `eventStream` parameter
- **THEN** every progress event processed by the reporter SHALL be written to the event stream in JSONL format
- **THEN** the event SHALL be written in addition to existing stderr and logFile outputs

#### Scenario: Event stream is optional
- **WHEN** `createProgressReporter` is called without an `eventStream` parameter
- **THEN** no event stream file SHALL be created
- **THEN** existing stderr and logFile behavior SHALL be unchanged

### Requirement: Event stream cleanup with job records
Event stream files SHALL be deleted when their corresponding job record is pruned by the existing 50-job cap mechanism.

#### Scenario: Job pruning removes event stream
- **WHEN** a job record is pruned from `state.json` due to exceeding the 50-job limit
- **THEN** the corresponding `.events.jsonl` file SHALL also be deleted
