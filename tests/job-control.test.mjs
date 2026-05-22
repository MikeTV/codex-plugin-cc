import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildSingleJobSnapshot,
  resolveCancelableJob,
  resolveResultJob
} from "../plugins/codex/scripts/lib/job-control.mjs";

describe("job-control cross-workspace fallback", () => {
  let pluginDataDir;
  let currentWorkspace;
  let previousPluginData;

  beforeEach(() => {
    pluginDataDir = mkdtempSync(path.join(tmpdir(), "job-control-cross-"));
    currentWorkspace = mkdtempSync(path.join(tmpdir(), "job-control-cwd-"));
    previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  });

  afterEach(() => {
    if (previousPluginData === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    }
    rmSync(pluginDataDir, { recursive: true, force: true });
    rmSync(currentWorkspace, { recursive: true, force: true });
  });

  function writeRemoteWorkspaceJob(slug, job) {
    const stateDir = path.join(pluginDataDir, "state", slug);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "state.json"),
      `${JSON.stringify({ version: 1, jobs: [job] }, null, 2)}\n`,
      "utf8"
    );
    return stateDir;
  }

  it("buildSingleJobSnapshot falls back to cross-workspace by job id", () => {
    const job = {
      id: "task-abc-running",
      status: "running",
      workspaceRoot: "/some/other/repo",
      logFile: path.join(pluginDataDir, "log.txt"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const stateDir = writeRemoteWorkspaceJob("remote-aaaaaaaaaaaaaaaa", job);

    const snapshot = buildSingleJobSnapshot(currentWorkspace, "task-abc-running");
    assert.equal(snapshot.crossWorkspace, true);
    assert.equal(snapshot.crossWorkspaceStateDir, stateDir);
    assert.equal(snapshot.workspaceRoot, "/some/other/repo");
    assert.equal(snapshot.job.id, "task-abc-running");
    assert.equal(snapshot.job.status, "running");
  });

  it("buildSingleJobSnapshot still throws when job id is unknown anywhere", () => {
    assert.throws(
      () => buildSingleJobSnapshot(currentWorkspace, "task-nope"),
      /No job found for "task-nope"/
    );
  });

  it("resolveResultJob falls back to cross-workspace finished job", () => {
    const job = {
      id: "task-done-1",
      status: "completed",
      workspaceRoot: "/some/other/repo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeRemoteWorkspaceJob("remote-bbbbbbbbbbbbbbbb", job);

    const result = resolveResultJob(currentWorkspace, "task-done-1");
    assert.equal(result.crossWorkspace, true);
    assert.equal(result.workspaceRoot, "/some/other/repo");
    assert.equal(result.job.id, "task-done-1");
  });

  it("resolveResultJob rejects cross-workspace job that is still running", () => {
    const job = {
      id: "task-still-running",
      status: "running",
      workspaceRoot: "/some/other/repo"
    };
    writeRemoteWorkspaceJob("remote-cccccccccccccccc", job);

    assert.throws(
      () => resolveResultJob(currentWorkspace, "task-still-running"),
      /is still running in another workspace/
    );
  });

  it("resolveCancelableJob falls back to cross-workspace running job by id", () => {
    const job = {
      id: "task-cancelable",
      status: "running",
      workspaceRoot: "/some/other/repo",
      pid: 0
    };
    writeRemoteWorkspaceJob("remote-dddddddddddddddd", job);

    const result = resolveCancelableJob(currentWorkspace, "task-cancelable", { env: {} });
    assert.equal(result.crossWorkspace, true);
    assert.equal(result.workspaceRoot, "/some/other/repo");
    assert.equal(result.job.id, "task-cancelable");
  });

  it("resolveCancelableJob rejects a non-active cross-workspace match with a clear message", () => {
    const job = {
      id: "task-not-active",
      status: "completed",
      workspaceRoot: "/some/other/repo"
    };
    writeRemoteWorkspaceJob("remote-eeeeeeeeeeeeeeee", job);

    assert.throws(
      () => resolveCancelableJob(currentWorkspace, "task-not-active", { env: {} }),
      /Nothing to cancel/
    );
  });

  it("resolveCancelableJob without reference still requires a local active job", () => {
    assert.throws(
      () => resolveCancelableJob(currentWorkspace, "", { env: {} }),
      /No active Codex jobs to cancel/
    );
  });
});
