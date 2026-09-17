import { describe, expect, it } from "vitest";
import {
    DEFAULT_PROFILE_ID,
    composioAuthConfigName,
    composioUserId,
    deepLinkScheme,
    defaultAppsPort,
    isValidProfileId,
    profileDeepLink,
    profileWorkDir,
    resolveProfileId,
} from "./profile.js";

describe("resolveProfileId", () => {
    it("defaults when unset or blank", () => {
        expect(resolveProfileId({})).toBe(DEFAULT_PROFILE_ID);
        expect(resolveProfileId({ ROWBOAT_PROFILE: "" })).toBe(DEFAULT_PROFILE_ID);
        expect(resolveProfileId({ ROWBOAT_PROFILE: "   " })).toBe(DEFAULT_PROFILE_ID);
    });

    it("normalizes case and trims", () => {
        expect(resolveProfileId({ ROWBOAT_PROFILE: "  Work " })).toBe("work");
    });

    it("accepts ids that match the pattern", () => {
        expect(resolveProfileId({ ROWBOAT_PROFILE: "personal" })).toBe("personal");
        expect(resolveProfileId({ ROWBOAT_PROFILE: "work-2" })).toBe("work-2");
    });

    it("rejects unsafe ids", () => {
        for (const bad of ["../evil", "a/b", "UPPER OK", "a".repeat(33), "semi;colon", "quo'te"]) {
            expect(() => resolveProfileId({ ROWBOAT_PROFILE: bad })).toThrow(/Invalid ROWBOAT_PROFILE/);
        }
    });
});

describe("isValidProfileId", () => {
    it("matches the documented pattern", () => {
        expect(isValidProfileId("work")).toBe(true);
        expect(isValidProfileId("personal-2")).toBe(true);
        expect(isValidProfileId("")).toBe(false);
        expect(isValidProfileId("has space")).toBe(false);
        expect(isValidProfileId("UPPER")).toBe(false);
    });
});

describe("per-profile derived identity", () => {
    it("keeps historic values for the default profile", () => {
        expect(profileWorkDir("default", "/home/u")).toBe("/home/u/.rowboat");
        expect(composioUserId("default")).toBe("rowboat-user");
        expect(composioAuthConfigName("gmail", "default")).toBe("rowboat-gmail");
        expect(deepLinkScheme("default")).toBe("rowboat");
    });

    it("namespaces everything for named profiles", () => {
        expect(profileWorkDir("personal", "/home/u")).toBe("/home/u/.rowboat-profiles/personal");
        expect(profileWorkDir("work", "/home/u")).toBe("/home/u/.rowboat-profiles/work");
        expect(composioUserId("personal")).toBe("rowboat-user-personal");
        expect(composioUserId("work")).toBe("rowboat-user-work");
        expect(composioAuthConfigName("gmail", "personal")).toBe("rowboat-personal-gmail");
        expect(deepLinkScheme("personal")).toBe("rowboat-personal");
        expect(deepLinkScheme("work")).toBe("rowboat-work");
    });

    it("builds deep links with the profile scheme", () => {
        expect(profileDeepLink("open?type=chat", "personal")).toBe("rowboat-personal://open?type=chat");
        expect(profileDeepLink("/oauth/google/done?session=x", "work")).toBe(
            "rowboat-work://oauth/google/done?session=x",
        );
        expect(profileDeepLink("open", "default")).toBe("rowboat://open");
    });

    it("composio ids never collide across profiles", () => {
        const ids = new Set(["default", "work", "personal"].map((p) => composioUserId(p)));
        expect(ids.size).toBe(3);
    });
});

describe("defaultAppsPort", () => {
    it("keeps the historic port for the default profile", () => {
        expect(defaultAppsPort("default")).toBe(3210);
    });

    it("derives stable in-range ports for named profiles", () => {
        for (const id of ["work", "personal", "work-2"]) {
            const port = defaultAppsPort(id);
            expect(port).toBeGreaterThanOrEqual(3211);
            expect(port).toBeLessThanOrEqual(3409);
            expect(defaultAppsPort(id)).toBe(port);
        }
    });

    it("separates work from personal", () => {
        expect(defaultAppsPort("work")).not.toBe(defaultAppsPort("personal"));
    });
});
