import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { WorkDir } from "../dist/config/config.js";
import {
  absToRelPosix,
  assertSafeRelPath,
  resolveWorkspacePath,
} from "../dist/workspace/workspace.js";

test("uses ROWBOAT_WORKDIR override for test isolation", () => {
  assert.equal(WorkDir, process.env.ROWBOAT_WORKDIR);
});

test("assertSafeRelPath allows simple relative paths", () => {
  assert.doesNotThrow(() => assertSafeRelPath("notes/today.md"));
});

test("assertSafeRelPath rejects absolute paths", () => {
  assert.throws(() => assertSafeRelPath("/tmp/notes.md"), /Absolute paths are not allowed/);
});

test("assertSafeRelPath rejects traversal attempts", () => {
  assert.throws(() => assertSafeRelPath("../notes.md"), /Path traversal/);
  assert.throws(() => assertSafeRelPath("notes/../secret.md"), /Path traversal|Invalid path/);
});

test("resolveWorkspacePath returns the configured root for empty path", () => {
  assert.equal(resolveWorkspacePath(""), WorkDir);
});

test("resolveWorkspacePath resolves safe relative paths inside the workspace", () => {
  assert.equal(resolveWorkspacePath("knowledge/alpha.md"), path.join(WorkDir, "knowledge", "alpha.md"));
});

test("absToRelPosix returns POSIX relative paths inside the workspace", () => {
  const absolutePath = path.join(WorkDir, "knowledge", "nested", "alpha.md");
  assert.equal(absToRelPosix(absolutePath), "knowledge/nested/alpha.md");
});

test("absToRelPosix rejects paths outside the workspace", () => {
  assert.equal(absToRelPosix("/tmp/outside.md"), null);
});
