import { describe, expect, it } from "vitest";
import { UserMessageContext } from "@x/shared/dist/message.js";
import { convertFromMessages } from "./message-encoding.js";
import type { z } from "zod";

// The middle-pane block is how the assistant learns what the user is looking
// at. Its rendered shape is a contract with the prompt guidance in
// compose-instructions.ts (which tells the model to read `State:` and `Path:`),
// so the format is pinned here rather than left to drift.

function userTurn(
    middlePane: z.infer<typeof UserMessageContext>["middlePane"],
    text = "restyle this deck",
) {
    return convertFromMessages([
        {
            role: "user",
            content: text,
            userMessageContext: { middlePane },
        },
    ] as Parameters<typeof convertFromMessages>[0]);
}

const contentOf = (messages: ReturnType<typeof convertFromMessages>): string => {
    const content = messages[0].content;
    return typeof content === "string" ? content : JSON.stringify(content);
};

describe("middle-pane user context encoding", () => {
    it("renders an open deck as State/Path/Slide", () => {
        const encoded = contentOf(
            userTurn({
                kind: "deck",
                path: "presentations/Q3 review.pptx",
                slideNumber: 2,
                slideCount: 9,
            }),
        );

        expect(encoded).toContain("# User Context");
        expect(encoded).toContain(
            "Middle pane:\nState: deck\nPath: presentations/Q3 review.pptx\nSlide: 2 of 9",
        );
        // The user's own text still follows the context prefix.
        expect(encoded).toContain("# User Message");
        expect(encoded.endsWith("restyle this deck")).toBe(true);
        // A deck carries no content blob — that is what deck-review is for.
        expect(encoded).not.toContain("```");
    });

    it("reports the selected slide, not a 0-based index", () => {
        // The renderer sends 1-based; slide 1 of 1 is the single-slide case.
        const encoded = contentOf(
            userTurn({ kind: "deck", path: "a.pptx", slideNumber: 1, slideCount: 1 }),
        );
        expect(encoded).toContain("Slide: 1 of 1");
        expect(encoded).not.toContain("Slide: 0");
    });

    it("still renders the note, browser and empty kinds unchanged", () => {
        expect(contentOf(userTurn({ kind: "empty" }))).toContain(
            "Middle pane:\nState: empty",
        );
        expect(
            contentOf(userTurn({ kind: "note", path: "knowledge/A.md", content: "hi" })),
        ).toContain("Middle pane:\nState: note\nPath: knowledge/A.md\n\nContent:\n```\nhi\n```");
        expect(
            contentOf(userTurn({ kind: "browser", url: "https://x.test", title: "X" })),
        ).toContain("Middle pane:\nState: browser\nURL: https://x.test\nTitle: X");
    });

    it("renders an open whiteboard with the ids the whiteboard tools take, and no content", () => {
        const encoded = contentOf(
            userTurn(
                {
                    kind: "whiteboard",
                    orgId: "org-1",
                    orgName: "rowboat",
                    spaceId: "01SPACE",
                    spaceName: "Design",
                    path: "whiteboards/roadmap.excalidraw",
                },
                "add a QA box after review",
            ),
        );
        expect(encoded).toContain(
            'Middle pane:\nState: whiteboard\nBoard: whiteboards/roadmap.excalidraw in space "Design" on org "rowboat" (spaceId: 01SPACE; pass org: "rowboat")',
        );
        expect(encoded).toContain("whiteboard-read");
        expect(encoded).toContain("whiteboard-draw");
        expect(encoded).not.toContain("```");
        expect(encoded.endsWith("add a QA box after review")).toBe(true);
    });

    it("omits the context block entirely when there is none", () => {
        const encoded = contentOf(
            convertFromMessages([
                { role: "user", content: "hello" },
            ] as Parameters<typeof convertFromMessages>[0]),
        );
        expect(encoded).toBe("hello");
    });
});

// The @ menu's Spaces picks ride userMessageContext.spaceMentions: the model
// reads "@Name = <kind> ... (id)" lines and is told the ids are exact, so it
// acts on the pick instead of re-resolving the name. Format pinned here.
describe("space mentions user context encoding", () => {
    const spaceMentions = [
        { kind: "space" as const, orgId: "org-1", orgName: "rowboat", spaceId: "01SPACE", name: "Design" },
        { kind: "member" as const, orgId: "org-1", orgName: "rowboat", memberId: "01HARSH", displayName: "Harsh Kumar" },
    ];

    it("lists each pick with its exact id, keyed by the @ text", () => {
        const encoded = contentOf(
            convertFromMessages([
                {
                    role: "user",
                    content: "post the summary in @Design and ping @Harsh Kumar",
                    userMessageContext: { spaceMentions },
                },
            ] as Parameters<typeof convertFromMessages>[0]),
        );
        expect(encoded).toContain("# User Context");
        expect(encoded).toContain("Spaces mentioned");
        expect(encoded).toContain('- @Design = space "Design" on org "rowboat" (spaceId: 01SPACE)');
        expect(encoded).toContain('- @Harsh Kumar = person "Harsh Kumar" on org "rowboat" (memberId: 01HARSH;');
        // The ids are authoritative — the block says so, so the model skips the lookups.
        expect(encoded).toContain("use them directly");
        expect(encoded.endsWith("post the summary in @Design and ping @Harsh Kumar")).toBe(true);
    });

    it("also rides a content-parts message, ahead of the attachment list", () => {
        const encoded = contentOf(
            convertFromMessages([
                {
                    role: "user",
                    content: [
                        { type: "attachment", path: "knowledge/notes.md", filename: "notes", mimeType: "text/markdown" },
                        { type: "text", text: "share @notes in @Design" },
                    ],
                    userMessageContext: { spaceMentions: [spaceMentions[0]] },
                },
            ] as Parameters<typeof convertFromMessages>[0]),
        );
        expect(encoded.indexOf("Spaces mentioned")).toBeGreaterThan(-1);
        expect(encoded.indexOf("Spaces mentioned")).toBeLessThan(encoded.indexOf("User has attached"));
        expect(encoded).not.toContain("@Harsh Kumar =");
    });

    it("lists a board with its space and path, pointed at the whiteboard tools", () => {
        const encoded = contentOf(
            convertFromMessages([
                {
                    role: "user",
                    content: "add a QA step to @roadmap",
                    userMessageContext: {
                        spaceMentions: [
                            {
                                kind: "board",
                                orgId: "org-1",
                                orgName: "rowboat",
                                spaceId: "01SPACE",
                                spaceName: "Design",
                                path: "whiteboards/roadmap.excalidraw",
                                name: "roadmap",
                            },
                        ],
                    },
                },
            ] as Parameters<typeof convertFromMessages>[0]),
        );
        expect(encoded).toContain(
            '- @roadmap = whiteboard "roadmap" (board: whiteboards/roadmap.excalidraw) in space "Design" on org "rowboat" (spaceId: 01SPACE; whiteboard-read / whiteboard-draw with this spaceId and board)',
        );
    });

    it("dedupes a target picked twice and skips the block when the list is empty", () => {
        const twice = contentOf(
            convertFromMessages([
                {
                    role: "user",
                    content: "@Design @Design",
                    userMessageContext: { spaceMentions: [spaceMentions[0], spaceMentions[0]] },
                },
            ] as Parameters<typeof convertFromMessages>[0]),
        );
        expect(twice.split("- @Design = space").length - 1).toBe(1);

        const none = contentOf(
            convertFromMessages([
                { role: "user", content: "hello", userMessageContext: { spaceMentions: [] } },
            ] as Parameters<typeof convertFromMessages>[0]),
        );
        expect(none).toBe("hello");
    });
});

describe("UserMessageContext schema", () => {
    it("accepts space, board and member mentions, and rejects an unknown kind", () => {
        expect(
            UserMessageContext.safeParse({
                spaceMentions: [
                    { kind: "space", orgId: "o", orgName: "rowboat", spaceId: "s", name: "Design" },
                    { kind: "board", orgId: "o", orgName: "rowboat", spaceId: "s", spaceName: "Design", path: "whiteboards/board.excalidraw", name: "board" },
                    { kind: "member", orgId: "o", orgName: "rowboat", memberId: "m", displayName: "Harsh" },
                ],
                middlePane: { kind: "whiteboard", orgId: "o", orgName: "rowboat", spaceId: "s", spaceName: "Design", path: "whiteboards/board.excalidraw" },
            }).success,
        ).toBe(true);
        // A board ref without its space is not addressable by the tools.
        expect(
            UserMessageContext.safeParse({
                spaceMentions: [{ kind: "board", orgId: "o", orgName: "rowboat", path: "whiteboards/board.excalidraw", name: "board" }],
            }).success,
        ).toBe(false);
        expect(
            UserMessageContext.safeParse({
                spaceMentions: [{ kind: "file", path: "knowledge/a.md" }],
            }).success,
        ).toBe(false);
    });

    it("accepts the deck member", () => {
        const parsed = UserMessageContext.safeParse({
            middlePane: { kind: "deck", path: "a.pptx", slideNumber: 3, slideCount: 12 },
        });
        expect(parsed.success).toBe(true);
    });

    it("rejects a deck without a slide position, and a 0-based slideNumber", () => {
        expect(
            UserMessageContext.safeParse({
                middlePane: { kind: "deck", path: "a.pptx" },
            }).success,
        ).toBe(false);
        expect(
            UserMessageContext.safeParse({
                middlePane: { kind: "deck", path: "a.pptx", slideNumber: 0, slideCount: 3 },
            }).success,
        ).toBe(false);
    });

    it("still accepts the other three kinds", () => {
        for (const middlePane of [
            { kind: "empty" },
            { kind: "note", path: "a.md", content: "x" },
            { kind: "browser", url: "https://x.test", title: "X" },
        ]) {
            expect(UserMessageContext.safeParse({ middlePane }).success).toBe(true);
        }
    });
});
