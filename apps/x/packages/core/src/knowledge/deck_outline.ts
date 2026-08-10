import { generateText } from 'ai';
import { deck } from '@x/shared';
import { createLanguageModel } from '../models/models.js';
import { getDefaultModelAndProvider, resolveProviderConfig } from '../models/defaults.js';
import { directCallReasoningOptions } from '../models/reasoning.js';
import { captureLlmUsage } from '../analytics/usage.js';
import { withUseCase } from '../analytics/use_case.js';

// One-shot deck outline generation: user prompt in, zod-validated outline
// out. Same direct-call pattern as classifySchedule (inline_tasks.ts) and
// summarizeMeeting: resolve the user's configured default model, one
// generateText, JSON-only response. On invalid output the model gets ONE
// repair attempt (its own output + the validation problems), then the
// caller sees a typed DeckOutlineError.

const FACT_RULES = `HONESTY — NEVER FABRICATE:
- Use ONLY facts present in the user's request, their clarifying answers, or the existing deck content. Never invent numbers, statistics, valuations, dates, names, customer counts, or quotes.
- Where a real deck would need a number the user has not provided, emit an explicit square-bracket placeholder — "[X]% month-over-month growth", "[Customer name] quote here" — visibly a placeholder, never a plausible-looking fake.
- Choose the "big-number" pattern ONLY when the user supplied the number. A "quote" slide may only carry a real quote from the user's material, or a bracketed placeholder quote attributed to "[Source]".
- Whenever a slide contains placeholders, list the facts the user should fill in as short labels in that slide's "needsInput" (e.g. "MoM growth %", "customer quote").`;

const SYSTEM_PROMPT = `You help someone draft a slide deck. You always work in TWO turns:

TURN 1 (no answers yet) — CLARIFY FIRST.
Ask the clarifying questions you genuinely need, and return NO slides. This is the norm, not the exception: a good deck depends on who it is for, how deep to go, and on REAL facts — so ask before drafting.
- Ask about (a) the AUDIENCE, (b) the desired DEPTH or LENGTH, and (c) ANY factual gaps the deck will depend on — metrics, names, dates, quotes ("What growth numbers can you share?", "Do you have a customer quote?").
- Ask as many questions as are genuinely needed to avoid fabricating — typically 2-5. Never ask about what the prompt already answers; group related facts into ONE question.
- Only when the prompt is fully specified (audience, depth/length AND the facts it needs) may you skip questions entirely and go straight to the full outline in this turn.
Return: { "title", "suggestedPalette", "clarifyingQuestions": [the questions], "slides": [] }

TURN 2 (answers provided) — FULL OUTLINE.
Use the answers to write the complete outline. Return NO clarifyingQuestions. A fact the user still did not provide becomes a bracketed placeholder, never an invented value.
Return: { "title", "suggestedPalette", "slides": [ ... ] }

${FACT_RULES}

Never return clarifyingQuestions AND slides together. Respond with ONLY a JSON object — no prose, no markdown fences — of this shape:
{
  "title": string,                       // short deck title
  "suggestedPalette": "navy" | "warm" | "mono",
  "clarifyingQuestions": string[],       // TURN 1 only; OMIT on a full outline
  "slides": [                            // omit / empty on a clarify turn
    {
      "layout": "title" | "title-body",  // "title" for the "title" pattern, else "title-body"
      "pattern": "title" | "bullets" | "two-column" | "big-number" | "quote" | "section" | "closing",
      "heading": string,                 // every slide has one
      "bullets": string[],               // 'bullets' pattern (also the title subtitle fallback)
      "body": string,                    // OPTIONAL short paragraph / subtitle
      "columns": [ { "heading": string, "lines": string[] } ],  // 'two-column' only (exactly 2)
      "stat": { "value": string, "caption": string },           // 'big-number' only
      "quote": { "text": string, "attribution": string },       // 'quote' only
      "needsInput": string[],            // OPTIONAL: facts the user must fill in, when the slide has [bracketed] placeholders
      "speakerNotes": string             // OPTIONAL
    }
  ]
}

Slide patterns — design a VARIED deck, not a wall of bullet lists:
- "title": the opener. Deck title as heading, subtitle in "body". Always the FIRST slide.
- "bullets": a heading + 3-5 short bullets. The workhorse, but do not overuse it.
- "two-column": a heading + a "columns" array of exactly 2 cards, each { heading, lines: 2-4 short lines }. Use for compare/contrast, before/after, pros/cons.
- "big-number": one headline metric in "stat" { value, caption }. ONLY when the user supplied the number — never an invented one.
- "quote": a testimonial or key line in "quote" { text, attribution }. Only a quote from the user's material, or a "[bracketed placeholder]" attributed to "[Source]".
- "section": a divider that announces a topic shift. Heading + optional "body" tagline. Use between major parts of the deck.
- "closing": the final slide — recap, thank-you, or call to action. Always the LAST slide.

Pattern rules:
- The FIRST slide is "title"; the LAST slide is "closing".
- A deck of 6+ slides MUST use at least THREE different patterns.
- Insert a "section" slide when the topic shifts to a new part of the story.
- Use "big-number" when the user gave a concrete metric; use "quote" when the user's material has a quotable line.
- Never place two slides with the SAME pattern next to each other — except "bullets", which may repeat.

Deck-writing rules:
- Punchy, specific headings — a claim or takeaway, not a topic label.
- At most 3-5 bullets/lines per slide; each one short, never a wall of text.
- Set "layout" to "title" only for the "title" pattern; every other pattern uses "title-body".
- Pick suggestedPalette by subject: "navy" professional/corporate, "warm" human/creative, "mono" minimal/technical.
- Add speakerNotes (1-3 spoken sentences) only where they add value.`;

/** The model failed to produce a valid outline even after the repair round. */
export class DeckOutlineError extends Error {
    /** Validation problems from the last attempt, for logs/diagnostics. */
    readonly detail?: string;

    constructor(message: string, detail?: string) {
        super(message);
        this.name = 'DeckOutlineError';
        this.detail = detail;
    }
}

export type GenerateDeckOutlineInput = deck.GenerateDeckOutlineRequest;

/** Strip markdown code fences if the LLM wraps the JSON (same as classifySchedule). */
function stripCodeFences(text: string): string {
    return text
        .trim()
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
}

function parseOutline(raw: string): { outline: deck.DeckOutline } | { issue: string } {
    let data: unknown;
    try {
        data = JSON.parse(stripCodeFences(raw));
    } catch (err) {
        return { issue: `not valid JSON (${err instanceof Error ? err.message : String(err)})` };
    }
    const parsed = deck.DeckOutline.safeParse(data);
    if (!parsed.success) {
        return {
            issue: parsed.error.issues
                .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
                .join('; '),
        };
    }
    return { outline: parsed.data };
}

function buildUserPrompt(input: GenerateDeckOutlineInput): string {
    const hasAnswers = Boolean(input.answers && input.answers.length > 0);
    const lines = ['Create a slide deck outline for this request:', '', input.prompt];
    if (input.slideCount) {
        lines.push('', `Target slide count: ${input.slideCount} (including the title and closing slides).`);
    }
    if (input.tone) {
        lines.push('', `Tone: ${input.tone}`);
    }
    if (hasAnswers) {
        lines.push('', 'Answers to your clarifying questions:');
        lines.push(...input.answers!.map((a, i) => `${i + 1}. ${a}`));
        lines.push('', 'This is TURN 2: return the full outline and no clarifyingQuestions.');
    } else {
        lines.push('', 'This is TURN 1: clarify first — ask the questions you genuinely need (audience, depth/length, and any facts the deck depends on) and return no slides, unless the request already answers all of them.');
    }
    return lines.join('\n');
}

export async function generateDeckOutline(input: GenerateDeckOutlineInput): Promise<deck.DeckOutline> {
    const selection = await getDefaultModelAndProvider();
    const providerConfig = await resolveProviderConfig(selection.provider);
    const model = createLanguageModel(providerConfig, selection.model);
    const reasoning = await directCallReasoningOptions(providerConfig.flavor, selection.model, selection.effort);

    const call = async (prompt: string): Promise<string> => {
        const result = await withUseCase({ useCase: 'app_llm_generate', subUseCase: 'deck_outline' }, () => generateText({
            model,
            instructions: SYSTEM_PROMPT,
            prompt,
            ...reasoning,
        }));
        captureLlmUsage({
            useCase: 'app_llm_generate',
            subUseCase: 'deck_outline',
            model: selection.model,
            provider: selection.provider,
            usage: result.usage,
        });
        return result.text;
    };

    const userPrompt = buildUserPrompt(input);
    const first = await call(userPrompt);
    const attempt = parseOutline(first);
    if ('outline' in attempt) return attempt.outline;

    // One repair round: the model sees its own output and what was wrong
    // with it, and must answer with corrected JSON only.
    const repairPrompt = [
        userPrompt,
        '',
        'Your previous response was not a valid outline JSON object.',
        `Problems: ${attempt.issue}`,
        '',
        'Your previous response:',
        first.trim(),
        '',
        'Respond again with ONLY the corrected JSON object.',
    ].join('\n');
    const second = await call(repairPrompt);
    const repaired = parseOutline(second);
    if ('outline' in repaired) return repaired.outline;

    throw new DeckOutlineError('The model did not produce a valid deck outline', repaired.issue);
}

// --------------------------------------------------- single-slide generation

const SLIDE_SYSTEM_PROMPT = `You add ONE slide to an existing presentation.

You are given the deck's title, its current slides (each heading with its bullet text), the position the new slide will be inserted at, and optionally a topic.

Respond with ONLY a JSON object for a SINGLE slide — no prose, no markdown fences — using the same slide shape and patterns as a deck outline:
{
  "layout": "title" | "title-body",
  "pattern": "bullets" | "two-column" | "big-number" | "quote" | "section" | "closing",
  "heading": string,
  "bullets": string[],                                    // 'bullets'
  "body": string,                                         // OPTIONAL short paragraph / subtitle
  "columns": [ { "heading": string, "lines": string[] } ],// 'two-column' (exactly 2)
  "stat": { "value": string, "caption": string },         // 'big-number'
  "quote": { "text": string, "attribution": string },     // 'quote'
  "needsInput": string[],                                 // OPTIONAL: facts the user must fill in, when the slide has [bracketed] placeholders
  "speakerNotes": string                                  // OPTIONAL
}

Rules:
- Match the deck's existing TONE, DEPTH, and MIX of patterns — do not make this slide far denser or sparser than the rest.
- Do NOT reuse a heading that already appears in the deck.
- Pick the pattern that fits: "big-number" for a metric the user supplied, "quote" for a testimonial from the user's material, "two-column" for compare/contrast, "section" for a topic shift, "bullets" for a list, "closing" only if this is the deck's end.
- Punchy heading (a claim, not a topic label); at most 3-5 short bullets/lines.
- Set "layout" to "title" only for the "title" pattern; every other pattern uses "title-body".
- If a topic is given, write that slide. If NO topic is given, SUGGEST the single slide that best fills a gap in the current flow at the insert position.

${FACT_RULES}`;

function buildSlideUserPrompt(input: deck.GenerateSlideRequest): string {
    const { deckContext, topic, position } = input;
    const lines = [`Deck title: ${deckContext.title || '(untitled)'}`, '', 'Current slides:'];
    if (deckContext.slides.length === 0) {
        lines.push('(none yet)');
    } else {
        deckContext.slides.forEach((s, i) => {
            const bullets = s.bullets.length > 0 ? ` — ${s.bullets.join('; ')}` : '';
            lines.push(`${i + 1}. ${s.heading || '(no heading)'}${bullets}`);
        });
    }
    lines.push('', `Insert the new slide at position ${position + 1} of ${deckContext.slides.length + 1}.`);
    if (topic && topic.trim()) {
        lines.push('', `Topic for the new slide: ${topic.trim()}`);
    } else {
        lines.push('', 'No topic was given — suggest the single slide that best fills a gap in the flow at this position.');
    }
    return lines.join('\n');
}

function parseSlide(raw: string): { slide: deck.DeckOutlineSlide } | { issue: string } {
    let data: unknown;
    try {
        data = JSON.parse(stripCodeFences(raw));
    } catch (err) {
        return { issue: `not valid JSON (${err instanceof Error ? err.message : String(err)})` };
    }
    const parsed = deck.DeckOutlineSlide.safeParse(data);
    if (!parsed.success) {
        return {
            issue: parsed.error.issues
                .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
                .join('; '),
        };
    }
    return { slide: parsed.data };
}

/**
 * Generates one slide to insert into an existing deck. Same model plumbing and
 * one-repair-then-typed-error contract as generateDeckOutline; validates the
 * result against the single-slide schema so a malformed slide is a failure,
 * never partially returned.
 */
export async function generateSlide(input: deck.GenerateSlideRequest): Promise<deck.DeckOutlineSlide> {
    const selection = await getDefaultModelAndProvider();
    const providerConfig = await resolveProviderConfig(selection.provider);
    const model = createLanguageModel(providerConfig, selection.model);
    const reasoning = await directCallReasoningOptions(providerConfig.flavor, selection.model, selection.effort);

    const call = async (prompt: string): Promise<string> => {
        const result = await withUseCase({ useCase: 'app_llm_generate', subUseCase: 'deck_slide' }, () => generateText({
            model,
            instructions: SLIDE_SYSTEM_PROMPT,
            prompt,
            ...reasoning,
        }));
        captureLlmUsage({
            useCase: 'app_llm_generate',
            subUseCase: 'deck_slide',
            model: selection.model,
            provider: selection.provider,
            usage: result.usage,
        });
        return result.text;
    };

    const userPrompt = buildSlideUserPrompt(input);
    const first = await call(userPrompt);
    const attempt = parseSlide(first);
    if ('slide' in attempt) return attempt.slide;

    const repairPrompt = [
        userPrompt,
        '',
        'Your previous response was not a valid slide JSON object.',
        `Problems: ${attempt.issue}`,
        '',
        'Your previous response:',
        first.trim(),
        '',
        'Respond again with ONLY the corrected JSON object for a single slide.',
    ].join('\n');
    const second = await call(repairPrompt);
    const repaired = parseSlide(second);
    if ('slide' in repaired) return repaired.slide;

    throw new DeckOutlineError('The model did not produce a valid slide', repaired.issue);
}

// ------------------------------------------------------ single-slide editing

const SLIDE_EDIT_SYSTEM_PROMPT = `You edit ONE existing slide of a presentation.

You are given the deck's title and slide headings for context, the current slide as a JSON object (its pattern and full content), and an instruction.

Respond with ONLY a JSON object — no prose, no markdown fences — for the slide AFTER the edit, in the same shape:
{
  "layout": "title" | "title-body",
  "pattern": "title" | "bullets" | "two-column" | "big-number" | "quote" | "section" | "closing",
  "heading": string,
  "bullets": string[],                                    // 'bullets'
  "body": string,                                         // OPTIONAL short paragraph / subtitle
  "columns": [ { "heading": string, "lines": string[] } ],// 'two-column' (exactly 2)
  "stat": { "value": string, "caption": string },         // 'big-number'
  "quote": { "text": string, "attribution": string },     // 'quote'
  "needsInput": string[],                                 // OPTIONAL: facts the user must fill in, when the slide has [bracketed] placeholders
  "speakerNotes": string                                  // OPTIONAL
}

Rules:
- Apply the instruction FAITHFULLY, and change ONLY what it asks for. Everything the instruction does not touch must come back verbatim.
- Keep the slide's current "pattern" and "layout" unless the instruction clearly implies a different one (e.g. "turn this into a quote").
- Preserve the slide's tone and depth; do not expand or trim content that was not mentioned.
- Keep the same fields populated: if the slide has a stat, return a stat; if it has columns, return the same number of columns — unless the instruction says otherwise.

${FACT_RULES}`;

function buildEditSlideUserPrompt(input: deck.EditSlideRequest): string {
    const { deckContext, slide, instruction } = input;
    const lines = [`Deck title: ${deckContext.title || '(untitled)'}`];
    if (deckContext.slides.length > 0) {
        lines.push('Slide headings: ' + deckContext.slides.map((s, i) => `${i + 1}. ${s.heading || '(none)'}`).join(' | '));
    }
    lines.push('', 'Current slide:', JSON.stringify(slide));
    lines.push('', `Instruction: ${instruction.trim()}`);
    return lines.join('\n');
}

/**
 * Applies an instruction to one slide. Same plumbing and one-repair contract
 * as generateSlide; the response is the full slide after the edit, so invalid
 * output is a failure — never a partial slide.
 */
export async function editSlide(input: deck.EditSlideRequest): Promise<deck.DeckOutlineSlide> {
    const selection = await getDefaultModelAndProvider();
    const providerConfig = await resolveProviderConfig(selection.provider);
    const model = createLanguageModel(providerConfig, selection.model);
    const reasoning = await directCallReasoningOptions(providerConfig.flavor, selection.model, selection.effort);

    const call = async (prompt: string): Promise<string> => {
        const result = await withUseCase({ useCase: 'app_llm_generate', subUseCase: 'deck_slide_edit' }, () => generateText({
            model,
            instructions: SLIDE_EDIT_SYSTEM_PROMPT,
            prompt,
            ...reasoning,
        }));
        captureLlmUsage({
            useCase: 'app_llm_generate',
            subUseCase: 'deck_slide_edit',
            model: selection.model,
            provider: selection.provider,
            usage: result.usage,
        });
        return result.text;
    };

    const userPrompt = buildEditSlideUserPrompt(input);
    const first = await call(userPrompt);
    const attempt = parseSlide(first);
    if ('slide' in attempt) return attempt.slide;

    const repairPrompt = [
        userPrompt,
        '',
        'Your previous response was not a valid slide JSON object.',
        `Problems: ${attempt.issue}`,
        '',
        'Your previous response:',
        first.trim(),
        '',
        'Respond again with ONLY the corrected JSON object for the edited slide.',
    ].join('\n');
    const second = await call(repairPrompt);
    const repaired = parseSlide(second);
    if ('slide' in repaired) return repaired.slide;

    throw new DeckOutlineError('The model did not produce a valid edited slide', repaired.issue);
}
