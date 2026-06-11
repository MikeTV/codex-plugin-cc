import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectTerminal,
  buildTmuxSplitArgs,
  buildGhosttyMacArgs,
  buildIterm2MacArgs,
  composeShellInvocation,
  discoverCallerTty,
  spawnObserverInTerminal
} from "../plugins/codex/scripts/lib/spawner.mjs";

function scriptFromArgs(args) {
  const lines = [];
  for (let i = 0; i < args.length; i += 2) {
    assert.equal(args[i], "-e");
    lines.push(args[i + 1]);
  }
  return lines.join("\n");
}

describe("detectTerminal", () => {
  it("detects tmux when $TMUX is set", () => {
    const result = detectTerminal({ TMUX: "/tmp/tmux-1000/default,1234,0" });
    assert.equal(result.kind, "tmux");
  });

  it("returns none when $TMUX is unset", () => {
    const result = detectTerminal({});
    assert.equal(result.kind, "none");
  });

  it("returns none when $TMUX is empty string", () => {
    const result = detectTerminal({ TMUX: "" });
    assert.equal(result.kind, "none");
  });

  it("detects ghostty-mac on macOS Ghostty without tmux", () => {
    const result = detectTerminal({ TERM_PROGRAM: "ghostty" }, "darwin");
    assert.equal(result.kind, "ghostty-mac");
  });

  it("detects iterm2-mac on macOS iTerm2 without tmux", () => {
    const result = detectTerminal({ TERM_PROGRAM: "iTerm.app" }, "darwin");
    assert.equal(result.kind, "iterm2-mac");
  });

  it("returns none for mac terminal names on non-darwin platforms", () => {
    assert.equal(detectTerminal({ TERM_PROGRAM: "ghostty" }, "linux").kind, "none");
    assert.equal(detectTerminal({ TERM_PROGRAM: "iTerm.app" }, "linux").kind, "none");
  });
});

describe("Detection precedence", () => {
  it("selects tmux before Ghostty when both signals are present", () => {
    const result = detectTerminal({ TMUX: "x", TERM_PROGRAM: "ghostty" }, "darwin");
    assert.equal(result.kind, "tmux");
  });

  it("selects tmux before iTerm2 when both signals are present", () => {
    const result = detectTerminal({ TMUX: "x", TERM_PROGRAM: "iTerm.app" }, "darwin");
    assert.equal(result.kind, "tmux");
  });
});

describe("buildTmuxSplitArgs", () => {
  it("produces split-window -h with cwd and command", () => {
    const args = buildTmuxSplitArgs({
      cwd: "/path/to/project",
      command: "node /abs/companion.mjs observe abc123"
    });
    assert.deepEqual(args, [
      "split-window",
      "-h",
      "-c",
      "/path/to/project",
      "node /abs/companion.mjs observe abc123"
    ]);
  });
});

describe("spawnObserverInTerminal", () => {
  it("invokes tmux when inside tmux and reports success", () => {
    const calls = [];
    const runner = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0 };
    };

    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "node x observe",
      env: { TMUX: "x" },
      runner
    });

    assert.equal(result.spawned, true);
    assert.equal(result.kind, "tmux");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, "tmux");
    assert.deepEqual(calls[0].args, [
      "split-window",
      "-h",
      "-c",
      "/p",
      "node x observe"
    ]);
  });

  it("reports failure when tmux exits non-zero", () => {
    const runner = () => ({ status: 1 });
    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "node x observe",
      env: { TMUX: "x" },
      runner
    });

    assert.equal(result.spawned, false);
    assert.equal(result.kind, "tmux");
    assert.ok(result.error);
  });

  it("reports failure with error message when runner throws an error object", () => {
    const runner = () => ({ status: null, error: new Error("tmux not installed") });
    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "node x observe",
      env: { TMUX: "x" },
      runner
    });

    assert.equal(result.spawned, false);
    assert.match(result.error, /tmux not installed/);
  });

  it("does not invoke runner when not inside tmux", () => {
    let called = false;
    const runner = () => {
      called = true;
      return { status: 0 };
    };

    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "node x observe",
      env: {},
      runner
    });

    assert.equal(called, false);
    assert.equal(result.spawned, false);
    assert.equal(result.kind, "none");
  });

  it("invokes Ghostty through osascript with new-window-only flow", () => {
    const calls = [];
    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x' 'observe'",
      env: { TERM_PROGRAM: "ghostty" },
      platform: "darwin",
      discoverTty: () => "/dev/ttys123",
      runner: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0 };
      }
    });

    assert.deepEqual(result, { spawned: true, kind: "ghostty-mac" });
    assert.equal(calls[0].cmd, "osascript");
    assert.deepEqual(calls[0].opts, { stdio: ["ignore", "ignore", "pipe"] });

    const script = scriptFromArgs(calls[0].args);
    assert.match(script, /tell application "Ghostty"/);
    // Ghostty's terminal object has no `tty` property as of 1.3, so the
    // implementation does not perform tty-based matching.
    assert.doesNotMatch(script, /tty of t/);
    assert.doesNotMatch(script, /repeat with t in terminals/);
    // new window returns a window — input text must target a terminal.
    assert.match(script, /set newWin to new window/);
    assert.match(script, /set newTerm to terminal 1 of selected tab of newWin/);
    assert.match(script, /input text "cd '\/p' && 'node' 'x' 'observe'\\n" to newTerm/);
  });

  it("invokes iTerm2 through osascript with nested-tabs traversal and new-window fallback", () => {
    const calls = [];
    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x' 'observe'",
      env: { TERM_PROGRAM: "iTerm.app" },
      platform: "darwin",
      discoverTty: () => "/dev/ttys456",
      runner: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0 };
      }
    });

    assert.deepEqual(result, { spawned: true, kind: "iterm2-mac" });
    assert.equal(calls[0].cmd, "osascript");
    assert.deepEqual(calls[0].opts, { stdio: ["ignore", "ignore", "pipe"] });

    const script = scriptFromArgs(calls[0].args);
    assert.match(script, /tell application "iTerm"/);
    // iTerm2 object model is window -> tabs -> sessions; sessions is NOT
    // directly an element of window. The traversal must nest through tabs.
    assert.match(script, /repeat with w in windows/);
    assert.match(script, /repeat with tb in tabs of w/);
    assert.match(script, /repeat with s in sessions of tb/);
    // tabs-of must appear before sessions-of in the script source so the
    // outer loop is over tabs.
    assert.ok(
      script.indexOf("tabs of w") < script.indexOf("sessions of tb"),
      "tabs of w should be iterated before sessions of tb"
    );
    assert.match(script, /tty of s/);
    assert.match(script, /\/dev\/ttys456/);
    assert.match(script, /split vertically with default profile/);
    assert.match(script, /create window with default profile/);
    assert.match(script, /write text "cd '\/p' && 'node' 'x' 'observe'" to newSession/);
  });

  it("returns unsafe-command and does not invoke runner for newline in cwd", () => {
    let called = false;
    const result = spawnObserverInTerminal({
      cwd: "/tmp/foo\nbar",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "ghostty" },
      platform: "darwin",
      discoverTty: () => "/dev/ttys1",
      runner: () => {
        called = true;
        return { status: 0 };
      }
    });

    assert.equal(called, false);
    assert.equal(result.spawned, false);
    assert.equal(result.kind, "ghostty-mac");
    assert.equal(result.reason, "unsafe-command");
    assert.match(result.error, /newline/i);
    assert.match(result.error, /cwd/i);
  });

  it("returns unsafe-command and does not invoke runner for NUL in cwd", () => {
    let called = false;
    const result = spawnObserverInTerminal({
      cwd: "/tmp/foo\0bar",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "ghostty" },
      platform: "darwin",
      discoverTty: () => null,
      runner: () => {
        called = true;
        return { status: 0 };
      }
    });

    assert.equal(called, false);
    assert.equal(result.reason, "unsafe-command");
    assert.match(result.error, /NUL/i);
  });

  it("returns unsafe-command and does not invoke runner for carriage return in command", () => {
    let called = false;
    const result = spawnObserverInTerminal({
      cwd: "/tmp",
      command: "'node'\r'x'",
      env: { TERM_PROGRAM: "iTerm.app" },
      platform: "darwin",
      discoverTty: () => null,
      runner: () => {
        called = true;
        return { status: 0 };
      }
    });

    assert.equal(called, false);
    assert.equal(result.kind, "iterm2-mac");
    assert.equal(result.reason, "unsafe-command");
    assert.match(result.error, /carriage return|control character/i);
  });

  it("allows tab and space in composed command and invokes runner", () => {
    let called = false;
    const result = spawnObserverInTerminal({
      cwd: "/tmp/dir with space",
      command: "'node'\t'x'",
      env: { TERM_PROGRAM: "ghostty" },
      platform: "darwin",
      discoverTty: () => null,
      runner: () => {
        called = true;
        return { status: 0 };
      }
    });

    assert.equal(called, true);
    assert.equal(result.spawned, true);
  });

  it("embeds the discovered caller tty in the iTerm2 AppleScript comparison", () => {
    const calls = [];
    spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "iTerm.app" },
      platform: "darwin",
      discoverTty: () => "/dev/ttys999",
      runner: (cmd, args) => {
        calls.push({ cmd, args });
        return { status: 0 };
      }
    });

    assert.match(scriptFromArgs(calls[0].args), /set targetTty to "\/dev\/ttys999"/);
  });

  it("Ghostty script does not embed caller tty because Ghostty has no tty property", () => {
    const calls = [];
    spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "ghostty" },
      platform: "darwin",
      discoverTty: () => "/dev/ttys999",
      runner: (cmd, args) => {
        calls.push({ cmd, args });
        return { status: 0 };
      }
    });

    const script = scriptFromArgs(calls[0].args);
    assert.doesNotMatch(script, /\/dev\/ttys999/);
    assert.doesNotMatch(script, /targetTty/);
  });

  it("builds the iTerm2 new-window branch when caller tty cannot be discovered", () => {
    const calls = [];
    spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "iTerm.app" },
      platform: "darwin",
      discoverTty: () => null,
      runner: (cmd, args) => {
        calls.push({ cmd, args });
        return { status: 0 };
      }
    });

    const script = scriptFromArgs(calls[0].args);
    assert.doesNotMatch(script, /repeat with/);
    assert.doesNotMatch(script, /split vertically/);
    assert.match(script, /create window with default profile/);
    assert.match(script, /set newSession to current session of newWindow/);
  });

  it("classifies osascript error number -1743 as automation-permission-denied", () => {
    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "ghostty" },
      platform: "darwin",
      discoverTty: () => null,
      runner: () => ({ status: 1, stderr: "(-1743) Not authorized to send Apple events to Ghostty" })
    });

    assert.equal(result.spawned, false);
    assert.equal(result.kind, "ghostty-mac");
    assert.equal(result.reason, "automation-permission-denied");
    assert.match(result.error, /Automation permission/i);
  });

  it("classifies lowercase not authorized phrase as automation-permission-denied", () => {
    const result = spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "iTerm.app" },
      platform: "darwin",
      discoverTty: () => null,
      runner: () => ({ status: 1, stderr: "not authorized to send apple events" })
    });

    assert.equal(result.spawned, false);
    assert.equal(result.kind, "iterm2-mac");
    assert.equal(result.reason, "automation-permission-denied");
  });
});

describe("composeShellInvocation", () => {
  it("quotes cwd with spaces", () => {
    const result = composeShellInvocation({
      cwd: "/Users/dragon.cl/work projects/codex-plugin-cc",
      command: "'/abs/node' '/abs/companion.mjs' 'observe' 'task-abc'"
    });

    assert.equal(
      result,
      "cd '/Users/dragon.cl/work projects/codex-plugin-cc' && '/abs/node' '/abs/companion.mjs' 'observe' 'task-abc'"
    );
  });

  it("escapes a single quote in cwd", () => {
    const result = composeShellInvocation({
      cwd: "/tmp/it's-a-trap",
      command: "'/abs/node' '/abs/companion.mjs' 'observe' 'task-abc'"
    });

    assert.ok(result.startsWith("cd '/tmp/it'\\''s-a-trap' && "));
  });

  it("keeps cwd shell metacharacters inside the quoted literal", () => {
    const result = composeShellInvocation({
      cwd: "/tmp/foo;rm -rf /;",
      command: "'node'"
    });

    assert.equal(result, "cd '/tmp/foo;rm -rf /;' && 'node'");
  });

  it("preserves unicode cwd bytes verbatim", () => {
    const result = composeShellInvocation({
      cwd: "/Users/田中/プロジェクト",
      command: "'node'"
    });

    assert.equal(result, "cd '/Users/田中/プロジェクト' && 'node'");
  });

  it("preserves pre-quoted command tokens byte-for-byte", () => {
    const command = "'/abs/node' '/abs/companion.mjs' 'observe' 'task-abc'";
    const result = composeShellInvocation({ cwd: "/tmp", command });

    assert.ok(result.endsWith(` && ${command}`));
  });

  it("does not add another shell-quote layer around command tokens with metacharacters", () => {
    const command = "'/abs/node' '/abs/companion.mjs' 'observe' 'task with$weird;chars'";
    const result = composeShellInvocation({ cwd: "/tmp", command });

    assert.ok(result.endsWith(` && ${command}`));
  });

  it("feeds the composed shell invocation into AppleScript escaping in order", () => {
    const composed = composeShellInvocation({
      cwd: "/tmp/project",
      command: "'node' 'say \"hi\" and C:\\tmp'"
    });
    const script = scriptFromArgs(buildGhosttyMacArgs({ composed, callerTty: null }));

    assert.match(script, /input text "cd '\/tmp\/project' && 'node' 'say \\"hi\\" and C:\\\\tmp'\\n"/);
  });
});

describe("discoverCallerTty", () => {
  it("returns the tty of the immediate parent when ps yields a real device", () => {
    const calls = [];
    const runProbe = (cmd, args) => {
      calls.push({ cmd, args });
      return "ttys004 4242\n";
    };
    const tty = discoverCallerTty({ startPid: 9999, runProbe });
    assert.equal(tty, "/dev/ttys004");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["-o", "tty=,ppid=", "-p", "9999"]);
  });

  it("walks past a `??` ancestor to find a real tty further up", () => {
    const responses = new Map([
      ["100", "?? 50\n"],
      ["50", "ttys010 1\n"]
    ]);
    const seen = [];
    const runProbe = (_cmd, args) => {
      const pid = args[args.length - 1];
      seen.push(pid);
      const out = responses.get(pid);
      if (!out) {
        throw new Error(`unexpected probe pid=${pid}`);
      }
      return out;
    };
    const tty = discoverCallerTty({ startPid: 100, runProbe });
    assert.equal(tty, "/dev/ttys010");
    assert.deepEqual(seen, ["100", "50"]);
  });

  it("returns the tty unchanged when ps already includes the /dev/ prefix", () => {
    const runProbe = () => "/dev/ttys020 4242\n";
    assert.equal(
      discoverCallerTty({ startPid: 9999, runProbe }),
      "/dev/ttys020"
    );
  });

  it("returns null when ancestry hits ppid <= 1 without a real tty", () => {
    const responses = new Map([
      ["123", "?? 1\n"]
    ]);
    const runProbe = (_cmd, args) => responses.get(args[args.length - 1]);
    assert.equal(discoverCallerTty({ startPid: 123, runProbe }), null);
  });

  it("returns null when runProbe throws", () => {
    const runProbe = () => {
      throw new Error("ps not available");
    };
    assert.equal(discoverCallerTty({ startPid: 9999, runProbe }), null);
  });

  it("returns null when ps output is empty or malformed", () => {
    assert.equal(discoverCallerTty({ startPid: 9999, runProbe: () => "" }), null);
    assert.equal(discoverCallerTty({ startPid: 9999, runProbe: () => "garbage\n" }), null);
  });

  it("caps walk depth at 10 ancestors and returns null on overrun", () => {
    let probes = 0;
    const runProbe = () => {
      probes += 1;
      // Each level reports `??` and bumps to a fresh nonzero ppid, forcing
      // the loop to exhaust its depth budget.
      return `?? ${100 + probes}\n`;
    };
    assert.equal(discoverCallerTty({ startPid: 1000, runProbe }), null);
    assert.equal(probes, 10);
  });

  it("returns null when startPid is invalid", () => {
    const runProbe = () => {
      throw new Error("should not be called");
    };
    assert.equal(discoverCallerTty({ startPid: 0, runProbe }), null);
    assert.equal(discoverCallerTty({ startPid: 1, runProbe }), null);
    assert.equal(discoverCallerTty({ startPid: null, runProbe }), null);
  });
});

describe("build osascript args", () => {
  it("escapes double quotes and backslashes for Ghostty AppleScript literals", () => {
    const composed = "cd '/tmp' && 'node' 'say \"hi\" and C:\\tmp'";
    const script = scriptFromArgs(buildGhosttyMacArgs({ composed, callerTty: null }));

    assert.match(script, /say \\"hi\\" and C:\\\\tmp/);
  });

  it("escapes double quotes and backslashes for iTerm2 AppleScript literals", () => {
    const composed = "cd '/tmp' && 'node' 'say \"hi\" and C:\\tmp'";
    const script = scriptFromArgs(buildIterm2MacArgs({ composed, callerTty: null }));

    assert.match(script, /say \\"hi\\" and C:\\\\tmp/);
  });
});
