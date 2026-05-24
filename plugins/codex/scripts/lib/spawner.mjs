import { spawnSync } from "node:child_process";

export function detectTerminal(env = process.env) {
  if (env.TMUX && env.TMUX.length > 0) {
    return { kind: "tmux" };
  }
  return { kind: "none" };
}

export function buildTmuxSplitArgs({ cwd, command }) {
  return ["split-window", "-h", "-c", cwd, command];
}

export function spawnObserverInTerminal({ cwd, command, env = process.env, runner = spawnSync }) {
  const terminal = detectTerminal(env);

  if (terminal.kind === "tmux") {
    const args = buildTmuxSplitArgs({ cwd, command });
    const result = runner("tmux", args, { stdio: "ignore" });

    if (result.error) {
      return {
        spawned: false,
        kind: "tmux",
        error: result.error.message ?? String(result.error)
      };
    }

    if (result.status === 0) {
      return { spawned: true, kind: "tmux" };
    }

    return {
      spawned: false,
      kind: "tmux",
      error: `tmux exited with status ${result.status}`
    };
  }

  return { spawned: false, kind: "none" };
}

export function shellQuote(value) {
  const str = String(value);
  return `'${str.replace(/'/g, `'\\''`)}'`;
}
