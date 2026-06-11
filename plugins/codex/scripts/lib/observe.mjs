import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./args.mjs";
import { EVENT_TYPES } from "./event-stream.mjs";
import { shellQuote, spawnObserverInTerminal } from "./spawner.mjs";
import { findJobByIdAcrossWorkspaces, loadState, resolveJobsDir } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const COMPANION_SCRIPT = fileURLToPath(new URL("../codex-companion.mjs", import.meta.url));

const POLL_INTERVAL_MS = 500;
const WATCH_DEBOUNCE_MS = 100;

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m"
};

const PHASE_SPINNERS = {
  starting: "⠋",
  investigating: "⠙",
  finalizing: "⠴",
  done: "✓",
  failed: "✗"
};

const PHASE_COLORS = {
  starting: ANSI.cyan,
  investigating: ANSI.yellow,
  finalizing: ANSI.green,
  done: ANSI.green,
  failed: ANSI.red
};

function renderPhase(event) {
  const phase = event.phase ?? "unknown";
  const spinner = PHASE_SPINNERS[phase] ?? "•";
  const color = PHASE_COLORS[phase] ?? ANSI.white;
  const message = event.message ?? "";
  return `${color}${spinner} ${phase}${ANSI.reset}${message ? `  ${ANSI.dim}${message}${ANSI.reset}` : ""}`;
}

function renderToolCall(event) {
  const tool = event.tool ?? "unknown";
  const extra = event.path ?? event.detail ?? "";
  return `${ANSI.cyan}→ ${tool}${extra ? ` ${extra}` : ""}${ANSI.reset}`;
}

function renderToolDone(_event) {
  return `${ANSI.dim}  ✓ completed${ANSI.reset}`;
}

function renderCommand(event) {
  const cmd = event.cmd ?? "";
  return `${ANSI.blue}$ ${cmd}${ANSI.reset}`;
}

function renderCommandDone(event) {
  const exit = event.exit ?? 0;
  const color = exit === 0 ? ANSI.green : ANSI.red;
  return `${color}  exit ${exit}${ANSI.reset}`;
}

function renderFileChange(event) {
  const filePath = event.path ?? "";
  const action = event.action ?? "";
  return `${ANSI.yellow}✎ ${filePath}${action ? ` (${action})` : ""}${ANSI.reset}`;
}

function renderMessage(event) {
  const text = event.text ?? event.logBody ?? event.message ?? "";
  if (!text) {
    return "";
  }
  return text
    .split("\n")
    .map((line) => `${ANSI.dim}│${ANSI.reset} ${line}`)
    .join("\n");
}

function renderReasoning(event) {
  const sections = event.sections ?? [];
  if (sections.length === 0) {
    return "";
  }
  return sections
    .map((section) => `${ANSI.dim}${ANSI.italic}• ${section}${ANSI.reset}`)
    .join("\n");
}

function renderCompleted(event) {
  const status = event.status ?? "unknown";
  const timestamp = event.t ?? "";
  const color = status === "success" ? ANSI.green : ANSI.red;
  const summary = event.summary ? `  ${ANSI.dim}${event.summary}${ANSI.reset}` : "";
  return `${color}● completed at ${timestamp}${ANSI.reset}${summary}`;
}

export function renderEvent(event) {
  const type = event.type ?? EVENT_TYPES.PHASE;
  switch (type) {
    case EVENT_TYPES.PHASE:
      return renderPhase(event);
    case EVENT_TYPES.TOOL_CALL:
      return renderToolCall(event);
    case EVENT_TYPES.TOOL_DONE:
      return renderToolDone(event);
    case EVENT_TYPES.COMMAND:
      return renderCommand(event);
    case EVENT_TYPES.COMMAND_DONE:
      return renderCommandDone(event);
    case EVENT_TYPES.FILE_CHANGE:
      return renderFileChange(event);
    case EVENT_TYPES.MESSAGE:
      return renderMessage(event);
    case EVENT_TYPES.REASONING:
      return renderReasoning(event);
    case EVENT_TYPES.COMPLETED:
      return renderCompleted(event);
    default:
      return event.message ? `${ANSI.dim}${event.message}${ANSI.reset}` : "";
  }
}

export function readEventsFromOffset(eventFile, offset = 0) {
  if (!eventFile || !fs.existsSync(eventFile)) {
    return { events: [], newOffset: 0 };
  }

  const content = fs.readFileSync(eventFile, "utf8");
  if (!content || offset >= content.length) {
    return { events: [], newOffset: content.length };
  }

  const newContent = content.slice(offset);
  const events = [];
  for (const line of newContent.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip malformed lines.
    }
  }

  return { events, newOffset: content.length };
}

function findLatestRunningJob(state) {
  const runningJobs = (state.jobs ?? []).filter((job) => job.status === "running");
  if (runningJobs.length === 0) {
    return null;
  }
  runningJobs.sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));
  return runningJobs[0];
}

function findJobById(state, jobId) {
  return (state.jobs ?? []).find((job) => job.id === jobId) ?? null;
}

function resolveEventFileForJob(cwd, job) {
  if (job.eventFile) {
    return job.eventFile;
  }
  const jobsDir = resolveJobsDir(cwd);
  return `${jobsDir}/${job.id}.events.jsonl`;
}

export function tailEventStream(eventFile, onEvent) {
  let offset = 0;
  let watcher = null;
  let pollTimer = null;
  let debounceTimer = null;
  let stopped = false;
  let onStopCallback = null;

  function processNewEvents() {
    if (stopped) {
      return;
    }
    const { events, newOffset } = readEventsFromOffset(eventFile, offset);
    offset = newOffset;
    for (const event of events) {
      onEvent(event);
      if (event.type === EVENT_TYPES.COMPLETED) {
        stop();
        return;
      }
    }
  }

  function startPolling() {
    pollTimer = setInterval(processNewEvents, POLL_INTERVAL_MS);
  }

  function startWatching() {
    try {
      watcher = fs.watch(eventFile, () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(processNewEvents, WATCH_DEBOUNCE_MS);
      });
      watcher.on("error", () => {
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        startPolling();
      });
    } catch {
      startPolling();
    }
  }

  // Read existing events first
  processNewEvents();

  // Start watching for new events
  if (!stopped && fs.existsSync(eventFile)) {
    startWatching();
  } else if (!stopped) {
    // File doesn't exist yet, poll until it appears
    pollTimer = setInterval(() => {
      if (fs.existsSync(eventFile)) {
        clearInterval(pollTimer);
        pollTimer = null;
        processNewEvents();
        if (!stopped) {
          startWatching();
        }
      }
    }, POLL_INTERVAL_MS);
  }

  function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    onStopCallback?.();
  }

  function onStop(callback) {
    onStopCallback = callback;
    if (stopped) {
      callback();
    }
  }

  return { stop, onStop, isStopped: () => stopped };
}

function buildObserverCommand({ positionals, options }) {
  const observerArgs = ["observe", ...positionals];
  if (options.cwd) {
    observerArgs.push("--cwd", options.cwd);
  }
  return [process.execPath, COMPANION_SCRIPT, ...observerArgs].map(shellQuote).join(" ");
}

function renderFallbackHint({ workspaceRoot, command }) {
  return [
    `${ANSI.dim}Not running inside a supported terminal (tmux, Ghostty on macOS, or iTerm2 on macOS).${ANSI.reset}`,
    "",
    "Open a new terminal window and run:",
    "",
    `  cd ${workspaceRoot}`,
    `  ${command}`,
    ""
  ].join("\n");
}

const SPAWN_SUCCESS_LABELS = {
  tmux: "tmux pane",
  "ghostty-mac": "Ghostty split or new window",
  "iterm2-mac": "iTerm2 split or new window"
};

const AUTOMATION_APP_LABELS = {
  "ghostty-mac": "Ghostty",
  "iterm2-mac": "iTerm2"
};

export async function handleObserveSpawn({
  positionals,
  options,
  workspaceRoot,
  spawner = spawnObserverInTerminal
}) {
  const command = buildObserverCommand({ positionals, options });
  const result = spawner({ cwd: workspaceRoot, command });

  if (result.spawned) {
    const target = positionals[0] ? `job ${positionals[0]}` : "latest running job";
    const label = SPAWN_SUCCESS_LABELS[result.kind] ?? result.kind;
    process.stdout.write(`${ANSI.green}✓ Observer launched in ${label}${ANSI.reset} (${target})\n`);
    return;
  }

  if (result.reason === "automation-permission-denied") {
    const app = AUTOMATION_APP_LABELS[result.kind] ?? result.kind;
    process.stdout.write(`! macOS Automation permission needed for ${app}. Open System Settings → Privacy & Security → Automation, enable ${app}, then rerun /codex:observe.\n`);
    return;
  }

  if (result.reason === "unsafe-command") {
    process.stdout.write(`${ANSI.red}✗ Refusing to spawn: composed command contains a control character (${result.error}). Run the command manually:${ANSI.reset}\n\n`);
  } else if (result.error) {
    const label = SPAWN_SUCCESS_LABELS[result.kind] ?? result.kind;
    process.stdout.write(`${ANSI.red}✗ Failed to open ${label}: ${result.error}${ANSI.reset}\n\n`);
  }

  process.stdout.write(renderFallbackHint({ workspaceRoot, command }));
}

export async function handleObserveCommand(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "spawn"]
  });

  const cwd = options.cwd ?? process.cwd();
  let workspaceRoot;
  try {
    workspaceRoot = resolveWorkspaceRoot(cwd);
  } catch {
    workspaceRoot = cwd;
  }

  if (options.spawn) {
    await handleObserveSpawn({ positionals, options, workspaceRoot });
    return;
  }

  const jobId = positionals[0] ?? null;
  const state = loadState(workspaceRoot);

  let job;
  let crossWorkspaceMatch = null;
  if (jobId) {
    job = findJobById(state, jobId);
    if (!job) {
      crossWorkspaceMatch = findJobByIdAcrossWorkspaces(jobId);
      if (crossWorkspaceMatch) {
        job = crossWorkspaceMatch.job;
      } else {
        process.stderr.write(`Error: Job not found: ${jobId}\n`);
        process.exitCode = 1;
        return;
      }
    }
  } else {
    job = findLatestRunningJob(state);
    if (!job) {
      process.stderr.write("No running Codex jobs found.\n");
      process.exitCode = 1;
      return;
    }
  }

  const eventFile = resolveEventFileForJob(workspaceRoot, job);
  const isCompleted = job.status === "completed" || job.status === "failed" || job.status === "cancelled";

  // Print header
  const statusColor = isCompleted ? (job.status === "completed" ? ANSI.green : ANSI.red) : ANSI.yellow;
  process.stdout.write(`${ANSI.dim}Codex Observer — ${job.id} — ${statusColor}${job.status}${ANSI.reset}\n`);
  if (crossWorkspaceMatch) {
    process.stdout.write(`${ANSI.dim}(job belongs to another workspace; reading from ${crossWorkspaceMatch.stateDir})${ANSI.reset}\n`);
  }
  process.stdout.write("\n");

  if (isCompleted) {
    // Render full history and exit
    const { events } = readEventsFromOffset(eventFile, 0);
    if (events.length === 0) {
      process.stdout.write(`${ANSI.dim}No events recorded for this job.${ANSI.reset}\n`);
    } else {
      for (const event of events) {
        const rendered = renderEvent(event);
        if (rendered) {
          process.stdout.write(`${rendered}\n`);
        }
      }
    }
    return;
  }

  // Live tail mode
  let waitingShown = false;
  if (!fs.existsSync(eventFile)) {
    process.stdout.write(`${ANSI.dim}Waiting for events...${ANSI.reset}\n`);
    waitingShown = true;
  }

  let firstEvent = true;
  const tail = tailEventStream(eventFile, (event) => {
    if (waitingShown && firstEvent) {
      // Clear the "waiting" line
      process.stdout.write("\x1b[1A\x1b[2K");
      waitingShown = false;
    }
    firstEvent = false;
    const rendered = renderEvent(event);
    if (rendered) {
      process.stdout.write(`${rendered}\n`);
    }
  });

  // SIGINT handler
  const sigintHandler = () => {
    tail.stop();
    process.stdout.write(`\n${ANSI.dim}Observer detached. Codex task continues.${ANSI.reset}\n`);
    process.exit(0);
  };
  process.on("SIGINT", sigintHandler);

  // Wait for tail to complete (completed event seen or error)
  await new Promise((resolve) => {
    tail.onStop(() => {
      process.removeListener("SIGINT", sigintHandler);
      resolve();
    });
  });
}
