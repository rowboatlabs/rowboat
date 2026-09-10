import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mcpTools, readOnlyMcpToolNames } from "@rowboat/spaces-protocol";
import { SPACES_TOOL_NAMES, blobFilename, mimeForFilename, parseBlobLink, resolveOrgArg, spacesTools } from "./spaces.js";

const orgsState: { orgs: Array<{ id: string; name: string; address: string }> } = { orgs: [] };
vi.mock("../../../spaces/orgs.js", () => ({
    listOrgs: () => orgsState.orgs,
    orgForSpacesMcpServerName: (name: string) =>
        orgsState.orgs.find((o) => name === `spaces-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`) ?? null,
    spacesMcpServerNameFor: (id: string) => {
        const o = orgsState.orgs.find((x) => x.id === id);
        return o ? `spaces-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
    },
}));

const HASH = "a".repeat(64);
const SPACE = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("parseBlobLink", () => {
    it("parses the canonical grammar with a name", () => {
        expect(
            parseBlobLink(`https://acme.rowboat.space/s/${SPACE}/b/${HASH}?name=shot%20one.png`),
        ).toEqual({ address: "acme.rowboat.space", spaceId: SPACE, hash: HASH, name: "shot one.png" });
    });

    it("parses without a query, and dev http addresses with ports", () => {
        expect(parseBlobLink(`http://localhost:4272/s/${SPACE}/b/${HASH}`)).toEqual({
            address: "localhost:4272",
            spaceId: SPACE,
            hash: HASH,
        });
    });

    it("rejects non-blob links and malformed hashes", () => {
        expect(parseBlobLink(`https://acme.test/s/${SPACE}/f/notes.md`)).toBeNull();
        expect(parseBlobLink(`https://acme.test/s/${SPACE}/b/deadbeef`)).toBeNull();
        expect(parseBlobLink("not a url")).toBeNull();
    });
});

describe("blobFilename", () => {
    it("keeps a named file's extension and strips hostile characters", () => {
        expect(blobFilename('q3: "final" report.pdf', HASH, "application/pdf")).toBe("q3 final report.pdf");
    });

    it("appends an extension from the mime when the name has none", () => {
        expect(blobFilename("screenshot", HASH, "image/png")).toBe("screenshot.png");
    });

    it("falls back to a hash prefix, with an extension when the mime is known", () => {
        expect(blobFilename(undefined, HASH, "image/jpeg")).toBe(`${HASH.slice(0, 12)}.jpg`);
        expect(blobFilename(undefined, HASH, "application/x-mystery")).toBe(HASH.slice(0, 12));
    });

    it("never lets a name traverse directories", () => {
        expect(blobFilename("../../etc/passwd", HASH, "text/plain")).toBe("passwd.txt");
    });
});

describe("mimeForFilename", () => {
    it("maps well-known extensions and passes on the rest", () => {
        expect(mimeForFilename("chart.png")).toBe("image/png");
        expect(mimeForFilename("photo.JPEG")).toBe("image/jpeg");
        expect(mimeForFilename("archive.tar.zst")).toBeUndefined();
        expect(mimeForFilename("noext")).toBeUndefined();
    });
});


describe("the projected agent face", () => {
    it("projects every protocol tool as a builtin of the same name, plus the org argument", () => {
        for (const def of mcpTools) {
            const tool = spacesTools[def.name];
            expect(tool, def.name).toBeDefined();
            expect(tool!.description).toBe(def.description);
            const schema = z.toJSONSchema(tool!.inputSchema) as { properties: Record<string, unknown>; required?: string[] };
            expect(Object.keys(schema.properties)).toContain("org");
            expect(schema.required ?? []).not.toContain("org");
            // Every protocol argument survives the projection.
            const original = z.toJSONSchema(def.input) as { properties: Record<string, unknown> };
            for (const key of Object.keys(original.properties)) expect(schema.properties).toHaveProperty(key);
        }
    });

    it("gates writes and leaves reads ungated", () => {
        for (const def of mcpTools) {
            expect(spacesTools[def.name]!.permission, def.name).toBe(
                readOnlyMcpToolNames.has(def.name) ? "none" : "prompt",
            );
        }
    });

    it("attaches in a stable order: protocol order, then the blob bridge, then local tools", () => {
        expect(SPACES_TOOL_NAMES).toEqual([
            ...mcpTools.map((t) => t.name),
            "spaces-upload-blob",
            "spaces-download-blob",
            "schedule_message",
            "list_scheduled",
            "cancel_scheduled",
            "get_notify_prefs",
            "set_notify_pref",
        ]);
    });
});

describe("resolveOrgArg", () => {
    const rowboat = { id: "org-1", name: "Rowboat Labs", address: "rowboat.spaces.test" };
    const acme = { id: "org-2", name: "Acme", address: "acme.spaces.test" };

    it("refuses when nothing is set up", async () => {
        orgsState.orgs = [];
        await expect(resolveOrgArg(undefined)).rejects.toThrow(/No spaces orgs/);
    });

    it("defaults to the only org", async () => {
        orgsState.orgs = [rowboat];
        expect(await resolveOrgArg(undefined)).toBe(rowboat);
        expect(await resolveOrgArg("")).toBe(rowboat);
    });

    it("requires the argument with several orgs, naming them", async () => {
        orgsState.orgs = [rowboat, acme];
        await expect(resolveOrgArg(undefined)).rejects.toThrow(/"Rowboat Labs", "Acme"/);
    });

    it("matches by id, name (any case), address, slug, or server name", async () => {
        orgsState.orgs = [rowboat, acme];
        expect(await resolveOrgArg("org-2")).toBe(acme);
        expect(await resolveOrgArg("acme")).toBe(acme);
        expect(await resolveOrgArg("rowboat labs")).toBe(rowboat);
        expect(await resolveOrgArg("rowboat-labs")).toBe(rowboat);
        expect(await resolveOrgArg("spaces-rowboat-labs")).toBe(rowboat);
        expect(await resolveOrgArg("acme.spaces.test")).toBe(acme);
        await expect(resolveOrgArg("nope")).rejects.toThrow(/Unknown org 'nope'/);
    });

    it("a projected tool reports org resolution failures in the builtin error envelope", async () => {
        orgsState.orgs = [rowboat, acme];
        const result = (await spacesTools.whoami!.execute({})) as { success: boolean; error: string };
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Several orgs/);
    });
});
