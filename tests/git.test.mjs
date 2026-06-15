import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { collectReviewContext, resolveReviewTarget } from "../plugins/codex/scripts/lib/git.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

test("resolveReviewTarget prefers working tree when repo is dirty", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");

  const target = resolveReviewTarget(cwd, {});

  assert.equal(target.mode, "working-tree");
});

test("resolveReviewTarget falls back to branch diff when repo is clean", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "change"], { cwd });

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "branch");
  assert.match(target.label, /main/);
  assert.match(context.content, /Branch Diff/);
});

test("resolveReviewTarget honors explicit base overrides", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["checkout", "-b", "feature/test"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "change"], { cwd });

  const target = resolveReviewTarget(cwd, { base: "main" });

  assert.equal(target.mode, "branch");
  assert.equal(target.baseRef, "main");
});

test("resolveReviewTarget requires an explicit base when no default branch can be inferred", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  run("git", ["branch", "-m", "feature-only"], { cwd });

  assert.throws(
    () => resolveReviewTarget(cwd, {}),
    /Unable to detect the repository default branch\. Pass --base <ref> or use --scope working-tree\./
  );
});

test("collectReviewContext keeps inline diffs for tiny adversarial reviews", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('INLINE_MARKER');\n");

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.inputMode, "inline-diff");
  assert.equal(context.fileCount, 1);
  assert.match(context.collectionGuidance, /primary evidence/i);
  assert.match(context.content, /INLINE_MARKER/);
});

test("collectReviewContext keeps small multi-file diffs on the inline path", () => {
  // The inline file cap is 5: small everyday multi-file reviews take the cheap
  // single-turn path rather than the expensive two-phase self-collect loop.
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "seed.js"), "export const value = 'seed';\n");
  run("git", ["add", "seed.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "doc-one.md"), "# planning doc\n".repeat(5));
  fs.writeFileSync(path.join(cwd, "doc-two.md"), "# spec doc\n".repeat(5));

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.fileCount, 2);
  assert.equal(context.inputMode, "inline-diff",
    "a small 2-file change is under both caps and must take the cheap inline path");
});

test("collectReviewContext routes large multi-file embeds to self-collect (byte cap guards the recon-stub bug)", () => {
  // Regression guard for the original bug: a multi-file change whose embedded
  // contents are large (~100 KB drove the model to emit a `{"cmd": ...}` recon
  // stub on the no-recovery single turn). With the file cap raised to 5, the
  // byte cap — not the file count — is what must keep large embeds off the
  // inline path.
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "a.js"), "export const value = 'seed';\n");
  fs.writeFileSync(path.join(cwd, "b.js"), "export const value = 'seed';\n");
  run("git", ["add", "a.js", "b.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  // Two files, ~72 KB of changed lines each → combined diff far exceeds the
  // 64 KB inline byte cap even though the file count (2) is under the file cap.
  fs.writeFileSync(path.join(cwd, "a.js"), "// large doc line A\n".repeat(4000));
  fs.writeFileSync(path.join(cwd, "b.js"), "// large doc line B\n".repeat(4000));

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.fileCount, 2);
  assert.ok(context.diffBytes > 64 * 1024,
    "diff must exceed the inline byte cap for this guard to be meaningful");
  assert.equal(context.inputMode, "self-collect",
    "a large multi-file embed must NOT be inlined; it hits the schema-pinned single-turn recon-stub bug otherwise");
});

test("collectReviewContext skips untracked directories in working tree review", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });

  const nestedRepoDir = path.join(cwd, ".claude", "worktrees", "agent-test");
  fs.mkdirSync(nestedRepoDir, { recursive: true });
  initGitRepo(nestedRepoDir);

  const target = resolveReviewTarget(cwd, { scope: "working-tree" });
  const context = collectReviewContext(cwd, target);

  assert.match(context.content, /### \.claude\/worktrees\/agent-test\/\n\(skipped: directory\)/);
});

test("collectReviewContext skips broken untracked symlinks instead of crashing", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.symlinkSync("missing-target", path.join(cwd, "broken-link"));

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(target.mode, "working-tree");
  assert.match(context.content, /### broken-link/);
  assert.match(context.content, /skipped: broken symlink or unreadable file/i);
});

test("collectReviewContext falls back to lightweight context for larger adversarial reviews", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  const names = ["a.js", "b.js", "c.js", "d.js", "e.js", "f.js"];
  for (const name of names) {
    fs.writeFileSync(path.join(cwd, name), `export const value = "${name}-v1";\n`);
  }
  run("git", ["add", ...names], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  const markers = ["A", "B", "C", "D", "E", "F"];
  names.forEach((name, i) => {
    fs.writeFileSync(path.join(cwd, name), `export const value = "SELF_COLLECT_MARKER_${markers[i]}";\n`);
  });

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  // Six changed files exceeds the inline file cap (5) → self-collect.
  assert.equal(context.inputMode, "self-collect");
  assert.equal(context.fileCount, 6);
  assert.match(context.collectionGuidance, /lightweight summary/i);
  assert.match(context.collectionGuidance, /read-only git commands/i);
  assert.doesNotMatch(context.content, /SELF_COLLECT_MARKER_[A-F]/);
  assert.match(context.content, /## Changed Files/);
});

test("collectReviewContext falls back to lightweight context for oversized single-file diffs", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "export const value = 'v1';\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), `export const value = '${"x".repeat(512)}';\n`);

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target, { maxInlineDiffBytes: 128 });

  assert.equal(context.fileCount, 1);
  assert.equal(context.inputMode, "self-collect");
  assert.ok(context.diffBytes > 128);
  assert.doesNotMatch(context.content, /xxx/);
  assert.match(context.content, /## Changed Files/);
});

test("collectReviewContext keeps untracked file content in lightweight working tree context", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  const tracked = ["a.js", "b.js", "c.js", "d.js", "e.js"];
  for (const name of tracked) {
    fs.writeFileSync(path.join(cwd, name), `export const value = "${name}-v1";\n`);
  }
  run("git", ["add", ...tracked], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  // Five tracked edits + one untracked file = six changed files, past the inline
  // file cap (5) → self-collect, so we can assert the lightweight rendering.
  tracked.forEach((name, i) => {
    fs.writeFileSync(path.join(cwd, name), `export const value = "TRACKED_MARKER_${i}";\n`);
  });
  fs.writeFileSync(path.join(cwd, "new-risk.js"), 'export const value = "UNTRACKED_RISK_MARKER";\n');

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.inputMode, "self-collect");
  assert.equal(context.fileCount, 6);
  assert.doesNotMatch(context.content, /TRACKED_MARKER_\d/);
  assert.match(context.content, /## Untracked Files/);
  assert.match(context.content, /UNTRACKED_RISK_MARKER/);
});

test("collectReviewContext routes a single oversized untracked file to self-collect", () => {
  // An untracked file never shows up in `git diff`, so its size does not count
  // toward diffBytes. A single untracked file >24 KiB therefore looked like a
  // 1-file, 0-byte diff and slipped onto the inline path — where the prompt
  // embeds only a `(skipped: ...)` marker AND forbids shell. The reviewer could
  // then only approve/guess. Skipped untracked content must fall through to
  // self-collect so Codex can read the file with read-only commands.
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "seed.js"), "export const value = 'seed';\n");
  run("git", ["add", "seed.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  // One untracked file, contents exceed MAX_UNTRACKED_BYTES (24 KiB).
  fs.writeFileSync(path.join(cwd, "big-untracked.txt"), "x".repeat(30 * 1024));

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.fileCount, 1);
  assert.equal(context.inputMode, "self-collect",
    "a skipped untracked file must NOT be inlined; the prompt would embed only a (skipped) marker while forbidding shell");
});

test("collectReviewContext routes a single binary untracked file to self-collect", () => {
  // Same hazard as the oversized case: a small binary untracked file is within
  // the byte/file caps but its contents are skipped as `(skipped: binary file)`,
  // so the inline prompt would show nothing useful while forbidding shell.
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "seed.js"), "export const value = 'seed';\n");
  run("git", ["add", "seed.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  // Untracked binary file: NUL bytes make isProbablyText() false.
  fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0, 1, 2, 0, 3, 4, 0]));

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.fileCount, 1);
  assert.equal(context.inputMode, "self-collect",
    "a binary untracked file must NOT be inlined; its contents are skipped in the embedded prompt");
});

test("collectReviewContext still inlines a single small text untracked file", () => {
  // Guard the fix from over-reaching: an untracked file whose contents ARE
  // embeddable (small, text) must stay on the inline path.
  const cwd = makeTempDir();
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "seed.js"), "export const value = 'seed';\n");
  run("git", ["add", "seed.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "small-new.js"), "export const v = 'INLINE_UNTRACKED_MARKER';\n");

  const target = resolveReviewTarget(cwd, {});
  const context = collectReviewContext(cwd, target);

  assert.equal(context.fileCount, 1);
  assert.equal(context.inputMode, "inline-diff");
  assert.match(context.content, /INLINE_UNTRACKED_MARKER/);
});
