import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// WorkDir is read at module load — must set before importing build_graph / user_config.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rowboat-build-graph-test-"));
process.env.ROWBOAT_WORKDIR = tmpDir;

const {
    emailAdmission,
    emailReplyGateBanner,
    buildOwnerBlock,
    ownerCompanyDomains,
} = await import("./build_graph.js");
const { saveUserConfig } = await import("../config/user_config.js");

const email = (frontmatter: string | null, body = "# Subject\n\n**Thread ID:** t1\n") =>
    frontmatter === null ? body : `---\n${frontmatter}\n---\n\n${body}`;

const gmailPath = path.join(tmpDir, "gmail_sync", "thread.md");

function threadBody(...fromLines: string[]) {
    return [
        "# Subject",
        "",
        "**Thread ID:** t1",
        "",
        ...fromLines.flatMap((f) => [`### From: ${f}`, "**Date:** Mon, 1 Jan 2026", "", "Body", "", "---", ""]),
    ].join("\n");
}

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

describe("ownerCompanyDomains", () => {
    it("excludes free-mail domains", () => {
        expect(ownerCompanyDomains(["a@gmail.com", "b@acme.com"])).toEqual(["acme.com"]);
    });

    it("includes explicit domain when not free-mail", () => {
        expect(ownerCompanyDomains(["a@gmail.com"], "acme.com")).toEqual(["acme.com"]);
    });
});

describe("emailReplyGateBanner + buildOwnerBlock (identity set)", () => {
    const configPath = path.join(tmpDir, "config", "user.json");

    beforeEach(() => {
        fs.mkdirSync(path.dirname(gmailPath), { recursive: true });
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    });

    afterEach(() => {
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    });

    it("returns null when no user identity is configured", () => {
        expect(emailReplyGateBanner(gmailPath, threadBody("Other <o@x.com>"))).toBeNull();
    });

    it("marks purely inbound as NOT replied (single email)", () => {
        saveUserConfig({ email: "me@acme.com", emails: ["me@acme.com"], domain: "acme.com" });
        const banner = emailReplyGateBanner(gmailPath, threadBody("Other <o@x.com>"));
        expect(banner).toContain("has NOT sent");
    });

    it("marks replied when From matches primary owner email", () => {
        saveUserConfig({ email: "me@acme.com", emails: ["me@acme.com"], domain: "acme.com" });
        const banner = emailReplyGateBanner(gmailPath, threadBody("Other <o@x.com>", "Me <me@acme.com>"));
        expect(banner).toContain("HAS sent");
    });

    it("marks replied when From matches secondary owner email only", () => {
        saveUserConfig({
            email: "me@acme.com",
            emails: ["me@acme.com", "alias@custom.com"],
            domain: "acme.com",
        });
        const banner = emailReplyGateBanner(
            gmailPath,
            threadBody("Other <o@x.com>", "Me <alias@custom.com>"),
        );
        expect(banner).toContain("HAS sent");
    });

    it("does not treat free-mail same-domain as teammate reply", () => {
        saveUserConfig({ email: "me@gmail.com", emails: ["me@gmail.com"] });
        const banner = emailReplyGateBanner(gmailPath, threadBody("Stranger <stranger@gmail.com>"));
        expect(banner).toContain("has NOT sent");
    });

    it("treats company-domain teammate From as replied", () => {
        saveUserConfig({ email: "me@acme.com", emails: ["me@acme.com"], domain: "acme.com" });
        const banner = emailReplyGateBanner(gmailPath, threadBody("Teammate <peer@acme.com>"));
        expect(banner).toContain("HAS sent");
    });

    it("ignores Google Groups rewrite From lines", () => {
        saveUserConfig({ email: "me@acme.com", emails: ["me@acme.com"], domain: "acme.com" });
        const banner = emailReplyGateBanner(
            gmailPath,
            threadBody("'Jane Doe' via Founders <founders@acme.com>"),
        );
        expect(banner).toContain("has NOT sent");
    });

    it("buildOwnerBlock lists multiple emails", () => {
        saveUserConfig({
            name: "Alex",
            email: "a@acme.com",
            emails: ["a@acme.com", "b@custom.com"],
            domain: "acme.com",
        });
        const block = buildOwnerBlock();
        expect(block).toContain("a@acme.com");
        expect(block).toContain("b@custom.com");
        expect(block).toContain("Alex");
        expect(block).toContain("company domain");
    });

    it("buildOwnerBlock single email keeps singular shape", () => {
        saveUserConfig({ email: "solo@acme.com", emails: ["solo@acme.com"], domain: "acme.com" });
        const block = buildOwnerBlock();
        expect(block).toMatch(/\*\*Email:\*\* solo@acme\.com\n/);
        // Multi-email form joins with ", " — single address must not use that join.
        expect(block).not.toMatch(/\*\*Email:\*\* .+, .+/);
    });
});
