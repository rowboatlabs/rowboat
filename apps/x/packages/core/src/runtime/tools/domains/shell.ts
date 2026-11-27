// Builtin tools: shell domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { executeCommand, executeCommandAbortable } from "../../../application/lib/command-executor.js";
import { agentSlackShimEnv } from "../../../slack/agent-slack-exec.js";
import { WorkDir } from "../../../config/config.js";
import type { ToolContext } from "../exec-tool.js";
import { BuiltinToolsSchema } from "../types.js";

/**
 * Resolves optional allowed working-directory roots (2026-10-13, #1144).
 * Returns null when unset, allowing unrestricted cwd (desktop behavior).
 */
export function getAllowedRoots(workDir: string = WorkDir): string[] | null {
    const envRoots = process.env.ROWBOAT_SHELL_ALLOWED_ROOTS;
    if (envRoots !== undefined && envRoots.trim() !== '') {
        return envRoots
            .split(/[,;]/)
            .map((r) => r.trim())
            .filter(Boolean)
            .map((r) => path.resolve(workDir, r));
    }

    const configFile = path.join(workDir, 'config', 'server.json');
    if (fs.existsSync(configFile)) {
        try {
            const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            const roots = raw?.shell?.allowedRoots;
            if (Array.isArray(roots)) {
                return roots
                    .filter((r): r is string => typeof r === 'string' && r.trim() !== '')
                    .map((r) => path.resolve(workDir, r.trim()));
            }
        } catch (err) {
            console.warn('[Shell] Failed to parse config/server.json (failing closed):', err);
            // Fail closed: reject commands if server.json exists but cannot be parsed (2026-10-14, #1144)
            return [];
        }
    }

    return null;
}

/**
 * Checks whether targetDir resolves within one of the allowed roots (2026-10-13, #1144).
 */
export function isWithinAllowedRoots(targetDir: string, allowedRoots: string[]): boolean {
    const resolvedTarget = path.resolve(targetDir);
    return allowedRoots.some((root) => {
        const resolvedRoot = path.resolve(root);
        if (resolvedTarget === resolvedRoot) {
            return true;
        }
        const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
        return resolvedTarget.startsWith(prefix);
    });
}

export const shellTools: z.infer<typeof BuiltinToolsSchema> = {
    executeCommand: {
        permission: "command-allowlist",
        description: 'Execute a shell command and return the output. Use this to run bash/shell commands.',
        inputSchema: z.object({
            command: z.string().describe('The shell command to execute (e.g., "ls -la", "cat file.txt")'),
            cwd: z.string().optional().describe('Working directory to execute the command in (defaults to workspace root). You do not need to set this unless absolutely necessary.'),
        }),
        execute: async ({ command, cwd }: { command: string, cwd?: string }, ctx?: ToolContext) => {
            try {
                const rootDir = path.resolve(WorkDir);
                const workingDir = cwd ? path.resolve(rootDir, cwd) : rootDir;

                // Optional working-directory boundary for remote/headless servers (2026-10-13, #1144).
                // When configured, confine cwd to the specified root directories.
                // Note: This is an execution convenience boundary, not a full sandbox; host isolation (container/VM)
                // remains necessary for complete security.
                const allowedRoots = getAllowedRoots(rootDir);
                if (allowedRoots && !isWithinAllowedRoots(workingDir, allowedRoots)) {
                    return {
                        success: false,
                        message: 'Invalid cwd: must be within allowed roots.',
                        command,
                        workingDir,
                    };
                }

                // Make `agent-slack` resolvable for skill-authored shell
                // commands; the shim forwards to the bundled CLI.
                const env = agentSlackShimEnv(path.join(rootDir, 'bin'));

                // Use abortable version when we have a signal
                if (ctx?.signal) {
                    const { promise, process: proc } = executeCommandAbortable(command, {
                        cwd: workingDir,
                        env,
                        signal: ctx.signal,
                        onData: (chunk: string) => {
                            ctx.publish({
                                runId: ctx.runId,
                                type: "tool-output-stream",
                                toolCallId: ctx.toolCallId,
                                toolName: "executeCommand",
                                output: chunk,
                                subflow: [],
                            });
                        },
                    });

                    // Register process with abort registry for force-kill
                    ctx.abortRegistry.registerProcess(ctx.runId, proc);

                    const result = await promise;

                    return {
                        success: result.exitCode === 0 && !result.wasAborted,
                        stdout: result.stdout,
                        stderr: result.stderr,
                        exitCode: result.exitCode,
                        wasAborted: result.wasAborted,
                        command,
                        workingDir,
                    };
                }

                // Fallback to original for backward compatibility
                const result = await executeCommand(command, { cwd: workingDir, env });

                return {
                    success: result.exitCode === 0,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                    command,
                    workingDir,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    command,
                };
            }
        },
    },
};
