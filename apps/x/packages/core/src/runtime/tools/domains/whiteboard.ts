// Builtin tools: whiteboards — an agent's face of the shared Excalidraw boards
// in Spaces. Two tools over the spaces agent face (read_asset / propose_change
// on the board's snapshot asset, the same calls the projected spaces tools
// make): `whiteboard-read` renders a board as the compact summary the model
// reasons about, and `whiteboard-draw` turns a list of operations into a new
// snapshot — read, apply, serialize, propose, reconcile-on-conflict — so the
// model never handles Excalidraw JSON and every write keeps the pane's
// invariants (spaces/whiteboard.ts). Open panes pick the change up live.
//
// Both hosts for free: core runs in Electron main and in rowboat-server, and
// nothing here touches IPC.

import { z } from "zod";
import { WHITEBOARD_DIR, WHITEBOARD_TEXT_SNAPSHOT_MAX_BYTES, isWhiteboardPath, whiteboardDisplayName } from "@x/shared/dist/spaces.js";
import { isSpacesAvailable } from "../../assembly/connections.js";
import { BuiltinToolsSchema } from "../types.js";
import { ORG_ARG, callOrgTool, resolveOrgArg } from "./spaces.js";
import {
    WhiteboardOp,
    WhiteboardOpError,
    applyWhiteboardOps,
    parseWhiteboardSnapshot,
    resolveBoardPath,
    serializeWhiteboardSnapshot,
    summarizeWhiteboard,
    type WbElement,
} from "../../../spaces/whiteboard.js";

type BuiltinTool = z.infer<typeof BuiltinToolsSchema>[string];
type OrgRecord = import("../../../spaces/orgs.js").OrgRecord;

const MAX_OPS = 200;
const MAX_CONFLICT_RETRIES = 3;

interface ToolFailure {
    success: false;
    error: unknown;
}

const isFailure = (v: unknown): v is ToolFailure =>
    !!v && typeof v === "object" && (v as { success?: unknown }).success === false;

const errorCode = (failure: ToolFailure): string | undefined => {
    const e = failure.error;
    if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") return (e as { code: string }).code;
    if (typeof e === "string") {
        try {
            const parsed = JSON.parse(e) as { code?: unknown };
            if (typeof parsed?.code === "string") return parsed.code;
        } catch {
            // plain text
        }
    }
    return undefined;
};

const errorText = (failure: ToolFailure): string => {
    const e = failure.error;
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
    return JSON.stringify(e);
};

interface BlobRef {
    hash: string;
    size: number;
    mime: string;
}

interface ReadAssetOk {
    path: string;
    content: string;
    blob?: BlobRef;
    version: number;
    recentHistory?: Array<{ reason?: string; committedAt?: string; attribution?: unknown }>;
}

type LoadedBoard =
    | { found: true; version: number; elements: WbElement[]; lastChange?: { reason?: string; at?: string } }
    | { found: false };

/** The text of a snapshot stored as a blob (boards past the text cap). */
async function blobText(org: OrgRecord, spaceId: string, blob: BlobRef): Promise<string> {
    const blobCache = await import("../../../spaces/blob-cache.js");
    const { bytes } = await blobCache.getBlob(org.id, spaceId, blob.hash);
    return new TextDecoder().decode(bytes);
}

async function snapshotElements(org: OrgRecord, spaceId: string, content: string, blob: BlobRef | undefined, path: string): Promise<WbElement[]> {
    const text = blob ? await blobText(org, spaceId, blob) : content;
    const elements = parseWhiteboardSnapshot(text);
    if (elements === null) throw new Error(`${path} is not a whiteboard snapshot (expected .excalidraw JSON with an elements array)`);
    return elements;
}

async function loadBoard(org: OrgRecord, spaceId: string, path: string): Promise<LoadedBoard> {
    const res = await callOrgTool(org, "read_asset", { spaceId, path });
    if (isFailure(res)) {
        if (errorCode(res) === "not_found") return { found: false };
        throw new Error(errorText(res));
    }
    const asset = res as ReadAssetOk;
    const elements = await snapshotElements(org, spaceId, asset.content ?? "", asset.blob, path);
    const last = asset.recentHistory?.[0];
    return {
        found: true,
        version: asset.version,
        elements,
        ...(last ? { lastChange: { ...(last.reason ? { reason: last.reason } : {}), ...(last.committedAt ? { at: last.committedAt } : {}) } } : {}),
    };
}

/** The boards a space has, for "no such board" errors and a bare read of a space with no default board. */
async function listBoards(org: OrgRecord, spaceId: string): Promise<Array<{ path: string; name: string; version: number }>> {
    const res = await callOrgTool(org, "list_spaces", {});
    if (isFailure(res)) return [];
    const spaces = (res as { spaces?: Array<{ id: string; assets?: Array<{ path: string; version: number }> }> }).spaces ?? [];
    const space = spaces.find((s) => s.id === spaceId);
    return (space?.assets ?? [])
        .filter((a) => isWhiteboardPath(a.path))
        .map((a) => ({ path: a.path, name: whiteboardDisplayName(a.path), version: a.version }));
}

type ProposeOutcome =
    | { outcome: "applied"; version: number }
    | { outcome: "merged"; version: number; mergedContent: string }
    | { outcome: "conflict"; currentVersion: number; currentContent: string; currentBlob?: BlobRef };

async function proposeSnapshot(
    org: OrgRecord,
    spaceId: string,
    path: string,
    json: string,
    baseVersion: number,
    reason: string,
): Promise<ProposeOutcome> {
    const args: Record<string, unknown> = { spaceId, path, baseVersion, reason };
    if (Buffer.byteLength(json, "utf8") <= WHITEBOARD_TEXT_SNAPSHOT_MAX_BYTES) {
        args.newContent = json;
    } else {
        // Past the text cap: the same blob fallback the pane uses.
        const orgs = await import("../../../spaces/orgs.js");
        const blob = await orgs.getClient(org.id).uploadBlob(spaceId, Buffer.from(json, "utf8"), { declaredMime: "application/json" });
        args.blob = blob.hash;
    }
    const res = await callOrgTool(org, "propose_change", args);
    if (isFailure(res)) throw new Error(errorText(res));
    return res as ProposeOutcome;
}

const BOARD_ARG = z
    .string()
    .optional()
    .describe(`Which board: its name ("roadmap") or path ("${WHITEBOARD_DIR}/roadmap.excalidraw"). Omit for the space's default board.`);

export const whiteboardTools: Record<string, BuiltinTool> = {
    "whiteboard-read": {
        permission: "none",
        isAvailable: isSpacesAvailable,
        description:
            "Read a shared whiteboard (a board in a space) as a compact inventory: boxes with their labels, free text, " +
            "and connectors as from→to, each with an id and position, plus the bounds of everything drawn. Read before " +
            "drawing on a board that has content — the ids are what whiteboard-draw's connect/update/delete/rightOf take, " +
            "and the bounds say where free space is. Omit `board` for the space's default board. A board that does not " +
            "exist yet is a normal answer (exists: false, with the boards the space has): whiteboard-draw creates it on " +
            "the first draw, so just draw. This tool and whiteboard-draw are the whole whiteboard surface — there is no " +
            "file to read and no command to run.",
        inputSchema: z.object({
            org: ORG_ARG,
            spaceId: z.string().describe("The space holding the board (from list_spaces, or the ids in your context)"),
            board: BOARD_ARG,
        }),
        execute: async (input: { org?: string; spaceId: string; board?: string }) => {
            try {
                const org = await resolveOrgArg(input.org);
                const path = resolveBoardPath(input.board);
                const loaded = await loadBoard(org, input.spaceId, path);
                if (!loaded.found) {
                    // Not an error: a board that is not there yet is the
                    // normal state of a fresh space. An error result here sent
                    // a model off debugging (reading skill sources, running
                    // shell commands) instead of drawing.
                    const boards = await listBoards(org, input.spaceId);
                    const name = whiteboardDisplayName(path);
                    return {
                        success: true,
                        exists: false,
                        board: path,
                        name,
                        empty: true,
                        boards,
                        next:
                            boards.length === 0
                                ? `This space has no boards yet. whiteboard-draw creates "${name}" on the first draw — place the first element at x: 0, y: 0 and the rest relative to it.`
                                : `No board "${name}" here yet; whiteboard-draw creates it on the first draw. To draw on an existing board instead, pass board: one of ${boards.map((b) => `"${b.name}"`).join(", ")}.`,
                    };
                }
                const summary = summarizeWhiteboard(loaded.elements);
                return {
                    success: true,
                    board: path,
                    name: whiteboardDisplayName(path),
                    version: loaded.version,
                    ...(loaded.lastChange ? { lastChange: loaded.lastChange } : {}),
                    empty: summary.counts.shapes + summary.counts.texts + summary.counts.connectors + summary.counts.other === 0,
                    ...summary,
                };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    "whiteboard-draw": {
        permission: "prompt",
        isAvailable: isSpacesAvailable,
        description:
            "Draw on a shared whiteboard by listing operations — never by writing the file. `add` a labeled box " +
            "(rectangle / ellipse / diamond; sized to its label) or free text, placed at x/y or rightOf/below/leftOf/above " +
            "another element; `connect` two elements with a labeled arrow (or line); `update` an element's text, position, " +
            "size or style; `delete` one. Give added elements an `id` so later ops in the same call can reference them; " +
            "existing ids come from whiteboard-read. Everything already on the board stays exactly as it is, and the " +
            "result appears live for everyone with the board open. Creates the board when it does not exist. " +
            "All-or-nothing: one invalid op (an unknown id, overlapping elements) writes nothing and says why. " +
            "This tool and whiteboard-read are the whole whiteboard surface — never read source files or run commands " +
            "to work out how boards work; the ops below are all there is.",
        inputSchema: z.object({
            org: ORG_ARG,
            spaceId: z.string().describe("The space holding the board"),
            board: BOARD_ARG,
            ops: z
                .array(WhiteboardOp)
                .min(1)
                .max(MAX_OPS)
                .describe(
                    "The operations, applied in order, as plain JSON objects. Example: " +
                        '[{"op":"add","id":"a","shape":"rectangle","text":"Sign up","x":0,"y":0},' +
                        '{"op":"add","id":"b","shape":"ellipse","text":"Done","rightOf":"a"},' +
                        '{"op":"connect","from":"a","to":"b","label":"then"}]',
                ),
            reason: z
                .string()
                .min(1)
                .max(200)
                .describe("One line for teammates, shown in the board's history (\"sketched the onboarding flow\"); from a thread, end it with ' · thread:<rootId>'"),
        }),
        execute: async (input: { org?: string; spaceId: string; board?: string; ops: WhiteboardOp[]; reason: string }) => {
            try {
                const org = await resolveOrgArg(input.org);
                const path = resolveBoardPath(input.board);
                const base = await loadBoard(org, input.spaceId, path);
                let elements = base.found ? base.elements : [];
                let baseVersion = base.found ? base.version : 0;
                const created = !base.found;

                for (let attempt = 0; ; attempt++) {
                    const applied = applyWhiteboardOps(elements, input.ops);
                    const json = serializeWhiteboardSnapshot(applied.elements);
                    const outcome = await proposeSnapshot(org, input.spaceId, path, json, baseVersion, input.reason);
                    if (outcome.outcome === "conflict") {
                        if (attempt + 1 >= MAX_CONFLICT_RETRIES) {
                            return {
                                success: false,
                                error: "The board kept changing under the write (someone is drawing right now). Nothing was written; try again in a moment.",
                            };
                        }
                        // Someone saved meanwhile: re-apply the same ops over their scene.
                        elements = await snapshotElements(org, input.spaceId, outcome.currentContent, outcome.currentBlob, path);
                        baseVersion = outcome.currentVersion;
                        continue;
                    }
                    const stored = outcome.outcome === "merged" ? parseWhiteboardSnapshot(outcome.mergedContent) ?? applied.elements : applied.elements;
                    const summary = summarizeWhiteboard(stored);
                    return {
                        success: true,
                        board: path,
                        name: whiteboardDisplayName(path),
                        version: outcome.version,
                        created,
                        added: applied.added,
                        updated: applied.updated,
                        deleted: applied.deleted,
                        ...(applied.warnings.length > 0 ? { warnings: applied.warnings } : {}),
                        bounds: summary.bounds,
                        counts: summary.counts,
                    };
                }
            } catch (e) {
                if (e instanceof WhiteboardOpError) return { success: false, error: e.message };
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
};

/** Every whiteboard builtin name — what the whiteboard skill attaches. */
export const WHITEBOARD_TOOL_NAMES: readonly string[] = Object.keys(whiteboardTools);
