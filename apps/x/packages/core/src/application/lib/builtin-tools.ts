import { z, ZodType } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { execSync } from "child_process";
import { glob } from "glob";
import { executeCommand, executeCommandAbortable } from "./command-executor.js";
import { resolveSkill, availableSkills } from "../assistant/skills/index.js";
import { executeTool, listServers, listTools } from "../../mcp/mcp.js";
import container from "../../di/container.js";
import { IMcpConfigRepo } from "../..//mcp/repo.js";
import { McpServerDefinition } from "@x/shared/dist/mcp.js";
import * as workspace from "../../workspace/workspace.js";
import { IAgentsRepo } from "../../agents/repo.js";
import { WorkDir } from "../../config/config.js";
import { composioAccountsRepo } from "../../composio/repo.js";
import { executeAction as executeComposioAction, isConfigured as isComposioConfigured, listToolkitTools } from "../../composio/client.js";
import { slackToolCatalog } from "../assistant/skills/slack/tool-catalog.js";
import type { ToolContext } from "./exec-tool.js";
import { generateText } from "ai";
import { createProvider } from "../../models/models.js";
import { IModelConfigRepo } from "../../models/repo.js";
// Parser libraries are loaded dynamically inside parseFile.execute()
// to avoid pulling pdfjs-dist's DOM polyfills into the main bundle.
// Import paths are computed so esbuild cannot statically resolve them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _importDynamic = new Function('mod', 'return import(mod)') as (mod: string) => Promise<any>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BuiltinToolsSchema = z.record(z.string(), z.object({
    description: z.string(),
	inputSchema: z.custom<ZodType>(),
    execute: z.function({
        input: z.any(), // (input, ctx?) => Promise<any>
        output: z.promise(z.any()),
    }),
    isAvailable: z.custom<() => Promise<boolean>>().optional(),
}));

type SlackToolHint = {
    search?: string;
    patterns: string[];
    fallbackSlugs?: string[];
    preferSlugIncludes?: string[];
    excludePatterns?: string[];
    minScore?: number;
};

const slackToolHints: Record<string, SlackToolHint> = {
    sendMessage: {
        search: "message",
        patterns: ["send", "message", "channel"],
        fallbackSlugs: [
            "SLACK_SEND_MESSAGE",
            "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
            "SLACK_SEND_A_MESSAGE",
        ],
    },
    listConversations: {
        search: "conversation",
        patterns: ["list", "conversation", "channel"],
        fallbackSlugs: [
            "SLACK_LIST_CONVERSATIONS",
            "SLACK_LIST_ALL_CHANNELS",
            "SLACK_LIST_ALL_SLACK_TEAM_CHANNELS_WITH_VARIOUS_FILTERS",
            "SLACK_LIST_CHANNELS",
            "SLACK_LIST_CHANNEL",
        ],
        preferSlugIncludes: ["list", "conversation"],
        minScore: 2,
    },
    getConversationHistory: {
        search: "history",
        patterns: ["history", "conversation", "message"],
        fallbackSlugs: [
            "SLACK_FETCH_CONVERSATION_HISTORY",
            "SLACK_FETCHES_CONVERSATION_HISTORY",
            "SLACK_GET_CONVERSATION_HISTORY",
            "SLACK_GET_CHANNEL_HISTORY",
        ],
        preferSlugIncludes: ["history"],
        minScore: 2,
    },
    listUsers: {
        search: "user",
        patterns: ["list", "user"],
        fallbackSlugs: [
            "SLACK_LIST_ALL_USERS",
            "SLACK_LIST_ALL_SLACK_TEAM_USERS_WITH_PAGINATION",
            "SLACK_LIST_USERS",
            "SLACK_GET_USERS",
            "SLACK_USERS_LIST",
        ],
        preferSlugIncludes: ["list", "user"],
        excludePatterns: ["find", "by name", "by email", "by_email", "by_name", "lookup", "profile", "info"],
        minScore: 2,
    },
    getUserInfo: {
        search: "user",
        patterns: ["user", "info", "profile"],
        fallbackSlugs: [
            "SLACK_GET_USER_INFO",
            "SLACK_GET_USER",
            "SLACK_USER_INFO",
        ],
        preferSlugIncludes: ["user", "info"],
        minScore: 1,
    },
    searchMessages: {
        search: "search",
        patterns: ["search", "message"],
        fallbackSlugs: [
            "SLACK_SEARCH_FOR_MESSAGES_WITH_QUERY",
            "SLACK_SEARCH_MESSAGES",
            "SLACK_SEARCH_MESSAGE",
        ],
        preferSlugIncludes: ["search"],
        minScore: 1,
    },
};

const slackToolSlugCache = new Map<string, string>();

const slackToolSlugOverrides: Partial<Record<keyof typeof slackToolHints, string>> = {
    sendMessage: "SLACK_SEND_MESSAGE",
    listConversations: "SLACK_LIST_CONVERSATIONS",
    getConversationHistory: "SLACK_FETCH_CONVERSATION_HISTORY",
    listUsers: "SLACK_LIST_ALL_USERS",
    getUserInfo: "SLACK_RETRIEVE_DETAILED_USER_INFORMATION",
    searchMessages: "SLACK_SEARCH_MESSAGES",
};

const compactObject = (input: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

type SlackToolResult = { success: boolean; data?: unknown; error?: string };

/** Helper to execute a Slack tool with consistent account validation and error handling */
async function executeSlackTool(
    hintKey: keyof typeof slackToolHints,
    params: Record<string, unknown>
): Promise<SlackToolResult> {
    const account = composioAccountsRepo.getAccount('slack');
    if (!account || account.status !== 'ACTIVE') {
        return { success: false, error: 'Slack is not connected' };
    }
    try {
        const toolSlug = await resolveSlackToolSlug(hintKey);
        return await executeComposioAction(toolSlug, account.id, compactObject(params));
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

const normalizeSlackTool = (tool: { slug: string; name?: string; description?: string }) =>
    `${tool.slug} ${tool.name || ""} ${tool.description || ""}`.toLowerCase();

const scoreSlackTool = (tool: { slug: string; name?: string; description?: string }, patterns: string[]) => {
    const slug = tool.slug.toLowerCase();
    const name = (tool.name || "").toLowerCase();
    const description = (tool.description || "").toLowerCase();

    let score = 0;
    for (const pattern of patterns) {
        const needle = pattern.toLowerCase();
        if (slug.includes(needle)) score += 3;
        if (name.includes(needle)) score += 2;
        if (description.includes(needle)) score += 1;
    }
    return score;
};

const pickSlackTool = (
    tools: Array<{ slug: string; name?: string; description?: string }>,
    hint: SlackToolHint,
) => {
    let candidates = tools;

    if (hint.excludePatterns && hint.excludePatterns.length > 0) {
        candidates = candidates.filter((tool) => {
            const haystack = normalizeSlackTool(tool);
            return !hint.excludePatterns!.some((pattern) => haystack.includes(pattern.toLowerCase()));
        });
    }

    if (hint.preferSlugIncludes && hint.preferSlugIncludes.length > 0) {
        const preferred = candidates.filter((tool) =>
            hint.preferSlugIncludes!.every((pattern) => tool.slug.toLowerCase().includes(pattern.toLowerCase()))
        );
        if (preferred.length > 0) {
            candidates = preferred;
        }
    }

    let best: { slug: string; name?: string; description?: string } | null = null;
    let bestScore = 0;

    for (const tool of candidates) {
        const score = scoreSlackTool(tool, hint.patterns);
        if (score > bestScore) {
            bestScore = score;
            best = tool;
        }
    }

    if (!best || (hint.minScore !== undefined && bestScore < hint.minScore)) {
        return null;
    }

    return best;
};

const resolveSlackToolSlug = async (hintKey: keyof typeof slackToolHints) => {
    const cached = slackToolSlugCache.get(hintKey);
    if (cached) return cached;

    const hint = slackToolHints[hintKey];

    const override = slackToolSlugOverrides[hintKey];
    if (override && slackToolCatalog.some((tool) => tool.slug === override)) {
        slackToolSlugCache.set(hintKey, override);
        return override;
    }
    const resolveFromTools = (tools: Array<{ slug: string; name?: string; description?: string }>) => {
        if (hint.fallbackSlugs && hint.fallbackSlugs.length > 0) {
            const fallbackSet = new Set(hint.fallbackSlugs.map((slug) => slug.toLowerCase()));
            const fallback = tools.find((tool) => fallbackSet.has(tool.slug.toLowerCase()));
            if (fallback) return fallback.slug;
        }

        const best = pickSlackTool(tools, hint);
        return best?.slug || null;
    };

    const initialTools = slackToolCatalog;

    if (!initialTools.length) {
        throw new Error("No Slack tools returned from Composio");
    }

    const initialSlug = resolveFromTools(initialTools);
    if (initialSlug) {
        slackToolSlugCache.set(hintKey, initialSlug);
        return initialSlug;
    }

    const allSlug = resolveFromTools(slackToolCatalog);

    if (!allSlug) {
        const fallback = await listToolkitTools("slack", hint.search || null);
        const fallbackSlug = resolveFromTools(fallback.items || []);
        if (!fallbackSlug) {
            throw new Error(`Unable to resolve Slack tool for ${hintKey}. Try slack-listAvailableTools.`);
        }
        slackToolSlugCache.set(hintKey, fallbackSlug);
        return fallbackSlug;
    }

    slackToolSlugCache.set(hintKey, allSlug);
    return allSlug;
};

const LLMPARSE_MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
};

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

    'parseFile': {
        description: 'Parse and extract text content from files (PDF, Excel, CSV, Word .docx). Auto-detects format from file extension.',
        inputSchema: z.object({
            path: z.string().min(1).describe('File path to parse. Can be an absolute path or a workspace-relative path.'),
        }),
        execute: async ({ path: filePath }: { path: string }) => {
            try {
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const supportedExts = ['.pdf', '.xlsx', '.xls', '.csv', '.docx'];

                if (!supportedExts.includes(ext)) {
                    return {
                        success: false,
                        error: `Unsupported file format '${ext}'. Supported formats: ${supportedExts.join(', ')}`,
                    };
                }

                // Read file as buffer — support both absolute and workspace-relative paths
                let buffer: Buffer;
                if (path.isAbsolute(filePath)) {
                    buffer = await fs.readFile(filePath);
                } else {
                    const result = await workspace.readFile(filePath, 'base64');
                    buffer = Buffer.from(result.data, 'base64');
                }

                if (ext === '.pdf') {
                    const { PDFParse } = await _importDynamic("pdf-parse");
                    const parser = new PDFParse({ data: new Uint8Array(buffer) });
                    try {
                        const textResult = await parser.getText();
                        const infoResult = await parser.getInfo();
                        return {
                            success: true,
                            fileName,
                            format: 'pdf',
                            content: textResult.text,
                            metadata: {
                                pages: textResult.total,
                                title: infoResult.info?.Title || undefined,
                                author: infoResult.info?.Author || undefined,
                            },
                        };
                    } finally {
                        await parser.destroy();
                    }
                }

                if (ext === '.xlsx' || ext === '.xls') {
                    const XLSX = await _importDynamic("xlsx");
                    const workbook = XLSX.read(buffer, { type: 'buffer' });
                    const sheets: Record<string, string> = {};
                    for (const sheetName of workbook.SheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        sheets[sheetName] = XLSX.utils.sheet_to_csv(sheet);
                    }
                    return {
                        success: true,
                        fileName,
                        format: ext === '.xlsx' ? 'xlsx' : 'xls',
                        content: Object.values(sheets).join('\n\n'),
                        metadata: {
                            sheetNames: workbook.SheetNames,
                            sheetCount: workbook.SheetNames.length,
                        },
                        sheets,
                    };
                }

                if (ext === '.csv') {
                    const Papa = (await _importDynamic("papaparse")).default;
                    const text = buffer.toString('utf8');
                    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
                    return {
                        success: true,
                        fileName,
                        format: 'csv',
                        content: text,
                        metadata: {
                            rowCount: parsed.data.length,
                            headers: parsed.meta.fields || [],
                        },
                        data: parsed.data,
                    };
                }

                if (ext === '.docx') {
                    const mammoth = (await _importDynamic("mammoth")).default;
                    const docResult = await mammoth.extractRawText({ buffer });
                    return {
                        success: true,
                        fileName,
                        format: 'docx',
                        content: docResult.value,
                    };
                }

                return { success: false, error: 'Unexpected error' };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'LLMParse': {
        description: 'Send a file to the configured LLM as a multimodal attachment and ask it to extract content as markdown. Best for scanned PDFs, images with text, complex layouts, or any format where local parsing falls short. Supports documents (PDF, Word, Excel, PowerPoint, CSV, TXT, HTML) and images (PNG, JPG, GIF, WebP, SVG, BMP, TIFF).',
        inputSchema: z.object({
            path: z.string().min(1).describe('File path to parse. Can be an absolute path or a workspace-relative path.'),
            prompt: z.string().optional().describe('Custom instruction for the LLM (defaults to "Convert this file to well-structured markdown.")'),
        }),
        execute: async ({ path: filePath, prompt }: { path: string; prompt?: string }) => {
            try {
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const mimeType = LLMPARSE_MIME_TYPES[ext];

                if (!mimeType) {
                    return {
                        success: false,
                        error: `Unsupported file format '${ext}'. Supported formats: ${Object.keys(LLMPARSE_MIME_TYPES).join(', ')}`,
                    };
                }

                // Read file as buffer — support both absolute and workspace-relative paths
                let buffer: Buffer;
                if (path.isAbsolute(filePath)) {
                    buffer = await fs.readFile(filePath);
                } else {
                    const result = await workspace.readFile(filePath, 'base64');
                    buffer = Buffer.from(result.data, 'base64');
                }

                const base64 = buffer.toString('base64');

                // Resolve model config from DI container
                const modelConfigRepo = container.resolve<IModelConfigRepo>('modelConfigRepo');
                const modelConfig = await modelConfigRepo.getConfig();
                const provider = createProvider(modelConfig.provider);
                const model = provider.languageModel(modelConfig.model);

                const userPrompt = prompt || 'Convert this file to well-structured markdown.';

                const response = await generateText({
                    model,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: userPrompt },
                                { type: 'file', data: base64, mediaType: mimeType },
                            ],
                        },
                    ],
                });

                return {
                    success: true,
                    fileName,
                    format: ext.slice(1),
                    mimeType,
                    content: response.text,
                    usage: response.usage,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
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
            cwd: z.string().optional().describe('Working directory to execute the command in (defaults to workspace root). You do not need to set this unless absolutely necessary.'),
        }),
        execute: async ({ command, cwd }: { command: string, cwd?: string }, ctx?: ToolContext) => {
            try {
                const rootDir = path.resolve(WorkDir);
                const workingDir = cwd ? path.resolve(rootDir, cwd) : rootDir;

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
                        signal: ctx.signal,
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

    // ============================================================================
    // Slack Tools (via Composio)
    // ============================================================================

    'slack-checkConnection': {
        description: 'Check if Slack is connected and ready to use. Use this before other Slack operations.',
        inputSchema: z.object({}),
        execute: async () => {
            if (!isComposioConfigured()) {
                return {
                    connected: false,
                    error: 'Composio is not configured. Please set up your Composio API key first.',
                };
            }
            const account = composioAccountsRepo.getAccount('slack');
            if (!account || account.status !== 'ACTIVE') {
                return {
                    connected: false,
                    error: 'Slack is not connected. Please connect Slack from the settings.',
                };
            }
            return {
                connected: true,
                accountId: account.id,
            };
        },
    },

    'slack-listAvailableTools': {
        description: 'List available Slack tools from Composio. Use this to discover the correct tool slugs before executing actions. Call this first if other Slack tools return errors.',
        inputSchema: z.object({
            search: z.string().optional().describe('Optional search query to filter tools (e.g., "message", "channel", "user")'),
        }),
        execute: async ({ search }: { search?: string }) => {
            if (!isComposioConfigured()) {
                return { success: false, error: 'Composio is not configured' };
            }

            try {
                const result = await listToolkitTools('slack', search || null);
                return {
                    success: true,
                    tools: result.items,
                    count: result.items.length,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'slack-executeAction': {
        description: 'Execute a Slack action by its Composio tool slug. Use slack-listAvailableTools first to discover correct slugs. Pass the exact slug and the required input parameters.',
        inputSchema: z.object({
            toolSlug: z.string().describe('The exact Composio tool slug (e.g., "SLACKBOT_SEND_A_MESSAGE_TO_A_SLACK_CHANNEL")'),
            input: z.record(z.string(), z.unknown()).describe('Input parameters for the tool (check the tool description for required fields)'),
        }),
        execute: async ({ toolSlug, input }: { toolSlug: string; input: Record<string, unknown> }) => {
            const account = composioAccountsRepo.getAccount('slack');
            if (!account || account.status !== 'ACTIVE') {
                return { success: false, error: 'Slack is not connected' };
            }

            try {
                const result = await executeComposioAction(toolSlug, account.id, input);
                return result;
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'slack-sendMessage': {
        description: 'Send a message to a Slack channel or user. Requires channel ID (starts with C for channels, D for DMs) or user ID.',
        inputSchema: z.object({
            channel: z.string().describe('Channel ID (e.g., C01234567) or user ID (e.g., U01234567) to send the message to'),
            text: z.string().describe('The message text to send'),
        }),
        execute: async ({ channel, text }: { channel: string; text: string }) => {
            return executeSlackTool("sendMessage", { channel, text });
        },
    },

    'slack-listChannels': {
        description: 'List Slack channels the user has access to. Returns channel IDs and names.',
        inputSchema: z.object({
            types: z.string().optional().describe('Comma-separated channel types: public_channel, private_channel, mpim, im (default: public_channel,private_channel)'),
            limit: z.number().optional().describe('Maximum number of channels to return (default: 100)'),
        }),
        execute: async ({ types, limit }: { types?: string; limit?: number }) => {
            return executeSlackTool("listConversations", {
                types: types || "public_channel,private_channel",
                limit: limit ?? 100,
            });
        },
    },

    'slack-getChannelHistory': {
        description: 'Get recent messages from a Slack channel. Returns message history with timestamps and user IDs.',
        inputSchema: z.object({
            channel: z.string().describe('Channel ID to get history from (e.g., C01234567)'),
            limit: z.number().optional().describe('Maximum number of messages to return (default: 20, max: 100)'),
        }),
        execute: async ({ channel, limit }: { channel: string; limit?: number }) => {
            return executeSlackTool("getConversationHistory", {
                channel,
                limit: limit !== undefined ? Math.min(limit, 100) : 20,
            });
        },
    },

    'slack-listUsers': {
        description: 'List users in the Slack workspace. Returns user IDs, names, and profile info.',
        inputSchema: z.object({
            limit: z.number().optional().describe('Maximum number of users to return (default: 100)'),
        }),
        execute: async ({ limit }: { limit?: number }) => {
            return executeSlackTool("listUsers", { limit: limit ?? 100 });
        },
    },

    'slack-getUserInfo': {
        description: 'Get detailed information about a specific Slack user by their user ID.',
        inputSchema: z.object({
            user: z.string().describe('User ID to get info for (e.g., U01234567)'),
        }),
        execute: async ({ user }: { user: string }) => {
            return executeSlackTool("getUserInfo", { user });
        },
    },

    'slack-searchMessages': {
        description: 'Search for messages in Slack. Find messages containing specific text across channels.',
        inputSchema: z.object({
            query: z.string().describe('Search query text'),
            count: z.number().optional().describe('Maximum number of results (default: 20)'),
        }),
        execute: async ({ query, count }: { query: string; count?: number }) => {
            return executeSlackTool("searchMessages", { query, count: count ?? 20 });
        },
    },

    'slack-getDirectMessages': {
        description: 'List direct message (DM) channels. Returns IDs of DM conversations with other users.',
        inputSchema: z.object({
            limit: z.number().optional().describe('Maximum number of DM channels to return (default: 50)'),
        }),
        execute: async ({ limit }: { limit?: number }) => {
            return executeSlackTool("listConversations", { types: "im", limit: limit ?? 50 });
        },
    },

    // ============================================================================
    // Web Search (Brave Search API)
    // ============================================================================

    'web-search': {
        description: 'Search the web using Brave Search. Returns web results with titles, URLs, and descriptions.',
        inputSchema: z.object({
            query: z.string().describe('The search query'),
            count: z.number().optional().describe('Number of results to return (default: 5, max: 20)'),
            freshness: z.string().optional().describe('Filter by freshness: pd (past day), pw (past week), pm (past month), py (past year)'),
        }),
        isAvailable: async () => {
            try {
                const homedir = process.env.HOME || process.env.USERPROFILE || '';
                const braveConfigPath = path.join(homedir, '.rowboat', 'config', 'brave-search.json');
                const raw = await fs.readFile(braveConfigPath, 'utf8');
                const config = JSON.parse(raw);
                return !!config.apiKey;
            } catch {
                return false;
            }
        },
        execute: async ({ query, count, freshness }: { query: string; count?: number; freshness?: string }) => {
            try {
                // Read API key from config
                const homedir = process.env.HOME || process.env.USERPROFILE || '';
                const braveConfigPath = path.join(homedir, '.rowboat', 'config', 'brave-search.json');

                let apiKey: string;
                try {
                    const raw = await fs.readFile(braveConfigPath, 'utf8');
                    const config = JSON.parse(raw);
                    apiKey = config.apiKey;
                } catch {
                    return {
                        success: false,
                        error: 'Brave Search API key not configured. Create ~/.rowboat/config/brave-search.json with { "apiKey": "<your-key>" }',
                    };
                }

                if (!apiKey) {
                    return {
                        success: false,
                        error: 'Brave Search API key is empty. Set "apiKey" in ~/.rowboat/config/brave-search.json',
                    };
                }

                // Build query params
                const resultCount = Math.min(Math.max(count || 5, 1), 20);
                const params = new URLSearchParams({
                    q: query,
                    count: String(resultCount),
                });
                if (freshness) {
                    params.set('freshness', freshness);
                }

                const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
                const response = await fetch(url, {
                    headers: {
                        'X-Subscription-Token': apiKey,
                        'Accept': 'application/json',
                    },
                });

                if (!response.ok) {
                    const body = await response.text();
                    return {
                        success: false,
                        error: `Brave Search API error (${response.status}): ${body}`,
                    };
                }

                const data = await response.json() as {
                    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
                };

                const results = (data.web?.results || []).map((r: { title?: string; url?: string; description?: string }) => ({
                    title: r.title || '',
                    url: r.url || '',
                    description: r.description || '',
                }));

                return {
                    success: true,
                    query,
                    results,
                    count: results.length,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    // ============================================================================
    // Research Search (Exa Search API)
    // ============================================================================

    'research-search': {
        description: 'Use this for finding articles, blog posts, papers, companies, people, or exploring a topic in depth. Best for discovery and research where you need quality sources, not a quick fact.',
        inputSchema: z.object({
            query: z.string().describe('The search query'),
            numResults: z.number().optional().describe('Number of results to return (default: 5, max: 20)'),
            category: z.enum(['company', 'research paper', 'news', 'tweet', 'personal site', 'financial report', 'people']).optional().describe('Filter results by category'),
        }),
        isAvailable: async () => {
            try {
                const homedir = process.env.HOME || process.env.USERPROFILE || '';
                const exaConfigPath = path.join(homedir, '.rowboat', 'config', 'exa-search.json');
                const raw = await fs.readFile(exaConfigPath, 'utf8');
                const config = JSON.parse(raw);
                return !!config.apiKey;
            } catch {
                return false;
            }
        },
        execute: async ({ query, numResults, category }: { query: string; numResults?: number; category?: string }) => {
            try {
                const homedir = process.env.HOME || process.env.USERPROFILE || '';
                const exaConfigPath = path.join(homedir, '.rowboat', 'config', 'exa-search.json');

                let apiKey: string;
                try {
                    const raw = await fs.readFile(exaConfigPath, 'utf8');
                    const config = JSON.parse(raw);
                    apiKey = config.apiKey;
                } catch {
                    return {
                        success: false,
                        error: 'Exa Search API key not configured. Create ~/.rowboat/config/exa-search.json with { "apiKey": "<your-key>" }',
                    };
                }

                if (!apiKey) {
                    return {
                        success: false,
                        error: 'Exa Search API key is empty. Set "apiKey" in ~/.rowboat/config/exa-search.json',
                    };
                }

                const resultCount = Math.min(Math.max(numResults || 5, 1), 20);

                const body: Record<string, unknown> = {
                    query,
                    numResults: resultCount,
                    type: 'auto',
                    contents: {
                        text: { maxCharacters: 1000 },
                        highlights: true,
                    },
                };
                if (category) {
                    body.category = category;
                }

                const response = await fetch('https://api.exa.ai/search', {
                    method: 'POST',
                    headers: {
                        'x-api-key': apiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    const text = await response.text();
                    return {
                        success: false,
                        error: `Exa Search API error (${response.status}): ${text}`,
                    };
                }

                const data = await response.json() as {
                    results?: Array<{
                        title?: string;
                        url?: string;
                        publishedDate?: string;
                        author?: string;
                        highlights?: string[];
                        text?: string;
                    }>;
                };

                const results = (data.results || []).map((r) => ({
                    title: r.title || '',
                    url: r.url || '',
                    publishedDate: r.publishedDate || '',
                    author: r.author || '',
                    highlights: r.highlights || [],
                    text: r.text || '',
                }));

                return {
                    success: true,
                    query,
                    results,
                    count: results.length,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },
};
