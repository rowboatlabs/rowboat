import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The skills folder is inside the workspace but guarded for writes, so the
// generic file tools cannot bypass skill-manage's ownership checks.
let tmpDir: string;
let workDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "permission-metadata-test-"));
  workDir = path.join(tmpDir, "rowboat");
  fs.mkdirSync(path.join(workDir, "skills"), { recursive: true });
  process.env.ROWBOAT_WORKDIR = workDir;
  vi.resetModules();
  vi.doMock("../../knowledge/version_history.js", () => ({
    commitAll: vi.fn(async () => undefined),
    initRepo: vi.fn(async () => undefined),
  }));
  vi.doMock("../../knowledge/deprecate_today_note.js", () => ({
    deprecateTodayNote: vi.fn(async () => undefined),
  }));
});

afterEach(() => {
  delete process.env.ROWBOAT_WORKDIR;
  vi.doUnmock("../../knowledge/version_history.js");
  vi.doUnmock("../../knowledge/deprecate_today_note.js");
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function metadataFor(name: string, args: Record<string, unknown>) {
  const { getToolPermissionMetadata } = await import("./permission-metadata.js");
  return getToolPermissionMetadata(
    { type: "tool-call", toolCallId: "t1", toolName: name, arguments: args },
    { type: "builtin", name },
    new Set(),
    [],
  );
}

describe("file permissions for the skills folder", () => {
  it("asks before writing, editing or deleting inside skills/", async () => {
    for (const [tool, args, operation] of [
      ["file-writeText", { path: "skills/x/SKILL.md", data: "" }, "write"],
      ["file-editText", { path: "skills/.agent-skills.json" }, "write"],
      ["file-remove", { path: "skills/x" }, "delete"],
      ["file-rename", { from: "notes/a.md", to: "skills/x/SKILL.md" }, "write"],
    ] as const) {
      expect(await metadataFor(tool, args), tool).toMatchObject({ kind: "file", operation });
    }
  });

  it("leaves reads of skills/ and writes elsewhere in the workspace free", async () => {
    expect(await metadataFor("file-readText", { path: "skills/x/SKILL.md" })).toBeNull();
    expect(await metadataFor("file-list", { path: "skills" })).toBeNull();
    expect(await metadataFor("file-writeText", { path: "knowledge/note.md", data: "" })).toBeNull();
    expect(await metadataFor("file-writeText", { path: "skillset/note.md", data: "" })).toBeNull();
  });
});
