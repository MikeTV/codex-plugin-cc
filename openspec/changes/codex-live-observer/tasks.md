## 1. Event Stream Writer

- [x] 1.1 Create `plugins/codex/scripts/lib/event-stream.mjs` with `createEventStream(jobId, jobsDir)` function that returns a stream object with the event file path and a write function
- [x] 1.2 Implement `emitEvent(stream, type, data)` function that formats event as JSONL (`{"t":"<ISO8601>","type":"<type>",...data}`) and appends to the event file using `fs.appendFileSync`
- [x] 1.3 Implement `closeEventStream(stream)` function (no-op for now, placeholder for future cleanup)
- [x] 1.4 Ensure write failures are silently caught and do not propagate errors to the caller
- [x] 1.5 Add event type constants: `phase`, `tool_call`, `tool_done`, `command`, `command_done`, `file_change`, `message`, `reasoning`, `completed`

## 2. Progress Reporter Integration

- [x] 2.1 Add `eventStream` parameter to `createProgressReporter` options in `tracked-jobs.mjs`
- [x] 2.2 In the progress reporter callback, when `eventStream` is present, call `emitEvent` with the normalized event data mapped to JSONL fields
- [x] 2.3 Map existing event fields to event stream format: `message` → `message`, `phase` → `phase`, `logTitle`/`logBody` → appropriate event types
- [x] 2.4 Ensure event stream writes happen alongside existing stderr and logFile writes (no replacement)

## 3. Event Stream Creation in Job Lifecycle

- [x] 3.1 In `codex-companion.mjs`, when calling `createTrackedProgress`, create an event stream via `createEventStream` and pass it to `createProgressReporter`
- [x] 3.2 Store the event stream path in the job record as `eventFile` field (alongside `logFile`)
- [x] 3.3 Ensure event stream is created for both foreground and background task modes
- [x] 3.4 Add event stream creation for review commands (`handleReviewCommand`) as well

## 4. Event Stream Cleanup

- [x] 4.1 In `state.mjs`, when pruning jobs (in `pruneJobs`), also delete the corresponding `.events.jsonl` file alongside the `.log` and `.json` files
- [x] 4.2 Add a `resolveJobEventFile(workspaceRoot, jobId)` helper in `state.mjs` (parallel to `resolveJobLogFile`)

## 5. Observe Subcommand: Job Resolution

- [x] 5.1 Create `plugins/codex/scripts/lib/observe.mjs` with `handleObserveCommand(argv)` async function
- [x] 5.2 Parse arguments: optional `jobId` positional arg, optional `--cwd` flag
- [x] 5.3 Resolve workspace root and state directory from `--cwd` or `process.cwd()`
- [x] 5.4 If no `jobId` provided, find the latest running job from `state.json` (filter by `status === "running"`, sort by `startedAt` descending)
- [x] 5.5 If no running job found and no `jobId` specified, print error to stderr and exit with code 1
- [x] 5.6 If target job not found in state, print error to stderr and exit with code 1

## 6. Observe Subcommand: Event File Reading

- [x] 6.1 Implement `readEventsFromOffset(eventFile, offset)` function that reads the file, parses JSONL lines after the offset, and returns `{ events, newOffset }`
- [x] 6.2 Handle missing event file: return empty events array and offset 0
- [x] 6.3 Handle empty event file: return empty events array and offset 0
- [x] 6.4 Parse each line with `JSON.parse`, skip lines that fail parsing (defensive)

## 7. Observe Subcommand: Terminal Rendering

- [x] 7.1 Implement `renderEvent(event)` function that returns ANSI-colored string based on event type
- [x] 7.2 Phase events: spinner char + phase name in color (cyan/yellow/green depending on phase)
- [x] 7.3 Tool call events: `→ <tool> <path>` in cyan, tool_done: `  ✓ completed` in dim
- [x] 7.4 Command events: `$ <cmd>` in blue, command_done exit 0 in green, non-zero in red
- [x] 7.5 File change events: `✎ <path> (<action>)` in yellow
- [x] 7.6 Message events: full text as white block with left border (pipe character)
- [x] 7.7 Reasoning events: dim italic with bullet list for each section
- [x] 7.8 Completed events: `● completed at <timestamp>` in green (success) or red (failure)
- [x] 7.9 Print a header line on startup: `Codex Observer — <jobId> — <status>`

## 8. Observe Subcommand: Live Tailing

- [x] 8.1 Implement `tailEventStream(eventFile, onEvent)` function that watches the file and calls `onEvent` for new events
- [x] 8.2 Try `fs.watch(eventFile)` first; on error, fall back to `setInterval` polling at 500ms
- [x] 8.3 On each file change notification, call `readEventsFromOffset` with the last known offset, render new events, update offset
- [x] 8.4 Debounce `fs.watch` callbacks by 100ms to coalesce rapid writes
- [x] 8.5 Detect `completed` event type and exit the observer after rendering it

## 9. Observe Subcommand: Signal Handling and Lifecycle

- [x] 9.1 Register SIGINT handler: print "Observer detached. Codex task continues." in dim text, exit with code 0
- [x] 9.2 For completed jobs (status `completed` or `failed`), render full event history and exit immediately (no tail mode)
- [x] 9.3 Handle unhandled errors: print to stderr, exit with code 1, do not affect Codex process

## 10. Observe Subcommand: Registration

- [x] 10.1 Add `observe` case to the subcommand dispatch in `codex-companion.mjs`
- [x] 10.2 Add `observe [jobId] [--cwd <path>]` line to the `printUsage()` output
- [x] 10.3 Wire argument parsing for observe (positional jobId, --cwd flag)

## 11. Testing

- [x] 11.1 Write unit tests for `event-stream.mjs`: createEventStream, emitEvent, write failure handling
- [x] 11.2 Write unit tests for `readEventsFromOffset`: normal parsing, empty file, missing file, malformed lines
- [x] 11.3 Write unit tests for `renderEvent`: each event type produces expected ANSI output
- [x] 11.4 Write integration test: start a fake job with event stream, run observe, verify rendered output matches expected events
- [x] 11.5 Verify existing tests still pass (`npm test`)
