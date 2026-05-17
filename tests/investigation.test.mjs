import test from "node:test";
import assert from "node:assert/strict";

import { setupFakeCodex } from "./fake-codex-fixture.mjs";
import { runAppServerInvestigation } from "../plugins/codex/scripts/lib/codex.mjs";
import { makeTempDir } from "./helpers.mjs";

// Structured JSON payloads used by multiple tests.
const STRUCTURED_REVIEW = JSON.stringify({
  verdict: "needs-attention",
  summary: "Concern X.",
  findings: [{
    severity: "high",
    title: "Race",
    file: "a.js",
    line_start: 10,
    line_end: 12,
    confidence: 0.8,
    body: "Potential race condition.",
    recommendation: "Add a mutex."
  }],
  next_steps: []
});

const APPROVE_REVIEW = JSON.stringify({
  verdict: "approve",
  summary: "No material issues found.",
  findings: [],
  next_steps: []
});

test("converges when Codex emits a final-answer turn with no commands", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: commands, no final answer
    fake.queueTurnResponse({
      commands: [{ command: "git diff HEAD~1", exitCode: 0 }],
      finalAnswer: null
    });
    // Recon turn 2: no commands, final answer => converges
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "Investigation done." }
    });
    // Finalize turn 3
    fake.queueTurnResponse({
      finalAnswer: { text: STRUCTURED_REVIEW }
    });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate the changes.",
      finalizePrompt: "Produce your structured verdict.",
      outputSchema: { type: "object", required: ["verdict"] }
    });

    assert.equal(result.investigation.turnCount, 2);
    assert.equal(result.investigation.truncated, false);

    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 3, "should have 3 turn/start requests (2 recon + 1 finalize)");
  } finally {
    fake.close();
  }
});

test("respects maxInvestigationTurns and marks truncated", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Queue 4 recon turns: all have commands, no final answer
    for (let i = 0; i < 4; i++) {
      fake.queueTurnResponse({
        commands: [{ command: `check-${i}`, exitCode: 0 }]
      });
    }
    // Finalize turn
    fake.queueTurnResponse({
      finalAnswer: { text: APPROVE_REVIEW }
    });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize.",
      maxInvestigationTurns: 3
    });

    assert.equal(result.investigation.turnCount, 3);
    assert.equal(result.investigation.truncated, true);

    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 4, "3 recon + 1 finalize");
  } finally {
    fake.close();
  }
});

test("turn with both finalAnswer and commands does not converge", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: commands AND final answer => does NOT converge
    fake.queueTurnResponse({
      commands: [{ command: "grep -r TODO", exitCode: 0 }],
      finalAnswer: { text: "Partial finding." }
    });
    // Recon turn 2: only final answer, no commands => converges
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "Investigation done." }
    });
    // Finalize turn
    fake.queueTurnResponse({
      finalAnswer: { text: APPROVE_REVIEW }
    });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize."
    });

    assert.equal(result.investigation.turnCount, 2);
    assert.equal(result.investigation.truncated, false);
  } finally {
    fake.close();
  }
});

test("outputSchema is null on recon turns and set on finalize turn", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: commands
    fake.queueTurnResponse({
      commands: [{ command: "cat file.js", exitCode: 0 }]
    });
    // Recon turn 2: final answer, no commands => converges
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "Done investigating." }
    });
    // Finalize turn
    fake.queueTurnResponse({
      finalAnswer: { text: STRUCTURED_REVIEW }
    });

    const schema = { type: "object", required: ["verdict"] };
    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize.",
      outputSchema: schema
    });

    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 3);

    // Recon turns must have outputSchema === null
    assert.equal(starts[0].params.outputSchema, null, "recon turn 1 outputSchema should be null");
    assert.equal(starts[1].params.outputSchema, null, "recon turn 2 outputSchema should be null");

    // Finalize turn must have the schema
    assert.deepEqual(starts[2].params.outputSchema, schema, "finalize turn should have the outputSchema");
  } finally {
    fake.close();
  }
});

test("phase-1 soft error (turn/failed) aborts before phase-2 finalize", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: commands, normal
    fake.queueTurnResponse({
      commands: [{ command: "git log --oneline", exitCode: 0 }]
    });
    // Recon turn 2: soft error
    fake.queueTurnResponse({
      turnError: { message: "model produced unrenderable response" }
    });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize."
    });

    assert.ok(result.error, "result should have an error");
    assert.equal(result.investigation.turnCount, 2, "soft-error turn IS counted");

    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 2, "NO finalize turn should be attempted");
  } finally {
    fake.close();
  }
});

test("phase-1 hard error (transport throw) aborts before phase-2 finalize", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: commands, normal
    fake.queueTurnResponse({
      commands: [{ command: "git status", exitCode: 0 }]
    });
    // Recon turn 2: RPC error (transport throw)
    fake.queueTurnRpcError({ message: "ECONNRESET" });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize."
    });

    assert.ok(result.error, "result should have an error");
    assert.match(result.error.message, /ECONNRESET/);
    assert.equal(result.investigation.turnCount, 1, "hard error returns BEFORE incrementing turnCount");

    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 2, "the failing turn was still attempted");
  } finally {
    fake.close();
  }
});

test("converges with zero commands flags truncated=true", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: only final answer, no commands => converges immediately
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "Nothing to investigate." }
    });
    // Finalize turn
    fake.queueTurnResponse({
      finalAnswer: { text: APPROVE_REVIEW }
    });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate.",
      finalizePrompt: "Finalize."
    });

    assert.equal(result.investigation.turnCount, 1);
    assert.equal(result.investigation.truncated, true, "zero commands across investigation => truncated");

    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 2, "1 recon + 1 finalize");
  } finally {
    fake.close();
  }
});

test("recon turn 1 sends the investigate prompt; turn 2+ sends the continuation cue", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: commands
    fake.queueTurnResponse({
      commands: [{ command: "ls", exitCode: 0 }]
    });
    // Recon turn 2: commands
    fake.queueTurnResponse({
      commands: [{ command: "cat a.js", exitCode: 0 }]
    });
    // Recon turn 3: final answer, no commands => converges
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "All done." }
    });
    // Finalize turn
    fake.queueTurnResponse({
      finalAnswer: { text: APPROVE_REVIEW }
    });

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "FULL INVESTIGATE PROMPT: look at the code",
      finalizePrompt: "FINALIZE PROMPT: produce verdict"
    });

    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.equal(starts.length, 4, "3 recon + 1 finalize");

    // Extract input text from each turn/start
    const inputTexts = starts.map((s) =>
      (s.params.input || [])
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("")
    );

    // Turn 1: investigate prompt
    assert.match(inputTexts[0], /FULL INVESTIGATE PROMPT/, "turn 1 should use investigate prompt");
    // Turn 2 and 3: continuation cue
    assert.equal(inputTexts[1], "Continue your investigation.", "turn 2 should use continuation cue");
    assert.equal(inputTexts[2], "Continue your investigation.", "turn 3 should use continuation cue");
    // Turn 4: finalize prompt
    assert.match(inputTexts[3], /FINALIZE PROMPT/, "turn 4 should use finalize prompt");
  } finally {
    fake.close();
  }
});

test("outputSchema-set finalize turn produces schema-conformant final message", async () => {
  const cwd = makeTempDir("codex-inv-test-");
  const fake = setupFakeCodex({ cwd });
  try {
    // Recon turn 1: commands, no final answer
    fake.queueTurnResponse({
      commands: [{ command: "git diff HEAD~1", exitCode: 0 }],
      finalAnswer: null
    });
    // Recon turn 2: no commands, final answer => converges
    fake.queueTurnResponse({
      commands: [],
      finalAnswer: { text: "Investigation done." }
    });
    // Finalize turn with structured output
    fake.queueTurnResponse({
      finalAnswer: { text: STRUCTURED_REVIEW }
    });

    const schema = {
      type: "object",
      required: ["verdict"],
      properties: {
        verdict: { type: "string" },
        summary: { type: "string" },
        findings: { type: "array" },
        next_steps: { type: "array" }
      }
    };

    const result = await runAppServerInvestigation(fake.cwd, {
      investigatePrompt: "Investigate the changes.",
      finalizePrompt: "Produce your structured verdict.",
      outputSchema: schema
    });

    // The finalMessage should be parseable JSON with a verdict field
    const parsed = JSON.parse(result.finalMessage);
    assert.equal(parsed.verdict, "needs-attention");
    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.findings[0].severity, "high");

    // The finalize turn should have received the schema
    const requests = fake.requests;
    const starts = requests.filter((r) => r.method === "turn/start");
    assert.deepEqual(starts[starts.length - 1].params.outputSchema, schema);

    // Only the finalize turn's reasoningSummary is returned
    assert.ok(Array.isArray(result.reasoningSummary));
  } finally {
    fake.close();
  }
});
