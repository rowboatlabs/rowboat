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

    it("omits the context block entirely when there is none", () => {
        const encoded = contentOf(
            convertFromMessages([
                { role: "user", content: "hello" },
            ] as Parameters<typeof convertFromMessages>[0]),
        );
        expect(encoded).toBe("hello");
    });
});

describe("UserMessageContext schema", () => {
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
