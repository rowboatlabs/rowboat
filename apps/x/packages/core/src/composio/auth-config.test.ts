import { describe, expect, it } from "vitest";
import { selectManagedAuthConfig } from "./auth-config.js";

const managed = (id: string, name?: string, scheme = "OAUTH2") => ({
    id,
    name,
    auth_scheme: scheme,
    is_composio_managed: true,
});

describe("selectManagedAuthConfig", () => {
    it("prefers the exact per-profile config", () => {
        const items = [managed("other", "rowboat-work-gmail"), managed("mine", "rowboat-personal-gmail")];
        expect(selectManagedAuthConfig(items, "gmail", "personal")).toBe("mine");
    });

    it("matches the legacy generic name for the default profile", () => {
        const items = [managed("legacy", "rowboat-gmail")];
        expect(selectManagedAuthConfig(items, "gmail", "default")).toBe("legacy");
    });

    it("reuses the project-wide managed config when this profile has none", () => {
        // Composio allows only one managed auth per toolkit per project, so a
        // second profile must reuse the existing one instead of creating a
        // duplicate (which 400s "Managed auth already exists").
        const items = [managed("theirs", "rowboat-work-gmail")];
        expect(selectManagedAuthConfig(items, "gmail", "personal")).toBe("theirs");
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

    it("reuses a managed config even when its name is unset", () => {
        const items = [managed("noname")];
        expect(selectManagedAuthConfig(items, "gmail", "personal")).toBe("noname");
    });
});