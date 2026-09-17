import { describe, expect, it } from "vitest";
import { selectManagedAuthConfig } from "./auth-config.js";

const managed = (id: string, name?: string, scheme = "OAUTH2") => ({
    id,
    name,
    auth_scheme: scheme,
    is_composio_managed: true,
});

describe("selectManagedAuthConfig", () => {
    it("selects the exact per-profile config", () => {
        const items = [managed("other", "rowboat-work-gmail"), managed("mine", "rowboat-personal-gmail")];
        expect(selectManagedAuthConfig(items, "gmail", "personal")).toBe("mine");
    });

    it("matches the legacy generic name for the default profile", () => {
        const items = [managed("legacy", "rowboat-gmail")];
        expect(selectManagedAuthConfig(items, "gmail", "default")).toBe("legacy");
    });

    it("never falls back to a foreign-named managed config", () => {
        const items = [managed("theirs", "rowboat-work-gmail")];
        expect(selectManagedAuthConfig(items, "gmail", "personal")).toBeNull();
    });

    it("returns null when nothing is listed", () => {
        expect(selectManagedAuthConfig([], "gmail", "personal")).toBeNull();
    });

    it("ignores non-OAUTH2 and unmanaged entries", () => {
        const items = [
            { id: "a", name: "rowboat-personal-gmail", auth_scheme: "API_KEY", is_composio_managed: true },
            { id: "b", name: "rowboat-personal-gmail", auth_scheme: "OAUTH2", is_composio_managed: false },
        ];
        expect(selectManagedAuthConfig(items, "gmail", "personal")).toBeNull();
    });

    it("ignores entries without a name", () => {
        const items = [managed("noname")];
        expect(selectManagedAuthConfig(items, "gmail", "personal")).toBeNull();
    });
});
