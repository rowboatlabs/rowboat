import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let workspaceDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-files-test-"));
  workspaceDir = path.join(tmpDir, "workspace");
  process.env.ROWBOAT_WORKDIR = workspaceDir;
  vi.resetModules();
  vi.doMock("../knowledge/version_history.js", () => ({
    commitAll: vi.fn(async () => undefined),
    initRepo: vi.fn(async () => undefined),
  }));
  vi.doMock("../knowledge/deprecate_today_note.js", () => ({
    deprecateTodayNote: vi.fn(async () => undefined),
  }));
});

afterEach(async () => {
  delete process.env.ROWBOAT_WORKDIR;
  vi.doUnmock("../knowledge/version_history.js");
  vi.doUnmock("../knowledge/deprecate_today_note.js");
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function loadFiles() {
  return import("./files.js");
}

describe("filesystem files", () => {
  it("resolves relative paths inside ROWBOAT_WORKDIR", async () => {
    const files = await loadFiles();

    const resolved = files.resolveFilePath("notes/example.md");

    expect(resolved.originalPath).toBe("notes/example.md");
    expect(resolved.resolvedPath).toBe(path.join(workspaceDir, "notes", "example.md"));
    expect(resolved.isInsideWorkspace).toBe(true);
    expect(resolved.workspaceRelPath).toBe("notes/example.md");
  });

  it("keeps absolute paths outside the workspace absolute", async () => {
    const files = await loadFiles();
    const absolutePath = path.join(tmpDir, "outside.txt");

    const resolved = files.resolveFilePath(absolutePath);

    expect(resolved.resolvedPath).toBe(absolutePath);
    expect(resolved.isInsideWorkspace).toBe(false);
    expect(resolved.workspaceRelPath).toBeNull();
  });

  it("expands home-relative paths", async () => {
    const files = await loadFiles();

    const resolved = files.resolveFilePath("~/rowboat-test.txt");

    expect(resolved.resolvedPath).toBe(path.join(os.homedir(), "rowboat-test.txt"));
    expect(resolved.isInsideWorkspace).toBe(false);
  });

  it("canonicalizes symlinked paths for permission checks", async () => {
    const files = await loadFiles();
    const externalDir = path.join(tmpDir, "external");
    const linkPath = path.join(workspaceDir, "linked");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.mkdir(workspaceDir, { recursive: true });
    try {
      await fs.symlink(externalDir, linkPath, "dir");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
        return;
      }
      throw error;
    }

    const canonicalExternalDir = await fs.realpath(externalDir);
    const resolved = await files.resolveFilePathForPermission("linked/new-file.txt");

    expect(resolved.resolvedPath).toBe(path.join(workspaceDir, "linked", "new-file.txt"));
    expect(resolved.canonicalPath).toBe(path.join(canonicalExternalDir, "new-file.txt"));
    expect(resolved.isInsideWorkspace).toBe(false);
    expect(resolved.workspaceRelPath).toBeNull();
  });

  it("reads text with line numbers and pagination metadata", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "readme.txt"), "alpha\nbeta\ngamma\n", "utf8");

    const result = await files.readText("readme.txt", 2, 1);

    expect(result.path).toBe("readme.txt");
    expect(result.encoding).toBe("utf8");
    expect(result.offset).toBe(2);
    expect(result.limit).toBe(1);
    expect(result.totalLines).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.content).toContain("2: beta");
  });

  it("rejects files containing NUL bytes as binary", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "binary.dat"), Buffer.from([0x61, 0x00, 0x62]));

    await expect(files.readText("binary.dat")).rejects.toThrow("binary file");
  });

  it("rejects files with a high non-printable byte ratio", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "control.dat"), Buffer.from([0x01, 0x02, 0x03, 0x41]));

    await expect(files.readText("control.dat")).rejects.toThrow("binary file");
  });

  it("rejects files that decode with many UTF-8 replacement characters", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "invalid-utf8.txt"), Buffer.alloc(512, 0xff));

    await expect(files.readText("invalid-utf8.txt")).rejects.toThrow("binary file");
  });

  it("accepts normal text control characters", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "tabs.txt"), "one\ttwo\nthree\rfour\r\n", "utf8");

    const result = await files.readText("tabs.txt");

    expect(result.content).toContain("1: one\ttwo");
    expect(result.content).toContain("2: three");
  });

  it("writes text and creates parent directories", async () => {
    const files = await loadFiles();

    await files.writeText("nested/dir/file.txt", "hello");

    await expect(fs.readFile(path.join(workspaceDir, "nested", "dir", "file.txt"), "utf8")).resolves.toBe("hello");
  });

  it("rejects stale expectedEtag writes", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "etag.txt"), "first", "utf8");
    const initial = await files.stat("etag.txt");
    await files.writeText("etag.txt", "second");

    await expect(files.writeText("etag.txt", "third", { expectedEtag: initial.etag })).rejects.toThrow("ETag mismatch");
  });

  it("requires unique editText matches unless replaceAll is true", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "edit.txt"), "one two one", "utf8");

    const ambiguous = await files.editText("edit.txt", "one", "ONE");
    expect(ambiguous).toEqual({ error: "oldString found 2 times. Use replaceAll: true or provide more context to make it unique." });

    const replaced = await files.editText("edit.txt", "one", "ONE", true);
    expect(replaced).toMatchObject({ success: true, replacements: 2 });
    await expect(fs.readFile(path.join(workspaceDir, "edit.txt"), "utf8")).resolves.toBe("ONE two ONE");
  });

  it("runs glob relative to the requested cwd", async () => {
    const files = await loadFiles();
    await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "src", "a.ts"), "export {};", "utf8");
    await fs.writeFile(path.join(workspaceDir, "src", "b.md"), "# b", "utf8");
    await fs.writeFile(path.join(workspaceDir, "c.ts"), "export {};", "utf8");

    const result = await files.glob("*.ts", "src");

    expect(result.files).toEqual(["a.ts"]);
    expect(result.resolvedFiles).toEqual([path.join(workspaceDir, "src", "a.ts")]);
    expect(result.resolvedCwd).toBe(path.join(workspaceDir, "src"));
  });

  it("greps text files and skips binary files", async () => {
    const files = await loadFiles();
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "match.txt"), "needle\n", "utf8");
    await fs.writeFile(path.join(workspaceDir, "binary.dat"), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]));

    const result = await files.grep({ pattern: "needle", searchPath: "." });

    expect(result.count).toBe(1);
    expect(result.matches).toEqual([
      expect.objectContaining({
        file: "match.txt",
        line: 1,
        content: "needle",
      }),
    ]);
  });
});
