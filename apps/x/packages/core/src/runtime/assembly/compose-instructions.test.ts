import { describe, expect, it } from "vitest";
import {
    composeSystemInstructions,
    type ComposeSystemInstructionsInput,
} from "./compose-instructions.js";

// Golden-bytes characterization of system-prompt composition. These
// snapshots pin the EXACT output for a representative composition matrix:
// provider prefix caching and agent-snapshot inheritance both depend on
// byte-identical prompts for identical inputs, so any restructuring of the
// composer (capability folding) must keep these snapshots green. An
// intentional prompt-text change is allowed — but it must be intentional,
// reviewed as a snapshot diff.

function input(
    overrides: Partial<ComposeSystemInstructionsInput> = {},
): ComposeSystemInstructionsInput {
    return {
        instructions: "You are the test agent.",
        agentNotesContext: null,
        userWorkDir: null,
        voiceInput: false,
        voiceOutput: null,
        searchEnabled: false,
        codeMode: null,
        codeCwd: null,
        videoMode: false,
        coachMode: false,
        ...overrides,
    };
}

const MATRIX: Array<[name: string, overrides: Partial<ComposeSystemInstructionsInput>]> = [
    ["base: no modes active", {}],
    ["agent notes", { agentNotesContext: "# Agent Memory\n\nRemember X." }],
    ["work directory", { userWorkDir: "/Users/test/Documents/Work" }],
    ["voice input", { voiceInput: true }],
    ["voice output summary", { voiceOutput: "summary" }],
    ["voice output full", { voiceOutput: "full" }],
    ["search enabled", { searchEnabled: true }],
    ["video mode", { videoMode: true }],
    ["coach mode", { coachMode: true }],
    ["code mode claude with cwd", { codeMode: "claude", codeCwd: "/tmp/project" }],
    ["code mode codex without cwd", { codeMode: "codex" }],
    [
        "everything on",
        {
            agentNotesContext: "# Agent Memory\n\nRemember X.",
            userWorkDir: "/Users/test/Documents/Work",
            voiceInput: true,
            voiceOutput: "summary",
            searchEnabled: true,
            codeMode: "claude",
            codeCwd: "/tmp/project",
            videoMode: true,
            coachMode: true,
        },
    ],
];

describe("composeSystemInstructions golden bytes", () => {
    for (const [name, overrides] of MATRIX) {
        it(name, () => {
            expect(composeSystemInstructions(input(overrides))).toMatchSnapshot();
        });
    }

    it("mode blocks append in a fixed order after the base instructions", () => {
        const composed = composeSystemInstructions(
            input({
                agentNotesContext: "NOTES",
                userWorkDir: "/w",
                voiceInput: true,
                voiceOutput: "summary",
                searchEnabled: true,
                codeMode: "claude",
                codeCwd: "/c",
                videoMode: true,
                coachMode: true,
            }),
        );
        const markers = [
            "You are the test agent.",
            "# Hidden User Context",
            "NOTES",
            "# User Work Directory",
            "# Voice Input",
            "# Video Mode (Live Camera)",
            "# Practice Session (Coach Mode)",
            "# Voice Output (MANDATORY — READ THIS FIRST)",
            "# Search",
            "# Code Mode (Active)",
        ];
        let last = -1;
        for (const marker of markers) {
            const at = composed.indexOf(marker);
            expect(at, `marker missing or out of order: ${marker}`).toBeGreaterThan(last);
            last = at;
        }
    });
});
