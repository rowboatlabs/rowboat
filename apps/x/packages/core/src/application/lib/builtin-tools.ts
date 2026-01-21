import { z, ZodType } from "zod";
import * as path from "path";
import { execSync } from "child_process";
import { glob } from "glob";
import { executeCommand } from "./command-executor.js";
import { resolveSkill, availableSkills } from "../assistant/skills/index.js";
import { executeTool, listServers, listTools } from "../../mcp/mcp.js";
import container from "../../di/container.js";
import { IMcpConfigRepo } from "../..//mcp/repo.js";
import { McpServerDefinition } from "@x/shared/dist/mcp.js";
import * as workspace from "../../workspace/workspace.js";
import { IAgentsRepo } from "../../agents/repo.js";
import { WorkDir } from "../../config/config.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BuiltinToolsSchema = z.record(z.string(), z.object({
    description: z.string(),
	inputSchema: z.custom<ZodType>(),
    execute: z.function({
        input: z.any(),
        output: z.promise(z.any()),
    }),
}));

export const BuiltinTools: z.infer<typeof BuiltinToolsSchema> = {
    loadSkill: {
        description: "Load a Rowboat skill definition into context by fetching its guidance string",
        inputSchema: z.object({
            skillName: z.string().describe("Skill identifier or path (e.g., 'workflow-run-ops' or 'src/application/assistant/skills/workflow-run-ops/skill.ts')"),
        }),
        execute: async ({ skillName }: { skillName: string }) => {
            const resolved = resolveSkill(skillName);

            if (!resolved) {
                return {
                    success: false,
                    message: `Skill '${skillName}' not found. Available skills: ${availableSkills.join(", ")}`,
                };
            }

            return {
                success: true,
                skillName: resolved.id,
                path: resolved.catalogPath,
                content: resolved.content,
            };
        },
    },

    'workspace-getRoot': {
        description: 'Get the workspace root directory path',
        inputSchema: z.object({}),
        execute: async () => {
            try {
                return await workspace.getRoot();
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-exists': {
        description: 'Check if a file or directory exists in the workspace',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative path to check'),
        }),
        execute: async ({ path: relPath }: { path: string }) => {
            try {
                return await workspace.exists(relPath);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-stat': {
        description: 'Get file or directory statistics (size, modification time, etc.)',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative path to stat'),
        }),
        execute: async ({ path: relPath }: { path: string }) => {
            try {
                return await workspace.stat(relPath);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-readdir': {
        description: 'List directory contents. Can recursively explore directory structure with options.',
        inputSchema: z.object({
            path: z.string().describe('Workspace-relative directory path (empty string for root)'),
            recursive: z.boolean().optional().describe('Recursively list all subdirectories (default: false)'),
            includeStats: z.boolean().optional().describe('Include file stats like size and modification time (default: false)'),
            includeHidden: z.boolean().optional().describe('Include hidden files starting with . (default: false)'),
            allowedExtensions: z.array(z.string()).optional().describe('Filter by file extensions (e.g., [".json", ".ts"])'),
        }),
        execute: async ({ 
            path: relPath, 
            recursive, 
            includeStats, 
            includeHidden, 
            allowedExtensions 
        }: { 
            path: string;
            recursive?: boolean;
            includeStats?: boolean;
            includeHidden?: boolean;
            allowedExtensions?: string[];
        }) => {
            try {
                const entries = await workspace.readdir(relPath || '', {
                    recursive,
                    includeStats,
                    includeHidden,
                    allowedExtensions,
                });
                return entries;
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-readFile': {
        description: 'Read file contents from the workspace. Supports utf8, base64, and binary encodings.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative file path'),
            encoding: z.enum(['utf8', 'base64', 'binary']).optional().describe('File encoding (default: utf8)'),
        }),
        execute: async ({ path: relPath, encoding = 'utf8' }: { path: string; encoding?: 'utf8' | 'base64' | 'binary' }) => {
            try {
                return await workspace.readFile(relPath, encoding);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-writeFile': {
        description: 'Write or update file contents in the workspace. Automatically creates parent directories and supports atomic writes.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative file path'),
            data: z.string().describe('File content to write'),
            encoding: z.enum(['utf8', 'base64', 'binary']).optional().describe('Data encoding (default: utf8)'),
            atomic: z.boolean().optional().describe('Use atomic write (default: true)'),
            mkdirp: z.boolean().optional().describe('Create parent directories if needed (default: true)'),
            expectedEtag: z.string().optional().describe('ETag to check for concurrent modifications (conflict detection)'),
        }),
        execute: async ({
            path: relPath,
            data,
            encoding,
            atomic,
            mkdirp,
            expectedEtag
        }: {
            path: string;
            data: string;
            encoding?: 'utf8' | 'base64' | 'binary';
            atomic?: boolean;
            mkdirp?: boolean;
            expectedEtag?: string;
        }) => {
            try {
                return await workspace.writeFile(relPath, data, {
                    encoding,
                    atomic,
                    mkdirp,
                    expectedEtag,
                });
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-edit': {
        description: 'Make precise edits to a file by replacing specific text. Safer than rewriting entire files - produces smaller diffs and reduces risk of data loss.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative file path'),
            oldString: z.string().describe('Exact text to find and replace'),
            newString: z.string().describe('Replacement text'),
            replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false, fails if not unique)'),
        }),
        execute: async ({
            path: relPath,
            oldString,
            newString,
            replaceAll = false
        }: {
            path: string;
            oldString: string;
            newString: string;
            replaceAll?: boolean;
        }) => {
            try {
                const result = await workspace.readFile(relPath, 'utf8');
                const content = result.data;

                const occurrences = content.split(oldString).length - 1;

                if (occurrences === 0) {
                    return { error: 'oldString not found in file' };
                }

                if (occurrences > 1 && !replaceAll) {
                    return {
                        error: `oldString found ${occurrences} times. Use replaceAll: true or provide more context to make it unique.`
                    };
                }

                const newContent = replaceAll
                    ? content.replaceAll(oldString, newString)
                    : content.replace(oldString, newString);

                await workspace.writeFile(relPath, newContent, { encoding: 'utf8' });

                return {
                    success: true,
                    replacements: replaceAll ? occurrences : 1
                };
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'workspace-mkdir': {
        description: 'Create a directory in the workspace',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative directory path'),
            recursive: z.boolean().optional().describe('Create parent directories if needed (default: true)'),
        }),
        execute: async ({ path: relPath, recursive = true }: { path: string; recursive?: boolean }) => {
            try {
                return await workspace.mkdir(relPath, recursive);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-rename': {
        description: 'Rename or move a file or directory in the workspace',
        inputSchema: z.object({
            from: z.string().min(1).describe('Source workspace-relative path'),
            to: z.string().min(1).describe('Destination workspace-relative path'),
            overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default: false)'),
        }),
        execute: async ({ from, to, overwrite = false }: { from: string; to: string; overwrite?: boolean }) => {
            try {
                return await workspace.rename(from, to, overwrite);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-copy': {
        description: 'Copy a file in the workspace (directories not supported)',
        inputSchema: z.object({
            from: z.string().min(1).describe('Source workspace-relative file path'),
            to: z.string().min(1).describe('Destination workspace-relative file path'),
            overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default: false)'),
        }),
        execute: async ({ from, to, overwrite = false }: { from: string; to: string; overwrite?: boolean }) => {
            try {
                return await workspace.copy(from, to, overwrite);
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-remove': {
        description: 'Remove a file or directory from the workspace. Files are moved to trash by default for safety.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Workspace-relative path to remove'),
            recursive: z.boolean().optional().describe('Required for directories (default: false)'),
            trash: z.boolean().optional().describe('Move to trash instead of permanent delete (default: true)'),
        }),
        execute: async ({ path: relPath, recursive, trash }: { path: string; recursive?: boolean; trash?: boolean }) => {
            try {
                return await workspace.remove(relPath, {
                    recursive,
                    trash,
                });
            } catch (error) {
                return {
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'workspace-glob': {
        description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.json"). Much faster than recursive readdir for finding files.',
        inputSchema: z.object({
            pattern: z.string().describe('Glob pattern to match files'),
            cwd: z.string().optional().describe('Subdirectory to search in, relative to workspace root (default: workspace root)'),
        }),
        execute: async ({ pattern, cwd }: { pattern: string; cwd?: string }) => {
            try {
                const searchDir = cwd ? path.join(WorkDir, cwd) : WorkDir;

                // Ensure search directory is within workspace
                const resolvedSearchDir = path.resolve(searchDir);
                if (!resolvedSearchDir.startsWith(WorkDir)) {
                    return { error: 'Search directory must be within workspace' };
                }

                const files = await glob(pattern, {
                    cwd: searchDir,
                    nodir: true,
                    ignore: ['node_modules/**', '.git/**'],
                });

                return {
                    files,
                    count: files.length,
                    pattern,
                    cwd: cwd || '.',
                };
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    'workspace-grep': {
        description: 'Search file contents using regex. Returns matching files and lines. Uses ripgrep if available, falls back to grep.',
        inputSchema: z.object({
            pattern: z.string().describe('Regex pattern to search for'),
            searchPath: z.string().optional().describe('Directory or file to search, relative to workspace root (default: workspace root)'),
            fileGlob: z.string().optional().describe('File pattern filter (e.g., "*.ts", "*.md")'),
            contextLines: z.number().optional().describe('Lines of context around matches (default: 0)'),
            maxResults: z.number().optional().describe('Maximum results to return (default: 100)'),
        }),
        execute: async ({
            pattern,
            searchPath,
            fileGlob,
            contextLines = 0,
            maxResults = 100
        }: {
            pattern: string;
            searchPath?: string;
            fileGlob?: string;
            contextLines?: number;
            maxResults?: number;
        }) => {
            try {
                const targetPath = searchPath ? path.join(WorkDir, searchPath) : WorkDir;

                // Ensure target path is within workspace
                const resolvedTargetPath = path.resolve(targetPath);
                if (!resolvedTargetPath.startsWith(WorkDir)) {
                    return { error: 'Search path must be within workspace' };
                }

                // Try ripgrep first
                try {
                    const rgArgs = [
                        '--json',
                        '-e', JSON.stringify(pattern),
                        contextLines > 0 ? `-C ${contextLines}` : '',
                        fileGlob ? `--glob ${JSON.stringify(fileGlob)}` : '',
                        `--max-count ${maxResults}`,
                        '--ignore-case',
                        JSON.stringify(resolvedTargetPath),
                    ].filter(Boolean).join(' ');

                    const output = execSync(`rg ${rgArgs}`, {
                        encoding: 'utf8',
                        maxBuffer: 10 * 1024 * 1024,
                        cwd: WorkDir,
                    });

                    const matches = output.trim().split('\n')
                        .filter(Boolean)
                        .map(line => {
                            try {
                                return JSON.parse(line);
                            } catch {
                                return null;
                            }
                        })
                        .filter(m => m && m.type === 'match');

                    return {
                        matches: matches.map(m => ({
                            file: path.relative(WorkDir, m.data.path.text),
                            line: m.data.line_number,
                            content: m.data.lines.text.trim(),
                        })),
                        count: matches.length,
                        tool: 'ripgrep',
                    };
                } catch (rgError) {
                    // Fallback to basic grep if ripgrep not available or failed
                    const grepArgs = [
                        '-rn',
                        fileGlob ? `--include=${JSON.stringify(fileGlob)}` : '',
                        JSON.stringify(pattern),
                        JSON.stringify(resolvedTargetPath),
                        `| head -${maxResults}`,
                    ].filter(Boolean).join(' ');

                    try {
                        const output = execSync(`grep ${grepArgs}`, {
                            encoding: 'utf8',
                            maxBuffer: 10 * 1024 * 1024,
                            shell: '/bin/sh',
                        });

                        const lines = output.trim().split('\n').filter(Boolean);
                        return {
                            matches: lines.map(line => {
                                const match = line.match(/^(.+?):(\d+):(.*)$/);
                                if (match) {
                                    return {
                                        file: path.relative(WorkDir, match[1]),
                                        line: parseInt(match[2], 10),
                                        content: match[3].trim(),
                                    };
                                }
                                return { file: '', line: 0, content: line };
                            }),
                            count: lines.length,
                            tool: 'grep',
                        };
                    } catch {
                        // No matches found (grep returns non-zero on no matches)
                        return { matches: [], count: 0, tool: 'grep' };
                    }
                }
            } catch (error) {
                return { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        },
    },

    analyzeAgent: {
        description: 'Read and analyze an agent file to understand its structure, tools, and configuration',
        inputSchema: z.object({
            agentName: z.string().describe('Name of the agent file to analyze (with or without .json extension)'),
        }),
        execute: async ({ agentName }: { agentName: string }) => {
            const repo = container.resolve<IAgentsRepo>('agentsRepo');
            try {
                const agent = await repo.fetch(agentName);
                
                // Extract key information
                const toolsList = agent.tools ? Object.keys(agent.tools) : [];
                const agentTools = agent.tools ? Object.entries(agent.tools).map(([key, tool]) => ({
                    key,
                    type: tool.type,
                    name: tool.name,
                })) : [];
                
                const analysis = {
                    name: agent.name,
                    description: agent.description || 'No description',
                    model: agent.model || 'Not specified',
                    toolCount: toolsList.length,
                    tools: agentTools,
                    hasOtherAgents: agentTools.some(t => t.type === 'agent'),
                    structure: agent,
                };
                
                return {
                    success: true,
                    analysis,
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to analyze agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    addMcpServer: {
        description: 'Add or update an MCP server in the configuration with validation. This ensures the server definition is valid before saving.',
        inputSchema: z.object({
            serverName: z.string().describe('Name/alias for the MCP server'),
            config: McpServerDefinition,
        }),
        execute: async ({ serverName, config }: { 
            serverName: string;
            config: z.infer<typeof McpServerDefinition>;
        }) => {
            try {
                const validationResult = McpServerDefinition.safeParse(config);
                if (!validationResult.success) {
                    return {
                        success: false,
                        message: 'Server definition failed validation. Check the errors below.',
                        validationErrors: validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
                        providedDefinition: config,
                    };
                }

                const repo = container.resolve<IMcpConfigRepo>('mcpConfigRepo');
                await repo.upsert(serverName, config);
                
                return {
                    success: true,
                    serverName,
                };
            } catch (error) {
                return {
                    error: `Failed to update MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    listMcpServers: {
        description: 'List all available MCP servers from the configuration',
        inputSchema: z.object({}),
        execute: async () => {
            try {
                const result = await listServers();
                
                return {
                    result,
                    count: Object.keys(result.mcpServers).length,
                };
            } catch (error) {
                return {
                    error: `Failed to list MCP servers: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    listMcpTools: {
        description: 'List all available tools from a specific MCP server',
        inputSchema: z.object({
            serverName: z.string().describe('Name of the MCP server to query'),
            cursor: z.string().optional(),
        }),
        execute: async ({ serverName, cursor }: { serverName: string, cursor?: string }) => {
            try {
                const result = await listTools(serverName, cursor);
                return {
                    serverName,
                    result,
                    count: result.tools.length,
                };
            } catch (error) {
                return {
                    error: `Failed to list MCP tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
                };
            }
        },
    },
    
    executeMcpTool: {
        description: 'Execute a specific tool from an MCP server. Use this to run MCP tools on behalf of the user. IMPORTANT: Always use listMcpTools first to get the tool\'s inputSchema, then match the required parameters exactly in the arguments field.',
        inputSchema: z.object({
            serverName: z.string().describe('Name of the MCP server that provides the tool'),
            toolName: z.string().describe('Name of the tool to execute'),
            arguments: z.record(z.string(), z.any()).optional().describe('Arguments to pass to the tool (as key-value pairs matching the tool\'s input schema). MUST include all required parameters from the tool\'s inputSchema.'),
        }),
        execute: async ({ serverName, toolName, arguments: args = {} }: { serverName: string, toolName: string, arguments?: Record<string, unknown> }) => {
            try {
                const result = await executeTool(serverName, toolName, args);
                return {
                    success: true,
                    serverName,
                    toolName,
                    result,
                    message: `Successfully executed tool '${toolName}' from server '${serverName}'`,
                };
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to execute MCP tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    hint: 'Use listMcpTools to verify the tool exists and check its schema. Ensure all required parameters are provided in the arguments field.',
                };
            }
        },
    },
    
    executeCommand: {
        description: 'Execute a shell command and return the output. Use this to run bash/shell commands.',
        inputSchema: z.object({
            command: z.string().describe('The shell command to execute (e.g., "ls -la", "cat file.txt")'),
            cwd: z.string().optional().describe('Working directory to execute the command in (defaults to workspace root)'),
        }),
        execute: async ({ command, cwd }: { command: string, cwd?: string }) => {
            try {
                const rootDir = path.resolve(WorkDir);
                const workingDir = cwd ? path.resolve(rootDir, cwd) : rootDir;
                const rootPrefix = rootDir.endsWith(path.sep)
                    ? rootDir
                    : `${rootDir}${path.sep}`;

                // TODO: Re-enable this check
                // if (workingDir !== rootDir && !workingDir.startsWith(rootPrefix)) {
                //     return {
                //         success: false,
                //         message: 'Invalid cwd: must be within workspace root.',
                //         command,
                //         workingDir,
                //     };
                // }

                const result = await executeCommand(command, { cwd: workingDir });
                
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
