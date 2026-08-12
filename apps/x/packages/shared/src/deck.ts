import { z } from "zod";

// The structured outline an LLM produces from a user's deck prompt — the
// contract between core generation (knowledge/deck_outline.ts), the
// deck:generateOutline IPC channel, and the renderer's deck builder.

/** Built-in deck palettes (lib/pptx/new-deck.ts DECK_PALETTES ids). */
export const DeckOutlinePalette = z.enum([
    "navy",
    "warm",
    "mono",
    "ocean",
    "forest",
    "sunset",
    "berry",
    "slate",
    "midnight",
]);
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

/**
 * Hard cap for one newly-authored line of slide text. Slides are not
 * documents: anything longer wraps into a paragraph and reads as filler.
 * Violations surface as zod issues, which the one-repair contract
 * (knowledge/deck_outline.ts) and the tool-call retry both feed back to the
 * model to shorten.
 */
const AuthoredLine = z.string().max(90, 'keep each line of slide text under 90 characters');

/** One card of a 'two-column' slide. */
export const DeckOutlineColumn = z.object({
    heading: z.string().describe('Card heading; empty string for a headingless card'),
    lines: z.array(AuthoredLine).max(4, 'a card fits at most 4 lines').describe('Short lines inside the card — at most 4, each under 90 characters'),
});
export type DeckOutlineColumn = z.infer<typeof DeckOutlineColumn>;

/** DeckOutlineColumn without the authored-content caps (see DeckOutlineSlideLoose). */
export const DeckOutlineColumnLoose = z.object({
    heading: z.string().describe('Card heading; empty string for a headingless card'),
    lines: z.array(z.string()).describe('Short lines inside the card (at most 4 are rendered)'),
});

/** The headline metric of a 'big-number' slide. */
export const DeckOutlineStat = z.object({
    value: z.string().describe('The metric itself, e.g. "42%" — only a value the user actually supplied, never invented'),
    caption: z.string().describe('One line saying what the value measures'),
});
export type DeckOutlineStat = z.infer<typeof DeckOutlineStat>;

/** The pull quote of a 'quote' slide. */
export const DeckOutlineQuote = z.object({
    text: z.string().describe('The quoted sentence, from the user\'s material — or a visibly bracketed placeholder'),
    attribution: z.string().optional().describe('Who said it; "[Source]" when unknown'),
});
export type DeckOutlineQuote = z.infer<typeof DeckOutlineQuote>;

export const DeckOutlineSlide = z.object({
    /** 'title' = the Title Slide layout; 'title-body' = Title and Body. */
    layout: z.enum(["title", "title-body"]).describe('"title" only for the "title" pattern; every other pattern uses "title-body"'),
    /** Visual pattern; the synthesizer falls back to 'bullets' when absent. */
    pattern: DeckSlidePattern.optional().describe('Visual pattern; falls back to "bullets" when absent'),
    heading: z.string().min(1).describe('Slide heading — a punchy claim, not a topic label'),
    bullets: z.array(AuthoredLine).max(6, 'a slide fits at most 6 bullets').optional().describe('3-5 short bullets (hard cap 6, each under 90 characters) for the "bullets" pattern (also the title-slide subtitle fallback)'),
    /** Short narrative alternative to bullets. */
    body: z.string().optional().describe('Short paragraph / subtitle, an alternative to bullets'),
    /** 'two-column' only: exactly the cards to render (max 2 used). */
    columns: z.array(DeckOutlineColumn).optional().describe('"two-column" only: exactly 2 cards'),
    /** 'big-number' only. */
    stat: DeckOutlineStat.optional().describe('"big-number" only: the headline metric'),
    /** 'quote' only. */
    quote: DeckOutlineQuote.optional().describe('"quote" only: the pull quote'),
    /**
     * Facts the user should fill in (short labels like "MoM growth %"),
     * present when the slide carries bracketed placeholders instead of
     * invented numbers. Surfaced as "fill in" chips in the outline review.
     */
    needsInput: z.array(z.string()).optional().describe('Short labels for facts the user must fill in, when the slide carries [bracketed] placeholders'),
    speakerNotes: z.string().optional().describe('1-3 spoken sentences; optional'),
});
export type DeckOutlineSlide = z.infer<typeof DeckOutlineSlide>;

/**
 * DeckOutlineSlide with the authored-content caps removed. The EDIT path
 * re-submits EXISTING deck text verbatim ("return everything you do not mean
 * to change verbatim") — a deck written before the caps existed, or made in
 * PowerPoint, may legitimately exceed them, and a hard cap here would make
 * that round-trip impossible. Same inferred type; runtime bounds only.
 */
export const DeckOutlineSlideLoose = DeckOutlineSlide.extend({
    bullets: z.array(z.string()).optional().describe('3-5 short bullets for the "bullets" pattern (also the title-slide subtitle fallback)'),
    columns: z.array(DeckOutlineColumnLoose).optional().describe('"two-column" only: exactly 2 cards'),
});

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

/** One per-slide note of a deck review. */
export const DeckReviewComment = z.object({
    /** 1-based slide number the note is about. */
    slideNumber: z.number().int().min(1),
    comment: z.string(),
});
export type DeckReviewComment = z.infer<typeof DeckReviewComment>;

/** The model's structured feedback on an existing deck (reviewDeck). */
export const DeckReview = z.object({
    /** 2-4 sentence assessment: story arc, coverage, audience fit. */
    overall: z.string().min(1),
    /** What already works and should be kept as-is. */
    strengths: z.array(z.string()),
    /** Per-slide improvement notes, most important first. */
    comments: z.array(DeckReviewComment),
    /**
     * Facts the deck still needs from the user: bracketed placeholders to
     * fill, plus any numbers/quotes that look invented and must be verified.
     */
    factsToFill: z.array(z.string()),
});
export type DeckReview = z.infer<typeof DeckReview>;

export const ReviewDeckRequest = z.object({
    deckContext: DeckContext,
    /** Per-slide visual patterns, parallel to deckContext.slides, when known. */
    patterns: z.array(DeckSlidePattern).optional(),
    /** Optional aspect to focus the feedback on (e.g. "clarity for investors"). */
    focus: z.string().optional(),
});
export type ReviewDeckRequest = z.infer<typeof ReviewDeckRequest>;
