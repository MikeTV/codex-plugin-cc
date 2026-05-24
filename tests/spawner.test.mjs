import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectTerminal,
  buildTmuxSplitArgs,
  spawnObserverInTerminal
} from "../plugins/codex/scripts/lib/spawner.mjs";

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
});
