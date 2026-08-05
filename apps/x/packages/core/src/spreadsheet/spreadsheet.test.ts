import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let workspaceDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-spreadsheet-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
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

async function loadModule() {
    return import("./spreadsheet.js");
}

describe("createWorkbook", () => {
    it("creates an xlsx and reads it back through loadSheetWindow", async () => {
        const spreadsheet = await loadModule();

        const meta = await spreadsheet.createWorkbook("reports/q3.xlsx", [
            { name: "Summary", rows: [["Region", "Revenue"], ["East", 100], ["West", 200]] },
        ]);

        expect(meta.format).toBe("xlsx");
        expect(meta.workspaceRelPath).toBe("reports/q3.xlsx");
        expect(meta.sheets).toEqual([{ name: "Summary", rowCount: 3, columnCount: 2 }]);
        expect(meta.etag).toBeTruthy();

        const win = await spreadsheet.loadSheetWindow("reports/q3.xlsx", undefined, 0, 10);
        expect(win.activeSheet).toBe("Summary");
        expect(win.totalRows).toBe(3);
        expect(win.rows).toEqual([["Region", "Revenue"], ["East", 100], ["West", 200]]);
    });

    it("roundtrips CSV including quoting", async () => {
        const spreadsheet = await loadModule();

        await spreadsheet.createWorkbook("data/pets.csv", [
            { rows: [["name", "notes"], ["Rex", 'says "woof", loudly'], ["Mia", null]] },
        ]);

        const raw = await fs.readFile(path.join(workspaceDir, "data", "pets.csv"), "utf8");
        expect(raw).toContain('"says ""woof"", loudly"');

        const win = await spreadsheet.loadSheetWindow("data/pets.csv", undefined, 0, 10);
        expect(win.totalRows).toBe(3);
        expect(win.rows[1]).toEqual(["Rex", 'says "woof", loudly']);
    });

    it("rejects multi-sheet CSV, existing files without overwrite, and unwritable formats", async () => {
        const spreadsheet = await loadModule();

        await expect(
            spreadsheet.createWorkbook("a.csv", [{ rows: [["x"]] }, { rows: [["y"]] }])
        ).rejects.toThrow("single sheet");

        await spreadsheet.createWorkbook("b.xlsx", [{ rows: [["x"]] }]);
        await expect(
            spreadsheet.createWorkbook("b.xlsx", [{ rows: [["y"]] }])
        ).rejects.toThrow("already exists");
        await expect(
            spreadsheet.createWorkbook("b.xlsx", [{ rows: [["y", "z"]] }], { overwrite: true })
        ).resolves.toMatchObject({ sheets: [{ name: "Sheet1", rowCount: 1, columnCount: 2 }] });

        await expect(spreadsheet.createWorkbook("c.xls", [{ rows: [["x"]] }])).rejects.toThrow("cannot be written");
        await expect(spreadsheet.createWorkbook("c.txt", [{ rows: [["x"]] }])).rejects.toThrow("Unsupported spreadsheet format");
    });
});

describe("applyWorkbookOps", () => {
    async function seed(spreadsheet: Awaited<ReturnType<typeof loadModule>>) {
        await spreadsheet.createWorkbook("book.xlsx", [
            { name: "Summary", rows: [["Region", "Revenue"], ["East", 100], ["West", 200]] },
        ]);
    }

    it("applies setCells with type inference and null-clearing", async () => {
        const spreadsheet = await loadModule();
        await seed(spreadsheet);

        const result = await spreadsheet.applyWorkbookOps("book.xlsx", [
            { op: "setCells", cells: { B2: 150, C1: "Active", D4: true, A2: null } },
        ]);

        expect(result.changed.sheets).toEqual(["Summary"]);
        const win = await spreadsheet.loadSheetWindow("book.xlsx", "Summary", 0, 10);
        expect(win.rows[1]).toEqual([null, 150, null, null]);
        expect(win.rows[0][2]).toBe("Active");
        expect(win.rows[3][3]).toBe(true);
        expect(win.totalRows).toBe(4);
        expect(win.totalColumns).toBe(4);
    });

    it("applies setRange, appendRows, and clearRange", async () => {
        const spreadsheet = await loadModule();
        await seed(spreadsheet);

        await spreadsheet.applyWorkbookOps("book.xlsx", [
            { op: "setRange", start: "A2", rows: [["North", 5], ["South", 6]] },
            { op: "appendRows", rows: [["Extra", 7]] },
            { op: "clearRange", range: "B3:B3" },
        ]);

        const win = await spreadsheet.loadSheetWindow("book.xlsx", undefined, 0, 10);
        expect(win.rows).toEqual([
            ["Region", "Revenue"],
            ["North", 5],
            ["South", null],
            ["Extra", 7],
        ]);
    });

    it("appends to an empty sheet starting at the first row", async () => {
        const spreadsheet = await loadModule();
        await spreadsheet.createWorkbook("empty.xlsx", [{ name: "Data", rows: [] }]);

        await spreadsheet.applyWorkbookOps("empty.xlsx", [
            { op: "appendRows", rows: [["a", 1]] },
        ]);

        const win = await spreadsheet.loadSheetWindow("empty.xlsx", undefined, 0, 10);
        expect(win.rows).toEqual([["a", 1]]);
    });

    it("handles sheet add/rename/remove and guards the last sheet", async () => {
        const spreadsheet = await loadModule();
        await seed(spreadsheet);

        await spreadsheet.applyWorkbookOps("book.xlsx", [
            { op: "addSheet", name: "Details", rows: [["k", "v"]] },
            { op: "renameSheet", from: "Summary", to: "Overview" },
        ]);

        let win = await spreadsheet.loadSheetWindow("book.xlsx", "Details", 0, 10);
        expect(win.meta.sheets.map((s) => s.name)).toEqual(["Overview", "Details"]);

        await spreadsheet.applyWorkbookOps("book.xlsx", [{ op: "removeSheet", name: "Details" }]);
        win = await spreadsheet.loadSheetWindow("book.xlsx", undefined, 0, 10);
        expect(win.meta.sheets.map((s) => s.name)).toEqual(["Overview"]);

        await expect(
            spreadsheet.applyWorkbookOps("book.xlsx", [{ op: "removeSheet", name: "Overview" }])
        ).rejects.toThrow("only sheet");
    });

    it("rejects sheet operations and unknown sheet names on CSV", async () => {
        const spreadsheet = await loadModule();
        await spreadsheet.createWorkbook("flat.csv", [{ rows: [["a"], ["b"]] }]);

        await expect(
            spreadsheet.applyWorkbookOps("flat.csv", [{ op: "addSheet", name: "More" }])
        ).rejects.toThrow("sheet operations require .xlsx");

        await expect(
            spreadsheet.applyWorkbookOps("flat.csv", [{ op: "appendRows", sheet: "Other", rows: [["c"]] }])
        ).rejects.toThrow("single sheet");

        await spreadsheet.applyWorkbookOps("flat.csv", [{ op: "appendRows", rows: [["c"]] }]);
        const win = await spreadsheet.loadSheetWindow("flat.csv", undefined, 0, 10);
        expect(win.rows).toEqual([["a"], ["b"], ["c"]]);
    });

    it("propagates fresh etags across sequential edits and errors on missing files", async () => {
        const spreadsheet = await loadModule();
        await seed(spreadsheet);

        // Each edit re-reads and passes its read-time etag to the write; a
        // stale etag anywhere in the chain would make the second call throw.
        await spreadsheet.applyWorkbookOps("book.xlsx", [{ op: "appendRows", rows: [["x", 1]] }]);
        await spreadsheet.applyWorkbookOps("book.xlsx", [{ op: "appendRows", rows: [["y", 2]] }]);
        const win = await spreadsheet.loadSheetWindow("book.xlsx", undefined, 0, 10);
        expect(win.totalRows).toBe(5);

        await expect(
            spreadsheet.applyWorkbookOps("missing.xlsx", [{ op: "appendRows", rows: [["z"]] }])
        ).rejects.toThrow();
    });
});

describe("loadSheetWindow", () => {
    it("slices windows at boundaries and clamps the last page", async () => {
        const spreadsheet = await loadModule();
        const rows = Array.from({ length: 12 }, (_, i) => [`r${i}`, i]);
        await spreadsheet.createWorkbook("win.xlsx", [{ rows }]);

        const first = await spreadsheet.loadSheetWindow("win.xlsx", undefined, 0, 5);
        expect(first.rows.map((r) => r[0])).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(first.totalRows).toBe(12);

        const last = await spreadsheet.loadSheetWindow("win.xlsx", undefined, 10, 5);
        expect(last.rows.map((r) => r[0])).toEqual(["r10", "r11"]);

        const past = await spreadsheet.loadSheetWindow("win.xlsx", undefined, 50, 5);
        expect(past.rows).toEqual([]);
        expect(past.totalRows).toBe(12);
    });

    it("reuses the parse cache while the etag is unchanged and re-parses after external edits", async () => {
        const spreadsheet = await loadModule();
        const filePath = path.join(workspaceDir, "cache.csv");
        await spreadsheet.createWorkbook("cache.csv", [{ rows: [["a", "1"]] }]);

        // Pin a known mtime so the etag (size + mtime) is fully controlled.
        const pinned = new Date("2026-01-01T00:00:00Z");
        await fs.utimes(filePath, pinned, pinned);
        // CSV parsing infers numbers, so the created "1" reads back as 1.
        const primed = await spreadsheet.loadSheetWindow("cache.csv", undefined, 0, 5);
        expect(primed.rows).toEqual([["a", 1]]);

        // Swap in same-length content and restore the mtime: etag unchanged,
        // so the cached parse (old content) must still be served.
        const original = await fs.readFile(filePath, "utf8");
        const swapped = original.replace("a", "b");
        expect(swapped.length).toBe(original.length);
        await fs.writeFile(filePath, swapped, "utf8");
        await fs.utimes(filePath, pinned, pinned);
        const cached = await spreadsheet.loadSheetWindow("cache.csv", undefined, 0, 5);
        expect(cached.rows).toEqual([["a", 1]]);

        // Bumping the mtime changes the etag -> re-parse sees the new bytes.
        await fs.utimes(filePath, new Date(pinned.getTime() + 5000), new Date(pinned.getTime() + 5000));
        const fresh = await spreadsheet.loadSheetWindow("cache.csv", undefined, 0, 5);
        expect(fresh.rows).toEqual([["b", 1]]);
    });

    it("rejects unknown sheets on xlsx with the available names", async () => {
        const spreadsheet = await loadModule();
        await spreadsheet.createWorkbook("named.xlsx", [{ name: "Only", rows: [["x"]] }]);

        await expect(spreadsheet.loadSheetWindow("named.xlsx", "Nope", 0, 5)).rejects.toThrow("Available: Only");
    });
});
