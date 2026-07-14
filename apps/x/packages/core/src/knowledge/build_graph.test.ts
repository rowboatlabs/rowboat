import { describe, expect, it } from "vitest";
import { emailAdmission } from "./build_graph.js";

const email = (frontmatter: string | null, body = "# Subject\n\n**Thread ID:** t1\n") =>
    frontmatter === null ? body : `---\n${frontmatter}\n---\n\n${body}`;

describe("emailAdmission", () => {
    it("holds files with no frontmatter until the classifier stamps a verdict", () => {
        expect(emailAdmission(email(null))).toBe("wait");
    });

    it("admits knowledge: extract", () => {
        expect(
            emailAdmission(email("importance: important\ncategory: correspondence\nknowledge: extract\nclassified_at: \"2026-07-11T00:00:00Z\"")),
        ).toBe("process");
    });

    it("skips knowledge: skip", () => {
        expect(
            emailAdmission(email("importance: other\ncategory: newsletter\nknowledge: skip\nclassified_at: \"2026-07-11T00:00:00Z\"")),
        ).toBe("skip");
    });

    it("importance never decides admission — an unimportant thread can still carry knowledge", () => {
        expect(
            emailAdmission(email("importance: other\ncategory: newsletter\nknowledge: extract\nclassified_at: \"2026-07-11T00:00:00Z\"")),
        ).toBe("process");
    });

    it("falls back to noise-tag matching for legacy labeling-agent frontmatter", () => {
        // `newsletter` is a noise tag in the default taxonomy → skip.
        expect(
            emailAdmission(email("labels:\n  relationship: []\n  topics: []\n  type: Newsletter\n  filter:\n    - newsletter\n  action: FYI\nprocessed: true")),
        ).toBe("skip");
        // No noise tags → process.
        expect(
            emailAdmission(email("labels:\n  relationship:\n    - investor\n  topics:\n    - fundraising\n  filter: []\nprocessed: true")),
        ).toBe("process");
    });

    it("matches legacy noise tags anywhere in the labels block, not just under filter:", () => {
        // The old labeling agent sometimes mis-filed noise tags (observed:
        // `candidate` under `relationship:`).
        expect(
            emailAdmission(email("labels:\n  relationship:\n    - candidate\n  topics: []\n  filter: []\nprocessed: true")),
        ).toBe("skip");
    });

    it("does not mistake a message-body '---' separator for frontmatter", () => {
        expect(emailAdmission("# Subject\n\n---\n\nknowledge: skip\n")).toBe("wait");
    });
});
