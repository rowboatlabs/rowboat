import { describe, it, expect } from "vitest";
import { classifyExecutable } from "./meeting-apps.js";

describe("classifyExecutable", () => {
    it("classifies Zoom on both platforms", () => {
        expect(classifyExecutable("Zoom.exe")).toBe("zoom"); // Windows
        expect(classifyExecutable("zoom.us")).toBe("zoom"); // macOS pmset name
    });

    it("classifies the new Teams client by its macOS/Windows process name", () => {
        expect(classifyExecutable("MSTeams")).toBe("teams"); // macOS pmset name
        expect(classifyExecutable("ms-teams.exe")).toBe("teams"); // Windows
        expect(classifyExecutable("Microsoft Teams")).toBe("teams"); // classic
    });

    it("classifies browsers as the browser kind", () => {
        expect(classifyExecutable("Google Chrome")).toBe("browser");
        expect(classifyExecutable("Safari")).toBe("browser");
    });

    it("returns unknown for unrelated processes", () => {
        expect(classifyExecutable("Finder")).toBe("unknown");
        expect(classifyExecutable("WindowServer")).toBe("unknown");
    });
});
