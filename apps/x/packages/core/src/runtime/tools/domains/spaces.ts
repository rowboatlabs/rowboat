// Builtin tools: spaces blob bridge. The org's MCP face carries references
// only (propose_change takes a sha256; message bodies carry /b/<hash> links) —
// bytes ride the REST blob routes, which an LLM-driven MCP call can never
// carry (base64 through the model's context). These two tools are the
// harness-side bridge: local disk ↔ the org's blob store, riding the same
// member credentials the app UI uploads with. They attach via the spaces
// skill, next to the MCP tools they complete.

import path from "node:path";
import { z } from "zod";
import { blobLinkUrl } from "@rowboat/spaces-protocol";
import { isSpacesAvailable } from "../../assembly/connections.js";
import { BuiltinToolsSchema } from "../types.js";

// spaces/orgs.js reaches auth/oauth-client and config — imported lazily from
// execute, matching the voice domain's cycle-safety lesson. The pure protocol
// import above is dependency-free.

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

async function resolveOrg(serverName: string) {
    const orgs = await import("../../../spaces/orgs.js");
    const org = orgs.orgForSpacesMcpServerName(serverName);
    if (org) return org;
    const known = Object.keys(orgs.spacesMcpServers());
    throw new Error(
        known.length > 0
            ? `Unknown spaces server '${serverName}'. Available: ${known.join(", ")}`
            : "No spaces orgs are set up on this machine.",
    );
}

export const spacesTools: z.infer<typeof BuiltinToolsSchema> = {
    "spaces-upload-blob": {
        permission: "prompt",
        isAvailable: isSpacesAvailable,
        description:
            "Upload a local binary file (image, PDF, media, …) to a space's blob store, returning its sha256 " +
            "hash and canonical link. Uploading alone publishes NOTHING — an unreferenced upload is an invisible " +
            "orphan awaiting GC. Always follow up with a referencing act: pass the hash as " +
            "propose_change's `blob` to commit it into the space's files, or embed the returned `markdown` in a " +
            "post_to_topic body to share it in the feed. Re-uploading identical bytes is a free no-op (content-addressed).",
        inputSchema: z.object({
            server: z.string().describe("The spaces-<org> MCP server name (from listMcpServers) whose org holds the space"),
            spaceId: z.string().describe("The space to upload into (from list_spaces)"),
            path: z.string().describe("The local file to upload (workspace-relative or absolute)"),
            name: z.string().optional().describe("Display filename for the link (default: the file's basename)"),
        }),
        execute: async (input: { server: string; spaceId: string; path: string; name?: string }) => {
            try {
                const org = await resolveOrg(input.server);
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
            server: z.string().describe("The spaces-<org> MCP server name (from listMcpServers) whose org holds the blob"),
            url: z.string().optional().describe("The blob link exactly as it appears in a message body or file listing"),
            spaceId: z.string().optional().describe("Alternative to url: the space holding the blob"),
            hash: z.string().optional().describe("Alternative to url: the blob's sha256 (e.g. read_asset's blob.hash)"),
            name: z.string().optional().describe("Filename for the saved copy (default: the link's ?name=, else derived from the content type)"),
        }),
        execute: async (input: { server: string; url?: string; spaceId?: string; hash?: string; name?: string }) => {
            try {
                const org = await resolveOrg(input.server);
                let spaceId = input.spaceId;
                let hash = input.hash;
                let name = input.name;
                if (input.url) {
                    const link = parseBlobLink(input.url);
                    if (!link) {
                        return { success: false, error: "Not a blob link — expected https://<org>/s/<spaceId>/b/<hash>" };
                    }
                    if (link.address !== org.address) {
                        return {
                            success: false,
                            error: `That link belongs to org '${link.address}', not '${org.address}' — pass its spaces-* server instead.`,
                        };
                    }
                    spaceId = link.spaceId;
                    hash = link.hash;
                    name = name ?? link.name;
                }
                if (!spaceId || !hash) {
                    return { success: false, error: "Provide url, or spaceId + hash." };
                }
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
