import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectTerminal,
  buildTmuxSplitArgs,
  buildGhosttyMacArgs,
  buildIterm2MacArgs,
  composeShellInvocation,
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

  it("invokes Ghostty through osascript with tty-targeted split and new-window fallback branches", () => {
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
    assert.match(script, /repeat with t in terminals/);
    assert.match(script, /tty of t/);
    assert.match(script, /\/dev\/ttys123/);
    assert.match(script, /split matched direction right/);
    assert.match(script, /new window/);
    assert.match(script, /input text "cd '\/p' && 'node' 'x' 'observe'\\n" to newTerm/);
  });

  it("invokes iTerm2 through osascript with tty-targeted split and new-window fallback branches", () => {
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
    assert.match(script, /repeat with w in windows/);
    assert.match(script, /repeat with s in sessions of w/);
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

  it("embeds the discovered caller tty in the AppleScript comparison", () => {
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

    assert.match(scriptFromArgs(calls[0].args), /set targetTty to "\/dev\/ttys999"/);
  });

  it("builds the new-window branch only when caller tty cannot be discovered", () => {
    const calls = [];
    spawnObserverInTerminal({
      cwd: "/p",
      command: "'node' 'x'",
      env: { TERM_PROGRAM: "ghostty" },
      platform: "darwin",
      discoverTty: () => null,
      runner: (cmd, args) => {
        calls.push({ cmd, args });
        return { status: 0 };
      }
    });

    const script = scriptFromArgs(calls[0].args);
    assert.doesNotMatch(script, /repeat with/);
    assert.doesNotMatch(script, /split matched/);
    assert.match(script, /set newTerm to new window/);
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
