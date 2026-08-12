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

// Presentations have exactly one supported production path. The model reaches
// for PDF/HTML/python-pptx otherwise, which is how a "deck" ends up as a flat
// file the user cannot edit in the slide editor.
const ONLY_PATH_RULE =
    'This is the ONLY way to produce a presentation: never render slides as PDF or HTML, never ' +
    'hand-write a .pptx via executeCommand / python-pptx / any script or library, and never ' +
    'fabricate one with file-writeText.';

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

// deck-create's path names a NEW file, so it must never inherit the open
// deck's path — that would write over what the user is looking at.
const NewDeckPathField = z.string().min(1).describe('Destination file path ending in .pptx. Can be absolute, ~/..., or relative to the default root.');

// The four tools that act on an EXISTING deck default to whatever the user has
// open (the "# User Context" block's `State: deck`), so "restyle this deck"
// needs no path from the user.
const PathField = z.string().min(1).describe("Deck file path ending in .pptx. Can be absolute, ~/..., or relative to the default root. Defaults to the deck currently open in the editor when the user refers to 'this deck' or a slide number without naming a file — take it from the '# User Context' block's Path.");

const SlideField = deck.DeckOutlineSlide.describe(
    'The slide in outline form: layout, visual pattern (title | bullets | two-column | big-number | quote | section | closing) and its content fields.',
);

export const deckTools: z.infer<typeof BuiltinToolsSchema> = {
    'deck-create': {
        permission: "file-boundary",
        description:
            'Create a presentation. USE THIS WHENEVER THE USER ASKS FOR A PRESENTATION, SLIDE DECK, ' +
            'PITCH DECK, SLIDES, A DECK, OR A .pptx — "make me a deck about X", "put together a ' +
            'pitch deck", "turn this into slides". Writes a real, editable PowerPoint file from a ' +
            'structured outline and opens it in the slide editor (it also opens in PowerPoint, ' +
            'Keynote and Google Slides). ' + ONLY_PATH_RULE + ' ' +
            'NOT FOR EDITS: when a deck is already open in the editor (the "# User Context" block ' +
            'says State: deck) and the request is edit-like — change, reword, fix, tighten, add a ' +
            'slide, delete a slide, reorder, restyle, retheme, "make slide 2 …" — it is about THAT ' +
            'deck; use deck-edit-slide / deck-add-slide / deck-restyle instead. Create only when the ' +
            'user asks for a NEW deck, or when nothing is open. ' +
            'Slide 1 is always the title slide (its heading is the deck title on the slide). Vary ' +
            'the visual patterns — bullets, two-column for compare/contrast, big-number for one key ' +
            'metric the user supplied, quote, section for topic shifts, closing at the end — instead ' +
            'of a wall of bullet lists. Speaker notes are not written to the file. ' +
            'ASK ONCE, THEN BUILD: for a brand-new deck send ONE compact message of lettered options ' +
            '— purpose/audience (pitch investors / sell to a customer / update the team / teach at an ' +
            'event), length (quick 5-6 / standard 8-10 / detailed 12+), and the specific facts that ' +
            'purpose needs — never open-ended prompts and never a multi-turn interrogation; then ' +
            'follow the arc for that purpose. ' + HONESTY_RULES,
        inputSchema: z.object({
            path: NewDeckPathField,
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
            'Add a slide to an existing presentation. USE THIS WHENEVER THE USER ASKS TO ADD A SLIDE ' +
            'to a deck — "add a slide about pricing", "put a team slide after the intro", "we need a ' +
            'closing slide". Inserts ONE new slide at a given position, inheriting the deck\'s current ' +
            'theme. Use deck-review first to see the current slides so the new one fits the flow and ' +
            'repeats no heading. Never rebuild the whole deck to add one slide, and never edit the ' +
            '.pptx by any other means. ' + HONESTY_RULES,
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
            'Change a slide in an existing presentation. USE THIS WHENEVER THE USER ASKS TO EDIT, ' +
            'reword, fix, tighten or replace a slide — "change slide 3", "reword the intro", "make ' +
            'the metrics slide a big number". Replaces the content of ONE slide (1-based ' +
            'slideNumber) with the given outline-form slide: keeping the same pattern rewrites the ' +
            'text in place (preserving styling), changing the pattern rebuilds that slide. Use ' +
            'deck-review first to see the current content, and return everything you do not mean to ' +
            'change verbatim. Never rebuild the whole deck to change one slide, and never edit the ' +
            '.pptx by any other means. ' + HONESTY_RULES,
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
            'Restyle a presentation. USE THIS WHENEVER THE USER ASKS TO CHANGE A DECK\'S LOOK — ' +
            '"restyle my deck", "change the theme", "make it darker", "can we try a different colour ' +
            'scheme". Applies one of the built-in palettes to an existing .pptx by swapping its ' +
            'theme: slide content is untouched and anything authored with theme colours recolours to ' +
            'match. This is the whole job — never rebuild the deck to change its colours.',
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
            'Read back / review a presentation. USE THIS WHENEVER THE USER ASKS WHAT IS IN A DECK or ' +
            'for feedback on one — "what\'s in my deck?", "review my pitch deck", "is this deck any ' +
            'good?" — and ALWAYS before deck-add-slide or deck-edit-slide on a deck you did not just ' +
            'create. Returns every slide\'s content (heading, text lines, detected visual pattern) ' +
            'plus structured feedback: overall assessment, strengths, per-slide comments, and ' +
            'factsToFill — the [bracketed] placeholders still to fill and any unsourced numbers or ' +
            'quotes to verify with the user. Editing needs no new-deck intake: ground any question in ' +
            'these findings, ask at most ONE (with options) when the requested change is ambiguous, ' +
            'and ask nothing at all for a specific request like "shorten slide 3". ' +
            'Read-only; use this instead of parseFile for .pptx.',
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
