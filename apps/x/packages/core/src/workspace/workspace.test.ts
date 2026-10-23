import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// workspace.writeFile is the renderer's write path (workspace:writeFile IPC),
// so the pptx editor's transactional saves are verified HERE, not in
// filesystem/files.ts. Both share the etag guard in filesystem/etag.ts; this
// pins that the IPC path carries the same contract.

let tmpDir: string;
let workspaceDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-workspace-test-"));
  workspaceDir = path.join(tmpDir, "workspace");
  await fs.mkdir(workspaceDir, { recursive: true });
  process.env.ROWBOAT_WORKDIR = workspaceDir;
  vi.resetModules();
  vi.doMock("../knowledge/version_history.js", () => ({
    commitAll: vi.fn(async () => undefined),
    initRepo: vi.fn(async () => undefined),
  }));
});

afterEach(async () => {
  delete process.env.ROWBOAT_WORKDIR;
  vi.doUnmock("../knowledge/version_history.js");
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function loadWorkspace() {
  return import("./workspace.js");
}

describe("workspace.readdir extension filtering", () => {
  beforeEach(async () => {
    vi.doMock("../config/config.js", () => ({ WorkDir: workspaceDir }));
    for (const dir of ["Notes/Nested", "Archive.txt", ".hidden"]) {
      await fs.mkdir(path.join(workspaceDir, "listing", dir), { recursive: true });
    }
    for (const file of ["root.md", "ignored.txt", "Notes/kept.md", "Notes/Nested/deep.md", "Notes/ignored.txt", "Archive.txt/archived.md", ".hidden/secret.md", ".hidden.md"]) {
      await fs.writeFile(path.join(workspaceDir, "listing", file), "test");
    }
  });

  afterEach(() => {
    vi.doUnmock("../config/config.js");
  });

  it("traverses directories regardless of their names and filters only files", async () => {
    const workspace = await loadWorkspace();
    const entries = await workspace.readdir("listing", { recursive: true, allowedExtensions: [".md"] });

    expect(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path).sort()).toEqual([
      "listing/Archive.txt/archived.md",
      "listing/Notes/Nested/deep.md",
      "listing/Notes/kept.md",
      "listing/root.md",
    ]);
    expect(entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path).sort()).toEqual([
      "listing/Archive.txt", "listing/Notes", "listing/Notes/Nested",
    ]);
  });

  it("keeps directory rows and stats in non-recursive filtered listings", async () => {
    const workspace = await loadWorkspace();
    const entries = await workspace.readdir("listing", { allowedExtensions: [".md"], includeStats: true });

    expect(entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["Archive.txt", "dir"], ["Notes", "dir"], ["root.md", "file"],
    ]);
    for (const entry of entries) {
      expect(entry.stat).toEqual({ size: expect.any(Number), mtimeMs: expect.any(Number) });
    }
  });

  it("honors includeHidden for matching files and directory traversal", async () => {
    const workspace = await loadWorkspace();
    const entries = await workspace.readdir("listing", {
      recursive: true, allowedExtensions: [".md"], includeHidden: true,
    });
    const paths = entries.map((entry) => entry.path);
    expect(paths).toContain("listing/.hidden");
    expect(paths).toContain("listing/.hidden/secret.md");
    expect(paths).toContain("listing/.hidden.md");
    expect(paths).not.toContain("listing/ignored.txt");
  });

  it("treats an empty extension list as unfiltered", async () => {
    const workspace = await loadWorkspace();
    const unfiltered = await workspace.readdir("listing", { recursive: true });
    const entries = await workspace.readdir("listing", { recursive: true, allowedExtensions: [] });
    expect(entries).toEqual(unfiltered);
    expect(entries.map((entry) => entry.path)).toContain("listing/Notes/ignored.txt");
  });
});

describe("workspace.writeFile etag guard", () => {
  it("accepts a write keyed on the etag readFile reported, then refuses the stale one", async () => {
    const workspace = await loadWorkspace();
    await workspace.writeFile("decks/a.bin", Buffer.from("first").toString("base64"), { encoding: "base64" });
    const read = await workspace.readFile("decks/a.bin", "base64");

    const ok = await workspace.writeFile("decks/a.bin", Buffer.from("second").toString("base64"), {
      encoding: "base64",
      expectedEtag: read.etag,
    });
    expect(ok.etag).not.toBe(read.etag);

    await expect(
      workspace.writeFile("decks/a.bin", Buffer.from("third").toString("base64"), {
        encoding: "base64",
        expectedEtag: read.etag,
      }),
    ).rejects.toThrow("ETag mismatch");
    await expect(fs.readFile(path.join(workspaceDir, "decks", "a.bin"), "utf8")).resolves.toBe("second");
  });

  // The open deck gets deleted (Finder, git checkout, the assistant's
  // file-remove): the editor's next guarded save must be refused as a
  // CONFLICT — the same 'ETag mismatch' marker the renderer's file-sync
  // checks for — not fail with a raw ENOENT that no UI path recovers from.
  it("a missing file under expectedEtag is refused as an ETag mismatch, never raw ENOENT", async () => {
    const workspace = await loadWorkspace();
    const initial = await workspace.writeFile("decks/gone.bin", Buffer.from("first").toString("base64"), {
      encoding: "base64",
    });
    await fs.unlink(path.join(workspaceDir, "decks", "gone.bin"));

    const attempt = workspace.writeFile("decks/gone.bin", Buffer.from("second").toString("base64"), {
      encoding: "base64",
      expectedEtag: initial.etag,
    });
    await expect(attempt).rejects.toThrow("ETag mismatch");
    await expect(attempt).rejects.not.toThrow("ENOENT");
    await expect(attempt).rejects.toMatchObject({ code: "ETAG_MISMATCH", reason: "missing" });
    // Refused means refused: nothing was recreated behind the user's back.
    await expect(fs.access(path.join(workspaceDir, "decks", "gone.bin"))).rejects.toMatchObject({ code: "ENOENT" });

    // The explicit unguarded write ("Keep mine" / recreate) brings it back.
    const recreated = await workspace.writeFile("decks/gone.bin", Buffer.from("second").toString("base64"), {
      encoding: "base64",
    });
    expect(recreated.stat.size).toBe(6);
  });
});
