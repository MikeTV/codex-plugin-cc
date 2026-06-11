## Context

The 1.3.0 MVP introduced `plugins/codex/scripts/lib/spawner.mjs` with a single hardcoded tmux branch and a small detector that only reads `$TMUX`. The runner (default `spawnSync`) is injected as a parameter, which made the 8 unit tests trivial — every test passes a fake runner and a synthetic env.

This change adds two more backends (Ghostty on macOS, iTerm2 on macOS) without giving up the test ergonomics or changing the call site in `observe.mjs`. Both new backends share `osascript` as their transport, but their AppleScript dictionaries differ enough that they each need their own builder.

A first-pass version of this document was reviewed adversarially by Codex (verdict: `needs-attention`) before any implementation. Four findings drove material changes that this document reflects: (1) cwd needs **shell** quoting separate from AppleScript escaping; (2) silently splitting the *front* Ghostty/iTerm2 window is unsafe — the spawner must target the calling shell's terminal or fall back to opening a new window; (3) the first-run Automation-permission denial needs a dedicated UX, not a generic red-error + copy-paste hint; (4) the "arbitrary string safety" escaping claim was over-broad and must either narrow its input domain or reject control characters explicitly.

## Goals / Non-Goals

**Goals:**
- Add `ghostty-mac` and `iterm2-mac` backends behind the same `spawnObserverInTerminal(...)` entrypoint.
- Define detection precedence so users running tmux *inside* Ghostty still get the tmux split.
- Keep the runner/env injection pattern; every new branch must be unit-testable without invoking `osascript`.
- Surface the actual backend name in `handleObserveSpawn`'s success message so users know which path fired.
- Guarantee the spawned observer lands in the terminal that owns the calling shell — and when that cannot be proven, open a fresh window instead of splitting an unrelated front window.
- Compose `cd <cwd> && <command>` shell-safely first, AppleScript-escape second. Cwd paths with spaces, single quotes, unicode, or shell metacharacters must work.
- Treat first-run Automation-permission denial as an expected onboarding state with its own message ("grant access and retry"), not as a generic backend failure.
- Reject embedded newlines / control characters in the composed command before building AppleScript — better a structured `spawned: false` than a half-formed script.

**Non-Goals:**
- Linux Ghostty (`ghostty +new-window -e ...` — `-e` semantics need real-machine testing).
- WezTerm CLI, kitty remote-control, Terminal.app, generic `xdg-terminal-exec`.
- Configurable split direction, backend override flags (`--backend=...`), or `--no-spawn` opt-out.
- Touching the observer itself or `handleObserveCommand` outside the message strings.

## Decisions

### 1. Strategy table over if/elif chain

Each backend is a small record `{ detect, build, cmd, classifyFailure }`. `detectTerminal(env)` walks the table in priority order and returns the first hit. `spawnObserverInTerminal({ cwd, command, env, runner })` then drives a per-kind pipeline:

- **tmux backend** — receives `build({ cwd, command })`. No shell composition (tmux takes `-c <cwd>` as a separate `execve` arg and the command as another arg, so there is no shell-injection vector). Runner invoked with `{ stdio: 'ignore' }`. `classifyFailure` returns only generic errors.
- **osascript backends (`ghostty-mac`, `iterm2-mac`)** — dispatcher first calls `composed = composeShellInvocation({ cwd, command })`, then `rejectControlChars(composed)` (early-return `unsafe-command` on hit), then `callerTty = discoverCallerTty()`. The builder receives `{ composed, callerTty }` — never raw `cwd`/`command` — so composition cannot drift between dispatcher and backend. The Ghostty builder ignores `callerTty` (see Decision 7 — Ghostty 1.3's terminal has no `tty` property); the iTerm2 builder uses it to choose between the match-and-split path and the new-window path. Runner invoked with `{ stdio: ['ignore', 'ignore', 'pipe'] }` so stderr is captured for `classifyFailure`, which can return `automation-permission-denied` in addition to generic errors.

Both branches share the same outer success/failure return shape (`{ spawned, kind, reason?, error? }`).

Trade-off considered: an if/elif chain is two lines shorter for two backends, but it forces a duplicate switch in tests. The table makes "add the third backend" a one-record diff. Per-kind build-input shapes (tmux vs osascript) are deliberate — keeping them uniform would force tmux through `composeShellInvocation` for no benefit, or smuggle composition into the builder where it can drift.

### 2. Detection precedence: tmux > ghostty-mac > iterm2-mac > none

Reason: developers commonly run tmux *inside* a Ghostty or iTerm2 window. If we checked `$TERM_PROGRAM` first, we'd open a Ghostty/iTerm split next to a tmux pane — wrong window, wrong context. `$TMUX` being set is an explicit signal that the user has opted into a multiplexer, so it wins.

Alternative considered: prefer host emulator if both signals are present, because the host has more screen area. Rejected — context (cwd, env, ssh session) lives in the tmux pane, not at the emulator level.

### 3. Two-layer quoting: shell-safe first, AppleScript-safe second

The osascript backends end up running a shell command (`cd <cwd> && <command>`) in a freshly opened pane / window. There are *two* separate quoting domains: (a) POSIX shell parses the `cd ... && ...` string, and (b) AppleScript parses the surrounding `"..."` literal. They have different metacharacters; collapsing them into a single escape pass is what Codex flagged as unsafe.

**Pipeline (exact order, no exceptions):**

```
composeShellInvocation({ cwd, command })   ── Layer 1: shell-safe
        │
        ▼
rejectControlChars(<composed>)             ── Guard: reject 0x00–0x1F minus 0x09/0x20
        │  (return spawned:false, reason:'unsafe-command' on hit)
        ▼
escapeAppleScriptLiteral(<composed>)       ── Layer 2: AppleScript-safe
        │
        ▼
buildGhosttyMacArgs / buildIterm2MacArgs   ── interpolate into osascript -e ...
```

**Layer 1 — `composeShellInvocation({ cwd, command })`.** Returns exactly `cd ${shellQuote(cwd)} && ${command}`. Only `cwd` is shell-quoted at this layer; `command` is interpolated verbatim because it is **already** a space-joined sequence of individually `shellQuote`-ed argv tokens, produced by `buildObserverCommand` in `observe.mjs`. Re-wrapping `command` with `shellQuote` here would collapse the four argv tokens into a single literal string and break execution — a regression scenario in the spec asserts the token preservation.

Concretely:

```
cd '/Users/dragon.cl/work projects/codex-plugin-cc' && '/abs/path/node' '/abs/path/companion.mjs' 'observe' 'task-abc'
```

**Guard — `rejectControlChars(composed)`.** Runs on the composed string (after Layer 1, before Layer 2) so that control bytes embedded in `cwd` — which are only visible *after* shell quoting wraps them inside a single-quoted literal — are caught before they reach `input text` / `write text`. Scanning the raw `cwd` or raw `command` separately would miss the position-in-final-string information and risk subtle gaps. On any hit, the spawner returns `{ spawned: false, kind: <backend>, reason: 'unsafe-command', error: <message naming the byte and the location> }` and the runner is not invoked.

**Layer 2 — `escapeAppleScriptLiteral(composed)`.** Doubles `\` → `\\` and `"` → `\"` in the composed string, then the backend interpolates it into `input text "<escaped>\n" to newTerm` (Ghostty) or `write text "<escaped>" to newSession` (iTerm2, no trailing `\n` since iTerm2 adds Enter on `write text`).

Alternative considered: pass the command as an `osascript` positional argument and read it inside the script via `do shell script "echo " & quoted form of argv...`. Rejected — adds a third escaping layer (osascript's own argv handling) without removing either of the two above. Direct interpolation with explicit named layers + pipeline ordering is auditable.

### 4. One `-e` per logical AppleScript line

Easier to log (`runner` calls show each line), easier to compare in tests (`assert.deepEqual` on the args array), and stays portable across `osascript` versions.

### 5. Runner contract unchanged

`runner(cmd, args, opts) → { status, error? }` is the same signature the tmux backend uses. New backends just produce different `cmd` ('osascript') and `args` (the `-e` flags). The default runner (`spawnSync`) doesn't need to know which backend ran.

### 6. Generic backend failure → fall through to copy-paste hint

For non-permission failures the existing tmux shape stays: if the runner returns non-zero status or throws, the spawner returns `{ spawned: false, kind: <backend>, error: <message> }`, and `handleObserveSpawn` prints the red "Failed to drive <kind>" line followed by the existing fallback hint. Users always get a working path out. The two carve-outs below (Decision 7 target-window + Decision 8 permission-denied) take precedence when they apply.

### 7. Target the calling shell's terminal (iTerm2 only); fall back to a new window, not the front one

**Problem (from Codex review).** `/codex:observe` may be invoked from a Claude Code session running in a *different* window than the currently frontmost Ghostty / iTerm2 window. Naively running `tell application "Ghostty" to split focused terminal of front window …` then drops the observer into an unrelated project's terminal — wrong cwd, wrong context, confusing.

**Strategy.** Per-backend, because the two AppleScript dictionaries differ in what they expose:

1. **Discover the caller's tty.** The companion script walks up the process tree (`ps -o tty=,ppid= -p <pid>` repeatedly) until it finds the first ancestor with a real controlling tty (not `?` / `??`), and resolves that to `/dev/ttysNN`. This catches the common case where Claude Code spawns `bash` which spawns `node` — none of them own a tty, but the user's shell ancestor does. The walk is depth-capped at 10 ancestors and times out per-probe, so a stuck `ps` cannot block the spawner.

2. **iTerm2-targeted AppleScript.** The script is parameterised with the discovered tty. iTerm2's object model is `application → windows → tabs → sessions`; `sessions` is **NOT** a direct element of `window`, it lives on `tab`. The traversal therefore nests: `repeat with w in windows` → `repeat with tb in tabs of w` → `repeat with s in sessions of tb`, comparing `tty of s` to the discovered value. On match: `tell matched … set newSession to split vertically with default profile`. On no match: `set newWindow to create window with default profile` → `set newSession to current session of newWindow`.

3. **Ghostty: always new-window.** Ghostty 1.3's AppleScript dictionary lists per-terminal properties as `id`, `name`, `working directory` only — there is **no `tty` property** on the terminal object. Without `tty`, no reliable identity check is possible (matching by name/id would silently re-target on rename), so the Ghostty backend always opens a fresh window: `set newWin to new window` → `set newTerm to terminal 1 of selected tab of newWin` → `input text "<cmd>\n" to newTerm`. The drill-down through `selected tab` is required because `new window` returns a *window* object and `input text` requires a *terminal*. When upstream Ghostty adds a `tty` property, this exemption gets revisited and Ghostty rejoins the iTerm2-style match-or-new-window flow.

**Why new-window instead of "best effort split front window".** Splitting the wrong window is a silent failure with confusing output. Opening a new window is visibly different and never wrong — the observer just lives in its own window instead of next to the caller. The user can always grab it.

**When iTerm2 tty discovery itself fails** (uncommon: detached sessions, sandboxed shells without `ps` access), the spawner skips straight to the new-window branch with no `repeat` loop emitted. Same safety guarantee. Ghostty is unaffected — it never attempted matching to begin with.

### 8. Permission-denied is an onboarding state, not a failure

**Problem (from Codex review).** First-run `osascript` against Ghostty / iTerm2 triggers a macOS Automation permission prompt **and** returns non-zero. A naive failure handler shows the red "Failed to drive ghostty-mac: exited 1" line + copy-paste fallback at exactly the moment the user is being asked to click "Allow" — looks broken when it isn't.

**Detection.** Parse `osascript` stderr (which we now capture instead of piping to `/dev/null`) for either:

- `(-1743)` — the documented "user denied access to send AppleEvents" error number, OR
- the literal substring `not authorized to send Apple events` (case-insensitive)

**Behavior on match.**

- Spawner returns `{ spawned: false, kind: <backend>, reason: 'automation-permission-denied' }`.
- `handleObserveSpawn` prints a single dedicated line: `! macOS Automation permission needed for <Ghostty|iTerm2>. Open System Settings → Privacy & Security → Automation → Terminal/Claude Code, enable <App>, then rerun /codex:observe.`
- Does NOT print the generic copy-paste hint — retrying after permission is granted will succeed, and the copy-paste hint would imply "this is your only option."

**On non-permission failure** the original Decision 6 path applies (red error + copy-paste hint).

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Caller invokes `/codex:observe` from a non-frontmost Ghostty / iTerm2 window | Decision 7: tty-discovery + targeted AppleScript walks all terminals/sessions for a match. On no match, open a new window. Never split an unrelated front window. |
| First-run macOS Automation permission denial returns non-zero + shows a system prompt | Decision 8: detect `(-1743)` / "not authorized" in stderr, print a dedicated "grant access and retry" message, skip the generic copy-paste fallback (retry will work). |
| `tty` discovery itself fails (sandboxed shell, no `ps` access, detached daemon) | Skip straight to the new-window branch; no attempt to split. The observer always lands in a fresh, visible window with the right cwd. |
| Cwd contains spaces, single quotes, unicode, or shell metacharacters | Decision 3 Layer 1: `shellQuote` wraps cwd before composing `cd ... && ...`. Unit tests cover spaces, single quotes, unicode, and `;`/`$`/`` ` ``. |
| Caller-supplied command contains embedded newline / control chars | Decision 3 Control-char guard: reject before building AppleScript, return `{ spawned: false, error: 'unsafe-command' }`, fall through to copy-paste hint. Avoids the half-formed-script failure mode. |
| Ghostty AppleScript dictionary changes in a future release | Use only the documented stable verbs (`new window`, `selected tab`, `terminal`, `input text`, `activate`). Avoid `perform action "<keybind>"` (more brittle). Pin a "tested with Ghostty 1.3" note in tasks §6.5. |
| Ghostty's terminal object has no `tty` property (1.3 confirmed via Codex adversarial review + Context7) | Ghostty drops to new-window-only for this change. Decision 7 documents the reasoning; iTerm2 retains the tty-match path. Upstream feature request tracked separately; once `tty` lands, Ghostty rejoins match-or-new-window. |
| iTerm2 object model nests sessions under tabs, not windows directly | Decision 7: traversal nests `windows → tabs of w → sessions of tb`. A spec scenario asserts `tabs of w` appears before `sessions of tb` in the script source so the contract cannot regress to the (broken) `sessions of w` shape. |
| iTerm2 stable vs nightly dictionary differences | Test against the stable GA build. The verbs we use (`current session`, `split vertically with default profile`, `write text`, `tty of current session`) have been stable since iTerm2 3.x. |
| `tell application "<App>" to activate` steals focus | Accept it. The new split / window needs to be visible for the spawn to be useful; stealing focus into the target app is the documented AppleScript pattern. We only activate when we are about to spawn — never on probe / detection. |
| Job-id is interpolated into a shell+AppleScript string | Two-layer quoting (Decision 3) handles both domains. Job IDs are companion-generated (`task-[a-z0-9]+`); the quoting + control-char rejection are defense-in-depth in case that invariant ever loosens. |

## Migration Plan

Additive change. Tmux users see byte-identical behavior. Non-tmux macOS users on Ghostty/iTerm2 start getting auto-splits. The copy-paste fallback hint remains as the last line of defense for every other environment.

Rollback: revert the spawner.mjs diff. The 1.3.0 tmux MVP is preserved in git history; reverting only this change leaves tmux working.

## Resolved Questions

- **Does Ghostty expose a `tty` property on the terminal object?** No (Ghostty 1.3, confirmed by Codex adversarial review + Context7 dictionary lookup). The terminal object exposes `id`, `name`, `working directory` only. Decision 7 was updated to drop the Ghostty tty-match path; Ghostty always opens a new window. Reverts when upstream adds `tty`.
- **Does iTerm2 expose `sessions` as a direct element of `window`?** No. The object model is `windows → tabs → sessions`; the traversal must nest through `tabs of w` before `sessions of tb`. The earlier draft used `sessions of w`, which AppleScript-compiles fine but iterates an empty collection at runtime. Fixed in implementation; locked by spec scenario.
- **Does Ghostty's `new window` return a window or a terminal?** A *window*. `input text` requires a *terminal*, so the script drills via `set newTerm to terminal 1 of selected tab of newWin` before calling `input text "…" to newTerm`.

## Open Questions

- Should we add `--backend=<kind>` to force a specific backend (debugging aid)? Defer until someone asks.
- Should the split direction be configurable (`--split=down|right`)? Defer; `right` mirrors the tmux `-h` default and is the most common preference.
- Should we surface a one-time hint the first time we detect an unsupported terminal we *could* support later (e.g., WezTerm)? Out of scope for this change.
