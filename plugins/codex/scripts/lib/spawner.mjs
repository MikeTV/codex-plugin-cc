import { execFileSync, spawnSync } from "node:child_process";

const BACKENDS = [
  {
    kind: "tmux",
    cmd: "tmux",
    detect: (env) => Boolean(env.TMUX && env.TMUX.length > 0),
    build: buildTmuxSplitArgs,
    classifyFailure: classifyTmuxFailure
  },
  {
    kind: "ghostty-mac",
    cmd: "osascript",
    detect: (env, platform) => platform === "darwin" && !env.TMUX && env.TERM_PROGRAM === "ghostty",
    build: buildGhosttyMacArgs,
    classifyFailure: classifyGhosttyFailure
  },
  {
    kind: "iterm2-mac",
    cmd: "osascript",
    detect: (env, platform) => platform === "darwin" && !env.TMUX && env.TERM_PROGRAM === "iTerm.app",
    build: buildIterm2MacArgs,
    classifyFailure: classifyIterm2Failure
  }
];

export function detectTerminal(env = process.env, platform = process.platform) {
  const backend = BACKENDS.find((candidate) => candidate.detect(env, platform));
  return { kind: backend?.kind ?? "none" };
}

export function buildTmuxSplitArgs({ cwd, command }) {
  return ["split-window", "-h", "-c", cwd, command];
}

export function composeShellInvocation({ cwd, command }) {
  return `cd ${shellQuote(cwd)} && ${command}`;
}

export function rejectControlChars(value) {
  const str = String(value);
  for (let index = 0; index < str.length; index += 1) {
    const code = str.charCodeAt(index);
    if (code >= 0x00 && code <= 0x1f && code !== 0x09) {
      return { ok: false, byte: code, index };
    }
  }
  return { ok: true };
}

export function discoverCallerTty({
  startPid = process.pid,
  runProbe = defaultRunProbe
} = {}) {
  let pid = startPid;
  for (let depth = 0; depth < 10; depth += 1) {
    if (!pid || pid <= 1) {
      return null;
    }

    let output;
    try {
      output = runProbe("ps", ["-o", "tty=,ppid=", "-p", String(pid)]);
    } catch {
      return null;
    }

    const parsed = parsePsTtyOutput(output);
    if (!parsed) {
      return null;
    }

    if (parsed.tty && parsed.tty !== "?" && parsed.tty !== "??") {
      return parsed.tty.startsWith("/dev/") ? parsed.tty : `/dev/${parsed.tty}`;
    }

    pid = parsed.ppid;
  }
  return null;
}

function defaultRunProbe(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 250 });
}

function parsePsTtyOutput(output) {
  const line = String(output).trim().split("\n").find(Boolean);
  if (!line) {
    return null;
  }
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const ppid = Number(parts[parts.length - 1]);
  return { tty: parts.slice(0, -1).join(" "), ppid: Number.isFinite(ppid) ? ppid : null };
}

export function escapeAppleScriptLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function osascriptArgsFromLines(lines) {
  return lines.flatMap((line) => ["-e", line]);
}

export function buildGhosttyMacArgs({ composed, callerTty: _callerTty }) {
  // Ghostty 1.3's terminal object exposes id/name/working directory only —
  // there is no `tty` property. Until upstream adds one, always open a new
  // window. `new window` returns a window, so we drill down to a terminal
  // before calling `input text`.
  const literal = escapeAppleScriptLiteral(composed);
  const lines = [
    'tell application "Ghostty"',
    "activate",
    "set newWin to new window",
    "set newTerm to terminal 1 of selected tab of newWin",
    `input text "${literal}\\n" to newTerm`,
    "end tell"
  ];

  return osascriptArgsFromLines(lines);
}

export function buildIterm2MacArgs({ composed, callerTty }) {
  // iTerm2 object model: window -> tabs -> sessions. `sessions` is NOT an
  // element of `window`; it lives on `tab`. Traversal must nest through
  // tabs to find a session whose `tty` matches the caller.
  const literal = escapeAppleScriptLiteral(composed);
  const lines = [
    'tell application "iTerm"',
    "activate"
  ];

  if (callerTty) {
    lines.push(
      `set targetTty to "${escapeAppleScriptLiteral(callerTty)}"`,
      "set matched to missing value",
      "repeat with w in windows",
      "repeat with tb in tabs of w",
      "repeat with s in sessions of tb",
      "if tty of s is targetTty then",
      "set matched to s",
      "exit repeat",
      "end if",
      "end repeat",
      "if matched is not missing value then exit repeat",
      "end repeat",
      "if matched is not missing value then exit repeat",
      "end repeat",
      "if matched is not missing value then",
      "tell matched",
      "set newSession to split vertically with default profile",
      "end tell",
      "else",
      "set newWindow to create window with default profile",
      "set newSession to current session of newWindow",
      "end if"
    );
  } else {
    lines.push(
      "set newWindow to create window with default profile",
      "set newSession to current session of newWindow"
    );
  }

  lines.push(
    `write text "${literal}" to newSession`,
    "end tell"
  );

  return osascriptArgsFromLines(lines);
}

export function spawnObserverInTerminal({
  cwd,
  command,
  env = process.env,
  platform = process.platform,
  runner = spawnSync,
  discoverTty = () => discoverCallerTty()
}) {
  const terminal = detectTerminal(env, platform);
  const backend = BACKENDS.find((candidate) => candidate.kind === terminal.kind);

  if (!backend) {
    return { spawned: false, kind: "none" };
  }

  if (backend.kind === "tmux") {
    const result = runner(backend.cmd, backend.build({ cwd, command }), { stdio: "ignore" });
    return classifySpawnResult({ backend, result });
  }

  const composed = composeShellInvocation({ cwd, command });
  const guard = rejectControlChars(composed);
  if (!guard.ok) {
    return {
      spawned: false,
      kind: backend.kind,
      reason: "unsafe-command",
      error: unsafeCommandMessage({ guard, composed })
    };
  }

  const callerTty = discoverTty();
  const result = runner(
    backend.cmd,
    backend.build({ composed, callerTty }),
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  return classifySpawnResult({ backend, result });
}

function classifySpawnResult({ backend, result }) {
  if (result.error) {
    return {
      spawned: false,
      kind: backend.kind,
      ...backend.classifyFailure(result)
    };
  }

  if (result.status === 0) {
    return { spawned: true, kind: backend.kind };
  }

  return {
    spawned: false,
    kind: backend.kind,
    ...backend.classifyFailure(result)
  };
}

function unsafeCommandMessage({ guard, composed }) {
  const byteName = controlByteName(guard.byte);
  const location = composed.lastIndexOf(" && ", guard.index) === -1 ? "cwd" : "command";
  return `composed command contains ${byteName} at ${location} offset ${guard.index}`;
}

function controlByteName(byte) {
  if (byte === 0x00) {
    return "NUL";
  }
  if (byte === 0x0a) {
    return "embedded newline";
  }
  if (byte === 0x0d) {
    return "carriage return";
  }
  return `control character 0x${byte.toString(16).padStart(2, "0")}`;
}

function classifyTmuxFailure({ status, error }) {
  if (error) {
    return { error: error.message ?? String(error) };
  }
  return { error: `tmux exited with status ${status}` };
}

export function classifyGhosttyFailure({ status, stderr, error }) {
  return classifyOsascriptFailure({ kind: "ghostty-mac", status, stderr, error });
}

export function classifyIterm2Failure({ status, stderr, error }) {
  return classifyOsascriptFailure({ kind: "iterm2-mac", status, stderr, error });
}

function classifyOsascriptFailure({ kind, status, stderr = "", error }) {
  if (error) {
    return { error: `Failed to drive ${kind}: ${error.message ?? String(error)}` };
  }
  const message = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "");
  if (message.includes("(-1743)") || /not authorized to send apple events/i.test(message)) {
    return {
      reason: "automation-permission-denied",
      error: `Automation permission needed for ${kind}`
    };
  }
  const detail = message.trim() ? `: ${message.trim()}` : "";
  return { error: `Failed to drive ${kind}: osascript exited with status ${status}${detail}` };
}

export function shellQuote(value) {
  const str = String(value);
  return `'${str.replace(/'/g, `'\\''`)}'`;
}
