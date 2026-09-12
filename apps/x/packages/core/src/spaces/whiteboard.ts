// Whiteboards for agents: the pure half of the whiteboard tools.
//
// A board is an Excalidraw scene stored as one single-line `.excalidraw`
// snapshot under whiteboards/ in a space (shared/spaces.ts owns the path
// conventions; SPACES_WHITEBOARD.md the design). Humans edit it live through
// the pane; an agent edits it by proposing a new snapshot, which every open
// pane reconciles element-by-element (higher `version` wins). That contract
// is what this module encodes, so the model never hand-authors Excalidraw
// JSON:
//
// - `summarizeWhiteboard` turns a scene into the compact, model-facing view
//   (shapes with their label folded in, free text, connectors as from→to).
// - `applyWhiteboardOps` turns a small vocabulary of operations (add,
//   connect, update, delete) into well-formed elements — version/nonce/index
//   bookkeeping, bound labels, arrow bindings, tombstones — over the existing
//   scene, touching nothing else. Every element it writes is one Excalidraw's
//   `restoreElements` accepts as-is.
//
// `@excalidraw/excalidraw` itself is renderer-only (its bundle imports
// `roughjs/bin/rough` without an extension, which Node's ESM loader rejects,
// and it pulls React), so the element shapes here are hand-built from the
// 0.18 element types. Text is sized by estimate (Nunito, the pane's default
// font); Excalidraw re-measures on the next edit, so a few pixels of slack
// are the worst case.
//
// Pure and deterministic under injected `now`/`random` so the tests can pin
// exact output.

import { z } from "zod";
import {
    DEFAULT_WHITEBOARD_PATH,
    WHITEBOARD_DIR,
    WHITEBOARD_EXT,
    isWhiteboardPath,
    whiteboardPathForName,
} from "@x/shared/dist/spaces.js";

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/**
 * One scene element as we hold it: the handful of fields every element has
 * and this module reads, plus everything else passed through untouched.
 * Unknown element kinds (freedraw, frames, images…) survive a round trip.
 */
export type WbElement = {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    version: number;
    versionNonce: number;
    index: string | null;
    isDeleted: boolean;
    [key: string]: unknown;
};

const SHAPE_TYPES = ["rectangle", "ellipse", "diamond"] as const;
type ShapeType = (typeof SHAPE_TYPES)[number];
const LINEAR_TYPES = ["arrow", "line"] as const;

const isShape = (e: WbElement): boolean => (SHAPE_TYPES as readonly string[]).includes(e.type);
const isLinear = (e: WbElement): boolean => (LINEAR_TYPES as readonly string[]).includes(e.type);
const isText = (e: WbElement): boolean => e.type === "text";

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function isElementLike(v: unknown): v is WbElement {
    return !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" && typeof (v as { type?: unknown }).type === "string";
}

/** Normalize the fields this module relies on; everything else stays as loaded. */
function normalize(raw: WbElement): WbElement {
    return {
        ...raw,
        x: num(raw.x),
        y: num(raw.y),
        width: num(raw.width),
        height: num(raw.height),
        version: Math.max(1, Math.floor(num(raw.version, 1))),
        versionNonce: Math.floor(num(raw.versionNonce)),
        index: typeof raw.index === "string" ? raw.index : null,
        isDeleted: raw.isDeleted === true,
    };
}

// ---------------------------------------------------------------------------
// Snapshot ↔ elements
// ---------------------------------------------------------------------------

/** The elements of a stored snapshot, or null when the text is not a board. */
export function parseWhiteboardSnapshot(raw: string): WbElement[] | null {
    if (!raw.trim()) return [];
    try {
        const data = JSON.parse(raw) as { elements?: unknown };
        if (!data || typeof data !== "object" || !Array.isArray(data.elements)) return null;
        return data.elements.filter(isElementLike).map(normalize);
    } catch {
        return null;
    }
}

/**
 * The single-line `.excalidraw` JSON the pane saves — same keys, same order,
 * so an unchanged scene serializes to identical bytes (identical concurrent
 * proposes merge clean) and the line-merge can never splice two snapshots.
 */
export function serializeWhiteboardSnapshot(elements: readonly WbElement[]): string {
    return JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "rowboat",
        elements,
        appState: {},
        files: {},
    });
}

/**
 * A board reference as the model gives it — a bare name ("roadmap"), a file
 * name ("roadmap.excalidraw"), or the asset path — to the asset path. Empty
 * or missing means the space's default board.
 */
export function resolveBoardPath(input: string | undefined): string {
    const trimmed = input?.trim() ?? "";
    if (!trimmed) return DEFAULT_WHITEBOARD_PATH;
    if (isWhiteboardPath(trimmed)) return trimmed;
    const stripped = trimmed.startsWith(`${WHITEBOARD_DIR}/`) ? trimmed.slice(WHITEBOARD_DIR.length + 1) : trimmed;
    return whiteboardPathForName(stripped.endsWith(WHITEBOARD_EXT) ? stripped.slice(0, -WHITEBOARD_EXT.length) : stripped) ?? DEFAULT_WHITEBOARD_PATH;
}

// ---------------------------------------------------------------------------
// Fractional indices — z-order keys in the format Excalidraw uses
// (rocicorp/fractional-indexing). Appending after the highest existing key is
// all an agent needs; Excalidraw re-syncs anything it finds invalid.
// ---------------------------------------------------------------------------

const BASE_62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function integerLength(head: string): number | null {
    if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
    if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
    return null;
}

function integerPart(key: string): string | null {
    const len = integerLength(key[0] ?? "");
    if (len === null || len > key.length) return null;
    const part = key.slice(0, len);
    for (const ch of part.slice(1)) if (!BASE_62.includes(ch)) return null;
    return part;
}

function incrementInteger(x: string): string | null {
    const [head, ...digits] = x.split("");
    let carry = true;
    for (let i = digits.length - 1; carry && i >= 0; i--) {
        const d = BASE_62.indexOf(digits[i]!) + 1;
        if (d === BASE_62.length) {
            digits[i] = "0";
        } else {
            digits[i] = BASE_62[d]!;
            carry = false;
        }
    }
    if (carry) {
        if (head === "Z") return "a0";
        if (head === "z") return null;
        const nextHead = String.fromCharCode(head!.charCodeAt(0) + 1);
        if (nextHead > "a") digits.push("0");
        else digits.pop();
        return nextHead + digits.join("");
    }
    return head + digits.join("");
}

/** The key that sorts right after `after` (null = an empty scene → "a0"). */
export function nextFractionalIndex(after: string | null): string {
    if (after === null) return "a0";
    const int = integerPart(after);
    if (int === null) return "a0";
    const next = incrementInteger(int);
    // Past the largest integer key: extend the fraction instead (never in practice).
    return next ?? `${after}V`;
}

function maxIndex(elements: readonly WbElement[]): string | null {
    let max: string | null = null;
    for (const e of elements) {
        if (e.index !== null && (max === null || e.index > max)) max = e.index;
    }
    return max;
}

// ---------------------------------------------------------------------------
// Style vocabulary — a small named palette (Excalidraw's own picker shades)
// plus raw hex, so the model can say "fill: blue" and get a coherent board.
// ---------------------------------------------------------------------------

const FILL_PALETTE: Record<string, string> = {
    blue: "#a5d8ff",
    green: "#b2f2bb",
    yellow: "#ffec99",
    red: "#ffc9c9",
    purple: "#d0bfff",
    orange: "#ffd8a8",
    teal: "#99e9f2",
    pink: "#fcc2d7",
    gray: "#e9ecef",
    grey: "#e9ecef",
    white: "#ffffff",
    transparent: "transparent",
    none: "transparent",
};

const STROKE_PALETTE: Record<string, string> = {
    blue: "#1971c2",
    green: "#2f9e44",
    yellow: "#f08c00",
    red: "#e03131",
    purple: "#6741d9",
    orange: "#e8590c",
    teal: "#0c8599",
    pink: "#c2255c",
    gray: "#495057",
    grey: "#495057",
    black: "#1e1e1e",
    white: "#ffffff",
};

const DEFAULT_STROKE = "#1e1e1e";
const DEFAULT_FILL = "transparent";
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const WHITEBOARD_COLOR_NAMES = Object.keys(STROKE_PALETTE).filter((k) => k !== "grey");

function resolveColor(value: string | undefined, role: "stroke" | "fill"): string | undefined {
    if (value === undefined) return undefined;
    const key = value.trim().toLowerCase();
    if (!key) return undefined;
    if (HEX_RE.test(key)) return key;
    const palette = role === "fill" ? FILL_PALETTE : STROKE_PALETTE;
    return palette[key] ?? (role === "fill" ? DEFAULT_FILL : DEFAULT_STROKE);
}

// ---------------------------------------------------------------------------
// Operations (the tool's input vocabulary)
// ---------------------------------------------------------------------------

const ElementId = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "ids are 1-64 letters, digits, '-' or '_'")
    .describe("An element id: one you read from whiteboard-read, or one you chose on a prior add in this call");

const WhiteboardStyle = z
    .object({
        stroke: z.string().optional().describe(`Outline / text color: a palette name (${WHITEBOARD_COLOR_NAMES.join(", ")}) or hex`),
        fill: z.string().optional().describe("Background color for shapes: a palette name, hex, or 'transparent'"),
        dashed: z.boolean().optional().describe("Dashed outline (or dashed connector)"),
        strokeWidth: z.number().min(0.5).max(8).optional().describe("Outline thickness; default 2"),
        fontSize: z.number().int().min(8).max(96).optional().describe("Text size; default 20"),
    })
    .describe("Optional look; omit for the board's clean default (black outline, no fill)");

export const WhiteboardOp = z.discriminatedUnion("op", [
    z.object({
        op: z.literal("add"),
        id: ElementId.optional().describe("Optional id for this element so later ops in the same call can reference it (e.g. 'start'); generated when omitted"),
        shape: z.enum(["rectangle", "ellipse", "diamond", "text"]).describe("Boxes carry a centered label; 'text' is free-standing text"),
        text: z.string().max(2000).optional().describe("The label (for a box) or the text itself; newlines allowed"),
        x: z.number().optional().describe("Top-left; omit to place automatically (see rightOf/below)"),
        y: z.number().optional(),
        width: z.number().positive().optional().describe("Omit to size the box to its label"),
        height: z.number().positive().optional(),
        rightOf: ElementId.optional().describe("Place beside this element, centers aligned"),
        leftOf: ElementId.optional(),
        below: ElementId.optional().describe("Place under this element, centers aligned"),
        above: ElementId.optional(),
        gap: z.number().min(0).optional().describe("Distance from the anchor element; default 80"),
        style: WhiteboardStyle.optional(),
    }),
    z.object({
        op: z.literal("connect"),
        id: ElementId.optional(),
        from: ElementId.describe("Source element"),
        to: ElementId.describe("Target element"),
        label: z.string().max(200).optional().describe("Text on the connector"),
        kind: z.enum(["arrow", "line"]).optional().describe("Default 'arrow' (head at 'to'); 'line' has no heads"),
        style: WhiteboardStyle.optional(),
    }),
    z.object({
        op: z.literal("update"),
        id: ElementId,
        text: z.string().max(2000).optional().describe("New label / text"),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        style: WhiteboardStyle.optional(),
    }),
    z.object({
        op: z.literal("delete"),
        id: ElementId,
    }),
]);
export type WhiteboardOp = z.infer<typeof WhiteboardOp>;
type WhiteboardStyle = z.infer<typeof WhiteboardStyle>;

export class WhiteboardOpError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WhiteboardOpError";
    }
}

// ---------------------------------------------------------------------------
// Geometry & text estimates
// ---------------------------------------------------------------------------

const FONT_FAMILY_NUNITO = 6; // FONT_FAMILY.Nunito — the pane's default
const LINE_HEIGHT = 1.35; // Excalidraw's Nunito line height
const AVG_CHAR_EM = 0.55; // Nunito average advance, a touch generous
const DEFAULT_FONT_SIZE = 20;
const BOUND_TEXT_PADDING = 5; // Excalidraw's BOUND_TEXT_PADDING
const BOX_INSET_X = 18; // breathing room around a label inside its box
const BOX_INSET_Y = 14;
const MIN_BOX_WIDTH = 120;
const MIN_BOX_HEIGHT = 60;
const MAX_LABEL_WIDTH = 260; // wrap labels longer than this
const DEFAULT_ANCHOR_GAP = 80;
const AUTO_FLOW_GAP = 40;
const BINDING_GAP = 5;
const SQRT2 = Math.SQRT2;

function textWidth(line: string, fontSize: number): number {
    return Math.max(fontSize * 0.5, Math.round(line.length * fontSize * AVG_CHAR_EM));
}

function measureText(text: string, fontSize: number): { width: number; height: number } {
    const lines = text.split("\n");
    const width = Math.max(...lines.map((l) => textWidth(l, fontSize)));
    const height = Math.round(lines.length * fontSize * LINE_HEIGHT);
    return { width, height };
}

/** Greedy word wrap at an estimated pixel width; existing newlines are kept. */
function wrapText(text: string, maxWidth: number, fontSize: number): string {
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            out.push("");
            continue;
        }
        let line = "";
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && textWidth(candidate, fontSize) > maxWidth) {
                out.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        out.push(line);
    }
    return out.join("\n");
}

/** Excalidraw's getBoundTextMaxWidth / MaxHeight for a container. */
function boundTextMax(container: WbElement): { width: number; height: number } {
    const w = container.width;
    const h = container.height;
    if (isLinear(container)) {
        return { width: Math.max(0.7 * w, DEFAULT_FONT_SIZE * 11), height: Number.POSITIVE_INFINITY };
    }
    switch (container.type) {
        case "ellipse":
            return {
                width: Math.round((w / 2) * SQRT2) - BOUND_TEXT_PADDING * 2,
                height: Math.round((h / 2) * SQRT2) - BOUND_TEXT_PADDING * 2,
            };
        case "diamond":
            return { width: Math.round(w / 2) - BOUND_TEXT_PADDING * 2, height: Math.round(h / 2) - BOUND_TEXT_PADDING * 2 };
        default:
            return { width: w - BOUND_TEXT_PADDING * 2, height: h - BOUND_TEXT_PADDING * 2 };
    }
}

/** The container size that fits a text box of the given size (the inverse of boundTextMax). */
function containerSizeFor(type: ShapeType, text: { width: number; height: number }): { width: number; height: number } {
    const innerW = text.width + BOUND_TEXT_PADDING * 2 + BOX_INSET_X * 2;
    const innerH = text.height + BOUND_TEXT_PADDING * 2 + BOX_INSET_Y * 2;
    switch (type) {
        case "ellipse":
            return { width: Math.ceil(innerW * SQRT2), height: Math.ceil(innerH * SQRT2) };
        case "diamond":
            return { width: Math.ceil(innerW * 2), height: Math.ceil(innerH * 2) };
        default:
            return { width: Math.ceil(innerW), height: Math.ceil(innerH) };
    }
}

interface Point {
    x: number;
    y: number;
}

const center = (e: WbElement): Point => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

/** Distance from an element's center to its outline along a unit direction. */
function exitDistance(e: WbElement, dir: Point): number {
    const hw = Math.max(1, e.width / 2);
    const hh = Math.max(1, e.height / 2);
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    switch (e.type) {
        case "ellipse":
            return 1 / Math.sqrt((ax / hw) ** 2 + (ay / hh) ** 2);
        case "diamond":
            return 1 / (ax / hw + ay / hh);
        default:
            return Math.min(ax > 1e-9 ? hw / ax : Number.POSITIVE_INFINITY, ay > 1e-9 ? hh / ay : Number.POSITIVE_INFINITY);
    }
}

function bounds(elements: readonly WbElement[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const e of elements) {
        if (e.isDeleted) continue;
        const pts = linearPoints(e);
        if (pts) {
            for (const p of pts) {
                minX = Math.min(minX, e.x + p.x);
                minY = Math.min(minY, e.y + p.y);
                maxX = Math.max(maxX, e.x + p.x);
                maxY = Math.max(maxY, e.y + p.y);
            }
            continue;
        }
        minX = Math.min(minX, e.x);
        minY = Math.min(minY, e.y);
        maxX = Math.max(maxX, e.x + e.width);
        maxY = Math.max(maxY, e.y + e.height);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function linearPoints(e: WbElement): Point[] | null {
    if (!isLinear(e) || !Array.isArray(e.points)) return null;
    const pts: Point[] = [];
    for (const p of e.points as unknown[]) {
        if (Array.isArray(p) && p.length >= 2) pts.push({ x: num(p[0]), y: num(p[1]) });
    }
    return pts.length >= 2 ? pts : null;
}

// ---------------------------------------------------------------------------
// Summary — what the model reads
// ---------------------------------------------------------------------------

export interface WhiteboardSummary {
    /** Axis-aligned extent of everything on the board; null when empty. */
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
    shapes: Array<{
        id: string;
        type: ShapeType;
        text?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fill?: string;
        stroke?: string;
        dashed?: true;
    }>;
    texts: Array<{ id: string; text: string; x: number; y: number; width: number; height: number; fontSize: number }>;
    connectors: Array<{
        id: string;
        kind: "arrow" | "line";
        from?: string;
        to?: string;
        label?: string;
        start: { x: number; y: number };
        end: { x: number; y: number };
        /** Present when the connector bends (more than two points). */
        points?: number;
    }>;
    /** Element kinds this vocabulary does not edit (freehand strokes, frames…), listed so they are not overdrawn. */
    other: Array<{ id: string; type: string; x: number; y: number; width: number; height: number }>;
    counts: { shapes: number; texts: number; connectors: number; other: number };
}

const r = (v: number): number => Math.round(v);

function byZOrder(a: WbElement, b: WbElement): number {
    if (a.index === b.index) return 0;
    if (a.index === null) return 1;
    if (b.index === null) return -1;
    return a.index < b.index ? -1 : 1;
}

function boundTextOf(elements: readonly WbElement[], containerId: string): WbElement | undefined {
    return elements.find((e) => !e.isDeleted && isText(e) && e.containerId === containerId);
}

export function summarizeWhiteboard(elements: readonly WbElement[]): WhiteboardSummary {
    const live = elements.filter((e) => !e.isDeleted).sort(byZOrder);
    const summary: WhiteboardSummary = {
        bounds: null,
        shapes: [],
        texts: [],
        connectors: [],
        other: [],
        counts: { shapes: 0, texts: 0, connectors: 0, other: 0 },
    };
    const b = bounds(live);
    if (b) summary.bounds = { minX: r(b.minX), minY: r(b.minY), maxX: r(b.maxX), maxY: r(b.maxY) };
    for (const e of live) {
        if (isShape(e)) {
            const label = boundTextOf(live, e.id);
            const fill = str(e.backgroundColor);
            const stroke = str(e.strokeColor);
            summary.shapes.push({
                id: e.id,
                type: e.type as ShapeType,
                ...(label ? { text: str(label.originalText) ?? str(label.text) ?? "" } : {}),
                x: r(e.x),
                y: r(e.y),
                width: r(e.width),
                height: r(e.height),
                ...(fill && fill !== DEFAULT_FILL ? { fill } : {}),
                ...(stroke && stroke !== DEFAULT_STROKE ? { stroke } : {}),
                ...(e.strokeStyle === "dashed" ? { dashed: true as const } : {}),
            });
        } else if (isText(e)) {
            if (typeof e.containerId === "string" && e.containerId) continue; // folded into its container
            summary.texts.push({
                id: e.id,
                text: str(e.originalText) ?? str(e.text) ?? "",
                x: r(e.x),
                y: r(e.y),
                width: r(e.width),
                height: r(e.height),
                fontSize: r(num(e.fontSize, DEFAULT_FONT_SIZE)),
            });
        } else if (isLinear(e)) {
            const pts = linearPoints(e) ?? [{ x: 0, y: 0 }, { x: e.width, y: e.height }];
            const first = pts[0]!;
            const last = pts[pts.length - 1]!;
            const label = boundTextOf(live, e.id);
            const from = str((e.startBinding as { elementId?: unknown } | null)?.elementId);
            const to = str((e.endBinding as { elementId?: unknown } | null)?.elementId);
            summary.connectors.push({
                id: e.id,
                kind: e.type === "line" ? "line" : "arrow",
                ...(from ? { from } : {}),
                ...(to ? { to } : {}),
                ...(label ? { label: str(label.originalText) ?? str(label.text) ?? "" } : {}),
                start: { x: r(e.x + first.x), y: r(e.y + first.y) },
                end: { x: r(e.x + last.x), y: r(e.y + last.y) },
                ...(pts.length > 2 ? { points: pts.length } : {}),
            });
        } else {
            summary.other.push({ id: e.id, type: e.type, x: r(e.x), y: r(e.y), width: r(e.width), height: r(e.height) });
        }
    }
    summary.counts = {
        shapes: summary.shapes.length,
        texts: summary.texts.length,
        connectors: summary.connectors.length,
        other: summary.other.length,
    };
    return summary;
}

// ---------------------------------------------------------------------------
// Applying operations
// ---------------------------------------------------------------------------

export interface ApplyOptions {
    /** Epoch ms stamped on every element written (Excalidraw's `updated`). */
    now?: number;
    /** Uniform [0,1) source for ids, seeds and nonces. */
    random?: () => number;
}

export interface ApplyResult {
    /** The full scene to store: untouched elements as they were, written ones bumped. */
    elements: WbElement[];
    added: Array<{ id: string; type: string; text?: string }>;
    updated: string[];
    deleted: string[];
    warnings: string[];
}

interface Scene {
    /** Every element, live and tombstoned, in stored order (new ones appended). */
    all: WbElement[];
    byId: Map<string, WbElement>;
    now: number;
    random: () => number;
    lastIndex: string | null;
    warnings: string[];
}

function randomInteger(random: () => number): number {
    return Math.floor(random() * 2 ** 31);
}

function randomId(random: () => number): string {
    let id = "";
    while (id.length < 12) id += Math.floor(random() * 36).toString(36);
    return id;
}

/** Replace an element in the scene with a bumped copy (version+1, fresh nonce, `updated` now). */
function commit(scene: Scene, next: WbElement): WbElement {
    const prev = scene.byId.get(next.id);
    const bumped: WbElement = {
        ...next,
        version: (prev?.version ?? next.version ?? 0) + 1,
        versionNonce: randomInteger(scene.random),
        updated: scene.now,
    };
    if (prev) {
        const i = scene.all.indexOf(prev);
        scene.all[i] = bumped;
    } else {
        scene.all.push(bumped);
    }
    scene.byId.set(bumped.id, bumped);
    return bumped;
}

function baseElement(scene: Scene, id: string, type: string, box: { x: number; y: number; width: number; height: number }): WbElement {
    scene.lastIndex = nextFractionalIndex(scene.lastIndex);
    return {
        id,
        type,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        angle: 0,
        strokeColor: DEFAULT_STROKE,
        backgroundColor: DEFAULT_FILL,
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: scene.lastIndex,
        roundness: null,
        seed: randomInteger(scene.random),
        version: 0, // commit() bumps to 1
        versionNonce: 0,
        isDeleted: false,
        boundElements: null,
        updated: scene.now,
        link: null,
        locked: false,
    };
}

function applyStyle(e: WbElement, style: WhiteboardStyle | undefined): WbElement {
    if (!style) return e;
    const next = { ...e };
    const stroke = resolveColor(style.stroke, "stroke");
    const fill = resolveColor(style.fill, "fill");
    if (stroke) next.strokeColor = stroke;
    if (fill && !isText(e) && !isLinear(e)) next.backgroundColor = fill;
    if (style.dashed !== undefined) next.strokeStyle = style.dashed ? "dashed" : "solid";
    if (style.strokeWidth !== undefined) next.strokeWidth = style.strokeWidth;
    return next;
}

function textElement(
    scene: Scene,
    id: string,
    text: string,
    box: { x: number; y: number; width: number; height: number },
    opts: { fontSize: number; containerId: string | null; align: "left" | "center"; originalText: string },
): WbElement {
    return {
        ...baseElement(scene, id, "text", box),
        text,
        originalText: opts.originalText,
        fontSize: opts.fontSize,
        fontFamily: FONT_FAMILY_NUNITO,
        textAlign: opts.align,
        verticalAlign: opts.containerId ? "middle" : "top",
        containerId: opts.containerId,
        autoResize: true,
        lineHeight: LINE_HEIGHT,
    };
}

/**
 * Fit a label into a container and center it. A container whose size the
 * caller did not fix grows to fit the label (wrapped only past the usual
 * label width); a fixed one wraps the label to its own width instead.
 */
function layoutBoundText(
    container: WbElement,
    original: string,
    fontSize: number,
    growable: { width: boolean; height: boolean },
): { text: string; box: { x: number; y: number; width: number; height: number }; container: WbElement } {
    let c = container;
    let max = boundTextMax(c);
    const widthCap = growable.width ? Math.max(MAX_LABEL_WIDTH, max.width) : max.width;
    let text = wrapText(original, Math.max(fontSize, widthCap), fontSize);
    let size = measureText(text, fontSize);
    if (size.width > max.width || size.height > max.height) {
        const fit = containerSizeFor(c.type as ShapeType, size);
        c = {
            ...c,
            width: growable.width ? Math.max(c.width, fit.width) : c.width,
            height: growable.height ? Math.max(c.height, fit.height) : c.height,
        };
        max = boundTextMax(c);
        if (!growable.width) {
            text = wrapText(original, Math.max(fontSize, max.width), fontSize);
            size = measureText(text, fontSize);
        }
    }
    const cc = center(c);
    return {
        text,
        box: { x: cc.x - size.width / 2, y: cc.y - size.height / 2, width: size.width, height: size.height },
        container: c,
    };
}

/** Structural equality for "did this op actually change the element" — a no-op write must not bump a version. */
function sameElement(a: WbElement, b: WbElement): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function boundElementsOf(e: WbElement): Array<{ id: string; type: string }> {
    return Array.isArray(e.boundElements)
        ? (e.boundElements as unknown[]).filter(
              (b): b is { id: string; type: string } => !!b && typeof b === "object" && typeof (b as { id?: unknown }).id === "string",
          )
        : [];
}

function withBound(e: WbElement, entry: { id: string; type: "arrow" | "text" }): WbElement {
    const existing = boundElementsOf(e);
    if (existing.some((b) => b.id === entry.id)) return e;
    return { ...e, boundElements: [...existing, entry] };
}

function withoutBound(e: WbElement, id: string): WbElement {
    const existing = boundElementsOf(e);
    if (!existing.some((b) => b.id === id)) return e;
    return { ...e, boundElements: existing.filter((b) => b.id !== id) };
}

function live(scene: Scene, id: string): WbElement | undefined {
    const e = scene.byId.get(id);
    return e && !e.isDeleted ? e : undefined;
}

function boundText(scene: Scene, containerId: string): WbElement | undefined {
    return scene.all.find((e) => !e.isDeleted && isText(e) && e.containerId === containerId);
}

/** Connectors bound to an element at either end. */
function connectorsBoundTo(scene: Scene, id: string): WbElement[] {
    return scene.all.filter(
        (e) =>
            !e.isDeleted &&
            isLinear(e) &&
            ((e.startBinding as { elementId?: unknown } | null)?.elementId === id ||
                (e.endBinding as { elementId?: unknown } | null)?.elementId === id),
    );
}

/** Straight connector endpoints between two elements' outlines (center-to-center line, a small gap off each edge). */
function connectorGeometry(a: WbElement, b: WbElement): { start: Point; end: Point } | null {
    const ca = center(a);
    const cb = center(b);
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    const dir = { x: dx / len, y: dy / len };
    const ta = exitDistance(a, dir) + BINDING_GAP;
    const tb = exitDistance(b, dir) + BINDING_GAP;
    if (ta + tb >= len) return null; // overlapping elements — no room for a connector
    return {
        start: { x: ca.x + dir.x * ta, y: ca.y + dir.y * ta },
        end: { x: cb.x - dir.x * tb, y: cb.y - dir.y * tb },
    };
}

function placeConnector(e: WbElement, geometry: { start: Point; end: Point }): WbElement {
    const dx = geometry.end.x - geometry.start.x;
    const dy = geometry.end.y - geometry.start.y;
    return {
        ...e,
        x: geometry.start.x,
        y: geometry.start.y,
        width: Math.abs(dx),
        height: Math.abs(dy),
        points: [
            [0, 0],
            [dx, dy],
        ],
    };
}

/** Re-center a connector's label on its midpoint. */
function relabelConnector(scene: Scene, connector: WbElement): void {
    const label = boundText(scene, connector.id);
    if (!label) return;
    const pts = linearPoints(connector);
    if (!pts) return;
    const mid = {
        x: connector.x + (pts[0]!.x + pts[pts.length - 1]!.x) / 2,
        y: connector.y + (pts[0]!.y + pts[pts.length - 1]!.y) / 2,
    };
    commit(scene, { ...label, x: mid.x - label.width / 2, y: mid.y - label.height / 2 });
}

/** After a shape moved or resized: re-route the connectors bound to it (their labels follow). */
function rerouteConnectors(scene: Scene, shape: WbElement): void {
    for (const connector of connectorsBoundTo(scene, shape.id)) {
        const fromId = str((connector.startBinding as { elementId?: unknown } | null)?.elementId);
        const toId = str((connector.endBinding as { elementId?: unknown } | null)?.elementId);
        const from = fromId ? live(scene, fromId) : undefined;
        const to = toId ? live(scene, toId) : undefined;
        const pts = linearPoints(connector);
        let geometry: { start: Point; end: Point } | null = null;
        if (from && to) {
            geometry = connectorGeometry(from, to);
        } else if (pts) {
            // One free end stays put; the bound end re-aims at the shape.
            const startAbs = { x: connector.x + pts[0]!.x, y: connector.y + pts[0]!.y };
            const endAbs = { x: connector.x + pts[pts.length - 1]!.x, y: connector.y + pts[pts.length - 1]!.y };
            const anchor = { id: "_", type: "rectangle", x: 0, y: 0, width: 1, height: 1, version: 1, versionNonce: 0, index: null, isDeleted: false } as WbElement;
            if (from && !to) {
                const g = connectorGeometry(from, { ...anchor, x: endAbs.x, y: endAbs.y });
                if (g) geometry = { start: g.start, end: endAbs };
            } else if (to && !from) {
                const g = connectorGeometry({ ...anchor, x: startAbs.x, y: startAbs.y }, to);
                if (g) geometry = { start: startAbs, end: g.end };
            }
        }
        if (!geometry) continue;
        const moved = commit(scene, placeConnector(connector, geometry));
        relabelConnector(scene, moved);
    }
}

type AddOp = Extract<WhiteboardOp, { op: "add" }>;
type ConnectOp = Extract<WhiteboardOp, { op: "connect" }>;
type UpdateOp = Extract<WhiteboardOp, { op: "update" }>;

function resolvePosition(
    scene: Scene,
    op: AddOp,
    size: { width: number; height: number },
    flow: { x: number; y: number },
): { x: number; y: number; flowed: boolean } {
    const gap = op.gap ?? DEFAULT_ANCHOR_GAP;
    const anchorId = op.rightOf ?? op.leftOf ?? op.below ?? op.above;
    let x = op.x;
    let y = op.y;
    if (anchorId !== undefined) {
        const a = live(scene, anchorId)!;
        const ab = isLinear(a) ? (() => { const b = bounds([a])!; return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }; })() : a;
        if (op.rightOf !== undefined) {
            x ??= ab.x + ab.width + gap;
            y ??= ab.y + (ab.height - size.height) / 2;
        } else if (op.leftOf !== undefined) {
            x ??= ab.x - gap - size.width;
            y ??= ab.y + (ab.height - size.height) / 2;
        } else if (op.below !== undefined) {
            x ??= ab.x + (ab.width - size.width) / 2;
            y ??= ab.y + ab.height + gap;
        } else {
            x ??= ab.x + (ab.width - size.width) / 2;
            y ??= ab.y - gap - size.height;
        }
        return { x, y, flowed: false };
    }
    if (x !== undefined && y !== undefined) return { x, y, flowed: false };
    return { x: x ?? flow.x, y: y ?? flow.y, flowed: x === undefined && y === undefined };
}

function doAdd(scene: Scene, op: AddOp, flow: { x: number; y: number }, result: ApplyResult): void {
    const id = op.id ?? randomId(scene.random);
    const fontSize = op.style?.fontSize ?? DEFAULT_FONT_SIZE;
    const text = op.text?.trim() ? op.text.replace(/\r\n?/g, "\n") : "";

    if (op.shape === "text") {
        const body = text || " ";
        const wrapped = op.width ? wrapText(body, op.width, fontSize) : body;
        const size = measureText(wrapped, fontSize);
        const pos = resolvePosition(scene, op, size, flow);
        if (!pos.flowed) warnIfOverlapping(scene, id, { x: pos.x, y: pos.y, ...size });
        const el = applyStyle(
            textElement(scene, id, wrapped, { x: pos.x, y: pos.y, ...size }, { fontSize, containerId: null, align: "left", originalText: body }),
            op.style,
        );
        commit(scene, el);
        if (pos.flowed) flow.x = pos.x + size.width + AUTO_FLOW_GAP;
        result.added.push({ id, type: "text", text: body });
        if (!text) scene.warnings.push(`add ${id}: no text given for a text element`);
        return;
    }

    // A box: size it to its label unless told otherwise.
    const measured = text ? measureText(wrapText(text, MAX_LABEL_WIDTH, fontSize), fontSize) : { width: 0, height: 0 };
    const fit = text ? containerSizeFor(op.shape, measured) : { width: MIN_BOX_WIDTH, height: MIN_BOX_HEIGHT };
    const size = {
        width: op.width ?? Math.max(MIN_BOX_WIDTH, fit.width),
        height: op.height ?? Math.max(MIN_BOX_HEIGHT, fit.height),
    };
    const pos = resolvePosition(scene, op, size, flow);
    let shape = applyStyle(baseElement(scene, id, op.shape, { x: pos.x, y: pos.y, ...size }), op.style);
    if (op.shape === "rectangle") shape.roundness = { type: 3 };
    if (op.shape === "diamond") shape.roundness = { type: 2 };
    if (text) {
        const laid = layoutBoundText(shape, text, fontSize, { width: op.width === undefined, height: op.height === undefined });
        shape = laid.container;
        const labelId = randomId(scene.random);
        shape = withBound(shape, { id: labelId, type: "text" });
        if (!pos.flowed) warnIfOverlapping(scene, id, shape);
        commit(scene, shape);
        const label = textElement(scene, labelId, laid.text, laid.box, { fontSize, containerId: id, align: "center", originalText: text });
        commit(scene, applyStyle(label, op.style?.stroke ? { stroke: op.style.stroke } : undefined));
        if (laid.text.split("\n").length * fontSize * LINE_HEIGHT > boundTextMax(shape).height + 1) {
            scene.warnings.push(`add ${id}: label is taller than the box; give it a bigger height or shorter text`);
        }
    } else {
        if (!pos.flowed) warnIfOverlapping(scene, id, shape);
        commit(scene, shape);
    }
    if (pos.flowed) flow.x = pos.x + shape.width + AUTO_FLOW_GAP;
    result.added.push({ id, type: op.shape, ...(text ? { text } : {}) });
}

const describeBox = (e: WbElement): string => `${e.id} at (${Math.round(e.x)}, ${Math.round(e.y)}) ${Math.round(e.width)}×${Math.round(e.height)}`;

/** The first live box-like element (not a connector, not a label inside its box) that a box intersects. */
function overlapping(scene: Scene, box: { x: number; y: number; width: number; height: number }): WbElement | undefined {
    for (const e of scene.all) {
        if (e.isDeleted || isLinear(e)) continue;
        if (isText(e) && typeof e.containerId === "string" && e.containerId) continue;
        if (box.x < e.x + e.width && box.x + box.width > e.x && box.y < e.y + e.height && box.y + box.height > e.y) return e;
    }
    return undefined;
}

/** A placed addition that lands on something already there is a mistake nine times in ten — say so, with the fix. */
function warnIfOverlapping(scene: Scene, id: string, box: { x: number; y: number; width: number; height: number }): void {
    const hit = overlapping(scene, box);
    if (hit) {
        scene.warnings.push(
            `add ${id}: overlaps ${describeBox(hit)} — sizes are computed from labels, so place elements with rightOf/below/leftOf/above instead of guessed coordinates, or move one with update x/y`,
        );
    }
}

function doConnect(scene: Scene, op: ConnectOp, result: ApplyResult): void {
    const from = live(scene, op.from)!;
    const to = live(scene, op.to)!;
    const geometry = connectorGeometry(from, to);
    if (!geometry) {
        throw new WhiteboardOpError(
            `connect ${op.from} → ${op.to}: the elements overlap (${describeBox(from)}; ${describeBox(to)}), so there is no room for a connector. ` +
                "Sizes are computed from labels, so do not guess coordinates: place elements with rightOf/below/leftOf/above, or move one with update x/y.",
        );
    }
    const id = op.id ?? randomId(scene.random);
    const kind = op.kind ?? "arrow";
    let connector = applyStyle(baseElement(scene, id, kind, { x: 0, y: 0, width: 0, height: 0 }), op.style);
    connector = placeConnector(connector, geometry);
    connector = {
        ...connector,
        roundness: { type: 2 },
        points: connector.points,
        lastCommittedPoint: null,
        startBinding: { elementId: from.id, focus: 0, gap: BINDING_GAP },
        endBinding: { elementId: to.id, focus: 0, gap: BINDING_GAP },
        startArrowhead: null,
        endArrowhead: kind === "arrow" ? "arrow" : null,
        ...(kind === "arrow" ? { elbowed: false } : {}),
    };
    const label = op.label?.trim();
    let labelId: string | undefined;
    if (label) {
        labelId = randomId(scene.random);
        connector = withBound(connector, { id: labelId, type: "text" });
    }
    const placed = commit(scene, connector);
    commit(scene, withBound(from, { id, type: "arrow" }));
    commit(scene, withBound(to, { id, type: "arrow" }));
    if (label && labelId) {
        const fontSize = op.style?.fontSize ?? 16;
        const size = measureText(label, fontSize);
        const mid = { x: placed.x + (geometry.end.x - geometry.start.x) / 2, y: placed.y + (geometry.end.y - geometry.start.y) / 2 };
        const text = textElement(
            scene,
            labelId,
            label,
            { x: mid.x - size.width / 2, y: mid.y - size.height / 2, ...size },
            { fontSize, containerId: id, align: "center", originalText: label },
        );
        commit(scene, applyStyle(text, op.style?.stroke ? { stroke: op.style.stroke } : undefined));
    }
    result.added.push({ id, type: kind, ...(label ? { text: label } : {}) });
}

function doUpdate(scene: Scene, op: UpdateOp, result: ApplyResult): void {
    const target = live(scene, op.id)!;
    const fontSize = op.style?.fontSize;

    if (isText(target)) {
        const containerId = str(target.containerId);
        const size = fontSize ?? num(target.fontSize, DEFAULT_FONT_SIZE);
        const original = op.text !== undefined ? op.text.replace(/\r\n?/g, "\n") : (str(target.originalText) ?? str(target.text) ?? "");
        if (containerId && live(scene, containerId)) {
            // A label: re-fit inside its container.
            const container = live(scene, containerId)!;
            const laid = layoutBoundText(container, original, size, { width: false, height: false });
            commit(scene, applyStyle({ ...target, text: laid.text, originalText: original, fontSize: size, ...laid.box }, op.style));
        } else {
            const wrapped = op.width ? wrapText(original, op.width, size) : original;
            const measured = measureText(wrapped, size);
            commit(
                scene,
                applyStyle(
                    { ...target, text: wrapped, originalText: original, fontSize: size, x: op.x ?? target.x, y: op.y ?? target.y, ...measured },
                    op.style,
                ),
            );
        }
        result.updated.push(op.id);
        return;
    }

    if (isLinear(target)) {
        let next = applyStyle(target, op.style);
        if (op.x !== undefined || op.y !== undefined) {
            next = { ...next, x: op.x ?? next.x, y: op.y ?? next.y };
        }
        const moved = commit(scene, next);
        if (op.text !== undefined) setConnectorLabel(scene, moved, op.text, fontSize);
        else relabelConnector(scene, moved);
        result.updated.push(op.id);
        return;
    }

    // A shape (or anything else with a box). Only what actually changed is
    // written: a label edit bumps the label, a move bumps the box (and the
    // label and connectors that follow it), a no-op bumps nothing.
    let next = applyStyle(target, op.style);
    next = {
        ...next,
        x: op.x ?? next.x,
        y: op.y ?? next.y,
        width: op.width ?? next.width,
        height: op.height ?? next.height,
    };
    const label = boundText(scene, target.id);
    const labelStyle: WhiteboardStyle | undefined = op.style?.stroke ? { stroke: op.style.stroke } : undefined;
    let labelNext: WbElement | undefined;
    let newLabel: { id: string; text: string; original: string; box: { x: number; y: number; width: number; height: number }; fontSize: number } | undefined;
    let tombstoneLabel = false;

    if (op.text !== undefined) {
        const original = op.text.replace(/\r\n?/g, "\n");
        const size = fontSize ?? (label ? num(label.fontSize, DEFAULT_FONT_SIZE) : DEFAULT_FONT_SIZE);
        if (!original.trim()) {
            if (label) {
                tombstoneLabel = true;
                next = withoutBound(next, label.id);
            }
        } else {
            const laid = layoutBoundText(next, original, size, { width: op.width === undefined, height: op.height === undefined });
            next = laid.container;
            if (label) {
                labelNext = applyStyle({ ...label, text: laid.text, originalText: original, fontSize: size, ...laid.box }, labelStyle);
            } else {
                const id = randomId(scene.random);
                next = withBound(next, { id, type: "text" });
                newLabel = { id, text: laid.text, original, box: laid.box, fontSize: size };
            }
        }
    } else if (label) {
        // The box moved, resized or restyled: the label follows.
        const size = fontSize ?? num(label.fontSize, DEFAULT_FONT_SIZE);
        const laid = layoutBoundText(next, str(label.originalText) ?? str(label.text) ?? "", size, { width: false, height: false });
        labelNext = applyStyle({ ...label, text: laid.text, fontSize: size, ...laid.box }, labelStyle);
    }

    const boxChanged = next.x !== target.x || next.y !== target.y || next.width !== target.width || next.height !== target.height;
    if (!sameElement(next, target)) commit(scene, next);
    if (tombstoneLabel && label) commit(scene, { ...label, isDeleted: true });
    if (labelNext && label && !sameElement(labelNext, label)) commit(scene, labelNext);
    if (newLabel) {
        commit(
            scene,
            applyStyle(
                textElement(scene, newLabel.id, newLabel.text, newLabel.box, { fontSize: newLabel.fontSize, containerId: next.id, align: "center", originalText: newLabel.original }),
                labelStyle,
            ),
        );
    }
    if (boxChanged) rerouteConnectors(scene, scene.byId.get(next.id)!);
    result.updated.push(op.id);
}

function setConnectorLabel(scene: Scene, connector: WbElement, text: string, fontSize: number | undefined): void {
    const label = boundText(scene, connector.id);
    const body = text.replace(/\r\n?/g, "\n").trim();
    if (!body) {
        if (label) {
            commit(scene, { ...label, isDeleted: true });
            commit(scene, withoutBound(connector, label.id));
        }
        return;
    }
    const size = fontSize ?? (label ? num(label.fontSize, 16) : 16);
    const measured = measureText(body, size);
    const pts = linearPoints(connector) ?? [{ x: 0, y: 0 }, { x: connector.width, y: connector.height }];
    const mid = { x: connector.x + (pts[0]!.x + pts[pts.length - 1]!.x) / 2, y: connector.y + (pts[0]!.y + pts[pts.length - 1]!.y) / 2 };
    const box = { x: mid.x - measured.width / 2, y: mid.y - measured.height / 2, ...measured };
    if (label) {
        commit(scene, { ...label, text: body, originalText: body, fontSize: size, ...box });
    } else {
        const labelId = randomId(scene.random);
        commit(scene, withBound(connector, { id: labelId, type: "text" }));
        commit(scene, textElement(scene, labelId, body, box, { fontSize: size, containerId: connector.id, align: "center", originalText: body }));
    }
}

function doDelete(scene: Scene, id: string, result: ApplyResult): void {
    const target = live(scene, id)!;
    const tombstone = (e: WbElement) => commit(scene, { ...e, isDeleted: true });
    if (isLinear(target)) {
        const label = boundText(scene, id);
        if (label) tombstone(label);
        for (const endId of [str((target.startBinding as { elementId?: unknown } | null)?.elementId), str((target.endBinding as { elementId?: unknown } | null)?.elementId)]) {
            const end = endId ? live(scene, endId) : undefined;
            if (end) commit(scene, withoutBound(end, id));
        }
        tombstone(target);
    } else if (isText(target)) {
        const containerId = str(target.containerId);
        const container = containerId ? live(scene, containerId) : undefined;
        if (container) commit(scene, withoutBound(container, id));
        tombstone(target);
    } else {
        const label = boundText(scene, id);
        if (label) tombstone(label);
        for (const connector of connectorsBoundTo(scene, id)) {
            const startId = str((connector.startBinding as { elementId?: unknown } | null)?.elementId);
            const endId = str((connector.endBinding as { elementId?: unknown } | null)?.elementId);
            commit(scene, {
                ...connector,
                ...(startId === id ? { startBinding: null } : {}),
                ...(endId === id ? { endBinding: null } : {}),
            });
        }
        tombstone(target);
    }
    result.deleted.push(id);
}

/** Every problem in the batch, before anything is written: unknown ids, duplicate ids, bad anchors. */
function validate(existing: readonly WbElement[], ops: readonly WhiteboardOp[]): void {
    const known = new Map<string, string>(); // id → type
    for (const e of existing) if (!e.isDeleted) known.set(e.id, e.type);
    const problems: string[] = [];
    const mustExist = (label: string, id: string) => {
        if (!known.has(id)) problems.push(`${label}: no element "${id}" on the board (ids come from whiteboard-read, or from an earlier add in this call)`);
    };
    ops.forEach((op, i) => {
        const at = `op ${i + 1} (${op.op})`;
        switch (op.op) {
            case "add": {
                const anchors = [op.rightOf, op.leftOf, op.below, op.above].filter((a): a is string => a !== undefined);
                if (anchors.length > 1) problems.push(`${at}: give one of rightOf/leftOf/below/above, not several`);
                for (const a of anchors) mustExist(at, a);
                if (op.id !== undefined) {
                    if (known.has(op.id)) problems.push(`${at}: id "${op.id}" is already on the board; use update, or pick another id`);
                    else known.set(op.id, op.shape);
                }
                break;
            }
            case "connect": {
                mustExist(at, op.from);
                mustExist(at, op.to);
                if (op.from === op.to) problems.push(`${at}: from and to are the same element`);
                for (const id of [op.from, op.to]) {
                    const type = known.get(id);
                    if (type && (LINEAR_TYPES as readonly string[]).includes(type)) problems.push(`${at}: "${id}" is a connector; connect shapes or text, not connectors`);
                }
                if (op.id !== undefined) {
                    if (known.has(op.id)) problems.push(`${at}: id "${op.id}" is already on the board`);
                    else known.set(op.id, op.kind ?? "arrow");
                }
                break;
            }
            case "update":
                mustExist(at, op.id);
                break;
            case "delete":
                mustExist(at, op.id);
                known.delete(op.id);
                break;
        }
    });
    if (problems.length > 0) throw new WhiteboardOpError(`Nothing was drawn:\n- ${problems.join("\n- ")}`);
}

/**
 * Apply a batch of operations to a scene. All-or-nothing: a reference to a
 * missing element (or any other invalid op) throws before anything changes.
 * Returns the full scene to store — untouched elements byte-identical to how
 * they were loaded — plus what was added, updated and deleted.
 */
export function applyWhiteboardOps(existing: readonly WbElement[], ops: readonly WhiteboardOp[], opts: ApplyOptions = {}): ApplyResult {
    validate(existing, ops);
    const scene: Scene = {
        all: [...existing],
        byId: new Map(existing.map((e) => [e.id, e])),
        now: opts.now ?? Date.now(),
        random: opts.random ?? Math.random,
        lastIndex: maxIndex(existing),
        warnings: [],
    };
    const result: ApplyResult = { elements: [], added: [], updated: [], deleted: [], warnings: [] };
    // Unplaced additions flow in a row to the right of what is already there.
    const b = bounds(existing);
    const flow = b ? { x: b.maxX + DEFAULT_ANCHOR_GAP, y: b.minY } : { x: 0, y: 0 };
    for (const op of ops) {
        switch (op.op) {
            case "add":
                doAdd(scene, op, flow, result);
                break;
            case "connect":
                doConnect(scene, op, result);
                break;
            case "update":
                doUpdate(scene, op, result);
                break;
            case "delete":
                doDelete(scene, op.id, result);
                break;
        }
    }
    result.elements = scene.all;
    result.updated = [...new Set(result.updated)];
    result.warnings = scene.warnings;
    return result;
}
