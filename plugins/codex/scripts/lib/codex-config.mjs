import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VALID_SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const VALID_APPROVAL_POLICIES = new Set(["untrusted", "on-failure", "on-request", "never"]);
const VALID_APPROVALS_REVIEWERS = new Set(["user", "auto_review"]);

/**
 * Extract a top-level `key = "value"` string from a Codex config.toml file.
 * Returns null if the file does not exist, cannot be read, or the key is absent/invalid.
 *
 * Only handles the simple `key = "value"` syntax used by Codex config.
 * Does not attempt full TOML parsing — no arrays, tables, or inline tables.
 */
function readStringKeyFromFile(filePath, key, validValues) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const pattern = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const match = line.match(pattern);
    if (!match) continue;

    const value = match[1].trim();
    if (validValues.has(value)) {
      return value;
    }
  }

  return null;
}

export function readSandboxModeFromFile(filePath) {
  return readStringKeyFromFile(filePath, "sandbox_mode", VALID_SANDBOX_MODES);
}

/**
 * Resolve the effective Codex `sandbox_mode` for a workspace.
 *
 * Precedence (matches Codex CLI behavior):
 *   1. Project-level `.codex/config.toml` in the workspace root
 *   2. User-level `~/.codex/config.toml`
 *
 * Returns the resolved value, or null if nothing is configured.
 */
export function resolveCodexSandboxMode(workspaceRoot) {
  return resolveStringKey(workspaceRoot, "sandbox_mode", VALID_SANDBOX_MODES);
}

function resolveStringKey(workspaceRoot, key, validValues) {
  const projectConfig = workspaceRoot
    ? readStringKeyFromFile(path.join(workspaceRoot, ".codex", "config.toml"), key, validValues)
    : null;
  if (projectConfig) return projectConfig;

  return readStringKeyFromFile(path.join(os.homedir(), ".codex", "config.toml"), key, validValues);
}

/**
 * Resolve the `approval_policy` a write-capable task run should pass through,
 * or null to keep the plugin's hardcoded "never".
 *
 * Gated on `approvals_reviewer = "auto_review"`: headless runs have no human
 * to answer approval prompts, so the policy only passes through when Codex's
 * automatic reviewer is configured to answer them. A prompt the auto reviewer
 * rejects stays rejected.
 */
export function resolveCodexAutoApprovalPolicy(workspaceRoot) {
  const reviewer = resolveStringKey(workspaceRoot, "approvals_reviewer", VALID_APPROVALS_REVIEWERS);
  if (reviewer !== "auto_review") {
    return null;
  }

  return resolveStringKey(workspaceRoot, "approval_policy", VALID_APPROVAL_POLICIES);
}

export { VALID_SANDBOX_MODES, VALID_APPROVAL_POLICIES };
