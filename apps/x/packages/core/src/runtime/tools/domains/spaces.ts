// Builtin tools: the spaces family. Three groups, one catalog slot:
//
// 1. The org's agent face, PROJECTED. Every MCP tool the Harbor server serves
//    (@rowboat/spaces-protocol `mcpTools`) becomes a builtin of the same name,
//    description, and input schema, plus one extra argument: `org` (which of
//    your person's orgs — optional when only one is registered). The call is
//    forwarded to that org's `spaces-<org>` MCP server, so the bytes on the
//    wire are exactly the public agent face (spec §9: no privileged path) —
//    the projection just gives the model native tool definitions at token
//    zero instead of a listMcpServers → listMcpTools → executeMcpTool hop
//    whose schema dump lives in context as text for the rest of the session.
//    Names stay bare across orgs on purpose: two orgs would otherwise need
//    two `post_message`s (native mcp:<server>:<tool> attachments collide).
//
// 2. The blob bridge: bytes never ride MCP (base64 through the model's
//    context), so upload/download go local disk ↔ the org's REST blob routes
//    on the same member credentials.
//
// 3. Local conveniences the app keeps on this machine (scheduled sends,
//    notification levels) — no org route exists for them; parity with the
//    app UI means exposing the same local modules.
//
// Permission: read-only projections are "none" (the checker's read policy);
// everything that writes to a team-visible org is "prompt" — the auto judge
// decides in auto mode, a human in manual mode, exactly as the app's other
// outward-acting builtins.

import path from "node:path";
import { z } from "zod";
import { blobLinkUrl, mcpTools, readOnlyMcpToolNames } from "@rowboat/spaces-protocol";
import { isSpacesAvailable } from "../../assembly/connections.js";
import { BuiltinToolsSchema } from "../types.js";

type BuiltinTool = z.infer<typeof BuiltinToolsSchema>[string];

// spaces/orgs.js reaches auth/oauth-client and config, mcp/mcp.js reaches the
// DI container — both imported lazily from execute, matching the voice
// domain's cycle-safety lesson. The pure protocol import above is
// dependency-free.

// --- org selection -------------------------------------------------------------

const ORG_ARG = z
    .string()
    .optional()
    .describe(
        "Which org: its name (e.g. \"rowboat\"), id, or spaces-<org> server name. " +
            "Omit when your person has exactly one org.",
    );

type OrgRecord = import("../../../spaces/orgs.js").OrgRecord;

/**
 * Resolve the `org` argument to a registered org. One org registered → it is
 * the default. Several → the argument is required and the error names them,
 * so the model can ask rather than guess (the wrong org is a team-visible
 * mistake).
 */
export async function resolveOrgArg(org: string | undefined): Promise<OrgRecord> {
    const orgs = await import("../../../spaces/orgs.js");
    const all = orgs.listOrgs();
    if (all.length === 0) throw new Error("No spaces orgs are set up on this machine.");
    const names = () => all.map((o) => `"${o.name}"`).join(", ");
    if (org === undefined || org.trim() === "") {
        if (all.length === 1) return all[0]!;
        throw new Error(`Several orgs are set up — pass org as one of ${names()}.`);
    }
    const wanted = org.trim().toLowerCase();
    const byServer = orgs.orgForSpacesMcpServerName(org.trim());
    if (byServer) return byServer;
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const hit =
        all.find((o) => o.id === org.trim()) ??
        all.find((o) => o.name.toLowerCase() === wanted) ??
        all.find((o) => o.address.toLowerCase() === wanted) ??
        all.find((o) => slug(o.name) === slug(wanted));
    if (hit) return hit;
    throw new Error(`Unknown org '${org}'. Available: ${names()}.`);
}

// --- the projected agent face --------------------------------------------------

interface McpCallResult {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
}

/**
 * Forward one tool call to the org's MCP server and unwrap the MCP envelope
 * into the builtin failure convention (types.ts): structured output on
 * success, `{ success: false, error }` on a tool-level error. Harbor's error
 * text is `{code, message, retryable}` JSON — surfaced as-is, it tells the
 * model what to do next (not_found → re-list, conflict → re-read).
 */
async function callOrgTool(org: OrgRecord, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const orgs = await import("../../../spaces/orgs.js");
    const { executeTool } = await import("../../../mcp/mcp.js");
    const serverName = orgs.spacesMcpServerNameFor(org.id);
    if (!serverName) throw new Error(`Org '${org.name}' has no spaces server registered.`);
    const result = (await executeTool(serverName, toolName, args)) as McpCallResult;
    const text = (result.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n");
    if (result.isError) {
        let error: unknown = text || "unknown error";
        try {
            error = JSON.parse(text);
        } catch {
            // plain text error — keep as-is
        }
        return { success: false, error };
    }
    if (result.structuredContent !== undefined) return result.structuredContent;
    try {
        return JSON.parse(text);
    } catch {
        return { text };
    }
}

function projectedTool(def: (typeof mcpTools)[number]): BuiltinTool {
    const input = (def.input as z.ZodObject<z.ZodRawShape>).extend({ org: ORG_ARG });
    return {
        permission: readOnlyMcpToolNames.has(def.name) ? "none" : "prompt",
        isAvailable: isSpacesAvailable,
        description: def.description,
        inputSchema: input,
        execute: async (raw: Record<string, unknown>) => {
            try {
                const { org, ...args } = raw;
                const record = await resolveOrgArg(typeof org === "string" ? org : undefined);
                return await callOrgTool(record, def.name, args);
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    };
}

const projectedTools: Record<string, BuiltinTool> = {};
for (const def of mcpTools) projectedTools[def.name] = projectedTool(def);

// --- blob bridge ----------------------------------------------------------------

// One place for the mime↔extension pairs the bridge cares about. Uploads use
// ext→mime as the declared content-type (the org sniffs magic bytes and its
// verdict is authoritative — this only helps types sniffing can't identify);
// downloads use mime→ext when the blob has no usable display name.
const MIME_EXT_PAIRS: Array<[mime: string, ext: string]> = [
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["image/svg+xml", "svg"],
    ["application/pdf", "pdf"],
    ["text/plain", "txt"],
    ["text/markdown", "md"],
    ["text/csv", "csv"],
    ["text/html", "html"],
    ["application/json", "json"],
    ["audio/mpeg", "mp3"],
    ["audio/wav", "wav"],
    ["audio/ogg", "ogg"],
    ["video/mp4", "mp4"],
    ["video/webm", "webm"],
    ["application/zip", "zip"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
];
const EXT_TO_MIME = new Map(MIME_EXT_PAIRS.map(([mime, ext]) => [ext, mime]));
const MIME_TO_EXT = new Map(MIME_EXT_PAIRS.map(([mime, ext]) => [mime, ext]));
// jpeg files also arrive as .jpeg
EXT_TO_MIME.set("jpeg", "image/jpeg");

/** Declared content-type for an upload, from the local file's extension. */
export function mimeForFilename(filename: string): string | undefined {
    const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
    return ext ? EXT_TO_MIME.get(ext) : undefined;
}

/**
 * A filesystem-safe filename with an extension, for the named download copy.
 * Preference order: the caller's name, then a hash-prefix stand-in; an
 * extension is appended from the mime when the name carries none, so
 * extension-sniffing consumers (parseFile, LLMParse) work on the result.
 */
export function blobFilename(name: string | undefined, hash: string, mime: string): string {
    const cleaned = (name ?? "")
        .split(/[/\\]/).pop()!
        // Control chars and the filesystem-hostile set; keep unicode letters.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f<>:"|?*]/g, "")
        .trim()
        .replace(/^\.+$/, "");
    const base = cleaned || hash.slice(0, 12);
    if (path.extname(base)) return base;
    const ext = MIME_TO_EXT.get((mime.split(";")[0] ?? "").trim().toLowerCase());
    return ext ? `${base}.${ext}` : base;
}

const BLOB_LINK_RE = /^https?:\/\/([^/]+)\/s\/([0-9A-HJKMNP-TV-Z]{26})\/b\/([0-9a-f]{64})(?:\?([^#]*))?/;

/**
 * Parse a canonical blob link (`https://<org>/s/<spaceId>/b/<hash>[?name=…]`,
 * the grammar of ids.ts) — the form message bodies and file listings carry.
 */
export function parseBlobLink(
    url: string,
): { address: string; spaceId: string; hash: string; name?: string } | null {
    const match = BLOB_LINK_RE.exec(url.trim());
    if (!match) return null;
    const [, address, spaceId, hash, query] = match;
    const name = query ? new URLSearchParams(query).get("name") : null;
    return { address: address!, spaceId: spaceId!, hash: hash!, ...(name ? { name } : {}) };
}

/** A blob link names its org by address — resolve that, falling back to the `org` argument. */
async function resolveBlobOrg(org: string | undefined, linkAddress: string | undefined): Promise<OrgRecord> {
    if (linkAddress) {
        const orgs = await import("../../../spaces/orgs.js");
        const hit = orgs.listOrgs().find((o) => o.address.toLowerCase() === linkAddress.toLowerCase());
        if (hit) return hit;
        throw new Error(`That link belongs to org '${linkAddress}', which is not set up on this machine.`);
    }
    return resolveOrgArg(org);
}

const blobTools: Record<string, BuiltinTool> = {
    "spaces-upload-blob": {
        permission: "prompt",
        isAvailable: isSpacesAvailable,
        description:
            "Upload a local binary file (image, PDF, media, …) to a space's blob store, returning its sha256 " +
            "hash and canonical link. Uploading alone publishes NOTHING — an unreferenced upload is an invisible " +
            "orphan awaiting GC. Always follow up with a referencing act: pass the hash as " +
            "propose_change's `blob` to commit it into the space's files, or embed the returned `markdown` in a " +
            "post_message body to share it in the feed. Re-uploading identical bytes is a free no-op (content-addressed).",
        inputSchema: z.object({
            org: ORG_ARG,
            spaceId: z.string().describe("The space to upload into (from list_spaces)"),
            path: z.string().describe("The local file to upload (workspace-relative or absolute)"),
            name: z.string().optional().describe("Display filename for the link (default: the file's basename)"),
        }),
        execute: async (input: { org?: string; spaceId: string; path: string; name?: string }) => {
            try {
                const org = await resolveOrgArg(input.org);
                const files = await import("../../../filesystem/files.js");
                const { buffer, resolvedPath } = await files.readBuffer(input.path);
                if (buffer.length === 0) return { success: false, error: `File is empty: ${input.path}` };
                const displayName = input.name?.trim() || path.basename(resolvedPath);
                const orgs = await import("../../../spaces/orgs.js");
                const declaredMime = mimeForFilename(displayName) ?? mimeForFilename(resolvedPath);
                const blob = await orgs.getClient(org.id).uploadBlob(input.spaceId, buffer, {
                    ...(declaredMime ? { declaredMime } : {}),
                });
                // Warm the local cache with the org's mime verdict: the app's
                // renderer and any later download read it without a re-fetch.
                const blobCache = await import("../../../spaces/blob-cache.js");
                await blobCache.seedBlob(buffer, blob.mime).catch(() => {});
                const url = blobLinkUrl(org.address, input.spaceId, blob.hash, displayName);
                const markdown = blob.mime.startsWith("image/")
                    ? `![${displayName}](${url})`
                    : `[${displayName}](${url})`;
                return { success: true, hash: blob.hash, size: blob.size, mime: blob.mime, url, markdown };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    "spaces-download-blob": {
        // Ungated by decision: it only reads space content the member already
        // has access to, into the app-owned cache — the outward acts (upload,
        // propose_change, post) are where gating lives.
        permission: "none",
        isAvailable: isSpacesAvailable,
        description:
            "Download a space blob (a message attachment or a binary file in the space's files) to local disk and " +
            "return the absolute path — feed that path to LLMParse/parseFile to inspect images, PDFs, and other " +
            "binaries, or copy it into the workspace with file tools. Identify the blob by its canonical link " +
            "(`https://<org>/s/<spaceId>/b/<hash>?name=…`, as seen in message bodies) or by spaceId + the `blob.hash` " +
            "read_asset/list_spaces report. Downloads are cached by content hash — repeat calls are free.",
        inputSchema: z.object({
            org: ORG_ARG,
            url: z.string().optional().describe("The blob link exactly as it appears in a message body or file listing"),
            spaceId: z.string().optional().describe("Alternative to url: the space holding the blob"),
            hash: z.string().optional().describe("Alternative to url: the blob's sha256 (e.g. read_asset's blob.hash)"),
            name: z.string().optional().describe("Filename for the saved copy (default: the link's ?name=, else derived from the content type)"),
        }),
        execute: async (input: { org?: string; url?: string; spaceId?: string; hash?: string; name?: string }) => {
            try {
                let spaceId = input.spaceId;
                let hash = input.hash;
                let name = input.name;
                let linkAddress: string | undefined;
                if (input.url) {
                    const link = parseBlobLink(input.url);
                    if (!link) {
                        return { success: false, error: "Not a blob link — expected https://<org>/s/<spaceId>/b/<hash>" };
                    }
                    linkAddress = link.address;
                    spaceId = link.spaceId;
                    hash = link.hash;
                    name = name ?? link.name;
                }
                if (!spaceId || !hash) {
                    return { success: false, error: "Provide url, or spaceId + hash." };
                }
                const org = await resolveBlobOrg(input.org, linkAddress);
                const blobCache = await import("../../../spaces/blob-cache.js");
                const { bytes, mime } = await blobCache.getBlob(org.id, spaceId, hash);
                const filePath = await blobCache.writeBlobFile(hash, blobFilename(name, hash, mime), bytes);
                return { success: true, path: filePath, mime, size: bytes.length, hash };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
};

// --- local conveniences ---------------------------------------------------------


const localTools: Record<string, BuiltinTool> = {
    schedule_message: {
        permission: "prompt",
        isAvailable: isSpacesAvailable,
        description:
            "Schedule a message to post later, from this machine, as your person (\"send this at 9am\"). " +
            "kind 'message' posts into the space or thread at the instant; kind 'reminder' instead shows " +
            "your person a local notification with the body at that time (\"remind me about this thread\"). " +
            "Fires only while the app is running; missed instants fire at next launch. Returns the item id " +
            "(cancel_scheduled takes it).",
        inputSchema: z.object({
            org: ORG_ARG,
            spaceId: z.string().describe("The space (or DM) to post into"),
            threadRoot: z.string().optional().describe("Reply into this thread; omit for a new root message"),
            body: z.string().min(1).describe("The message text (markdown)"),
            at: z.string().describe("ISO 8601 instant to fire at, e.g. 2026-09-10T09:00:00+05:30"),
            kind: z.enum(["message", "reminder"]).optional().describe("Default 'message'"),
        }),
        execute: async (input: {
            org?: string;
            spaceId: string;
            threadRoot?: string;
            body: string;
            at: string;
            kind?: "message" | "reminder";
        }) => {
            try {
                const org = await resolveOrgArg(input.org);
                const when = new Date(input.at);
                if (Number.isNaN(when.getTime())) return { success: false, error: `Not an ISO instant: ${input.at}` };
                if (when.getTime() <= Date.now()) return { success: false, error: "The instant is in the past." };
                const scheduler = await import("../../../spaces/scheduler.js");
                const item = scheduler.scheduleItem({
                    kind: input.kind ?? "message",
                    orgId: org.id,
                    spaceId: input.spaceId,
                    ...(input.threadRoot ? { threadRootId: input.threadRoot } : {}),
                    body: input.body,
                    at: when.toISOString(),
                });
                return { success: true, id: item.id, at: item.at, kind: item.kind };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    list_scheduled: {
        permission: "none",
        isAvailable: isSpacesAvailable,
        description: "The messages and reminders scheduled from this machine for one space, soonest first.",
        inputSchema: z.object({
            org: ORG_ARG,
            spaceId: z.string(),
        }),
        execute: async (input: { org?: string; spaceId: string }) => {
            try {
                const org = await resolveOrgArg(input.org);
                const scheduler = await import("../../../spaces/scheduler.js");
                return { success: true, items: scheduler.listScheduled(org.id, input.spaceId) };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
    cancel_scheduled: {
        permission: "none",
        isAvailable: isSpacesAvailable,
        description: "Cancel a scheduled message or reminder by id (from schedule_message or list_scheduled).",
        inputSchema: z.object({ id: z.string() }),
        execute: async (input: { id: string }) => {
            try {
                const scheduler = await import("../../../spaces/scheduler.js");
                const cancelled = scheduler.cancelScheduled(input.id);
                return cancelled ? { success: true } : { success: false, error: "No scheduled item with that id." };
            } catch (e) {
                return { success: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
};

// Catalog order: projected face (protocol order), then the bridge, then the
// local tools. The key-order test in catalog.test.ts pins the merged catalog.
export const spacesTools: z.infer<typeof BuiltinToolsSchema> = {
    ...projectedTools,
    ...blobTools,
    ...localTools,
};

/** Every spaces-family builtin name — what the spaces skill attaches. */
export const SPACES_TOOL_NAMES: readonly string[] = Object.keys(spacesTools);
