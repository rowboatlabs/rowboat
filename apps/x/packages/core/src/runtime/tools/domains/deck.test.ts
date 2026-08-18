import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { deck } from "@x/shared";

let tmpDir: string;
let workspaceDir: string;

const CANNED_REVIEW: deck.DeckReview = {
    overall: "Solid arc.",
    strengths: ["Clear opener"],
    comments: [{ slideNumber: 2, comment: "Tighten the bullets" }],
    factsToFill: ["[X]% growth"],
};

const reviewDeckMock = vi.fn<(input: unknown) => Promise<deck.DeckReview>>(async () => CANNED_REVIEW);

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-deck-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    process.env.ROWBOAT_WORKDIR = workspaceDir;
    vi.resetModules();
    reviewDeckMock.mockClear();
    vi.doMock("../../../knowledge/version_history.js", () => ({
        commitAll: vi.fn(async () => undefined),
        initRepo: vi.fn(async () => undefined),
    }));
    vi.doMock("../../../knowledge/deprecate_today_note.js", () => ({
        deprecateTodayNote: vi.fn(async () => undefined),
    }));
    // The review tool's model call — everything around it stays real.
    vi.doMock("../../../knowledge/deck_outline.js", () => ({
        reviewDeck: reviewDeckMock,
    }));
});

afterEach(async () => {
    delete process.env.ROWBOAT_WORKDIR;
    vi.doUnmock("../../../knowledge/version_history.js");
    vi.doUnmock("../../../knowledge/deprecate_today_note.js");
    vi.doUnmock("../../../knowledge/deck_outline.js");
    vi.resetModules();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

async function loadTools() {
    const { deckTools } = await import("./deck.js");
    return deckTools;
}

/** Parses the written package with the real engine (mediaUrls off, node env). */
async function readBack(relPath: string) {
    const { parsePptx, disposeDeck } = await import("@x/shared/dist/pptx/parse.js");
    const { buildDeckContext } = await import("@x/shared/dist/pptx/generate.js");
    const bytes = await fs.readFile(path.join(workspaceDir, relPath));
    const parsed = await parsePptx(bytes, { mediaUrls: false });
    try {
        return { context: buildDeckContext(parsed, "x"), themeColors: parsed.themeColors };
    } finally {
        disposeDeck(parsed);
    }
}

const OUTLINE_SLIDES: deck.DeckOutlineSlide[] = [
    { layout: "title", pattern: "title", heading: "Launch Plan", body: "Q3 readout" },
    { layout: "title-body", pattern: "bullets", heading: "Where we are", bullets: ["Shipped beta", "[X] customers live"] },
    { layout: "title-body", pattern: "section", heading: "What comes next" },
];

async function createDeck(tools: Awaited<ReturnType<typeof loadTools>>, relPath = "decks/plan.pptx") {
    const result = await tools["deck-create"].execute({
        path: relPath,
        title: "Launch Plan",
        palette: "navy",
        slides: OUTLINE_SLIDES,
    });
    expect(result).toMatchObject({ success: true, slideCount: 3 });
    return relPath;
}

describe("deck-create", () => {
    it("writes a parseable deck from an outline", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);

        const { context } = await readBack(relPath);
        expect(context.slides).toHaveLength(3);
        expect(context.slides[0].heading).toBe("Launch Plan");
        expect(context.slides[1].heading).toBe("Where we are");
    });

    it("refuses to overwrite without the flag, allows it with", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);

        const refused = await tools["deck-create"].execute({
            path: relPath, title: "Other", palette: "warm", slides: OUTLINE_SLIDES,
        });
        expect(refused).toMatchObject({ success: false });
        expect((refused as { error: string }).error).toContain("already exists");

        const replaced = await tools["deck-create"].execute({
            path: relPath, title: "Other", palette: "warm", slides: OUTLINE_SLIDES, overwrite: true,
        });
        expect(replaced).toMatchObject({ success: true });
    });

    it("rejects non-.pptx paths", async () => {
        const tools = await loadTools();
        const result = await tools["deck-create"].execute({
            path: "plan.docx", title: "T", palette: "navy", slides: OUTLINE_SLIDES,
        });
        expect(result).toMatchObject({ success: false });
        expect((result as { error: string }).error).toContain(".pptx");
    });
});

describe("deck-add-slide", () => {
    it("appends by default and inserts at an explicit position", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);

        const appended = await tools["deck-add-slide"].execute({
            path: relPath,
            slide: { layout: "title-body", pattern: "closing", heading: "Thank you" },
        });
        expect(appended).toMatchObject({ success: true, insertedAt: 4, slideCount: 4 });

        const inserted = await tools["deck-add-slide"].execute({
            path: relPath,
            position: 1,
            slide: { layout: "title-body", pattern: "bullets", heading: "Agenda", bullets: ["One", "Two"] },
        });
        expect(inserted).toMatchObject({ success: true, insertedAt: 2, slideCount: 5 });

        const { context } = await readBack(relPath);
        expect(context.slides.map((s) => s.heading)).toEqual([
            "Launch Plan", "Agenda", "Where we are", "What comes next", "Thank you",
        ]);
    });

    it("rejects an out-of-range position", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);
        const result = await tools["deck-add-slide"].execute({
            path: relPath,
            position: 9,
            slide: { layout: "title-body", heading: "Nope" },
        });
        expect(result).toMatchObject({ success: false });
    });
});

describe("deck-edit-slide", () => {
    it("rewrites text in place when the pattern is unchanged", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);

        const result = await tools["deck-edit-slide"].execute({
            path: relPath,
            slideNumber: 2,
            slide: {
                layout: "title-body",
                pattern: "bullets",
                heading: "Where we are today",
                bullets: ["Shipped beta", "[X] customers live"],
            },
        });
        expect(result).toMatchObject({ success: true, changed: true, mode: "text-edit" });

        const { context } = await readBack(relPath);
        expect(context.slides[1].heading).toBe("Where we are today");
    });

    it("rebuilds the slide when the pattern changes", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);

        const result = await tools["deck-edit-slide"].execute({
            path: relPath,
            slideNumber: 2,
            slide: {
                layout: "title-body",
                pattern: "big-number",
                heading: "Customers live",
                stat: { value: "[X]", caption: "customers live on the beta" },
            },
        });
        expect(result).toMatchObject({ success: true, changed: true, mode: "rebuild" });

        const { context } = await readBack(relPath);
        expect(context.slides).toHaveLength(3);
        expect(context.slides[1].heading).toBe("Customers live");
    });

    it("reports an unchanged slide as a no-op", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);
        const result = await tools["deck-edit-slide"].execute({
            path: relPath,
            slideNumber: 2,
            slide: OUTLINE_SLIDES[1],
        });
        expect(result).toMatchObject({ success: true, changed: false });
    });

    it("fails on a slide number past the end", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);
        const result = await tools["deck-edit-slide"].execute({
            path: relPath,
            slideNumber: 7,
            slide: OUTLINE_SLIDES[1],
        });
        expect(result).toMatchObject({ success: false });
        expect((result as { error: string }).error).toContain("does not exist");
    });
});

describe("deck-restyle", () => {
    it("swaps the theme palette without touching content", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);
        const before = await readBack(relPath);

        const result = await tools["deck-restyle"].execute({ path: relPath, palette: "sunset" });
        expect(result).toMatchObject({ success: true, palette: "sunset", slideCount: 3 });

        const after = await readBack(relPath);
        expect(after.themeColors?.accent1).not.toBe(before.themeColors?.accent1);
        expect(after.context.slides.map((s) => s.heading)).toEqual(
            before.context.slides.map((s) => s.heading),
        );
    });
});

describe("deck-review", () => {
    it("returns extracted slides plus the model review", async () => {
        const tools = await loadTools();
        const relPath = await createDeck(tools);

        const result = await tools["deck-review"].execute({ path: relPath, focus: "flow" });
        expect(result).toMatchObject({
            success: true,
            title: "plan",
            slideCount: 3,
            review: CANNED_REVIEW,
        });
        const slides = (result as { slides: Array<{ slideNumber: number; heading: string; pattern: string }> }).slides;
        expect(slides[0]).toMatchObject({ slideNumber: 1, heading: "Launch Plan" });
        expect(slides.map((s) => s.pattern)).toHaveLength(3);
        expect(reviewDeckMock).toHaveBeenCalledOnce();
        const arg = reviewDeckMock.mock.calls[0][0] as unknown as deck.ReviewDeckRequest;
        expect(arg.focus).toBe("flow");
        expect(arg.deckContext.slides).toHaveLength(3);
    });

    it("fails cleanly on a missing file", async () => {
        const tools = await loadTools();
        const result = await tools["deck-review"].execute({ path: "missing.pptx" });
        expect(result).toMatchObject({ success: false });
        expect(reviewDeckMock).not.toHaveBeenCalled();
    });
});

// deck-create's purpose/audience/lengthChoice exist to make the intake
// un-skippable: the tool-call layer validates against this schema, so a model
// that never asked the user literally cannot produce a valid call. The caps on
// slide content are the same mechanism pointed at slide quality.
describe("deck-create input schema (intake enforcement)", () => {
    const VALID = {
        path: "decks/plan.pptx",
        title: "Launch Plan",
        purpose: "update",
        audience: "the exec team",
        lengthChoice: "standard",
        palette: "navy",
        slides: OUTLINE_SLIDES,
    };

    it("accepts a call that carries the intake answers", async () => {
        const tools = await loadTools();
        expect(tools["deck-create"].inputSchema.safeParse(VALID).success).toBe(true);
    });

    // The description is the only place the model is told HOW to collect those
    // three arguments. It has to point at the ask-human card (and its option
    // cap), or the model falls back to typing a lettered list into chat.
    it("the description routes the intake through the ask-human card", async () => {
        const tools = await loadTools();
        const description = tools["deck-create"].description;

        expect(description).toContain("ask-human");
        expect(description).toMatch(/choices in its options array \(max 4\)/);
        expect(description).toMatch(/never in the question text/);
        expect(description).toMatch(/the card appends its own\s+"Other" row, so never add one/);
        // The three field shapes: two pick-ones and one open-ended call.
        expect(description).toMatch(/Purpose is a pick-one of four options/);
        expect(description).toMatch(/quick 5-6 \/ standard 8-10 \/ detailed 12\+/);
        expect(description).toMatch(/ONE\s+open-ended call with options omitted/);
        // One message of cards, and Skip does not become a re-ask.
        expect(description).toMatch(/issued in ONE message/);
        expect(description).toMatch(/when the user skipped a card/);
        expect(description).not.toMatch(/lettered options/);
    });

    it("rejects a call missing purpose, audience or lengthChoice", async () => {
        const tools = await loadTools();
        const schema = tools["deck-create"].inputSchema;
        for (const missing of ["purpose", "audience", "lengthChoice"] as const) {
            const rest = Object.fromEntries(Object.entries(VALID).filter(([k]) => k !== missing));
            expect(schema.safeParse(rest).success, `without ${missing}`).toBe(false);
        }
        // An empty audience is as good as none.
        expect(schema.safeParse({ ...VALID, audience: "" }).success).toBe(false);
        // And the enums are closed.
        expect(schema.safeParse({ ...VALID, purpose: "vibes" }).success).toBe(false);
        expect(schema.safeParse({ ...VALID, lengthChoice: "epic" }).success).toBe(false);
    });

    it("caps newly-authored content: 6 bullets, 4 column lines, 90-char lines", async () => {
        const tools = await loadTools();
        const schema = tools["deck-create"].inputSchema;
        const slideWith = (over: Partial<deck.DeckOutlineSlide>) => ({
            ...VALID,
            slides: [{ layout: "title-body", pattern: "bullets", heading: "H", ...over }],
        });

        expect(schema.safeParse(slideWith({ bullets: ["a", "b", "c", "d", "e", "f"] })).success).toBe(true);
        expect(schema.safeParse(slideWith({ bullets: ["a", "b", "c", "d", "e", "f", "g"] })).success).toBe(false);
        expect(schema.safeParse(slideWith({ bullets: ["x".repeat(91)] })).success).toBe(false);
        expect(
            schema.safeParse(
                slideWith({
                    pattern: "two-column",
                    columns: [
                        { heading: "A", lines: ["1", "2", "3", "4", "5"] },
                        { heading: "B", lines: ["1"] },
                    ],
                }),
            ).success,
        ).toBe(false);
    });

    it("deck-add-slide shares the caps; deck-edit-slide round-trips existing long content", async () => {
        const tools = await loadTools();
        const sevenBullets = {
            layout: "title-body",
            pattern: "bullets",
            heading: "H",
            bullets: ["a", "b", "c", "d", "e", "f", "g"],
        };
        expect(
            tools["deck-add-slide"].inputSchema.safeParse({ path: "a.pptx", slide: sevenBullets }).success,
        ).toBe(false);
        // The edit path must accept EXISTING content verbatim, caps or not —
        // an old deck (or a PowerPoint import) may exceed them.
        expect(
            tools["deck-edit-slide"].inputSchema.safeParse({ path: "a.pptx", slideNumber: 1, slide: sevenBullets }).success,
        ).toBe(true);
        expect(
            tools["deck-edit-slide"].inputSchema.safeParse({
                path: "a.pptx",
                slideNumber: 1,
                slide: { layout: "title-body", pattern: "bullets", heading: "H", bullets: ["y".repeat(200)] },
            }).success,
        ).toBe(true);
    });
});
