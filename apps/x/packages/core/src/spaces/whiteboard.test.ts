import { describe, expect, it } from "vitest";
import { EMPTY_WHITEBOARD_CONTENT } from "@x/shared/dist/spaces.js";
import {
    WhiteboardOpError,
    applyWhiteboardOps,
    nextFractionalIndex,
    parseWhiteboardSnapshot,
    resolveBoardPath,
    serializeWhiteboardSnapshot,
    summarizeWhiteboard,
    type WbElement,
    type WhiteboardOp,
} from "./whiteboard.js";

// A seeded generator so ids, seeds and nonces are reproducible per test.
function seeded(seed = 1): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

const NOW = 1_757_700_000_000;
const opts = () => ({ now: NOW, random: seeded(7) });

const apply = (elements: readonly WbElement[], ops: WhiteboardOp[]) => applyWhiteboardOps(elements, ops, opts());

const liveOf = (elements: readonly WbElement[]) => elements.filter((e) => !e.isDeleted);
const byId = (elements: readonly WbElement[], id: string): WbElement => {
    const e = elements.find((x) => x.id === id);
    if (!e) throw new Error(`no element ${id}`);
    return e;
};
const labelOf = (elements: readonly WbElement[], containerId: string): WbElement | undefined =>
    elements.find((e) => !e.isDeleted && e.type === "text" && e.containerId === containerId);

describe("snapshot parse / serialize", () => {
    it("serializes an empty scene to the pane's exact empty-board bytes", () => {
        expect(serializeWhiteboardSnapshot([])).toBe(EMPTY_WHITEBOARD_CONTENT);
    });

    it("keeps unknown element fields and kinds through a round trip, on one line", () => {
        const raw = JSON.stringify({
            type: "excalidraw",
            version: 2,
            source: "https://excalidraw.com",
            elements: [
                { id: "f1", type: "freedraw", x: 1, y: 2, width: 3, height: 4, version: 5, versionNonce: 6, index: "a0", isDeleted: false, points: [[0, 0], [1, 1]], pressures: [], simulatePressure: true },
                { id: "junk" }, // not an element (no type) — dropped
            ],
            appState: { viewBackgroundColor: "#fff" },
            files: {},
        });
        const elements = parseWhiteboardSnapshot(raw)!;
        expect(elements).toHaveLength(1);
        expect(elements[0]!.simulatePressure).toBe(true);
        const out = serializeWhiteboardSnapshot(elements);
        expect(out.includes("\n")).toBe(false);
        expect(JSON.parse(out)).toMatchObject({ type: "excalidraw", version: 2, source: "rowboat", appState: {}, files: {} });
        expect(JSON.parse(out).elements[0]).toEqual(elements[0]);
    });

    it("treats an empty body as an empty board and rejects non-boards", () => {
        expect(parseWhiteboardSnapshot("")).toEqual([]);
        expect(parseWhiteboardSnapshot("# not json")).toBeNull();
        expect(parseWhiteboardSnapshot(JSON.stringify({ hello: 1 }))).toBeNull();
    });

    it("normalizes the fields it relies on", () => {
        const [e] = parseWhiteboardSnapshot(JSON.stringify({ elements: [{ id: "a", type: "rectangle", x: "nope", version: 0 }] }))!;
        expect(e).toMatchObject({ x: 0, y: 0, width: 0, height: 0, version: 1, versionNonce: 0, index: null, isDeleted: false });
    });
});

describe("resolveBoardPath", () => {
    it("maps names, file names and paths to the asset path; empty means the default board", () => {
        expect(resolveBoardPath(undefined)).toBe("whiteboards/board.excalidraw");
        expect(resolveBoardPath("  ")).toBe("whiteboards/board.excalidraw");
        expect(resolveBoardPath("roadmap")).toBe("whiteboards/roadmap.excalidraw");
        expect(resolveBoardPath("roadmap.excalidraw")).toBe("whiteboards/roadmap.excalidraw");
        expect(resolveBoardPath("whiteboards/roadmap.excalidraw")).toBe("whiteboards/roadmap.excalidraw");
        expect(resolveBoardPath("whiteboards/roadmap")).toBe("whiteboards/roadmap.excalidraw");
        expect(resolveBoardPath("q3/plan")).toBe("whiteboards/q3-plan.excalidraw");
    });
});

describe("nextFractionalIndex", () => {
    it("follows the rocicorp integer-key sequence", () => {
        expect(nextFractionalIndex(null)).toBe("a0");
        expect(nextFractionalIndex("a0")).toBe("a1");
        expect(nextFractionalIndex("a9")).toBe("aA");
        expect(nextFractionalIndex("aZ")).toBe("aa");
        expect(nextFractionalIndex("az")).toBe("b00");
        expect(nextFractionalIndex("b00")).toBe("b01");
        expect(nextFractionalIndex("bzz")).toBe("c000");
        expect(nextFractionalIndex("Zz")).toBe("a0");
        // A fraction is dropped: the next integer is already greater.
        expect(nextFractionalIndex("a1V")).toBe("a2");
        // Garbage restarts the sequence rather than throwing.
        expect(nextFractionalIndex("?")).toBe("a0");
    });
});

describe("applyWhiteboardOps — add", () => {
    it("adds a labeled rectangle: a well-formed shape plus a bound, centered label", () => {
        const { elements, added } = apply([], [{ op: "add", id: "start", shape: "rectangle", text: "Sign up", x: 100, y: 50 }]);
        expect(added).toEqual([{ id: "start", type: "rectangle", text: "Sign up" }]);
        expect(elements).toHaveLength(2);
        const shape = byId(elements, "start");
        const label = labelOf(elements, "start")!;

        expect(shape).toMatchObject({
            type: "rectangle",
            x: 100,
            y: 50,
            version: 1,
            index: "a0",
            isDeleted: false,
            strokeColor: "#1e1e1e",
            backgroundColor: "transparent",
            roughness: 0,
            roundness: { type: 3 },
            updated: NOW,
            boundElements: [{ id: label.id, type: "text" }],
        });
        expect(shape.width).toBeGreaterThanOrEqual(120);
        expect(shape.height).toBeGreaterThanOrEqual(60);
        expect(typeof shape.seed).toBe("number");
        expect(shape.versionNonce).toBeGreaterThan(0);

        expect(label).toMatchObject({
            type: "text",
            text: "Sign up",
            originalText: "Sign up",
            containerId: "start",
            textAlign: "center",
            verticalAlign: "middle",
            fontFamily: 6,
            fontSize: 20,
            lineHeight: 1.35,
            autoResize: true,
            index: "a1",
            version: 1,
        });
        // Centered in the box.
        expect(label.x + label.width / 2).toBeCloseTo(shape.x + shape.width / 2, 5);
        expect(label.y + label.height / 2).toBeCloseTo(shape.y + shape.height / 2, 5);
        // And inside Excalidraw's bound-text box for a rectangle.
        expect(label.width).toBeLessThanOrEqual(shape.width - 10);
        expect(label.height).toBeLessThanOrEqual(shape.height - 10);
    });

    it("is deterministic under an injected clock and random source", () => {
        const a = apply([], [{ op: "add", shape: "ellipse", text: "A" }]);
        const b = apply([], [{ op: "add", shape: "ellipse", text: "A" }]);
        expect(serializeWhiteboardSnapshot(a.elements)).toBe(serializeWhiteboardSnapshot(b.elements));
        expect(a.added[0]!.id).toMatch(/^[a-z0-9]{12}$/);
    });

    it("places rightOf / below with centers aligned and the default gap", () => {
        const { elements } = apply(
            [],
            [
                { op: "add", id: "a", shape: "rectangle", text: "A", x: 0, y: 0, width: 200, height: 100 },
                { op: "add", id: "b", shape: "rectangle", text: "B", rightOf: "a", width: 100, height: 50 },
                { op: "add", id: "c", shape: "rectangle", text: "C", below: "a", width: 100, height: 50, gap: 30 },
                { op: "add", id: "d", shape: "rectangle", text: "D", leftOf: "a", width: 100, height: 100 },
                { op: "add", id: "e", shape: "rectangle", text: "E", above: "a", width: 200, height: 20 },
            ],
        );
        expect(byId(elements, "b")).toMatchObject({ x: 280, y: 25 });
        expect(byId(elements, "c")).toMatchObject({ x: 50, y: 130 });
        expect(byId(elements, "d")).toMatchObject({ x: -180, y: 0 });
        expect(byId(elements, "e")).toMatchObject({ x: 0, y: -100 });
    });

    it("flows unplaced additions in a row to the right of existing content", () => {
        const base = apply([], [{ op: "add", id: "a", shape: "rectangle", text: "A", x: 0, y: 40, width: 100, height: 60 }]).elements;
        const { elements } = apply(base, [
            { op: "add", id: "b", shape: "rectangle", text: "B", width: 100, height: 60 },
            { op: "add", id: "c", shape: "rectangle", text: "C", width: 100, height: 60 },
        ]);
        expect(byId(elements, "b")).toMatchObject({ x: 180, y: 40 });
        expect(byId(elements, "c")).toMatchObject({ x: 320, y: 40 });
    });

    it("wraps a long label and grows the box to fit it", () => {
        const { elements, warnings } = apply([], [{ op: "add", id: "long", shape: "rectangle", text: "This is a fairly long label that certainly needs more than one line" }]);
        const label = labelOf(elements, "long")!;
        expect((label.text as string).split("\n").length).toBeGreaterThan(1);
        expect(label.originalText).toBe("This is a fairly long label that certainly needs more than one line");
        const shape = byId(elements, "long");
        expect(label.width).toBeLessThanOrEqual(shape.width - 10);
        expect(label.height).toBeLessThanOrEqual(shape.height - 10);
        expect(warnings).toEqual([]);
    });

    it("keeps an explicit size and warns when the label cannot fit", () => {
        const { elements, warnings } = apply([], [{ op: "add", id: "tiny", shape: "rectangle", text: "one two three four five six seven eight nine ten eleven twelve", width: 120, height: 40 }]);
        expect(byId(elements, "tiny")).toMatchObject({ width: 120, height: 40 });
        expect(warnings.some((w) => w.includes("taller than the box"))).toBe(true);
    });

    it("adds free text, left-aligned, sized to its lines", () => {
        const { elements } = apply([], [{ op: "add", id: "note", shape: "text", text: "Hello\nworld", x: 10, y: 20, style: { fontSize: 16 } }]);
        const t = byId(elements, "note");
        expect(t).toMatchObject({ type: "text", text: "Hello\nworld", containerId: null, textAlign: "left", verticalAlign: "top", fontSize: 16, x: 10, y: 20 });
        expect(t.height).toBe(Math.round(2 * 16 * 1.35));
        expect(elements).toHaveLength(1);
    });

    it("resolves named palette colors, hex, and dashed", () => {
        const { elements } = apply([], [
            { op: "add", id: "a", shape: "ellipse", text: "A", style: { fill: "blue", stroke: "red", dashed: true, strokeWidth: 1 } },
            { op: "add", id: "b", shape: "diamond", text: "B", style: { fill: "#ABCDEF", stroke: "nonsense" } },
        ]);
        expect(byId(elements, "a")).toMatchObject({ backgroundColor: "#a5d8ff", strokeColor: "#e03131", strokeStyle: "dashed", strokeWidth: 1, roundness: null });
        expect(labelOf(elements, "a")).toMatchObject({ strokeColor: "#e03131" });
        expect(byId(elements, "b")).toMatchObject({ backgroundColor: "#abcdef", strokeColor: "#1e1e1e", roundness: { type: 2 } });
    });
});

describe("applyWhiteboardOps — connect", () => {
    const twoBoxes = (): WbElement[] =>
        apply([], [
            { op: "add", id: "a", shape: "rectangle", text: "A", x: 0, y: 0, width: 100, height: 60 },
            { op: "add", id: "b", shape: "rectangle", text: "B", x: 300, y: 0, width: 100, height: 60 },
        ]).elements;

    it("draws a bound arrow from edge to edge with a small gap, and registers it on both shapes", () => {
        const { elements, added } = apply(twoBoxes(), [{ op: "connect", id: "ab", from: "a", to: "b", label: "next" }]);
        expect(added).toEqual([{ id: "ab", type: "arrow", text: "next" }]);
        const arrow = byId(elements, "ab");
        expect(arrow).toMatchObject({
            type: "arrow",
            x: 105,
            y: 30,
            width: 190,
            height: 0,
            points: [[0, 0], [190, 0]],
            startBinding: { elementId: "a", focus: 0, gap: 5 },
            endBinding: { elementId: "b", focus: 0, gap: 5 },
            startArrowhead: null,
            endArrowhead: "arrow",
            elbowed: false,
            lastCommittedPoint: null,
            version: 1,
        });
        const label = labelOf(elements, "ab")!;
        expect(label).toMatchObject({ containerId: "ab", text: "next", fontSize: 16 });
        expect(label.x + label.width / 2).toBeCloseTo(200, 5);
        expect(arrow.boundElements).toEqual([{ id: label.id, type: "text" }]);

        // Both endpoints now list the arrow, and were bumped so peers take the new copy.
        for (const id of ["a", "b"]) {
            const shape = byId(elements, id);
            expect(shape.boundElements).toEqual(expect.arrayContaining([{ id: "ab", type: "arrow" }]));
            expect(shape.version).toBe(2);
        }
    });

    it("aims at an ellipse's outline, not its bounding box", () => {
        const base = apply([], [
            { op: "add", id: "a", shape: "ellipse", text: "A", x: 0, y: 0, width: 100, height: 100 },
            { op: "add", id: "b", shape: "ellipse", text: "B", x: 100, y: 100, width: 100, height: 100 },
        ]).elements;
        const { elements } = apply(base, [{ op: "connect", from: "a", to: "b", kind: "line" }]);
        const line = elements.find((e) => e.type === "line")!;
        // Diagonal: leaves A's circle at radius 50 + gap 5 along (1,1)/√2.
        const d = (50 + 5) / Math.SQRT2;
        expect(line.x).toBeCloseTo(50 + d, 3);
        expect(line.y).toBeCloseTo(50 + d, 3);
        expect(line.endArrowhead).toBeNull();
        expect(line.elbowed).toBeUndefined();
    });

    it("refuses to connect overlapping elements or a connector", () => {
        const base = apply([], [
            { op: "add", id: "a", shape: "rectangle", text: "A", x: 0, y: 0, width: 100, height: 60 },
            { op: "add", id: "b", shape: "rectangle", text: "B", x: 10, y: 10, width: 100, height: 60 },
            { op: "add", id: "c", shape: "rectangle", text: "C", x: 500, y: 0, width: 100, height: 60 },
        ]).elements;
        expect(() => apply(base, [{ op: "connect", from: "a", to: "b" }])).toThrow(/overlap/);
        const withArrow = apply(base, [{ op: "connect", id: "ac", from: "a", to: "c" }]).elements;
        expect(() => apply(withArrow, [{ op: "connect", from: "ac", to: "b" }])).toThrow(/is a connector/);
    });
});

describe("applyWhiteboardOps — update", () => {
    const flow = (): WbElement[] =>
        apply([], [
            { op: "add", id: "a", shape: "rectangle", text: "A", x: 0, y: 0, width: 100, height: 60 },
            { op: "add", id: "b", shape: "rectangle", text: "B", x: 300, y: 0, width: 100, height: 60 },
            { op: "connect", id: "ab", from: "a", to: "b", label: "go" },
        ]).elements;

    it("changes a label in place, bumping the label and nothing else", () => {
        const base = flow();
        const { elements, updated } = apply(base, [{ op: "update", id: "b", text: "Bee" }]);
        expect(updated).toEqual(["b"]);
        const label = labelOf(elements, "b")!;
        expect(label).toMatchObject({ text: "Bee", originalText: "Bee", version: 2 });
        // Untouched elements are the very same objects — byte-identical on the wire.
        expect(byId(elements, "a")).toBe(byId(base, "a"));
    });

    it("moves a box, re-centers its label and re-routes the arrows bound to it", () => {
        const { elements } = apply(flow(), [{ op: "update", id: "b", x: 300, y: 200 }]);
        const b = byId(elements, "b");
        expect(b).toMatchObject({ x: 300, y: 200, version: 3 });
        const label = labelOf(elements, "b")!;
        expect(label.y + label.height / 2).toBeCloseTo(230, 5);
        expect(label.version).toBe(2);
        const arrow = byId(elements, "ab");
        expect(arrow.version).toBe(2);
        const [, end] = arrow.points as [number, number][];
        // The line between the centers now leaves A through its bottom edge
        // (just below y=60, still within A's x-range) and reaches B through
        // its top edge (just above y=200).
        expect(arrow.y).toBeGreaterThan(60);
        expect(arrow.y).toBeLessThan(70);
        expect(arrow.x).toBeGreaterThan(50);
        expect(arrow.x).toBeLessThan(100);
        const endY = arrow.y + end![1];
        expect(endY).toBeLessThan(200);
        expect(endY).toBeGreaterThan(190);
        expect(arrow.x + end![0]).toBeGreaterThan(300);
        const arrowLabel = labelOf(elements, "ab")!;
        expect(arrowLabel.version).toBe(2);
        // A did not move, so nothing about it was rewritten.
        expect(byId(elements, "a").version).toBe(2);
    });

    it("writes nothing for a no-op update", () => {
        const base = flow();
        const { elements } = apply(base, [{ op: "update", id: "a" }]);
        expect(byId(elements, "a")).toBe(byId(base, "a"));
        expect(labelOf(elements, "a")).toBe(labelOf(base, "a"));
    });

    it("adds a label to an unlabeled box and removes one with empty text", () => {
        const base = apply([], [{ op: "add", id: "box", shape: "rectangle", x: 0, y: 0 }]).elements;
        expect(base).toHaveLength(1);
        const labeled = apply(base, [{ op: "update", id: "box", text: "Now labeled" }]).elements;
        expect(labelOf(labeled, "box")).toMatchObject({ text: "Now labeled", containerId: "box" });
        expect(byId(labeled, "box").boundElements).toHaveLength(1);
        const unlabeled = apply(labeled, [{ op: "update", id: "box", text: "" }]).elements;
        expect(labelOf(unlabeled, "box")).toBeUndefined();
        expect(byId(unlabeled, "box").boundElements).toEqual([]);
    });

    it("restyles and relabels a connector", () => {
        const { elements } = apply(flow(), [{ op: "update", id: "ab", text: "onwards", style: { dashed: true, stroke: "blue" } }]);
        expect(byId(elements, "ab")).toMatchObject({ strokeStyle: "dashed", strokeColor: "#1971c2", version: 2 });
        expect(labelOf(elements, "ab")).toMatchObject({ text: "onwards" });
    });

    it("edits free text", () => {
        const base = apply([], [{ op: "add", id: "t", shape: "text", text: "old", x: 0, y: 0 }]).elements;
        const { elements } = apply(base, [{ op: "update", id: "t", text: "new text", x: 5 }]);
        expect(byId(elements, "t")).toMatchObject({ text: "new text", originalText: "new text", x: 5, y: 0, version: 2 });
    });
});

describe("applyWhiteboardOps — delete", () => {
    const flow = (): WbElement[] =>
        apply([], [
            { op: "add", id: "a", shape: "rectangle", text: "A", x: 0, y: 0, width: 100, height: 60 },
            { op: "add", id: "b", shape: "rectangle", text: "B", x: 300, y: 0, width: 100, height: 60 },
            { op: "connect", id: "ab", from: "a", to: "b", label: "go" },
        ]).elements;

    it("tombstones a shape and its label, and unbinds arrows instead of dropping them", () => {
        const base = flow();
        const { elements, deleted } = apply(base, [{ op: "delete", id: "b" }]);
        expect(deleted).toEqual(["b"]);
        // Nothing is ever removed from the array: peers need the tombstone to converge.
        expect(elements).toHaveLength(base.length);
        expect(byId(elements, "b")).toMatchObject({ isDeleted: true, version: 3 });
        const bLabel = base.find((e) => e.type === "text" && e.containerId === "b")!;
        expect(byId(elements, bLabel.id)).toMatchObject({ isDeleted: true, version: 2 });
        expect(byId(elements, "ab")).toMatchObject({ isDeleted: false, endBinding: null, version: 2 });
        expect(byId(elements, "ab").startBinding).toEqual({ elementId: "a", focus: 0, gap: 5 });
        expect(liveOf(elements).map((e) => e.id)).not.toContain("b");
    });

    it("deleting an arrow drops it from both endpoints and takes its label along", () => {
        const base = flow();
        const { elements } = apply(base, [{ op: "delete", id: "ab" }]);
        expect(byId(elements, "ab").isDeleted).toBe(true);
        expect(labelOf(elements, "ab")).toBeUndefined();
        expect(byId(elements, "a").boundElements).not.toEqual(expect.arrayContaining([{ id: "ab", type: "arrow" }]));
        expect(byId(elements, "b").version).toBe(3);
    });

    it("a deleted id cannot be referenced later in the batch", () => {
        expect(() => apply(flow(), [{ op: "delete", id: "a" }, { op: "update", id: "a", text: "x" }])).toThrow(WhiteboardOpError);
    });
});

describe("applyWhiteboardOps — validation", () => {
    it("rejects the whole batch on the first bad reference and leaves the input alone", () => {
        const base = apply([], [{ op: "add", id: "a", shape: "rectangle", text: "A" }]).elements;
        const before = serializeWhiteboardSnapshot(base);
        const bad: WhiteboardOp[] = [
            { op: "add", id: "b", shape: "rectangle", text: "B", rightOf: "nope" },
            { op: "connect", from: "a", to: "a" },
            { op: "add", id: "a", shape: "ellipse" },
            { op: "delete", id: "ghost" },
        ];
        let error: unknown;
        try {
            apply(base, bad);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(WhiteboardOpError);
        const message = (error as Error).message;
        expect(message).toContain("Nothing was drawn");
        expect(message).toContain('no element "nope"');
        expect(message).toContain("from and to are the same element");
        expect(message).toContain('id "a" is already on the board');
        expect(message).toContain('no element "ghost"');
        expect(serializeWhiteboardSnapshot(base)).toBe(before);
    });

    it("lets a later op reference an id added earlier in the same batch", () => {
        const { elements } = apply([], [
            { op: "add", id: "x", shape: "rectangle", text: "X" },
            { op: "add", id: "y", shape: "rectangle", text: "Y", rightOf: "x" },
            { op: "connect", from: "x", to: "y" },
        ]);
        expect(liveOf(elements).filter((e) => e.type === "arrow")).toHaveLength(1);
    });

    it("appends after the highest existing z-order key", () => {
        const base: WbElement[] = [
            { id: "old", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 4, versionNonce: 1, index: "a5", isDeleted: false },
            { id: "gone", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 4, versionNonce: 1, index: "b00", isDeleted: true },
        ];
        const { elements } = apply(base, [{ op: "add", id: "new", shape: "text", text: "hi", x: 100, y: 100 }]);
        expect(byId(elements, "new").index).toBe("b01");
    });
});

describe("summarizeWhiteboard", () => {
    it("folds labels into shapes, lists connectors as from→to, and skips tombstones", () => {
        const scene = apply([], [
            { op: "add", id: "a", shape: "rectangle", text: "Sign up", x: 0, y: 0, width: 200, height: 80, style: { fill: "blue" } },
            { op: "add", id: "q", shape: "diamond", text: "Verified?", rightOf: "a", width: 200, height: 120, style: { dashed: true } },
            { op: "add", id: "note", shape: "text", text: "draft", x: 0, y: 300 },
            { op: "connect", id: "aq", from: "a", to: "q", label: "then" },
            { op: "add", id: "tmp", shape: "ellipse", text: "bye", x: 900, y: 900 },
        ]).elements;
        const withDeleted = apply(scene, [{ op: "delete", id: "tmp" }]).elements;
        const raw: WbElement = { id: "hand", type: "freedraw", x: 10, y: 10, width: 5, height: 5, version: 1, versionNonce: 0, index: "z9", isDeleted: false };
        const summary = summarizeWhiteboard([...withDeleted, raw]);

        expect(summary.shapes).toEqual([
            { id: "a", type: "rectangle", text: "Sign up", x: 0, y: 0, width: 200, height: 80, fill: "#a5d8ff" },
            { id: "q", type: "diamond", text: "Verified?", x: 280, y: -20, width: 200, height: 120, dashed: true },
        ]);
        expect(summary.texts).toEqual([expect.objectContaining({ id: "note", text: "draft", x: 0, y: 300, fontSize: 20 })]);
        expect(summary.connectors).toEqual([
            expect.objectContaining({ id: "aq", kind: "arrow", from: "a", to: "q", label: "then", start: { x: 205, y: 40 } }),
        ]);
        expect(summary.other).toEqual([{ id: "hand", type: "freedraw", x: 10, y: 10, width: 5, height: 5 }]);
        expect(summary.counts).toEqual({ shapes: 2, texts: 1, connectors: 1, other: 1 });
        expect(summary.bounds).toMatchObject({ minX: 0, minY: -20, maxX: 480 });
        expect(summary.bounds!.maxY).toBeGreaterThanOrEqual(300);
    });

    it("is empty for an empty board", () => {
        expect(summarizeWhiteboard([])).toEqual({
            bounds: null,
            shapes: [],
            texts: [],
            connectors: [],
            other: [],
            counts: { shapes: 0, texts: 0, connectors: 0, other: 0 },
        });
    });

    it("reads a real Excalidraw export's fields (originalText, bindings, points)", () => {
        const exported = parseWhiteboardSnapshot(JSON.stringify({
            elements: [
                { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 50, version: 12, versionNonce: 3, index: "a0", isDeleted: false, backgroundColor: "#ffec99", strokeColor: "#1e1e1e", boundElements: [{ id: "t", type: "text" }, { id: "ar", type: "arrow" }] },
                { id: "t", type: "text", x: 10, y: 10, width: 80, height: 25, version: 3, versionNonce: 1, index: "a1", isDeleted: false, text: "Hello\nthere", originalText: "Hello there", containerId: "r", fontSize: 20 },
                { id: "ar", type: "arrow", x: 105, y: 25, width: 100, height: 40, version: 2, versionNonce: 1, index: "a2", isDeleted: false, points: [[0, 0], [50, 10], [100, 40]], startBinding: { elementId: "r", focus: 0.1, gap: 3 }, endBinding: null },
            ],
        }))!;
        const s = summarizeWhiteboard(exported);
        expect(s.shapes[0]).toMatchObject({ id: "r", text: "Hello there", fill: "#ffec99" });
        expect(s.shapes[0]!.stroke).toBeUndefined();
        expect(s.connectors[0]).toEqual({ id: "ar", kind: "arrow", from: "r", start: { x: 105, y: 25 }, end: { x: 205, y: 65 }, points: 3 });
    });
});
