#!/usr/bin/env node

/**
 * Pre-push hook: validates CHANGELOG, version bump, and README consistency.
 *
 * Runs via git pre-push hook. Analyzes commits being pushed and checks:
 * 1. If package.json version changed → CHANGELOG.md must contain the new version
 * 2. If plugin source files changed but version didn't bump → suggest bump type
 * 3. Auto-detects suggested bump type (major / minor / patch) from file changes
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Files that constitute user-facing functionality
const SOURCE_GLOBS = [
  "plugins/codex/scripts/",
  "plugins/codex/commands/",
  "plugins/codex/agents/",
  "plugins/codex/skills/",
  "plugins/codex/hooks/",
  "plugins/codex/prompts/"
];

// Files that trigger minor bump (new modules, not new commands)
const MINOR_INDICATORS = [
  "plugins/codex/scripts/lib/",
  "plugins/codex/skills/",
  "plugins/codex/agents/",
  "plugins/codex/hooks/"
];

// Files that trigger major bump (new user-facing commands)
const MAJOR_INDICATORS = [
  "plugins/codex/commands/"
];

function git(args, options = {}) {
  return spawnSync("git", args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8"
  });
}

function getUpstream() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout?.trim();
  if (!branch || branch === "HEAD") {
    return null;
  }
  const upstream = git(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]).stdout?.trim();
  return upstream || null;
}

function getPushRange(upstream) {
  // If no upstream, compare against origin/main
  const base = upstream || "origin/main";
  return `${base}..HEAD`;
}

function getCommitMessages(range) {
  const result = git(["log", range, "--format=%s"]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.trim().split("\n").filter(Boolean);
}

function getChangedFiles(range) {
  const result = git(["diff", "--name-only", range]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.trim().split("\n").filter(Boolean);
}

function getVersionAtRef(ref) {
  const result = git(["show", `${ref}:package.json`]);
  if (result.status !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout).version;
  } catch {
    return null;
  }
}

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return pkg.version;
}

function isSourceFile(file) {
  return SOURCE_GLOBS.some((glob) => file.startsWith(glob));
}

/**
 * Detect suggested bump type from file changes and commit messages.
 *
 * - major: new commands (breaking API surface) or BREAKING CHANGE in commits
 * - minor: new lib modules, skills, agents, hooks, or feat: commits
 * - patch: bug fixes, docs, tests, refactors
 */
function detectBumpType(files, commits) {
  const hasBreakingCommit = commits.some(
    (msg) => /BREAKING CHANGE/i.test(msg) || /^[a-z]+(\(.+\))?!:/.test(msg)
  );
  const hasNewCommand = files.some((file) =>
    file.startsWith("plugins/codex/commands/") && !file.endsWith(".md")
      ? false // only new .md command files count
      : file.startsWith("plugins/codex/commands/")
  );

  if (hasBreakingCommit || hasNewCommand) {
    return { type: "major", reason: hasBreakingCommit ? "BREAKING CHANGE in commit" : "new command file added" };
  }

  const hasMinorChange = files.some((file) => MINOR_INDICATORS.some((prefix) => file.startsWith(prefix)));
  const hasFeatCommit = commits.some((msg) => /^feat(\(.+\))?:/i.test(msg));

  if (hasMinorChange || hasFeatCommit) {
    return { type: "minor", reason: hasFeatCommit ? "feat: commit found" : "new module/skill/agent/hook added" };
  }

  return { type: "patch", reason: "bug fix, docs, or refactor" };
}

function parseVersion(v) {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function versionDiff(oldV, newV) {
  const old = parseVersion(oldV);
  const cur = parseVersion(newV);
  if (!old || !cur) {
    return null;
  }
  if (cur.major > old.major) return "major";
  if (cur.minor > old.minor) return "minor";
  if (cur.patch > old.patch) return "patch";
  return null; // same or downgrade
}

function checkChangelogHasVersion(version) {
  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) {
    return false;
  }
  const content = fs.readFileSync(changelogPath, "utf8");
  // Match ## [1.2.3] or ## 1.2.3
  const pattern = new RegExp(`^##\\s+\\[?${version.replace(/\./g, "\\.")}\\]?`, "m");
  return pattern.test(content);
}

function main() {
  const upstream = getUpstream();
  const range = getPushRange(upstream);

  const commits = getCommitMessages(range);
  if (commits.length === 0) {
    // Nothing to push
    process.exit(0);
  }

  const files = getChangedFiles(range);
  const baseRef = upstream || "origin/main";
  const baseVersion = getVersionAtRef(baseRef);
  const currentVersion = getCurrentVersion();
  const versionChanged = baseVersion !== currentVersion;
  const changelogUpdated = checkChangelogHasVersion(currentVersion);
  const readmeChanged = files.includes("README.md") || files.includes("README.zh-CN.md");
  const sourceChanged = files.some(isSourceFile);

  const suggested = detectBumpType(files, commits);
  const actualBump = versionChanged ? versionDiff(baseVersion, currentVersion) : null;

  const errors = [];
  const warnings = [];

  if (versionChanged) {
    // Version was bumped — must have matching CHANGELOG entry
    if (!changelogUpdated) {
      errors.push(
        `Version bumped to ${currentVersion} but CHANGELOG.md has no entry for this version.\n` +
        `  Add a ## [${currentVersion}] section to CHANGELOG.md.`
      );
    }
    // Check bump type matches suggested
    if (actualBump && actualBump !== suggested.type) {
      warnings.push(
        `Version bump is ${actualBump} (${baseVersion} → ${currentVersion}), ` +
        `but changes suggest ${suggested.type} (${suggested.reason}).`
      );
    }
  } else if (sourceChanged) {
    // Source files changed but version not bumped
    errors.push(
      `Plugin source files changed but version was not bumped.\n` +
      `  Current version: ${currentVersion}\n` +
      `  Suggested bump: ${suggested.type} (${suggested.reason})\n` +
      `  Run: node scripts/bump-version.mjs <new-version>`
    );
  }

  if (sourceChanged && !readmeChanged && versionChanged) {
    warnings.push(
      `Version was bumped but README.md was not updated.\n` +
      `  Consider updating documentation for user-facing changes.`
    );
  }

  // Output
  if (errors.length > 0 || warnings.length > 0) {
    process.stderr.write("\n  Pre-push checks:\n\n");
  }

  for (const err of errors) {
    process.stderr.write(`  ✗ ${err}\n\n`);
  }
  for (const warn of warnings) {
    process.stderr.write(`  ⚠ ${warn}\n\n`);
  }

  if (errors.length > 0) {
    process.stderr.write(`  Push blocked. Fix the issues above, then push again.\n`);
    process.stderr.write(`  To bypass: git push --no-verify\n\n`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    process.stderr.write(`  Push proceeding with warnings.\n\n`);
  }

  process.exit(0);
}

main();
