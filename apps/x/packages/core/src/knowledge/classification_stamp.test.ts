import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// WorkDir is read from the env at module load, so it must be set before
// sync_gmail (→ config.ts) is imported — hence dynamic imports (not hoisted).
// This is why these tests don't live in sync_gmail.test.ts, whose static
// import of sync_gmail would lock in the default WorkDir first.
process.env.ROWBOAT_WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), "x-classification-stamp-test-"));
const { stampClassificationFrontmatter } = await import("./sync_gmail.js");
const { emailAdmission } = await import("./build_graph.js");
const { writeEmailMarkdown, emailMarkdownPath } = await import("./email/store.js");
const { markFileAsProcessed, hasFileChanged } = await import("./graph_state.js");
type GmailThreadSnapshot = import("./sync_gmail.js").GmailThreadSnapshot;

const SYNC_DIR = path.join(process.env.ROWBOAT_WORKDIR, "gmail_sync");

const BODY = "# Pricing discussion\n\n**Thread ID:** t1\n\n---\n\n### From: Sarah <sarah@acme.com>\n**Date:** Fri, 10 Jul 2026\n\nHere is the proposal.\n\n---\n";

function snapshot(overrides: Partial<GmailThreadSnapshot> = {}): GmailThreadSnapshot {
    return {
        threadId: "t1",
        threadUrl: "https://mail.google.com/mail/#inbox/t1",
        importance: "important",
        category: "correspondence",
        knowledge: "extract",
        messages: [],
        ...overrides,
    };
}

function writeMd(threadId: string, content: string): string {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
    const p = path.join(SYNC_DIR, `${threadId}.md`);
    fs.writeFileSync(p, content);
    return p;
}

describe("stampClassificationFrontmatter", () => {
    it("stamps a verdict the graph builder admits, preserving the body", () => {
        const p = writeMd("t1", BODY);
        stampClassificationFrontmatter("t1", snapshot());
        const stamped = fs.readFileSync(p, "utf-8");
        expect(stamped.startsWith("---\nimportance: important\ncategory: correspondence\nknowledge: extract\n")).toBe(true);
        expect(stamped.endsWith(BODY)).toBe(true);
        expect(emailAdmission(stamped)).toBe("process");
    });

    it("a knowledge: skip stamp is what excludes the thread", () => {
        const p = writeMd("t1", BODY);
        stampClassificationFrontmatter("t1", snapshot({ importance: "other", category: "newsletter", knowledge: "skip" }));
        expect(emailAdmission(fs.readFileSync(p, "utf-8"))).toBe("skip");
    });

    it("does not stamp a verdict that was never made (classify failure)", () => {
        const p = writeMd("t1", BODY);
        stampClassificationFrontmatter("t1", snapshot({ category: undefined, knowledge: undefined }));
        const content = fs.readFileSync(p, "utf-8");
        expect(content).toBe(BODY);
        expect(emailAdmission(content)).toBe("wait");
    });

    it("replaces legacy labeling-agent frontmatter instead of stacking on top", () => {
        const legacy = `---\nlabels:\n  relationship:\n    - investor\n  filter: []\nprocessed: true\n---\n\n${BODY}`;
        const p = writeMd("t1", legacy);
        stampClassificationFrontmatter("t1", snapshot());
        const stamped = fs.readFileSync(p, "utf-8");
        expect(stamped).not.toContain("labels:");
        expect(stamped.endsWith(BODY)).toBe(true);
        expect(emailAdmission(stamped)).toBe("process");
    });

    it("is idempotent — an unchanged verdict does not rewrite the file", () => {
        const p = writeMd("t1", BODY);
        stampClassificationFrontmatter("t1", snapshot());
        // Pin classified_at to a sentinel; a rewrite would replace it.
        const pinned = fs.readFileSync(p, "utf-8").replace(/^classified_at: .*$/m, 'classified_at: "sentinel"');
        fs.writeFileSync(p, pinned);
        stampClassificationFrontmatter("t1", snapshot());
        expect(fs.readFileSync(p, "utf-8")).toContain('classified_at: "sentinel"');
        // ...but a changed verdict does restamp.
        stampClassificationFrontmatter("t1", snapshot({ importance: "other" }));
        const restamped = fs.readFileSync(p, "utf-8");
        expect(restamped).toContain("importance: other");
        expect(restamped).not.toContain('classified_at: "sentinel"');
        expect(restamped.endsWith(BODY)).toBe(true);
    });

    it("is a no-op when the thread has no markdown mirror", () => {
        expect(() => stampClassificationFrontmatter("missing-thread", snapshot())).not.toThrow();
    });
});

// 2026-11-05 (#1239): each sync cycle rewrote the mirror without frontmatter
// and the stamp then re-wrote it with a fresh classified_at, so every synced
// thread looked changed to the graph builder and re-queued note_creation.
describe("sync cycle over an unchanged thread", () => {
    it("leaves the markdown byte-identical, so the graph builder does not re-queue it", () => {
        vi.useFakeTimers();
        try {
            const p = emailMarkdownPath("t-cycle");
            fs.mkdirSync(SYNC_DIR, { recursive: true });
            vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
            // One cycle: render the body, then stamp from the (cached) verdict.
            writeEmailMarkdown(p, BODY);
            stampClassificationFrontmatter("t-cycle", snapshot());
            const first = fs.readFileSync(p, "utf-8");
            expect(emailAdmission(first)).toBe("process");
            const state = { processedFiles: {}, lastBuildTime: new Date(0).toISOString() };
            markFileAsProcessed(p, state);

            vi.setSystemTime(new Date("2026-11-05T09:03:00Z"));
            writeEmailMarkdown(p, BODY);
            stampClassificationFrontmatter("t-cycle", snapshot());
            expect(fs.readFileSync(p, "utf-8")).toBe(first);
            expect(hasFileChanged(p, state)).toBe(false);

            // A changed body is written bare, so the graph builder holds it
            // until the new verdict is stamped.
            const changed = BODY + "\n### From: Sarah\n\nFollow-up.\n";
            writeEmailMarkdown(p, changed);
            expect(fs.readFileSync(p, "utf-8")).toBe(changed);
            expect(emailAdmission(changed)).toBe("wait");
        } finally {
            vi.useRealTimers();
        }
    });
});
