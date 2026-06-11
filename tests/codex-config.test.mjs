import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  readSandboxModeFromFile,
  resolveCodexAutoApprovalPolicy,
  resolveCodexSandboxMode,
  VALID_SANDBOX_MODES
} from "../plugins/codex/scripts/lib/codex-config.mjs";

describe("readSandboxModeFromFile", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-config-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null for non-existent file", () => {
    const result = readSandboxModeFromFile(join(tempDir, "does-not-exist.toml"));
    assert.equal(result, null);
  });

  it("reads valid sandbox_mode values", () => {
    for (const mode of VALID_SANDBOX_MODES) {
      const file = join(tempDir, `config-${mode}.toml`);
      writeFileSync(file, `sandbox_mode = "${mode}"\n`);
      assert.equal(readSandboxModeFromFile(file), mode);
    }
  });

  it("returns null for invalid sandbox_mode value", () => {
    const file = join(tempDir, "config.toml");
    writeFileSync(file, 'sandbox_mode = "invalid-mode"\n');
    assert.equal(readSandboxModeFromFile(file), null);
  });

  it("handles whitespace and comments", () => {
    const file = join(tempDir, "config.toml");
    writeFileSync(file, '  sandbox_mode = "danger-full-access"  # full access\n');
    assert.equal(readSandboxModeFromFile(file), "danger-full-access");
  });

  it("ignores commented-out sandbox_mode", () => {
    const file = join(tempDir, "config.toml");
    writeFileSync(file, '# sandbox_mode = "danger-full-access"\n');
    assert.equal(readSandboxModeFromFile(file), null);
  });

  it("handles file with other config values", () => {
    const file = join(tempDir, "config.toml");
    writeFileSync(file, [
      'model = "gpt-5.4-mini"',
      'model_reasoning_effort = "high"',
      'sandbox_mode = "workspace-write"',
      'network_access = true'
    ].join("\n"));
    assert.equal(readSandboxModeFromFile(file), "workspace-write");
  });
});

// os.homedir() reads USERPROFILE on Windows and HOME elsewhere — set both.
function setFakeHome(dir) {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

describe("resolveCodexSandboxMode", () => {
  let tempDir;
  let originalHome;
  let originalUserProfile;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-config-resolve-test-"));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when no config files exist", () => {
    setFakeHome(join(tempDir, "empty-home"));
    mkdirSync(join(tempDir, "empty-home"), { recursive: true });
    const result = resolveCodexSandboxMode(tempDir);
    assert.equal(result, null);
  });

  it("reads from user-level config when project config is absent", () => {
    setFakeHome(tempDir);
    const userCodexDir = join(tempDir, ".codex");
    mkdirSync(userCodexDir, { recursive: true });
    writeFileSync(join(userCodexDir, "config.toml"), 'sandbox_mode = "read-only"\n');

    const result = resolveCodexSandboxMode(join(tempDir, "workspace"));
    assert.equal(result, "read-only");
  });

  it("prefers project-level config over user-level", () => {
    setFakeHome(tempDir);

    const userCodexDir = join(tempDir, ".codex");
    mkdirSync(userCodexDir, { recursive: true });
    writeFileSync(join(userCodexDir, "config.toml"), 'sandbox_mode = "read-only"\n');

    const workspaceRoot = join(tempDir, "workspace");
    const projectCodexDir = join(workspaceRoot, ".codex");
    mkdirSync(projectCodexDir, { recursive: true });
    writeFileSync(join(projectCodexDir, "config.toml"), 'sandbox_mode = "danger-full-access"\n');

    const result = resolveCodexSandboxMode(workspaceRoot);
    assert.equal(result, "danger-full-access");
  });

  it("falls back to user-level when project config has invalid value", () => {
    setFakeHome(tempDir);

    const userCodexDir = join(tempDir, ".codex");
    mkdirSync(userCodexDir, { recursive: true });
    writeFileSync(join(userCodexDir, "config.toml"), 'sandbox_mode = "workspace-write"\n');

    const workspaceRoot = join(tempDir, "workspace");
    const projectCodexDir = join(workspaceRoot, ".codex");
    mkdirSync(projectCodexDir, { recursive: true });
    writeFileSync(join(projectCodexDir, "config.toml"), 'sandbox_mode = "invalid"\n');

    const result = resolveCodexSandboxMode(workspaceRoot);
    assert.equal(result, "workspace-write");
  });
});

describe("resolveCodexAutoApprovalPolicy", () => {
  let tempDir;
  let originalHome;
  let originalUserProfile;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-config-approval-test-"));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    setFakeHome(tempDir);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeUserConfig(lines) {
    const userCodexDir = join(tempDir, ".codex");
    mkdirSync(userCodexDir, { recursive: true });
    writeFileSync(join(userCodexDir, "config.toml"), lines.join("\n") + "\n");
  }

  it("returns null when no config files exist", () => {
    assert.equal(resolveCodexAutoApprovalPolicy(join(tempDir, "workspace")), null);
  });

  it("returns null when approval_policy is set but approvals_reviewer is not auto_review", () => {
    writeUserConfig(['approval_policy = "on-request"']);
    assert.equal(resolveCodexAutoApprovalPolicy(join(tempDir, "workspace")), null);

    writeUserConfig(['approval_policy = "on-request"', 'approvals_reviewer = "user"']);
    assert.equal(resolveCodexAutoApprovalPolicy(join(tempDir, "workspace")), null);
  });

  it("returns the approval policy when approvals_reviewer is auto_review", () => {
    writeUserConfig(['approval_policy = "on-request"', 'approvals_reviewer = "auto_review"']);
    assert.equal(resolveCodexAutoApprovalPolicy(join(tempDir, "workspace")), "on-request");
  });

  it("returns null when auto_review is set without an approval_policy", () => {
    writeUserConfig(['approvals_reviewer = "auto_review"']);
    assert.equal(resolveCodexAutoApprovalPolicy(join(tempDir, "workspace")), null);
  });

  it("ignores invalid approval_policy values", () => {
    writeUserConfig(['approval_policy = "always"', 'approvals_reviewer = "auto_review"']);
    assert.equal(resolveCodexAutoApprovalPolicy(join(tempDir, "workspace")), null);
  });

  it("prefers project-level approval_policy over user-level", () => {
    writeUserConfig(['approval_policy = "never"', 'approvals_reviewer = "auto_review"']);

    const workspaceRoot = join(tempDir, "workspace");
    const projectCodexDir = join(workspaceRoot, ".codex");
    mkdirSync(projectCodexDir, { recursive: true });
    writeFileSync(join(projectCodexDir, "config.toml"), 'approval_policy = "on-request"\n');

    assert.equal(resolveCodexAutoApprovalPolicy(workspaceRoot), "on-request");
  });
});
