// Builtin tools: whiteboards — an agent's face of the shared Excalidraw boards
// in Spaces. Two tools over the spaces agent face (read_asset / propose_change
// on the board's snapshot asset BY ID, create_asset for a board's birth — the
// same calls the projected spaces tools make): `whiteboard-read` renders a board as the compact summary the model
// reasons about, and `whiteboard-draw` turns a list of operations into a new
// snapshot — read, apply, serialize, propose, reconcile-on-conflict — so the
// model never handles Excalidraw JSON and every write keeps the pane's
// invariants (spaces/whiteboard.ts). Open panes pick the change up live.
//
// Both hosts for free: core runs in Electron main and in rowboat-server, and
// nothing here touches IPC.

import { z } from "zod";
import { DEFAULT_WHITEBOARD_PATH, WHITEBOARD_TEXT_SNAPSHOT_MAX_BYTES, isWhiteboardPath, whiteboardDisplayName } from "@x/shared/dist/spaces.js";
import { isSpacesAvailable } from "../../assembly/connections.js";
import { BuiltinToolsSchema } from "../types.js";
import { ORG_ARG, callOrgTool, resolveOrgArg } from "./spaces.js";
import {
    WhiteboardOp,
    WhiteboardOpError,
    applyWhiteboardOps,
    boardPathForName,
    parseWhiteboardSnapshot,
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
    id: string;
    path: string;
    content: string;
    blob?: BlobRef;
    version: number;
    recentHistory?: Array<{ reason?: string; committedAt?: string; attribution?: unknown }>;
}

interface BoardEntry {
    id: string;
    path: string;
    name: string;
    version: number;
}

type LoadedBoard =
    | { found: true; path: string; version: number; elements: WbElement[]; lastChange?: { reason?: string; at?: string } }
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

/** A board by its asset id — the same read_asset the projected spaces tools make. */
async function loadBoard(org: OrgRecord, spaceId: string, boardId: string): Promise<LoadedBoard> {
    const res = await callOrgTool(org, "read_asset", { spaceId, assetId: boardId });
    if (isFailure(res)) {
        if (errorCode(res) === "not_found") return { found: false };
        throw new Error(errorText(res));
    }
    const asset = res as ReadAssetOk;
    // Only a board is drawable: any other file would be overwritten with a
    // scene the moment a model passed its id here.
    if (!isWhiteboardPath(asset.path)) {
        throw new Error(`${asset.path} (${boardId}) is not a board — boards live under whiteboards/. Read it with read_asset instead.`);
    }
    const elements = await snapshotElements(org, spaceId, asset.content ?? "", asset.blob, asset.path);
    const last = asset.recentHistory?.[0];
    return {
        found: true,
        path: asset.path,
        version: asset.version,
        elements,
        ...(last ? { lastChange: { ...(last.reason ? { reason: last.reason } : {}), ...(last.committedAt ? { at: last.committedAt } : {}) } } : {}),
    };
}

/** The boards a space has (list_spaces assets under whiteboards/): ids for the model, paths for display. */
async function listBoards(org: OrgRecord, spaceId: string): Promise<BoardEntry[]> {
    // DMs have boards too (the header button is not gated on space kind), so
    // the listing includes them; a failed listing is an error, not "no boards".
    const res = await callOrgTool(org, "list_spaces", { includeDirect: true });
    if (isFailure(res)) throw new Error(errorText(res));
    const spaces = (res as { spaces?: Array<{ id: string; assets?: Array<{ id: string; path: string; version: number }> }> }).spaces ?? [];
    const space = spaces.find((s) => s.id === spaceId);
    return (space?.assets ?? [])
        .filter((a) => isWhiteboardPath(a.path))
        .map((a) => ({ id: a.id, path: a.path, name: whiteboardDisplayName(a.path), version: a.version }));
}

const boardList = (boards: BoardEntry[]): string => boards.map((b) => `"${b.name}" (boardId ${b.id})`).join(", ");

type ProposeOutcome =
    | { outcome: "applied"; version: number }
    | { outcome: "merged"; version: number; mergedContent: string }
    | { outcome: "conflict"; currentVersion: number; currentContent: string; currentBlob?: BlobRef };

/** newContent below the text cap, else the same blob fallback the pane uses. */
async function snapshotPayload(org: OrgRecord, spaceId: string, json: string): Promise<{ newContent: string } | { blob: string }> {
    if (Buffer.byteLength(json, "utf8") <= WHITEBOARD_TEXT_SNAPSHOT_MAX_BYTES) return { newContent: json };
    const orgs = await import("../../../spaces/orgs.js");
    const blob = await orgs.getClient(org.id).uploadBlob(spaceId, Buffer.from(json, "utf8"), { declaredMime: "application/json" });
    return { blob: blob.hash };
}

async function proposeSnapshot(org: OrgRecord, spaceId: string, boardId: string, json: string, baseVersion: number, reason: string): Promise<ProposeOutcome> {
    const args = { spaceId, assetId: boardId, baseVersion, reason, ...(await snapshotPayload(org, spaceId, json)) };
    const res = await callOrgTool(org, "propose_change", args);
    if (isFailure(res)) throw new Error(errorText(res));
    return res as ProposeOutcome;
}

/** Birth of a board: create_asset at the whiteboards/<name>.excalidraw path — the one name-shaped call. */
async function createSnapshot(org: OrgRecord, spaceId: string, path: string, json: string, reason: string): Promise<{ id: string; path: string; version: number }> {
    const args = { spaceId, path, reason, ...(await snapshotPayload(org, spaceId, json)) };
    const res = await callOrgTool(org, "create_asset", args);
    if (isFailure(res)) throw new Error(errorText(res));
    return (res as { asset: { id: string; path: string; version: number } }).asset;
}

const BOARD_ID_ARG = z
    .string()
    .optional()
    .describe(
        "The board's asset id — from list_spaces (the space's assets under whiteboards/), a whiteboard-read/draw result, " +
            "or your context (an open or @-mentioned board). Omit for the space's default board.",
    );

export const whiteboardTools: Record<string, BuiltinTool> = {
    "whiteboard-read": {
        permission: "none",
        isAvailable: isSpacesAvailable,
        description:
            "Read a shared whiteboard (a board in a space) as a compact inventory: boxes with their labels, free text, " +
            "and connectors as from→to, each with an id and position, plus the bounds of everything drawn. Read before " +
            "drawing on a board that has content — the ids are what whiteboard-draw's connect/update/delete/rightOf take, " +
            "and the bounds say where free space is. Omit `boardId` for the space's default board. A board that does not " +
            "exist yet is a normal answer (exists: false, with the boards the space has and their ids): whiteboard-draw " +
            "with a `name` creates it on the first draw, so just draw. This tool and whiteboard-draw are the whole " +
            "whiteboard surface — there is no file to read and no command to run.",
        inputSchema: z.object({
            org: ORG_ARG,
            spaceId: z.string().describe("The space holding the board (from list_spaces, or the ids in your context)"),
            boardId: BOARD_ID_ARG,
        }),
        execute: async (input: { org?: string; spaceId: string; boardId?: string }) => {
            try {
                const org = await resolveOrgArg(input.org);
                // Not an error: a board that is not there yet is the normal
                // state of a fresh space. An error result here sent a model
                // off debugging (reading skill sources, running shell
                // commands) instead of drawing.
                const missing = async (boardId: string | undefined) => {
                    const boards = await listBoards(org, input.spaceId);
                    const name = boardId ? undefined : whiteboardDisplayName(DEFAULT_WHITEBOARD_PATH);
                    const next = boardId
                        ? boards.length === 0
                            ? `No board with boardId "${boardId}" here, and this space has no boards yet. whiteboard-draw with a name creates one — place the first element at x: 0, y: 0 and the rest relative to it.`
                            : `No board with boardId "${boardId}" here. This space's boards: ${boardList(boards)} — pass one of those boardIds, or whiteboard-draw with a name to create a new board.`
                        : boards.length === 0
                          ? `This space has no boards yet. whiteboard-draw creates "${name}" on the first draw — place the first element at x: 0, y: 0 and the rest relative to it.`
                          : `No default board "${name}" here yet; whiteboard-draw creates it on the first draw. To draw on an existing board instead, pass boardId: one of ${boardList(boards)}.`;
                    return {
                        success: true,
                        exists: false,
                        ...(boardId ? { boardId } : { name, path: DEFAULT_WHITEBOARD_PATH }),
                        empty: true,
                        boards,
                        next,
                    };
                };
                let boardId = input.boardId?.trim();
                if (!boardId) {
                    const def = (await listBoards(org, input.spaceId)).find((b) => b.path === DEFAULT_WHITEBOARD_PATH);
                    if (!def) return missing(undefined);
                    boardId = def.id;
                }
                const loaded = await loadBoard(org, input.spaceId, boardId);
                if (!loaded.found) return missing(boardId);
                const summary = summarizeWhiteboard(loaded.elements);
                return {
                    success: true,
                    boardId,
                    path: loaded.path,
                    name: whiteboardDisplayName(loaded.path),
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
            "result appears live for everyone with the board open. Address an existing board by `boardId`; a `name` " +
            "instead draws on the board with that name, creating it when the space has none (the result carries its boardId). " +
            "All-or-nothing: one invalid op (an unknown id, overlapping elements) writes nothing and says why. " +
            "This tool and whiteboard-read are the whole whiteboard surface — never read source files or run commands " +
            "to work out how boards work; the ops below are all there is.",
        inputSchema: z.object({
            org: ORG_ARG,
            spaceId: z.string().describe("The space holding the board"),
            boardId: z.string().optional().describe("An existing board's asset id (from list_spaces, whiteboard-read, or your context). Omit to draw by name."),
            name: z
                .string()
                .optional()
                .describe('Draw on the board with this name ("roadmap"), creating it when the space has none. Default "board". Ignored when boardId is given.'),
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
        execute: async (input: { org?: string; spaceId: string; boardId?: string; name?: string; ops: WhiteboardOp[]; reason: string }) => {
            try {
                const org = await resolveOrgArg(input.org);
                let boardId = input.boardId?.trim();
                let path: string;
                let elements: WbElement[] = [];
                let baseVersion = 0;
                if (boardId) {
                    const loaded = await loadBoard(org, input.spaceId, boardId);
                    if (!loaded.found) {
                        const boards = await listBoards(org, input.spaceId);
                        return {
                            success: false,
                            error:
                                `No board with boardId "${boardId}" in this space. ` +
                                (boards.length > 0 ? `Its boards: ${boardList(boards)}. ` : "It has no boards yet. ") +
                                "To start a new board, pass name instead of boardId.",
                        };
                    }
                    ({ path, elements, version: baseVersion } = loaded);
                } else {
                    path = boardPathForName(input.name);
                    const existing = (await listBoards(org, input.spaceId)).find((b) => b.path === path);
                    if (existing) {
                        const loaded = await loadBoard(org, input.spaceId, existing.id);
                        if (!loaded.found) return { success: false, error: `Board "${whiteboardDisplayName(path)}" vanished while drawing — try again.` };
                        boardId = existing.id;
                        ({ elements, version: baseVersion } = loaded);
                    } else {
                        // Birth: the first snapshot IS the create. A board born
                        // meanwhile (a human's "+ board", another agent) refuses
                        // the create; that is the conflict case in disguise, so
                        // the draw re-applies over the occupant below.
                        const applied = applyWhiteboardOps([], input.ops);
                        try {
                            const asset = await createSnapshot(org, input.spaceId, path, serializeWhiteboardSnapshot(applied.elements), input.reason);
                            const summary = summarizeWhiteboard(applied.elements);
                            return {
                                success: true,
                                boardId: asset.id,
                                path: asset.path,
                                name: whiteboardDisplayName(asset.path),
                                version: asset.version,
                                created: true,
                                added: applied.added,
                                updated: applied.updated,
                                deleted: applied.deleted,
                                ...(applied.warnings.length > 0 ? { warnings: applied.warnings } : {}),
                                bounds: summary.bounds,
                                counts: summary.counts,
                            };
                        } catch (e) {
                            const raced = (await listBoards(org, input.spaceId)).find((b) => b.path === path);
                            if (!raced) throw e;
                            const loaded = await loadBoard(org, input.spaceId, raced.id);
                            if (!loaded.found) throw e;
                            boardId = raced.id;
                            ({ elements, version: baseVersion } = loaded);
                        }
                    }
                }

                for (let attempt = 0; ; attempt++) {
                    const applied = applyWhiteboardOps(elements, input.ops);
                    const json = serializeWhiteboardSnapshot(applied.elements);
                    const outcome = await proposeSnapshot(org, input.spaceId, boardId, json, baseVersion, input.reason);
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
                        boardId,
                        path,
                        name: whiteboardDisplayName(path),
                        version: outcome.version,
                        created: false,
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
