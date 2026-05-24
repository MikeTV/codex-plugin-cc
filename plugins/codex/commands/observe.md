---
description: Launch a live observer for a Codex job — opens a tmux split when available
argument-hint: '[job-id] [--cwd <path>]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" observe --spawn $ARGUMENTS`

Present the command output to the user verbatim. Do not add summary or commentary.

**Behavior**

- Inside tmux: opens a new vertical split (`split-window -h`) running the live observer for the requested (or latest running) Codex job.
- Outside tmux: prints the exact command for the user to paste into a separate terminal window.

The observer shows real-time phase indicators, tool calls, command output, and file changes with ANSI colors. It exits automatically when the task completes, or with `Ctrl+C` (Codex task continues running).
