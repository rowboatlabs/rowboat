// Deterministic tool-permission metadata: decides whether a builtin tool
// call needs human approval (command allowlist, workspace file boundaries,
// file-access grants). Shared by both engines — extracted from the legacy
// engine file so the turn-runtime bridges no longer depend on it.

import path from "path";
import { WorkDir } from "../../config/config.js";
import { ToolAttachment } from "@x/shared/dist/agent.js";
import { ToolCallPart } from "@x/shared/dist/message.js";
import { z } from "zod";
import { ToolPermissionMetadata } from "@x/shared/dist/runs.js";
import { isBlocked, extractCommandNames } from "../../application/lib/command-executor.js";
import { getFileAccessAllowList, type FileAccessGrant, type FileAccessOperation } from "../../config/security.js";
import { isPathInside, resolveFilePathForPermission } from "../../filesystem/files.js";

type ToolPermissionMetadataValue = z.infer<typeof ToolPermissionMetadata>;

function fileGrantCoversPath(grant: FileAccessGrant, operation: FileAccessOperation, resolvedPath: string): boolean {
    return grant.operation === operation && isPathInside(path.resolve(grant.pathPrefix), path.resolve(resolvedPath));
}

function commonPathPrefix(paths: string[]): string {
    if (!paths.length) return path.resolve(WorkDir);
    const split = paths.map(p => path.resolve(p).split(path.sep).filter(Boolean));
    const first = split[0];
    const common: string[] = [];
    for (let i = 0; i < first.length; i++) {
        if (split.every(parts => parts[i] === first[i])) {
            common.push(first[i]);
        } else {
            break;
        }
    }
    const prefix = `${path.sep}${common.join(path.sep)}`;
    return prefix === path.sep ? prefix : path.resolve(prefix);
}

function grantPrefixForTool(toolName: string, resolvedPaths: string[]): string {
    if (toolName === 'file-list' || toolName === 'file-glob' || toolName === 'file-grep' || toolName === 'file-mkdir') {
        return commonPathPrefix(resolvedPaths);
    }
    const parentPaths = resolvedPaths.map(p => path.dirname(p));
    return commonPathPrefix(parentPaths);
}

function filePermissionTargets(toolName: string, args: Record<string, unknown>): { operation: FileAccessOperation; paths: string[] } | null {
    const pathArg = typeof args.path === 'string' ? args.path : undefined;
    switch (toolName) {
        case 'file-readText':
        case 'parseFile':
        case 'LLMParse':
        case 'file-exists':
        case 'file-stat':
            return pathArg ? { operation: 'read', paths: [pathArg] } : null;
        case 'file-list':
            return pathArg ? { operation: 'list', paths: [pathArg || '.'] } : null;
        case 'file-glob':
            return { operation: 'search', paths: [typeof args.cwd === 'string' && args.cwd ? args.cwd : '.'] };
        case 'file-grep':
            return { operation: 'search', paths: [typeof args.searchPath === 'string' && args.searchPath ? args.searchPath : '.'] };
        case 'file-writeText':
        case 'file-editText':
        case 'file-mkdir':
            return pathArg ? { operation: 'write', paths: [pathArg] } : null;
        case 'file-copy':
        case 'file-rename': {
            const from = typeof args.from === 'string' ? args.from : undefined;
            const to = typeof args.to === 'string' ? args.to : undefined;
            return from && to ? { operation: 'write', paths: [from, to] } : null;
        }
        case 'file-remove':
            return pathArg ? { operation: 'delete', paths: [pathArg] } : null;
        default:
            return null;
    }
}

export async function getToolPermissionMetadata(
    toolCall: z.infer<typeof ToolCallPart>,
    underlyingTool: z.infer<typeof ToolAttachment>,
    sessionAllowedCommands: Set<string>,
    sessionAllowedFileAccess: FileAccessGrant[],
): Promise<ToolPermissionMetadataValue | null> {
    if (underlyingTool.type !== 'builtin') {
        return null;
    }

    if (underlyingTool.name === 'executeCommand') {
        const args = toolCall.arguments;
        if (!args || typeof args !== 'object' || !('command' in args)) {
            return null;
        }
        const command = String((args as { command: unknown }).command);
        if (!isBlocked(command, sessionAllowedCommands)) {
            return null;
        }
        return {
            kind: 'command',
            commandNames: extractCommandNames(command),
        };
    }

    const args = toolCall.arguments && typeof toolCall.arguments === 'object'
        ? toolCall.arguments as Record<string, unknown>
        : {};
    const targets = filePermissionTargets(underlyingTool.name, args);
    if (!targets) {
        return null;
    }

    const resolvedTargets = await Promise.all(targets.paths.map(p => resolveFilePathForPermission(p)));
    const outsideWorkspacePaths = resolvedTargets
        .filter(target => !target.isInsideWorkspace)
        .map(target => target.canonicalPath);
    if (!outsideWorkspacePaths.length) {
        return null;
    }

    const persistentGrants = getFileAccessAllowList();
    const allGrants = [...persistentGrants, ...sessionAllowedFileAccess];
    const uncovered = outsideWorkspacePaths.filter(resolvedPath =>
        !allGrants.some(grant => fileGrantCoversPath(grant, targets.operation, resolvedPath))
    );
    if (!uncovered.length) {
        return null;
    }

    return {
        kind: 'file',
        operation: targets.operation,
        paths: uncovered,
        pathPrefix: grantPrefixForTool(underlyingTool.name, uncovered),
    };
}
