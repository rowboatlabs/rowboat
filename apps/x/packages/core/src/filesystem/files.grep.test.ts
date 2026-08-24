import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkDir } from "../config/config.js";
import { grep } from "./files.js";

// grep() resolves paths under WorkDir, so write the fixtures there.
const dir = path.join(WorkDir, "grep-test");

beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "note.md"), "We shipped the C++ parser\nBudget (est.) is $4k\nplain ascii line\n");
});

afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

describe("grep pattern handling", () => {
    it("still honors a valid regex", async () => {
        const { matches } = await grep({ pattern: "C\\+\\+", searchPath: "grep-test" });
        expect(matches.map((m) => m.line)).toEqual([1]);
    });

    it("matches literal text with regex metacharacters instead of throwing", async () => {
        // "C++" is an invalid regex (nothing to repeat); before the fix this
        // rejected the whole call. It should now match the literal line.
        const { matches } = await grep({ pattern: "C++", searchPath: "grep-test" });
        expect(matches.map((m) => m.line)).toEqual([1]);
    });

    it("matches an unbalanced-paren query as a literal", async () => {
        const { matches } = await grep({ pattern: "(est.)", searchPath: "grep-test" });
        expect(matches.map((m) => m.line)).toEqual([2]);
    });
});
