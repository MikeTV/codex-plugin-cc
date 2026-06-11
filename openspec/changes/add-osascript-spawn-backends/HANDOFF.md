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

## Adversarial review findings + fix-forward (post-Codex review)

`/codex:adversarial-review` against the initial implementation surfaced three HIGH-severity AppleScript-object-model bugs. Confirmed against the published Ghostty 1.3 + iTerm2 dictionaries via Context7, then fixed in-place rather than rolling back:

1. **Ghostty terminal has no `tty` property** (Ghostty 1.3 dictionary documents `id`, `name`, `working directory` only). The first implementation generated `repeat with t in terminals … if tty of t is targetTty …`, which would throw at runtime in real Ghostty. Fix: `buildGhosttyMacArgs` no longer iterates terminals or matches by `tty`; it always opens a new window via `set newWin to new window` → `set newTerm to terminal 1 of selected tab of newWin` → `input text "<cmd>\n" to newTerm`. `callerTty` is accepted-but-ignored by the Ghostty builder.
2. **Ghostty `new window` returns a window, not a terminal.** The first implementation wrote `input text "…" to newWin` directly. AppleScript would refuse the cast at runtime. Fix: the script drills `set newTerm to terminal 1 of selected tab of newWin` before `input text … to newTerm`.
3. **iTerm2 `sessions` is NOT a direct element of `window`.** The first implementation generated `repeat with w in windows / repeat with s in sessions of w / …`. That AppleScript-compiles, but iterates an empty collection at runtime — the tty match would never fire, and every observer would fall through to the new-window path. Fix: `buildIterm2MacArgs` now nests `repeat with w in windows` → `repeat with tb in tabs of w` → `repeat with s in sessions of tb`, comparing `tty of s` to `targetTty`. Spec scenario asserts `tabs of w` appears before `sessions of tb` in the script source so the contract cannot regress.

Tests added/strengthened in `tests/spawner.test.mjs`:

- Ghostty contract assertions: `set newWin to new window`, `set newTerm to terminal 1 of selected tab of newWin`, `input text "…" to newTerm`, AND negative assertions `tty of t` and `repeat with t in terminals` MUST NOT appear.
- iTerm2 contract assertions: `repeat with w in windows`, `repeat with tb in tabs of w`, `repeat with s in sessions of tb`, plus a source-order assertion that `tabs of w` precedes `sessions of tb`.
- "Ghostty script does not embed caller tty" — ensures the discovered tty does not leak into the Ghostty AppleScript when discovery succeeds.
- New `describe("discoverCallerTty", ...)` block with 8 tests covering immediate-parent hit, walk past `??` ancestor, `/dev/` prefix preservation, ppid≤1 termination, runProbe throws, malformed output, depth-10 cap, and invalid `startPid` (closes Claude code-reviewer MEDIUM #1: "discoverCallerTty has no direct unit tests").

Spec + design synced:

- `specs/observer-spawner/spec.md` — Backend dispatch scenarios for both osascript backends rewritten to reflect the new contracts. Caller-terminal targeting requirement renamed `(iterm2-mac only)` and a new "Ghostty always uses new-window path" scenario added.
- `design.md` — Decision 7 split into iTerm2 (tty-match-or-new-window) and Ghostty (always new-window) paths with explicit reasoning. §Risks rows updated. New §Resolved Questions section captures: Ghostty `tty` confirmed absent in 1.3, iTerm2 `sessions` confirmed nested under `tab`, Ghostty `new window` confirmed returns a window not a terminal.

Test count after fix-forward: `node --test tests/spawner.test.mjs` reports 41/41 passing (was 25 from the initial implementation, +8 contract-shape tests, +8 discoverCallerTty tests).

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

## Ghostty/iTerm2 version assumptions (post-fix-forward)

- Ghostty backend relies on AppleScript verbs only: `tell application "Ghostty"`, `activate`, `new window`, `selected tab of <window>`, `terminal 1 of <tab>`, `input text "…" to <terminal>`. It does NOT use `terminals`, `tty of <terminal>`, or any `split` verb — Ghostty 1.3's terminal exposes no `tty` property, so reliable identity-based split is impossible. Ghostty backend always opens a new window.
- iTerm2 backend relies on `tell application "iTerm"`, `activate`, the nested traversal `windows → tabs of w → sessions of tb`, `tty of s`, `split vertically with default profile`, `create window with default profile`, `current session of <window>`, `write text "…" to <session>`. The traversal nesting is mandatory — iTerm2's object model puts `sessions` under `tab`, not directly under `window`.
- Ghostty AppleScript reference: https://ghostty.org/docs/features/applescript (Ghostty 1.3 — terminal properties documented as `id`, `name`, `working directory`).
- iTerm2 AppleScript reference verified via Context7 (`/websites/iterm2`).
- No real Ghostty or iTerm2 version was probed *in CI*; the AppleScript shape is locked by spec scenarios + unit tests rather than runtime smoke. §7.5 (Ghostty Mac smoke) and §7.6 (iTerm2 Mac smoke) remain as user-driven smoke gates.

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
