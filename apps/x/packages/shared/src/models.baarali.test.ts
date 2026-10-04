import { describe, expect, it } from "vitest";
import { vendorSections, type BaaraliModelMeta } from "./models.js";

// BAARALI(03/10/2026): the picker sorted by vendor, from the catalog's description.

const meta = (vendor: string, vendorRank: number, extra: Partial<BaaraliModelMeta> = {}): BaaraliModelMeta => ({
    vendor, vendorName: vendor.toUpperCase(), vendorRank, strength: "Polyvalent", recommended: false, ...extra,
});

describe("vendorSections", () => {
    const name = (id: string) => id.split("/")[1];

    it("groups by vendor in the catalog's order; « Conseillé » first, padlocked last, each by name", () => {
        const metas: Record<string, BaaraliModelMeta> = {
            "openai/gpt": meta("openai", 1),
            "anthropic/opus": meta("anthropic", 0, { unlock: "Pro max" }),
            "anthropic/haiku": meta("anthropic", 0),
            "anthropic/sonnet": meta("anthropic", 0, { recommended: true }),
        };
        expect(vendorSections(Object.keys(metas), (id) => metas[id], name)).toEqual([
            { vendor: "anthropic", name: "ANTHROPIC", items: ["anthropic/sonnet", "anthropic/haiku", "anthropic/opus"] },
            { vendor: "openai", name: "OPENAI", items: ["openai/gpt"] },
        ]);
    });

    it("is null without descriptions, and puts undescribed items last", () => {
        expect(vendorSections(["llama"], () => undefined, name)).toBeNull();
        expect(vendorSections(["a/x", "b/y"], (id) => (id === "a/x" ? meta("a", 0) : undefined), name)).toEqual([
            { vendor: "a", name: "A", items: ["a/x"] },
            { vendor: "", name: "", items: ["b/y"] },
        ]);
    });
});
