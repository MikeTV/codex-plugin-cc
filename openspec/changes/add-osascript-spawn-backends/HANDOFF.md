# HANDOFF: add-osascript-spawn-backends

## What was implemented

- §1: Added RED-first coverage in `tests/spawner.test.mjs` and `tests/observe.test.mjs` for detection, precedence, osascript dispatch, AppleScript escaping, shell composition, control-character rejection, tty-targeting, permission-denied classification, and observe permission UX.
- §2: Refactored `spawner.mjs` to a backend strategy table for `tmux`, `ghostty-mac`, and `iterm2-mac`, keeping tmux cwd/command as separate exec args.
- §3: Added shared helpers: `composeShellInvocation`, `rejectControlChars`, `discoverCallerTty`, `escapeAppleScriptLiteral`, and `osascriptArgsFromLines`.
- §4: Added `ghostty-mac` osascript backend with tty-match split, new-window fallback, and permission-denied classification.
- §5: Added `iterm2-mac` osascript backend with tty-match split, new-window fallback, and permission-denied classification.
- §6: Updated observe spawn reporting with per-backend success labels, Automation permission messaging without copy-paste fallback, and unsafe-command messaging with fallback.
- §7: Ran build, targeted tests, tmux smoke, and attempted full suite twice; see verification notes.
- §8: Updated observe docs, bumped version metadata to 1.4.0, and ran `npm run check-version`.

## What was tested and passed

- RED proof before implementation: `node --test tests/spawner.test.mjs tests/observe.test.mjs` failed on missing exports (`buildGhosttyMacArgs`, `handleObserveSpawn`) before implementation.
- `npm run build`: passed (`tsc -p tsconfig.app-server.json` completed with exit 0).
- `node --test tests/spawner.test.mjs tests/observe.test.mjs`: passed, 57 tests / 10 suites / 0 failures.
- `node scripts/bump-version.mjs 1.4.0 && npm run check-version`: passed, all version metadata matches 1.4.0.
- §7.4 tmux regression smoke: passed from inside a detached tmux session; output was `✓ Observer launched in tmux pane (job task-fake)`.

Full `npm test` status:
- Attempt 1 was terminated after it stopped producing output with only `tests/runtime.test.mjs` active.
- Attempt 2 used a 90-second watchdog. It reached 38 passing top-level tests, then timed out with `__TIMEOUT__` and no final TAP summary. Isolated `node --test tests/runtime.test.mjs` also hung without emitting subtest results. No full-suite pass count is available from this environment.

## What was SKIPPED and why

- §0 spike: skipped as requested; validating Ghostty/iTerm2 AppleScript dictionaries requires real terminal apps.
- §7.5 Ghostty Mac smoke: skipped as requested; requires a human at a real Ghostty/macOS Automation environment.
- §7.6 iTerm2 Mac smoke: skipped as requested; requires a human at a real iTerm2/macOS Automation environment.

## Open items for Claude to handle

- §9.1: Run final scoped diff/stat review.
- §9.2: Cross-check tasks/spec scenarios against implementation diff.
- §9.3: Run dual-model review (`/codex:review` and `/ai-code-review` or code-reviewer).
- §9.4: Run implementation-level adversarial review.
- §9.6: Archive with `/opsx:archive add-osascript-spawn-backends` after merge.
- Investigate the existing `tests/runtime.test.mjs` hang or rerun `npm test` in a known-good environment; this implementation did not touch runtime code, but full-suite verification could not complete here.

## Ghostty/iTerm2 version assumptions

- Ghostty backend relies on AppleScript `tell application "Ghostty"`, `terminals`, `tty of <terminal>`, `split <terminal> direction right`, `new window`, and `input text`.
- iTerm2 backend relies on AppleScript `tell application "iTerm"`, `windows`, `sessions of <window>`, `tty of <session>`, `split vertically with default profile`, `create window with default profile`, `current session of <window>`, and `write text`.
- Ghostty AppleScript reference: https://ghostty.org/docs/features/applescript
- No real Ghostty or iTerm2 version was probed in this environment.

## Scenario-to-test self-pass

- Terminal detection: `detects tmux when $TMUX is set`, `detects ghostty-mac on macOS Ghostty without tmux`, `detects iterm2-mac on macOS iTerm2 without tmux`, `returns none for mac terminal names on non-darwin platforms`, existing none tests.
- Detection precedence: `selects tmux before Ghostty when both signals are present`, `selects tmux before iTerm2 when both signals are present`.
- Backend dispatch: tmux existing runner test; Ghostty/iTerm2 osascript runner tests.
- Spawn success/failure: tmux success and failure tests; osascript permission tests; existing runner-error test.
- No-supported-terminal fallback: existing no-runner test.
- AppleScript escaping: Ghostty/iTerm2 escaping tests and layer-order test.
- Shell-safe composition: compose helper tests for spaces, single quotes, metacharacters, unicode, token preservation, and command metacharacter preservation.
- Caller-terminal targeting: discovered-tty embedding test and null-tty new-window-only test.
- Control-character rejection: newline, NUL, carriage return, and tab/space allowed tests.
- Automation-permission messaging: spawner permission classification tests and observe dedicated-message test.
