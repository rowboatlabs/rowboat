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

describe("workspace.readdir symlinks", () => {
  async function makeVault() {
    const vault = path.join(tmpDir, "vault");
    await fs.mkdir(path.join(vault, "sub"), { recursive: true });
    await fs.writeFile(path.join(vault, "a.md"), "# a");
    await fs.writeFile(path.join(vault, "sub", "b.md"), "# b");
    await fs.mkdir(path.join(workspaceDir, "knowledge"), { recursive: true });
    return vault;
  }

  it("lists and recurses into a symlinked directory", async () => {
    const vault = await makeVault();
    await fs.symlink(vault, path.join(workspaceDir, "knowledge", "vault"), "dir");
    const workspace = await loadWorkspace();
    const entries = await workspace.readdir("knowledge", { recursive: true, allowedExtensions: [".md", ""] });
    const paths = entries.map((e) => `${e.kind}:${e.path}`);
    expect(paths).toContain("dir:knowledge/vault");
    expect(paths).toContain("file:knowledge/vault/a.md");
    expect(paths).toContain("file:knowledge/vault/sub/b.md");
  });

  it("lists a symlinked file as a file and skips dangling links", async () => {
    const vault = await makeVault();
    await fs.symlink(path.join(vault, "a.md"), path.join(workspaceDir, "knowledge", "link.md"));
    await fs.symlink(path.join(tmpDir, "missing.md"), path.join(workspaceDir, "knowledge", "dangling.md"));
    const workspace = await loadWorkspace();
    const entries = await workspace.readdir("knowledge", { includeStats: true });
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual(["file:link.md"]);
    expect(entries[0].stat?.size).toBe(3);
  });

  it("terminates on a symlink cycle", async () => {
    const vault = await makeVault();
    await fs.symlink(vault, path.join(workspaceDir, "knowledge", "vault"), "dir");
    await fs.symlink(workspaceDir, path.join(vault, "loop"), "dir");
    const workspace = await loadWorkspace();
    const entries = await workspace.readdir("knowledge", { recursive: true });
    expect(entries.length).toBeLessThan(50);
    expect(entries.map((e) => e.path)).toContain("knowledge/vault/a.md");
  });
});
