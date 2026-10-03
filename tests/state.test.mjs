import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";

import { makeTempDir } from "./helpers.mjs";
import {
  listJobs,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  saveState,
  upsertJob
} from "../plugins/codex/scripts/lib/state.mjs";

const STATE_MODULE_URL = new URL("../plugins/codex/scripts/lib/state.mjs", import.meta.url).href;

function runChild(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${stderr}`))));
  });
}

test("parallel processes do not lose each other's job updates", async () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: pluginDataDir };
  const workers = 4;
  const jobsPerWorker = 10;

  await Promise.all(
    Array.from({ length: workers }, (_, worker) =>
      runChild(
        `import { upsertJob } from ${JSON.stringify(STATE_MODULE_URL)};
         for (let i = 0; i < ${jobsPerWorker}; i += 1) {
           upsertJob(${JSON.stringify(workspace)}, { id: "w${worker}-" + i, status: "running" });
         }`,
        env
      )
    )
  );

  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  try {
    assert.equal(listJobs(workspace).length, workers * jobsPerWorker);
    assert.equal(fs.existsSync(`${resolveStateFile(workspace)}.lock`), false);
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("readers never see a partly written state.json while other processes write", async () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: pluginDataDir };
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    saveState(workspace, { jobs: [] });
    const stateFile = resolveStateFile(workspace);

    // A 1 KB note per job makes state.json about 50 KB, so a reader often catches an in-place write half done.
    let writersDone = false;
    const writers = Promise.all(
      Array.from({ length: 2 }, (_, worker) =>
        runChild(
          `import { upsertJob } from ${JSON.stringify(STATE_MODULE_URL)};
           const note = "x".repeat(1024);
           for (let i = 0; i < 25; i += 1) {
             upsertJob(${JSON.stringify(workspace)}, { id: "w${worker}-" + i, status: "running", note });
           }`,
          env
        )
      )
    ).finally(() => {
      writersDone = true;
    });

    let reads = 0;
    while (!writersDone) {
      const text = await fs.promises.readFile(stateFile, "utf8");
      assert.doesNotThrow(() => JSON.parse(text), `read ${reads} was not valid JSON (${text.length} chars)`);
      reads += 1;
    }
    await writers;

    assert.ok(reads > 0);
    assert.equal(listJobs(workspace).length, 50);
    assert.deepEqual(fs.readdirSync(path.dirname(stateFile)).filter((name) => name.includes(".tmp-")), []);
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

function upsertPastLeftoverLock(writeLock) {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    const lockFile = `${resolveStateFile(workspace)}.lock`;
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    writeLock(lockFile);
    const started = Date.now();

    upsertJob(workspace, { id: "job-1", status: "running" });

    assert.deepEqual(listJobs(workspace).map((job) => job.id), ["job-1"]);
    assert.equal(fs.existsSync(lockFile), false);
    return Date.now() - started;
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
}

test("a fresh lock held by a dead process is cleared at once", () => {
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  const elapsedMs = upsertPastLeftoverLock((lockFile) => fs.writeFileSync(lockFile, String(deadPid)));
  assert.ok(elapsedMs < 5_000, `took ${elapsedMs} ms`);
});

test("an empty lock is cleared after a few seconds, inside the SessionEnd wait", () => {
  upsertPastLeftoverLock((lockFile) => {
    fs.writeFileSync(lockFile, "");
    const threeSecondsAgo = new Date(Date.now() - 3_000);
    fs.utimesSync(lockFile, threeSecondsAgo, threeSecondsAgo);
  });
});

test("resolveStateDir falls back to a HOME-anchored directory when CLAUDE_PLUGIN_DATA is unset", () => {
  const workspace = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;

  try {
    const stateDir = resolveStateDir(workspace);
    const expectedRoot = path.join(os.homedir(), ".codex-companion", "state");

    assert.equal(stateDir.startsWith(expectedRoot), true, `expected ${stateDir} to start with ${expectedRoot}`);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided", () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.match(
      stateDir,
      new RegExp(`^${path.join(pluginDataDir, "state").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("saveState prunes dropped job artifacts when indexed jobs exceed the cap", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const jobs = Array.from({ length: 51 }, (_, index) => {
    const jobId = `job-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
    const logFile = resolveJobLogFile(workspace, jobId);
    const jobFile = resolveJobFile(workspace, jobId);
    fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
    fs.writeFileSync(jobFile, JSON.stringify({ id: jobId, status: "completed" }, null, 2), "utf8");
    return {
      id: jobId,
      status: "completed",
      logFile,
      updatedAt,
      createdAt: updatedAt
    };
  });

  fs.writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        version: 1,
        config: { stopReviewGate: false },
        jobs
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  saveState(workspace, {
    version: 1,
    config: { stopReviewGate: false },
    jobs
  });

  const prunedJobFile = resolveJobFile(workspace, "job-0");
  const prunedLogFile = resolveJobLogFile(workspace, "job-0");
  const retainedJobFile = resolveJobFile(workspace, "job-50");
  const retainedLogFile = resolveJobLogFile(workspace, "job-50");
  const jobsDir = path.dirname(prunedJobFile);

  assert.equal(fs.existsSync(retainedJobFile), true);
  assert.equal(fs.existsSync(retainedLogFile), true);

  const savedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(savedState.jobs.length, 50);
  assert.deepEqual(
    savedState.jobs.map((job) => job.id),
    Array.from({ length: 50 }, (_, index) => `job-${50 - index}`)
  );
  assert.deepEqual(
    fs.readdirSync(jobsDir).sort(),
    Array.from({ length: 50 }, (_, index) => `job-${index + 1}`)
      .flatMap((jobId) => [`${jobId}.json`, `${jobId}.log`])
      .sort()
  );
});
