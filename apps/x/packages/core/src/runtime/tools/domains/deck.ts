// Builtin tools: deck domain. Create and edit local .pptx presentations via
// the shared pptx module (@x/shared pptx engine); deck-review reads a deck
// back and adds model feedback. Decks are parsed with { mediaUrls: false }
// (no renderer here for blob: URLs) and every parse is paired with a
// disposeDeck in a finally block.

import path from "node:path";
import { z } from "zod";
import { deck } from "@x/shared";
import {
    buildDeckContext,
    synthesizeDeckFromOutline,
    synthesizeSlidePart,
} from "@x/shared/dist/pptx/generate.js";
import { disposeDeck, parsePptx } from "@x/shared/dist/pptx/parse.js";
import { writeDeck, type SlideEdit } from "@x/shared/dist/pptx/serialize.js";
import { buildThemeXml } from "@x/shared/dist/pptx/restyle.js";
import { DECK_PALETTES, type DeckPalette } from "@x/shared/dist/pptx/new-deck.js";
import {
    detectPattern,
    linesToEditedParagraphs,
    planSlideEdit,
} from "@x/shared/dist/pptx/edit-slide.js";
import type { NodePath, SlideDeck, TextShape } from "@x/shared/dist/pptx/types.js";
import { BuiltinToolsSchema } from "../types.js";
import { reviewDeck } from "../../../knowledge/deck_outline.js";
import * as files from "../../../filesystem/files.js";

// The honesty contract shared by every content-producing deck tool. The deck
// machinery renders whatever text it is given — these rules are how the
// calling agent is told to fill it.
const HONESTY_RULES =
    'HONESTY — NEVER FABRICATE: gather the audience, desired length, and the REAL facts ' +
    '(numbers, names, dates, quotes) from the user in conversation BEFORE calling this tool. ' +
    'Never invent numbers, statistics, or quotes. Where a fact the deck needs is missing, put a ' +
    'visible square-bracket placeholder in the slide text — "[X]% growth", "[Customer name]" — ' +
    "and list the missing facts as short labels in that slide's needsInput.";

function errorEnvelope(error: unknown): { success: false; error: string } {
    return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
    };
}

function paletteById(id: deck.DeckOutlinePalette): DeckPalette {
    const palette = DECK_PALETTES.find((p) => p.id === id);
    if (!palette) throw new Error(`Unknown palette '${id}'`);
    return palette;
}

function assertPptxPath(inputPath: string): void {
    if (!/\.pptx$/i.test(inputPath)) {
        throw new Error(`Deck path must end in .pptx: ${inputPath}`);
    }
}

/**
 * Workspace-relative path for the renderer (viewer auto-open / refresh keys
 * off it, like the spreadsheet tools' meta); null outside the workspace.
 */
function workspaceRelPathOf(inputPath: string): string | null {
    return files.resolveFilePath(inputPath).workspaceRelPath;
}

async function readDeck(inputPath: string): Promise<SlideDeck> {
    assertPptxPath(inputPath);
    const { buffer } = await files.readBuffer(inputPath);
    return parsePptx(buffer, { mediaUrls: false });
}

function requireSlide(parsed: SlideDeck, slideNumber: number) {
    const slide = parsed.slides[slideNumber - 1];
    if (!slide) {
        throw new Error(`Slide ${slideNumber} does not exist (deck has ${parsed.slides.length} slides)`);
    }
    return slide;
}

const sameNodePath = (a: NodePath, b: NodePath): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

const PathField = z.string().min(1).describe('Deck file path ending in .pptx. Can be absolute, ~/..., or relative to the default root.');

const SlideField = deck.DeckOutlineSlide.describe(
    'The slide in outline form: layout, visual pattern (title | bullets | two-column | big-number | quote | section | closing) and its content fields.',
);

export const deckTools: z.infer<typeof BuiltinToolsSchema> = {
    'deck-create': {
        permission: "file-boundary",
        description:
            'Create a .pptx presentation from a structured outline. Slide 1 is always the title ' +
            'slide (its heading is the deck title on the slide). Vary the visual patterns — bullets, ' +
            'two-column for compare/contrast, big-number for one key metric the user supplied, quote, ' +
            'section for topic shifts, closing at the end — instead of a wall of bullet lists. ' +
            'Speaker notes are not written to the file. ' + HONESTY_RULES,
        inputSchema: z.object({
            path: PathField,
            title: z.string().min(1).describe('Deck title (also used for the title slide)'),
            palette: deck.DeckOutlinePalette.describe('Colour palette for the deck theme'),
            slides: z.array(SlideField).min(1).describe('The slides in order; the first is the title slide'),
            overwrite: z.boolean().optional().describe('Replace the file if it already exists (default false)'),
        }),
        execute: async ({ path: inputPath, title, palette, slides, overwrite }: {
            path: string;
            title: string;
            palette: deck.DeckOutlinePalette;
            slides: deck.DeckOutlineSlide[];
            overwrite?: boolean;
        }) => {
            try {
                assertPptxPath(inputPath);
                if (!overwrite) {
                    const existing = await files.exists(inputPath);
                    if (existing.exists) {
                        throw new Error(`File already exists: ${inputPath} (pass overwrite: true to replace)`);
                    }
                }
                const outline: deck.DeckOutline = { title, suggestedPalette: palette, slides };
                const { bytes, slideCount, droppedSpeakerNotes } = await synthesizeDeckFromOutline(
                    outline,
                    paletteById(palette),
                );
                const meta = await files.writeBuffer(inputPath, Buffer.from(bytes));
                return {
                    success: true,
                    path: meta.path,
                    resolvedPath: meta.resolvedPath,
                    workspaceRelPath: workspaceRelPathOf(inputPath),
                    slideCount,
                    palette,
                    ...(droppedSpeakerNotes ? { note: 'speaker notes are not written into the .pptx' } : {}),
                };
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    'deck-add-slide': {
        permission: "file-boundary",
        description:
            'Insert ONE new slide into an existing .pptx at a given position. The slide inherits the ' +
            "deck's current theme. Use deck-review first to see the current slides so the new one " +
            'fits the flow and repeats no heading. ' + HONESTY_RULES,
        inputSchema: z.object({
            path: PathField,
            slide: SlideField,
            position: z.number().int().min(0).optional().describe('0-based insert index (0 = before the first slide); defaults to the end of the deck'),
        }),
        execute: async ({ path: inputPath, slide, position }: {
            path: string;
            slide: deck.DeckOutlineSlide;
            position?: number;
        }) => {
            try {
                const parsed = await readDeck(inputPath);
                try {
                    const pos = position ?? parsed.slides.length;
                    if (pos > parsed.slides.length) {
                        throw new Error(`Position ${pos} is out of range (deck has ${parsed.slides.length} slides)`);
                    }
                    const anchorPath = pos === 0 ? '' : parsed.slides[pos - 1].xmlPath;
                    const part = await synthesizeSlidePart(parsed, slide, anchorPath, []);
                    const bytes = await writeDeck(parsed, new Map(), { addSlides: [part] });
                    await files.writeBuffer(inputPath, Buffer.from(bytes));
                    return {
                        success: true,
                        path: inputPath,
                        workspaceRelPath: workspaceRelPathOf(inputPath),
                        insertedAt: pos + 1,
                        heading: slide.heading,
                        slideCount: parsed.slides.length + 1,
                    };
                } finally {
                    disposeDeck(parsed);
                }
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    'deck-edit-slide': {
        permission: "file-boundary",
        description:
            'Replace the content of one slide of an existing .pptx (1-based slideNumber) with the ' +
            'given outline-form slide. Keeping the same pattern rewrites the text in place ' +
            '(preserving styling); changing the pattern rebuilds the slide. Use deck-review first to ' +
            'see the current content, and return everything you do not mean to change verbatim. ' +
            HONESTY_RULES,
        inputSchema: z.object({
            path: PathField,
            slideNumber: z.number().int().min(1).describe('1-based number of the slide to edit'),
            slide: SlideField,
        }),
        execute: async ({ path: inputPath, slideNumber, slide }: {
            path: string;
            slideNumber: number;
            slide: deck.DeckOutlineSlide;
        }) => {
            try {
                const parsed = await readDeck(inputPath);
                try {
                    const target = requireSlide(parsed, slideNumber);
                    const currentPattern = detectPattern(target);
                    const plan = planSlideEdit(target, currentPattern, slide);
                    if (plan.kind === 'noop') {
                        return { success: true, path: inputPath, workspaceRelPath: workspaceRelPathOf(inputPath), slideNumber, changed: false };
                    }
                    let bytes: Uint8Array;
                    if (plan.kind === 'text') {
                        const edits: SlideEdit[] = plan.changes.map((change) => {
                            const shape = target.shapes.find(
                                (s): s is TextShape => s.type === 'text' && sameNodePath(s.nodePath, change.nodePath),
                            );
                            if (!shape) throw new Error(`Slide ${slideNumber}: planned edit targets an unknown shape`);
                            return {
                                kind: 'text',
                                nodePath: change.nodePath,
                                original: shape.paragraphs,
                                next: linesToEditedParagraphs(shape.paragraphs, change.lines),
                            };
                        });
                        bytes = await writeDeck(parsed, new Map([[target.xmlPath, edits]]));
                    } else {
                        // Pattern (or slot shape) changed: rebuild the slide and splice it
                        // in at the same position. The anchor must be a surviving slide.
                        const anchorPath = slideNumber === 1 ? '' : parsed.slides[slideNumber - 2].xmlPath;
                        const part = await synthesizeSlidePart(parsed, slide, anchorPath, []);
                        const order = parsed.slides.map((s) => (s.xmlPath === target.xmlPath ? part.path : s.xmlPath));
                        bytes = await writeDeck(parsed, new Map(), {
                            deleteSlides: [target.xmlPath],
                            addSlides: [part],
                            slideOrder: order,
                        });
                    }
                    await files.writeBuffer(inputPath, Buffer.from(bytes));
                    return {
                        success: true,
                        path: inputPath,
                        workspaceRelPath: workspaceRelPathOf(inputPath),
                        slideNumber,
                        changed: true,
                        mode: plan.kind === 'text' ? 'text-edit' : 'rebuild',
                    };
                } finally {
                    disposeDeck(parsed);
                }
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    'deck-restyle': {
        permission: "file-boundary",
        description:
            "Apply one of the built-in colour palettes to an existing .pptx by swapping its theme. " +
            "Slide content is untouched; anything authored with theme colours recolours to match.",
        inputSchema: z.object({
            path: PathField,
            palette: deck.DeckOutlinePalette.describe('The palette to apply'),
        }),
        execute: async ({ path: inputPath, palette }: {
            path: string;
            palette: deck.DeckOutlinePalette;
        }) => {
            try {
                const parsed = await readDeck(inputPath);
                try {
                    const xml = buildThemeXml(paletteById(palette));
                    const bytes = await writeDeck(parsed, new Map(), { replaceTheme: { xml } });
                    await files.writeBuffer(inputPath, Buffer.from(bytes));
                    return { success: true, path: inputPath, workspaceRelPath: workspaceRelPathOf(inputPath), palette, slideCount: parsed.slides.length };
                } finally {
                    disposeDeck(parsed);
                }
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    'deck-review': {
        permission: "file-boundary",
        description:
            'Read an existing .pptx and return every slide\'s content (heading, text lines, detected ' +
            'visual pattern) plus structured model feedback: overall assessment, strengths, per-slide ' +
            'comments, and factsToFill — the [bracketed] placeholders still to fill and any unsourced ' +
            'numbers or quotes to verify with the user. Call this before deck-add-slide or ' +
            'deck-edit-slide to see the current state.',
        inputSchema: z.object({
            path: PathField,
            focus: z.string().optional().describe('Optional aspect to focus the feedback on, e.g. "clarity for investors"'),
        }),
        execute: async ({ path: inputPath, focus }: { path: string; focus?: string }) => {
            try {
                const parsed = await readDeck(inputPath);
                try {
                    const title = path.basename(inputPath).replace(/\.pptx$/i, '');
                    const context = buildDeckContext(parsed, title);
                    const patterns = parsed.slides.map((s) => detectPattern(s));
                    const review = await reviewDeck({ deckContext: context, patterns, focus });
                    return {
                        success: true,
                        path: inputPath,
                        workspaceRelPath: workspaceRelPathOf(inputPath),
                        title: context.title,
                        slideCount: context.slides.length,
                        slides: context.slides.map((s, i) => ({
                            slideNumber: i + 1,
                            pattern: patterns[i],
                            heading: s.heading,
                            lines: s.bullets,
                        })),
                        review,
                    };
                } finally {
                    disposeDeck(parsed);
                }
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },
};
