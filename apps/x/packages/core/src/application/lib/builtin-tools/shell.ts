// Builtin tools: shell domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as path from "path";
import { executeCommand, executeCommandAbortable } from "../command-executor.js";
import { agentSlackShimEnv } from "../../../slack/agent-slack-exec.js";
import { WorkDir } from "../../../config/config.js";
import type { ToolContext } from "../exec-tool.js";
import {
    BuiltinToolsSchema,
} from "./support.js";


export const shellTools: z.infer<typeof BuiltinToolsSchema> = {
    executeCommand: {
        description: 'Execute a shell command and return the output. Use this to run bash/shell commands.',
        inputSchema: z.object({
            command: z.string().describe('The shell command to execute (e.g., "ls -la", "cat file.txt")'),
            cwd: z.string().optional().describe('Working directory to execute the command in (defaults to workspace root). You do not need to set this unless absolutely necessary.'),
        }),
        execute: async ({ command, cwd }: { command: string, cwd?: string }, ctx?: ToolContext) => {
            try {
                const rootDir = path.resolve(WorkDir);
                const workingDir = cwd ? path.resolve(rootDir, cwd) : rootDir;
                // Make `agent-slack` resolvable for skill-authored shell
                // commands; the shim forwards to the bundled CLI.
                const env = agentSlackShimEnv(path.join(rootDir, 'bin'));

                // TODO: Re-enable this check
                // const rootPrefix = rootDir.endsWith(path.sep)
                //     ? rootDir
                //     : `${rootDir}${path.sep}`;
                // if (workingDir !== rootDir && !workingDir.startsWith(rootPrefix)) {
                //     return {
                //         success: false,
                //         message: 'Invalid cwd: must be within workspace root.',
                //         command,
                //         workingDir,
                //     };
                // }

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
