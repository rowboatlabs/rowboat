import { z } from "zod";

// The structured outline an LLM produces from a user's deck prompt — the
// contract between core generation (knowledge/deck_outline.ts), the
// deck:generateOutline IPC channel, and the renderer's deck builder.

/** Built-in deck palettes (lib/pptx/new-deck.ts DECK_PALETTES ids). */
export const DeckOutlinePalette = z.enum(["navy", "warm", "mono"]);
export type DeckOutlinePalette = z.infer<typeof DeckOutlinePalette>;

/** The visual patterns the synthesizer can render (lib/pptx/generate.ts). */
export const DeckSlidePattern = z.enum([
    "title",
    "bullets",
    "two-column",
    "big-number",
    "quote",
    "section",
    "closing",
]);
export type DeckSlidePattern = z.infer<typeof DeckSlidePattern>;

/** One card of a 'two-column' slide. */
export const DeckOutlineColumn = z.object({
    heading: z.string(),
    lines: z.array(z.string()),
});
export type DeckOutlineColumn = z.infer<typeof DeckOutlineColumn>;

/** The headline metric of a 'big-number' slide. */
export const DeckOutlineStat = z.object({
    value: z.string(),
    caption: z.string(),
});
export type DeckOutlineStat = z.infer<typeof DeckOutlineStat>;

/** The pull quote of a 'quote' slide. */
export const DeckOutlineQuote = z.object({
    text: z.string(),
    attribution: z.string().optional(),
});
export type DeckOutlineQuote = z.infer<typeof DeckOutlineQuote>;

export const DeckOutlineSlide = z.object({
    /** 'title' = the Title Slide layout; 'title-body' = Title and Body. */
    layout: z.enum(["title", "title-body"]),
    /** Visual pattern; the synthesizer falls back to 'bullets' when absent. */
    pattern: DeckSlidePattern.optional(),
    heading: z.string().min(1),
    bullets: z.array(z.string()).optional(),
    /** Short narrative alternative to bullets. */
    body: z.string().optional(),
    /** 'two-column' only: exactly the cards to render (max 2 used). */
    columns: z.array(DeckOutlineColumn).optional(),
    /** 'big-number' only. */
    stat: DeckOutlineStat.optional(),
    /** 'quote' only. */
    quote: DeckOutlineQuote.optional(),
    /**
     * Facts the user should fill in (short labels like "MoM growth %"),
     * present when the slide carries bracketed placeholders instead of
     * invented numbers. Surfaced as "fill in" chips in the outline review.
     */
    needsInput: z.array(z.string()).optional(),
    speakerNotes: z.string().optional(),
});
export type DeckOutlineSlide = z.infer<typeof DeckOutlineSlide>;

// A response is EITHER a clarify round (1-2 questions, no slides) OR a full
// outline (>=1 slide, no questions) — never both, never neither. The XOR is a
// refinement so the field shapes stay unchanged; slides drops its own min(1)
// because a clarify response legitimately carries none, and the "full outline
// needs a slide" rule moves into the refinement.
export const DeckOutline = z.object({
    title: z.string().min(1),
    suggestedPalette: DeckOutlinePalette,
    /**
     * Questions on a clarify round; absent on a full outline. Sized to the
     * gap (typically 2-5); 8 is a sanity bound, not a target.
     */
    clarifyingQuestions: z.array(z.string()).max(8).optional(),
    slides: z.array(DeckOutlineSlide),
}).superRefine((val, ctx) => {
    const hasQuestions = (val.clarifyingQuestions?.length ?? 0) > 0;
    const hasSlides = val.slides.length > 0;
    if (hasQuestions && hasSlides) {
        ctx.addIssue({
            code: 'custom',
            path: ['slides'],
            message: 'clarifyingQuestions and slides are mutually exclusive',
        });
    }
    if (!hasQuestions && !hasSlides) {
        ctx.addIssue({
            code: 'custom',
            path: ['slides'],
            message: 'a full outline (no clarifyingQuestions) must have at least one slide',
        });
    }
});
export type DeckOutline = z.infer<typeof DeckOutline>;

/** One slide as the deck-context sent to single-slide generation. */
export const DeckContextSlide = z.object({
    heading: z.string(),
    bullets: z.array(z.string()),
});
export type DeckContextSlide = z.infer<typeof DeckContextSlide>;

/** The deck the model reasons about when generating one more slide. */
export const DeckContext = z.object({
    title: z.string(),
    slides: z.array(DeckContextSlide),
});
export type DeckContext = z.infer<typeof DeckContext>;

export const GenerateSlideRequest = z.object({
    deckContext: DeckContext,
    /** What the slide should be about; when absent the model suggests one. */
    topic: z.string().optional(),
    /** 0-based insert index (0 = before the first slide, N = after the last). */
    position: z.number().int().min(0),
});
export type GenerateSlideRequest = z.infer<typeof GenerateSlideRequest>;

export const EditSlideRequest = z.object({
    /** The slide as it currently is, in outline form (pattern + content). */
    slide: DeckOutlineSlide,
    instruction: z.string().min(1),
    deckContext: DeckContext,
});
export type EditSlideRequest = z.infer<typeof EditSlideRequest>;

export const GenerateDeckOutlineRequest = z.object({
    prompt: z.string().min(1),
    slideCount: z.number().int().min(1).max(30).optional(),
    tone: z.string().optional(),
    /** Answers to a previous round's clarifyingQuestions, in order. */
    answers: z.array(z.string()).optional(),
});
export type GenerateDeckOutlineRequest = z.infer<typeof GenerateDeckOutlineRequest>;
